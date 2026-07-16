// @vitest-environment jsdom
//
// Tests the Capacitor `backButton` listener wiring that App.jsx uses.
// Mirrors App.jsx's modal-stack helpers and effect without importing the
// heavy views (Scanner, Camera, ItemForm, etc.).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { MemoryRouter, useSearchParams, useNavigate } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { parseModalStack, stackToSearchString } from '../modalStack.js';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

// ─── Mocks ─────────────────────────────────────────────────────────────────

let mockPlatform = 'android';
let backButtonCallback = null;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mockPlatform,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    exitApp: vi.fn(),
    addListener: vi.fn((event, callback) => {
      if (event === 'backButton') {
        backButtonCallback = callback;
      }
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
}));

beforeEach(() => {
  mockPlatform = 'android';
  backButtonCallback = null;
  App.exitApp.mockClear();
  App.addListener.mockClear();
});

// ─── Test Harness ───────────────────────────────────────────────────────────
// Mirrors App.jsx's onBack/onNavigate + the backButton effect that uses
// { onBack } and { stack.length } as dependencies.

function Harness({ stateRef }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const stack = parseModalStack(searchParams);

  stateRef.current = {
    stack,
    searchString: searchParams.toString(),
  };

  const onBack = React.useCallback(() => {
    if (stack.length <= 1) {
      navigate('/');
    } else {
      navigate(-1);
    }
  }, [stack.length, navigate]);

  const navigateTo = (viewName, params = {}) => {
    if (viewName === 'search') {
      navigate('/');
      return;
    }
    const newStack = [...stack, { type: viewName, params }];
    navigate({ search: stackToSearchString(newStack) });
  };

  stateRef.navigate = navigateTo;
  stateRef.back = onBack;

  React.useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;

    const handle = App.addListener('backButton', () => {
      if (stack.length > 0) {
        onBack();
      } else {
        App.exitApp();
      }
    });

    return () => {
      handle.then((h) => h.remove());
    };
  }, [onBack, stack.length]);

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createHarness(initialEntries = ['/']) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const stateRef = { current: null };

  const render = () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries },
        React.createElement(Harness, { stateRef }),
      ),
    );
  };

  const cleanup = () => {
    root.unmount();
    if (container.parentNode) container.parentNode.removeChild(container);
  };

  return { stateRef, render, cleanup };
}

async function renderHarness({ render }) {
  await act(render);
}

async function navigateTo(viewName, params, { stateRef }) {
  await act(() => stateRef.navigate(viewName, params));
}

async function fireBackButton() {
  await act(() => backButtonCallback());
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Capacitor backButton listener wiring', () => {
  it('android + non-empty stack fires onBack (URL stack shrinks by one)', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigateTo('scanner', {}, h);
    expect(h.stateRef.current.stack).toHaveLength(1);
    expect(h.stateRef.current.searchString).toContain('modal=scanner');

    expect(App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));

    await fireBackButton();
    expect(h.stateRef.current.stack).toHaveLength(0);
    expect(h.stateRef.current.searchString).toBe('');

    h.cleanup();
  });

  it('android + empty stack calls App.exitApp()', async () => {
    const h = createHarness();
    await renderHarness(h);
    expect(h.stateRef.current.stack).toHaveLength(0);

    expect(App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));

    await fireBackButton();
    expect(App.exitApp).toHaveBeenCalledTimes(1);

    h.cleanup();
  });

  it('web does not register a backButton listener', async () => {
    mockPlatform = 'web';
    const h = createHarness();
    await renderHarness(h);

    expect(App.addListener).not.toHaveBeenCalled();

    h.cleanup();
  });
});
