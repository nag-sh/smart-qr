export const EXT_FROM_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

export function slugify(str, fallback) {
  if (str == null) return fallback;
  let s = String(str)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!s) return fallback;
  return s;
}

export function planImagePath(base, usedSet) {
  if (!usedSet.has(base)) {
    usedSet.add(base);
    return base;
  }
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base;
  const ext = lastDot > 0 ? base.slice(lastDot) : '';
  let n = 2;
  while (true) {
    const candidate = `${stem}-${n}${ext}`;
    if (!usedSet.has(candidate)) {
      usedSet.add(candidate);
      return candidate;
    }
    n += 1;
  }
}

export function isImageRef(value) {
  return typeof value === 'string' && value.startsWith('img_');
}

export function dataURLToBlob(dataURL) {
  const parts = dataURL.split(',');
  const base64 = parts[1];
  const mime = parts[0].match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const DB_NAME = 'smart-qr-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

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

export async function storeImage(blob) {
  const db = await openDB();
  if (!db) throw new Error('IndexedDB not available');
  const refKey = `img_${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(blob, refKey);
    tx.oncomplete = () => resolve(refKey);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getImageBlob(refKey) {
  if (!isImageRef(refKey)) return null;
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(refKey);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

export async function deleteImage(refKey) {
  if (!isImageRef(refKey)) return;
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(refKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function refToDataURL(refKey) {
  const blob = await getImageBlob(refKey);
  if (!blob) return null;
  return blobToDataURL(blob);
}

const objectUrlCache = new Map();

export async function resolveImageUrl(refKey) {
  if (!isImageRef(refKey)) return refKey;
  if (objectUrlCache.has(refKey)) return objectUrlCache.get(refKey);
  const blob = await getImageBlob(refKey);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(refKey, url);
  return url;
}

export function revokeImageUrl(refKey) {
  const url = objectUrlCache.get(refKey);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrlCache.delete(refKey);
  }
}
