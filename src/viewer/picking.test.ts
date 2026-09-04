import { describe, expect, it } from 'vitest';
import { AxesHelper, BoxGeometry, Group, Mesh, MeshBasicMaterial, Plane, Raycaster, Vector3 } from 'three';
import { pickAnchorMarker, pickVisibleMesh } from './picking';

describe('viewport picking', () => {
  it('skips clipped surfaces and honors union/intersection material clipping', () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ clippingPlanes: [new Plane(new Vector3(0, 0, -1), -1)] });
    const front = new Mesh(new BoxGeometry(), material);
    const back = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    back.position.z = -2;
    root.add(front, back);
    root.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1));
    expect(pickVisibleMesh(ray, root)?.object).toBe(back);
    material.clippingPlanes!.push(new Plane(new Vector3(1, 0, 0), 1));
    expect(pickVisibleMesh(ray, root)?.object).toBe(back);
    material.clipIntersection = true;
    expect(pickVisibleMesh(ray, root)?.object).toBe(front);
    material.visible = false;
    expect(pickVisibleMesh(ray, root)?.object).toBe(back);
  });

  it('ignores hidden ancestor geometry and reaches the visible mesh behind it', () => {
    const root = new Group();
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const visible = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    visible.position.z = -2;
    root.add(hidden, visible);
    root.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1));
    expect(pickVisibleMesh(ray, root)?.object).toBe(visible);
    visible.visible = false;
    expect(pickVisibleMesh(ray, root)).toBeUndefined();
  });

  it.each([0.002, 0.02, 2])('bounds Anchor picking by glyph size at scale %s and restores the shared raycaster', (size) => {
    const source = new Group();
    const marker = new Group();
    const axes = new AxesHelper(1);
    axes.scale.setScalar(size);
    marker.add(axes);
    const markers = new Map([[source, marker]]);
    const ray = new Raycaster(new Vector3(size * 15, size * 15, 10), new Vector3(0, 0, -1));
    expect(pickAnchorMarker(ray, markers)).toBeUndefined();
    ray.ray.origin.set(size * 0.6, size * 0.2, 10);
    expect(pickAnchorMarker(ray, markers)).toBe(source);
    expect(ray.params.Line.threshold).toBe(1);
    const parent = new Group();
    parent.add(source);
    parent.visible = false;
    expect(pickAnchorMarker(ray, markers)).toBeUndefined();
    parent.visible = true;
    marker.visible = false;
    expect(pickAnchorMarker(ray, markers)).toBeUndefined();
  });
});
