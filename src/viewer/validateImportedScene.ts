import { Mesh, type BufferAttribute, type Object3D } from 'three';

function assertFiniteAttribute(attribute: BufferAttribute, label: string): void {
  for (let index = 0; index < attribute.count; index += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      if (!Number.isFinite(attribute.getComponent(index, component))) {
        throw new Error(`The model contains a non-finite ${label} value.`);
      }
    }
  }
}

function assertFiniteTransform(object: Object3D): void {
  const values = [
    object.position.x, object.position.y, object.position.z,
    object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w,
    object.scale.x, object.scale.y, object.scale.z,
  ];
  if (!values.every(Number.isFinite)) throw new Error('The model contains an invalid object transform.');
}

/** Validates the renderer-ready import boundary without mutating author data. */
export function validateImportedScene(scene: Object3D): void {
  let meshCount = 0;
  let triangleCount = 0;

  scene.traverse((object) => {
    assertFiniteTransform(object);
    if (!(object instanceof Mesh)) return;

    meshCount += 1;
    const position = object.geometry.getAttribute('position');
    if (!position || position.itemSize < 3 || position.count < 3) {
      throw new Error('The model contains a mesh without valid vertex positions.');
    }
    assertFiniteAttribute(position, 'vertex position');

    const normal = object.geometry.getAttribute('normal');
    if (normal) assertFiniteAttribute(normal, 'vertex normal');

    const index = object.geometry.getIndex();
    const elementCount = index ? index.count : position.count;
    if (elementCount % 3 !== 0) throw new Error('The model contains an incomplete triangle.');
    if (index) {
      for (let indexOffset = 0; indexOffset < index.count; indexOffset += 1) {
        const vertexIndex = index.getX(indexOffset);
        if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= position.count) {
          throw new Error('The model contains an invalid mesh index.');
        }
      }
    }
    triangleCount += elementCount / 3;
  });

  if (meshCount === 0 || triangleCount === 0) throw new Error('The model does not contain renderable triangle geometry.');
}
