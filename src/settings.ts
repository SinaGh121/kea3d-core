import { parseCameraState } from './viewer/cameraState';
import type { CameraProjection, CameraState, DisplayMode, LightingSettings, RotationMode, ViewportBackground } from './viewer/types';

export type ThemePreference = 'system' | 'light' | 'dark';
export type AccentColor = 'lime' | 'blue' | 'cyan' | 'orange' | 'violet';
export type { ViewportBackground } from './viewer/types';
export type DisplayUnitPreference = 'auto' | 'mm' | 'cm' | 'm';

export interface AppSettings {
  version: 1;
  appearance: {
    theme: ThemePreference;
    accent: AccentColor;
    viewportBackground: ViewportBackground;
  };
  viewer: {
    projection: CameraProjection;
    rotationMode: RotationMode;
    displayMode: DisplayMode;
    gridVisible: boolean;
    displayUnit: DisplayUnitPreference;
    restoreLastCamera: boolean;
    lastCamera: CameraState | null;
    lighting: LightingSettings;
  };
  panels: {
    modelInfoVisible: boolean;
    sceneObjectsVisible: boolean;
  };
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const settingsStorageKey = 'kea3d.settings.v1';
export const legacySettingsStorageKeys = ['formglance.settings.v1', 'nexaview.settings.v1'] as const;

export const defaultAppSettings: AppSettings = {
  version: 1,
  appearance: {
    theme: 'system',
    accent: 'lime',
    viewportBackground: 'adaptive',
  },
  viewer: {
    projection: 'perspective',
    rotationMode: 'fixed-up',
    displayMode: 'solid',
    gridVisible: false,
    displayUnit: 'auto',
    restoreLastCamera: false,
    lastCamera: null,
    lighting: {
      preset: 'neutral',
      exposure: 1,
      environmentIntensity: 1,
      backgroundVisible: false,
      shadows: false,
    },
  },
  panels: {
    modelInfoVisible: true,
    sceneObjectsVisible: true,
  },
};

const isOneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T => (
  typeof value === 'string' && choices.includes(value as T)
);

export function parseAppSettings(value: unknown): AppSettings | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AppSettings>;
  const appearance = candidate.appearance;
  const viewer = candidate.viewer;
  const panels = candidate.panels;
  const lighting = viewer?.lighting ?? defaultAppSettings.viewer.lighting;
  if (
    candidate.version !== 1
    || !appearance
    || !isOneOf(appearance.theme, ['system', 'light', 'dark'] as const)
    || !isOneOf(appearance.accent, ['lime', 'blue', 'cyan', 'orange', 'violet'] as const)
    || !isOneOf(appearance.viewportBackground, ['adaptive', 'black', 'charcoal', 'slate', 'light'] as const)
    || !viewer
    || !isOneOf(viewer.projection, ['perspective', 'orthographic'] as const)
    || !isOneOf(viewer.rotationMode, ['fixed-up', 'free'] as const)
    || !isOneOf(viewer.displayMode, ['solid', 'edges', 'wireframe'] as const)
    || typeof viewer.gridVisible !== 'boolean'
    || !isOneOf(viewer.displayUnit, ['auto', 'mm', 'cm', 'm'] as const)
    || typeof viewer.restoreLastCamera !== 'boolean'
    || (viewer.lastCamera !== null && !parseCameraState(viewer.lastCamera))
    || !isOneOf(lighting.preset, ['neutral', 'studio', 'outdoor'] as const)
    || typeof lighting.exposure !== 'number' || !Number.isFinite(lighting.exposure) || lighting.exposure < 0.5 || lighting.exposure > 2
    || typeof lighting.environmentIntensity !== 'number' || !Number.isFinite(lighting.environmentIntensity) || lighting.environmentIntensity < 0 || lighting.environmentIntensity > 2
    || typeof lighting.backgroundVisible !== 'boolean'
    || typeof lighting.shadows !== 'boolean'
    || !panels
    || typeof panels.modelInfoVisible !== 'boolean'
    || typeof panels.sceneObjectsVisible !== 'boolean'
  ) return null;
  return {
    ...candidate,
    viewer: { ...viewer, lighting: { ...lighting } },
  } as AppSettings;
}

export function parseAppSettingsJson(json: string): AppSettings | null {
  try {
    return parseAppSettings(JSON.parse(json));
  } catch {
    return null;
  }
}

function browserStorage(): SettingsStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadAppSettings(storage: SettingsStorage | null = browserStorage()): AppSettings {
  if (!storage) return structuredClone(defaultAppSettings);
  try {
    const stored = storage.getItem(settingsStorageKey) ?? legacySettingsStorageKeys
      .map((key) => storage.getItem(key))
      .find((value): value is string => value !== null);
    return stored ? parseAppSettingsJson(stored) ?? structuredClone(defaultAppSettings) : structuredClone(defaultAppSettings);
  } catch {
    return structuredClone(defaultAppSettings);
  }
}

export function saveAppSettings(settings: AppSettings, storage: SettingsStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(settingsStorageKey, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function serializeAppSettings(settings: AppSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export function resolveThemePreference(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}
