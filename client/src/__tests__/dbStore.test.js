import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const prefsStore = new Map();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }) => ({ value: prefsStore.has(key) ? prefsStore.get(key) : null })),
    set: vi.fn(async ({ key, value }) => { prefsStore.set(key, value); }),
    remove: vi.fn(async ({ key }) => { prefsStore.delete(key); })
  }
}));

import {
  getTable,
  setTable,
  removeTable,
  clearAll,
  migrateFromLocalStorage
} from '../services/dbStore';

describe('dbStore', () => {
  beforeEach(() => {
    prefsStore.clear();
  });

  afterEach(async () => {
    await clearAll();
  });

  it('returns null for missing tables', async () => {
    expect(await getTable('local_bins')).toBeNull();
  });

  it('stores and retrieves table data by key', async () => {
    const bins = [{ id: '1', name: 'Bin A' }];
    await setTable('local_bins', bins);
    expect(await getTable('local_bins')).toEqual(bins);
  });

  it('removes a table', async () => {
    await setTable('local_items', [{ id: 'a' }]);
    await removeTable('local_items');
    expect(await getTable('local_items')).toBeNull();
  });

  it('clears all tables', async () => {
    await setTable('local_bins', [{ id: '1' }]);
    await setTable('local_items', [{ id: '2' }]);
    await clearAll();
    expect(await getTable('local_bins')).toBeNull();
    expect(await getTable('local_items')).toBeNull();
  });

  it('migrates localStorage tables and settings into async stores', async () => {
    localStorage.setItem('local_bins', JSON.stringify([{ id: 'b1' }]));
    localStorage.setItem('local_items', JSON.stringify([{ id: 'i1' }]));
    localStorage.setItem('local_audit_log', JSON.stringify([{ id: 'a1' }]));
    localStorage.setItem('local_quarantine', JSON.stringify([{ id: 'q1' }]));
    localStorage.setItem('storage_mode', 'server');
    localStorage.setItem('gemini_api_key', 'key123');

    await migrateFromLocalStorage();

    expect(await getTable('local_bins')).toEqual([{ id: 'b1' }]);
    expect(await getTable('local_items')).toEqual([{ id: 'i1' }]);
    expect(await getTable('local_audit_log')).toEqual([{ id: 'a1' }]);
    expect(await getTable('local_quarantine')).toEqual([{ id: 'q1' }]);
    expect(prefsStore.get('storage_mode')).toBe('"server"');
    expect(prefsStore.get('gemini_api_key')).toBe('"key123"');
    expect(prefsStore.get('migration_v1_done')).toBe('true');
  });

  it('skips migration when already done', async () => {
    prefsStore.set('migration_v1_done', 'true');
    localStorage.setItem('local_bins', JSON.stringify([{ id: 'b1' }]));

    await migrateFromLocalStorage();

    expect(await getTable('local_bins')).toBeNull();
  });

  it('leaves localStorage data intact after migration', async () => {
    localStorage.setItem('local_bins', JSON.stringify([{ id: 'b1' }]));
    await migrateFromLocalStorage();
    expect(localStorage.getItem('local_bins')).toBe(JSON.stringify([{ id: 'b1' }]));
  });
});
