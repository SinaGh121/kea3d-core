import { Line, Mesh, Points, SkinnedMesh, Texture, type BufferGeometry, type Material, type Object3D } from 'three';

function disposeTexture(texture: Texture, disposed: Set<Texture>): void {
  if (disposed.has(texture)) return;
  disposed.add(texture);

  const sourceData: unknown = texture.source?.data;
  if (typeof ImageBitmap !== 'undefined' && sourceData instanceof ImageBitmap) {
    sourceData.close();
  }
  texture.dispose();
}

function disposeMaterial(material: Material, disposedTextures: Set<Texture>): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) disposeTexture(value, disposedTextures);
  }
  material.dispose();
}

export function disposeObject3D(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<SkinnedMesh['skeleton']>();

  root.traverse((object) => {
    if (object instanceof Mesh || object instanceof Line || object instanceof Points) {
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      objectMaterials.forEach((material) => materials.add(material));
    }
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => disposeMaterial(material, textures));
  skeletons.forEach((skeleton) => skeleton.dispose());
}
