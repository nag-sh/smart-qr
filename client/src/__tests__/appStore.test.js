import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }) => ({ value: store.has(key) ? store.get(key) : null })),
    set: vi.fn(async ({ key, value }) => { store.set(key, value); }),
    remove: vi.fn(async ({ key }) => { store.delete(key); })
  }
}));

import { getSetting, setSetting, removeSetting } from '../services/appStore';

describe('appStore', () => {
  beforeEach(() => {
    store.clear();
  });

  it('returns null for unset keys', async () => {
    expect(await getSetting('storage_mode')).toBeNull();
  });

  it('stores and retrieves string values', async () => {
    await setSetting('storage_mode', 'local');
    expect(await getSetting('storage_mode')).toBe('local');
    expect(store.get('storage_mode')).toBe('"local"');
  });

  it('serializes and deserializes object values', async () => {
    await setSetting('cloud_server_url', { host: 'http://example.com' });
    expect(await getSetting('cloud_server_url')).toEqual({ host: 'http://example.com' });
  });

  it('removes a key', async () => {
    await setSetting('gemini_api_key', 'abc123');
    await removeSetting('gemini_api_key');
    expect(await getSetting('gemini_api_key')).toBeNull();
  });

  it('rejects unknown keys', async () => {
    await expect(setSetting('unknown_key', 'value')).rejects.toThrow('Unknown setting key');
    await expect(getSetting('unknown_key')).rejects.toThrow('Unknown setting key');
    await expect(removeSetting('unknown_key')).rejects.toThrow('Unknown setting key');
  });
});
