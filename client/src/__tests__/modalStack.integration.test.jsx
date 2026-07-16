// @vitest-environment jsdom
//
// Integration tests for modalStack + react-router-dom interaction.
// Renders a minimal harness inside MemoryRouter (without App.jsx views) so
// camera/QR imports never fire. Tests that push/pop/deep-link correctly
// update the URL search-parameter stack via useSearchParams/useNavigate.

import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import { MemoryRouter, useSearchParams, useNavigate } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { parseModalStack, stackToSearchString, buildModalSearch } from '../modalStack.js';

// ─── Test Harness ──────────────────────────────────────────────────────────
// Mirrors App.jsx's onNavigate/onBack but maps state to an observable ref.
// Renders nothing to the DOM — purely tests URL ↔ stack round-trips.

function Harness({ stateRef }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const stack = parseModalStack(searchParams);

  // Expose current state for assertions
  stateRef.current = {
    stack,
    searchString: searchParams.toString(),
  };

  // Navigation actions (matching App.jsx's AppContent helpers)
  stateRef.navigate = (viewName, params = {}) => {
    if (viewName === 'search') {
      navigate('/');
      return;
    }
    const newStack = [...stack, { type: viewName, params }];
    navigate({ search: stackToSearchString(newStack) });
  };

  stateRef.navigateWithReplace = (viewName, params = {}) => {
    if (viewName === 'search') {
      navigate('/');
      return;
    }
    const base = stack.length > 0 ? stack.slice(0, -1) : [];
    const newStack = [...base, { type: viewName, params }];
    navigate({ search: stackToSearchString(newStack) }, { replace: true });
  };

  stateRef.back = () => {
    stack.length <= 1 ? navigate('/') : navigate(-1);
  };

  return null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

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

// Wrap act + navigations so tests read cleanly
async function renderHarness({ stateRef, render }) {
  await act(render);
}

async function navigate(viewName, params, { stateRef }) {
  await act(() => stateRef.navigate(viewName, params));
}

async function navigateWithReplace(viewName, params, { stateRef }) {
  await act(() => stateRef.navigateWithReplace(viewName, params));
}

async function goBack({ stateRef }) {
  await act(() => stateRef.back());
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('modalStack + react-router integration', () => {
  it('push updates URL and exposes correct stack', async () => {
    const h = createHarness();
    await renderHarness(h);
    expect(h.stateRef.current.stack).toEqual([]);
    expect(h.stateRef.current.searchString).toBe('');

    await navigate('bin-details', { binId: '1' }, h);
    expect(h.stateRef.current.stack).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
    ]);
    expect(h.stateRef.current.searchString).toContain('modal=bin-details');
    expect(h.stateRef.current.searchString).toContain('binId=1');
    h.cleanup();
  });

  it('back pops one layer from stacked modals', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('scanner', {}, h);
    await navigate('settings', {}, h);
    expect(h.stateRef.current.stack).toHaveLength(2);

    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(1);
    expect(h.stateRef.current.stack[0].type).toBe('scanner');
    h.cleanup();
  });

  it('deep link initializes stack from search params', async () => {
    const h = createHarness([
      '/?modal=bin-details&binId=1&modal=item-details&itemId=2',
    ]);
    await renderHarness(h);

    expect(h.stateRef.current.stack).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'item-details', params: { itemId: '2' } },
    ]);
    h.cleanup();
  });

  it('back from single-layer stack lands on search (empty stack)', async () => {
    const h = createHarness();
    await renderHarness(h);
    await navigate('settings', {}, h);
    expect(h.stateRef.current.stack).toHaveLength(1);

    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(0);
    expect(h.stateRef.current.searchString).toBe('');
    h.cleanup();
  });

  it('navigate("search") clears entire stack from any depth', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('scanner', {}, h);
    await navigate('settings', {}, h);
    await navigate('bin-details', { binId: '42' }, h);
    expect(h.stateRef.current.stack).toHaveLength(3);

    await navigate('search', {}, h);
    expect(h.stateRef.current.stack).toHaveLength(0);
    expect(h.stateRef.current.searchString).toBe('');
    h.cleanup();
  });

  it('sequential pushes and pops behave as LIFO stack', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('bin-details', { binId: '1' }, h);
    await navigate('item-details', { itemId: '2' }, h);
    await navigate('settings', {}, h);
    expect(h.stateRef.current.stack).toHaveLength(3);

    // Pop settings
    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(2);
    expect(h.stateRef.current.stack[1].type).toBe('item-details');

    // Pop item-details
    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(1);
    expect(h.stateRef.current.stack[0].type).toBe('bin-details');

    // Pop bin-details → search
    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(0);
    h.cleanup();
  });

  it('ignores unknown modal types preserving known ones', async () => {
    const h = createHarness([
      '/?modal=unknown&modal=scanner&modal=also-unknown',
    ]);
    await renderHarness(h);
    // unknown and also-unknown are filtered out; only scanner remains
    expect(h.stateRef.current.stack).toEqual([
      { type: 'scanner', params: {} },
    ]);
    h.cleanup();
  });

  it('rejects duplicate param keys across layers via positional indexing', async () => {
    // Two layers both use binId; each layer gets its own positional value
    const h = createHarness([
      '/?modal=bin-details&binId=1&modal=create-bin&qrId=abc&modal=bin-details&binId=2',
    ]);
    await renderHarness(h);
    expect(h.stateRef.current.stack).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'create-bin', params: { qrId: 'abc' } },
      { type: 'bin-details', params: { binId: '2' } },
    ]);
    h.cleanup();
  });

  // ─── multi-add modal ─────────────────────────────────────────────────────

  it('push multi-add modal populates stack and URL correctly', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('multi-add', { binId: 'xyz' }, h);
    expect(h.stateRef.current.stack).toEqual([
      { type: 'multi-add', params: { binId: 'xyz' } },
    ]);
    expect(h.stateRef.current.searchString).toContain('modal=multi-add');
    expect(h.stateRef.current.searchString).toContain('binId=xyz');
    h.cleanup();
  });

  it('back pops multi-add modal', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('multi-add', { binId: 'xyz' }, h);
    expect(h.stateRef.current.stack).toHaveLength(1);

    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(0);
    expect(h.stateRef.current.searchString).toBe('');
    h.cleanup();
  });

  it('deep link parses multi-add modal from search params', async () => {
    const h = createHarness([
      '/?modal=multi-add&binId=xyz',
    ]);
    await renderHarness(h);

    expect(h.stateRef.current.stack).toEqual([
      { type: 'multi-add', params: { binId: 'xyz' } },
    ]);
    h.cleanup();
  });

  it('replace replaces current layer without appending and keeps back navigation working', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('scanner', {}, h);
    await navigate('settings', {}, h);
    expect(h.stateRef.current.stack).toHaveLength(2);

    await navigateWithReplace('bin-details', { binId: '42' }, h);
    expect(h.stateRef.current.stack).toHaveLength(2);
    expect(h.stateRef.current.stack).toEqual([
      { type: 'scanner', params: {} },
      { type: 'bin-details', params: { binId: '42' } },
    ]);
    expect(h.stateRef.current.searchString).toContain('modal=bin-details');
    expect(h.stateRef.current.searchString).not.toMatch(/(^|&)modal=settings(&|$)/);

    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(1);
    expect(h.stateRef.current.stack[0].type).toBe('scanner');
    h.cleanup();
  });

  it('scanner -> result with replace removes scanner and preserves prior layer', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('bin-details', { binId: '1' }, h);
    await navigate('scanner', {}, h);
    expect(h.stateRef.current.stack).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'scanner', params: {} },
    ]);

    await navigateWithReplace('item-details', { itemId: '2' }, h);
    expect(h.stateRef.current.stack).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'item-details', params: { itemId: '2' } },
    ]);
    expect(h.stateRef.current.searchString).toContain('modal=item-details');
    expect(h.stateRef.current.searchString).not.toContain('modal=scanner');

    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(1);
    expect(h.stateRef.current.stack[0].type).toBe('bin-details');
    h.cleanup();
  });

  it('single-item capture plain push keeps camera/form under item-details', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('bin-details', { binId: '1' }, h);
    await navigate('add-item', { binId: '1' }, h);
    await navigate('item-details', { itemId: 'new', pendingCreate: true, binId: '1' }, h);
    expect(h.stateRef.current.stack).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'add-item', params: { binId: '1' } },
      { type: 'item-details', params: { itemId: 'new', pendingCreate: 'true', binId: '1' } },
    ]);

    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(2);
    expect(h.stateRef.current.stack[1].type).toBe('add-item');
    h.cleanup();
  });

  it('Class B sub-modal with replace replaces current and returns to underlying modal', async () => {
    const h = createHarness();
    await renderHarness(h);

    await navigate('bin-details', { binId: '1' }, h);
    await navigate('settings', {}, h);
    await navigateWithReplace('settings-warning', {}, h);
    expect(h.stateRef.current.stack).toEqual([
      { type: 'bin-details', params: { binId: '1' } },
      { type: 'settings-warning', params: {} },
    ]);
    expect(h.stateRef.current.searchString).toContain('modal=settings-warning');
    expect(h.stateRef.current.searchString).not.toMatch(/(^|&)modal=settings(&|$)/);

    await goBack(h);
    expect(h.stateRef.current.stack).toHaveLength(1);
    expect(h.stateRef.current.stack[0].type).toBe('bin-details');
    h.cleanup();
  });
});
