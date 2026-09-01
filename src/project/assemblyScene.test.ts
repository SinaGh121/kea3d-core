import { Group, Mesh, MeshBasicMaterial, BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { buildFixedAssemblyScene, discoverComponentAnchors } from './assemblyScene';
import { KEA3D_PROJECT_SCHEMA, type Kea3dProjectDocument } from './projectFormat';
import { buildSceneTree } from '../viewer/sceneTree';

function component(anchors: Array<{ id: string; x: number; scale?: number }> = []): Group {
  const scene = new Group();
  scene.name = 'component';
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  for (const definition of anchors) {
    const anchor = new Group();
    anchor.name = definition.id;
    anchor.position.x = definition.x;
    anchor.scale.setScalar(definition.scale ?? 1);
    anchor.userData = { kea3d: { anchor: { id: definition.id, version: 1 } } };
    scene.add(anchor);
  }
  return scene;
}

function project(): Kea3dProjectDocument {
  return {
    $schema: KEA3D_PROJECT_SCHEMA,
    format: 'kea3d-project',
    version: 1,
    name: 'Fixture',
    rootInstance: 'base',
    resources: [
      { id: 'base-model', uri: 'base.glb' },
      { id: 'arm-model', uri: 'arm.glb' },
    ],
    instances: [
      { id: 'base', resource: 'base-model' },
      { id: 'arm', resource: 'arm-model', attachment: { sourceAnchor: 'origin', targetInstance: 'base', targetAnchor: 'mount' } },
      { id: 'tip', resource: 'arm-model', attachment: { sourceAnchor: 'origin', targetInstance: 'arm', targetAnchor: 'end' } },
    ],
  };
}

describe('Kea3D fixed assembly scenes', () => {
  it('discovers GLB anchor metadata and resolves nested instance transforms', () => {
    const scene = buildFixedAssemblyScene(project(), new Map([
      ['base-model', component([{ id: 'mount', x: 5 }])],
      ['arm-model', component([{ id: 'origin', x: 1 }, { id: 'end', x: 4 }])],
    ]));
    const base = scene.getObjectByName('base')!;
    const arm = scene.getObjectByName('arm')!;
    const tip = scene.getObjectByName('tip')!;
    expect(arm.parent).toBe(base);
    expect(tip.parent).toBe(arm);
    expect(arm.position.x).toBe(0);
    expect(arm.matrix.elements[12]).toBeCloseTo(4);
    expect(tip.matrix.elements[12]).toBeCloseTo(3);
    expect(tip.getWorldPosition(scene.position.clone()).x).toBeCloseTo(7);
    const tree = buildSceneTree(scene, new Map());
    expect(JSON.stringify(tree)).toContain('"name":"base"');
    expect(JSON.stringify(tree)).toContain('"name":"tip"');
  });

  it('rejects duplicate anchors, anchor scale, and missing attachment anchors', () => {
    expect(() => discoverComponentAnchors(component([{ id: 'same', x: 0 }, { id: 'same', x: 1 }]), 'part')).toThrow('duplicated');
    expect(() => discoverComponentAnchors(component([{ id: 'scaled', x: 0, scale: 2 }]), 'part')).toThrow('must not contain scale');
    expect(() => buildFixedAssemblyScene(project(), new Map([
      ['base-model', component([])],
      ['arm-model', component([{ id: 'origin', x: 0 }, { id: 'end', x: 1 }])],
    ]))).toThrow('missing anchor "mount"');
  });
});
