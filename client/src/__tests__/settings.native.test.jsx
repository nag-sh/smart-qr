// @vitest-environment jsdom
//
// Settings native-mode rendering tests. Verifies that cloud/server UI is hidden
// when Capacitor.isNativePlatform() returns true and visible on the web.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const { isNativePlatform } = vi.hoisted(() => ({ isNativePlatform: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform,
  },
}));

import Settings from '../views/Settings';

function renderSettings(native) {
  isNativePlatform.mockReturnValue(native);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Settings onNavigate={() => {}} onBack={() => {}} modalTypes={[]} />);
  });
  return { container, cleanup: () => { root.unmount(); container.remove(); } };
}

describe('Settings native mode', () => {
  it('hides cloud/server UI when Capacitor.isNativePlatform() returns true', () => {
    const { container, cleanup } = renderSettings(true);
    const text = container.textContent;

    expect(text).not.toContain('Cloud');
    expect(text).not.toContain('Cloud Sync');
    expect(text).not.toContain('Cloud → Local');
    expect(text).not.toContain('Local → Cloud');
    expect(text).not.toContain('Local Only');

    cleanup();
  });

  it('shows cloud/server UI when Capacitor.isNativePlatform() returns false', () => {
    const { container, cleanup } = renderSettings(false);
    const text = container.textContent;

    expect(text).toContain('Cloud');
    expect(text).toContain('Cloud Sync');
    expect(text).toContain('Cloud → Local');
    expect(text).toContain('Local → Cloud');
    expect(text).toContain('Local Only');

    cleanup();
  });
});
