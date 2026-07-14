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
  migrateFromLocalStorage
} from '../services/dbStore';

describe('dbStore', () => {
  beforeEach(() => {
    prefsStore.clear();
  });

  afterEach(async () => {
    // Clear all entries from the IndexedDB object store
    // (deleteDatabase hangs because dbStore holds an open connection;
    //  setTable to [] would make getTable return [] instead of null)
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('smart-qr-data');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    if (!db) return;
    await new Promise((res, rej) => {
      const tx = db.transaction('tables', 'readwrite');
      tx.objectStore('tables').clear();
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  });

  it('returns null for missing tables', async () => {
    expect(await getTable('local_bins')).toBeNull();
  });

  it('stores and retrieves table data by key', async () => {
    const bins = [{ id: '1', name: 'Bin A' }];
    await setTable('local_bins', bins);
    expect(await getTable('local_bins')).toEqual(bins);
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
