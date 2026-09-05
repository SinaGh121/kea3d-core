import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { analyzeModel, analyzeSelection } from './modelAnalysis';

describe('analyzeModel', () => {
  it('counts geometry and dimensions without changing the model', () => {
    const group = new Group();
    group.add(new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial()));

    const info = analyzeModel(group, 'box.glb', 512);

    expect(info.fileName).toBe('box.glb');
    expect(info.fileSize).toBe(512);
    expect(info.meshes).toBe(1);
    expect(info.materials).toBe(1);
    expect(info.vertices).toBeGreaterThan(0);
    expect(info.triangles).toBe(12);
    expect(info.dimensions).toEqual([2, 4, 6]);
  });

  it('reports geometry and bounds for a selected subtree', () => {
    const group = new Group();
    group.add(
      new Mesh(new BoxGeometry(1, 2, 3), new MeshStandardMaterial()),
      new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()),
    );

    const info = analyzeSelection(group);

    expect(info.meshes).toBe(2);
    expect(info.materials).toBe(2);
    expect(info.triangles).toBe(24);
    expect(info.dimensions).toEqual([1, 2, 3]);
  });
});
