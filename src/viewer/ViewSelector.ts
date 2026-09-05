import {
  Box3,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
  type Raycaster,
} from 'three';
import type { ViewerTheme } from './types';

interface ViewTarget {
  activeAxes: number;
  direction: Vector3;
  fill: MeshBasicMaterial;
  hitMaterial: MeshBasicMaterial;
  hitMesh: Mesh;
  outline: LineBasicMaterial;
  restFillOpacity: number;
  restOutlineOpacity: number;
  visualMesh: Mesh;
}

interface ViewSelectorPanel {
  activeAxes: number;
  direction: Vector3;
  vertices: Vector3[];
}

export function createViewSelectorDirections(): Vector3[] {
  const directions: Vector3[] = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x === 0 && y === 0 && z === 0) continue;
        directions.push(new Vector3(x, y, z).normalize());
      }
    }
  }
  return directions;
}

function tangentFor(normal: Vector3): Vector3 {
  const reference = Math.abs(normal.y) > 0.85 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  return reference.cross(normal).normalize();
}

function sortPolygonVertices(vertices: Vector3[], normal: Vector3): Vector3[] {
  const center = vertices.reduce((sum, vertex) => sum.add(vertex), new Vector3()).multiplyScalar(1 / vertices.length);
  const tangent = tangentFor(normal);
  const bitangent = normal.clone().cross(tangent).normalize();
  return [...vertices].sort((left, right) => {
    const leftOffset = left.clone().sub(center);
    const rightOffset = right.clone().sub(center);
    return Math.atan2(leftOffset.dot(bitangent), leftOffset.dot(tangent))
      - Math.atan2(rightOffset.dot(bitangent), rightOffset.dot(tangent));
  });
}

function permutations(values: readonly number[]): number[][] {
  return [
    [values[0], values[1], values[2]],
    [values[0], values[2], values[1]],
    [values[1], values[0], values[2]],
    [values[1], values[2], values[0]],
    [values[2], values[0], values[1]],
    [values[2], values[1], values[0]],
  ];
}

export function createViewSelectorPanels(halfSize: number): ViewSelectorPanel[] {
  const outer = halfSize;
  const middle = halfSize * 0.78;
  const inner = halfSize * 0.58;

  return createViewSelectorDirections().map((direction) => {
    const signs = direction.toArray().map((value) => Math.abs(value) > 0.01 ? Math.sign(value) : 0);
    const activeAxes = signs.filter((value) => value !== 0).length;
    const vertices: Vector3[] = [];

    if (activeAxes === 1) {
      const normalAxis = signs.findIndex((value) => value !== 0);
      const tangentAxes = [0, 1, 2].filter((axis) => axis !== normalAxis);
      for (const swapped of [false, true]) {
        for (const firstSign of [-1, 1]) {
          for (const secondSign of [-1, 1]) {
            const vertex = new Vector3();
            vertex.setComponent(normalAxis, signs[normalAxis] * outer);
            vertex.setComponent(tangentAxes[0], firstSign * (swapped ? inner : middle));
            vertex.setComponent(tangentAxes[1], secondSign * (swapped ? middle : inner));
            vertices.push(vertex);
          }
        }
      }
    } else if (activeAxes === 2) {
      const active = [0, 1, 2].filter((axis) => signs[axis] !== 0);
      const freeAxis = signs.findIndex((value) => value === 0);
      for (const swapped of [false, true]) {
        for (const freeSign of [-1, 1]) {
          const vertex = new Vector3();
          vertex.setComponent(active[0], signs[active[0]] * (swapped ? middle : outer));
          vertex.setComponent(active[1], signs[active[1]] * (swapped ? outer : middle));
          vertex.setComponent(freeAxis, freeSign * inner);
          vertices.push(vertex);
        }
      }
    } else {
      permutations([outer, middle, inner]).forEach((coordinates) => {
        vertices.push(new Vector3(
          signs[0] * coordinates[0],
          signs[1] * coordinates[1],
          signs[2] * coordinates[2],
        ));
      });
    }

    return { activeAxes, direction, vertices: sortPolygonVertices(vertices, direction) };
  });
}

export class ViewSelector {
  readonly group = new Group();
  private readonly targets: ViewTarget[] = [];
  private hovered: ViewTarget | null = null;
  private openingStartedAt: number | null = null;
  private readonly primaryColor = new Color(0xc8ff63);
  private theme: ViewerTheme = 'dark';

  constructor() {
    this.group.name = 'Kea3D view selector';
    this.group.visible = false;
  }

  configure(object: Object3D): void {
    this.clearTargets();
    const bounds = new Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const extent = Math.max(size.x, size.y, size.z, 0.001);
    const half = extent * 1.48 / 2;
    this.group.position.copy(center);

    createViewSelectorPanels(half).forEach(({ activeAxes, direction, vertices }) => {
      const normal = direction.clone();
      const tangent = tangentFor(normal);
      const bitangent = normal.clone().cross(tangent).normalize();
      const panelCenter = vertices.reduce((sum, vertex) => sum.add(vertex), new Vector3()).multiplyScalar(1 / vertices.length);
      const localVertices = vertices.map((vertex) => {
        const offset = vertex.clone().sub(panelCenter);
        return new Vector3(offset.dot(tangent), offset.dot(bitangent), 0);
      });
      const visualGeometry = this.createPolygonGeometry(localVertices);
      const hitGeometry = visualGeometry.clone();
      const restFillOpacity = 0.055;
      const restOutlineOpacity = 0.5;
      const fill = new MeshBasicMaterial({
        color: this.baseColor(), depthTest: true, depthWrite: true,
        opacity: restFillOpacity, side: DoubleSide, toneMapped: false, transparent: true,
      });
      const outline = new LineBasicMaterial({
        color: this.primaryColor, depthTest: true, depthWrite: false,
        opacity: restOutlineOpacity, toneMapped: false, transparent: true,
      });
      const hitMaterial = new MeshBasicMaterial({ depthWrite: false, opacity: 0, side: DoubleSide, transparent: true });
      const hitMesh = new Mesh(hitGeometry, hitMaterial);
      hitMesh.name = `${activeAxes === 1 ? 'Standard' : activeAxes === 2 ? 'Diagonal' : 'Isometric'} view target`;
      hitMesh.position.copy(panelCenter);
      this.orientPlane(hitMesh, normal, tangent);
      hitMesh.renderOrder = 9_500 + activeAxes;
      hitMesh.userData.viewDirection = direction.clone();
      hitMesh.userData.viewTarget = true;

      const visualMesh = new Mesh(visualGeometry, fill);
      visualMesh.name = 'View cage region';
      visualMesh.renderOrder = hitMesh.renderOrder;
      const edges = new LineSegments(new EdgesGeometry(visualGeometry), outline);
      edges.name = 'View cage region outline';
      edges.position.z = extent * 0.001;
      edges.renderOrder = hitMesh.renderOrder + 1;
      visualMesh.add(edges);
      hitMesh.add(visualMesh);
      this.group.add(hitMesh);
      this.targets.push({ activeAxes, direction, fill, hitMaterial, hitMesh, outline, restFillOpacity, restOutlineOpacity, visualMesh });
    });
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (visible) {
      this.group.scale.setScalar(0.9);
      this.openingStartedAt = performance.now();
    } else {
      this.openingStartedAt = null;
      this.setHovered(null);
    }
  }

  isVisible(): boolean {
    return this.group.visible;
  }

  update(timestamp: number): boolean {
    if (this.openingStartedAt === null) return false;
    const progress = Math.min((timestamp - this.openingStartedAt) / 220, 1);
    const eased = 1 - (1 - progress) ** 3;
    this.group.scale.setScalar(0.9 + eased * 0.1);
    if (progress >= 1) this.openingStartedAt = null;
    return this.openingStartedAt !== null;
  }

  setTheme(theme: ViewerTheme): void {
    this.theme = theme;
    this.targets.forEach((target) => {
      if (target !== this.hovered) this.applyRestStyle(target);
    });
  }

  setAccentColor(color: string): void {
    this.primaryColor.set(color);
    this.targets.forEach((target) => {
      if (target === this.hovered) target.fill.color.copy(this.primaryColor);
      target.outline.color.copy(this.primaryColor);
    });
  }

  pick(raycaster: Raycaster): ViewTarget | null {
    if (!this.group.visible) return null;
    const hits = raycaster.intersectObjects(this.targets.map((target) => target.hitMesh), false);
    const candidates = hits
      .map((hit) => this.targets.find((target) => target.hitMesh === hit.object))
      .filter((target): target is ViewTarget => target !== undefined);
    return candidates.sort((a, b) => b.activeAxes - a.activeAxes)[0] ?? null;
  }

  hover(raycaster: Raycaster): boolean {
    const target = this.pick(raycaster);
    this.setHovered(target);
    return target !== null;
  }

  select(raycaster: Raycaster): Vector3 | null {
    return this.pick(raycaster)?.direction.clone() ?? null;
  }

  dispose(): void {
    this.clearTargets();
    this.group.removeFromParent();
  }

  private createPolygonGeometry(vertices: Vector3[]): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices.flatMap((vertex) => vertex.toArray()), 3));
    const indices: number[] = [];
    for (let index = 1; index < vertices.length - 1; index += 1) indices.push(0, index, index + 1);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private orientPlane(mesh: Mesh, normal: Vector3, tangent: Vector3): void {
    const xAxis = tangent.clone().normalize();
    const zAxis = normal.clone().normalize();
    const yAxis = zAxis.clone().cross(xAxis).normalize();
    mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zAxis));
  }

  private setHovered(target: ViewTarget | null): void {
    if (this.hovered === target) return;
    if (this.hovered) this.applyRestStyle(this.hovered);
    this.hovered = target;
    if (target) {
      target.fill.color.copy(this.primaryColor);
      target.fill.opacity = target.activeAxes === 1 ? 0.16 : target.activeAxes === 2 ? 0.24 : 0.34;
      target.outline.color.copy(this.primaryColor);
      target.outline.opacity = 0.95;
    }
  }

  private applyRestStyle(target: ViewTarget): void {
    target.fill.color.copy(this.baseColor());
    target.fill.opacity = target.restFillOpacity;
    target.outline.color.copy(this.primaryColor);
    target.outline.opacity = target.restOutlineOpacity;
    target.visualMesh.scale.setScalar(1);
  }

  private baseColor(): Color {
    return new Color(this.theme === 'dark' ? 0xdce5ee : 0x536273);
  }

  private clearTargets(): void {
    this.hovered = null;
    this.targets.forEach(({ hitMesh, fill, hitMaterial, outline, visualMesh }) => {
      this.group.remove(hitMesh);
      const edges = visualMesh.children[0] as LineSegments | undefined;
      edges?.geometry.dispose();
      visualMesh.geometry.dispose();
      hitMesh.geometry.dispose();
      fill.dispose();
      hitMaterial.dispose();
      outline.dispose();
    });
    this.targets.length = 0;
  }
}
