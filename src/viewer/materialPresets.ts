export type MaterialPresetCategory = 'basics' | 'metals' | 'plastics' | 'glass' | 'leds';
export type MaterialTone = 'dark' | 'standard' | 'light';
export type MaterialFinish = 'matte' | 'satin' | 'gloss';

export interface MaterialPresetOptions {
  tone: MaterialTone;
  roughness: number;
  metalness: number;
  opacity: number;
  transmission: number;
  emissionEnabled: boolean;
  emissiveIntensity: number;
}

export interface MaterialPreset {
  id: string;
  name: string;
  category: MaterialPresetCategory;
  color: string;
  metalness: number;
  roughness: number;
  opacity?: number;
  transmission?: number;
  emissive?: string;
  emissiveIntensity?: number;
  toneAdjustable?: boolean;
  finishFamily?: 'coated' | 'metal';
  defaultFinish?: MaterialFinish;
}

export const materialCategoryNames: Record<MaterialPresetCategory, string> = {
  basics: 'Basics',
  metals: 'Metals',
  plastics: 'Plastics & rubber',
  glass: 'Glass',
  leds: 'Emissive LEDs',
};

export const materialPresets: readonly MaterialPreset[] = [
  { id: 'black', name: 'Black', category: 'basics', color: '#17191c', metalness: 0, roughness: 0.42, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'white', name: 'White', category: 'basics', color: '#e9ecef', metalness: 0, roughness: 0.42, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'gray', name: 'Gray', category: 'basics', color: '#777b80', metalness: 0, roughness: 0.42, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'signal-red', name: 'Red', category: 'basics', color: '#c62828', metalness: 0, roughness: 0.42, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'signal-orange', name: 'Orange', category: 'basics', color: '#d65a1f', metalness: 0, roughness: 0.42, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'safety-yellow', name: 'Yellow', category: 'basics', color: '#f2bd27', metalness: 0, roughness: 0.42, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'signal-green', name: 'Green', category: 'basics', color: '#2f7d4a', metalness: 0, roughness: 0.42, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'signal-blue', name: 'Blue', category: 'basics', color: '#245ca8', metalness: 0, roughness: 0.42, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'midnight-blue', name: 'Midnight blue', category: 'basics', color: '#07162d', metalness: 0, roughness: 0.38, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },

  { id: 'carbon-steel', name: 'Carbon steel', category: 'metals', color: '#6f7479', metalness: 0.9, roughness: 0.38, finishFamily: 'metal', defaultFinish: 'matte' },
  { id: 'stainless-steel', name: 'Stainless steel', category: 'metals', color: '#b9bec2', metalness: 0.96, roughness: 0.24, finishFamily: 'metal', defaultFinish: 'satin' },
  { id: 'aluminium', name: 'Aluminium', category: 'metals', color: '#c2c5c7', metalness: 0.9, roughness: 0.34, finishFamily: 'metal', defaultFinish: 'matte' },
  { id: 'chrome', name: 'Chrome', category: 'metals', color: '#d8dde0', metalness: 1, roughness: 0.08, finishFamily: 'metal', defaultFinish: 'gloss' },
  { id: 'copper', name: 'Copper', category: 'metals', color: '#b86a45', metalness: 0.92, roughness: 0.28, finishFamily: 'metal', defaultFinish: 'satin' },
  { id: 'brass', name: 'Brass', category: 'metals', color: '#b9933e', metalness: 0.9, roughness: 0.3, finishFamily: 'metal', defaultFinish: 'satin' },

  { id: 'black-abs', name: 'Black ABS', category: 'plastics', color: '#202225', metalness: 0, roughness: 0.36, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'white-abs', name: 'White ABS', category: 'plastics', color: '#e7e8e6', metalness: 0, roughness: 0.34, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'gray-abs', name: 'Gray ABS', category: 'plastics', color: '#777d82', metalness: 0, roughness: 0.38, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'satin' },
  { id: 'red-plastic', name: 'Red plastic', category: 'plastics', color: '#b71f2e', metalness: 0, roughness: 0.3, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'gloss' },
  { id: 'orange-plastic', name: 'Orange plastic', category: 'plastics', color: '#cf551e', metalness: 0, roughness: 0.3, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'gloss' },
  { id: 'yellow-plastic', name: 'Yellow plastic', category: 'plastics', color: '#e8b51c', metalness: 0, roughness: 0.3, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'gloss' },
  { id: 'green-plastic', name: 'Green plastic', category: 'plastics', color: '#247142', metalness: 0, roughness: 0.3, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'gloss' },
  { id: 'blue-plastic', name: 'Blue plastic', category: 'plastics', color: '#1e5d9b', metalness: 0, roughness: 0.3, toneAdjustable: true, finishFamily: 'coated', defaultFinish: 'gloss' },
  { id: 'display-black', name: 'Display black', category: 'plastics', color: '#071619', metalness: 0.18, roughness: 0.16, finishFamily: 'coated', defaultFinish: 'gloss' },
  { id: 'black-rubber', name: 'Black rubber', category: 'plastics', color: '#111315', metalness: 0, roughness: 0.92 },
  { id: 'gray-rubber', name: 'Gray rubber', category: 'plastics', color: '#4a4d50', metalness: 0, roughness: 0.88 },

  { id: 'clear-glass', name: 'Clear glass', category: 'glass', color: '#eef8fa', metalness: 0, roughness: 0.04, opacity: 0.22, transmission: 0.95 },
  { id: 'smoked-glass', name: 'Smoked glass', category: 'glass', color: '#465157', metalness: 0, roughness: 0.1, opacity: 0.42, transmission: 0.72 },
  { id: 'frosted-glass', name: 'Frosted glass', category: 'glass', color: '#dce6e8', metalness: 0, roughness: 0.62, opacity: 0.58, transmission: 0.48 },
  { id: 'frosted-gray-glass', name: 'Frosted gray', category: 'glass', color: '#7b8588', metalness: 0, roughness: 0.62, opacity: 0.6, transmission: 0.42 },
  { id: 'frosted-black-glass', name: 'Frosted black', category: 'glass', color: '#171b1d', metalness: 0, roughness: 0.64, opacity: 0.64, transmission: 0.34 },
  { id: 'display-glass', name: 'Display glass', category: 'glass', color: '#17262c', metalness: 0, roughness: 0.12, opacity: 0.48, transmission: 0.62 },
  { id: 'magenta-glass', name: 'Magenta tint', category: 'glass', color: '#b51f70', metalness: 0, roughness: 0.12, opacity: 0.28, transmission: 0.78 },
  { id: 'deep-magenta-glass', name: 'Deep magenta tint', category: 'glass', color: '#6f123f', metalness: 0, roughness: 0.18, opacity: 0.48, transmission: 0.58 },

  { id: 'red-led', name: 'Red LED', category: 'leds', color: '#6d0909', metalness: 0, roughness: 0.28, emissive: '#ff2d24', emissiveIntensity: 3 },
  { id: 'green-led', name: 'Green LED', category: 'leds', color: '#083b20', metalness: 0, roughness: 0.28, emissive: '#28ff72', emissiveIntensity: 3 },
  { id: 'blue-led', name: 'Blue LED', category: 'leds', color: '#071f52', metalness: 0, roughness: 0.28, emissive: '#3187ff', emissiveIntensity: 3 },
  { id: 'yellow-led', name: 'Yellow LED', category: 'leds', color: '#5c4305', metalness: 0, roughness: 0.28, emissive: '#ffd633', emissiveIntensity: 3 },
  { id: 'white-led', name: 'White LED', category: 'leds', color: '#d9e4e8', metalness: 0, roughness: 0.25, emissive: '#ffffff', emissiveIntensity: 2.5 },
] as const;

export function findMaterialPreset(id: string): MaterialPreset | undefined {
  return materialPresets.find((preset) => preset.id === id);
}

export function defaultMaterialPresetOptions(preset: MaterialPreset): MaterialPresetOptions {
  return {
    tone: 'standard',
    roughness: preset.roughness,
    metalness: preset.metalness,
    opacity: preset.opacity ?? 1,
    transmission: preset.transmission ?? 0,
    emissionEnabled: Boolean(preset.emissive),
    emissiveIntensity: preset.emissiveIntensity ?? 0,
  };
}

export function finishRoughness(preset: MaterialPreset, finish: MaterialFinish): number {
  if (preset.finishFamily === 'metal') {
    return finish === 'matte' ? 0.42 : finish === 'satin' ? 0.24 : 0.08;
  }
  return finish === 'matte' ? 0.76 : finish === 'satin' ? 0.4 : 0.14;
}
