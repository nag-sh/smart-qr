import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom does not provide IntersectionObserver
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    constructor() { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; }
  };
}
