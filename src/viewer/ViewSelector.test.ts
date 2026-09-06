import { describe, expect, it } from 'vitest';
import { createViewSelectorDirections, createViewSelectorPanels } from './ViewSelector';

describe('createViewSelectorDirections', () => {
  it('creates all axial, edge, and corner directions without duplicates', () => {
    const directions = createViewSelectorDirections();
    expect(directions).toHaveLength(26);
    expect(new Set(directions.map((direction) => direction.toArray().map((value) => value.toFixed(5)).join(','))).size).toBe(26);
  });

  it('normalizes every selectable direction', () => {
    createViewSelectorDirections().forEach((direction) => expect(direction.length()).toBeCloseTo(1));
  });

  it('builds one closed chamfered cube from shared panel boundaries', () => {
    const panels = createViewSelectorPanels(1);
    expect(panels.filter((panel) => panel.activeAxes === 1).map((panel) => panel.vertices.length)).toEqual(Array(6).fill(8));
    expect(panels.filter((panel) => panel.activeAxes === 2).map((panel) => panel.vertices.length)).toEqual(Array(12).fill(4));
    expect(panels.filter((panel) => panel.activeAxes === 3).map((panel) => panel.vertices.length)).toEqual(Array(8).fill(6));

    const vertexUse = new Map<string, number>();
    const edgeUse = new Map<string, number>();
    const key = (values: number[]) => values.map((value) => value.toFixed(5)).join(',');
    panels.forEach((panel) => {
      panel.vertices.forEach((vertex, index) => {
        const vertexKey = key(vertex.toArray());
        vertexUse.set(vertexKey, (vertexUse.get(vertexKey) ?? 0) + 1);
        const nextKey = key(panel.vertices[(index + 1) % panel.vertices.length].toArray());
        const edgeKey = [vertexKey, nextKey].sort().join('|');
        edgeUse.set(edgeKey, (edgeUse.get(edgeKey) ?? 0) + 1);
      });
    });

    expect(vertexUse.size).toBe(48);
    expect([...vertexUse.values()].every((uses) => uses === 3)).toBe(true);
    expect([...edgeUse.values()].every((uses) => uses === 2)).toBe(true);
  });
});
