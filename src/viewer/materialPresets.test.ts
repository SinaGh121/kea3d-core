import { describe, expect, it } from 'vitest';
import { defaultMaterialPresetOptions, findMaterialPreset, finishRoughness, materialCategoryNames, materialPresets } from './materialPresets';

describe('material presets', () => {
  it('provides unique, finite numerical PBR presets for every planned category', () => {
    expect(new Set(materialPresets.map((preset) => preset.id)).size).toBe(materialPresets.length);
    expect(new Set(materialPresets.map((preset) => preset.category))).toEqual(new Set(Object.keys(materialCategoryNames)));
    materialPresets.forEach((preset) => {
      expect(preset.name.trim()).not.toBe('');
      expect(preset.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(preset.metalness).toBeGreaterThanOrEqual(0);
      expect(preset.metalness).toBeLessThanOrEqual(1);
      expect(preset.roughness).toBeGreaterThanOrEqual(0);
      expect(preset.roughness).toBeLessThanOrEqual(1);
      if (preset.opacity !== undefined) expect(preset.opacity).toBeGreaterThan(0);
      if (preset.transmission !== undefined) expect(preset.transmission).toBeGreaterThanOrEqual(0);
    });
  });

  it('covers the approved color tones, glass variants, display surfaces, and LEDs', () => {
    const ids = new Set(materialPresets.map((preset) => preset.id));
    [
      'black', 'white', 'gray', 'signal-red', 'signal-orange', 'safety-yellow',
      'signal-green', 'signal-blue', 'midnight-blue', 'display-black',
      'clear-glass', 'smoked-glass', 'frosted-glass', 'frosted-gray-glass',
      'frosted-black-glass', 'magenta-glass', 'deep-magenta-glass',
      'red-led', 'green-led', 'blue-led', 'yellow-led', 'white-led',
    ].forEach((id) => expect(ids.has(id), id).toBe(true));
  });

  it('keeps tone and finish as independent numerical controls', () => {
    const copper = findMaterialPreset('copper')!;
    const options = defaultMaterialPresetOptions(copper);
    expect(options.tone).toBe('standard');
    expect(finishRoughness(copper, 'matte')).toBeGreaterThan(finishRoughness(copper, 'satin'));
    expect(finishRoughness(copper, 'satin')).toBeGreaterThan(finishRoughness(copper, 'gloss'));
  });
});
