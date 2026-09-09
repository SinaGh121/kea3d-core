import { Group, MathUtils, Vector3, type Camera, type Matrix4, type Scene } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Kea3dJoint } from '../project/projectFormat';

// A proxy in the parent Anchor frame keeps arbitrary transforms out of the model.
export class JointDragControls {
  private readonly frame = new Group();
  private readonly proxy = new Group();
  private readonly control: TransformControls;
  private pointer: number | null = null;
  private angle = 0;
  private value: number;
  private readonly axis: Vector3;
  private readonly previousTabIndex: number;
  constructor(private readonly scene: Scene, private readonly canvas: HTMLCanvasElement,
    private readonly camera: () => Camera, private readonly getFrame: () => Matrix4, private readonly joint: Kea3dJoint,
    private readonly hitSelectedChild: (event: PointerEvent) => boolean,
    private readonly preview: (value: number) => void, private readonly commit: (value: number) => void,
    private readonly rollback: () => void, private readonly invalidate: () => void) {
    this.value = joint.state.position;
    this.previousTabIndex = canvas.tabIndex; canvas.tabIndex = 0;
    this.axis = new Vector3(joint.axis === 'x' ? 1 : 0, joint.axis === 'y' ? 1 : 0, joint.axis === 'z' ? 1 : 0);
    getFrame().decompose(this.frame.position, this.frame.quaternion, this.frame.scale);
    this.frame.add(this.proxy); scene.add(this.frame);
    this.control = new TransformControls(camera());
    this.control.setMode(joint.type === 'revolute' ? 'rotate' : 'translate');
    this.control.setSpace('local'); this.control.setSize(0.8);
    this.control.showX = joint.axis === 'x'; this.control.showY = joint.axis === 'y'; this.control.showZ = joint.axis === 'z';
    this.control.showXY = this.control.showXZ = this.control.showYZ = this.control.showXYZE = false;
    this.syncProxy(); this.control.attach(this.proxy); scene.add(this.control.getHelper());
    this.control.getHelper().visible = false;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(type, this.handle, true);
    window.addEventListener('keydown', this.key, true);
    window.addEventListener('blur', this.cancel);
    canvas.addEventListener('wheel', this.wheel, { capture: true, passive: false });
    invalidate();
  }
  private syncProxy() {
    this.proxy.position.set(0, 0, 0); this.proxy.quaternion.identity();
    if (this.joint.type === 'prismatic') this.proxy.position.copy(this.axis).multiplyScalar(this.value);
    else this.proxy.quaternion.setFromAxisAngle(this.axis, this.value);
    this.frame.updateMatrixWorld(true);
  }
  private normalized(event: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width * 2 - 1, y: -(event.clientY - r.top) / r.height * 2 + 1, button: event.type === 'pointermove' ? -1 : 0 } as unknown as PointerEvent;
  }
  private readonly handle = (event: PointerEvent) => {
    if (this.pointer === null) { this.getFrame().decompose(this.frame.position, this.frame.quaternion, this.frame.scale); this.syncProxy(); }
    this.control.camera = this.camera(); this.control.getHelper().updateMatrixWorld(true);
    const p = this.normalized(event);
    if (event.type === 'pointerdown' && event.button === 0 && this.pointer === null) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || !this.hitSelectedChild(event)) return;
      this.control.axis = this.joint.axis.toUpperCase() as 'X' | 'Y' | 'Z';
      this.control.getHelper().updateMatrixWorld(true);
      this.control.pointerDown(p);
      if (!this.control.dragging) return;
      this.canvas.focus({ preventScroll: true });
      this.pointer = event.pointerId;
      this.angle = this.value;
      this.canvas.setPointerCapture(event.pointerId);
    } else if (this.pointer === null) {
      if (event.type === 'pointermove') this.canvas.style.cursor = this.hitSelectedChild(event) ? 'grab' : '';
      return;
    } else if (this.pointer !== event.pointerId) { event.stopImmediatePropagation(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === 'pointermove') {
      this.control.pointerMove(p);
      let value = this.proxy.position[this.joint.axis];
      if (this.joint.type === 'revolute') {
        const q = this.proxy.quaternion;
        const raw = 2 * Math.atan2(q[this.joint.axis], q.w);
        value = raw + Math.round((this.angle - raw) / (2 * Math.PI)) * 2 * Math.PI;
        this.angle = value;
      }
      this.value = MathUtils.clamp(value, this.joint.limits.min, this.joint.limits.max);
      try { this.preview(this.value); } catch { this.cancel(); }
      this.syncProxy(); this.invalidate();
    } else if (event.type === 'pointerup') {
      this.finish(); this.commit(this.value);
    } else if (event.type === 'pointercancel' || event.type === 'lostpointercapture') this.cancel();
  };
  private finish() {
    const pointer = this.pointer; this.pointer = null;
    this.control.pointerUp({ button: 0 } as PointerEvent);
    if (pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
  }
  private readonly cancel = () => {
    if (this.pointer === null) return;
    this.finish(); this.value = this.joint.state.position; this.syncProxy(); this.rollback(); this.invalidate();
  };
  private readonly key = (event: KeyboardEvent) => {
    if (this.pointer !== null && (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z'))) {
      event.preventDefault(); event.stopImmediatePropagation(); this.cancel();
    }
  };
  private readonly wheel = (event: WheelEvent) => {
    if (this.pointer !== null) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  dispose() {
    this.cancel();
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const) this.canvas.removeEventListener(type, this.handle, true);
    window.removeEventListener('keydown', this.key, true); window.removeEventListener('blur', this.cancel);
    this.canvas.removeEventListener('wheel', this.wheel, true);
    this.canvas.tabIndex = this.previousTabIndex;
    this.canvas.style.cursor = '';
    this.scene.remove(this.frame, this.control.getHelper()); this.control.detach();
    // Events are managed above; this control was never connected to a DOM element.
    this.control.getHelper().dispose(); this.invalidate();
  }
}
