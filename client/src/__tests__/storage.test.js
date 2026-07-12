import { describe, it, expect, beforeEach, vi } from 'vitest';

// storage.js pulls in piexifjs (browser-oriented). Mock it so the unit test
// focuses on the storage-mode helpers without loading native/browser deps.
vi.mock('piexifjs', () => ({ default: {} }));

import { getStorageMode, setStorageMode, isLocalOnly } from '../services/storage.js';

function createLocalStorageStub() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorageStub());
});

describe('storage mode helpers', () => {
  it('defaults to server mode when unset', () => {
    expect(getStorageMode()).toBe('server');
    expect(isLocalOnly()).toBe(false);
  });

  it('round-trips a set storage mode', () => {
    setStorageMode('local');
    expect(getStorageMode()).toBe('local');
    expect(isLocalOnly()).toBe(true);
  });

  it('reflects server mode after switching back', () => {
    setStorageMode('local');
    setStorageMode('server');
    expect(getStorageMode()).toBe('server');
    expect(isLocalOnly()).toBe(false);
  });
});
