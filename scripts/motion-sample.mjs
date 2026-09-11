import { BoxGeometry } from 'three';
import { zipSync } from 'fflate';

function model(boxes, anchors = [], animated = false) {
  const chunks = [], bufferViews = [], accessors = [], nodes = [], meshes = [], materials = [];
  let offset = 0;
  const accessor = (values, type, min, max) => {
    const bytes = Buffer.from(new Float32Array(values).buffer);
    const bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); chunks.push(bytes); offset += bytes.length;
    const index = accessors.length, size = { SCALAR: 1, VEC3: 3 }[type];
    accessors.push({ bufferView, componentType: 5126, count: values.length / size, type, ...(min ? { min, max } : {}) }); return index;
  };
  for (const box of boxes) {
    const geometry = new BoxGeometry(...box.size).toNonIndexed(); geometry.computeBoundingBox();
    const position = accessor(geometry.attributes.position.array, 'VEC3', geometry.boundingBox.min.toArray(), geometry.boundingBox.max.toArray());
    const normal = accessor(geometry.attributes.normal.array, 'VEC3');
    const material = materials.length; materials.push({ pbrMetallicRoughness: { baseColorFactor: [...box.color, 1], metallicFactor: 0.2, roughnessFactor: 0.5 } });
    nodes.push({ name: box.name, mesh: meshes.length, translation: box.position });
    meshes.push({ primitives: [{ attributes: { POSITION: position, NORMAL: normal }, material }] }); geometry.dispose();
  }
  for (const [id, translation] of anchors) nodes.push({ name: id, translation, extras: { kea3d: { anchor: { version: 1, id } } } });
  let animations;
  if (animated) {
    const input = accessor([0, 1, 2], 'SCALAR', [0], [2]);
    const output = accessor([0, 0.055, 0, 0, 1, 0, 0, 0.12, 0], 'VEC3');
    animations = [{ name: 'Lid poses', samplers: [{ input, output, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }];
  }
  const json = { asset: { version: '2.0', generator: 'Kea3D local motion sample' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, materials,
    buffers: [{ byteLength: offset }], bufferViews, accessors, ...(animations ? { animations } : {}) };
  const text = JSON.stringify(json), chunk = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4)), binary = Buffer.concat(chunks);
  const bytes = Buffer.alloc(28 + chunk.length + binary.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(chunk.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); chunk.copy(bytes, 20);
  bytes.writeUInt32LE(binary.length, 20 + chunk.length); bytes.writeUInt32LE(0x004e4942, 24 + chunk.length); binary.copy(bytes, 28 + chunk.length);
  return bytes;
}

export function motionSample() {
  const base = model([{ name: 'Rail base', size: [0.7, 0.025, 0.4], position: [0, -0.04, 0], color: [0.18, 0.23, 0.3] },
    { name: 'Rail one', size: [0.6, 0.02, 0.015], position: [0, 0, -0.11], color: [0.8, 0.85, 0.9] },
    { name: 'Rail two', size: [0.6, 0.02, 0.015], position: [0, 0, 0.11], color: [0.8, 0.85, 0.9] }],
    [['left-mount', [-0.16, 0, -0.11]], ['right-mount', [0.16, 0, 0.11]]]);
  const carriage = model([{ name: 'Carriage', size: [0.1, 0.06, 0.09], position: [0, 0.015, 0], color: [0.1, 0.65, 0.9] },
    { name: 'Lid', size: [0.11, 0.016, 0.1], position: [0, 0.055, 0], color: [1, 0.45, 0.08] }], [], true);
  const joint = (id, type, axis, min, max) => ({ id, type, axis, limits: { min, max }, state: { position: 0 } });
  const frame = (instance, target, durationMs = 200) => ({ type: 'frame', instance, clip: 'Lid poses', frame: target, fps: 1, durationMs });
  const project = { $schema: 'https://kea3d.com/schemas/project/v2.json', format: 'kea3d-project', version: 2, name: 'Motion Lab', rootInstance: 'base',
    resources: [{ id: 'base', uri: 'base.glb' }, { id: 'carriage', uri: 'carriage.glb' }],
    instances: [{ id: 'base', resource: 'base' },
      { id: 'slider', resource: 'carriage', attachment: { targetInstance: 'base', targetAnchor: 'left-mount', joint: joint('slide', 'prismatic', 'x', -0.07, 0.05) } },
      { id: 'rotor', resource: 'carriage', attachment: { targetInstance: 'base', targetAnchor: 'right-mount', joint: joint('turn', 'revolute', 'y', -Math.PI / 6, Math.PI / 18) } }],
    motions: [
      { id: 'cycle', name: 'Slide + rotate + lids', repeat: 2, steps: [
        { type: 'parallel', steps: [{ type: 'joint', instance: 'slider', to: 0.05, speed: 0.05 }, { type: 'joint', instance: 'rotor', to: Math.PI / 18, durationMs: 1000 }] },
        { type: 'wait', durationMs: 400 },
        { type: 'parallel', steps: [{ type: 'joint', instance: 'slider', to: -0.07, durationMs: 1500 }, { type: 'joint', instance: 'rotor', to: -Math.PI / 6, durationMs: 1500 }] },
        { type: 'parallel', steps: [frame('slider', 2), frame('rotor', 2, 500)] },
        { type: 'wait', durationMs: 700 },
        { type: 'parallel', steps: [frame('slider', 0), frame('rotor', 0), { type: 'joint', instance: 'slider', to: 0, durationMs: 1000 }, { type: 'joint', instance: 'rotor', to: 0, durationMs: 1000 }] },
      ] },
      { id: 'direct', name: 'Lid: direct frame 0 to 2', repeat: 1, steps: [frame('slider', 2)] },
      { id: 'close', name: 'Close lid', repeat: 1, steps: [frame('slider', 0)] },
      { id: 'relative', name: 'Relative slide +1 cm', repeat: 1, steps: [{ type: 'joint', instance: 'slider', by: 0.01, durationMs: 500 }] },
    ] };
  const entries = { 'project.kea3d': Buffer.from(JSON.stringify(project, null, 2)), 'base.glb': base, 'carriage.glb': carriage };
  return { project, entries, package: Buffer.from(zipSync(entries)) };
}
