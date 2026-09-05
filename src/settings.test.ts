import { describe, expect, it } from 'vitest';
import { defaultAppSettings, legacySettingsStorageKeys, loadAppSettings, parseAppSettingsJson, resolveThemePreference, saveAppSettings, serializeAppSettings, settingsStorageKey } from './settings';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(settingsStorageKey, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('app settings', () => {
  it('round-trips the versioned settings document', () => {
    const storage = memoryStorage();
    const settings = structuredClone(defaultAppSettings);
    settings.appearance.theme = 'dark';
    settings.appearance.accent = 'blue';
    settings.viewer.displayUnit = 'mm';
    settings.viewer.lighting.preset = 'studio';
    expect(saveAppSettings(settings, storage)).toBe(true);
    expect(loadAppSettings(storage)).toEqual(settings);
  });

  it('adds default lighting when loading older version-one settings', () => {
    const previous = structuredClone(defaultAppSettings) as unknown as { viewer: { lighting?: unknown; [key: string]: unknown }; [key: string]: unknown };
    delete previous.viewer.lighting;
    expect(parseAppSettingsJson(JSON.stringify(previous))?.viewer.lighting).toEqual(defaultAppSettings.viewer.lighting);
  });

  it('falls back safely when stored settings are malformed', () => {
    expect(loadAppSettings(memoryStorage('{bad json'))).toEqual(defaultAppSettings);
    expect(parseAppSettingsJson(JSON.stringify({ ...defaultAppSettings, version: 2 }))).toBeNull();
    expect(parseAppSettingsJson(JSON.stringify({ ...defaultAppSettings, viewer: { ...defaultAppSettings.viewer, displayMode: 'xray' } }))).toBeNull();
  });

  it.each(legacySettingsStorageKeys)('migrates settings saved under %s', (legacyKey) => {
    const values = new Map<string, string>([[legacyKey, JSON.stringify(defaultAppSettings)]]);
    expect(loadAppSettings({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    })).toEqual(defaultAppSettings);
  });

  it('exports readable JSON that can be imported again', () => {
    expect(parseAppSettingsJson(serializeAppSettings(defaultAppSettings))).toEqual(defaultAppSettings);
  });

  it('resolves the system theme without changing explicit preferences', () => {
    expect(resolveThemePreference('system', true)).toBe('dark');
    expect(resolveThemePreference('system', false)).toBe('light');
    expect(resolveThemePreference('light', true)).toBe('light');
  });
});
