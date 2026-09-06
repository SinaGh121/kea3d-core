import { Mesh, type Intersection, type Object3D, type Raycaster } from 'three';

export function isEffectivelyVisible(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

export function pickVisibleMesh(raycaster: Raycaster, root: Object3D): Intersection | undefined {
  return raycaster.intersectObject(root, true).find((hit) => {
    if (!(hit.object instanceof Mesh) || !isEffectivelyVisible(hit.object)) return false;
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[hit.face?.materialIndex ?? 0]
      : hit.object.material;
    if (!material?.visible) return false;
    const planes = material.clippingPlanes;
    if (!planes?.length) return true;
    const outside = (plane: (typeof planes)[number]) => plane.distanceToPoint(hit.point) < 0;
    return !(material.clipIntersection ? planes.every(outside) : planes.some(outside));
  });
}

export function pickAnchorMarker(raycaster: Raycaster, markers: ReadonlyMap<Object3D, Object3D>): Object3D | undefined {
  const previousThreshold = raycaster.params.Line.threshold;
  let nearest: Intersection | undefined;
  let selected: Object3D | undefined;
  try {
    for (const [source, marker] of markers) {
      if (!isEffectivelyVisible(source) || !isEffectivelyVisible(marker)) continue;
      // Children are scaled directly so Three.js Line.raycast uses the same scale.
      // The displayed axis is 24 CSS pixels long; allow 6 pixels of line tolerance.
      raycaster.params.Line.threshold = (marker.children[0]?.scale.x ?? 0) / 4;
      marker.updateWorldMatrix(true, true);
      const hit = raycaster.intersectObject(marker, true).find((candidate) => isEffectivelyVisible(candidate.object));
      if (hit && (!nearest || hit.distance < nearest.distance)) {
        nearest = hit;
        selected = source;
      }
    }
    return selected;
  } finally {
    raycaster.params.Line.threshold = previousThreshold;
  }
}
