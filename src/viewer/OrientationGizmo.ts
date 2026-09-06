import {
  CanvasTexture,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Quaternion,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
} from 'three';
import type { ViewerTheme } from './types';

interface AxisEnd {
  color: string;
  direction: Vector3;
  label?: string;
  sprite: Sprite;
  texture: CanvasTexture;
}

const axes = [
  { positive: new Vector3(1, 0, 0), negative: new Vector3(-1, 0, 0), color: '#ff4d73', dark: '#b82f51', label: 'X' },
  { positive: new Vector3(0, 1, 0), negative: new Vector3(0, -1, 0), color: '#69dd8a', dark: '#3f9c61', label: 'Y' },
  { positive: new Vector3(0, 0, 1), negative: new Vector3(0, 0, -1), color: '#4d7cff', dark: '#3555b2', label: 'Z' },
];

export class OrientationGizmo {
  private readonly renderer = new WebGLRenderer({ alpha: true, antialias: true });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1.65, 1.65, 1.65, -1.65, 0.1, 20);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly lines: Mesh[] = [];
  private readonly ends: AxisEnd[] = [];
  private activePointerId: number | null = null;
  private readonly lastPointer = new Vector2();
  private dragDistance = 0;
  private visible = false;
  private theme: ViewerTheme = 'dark';
  private renderWidth = 0;
  private renderHeight = 0;

  constructor(
    container: HTMLElement,
    private readonly onDirectionSelected: (direction: Vector3) => void,
    private readonly onOrbit: (deltaX: number, deltaY: number) => void,
  ) {
    const canvas = this.renderer.domElement;
    canvas.className = 'absolute right-5 bottom-3 z-20 h-[120px] w-[120px] cursor-grab touch-none bg-transparent max-md:right-1 max-md:bottom-14 max-md:h-[96px] max-md:w-[96px]';
    canvas.setAttribute('aria-label', 'XYZ camera orientation control');
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('tabindex', '0');
    canvas.title = 'Drag to orbit or click an axis to change view';
    canvas.hidden = true;
    container.appendChild(canvas);

    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(120, 120, false);

    for (const axis of axes) {
      this.addAxisLine(axis.positive, axis.color, 1);
      this.addAxisLine(axis.negative, axis.dark, 0.72);
      this.ends.push(this.addAxisEnd(axis.positive, axis.color, axis.label), this.addAxisEnd(axis.negative, axis.dark));
    }

    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('keydown', this.handleKeyDown);
  }

  render(mainCamera: Camera, target: Vector3): void {
    if (!this.visible) return;
    const width = Math.max(this.renderer.domElement.clientWidth, 1);
    const height = Math.max(this.renderer.domElement.clientHeight, 1);
    if (width !== this.renderWidth || height !== this.renderHeight) {
      this.renderWidth = width;
      this.renderHeight = height;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(width, height, false);
    }
    const direction = mainCamera.position.clone().sub(target).normalize();
    this.camera.position.copy(direction).multiplyScalar(4);
    this.camera.up.copy(mainCamera.up);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  setTheme(theme: ViewerTheme): void {
    this.theme = theme;
    this.ends.forEach((end) => this.drawEnd(end));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.renderer.domElement.hidden = !visible;
  }

  dispose(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    canvas.removeEventListener('keydown', this.handleKeyDown);
    this.lines.forEach((line) => {
      line.geometry.dispose();
      (line.material as MeshBasicMaterial).dispose();
    });
    this.ends.forEach(({ sprite, texture }) => {
      sprite.material.dispose();
      texture.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
  }

  private addAxisLine(direction: Vector3, color: string, opacity: number): void {
    const length = 0.94;
    const geometry = new CylinderGeometry(0.058, 0.058, length, 12);
    const material = new MeshBasicMaterial({ color, transparent: true, opacity });
    const line = new Mesh(geometry, material);
    line.position.copy(direction).multiplyScalar(length / 2);
    line.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction));
    this.lines.push(line);
    this.scene.add(line);
  }

  private addAxisEnd(direction: Vector3, color: string, label?: string): AxisEnd {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.position.copy(direction).multiplyScalar(1.04);
    sprite.scale.setScalar(label ? 0.7 : 0.55);
    sprite.userData.direction = direction.clone();
    const end = { color, direction, label, sprite, texture };
    this.drawEnd(end);
    this.scene.add(sprite);
    return end;
  }

  private drawEnd(end: AxisEnd): void {
    const canvas = end.texture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 128, 128);
    context.beginPath();
    context.arc(64, 64, end.label ? 53 : 44, 0, Math.PI * 2);
    context.fillStyle = end.color;
    context.fill();
    if (end.label) {
      context.font = '700 50px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = this.theme === 'dark' ? '#111318' : '#ffffff';
      context.fillText(end.label, 64, 66);
    }
    end.texture.needsUpdate = true;
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) {
      const deltaX = event.clientX - this.lastPointer.x;
      const deltaY = event.clientY - this.lastPointer.y;
      this.lastPointer.set(event.clientX, event.clientY);
      this.dragDistance += Math.hypot(deltaX, deltaY);
      if (this.dragDistance >= 4) this.onOrbit(deltaX, deltaY);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.renderer.domElement.style.cursor = this.pick(event) ? 'pointer' : 'grab';
  };

  private readonly handlePointerLeave = (): void => {
    if (this.activePointerId === null) this.renderer.domElement.style.cursor = 'grab';
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.activePointerId = event.pointerId;
    this.lastPointer.set(event.clientX, event.clientY);
    this.dragDistance = 0;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.dragDistance < 4) {
      const hit = this.pick(event);
      const direction = hit?.object.userData.direction as Vector3 | undefined;
      if (direction) this.onDirectionSelected(direction.clone());
    }
    this.finishPointerInteraction(event.pointerId);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) this.finishPointerInteraction(event.pointerId);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const direction = {
      ArrowLeft: new Vector3(-1, 0, 0), ArrowRight: new Vector3(1, 0, 0),
      ArrowUp: new Vector3(0, 1, 0), ArrowDown: new Vector3(0, -1, 0),
      Enter: new Vector3(1, 1, 1).normalize(), ' ': new Vector3(1, 1, 1).normalize(),
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    this.onDirectionSelected(direction);
  };

  private pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.ends.map((end) => end.sprite), false)[0];
  }

  private finishPointerInteraction(pointerId: number): void {
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    this.activePointerId = null;
    this.dragDistance = 0;
    canvas.style.cursor = 'grab';
  }
}
