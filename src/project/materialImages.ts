import { Mesh, MeshStandardMaterial, SRGBColorSpace, TextureLoader, type Object3D, type Texture } from 'three';
import type { Kea3dProjectDocument, Kea3dProjectInstance } from './projectFormat';

export function imageDimensions(bytes: ArrayBuffer): [number, number] {
  const v = new DataView(bytes);
  if (v.byteLength >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a && v.getUint32(12) === 0x49484452) return [v.getUint32(16), v.getUint32(20)];
  if (v.byteLength > 4 && v.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= v.byteLength) {
      if (v.getUint8(offset++) !== 255) break;
      while (offset < v.byteLength && v.getUint8(offset) === 255) offset++;
      if (offset + 3 > v.byteLength) break;
      const marker = v.getUint8(offset++), size = v.getUint16(offset);
      if (size < 2 || offset + size > v.byteLength) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) return [v.getUint16(offset + 5), v.getUint16(offset + 3)];
      if (marker === 0xda) break;
      offset += size;
    }
  }
  throw new Error('Project images must be valid PNG or supported JPEG files.');
}

export async function loadProjectImages(project: Kea3dProjectDocument, files: ReadonlyMap<string, File>, signal?: AbortSignal): Promise<Map<string, Texture>> {
  const images = new Map<string, Texture>();
  try {
    const ids = new Set(project.instances.flatMap(instance => (instance.materialImages ?? []).map(entry => entry.image)));
    let totalBytes = 0;
    let totalPixels = 0;
    for (const id of ids) {
      signal?.throwIfAborted();
      const file = files.get(id);
      if (!file) throw new Error(`Missing project image "${id}".`);
      totalBytes += file.size;
      if (file.size > 16 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) throw new Error('Project images exceed the image memory budget.');
      const [width, height] = imageDimensions(await file.arrayBuffer());
      totalPixels += width * height;
      if (!width || !height || width > 4096 || height > 4096 || totalPixels > 32 * 1024 * 1024) throw new Error('Project images exceed the decoded image budget (4096 per side, 32 megapixels total).');
      const url = URL.createObjectURL(file);
      try {
        const texture = await new TextureLoader().loadAsync(url);
        images.set(id, texture);
        if (texture.image.width > 4096 || texture.image.height > 4096) throw new Error('Project images must be at most 4096 pixels on each side.');
        texture.flipY = false;
        texture.colorSpace = SRGBColorSpace;
        signal?.throwIfAborted();
      } finally { URL.revokeObjectURL(url); }
    }
    return images;
  } catch (error) {
    images.forEach(texture => texture.dispose());
    throw error;
  }
}

export function applyMaterialImages(scene: Object3D, instance: Kea3dProjectInstance, images: ReadonlyMap<string, Texture>, validateOnly = false): void {
  // Validate every target before changing this instance. Material names are exact.
  const assignments: { mesh: Mesh; index: number; source: MeshStandardMaterial; image: Texture }[] = [];
  for (const entry of instance.materialImages ?? []) {
    const image = images.get(entry.image);
    if (!image) throw new Error(`Missing image "${entry.image}".`);
    const matches = new Set<MeshStandardMaterial>();
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material, index) => {
        if (material.name !== entry.material) return;
        if (!(material instanceof MeshStandardMaterial) || !object.geometry.getAttribute(material.map?.channel ? `uv${material.map.channel}` : 'uv')) throw new Error(`Material "${entry.material}" needs a PBR material and UV coordinates.`);
        matches.add(material);
        assignments.push({ mesh: object, index, source: material, image });
      });
    });
    if (matches.size !== 1) throw new Error(`Material "${entry.material}" is missing or ambiguous in instance "${instance.id}".`);
  }
  if (validateOnly) return;
  for (const { mesh, index, source, image } of assignments) {
    const material = source.clone();
    const texture = image.clone();
    if (source.map) {
      texture.wrapS = source.map.wrapS; texture.wrapT = source.map.wrapT;
      texture.offset.copy(source.map.offset); texture.repeat.copy(source.map.repeat);
      texture.center.copy(source.map.center); texture.rotation = source.map.rotation;
      texture.channel = source.map.channel;
    }
    texture.needsUpdate = true;
    material.map = texture;
    if (Array.isArray(mesh.material)) { mesh.material = [...mesh.material]; mesh.material[index] = material; }
    else mesh.material = material;
  }
}
