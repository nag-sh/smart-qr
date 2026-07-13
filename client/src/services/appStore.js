import { Preferences } from '@capacitor/preferences';

const SETTING_KEYS = new Set([
  'storage_mode',
  'gemini_api_key',
  'cloud_server_url',
  'cloud_api_token',
  'migration_v1_done'
]);

export async function getSetting(key) {
  if (!SETTING_KEYS.has(key)) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  const { value } = await Preferences.get({ key });
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function setSetting(key, value) {
  if (!SETTING_KEYS.has(key)) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  await Preferences.set({ key, value: JSON.stringify(value) });
}

export async function removeSetting(key) {
  if (!SETTING_KEYS.has(key)) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  await Preferences.remove({ key });
}
