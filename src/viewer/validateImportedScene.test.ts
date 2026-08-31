import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { validateImportedScene } from './validateImportedScene';

function triangle(): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  return new Mesh(geometry, new MeshStandardMaterial());
}

describe('validateImportedScene', () => {
  it('accepts a finite triangle mesh', () => {
    const scene = new Group();
    scene.add(triangle());
    expect(() => validateImportedScene(scene)).not.toThrow();
  });

  it('rejects invalid mesh indices before rendering', () => {
    const mesh = triangle();
    mesh.geometry.setIndex([0, 1, 3]);
    expect(() => validateImportedScene(mesh)).toThrow('invalid mesh index');
  });

  it('rejects non-finite transforms and empty scenes', () => {
    const mesh = triangle();
    mesh.position.x = Number.NaN;
    expect(() => validateImportedScene(mesh)).toThrow('invalid object transform');
    expect(() => validateImportedScene(new Group())).toThrow('does not contain renderable');
  });
});
