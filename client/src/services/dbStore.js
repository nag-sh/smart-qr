import { setSetting, getSetting } from './appStore.js';

const DB_NAME = 'smart-qr-data';
const DB_VERSION = 1;
const STORE_NAME = 'tables';
const TABLE_KEYS = ['local_bins', 'local_items', 'local_audit_log', 'local_quarantine'];
const SETTING_KEYS = ['storage_mode', 'gemini_api_key', 'cloud_server_url', 'cloud_api_token'];

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function getTable(name) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(name);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function setTable(name, value) {
  const db = await openDB();
  if (!db) throw new Error('IndexedDB not available');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(value, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeTable(name) {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function migrateFromLocalStorage() {
  if (typeof window === 'undefined' || !window.indexedDB) {
    console.error('IndexedDB unavailable; skipping localStorage migration');
    return;
  }
  if (typeof localStorage === 'undefined') return;

  const alreadyMigrated = await getSetting('migration_v1_done');
  if (alreadyMigrated) return;

  for (const key of TABLE_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw);
      await setTable(key, parsed);
    } catch (err) {
      console.error(`Failed to migrate table ${key}:`, err);
    }
  }

  for (const key of SETTING_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      await setSetting(key, raw);
    } catch (err) {
      console.error(`Failed to migrate setting ${key}:`, err);
    }
  }

  await setSetting('migration_v1_done', true);
}
