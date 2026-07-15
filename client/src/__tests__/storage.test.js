import { describe, it, expect, beforeEach, vi } from 'vitest';

// storage.js pulls in piexifjs (browser-oriented). Mock it so the unit test
// focuses on the storage-mode helpers without loading native/browser deps.
vi.mock('piexifjs', () => ({ default: {} }));

// Mock Capacitor platform detection for initStorage native-mode tests.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false) } }));

// In-memory async stores used by the mocked appStore/dbStore modules.
globalThis.__TEST_APP_STORE__ = new Map();
globalThis.__TEST_DB_STORE__ = new Map();

vi.mock('../services/appStore.js', () => ({
  getSetting: vi.fn(async (key) => globalThis.__TEST_APP_STORE__.get(key) ?? null),
  setSetting: vi.fn(async (key, value) => { globalThis.__TEST_APP_STORE__.set(key, value); }),
  removeSetting: vi.fn(async (key) => { globalThis.__TEST_APP_STORE__.delete(key); })
}));

vi.mock('../services/dbStore.js', () => ({
  getTable: vi.fn(async (key) => globalThis.__TEST_DB_STORE__.get(key) ?? null),
  setTable: vi.fn(async (key, value) => { globalThis.__TEST_DB_STORE__.set(key, value); }),
  migrateFromLocalStorage: vi.fn(async () => {})
}));

import { getStorageMode, setStorageMode, isLocalOnly, initStorage, getLocalExportData, restoreLocalData, createBin } from '../services/storage.js';
import { Capacitor } from '@capacitor/core';

beforeEach(() => {
  globalThis.__TEST_APP_STORE__ = new Map();
  globalThis.__TEST_DB_STORE__ = new Map();
  Capacitor.isNativePlatform.mockReturnValue(false);
});

describe('storage mode helpers', () => {
  it('defaults to local mode when unset', async () => {
    await initStorage();
    expect(getStorageMode()).toBe('local');
    expect(isLocalOnly()).toBe(true);
  });

  it('round-trips a set storage mode', async () => {
    await setStorageMode('local');
    expect(getStorageMode()).toBe('local');
    expect(isLocalOnly()).toBe(true);
  });

  it('reflects server mode after switching back', async () => {
    await setStorageMode('local');
    await setStorageMode('server');
    expect(getStorageMode()).toBe('server');
    expect(isLocalOnly()).toBe(false);
  });

  it('forces local mode when native platform', async () => {
    await setStorageMode('server');
    Capacitor.isNativePlatform.mockReturnValue(true);
    await initStorage();
    expect(getStorageMode()).toBe('local');
    expect(isLocalOnly()).toBe(true);
    expect(globalThis.__TEST_APP_STORE__.get('storage_mode')).toBe('local');
  });
});

describe('local table helpers', () => {
  it('reads empty tables by default', async () => {
    await initStorage();
    const data = await getLocalExportData();
    expect(data.bins).toEqual([]);
    expect(data.items).toEqual([]);
  });

  it('writes and reads tables', async () => {
    await restoreLocalData({ bins: [{ id: 'b1' }], items: [{ id: 'i1' }] });
    const data = await getLocalExportData();
    expect(data.bins).toEqual([{ id: 'b1' }]);
    expect(data.items).toEqual([{ id: 'i1' }]);
  });
});

describe('createBin untitled fallback', () => {
  it('assigns a generated "Untitled Bin-<suffix>" title when name is blank', async () => {
    await initStorage();
    const bin = await createBin('qr-untitled', '   ', 'Basement', null);
    expect(bin.name).toMatch(/^Untitled Bin-[a-z0-9]{5}$/);
  });

  it('keeps an explicitly provided name', async () => {
    await initStorage();
    const bin = await createBin('qr-named', '  Tools  ', 'Garage', null);
    expect(bin.name).toBe('Tools');
  });

  it('rejects duplicate QR ids', async () => {
    await initStorage();
    await createBin('qr-dup', 'First', 'Garage', null);
    await expect(createBin('qr-dup', '', 'Garage', null)).rejects.toThrow(/already exists/);
  });
});
