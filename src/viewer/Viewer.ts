import {
  AnimationMixer,
  AxesHelper,
  BackSide,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Euler,
  GridHelper,
  Group,
  HemisphereLight,
  MathUtils,
  NeutralToneMapping,
  OrthographicCamera,
  PMREMGenerator,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  LoopOnce,
  LoopRepeat,
  Line,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  Raycaster,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  type Material,
  type Plane,
  type Texture,
  type Object3D,
  type AnimationClip,
  type AnimationAction,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { disposeObject3D } from './disposeObject';
import { loadModelFiles } from './loadModelFiles';
import { analyzeModel, analyzeSelections } from './modelAnalysis';
import { OrientationGizmo } from './OrientationGizmo';
import { ViewSelector } from './ViewSelector';
import { buildSceneTree } from './sceneTree';
import { isEffectivelyVisible, pickAnchorMarker, pickVisibleMesh } from './picking';
import { defaultForwardAxis, isForwardAxisCompatible, orientationCorrection } from './modelAdjustments';
import { unitToMeters } from './linearUnits';
import { sectionPlaneForBounds } from './sectionPlane';
import { throwIfLoadCancelled } from './loadControl';
import { validateImportedScene } from './validateImportedScene';
import { defaultMaterialPresetOptions, findMaterialPreset, type MaterialPreset, type MaterialPresetOptions } from './materialPresets';
import { CommandHistory, type ReversibleCommand } from '../commandHistory';
import { applyAnchorEdit, anchorIdForObject, discoverComponentAnchorDetails, promoteLegacyNamedAnchors, validateAnchorEditInput, type AnchorEditInput, type ComponentAnchor } from '@/project/componentAnchors';
import type { AnchorInfo, AnimationPlaybackState, CameraProjection, CameraState, CameraView, DisplayMode, ForwardAxis, LightingSettings, LinearUnit, LoadedModel, LoadProgress, MaterialApplyScope, MaterialEditState, MeasurementState, RendererInfoSnapshot, RotationMode, SceneNode, SelectionInfo, UpAxis, ViewerTheme, ViewportBackground } from './types';

const viewDirections: Record<CameraView, Vector3> = {
  // Canonical Kea3D preview direction. Keep the native thumbnail-provider basis
  // synchronized so Explorer previews match the initial in-app view.
  iso: new Vector3(-1, 0.72, 1),
  front: new Vector3(0, 0, 1),
  top: new Vector3(0, 1, 0.0001),
};

const maxEdgeTriangles = 500_000;
const maxSelectionOutlineTriangles = 250_000;
const perspectiveFitMargin = 1.04;
const orthographicFitHeight = 2.08;
const selectionOutlineWidth = 3;
const commandHistoryLimit = 20;

type MeshMaterial = Material | Material[];
type MaterialSnapshot = Map<Mesh, MeshMaterial>;

interface MaterialChange {
  before: MaterialSnapshot;
  after: MaterialSnapshot;
}

interface MaterialTarget {
  mesh: Mesh;
  materialIndices: number[] | null;
}

const selectionOutlineVertexShader = /* glsl */ `
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  #include <clipping_planes_pars_vertex>

  uniform float outlineWidth;
  uniform vec2 outlineResolution;

  void main() {
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <project_vertex>

    vec3 outlineNormal = -objectNormal;
    vec4 outlinePosition = projectionMatrix * modelViewMatrix * vec4(transformed + outlineNormal, 1.0);
    vec2 currentNdc = gl_Position.xy / gl_Position.w;
    vec2 outlineNdc = outlinePosition.xy / outlinePosition.w;
    vec2 pixelDelta = (currentNdc - outlineNdc) * outlineResolution;
    float pixelDeltaLength = length(pixelDelta);
    if (pixelDeltaLength > 0.000001) {
      vec2 pixelDirection = pixelDelta / pixelDeltaLength;
      gl_Position.xy += pixelDirection * outlineWidth * 2.0 / outlineResolution * gl_Position.w;
    }

    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>
  }
`;

const selectionOutlineFragmentShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  #include <clipping_planes_pars_fragment>

  uniform vec3 outlineColor;
  uniform float outlineOpacity;

  void main() {
    #include <clipping_planes_fragment>
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(outlineColor, outlineOpacity);
    #include <colorspace_fragment>
  }
`;

export class Viewer {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly perspectiveCamera = new PerspectiveCamera(45, 1, 0.01, 10_000);
  private readonly orthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10_000);
  private camera: PerspectiveCamera | OrthographicCamera = this.perspectiveCamera;
  private projection: CameraProjection = 'perspective';
  private orthographicHeight = 2;
  private readonly orbitControls: OrbitControls;
  private readonly trackballControls: TrackballControls;
  private controls: OrbitControls | TrackballControls;
  private rotationMode: RotationMode = 'fixed-up';
  private readonly orientationGizmo: OrientationGizmo;
  private readonly viewSelector = new ViewSelector();
  private readonly accentColor = new Color(0xc8ff63);
  private readonly selectionOutlineResolution = new Vector2(1, 1);
  private readonly modelRoot = new Group();
  private readonly measurementGroup = new Group();
  private readonly anchorGroup = new Group();
  private readonly grid = new GridHelper(10, 10, 0x59606a, 0x30343a);
  private readonly resizeObserver: ResizeObserver;
  private environmentScene: RoomEnvironment | null = null;
  private environmentTexture: Texture | null = null;
  private readonly hemisphereLight = new HemisphereLight();
  private readonly keyLight = new DirectionalLight();
  private readonly fillLight = new DirectionalLight();
  private lighting: LightingSettings = {
    preset: 'neutral', exposure: 1, environmentIntensity: 1, backgroundVisible: false, shadows: false,
  };
  private currentModel: Object3D | null = null;
  private progressivePreview: { scene: Object3D; container: Group } | null = null;
  private currentAnimations: AnimationClip[] = [];
  private animationMixer: AnimationMixer | null = null;
  private animationAction: AnimationAction | null = null;
  private animationPlaying = false;
  private animationLoop = true;
  private animationNotifyElapsed = 0;
  private animationFrame: number | null = null;
  private lastFrameTimestamp = 0;
  private basePosition = new Vector3();
  private baseQuaternion = new Quaternion();
  private baseScale = new Vector3(1, 1, 1);
  private initialSourceUnit: LinearUnit = 'm';
  private initialUpAxis: UpAxis = 'y';
  private initialForwardAxis: ForwardAxis = 'z';
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly objectById = new Map<string, Object3D>();
  private isolationVisibility: Map<Object3D, boolean> | null = null;
  private readonly originalPositions = new Map<string, Vector3>();
  private readonly explodeOffsets = new Map<string, Vector3>();
  private readonly originalMaterials = new Map<Mesh, MeshMaterial>();
  private readonly ownedMaterialOverrides = new Set<Material>();
  private readonly commandHistory = new CommandHistory(commandHistoryLimit);
  private materialPreview: MaterialChange | null = null;
  private selectedObjects: Object3D[] = [];
  private currentAnchors: ComponentAnchor[] = [];
  private readonly anchorByObjectId = new Map<string, ComponentAnchor>();
  private readonly anchorMarkers = new Map<Object3D, Group>();
  private currentSceneTree: SceneNode[] = [];
  private anchorsVisible = true;
  private readonly selectionOverlays = new Map<Mesh, {
    group: Group;
    fillMaterial: MeshBasicMaterial;
    outlineMaterial: ShaderMaterial | null;
  }>();
  private controlsInteracting = false;
  private pointerStart: { id: number; x: number; y: number; time: number; pointerType: string } | null = null;
  private measurementEnabled = false;
  private readonly measurementPoints: Vector3[] = [];
  private readonly measurementMarkers: Mesh[] = [];
  private measurementLine: Line | null = null;
  private currentDirection = viewDirections.iso.clone().normalize();
  private gridRequested = false;
  private displayMode: DisplayMode = 'solid';
  private viewerTheme: ViewerTheme = 'dark';
  private viewportBackground: ViewportBackground = 'adaptive';
  private readonly edgeHelpers = new Map<Mesh, LineSegments>();
  private readonly originalClippingPlanes = new Map<Material, Plane[] | null>();
  private sectionEnabled = false;
  private sectionAxis: UpAxis = 'x';
  private sectionPosition = 0.5;
  private sectionFlipped = false;
  private sectionPlane: Plane | null = null;
  private explodeFactor = 0;
  private cameraChangeTimer: number | null = null;
  private cameraTransition: {
    startTime: number | null;
    startPosition: Vector3;
    startUp: Vector3;
    endPosition: Vector3;
    endUp: Vector3;
  } | null = null;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelectionChange: (objectIds: string[], info: SelectionInfo | null) => void = () => undefined,
    private readonly onAnimationChange: (state: AnimationPlaybackState) => void = () => undefined,
    private readonly onMeasurementChange: (state: MeasurementState) => void = () => undefined,
    private readonly onCameraChange: (state: CameraState) => void = () => undefined,
    private readonly onViewSelectorChange: (visible: boolean) => void = () => undefined,
  ) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.className = 'absolute inset-0 block h-full w-full touch-none';
    this.renderer.domElement.setAttribute('aria-label', '3D model viewport');
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel);

    this.scene.add(this.modelRoot, this.grid, this.measurementGroup, this.anchorGroup, this.viewSelector.group);
    this.grid.visible = false;
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.34;
      material.depthWrite = false;
    });
    this.scene.add(this.hemisphereLight, this.keyLight, this.keyLight.target, this.fillLight);
    this.keyLight.shadow.mapSize.set(1_024, 1_024);
    this.keyLight.shadow.bias = -0.0001;

    this.environmentScene = new RoomEnvironment();
    const pmrem = new PMREMGenerator(this.renderer);
    this.environmentTexture = pmrem.fromScene(this.environmentScene).texture;
    this.scene.environment = this.environmentTexture;
    pmrem.dispose();
    this.applyLighting();

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.075;
    this.orbitControls.zoomToCursor = true;
    this.orbitControls.screenSpacePanning = true;
    this.trackballControls = new TrackballControls(this.camera, this.renderer.domElement);
    this.trackballControls.staticMoving = true;
    this.trackballControls.rotateSpeed = 2.2;
    this.trackballControls.zoomSpeed = 1.1;
    this.trackballControls.panSpeed = 0.3;
    this.trackballControls.enabled = false;
    this.controls = this.orbitControls;
    this.orbitControls.addEventListener('change', this.handleCameraChange);
    this.trackballControls.addEventListener('change', this.handleCameraChange);
    this.orbitControls.addEventListener('start', this.handleControlsStart);
    this.trackballControls.addEventListener('start', this.handleControlsStart);
    this.orbitControls.addEventListener('end', this.handleControlsEnd);
    this.trackballControls.addEventListener('end', this.handleControlsEnd);
    this.orientationGizmo = new OrientationGizmo(
      container,
      (direction) => this.frameDirection(direction),
      (deltaX, deltaY) => this.orbitFromGizmo(deltaX, deltaY),
    );

    this.setTheme('dark');
    this.camera.position.set(3, 2.2, 3);
    this.controls.update();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.resize();
    this.invalidate();
  }

  async loadFiles(
    files: readonly File[],
    onProgress: (progress: LoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<LoadedModel> {
    const loaded = await loadModelFiles(files, onProgress, this.renderer, signal);
    const { scene, animations, mainFile, totalSize, sourceUnit, upAxis } = loaded;
    const isProgressivePreview = this.progressivePreview?.scene === scene;
    let anchors: ComponentAnchor[];
    try {
      throwIfLoadCancelled(signal);
      validateImportedScene(scene);
      promoteLegacyNamedAnchors(scene, { allowInheritedScale: true });
      // A resolved assembly may contain reusable instances of one component, so
      // the same resource-local Anchor ID can legitimately appear more than once.
      anchors = discoverComponentAnchorDetails(scene, mainFile.name, { allowDuplicateIds: true, allowInheritedScale: true });
    } catch (error) {
      if (isProgressivePreview) this.discardProgressivePreview(scene);
      else disposeObject3D(scene);
      throw error;
    }
    onProgress({ stage: 'preparing' });

    if (isProgressivePreview) this.releaseProgressivePreview(scene);
    this.clearModel();
    this.currentModel = scene;
    this.currentAnimations = animations;
    this.initialSourceUnit = sourceUnit;
    this.initialUpAxis = upAxis;
    this.initialForwardAxis = defaultForwardAxis(upAxis);
    this.basePosition.copy(scene.position);
    this.baseQuaternion.copy(scene.quaternion);
    this.baseScale.copy(scene.scale);
    scene.scale.copy(this.baseScale).multiplyScalar(unitToMeters[sourceUnit]);
    scene.quaternion.copy(orientationCorrection(upAxis, this.initialForwardAxis).multiply(this.baseQuaternion));
    this.prepareAnimations();
    this.modelRoot.add(scene);
    const sceneTree = buildSceneTree(scene, this.objectById);
    this.currentSceneTree = sceneTree;
    this.prepareAnchors(anchors);
    this.prepareInspectionTools();
    this.applyLighting();
    this.orientationGizmo.setVisible(true);
    this.configureGrid();
    this.applyDisplayMode();
    const info = analyzeModel(scene, mainFile.name, totalSize);
    this.fit('iso');
    await this.renderer.compileAsync(this.scene, this.camera);
    if (signal?.aborted) {
      this.clearModel();
      throwIfLoadCancelled(signal);
    }
    return {
      info,
      sceneTree,
      animations: this.currentAnimations.map((clip, index) => ({
        name: clip.name.trim() || `Animation ${index + 1}`,
        duration: clip.duration,
      })),
      initialSourceUnit: sourceUnit,
      initialUpAxis: upAxis,
      initialForwardAxis: this.initialForwardAxis,
      anchors: this.currentAnchors.map((anchor) => this.anchorInfo(anchor)),
      project: loaded.project,
    };
  }

  showProgressivePreview(scene: Object3D, sourceUnit: LinearUnit, upAxis: UpAxis): void {
    if (this.disposed || this.progressivePreview?.scene === scene) return;
    this.discardProgressivePreview();
    const container = new Group();
    container.name = `${scene.name || 'CAD model'} preview`;
    container.scale.setScalar(unitToMeters[sourceUnit]);
    container.quaternion.copy(orientationCorrection(upAxis, defaultForwardAxis(upAxis)));
    container.add(scene);
    this.progressivePreview = { scene, container };
    if (this.currentModel) this.currentModel.visible = false;
    this.modelRoot.add(container);
    this.orientationGizmo.setVisible(true);
    this.frameDirection(viewDirections.iso, container);
    this.invalidate();
  }

  updateProgressivePreview(scene: Object3D): void {
    if (this.progressivePreview?.scene !== scene) return;
    this.invalidate();
  }

  discardProgressivePreview(scene?: Object3D): void {
    const preview = this.progressivePreview;
    if (!preview || (scene && preview.scene !== scene)) return;
    preview.container.remove(preview.scene);
    this.modelRoot.remove(preview.container);
    disposeObject3D(preview.scene);
    this.progressivePreview = null;
    if (this.currentModel) this.currentModel.visible = true;
    this.orientationGizmo.setVisible(this.currentModel !== null);
    this.invalidate();
  }

  private releaseProgressivePreview(scene: Object3D): void {
    const preview = this.progressivePreview;
    if (!preview || preview.scene !== scene) return;
    preview.container.remove(scene);
    this.modelRoot.remove(preview.container);
    this.progressivePreview = null;
    if (this.currentModel) this.currentModel.visible = true;
  }

  setAnchorsVisible(visible: boolean): void {
    this.anchorsVisible = visible;
    this.anchorGroup.visible = visible && this.currentAnchors.length > 0;
    this.invalidate();
  }

  getRendererInfo(): RendererInfoSnapshot {
    return {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  getSceneDocumentState(): { sceneTree: SceneNode[]; anchors: AnchorInfo[] } {
    return {
      sceneTree: this.currentSceneTree,
      anchors: this.currentAnchors.map((anchor) => this.anchorInfo(anchor)),
    };
  }

  createAnchor(): string {
    if (!this.currentModel) throw new Error('Open a model before creating an Anchor.');
    const ids = new Set(this.currentAnchors.map((anchor) => anchor.id));
    let index = 1;
    let id = 'anchor';
    while (ids.has(id)) id = `anchor-${++index}`;
    const name = index === 1 ? 'Anchor' : `Anchor ${index}`;
    const object = new Group();
    const boundsTarget = this.selectedObjects.some((selected) => !this.anchorByObjectId.has(selected.uuid))
      ? this.selectedObjects.filter((selected) => !this.anchorByObjectId.has(selected.uuid))
      : [this.currentModel];
    const bounds = new Box3();
    boundsTarget.forEach((selected) => bounds.expandByObject(selected));
    const worldCenter = bounds.isEmpty() ? this.currentModel.getWorldPosition(new Vector3()) : bounds.getCenter(new Vector3());
    const localCenter = this.currentModel.worldToLocal(worldCenter.clone());
    const input: AnchorEditInput = { id, name, position: localCenter.toArray(), rotation: [0, 0, 0] };
    applyAnchorEdit(object, input);
    const parent = this.currentModel;
    this.commandHistory.execute({
      label: 'Create Anchor',
      apply: () => {
        parent.add(object);
        this.refreshAnchorDocument([object.uuid]);
      },
      revert: () => {
        parent.remove(object);
        this.refreshAnchorDocument([]);
      },
    });
    return object.uuid;
  }

  updateAnchor(objectId: string, input: AnchorEditInput): void {
    const anchor = this.anchorByObjectId.get(objectId);
    if (!anchor) throw new Error('Select an Anchor before editing it.');
    const object = anchor.object;
    const before = this.anchorEditInput(object, anchor.id);
    const after = validateAnchorEditInput(input, this.currentAnchors.filter((candidate) => candidate.object !== object).map((candidate) => candidate.id));
    this.commandHistory.execute({
      label: 'Edit Anchor',
      apply: () => {
        applyAnchorEdit(object, after);
        this.refreshAnchorDocument([object.uuid]);
      },
      revert: () => {
        applyAnchorEdit(object, before);
        this.refreshAnchorDocument([object.uuid]);
      },
    });
  }

  deleteAnchor(objectId: string): void {
    const anchor = this.anchorByObjectId.get(objectId);
    const object = anchor?.object;
    const parent = object?.parent;
    if (!object || !parent) throw new Error('Select an Anchor before deleting it.');
    const childIndex = parent.children.indexOf(object);
    this.commandHistory.execute({
      label: 'Delete Anchor',
      apply: () => {
        parent.remove(object);
        this.refreshAnchorDocument([]);
      },
      revert: () => {
        parent.add(object);
        const appendedIndex = parent.children.indexOf(object);
        if (childIndex >= 0 && appendedIndex >= 0 && childIndex !== appendedIndex) {
          parent.children.splice(appendedIndex, 1);
          parent.children.splice(childIndex, 0, object);
        }
        this.refreshAnchorDocument([object.uuid]);
      },
    });
  }

  fit(view?: CameraView): void {
    if (!this.currentModel) return;
    if (view) {
      this.frameDirection(viewDirections[view]);
      return;
    }
    const visibleDirection = this.camera.position.clone().sub(this.controls.target).normalize();
    this.frameDirection(visibleDirection, this.currentModel, true);
  }

  private frameDirection(
    direction: Vector3,
    object: Object3D | null = this.currentModel,
    preserveCameraUp = false,
  ): void {
    if (!object) return;
    this.currentDirection.copy(direction).normalize();
    const bounds = new Box3().setFromObject(object);
    this.frameBounds(direction, bounds, preserveCameraUp);
  }

  private frameBounds(direction: Vector3, bounds: Box3, preserveCameraUp = false): void {
    if (bounds.isEmpty()) return;
    this.currentDirection.copy(direction).normalize();

    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const radius = Math.max(size.length() / 2, 0.001);
    const aspect = this.container.clientWidth / Math.max(this.container.clientHeight, 1);
    const verticalFov = MathUtils.degToRad(this.perspectiveCamera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    // Keep the complete model visible while using the viewport more fully.
    const distance = (radius / Math.sin(limitingFov / 2)) * perspectiveFitMargin;
    this.camera.position.copy(center).addScaledVector(this.currentDirection, distance);
    this.camera.near = Math.max(radius / 2_000, 0.0001);
    this.camera.far = Math.max(distance + radius * 20, 100);
    if (!preserveCameraUp) {
      this.camera.up.set(
        0,
        Math.abs(this.currentDirection.y) > 0.98 ? 0 : 1,
        Math.abs(this.currentDirection.y) > 0.98 ? -Math.sign(this.currentDirection.y) : 0,
      );
    }
    if (this.camera === this.orthographicCamera) {
      this.orthographicHeight = radius * orthographicFitHeight;
      this.orthographicCamera.zoom = 1;
      this.updateOrthographicFrustum(aspect);
    }
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.02;
    this.controls.maxDistance = radius * 200;
    this.controls.update();
  }

  private snapToDirection(direction: Vector3): void {
    if (!this.currentModel) return;
    const startPosition = this.camera.position.clone();
    const startUp = this.camera.up.clone();
    this.frameDirection(direction);
    const endPosition = this.camera.position.clone();
    const endUp = this.camera.up.clone();
    this.camera.position.copy(startPosition);
    this.camera.up.copy(startUp);
    this.camera.lookAt(this.controls.target);
    this.cameraTransition = {
      startTime: null,
      startPosition,
      startUp,
      endPosition,
      endUp,
    };
    this.invalidate();
  }

  private orbitFromGizmo(deltaX: number, deltaY: number): void {
    const radiansPerPixel = Math.PI / 180;
    if (this.controls === this.orbitControls) {
      this.orbitControls.rotateLeft(deltaX * radiansPerPixel);
      this.orbitControls.rotateUp(deltaY * radiansPerPixel);
    } else {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const yaw = new Quaternion().setFromAxisAngle(this.camera.up.clone().normalize(), -deltaX * radiansPerPixel);
      offset.applyQuaternion(yaw);
      this.camera.up.applyQuaternion(yaw);
      const viewDirection = offset.clone().negate().normalize();
      const right = viewDirection.cross(this.camera.up).normalize();
      if (right.lengthSq() > 0.0001) {
        const pitch = new Quaternion().setFromAxisAngle(right, -deltaY * radiansPerPixel);
        offset.applyQuaternion(pitch);
        this.camera.up.applyQuaternion(pitch).normalize();
      }
      this.camera.position.copy(this.controls.target).add(offset);
      this.camera.lookAt(this.controls.target);
    }
    this.controls.update();
    this.currentDirection.copy(this.camera.position).sub(this.controls.target).normalize();
  }

  setView(view: CameraView): void {
    this.fit(view);
  }

  setViewSelectorVisible(visible: boolean): boolean {
    const next = visible && this.currentModel !== null;
    if (next && this.currentModel) this.viewSelector.configure(this.currentModel);
    this.viewSelector.setVisible(next);
    this.onViewSelectorChange(next);
    this.renderer.domElement.style.cursor = '';
    this.invalidate();
    return next;
  }

  fitSelection(): void {
    const visibleDirection = this.camera.position.clone().sub(this.controls.target).normalize();
    if (this.selectedObjects.length === 0) {
      this.frameDirection(visibleDirection, this.currentModel, true);
      return;
    }
    this.frameBounds(visibleDirection, this.selectionBounds(), true);
  }

  zoomIn(): void {
    if (this.controls === this.orbitControls) this.orbitControls.dollyIn(1.25);
    else this.zoomFreeControls(1.25);
    this.controls.update();
  }

  zoomOut(): void {
    if (this.controls === this.orbitControls) this.orbitControls.dollyOut(1.25);
    else this.zoomFreeControls(1 / 1.25);
    this.controls.update();
  }

  private zoomFreeControls(scale: number): void {
    if (this.camera === this.orthographicCamera) {
      this.orthographicCamera.zoom = Math.max(0.01, this.orthographicCamera.zoom * scale);
      this.orthographicCamera.updateProjectionMatrix();
      return;
    }
    const offset = this.camera.position.clone().sub(this.controls.target).divideScalar(scale);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  setRotationMode(mode: RotationMode): void {
    if (this.rotationMode === mode) return;
    const previous = this.controls;
    const target = previous.target.clone();
    previous.enabled = false;
    this.controls = mode === 'fixed-up' ? this.orbitControls : this.trackballControls;
    this.controls.object = this.camera;
    this.controls.target.copy(target);
    if (mode === 'fixed-up') {
      const direction = this.camera.position.clone().sub(target).normalize();
      this.camera.up.set(0, Math.abs(direction.y) > 0.98 ? 0 : 1, Math.abs(direction.y) > 0.98 ? -Math.sign(direction.y) : 0);
      this.camera.lookAt(target);
    }
    this.rotationMode = mode;
    this.controls.enabled = true;
    if (this.controls === this.trackballControls) this.trackballControls.handleResize();
    this.controls.update();
    this.invalidate();
  }

  getCameraState(): CameraState | null {
    if (!this.currentModel) return null;
    const bounds = new Box3().setFromObject(this.currentModel);
    if (bounds.isEmpty()) return null;
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.001);
    const normalized = (value: Vector3): [number, number, number] => value.clone().sub(center).divideScalar(radius).toArray();
    return {
      position: normalized(this.camera.position),
      target: normalized(this.controls.target),
      up: this.camera.up.toArray(),
      projection: this.projection,
      ...(this.projection === 'orthographic'
        ? { orthographicHeight: this.orthographicHeight / this.orthographicCamera.zoom / radius }
        : {}),
    };
  }

  setCameraState(state: CameraState): void {
    if (!this.currentModel) return;
    const bounds = new Box3().setFromObject(this.currentModel);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.001);
    const denormalize = (value: [number, number, number]) => new Vector3(...value).multiplyScalar(radius).add(center);

    this.setProjection(state.projection);
    this.camera.position.copy(denormalize(state.position));
    this.controls.target.copy(denormalize(state.target));
    this.camera.up.fromArray(state.up).normalize();
    this.camera.near = Math.max(radius / 2_000, 0.0001);
    this.camera.far = Math.max(this.camera.position.distanceTo(this.controls.target) + radius * 20, 100);
    if (this.camera === this.orthographicCamera && state.orthographicHeight) {
      this.orthographicHeight = state.orthographicHeight * radius;
      this.orthographicCamera.zoom = 1;
      this.updateOrthographicFrustum(this.container.clientWidth / Math.max(this.container.clientHeight, 1));
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.currentDirection.copy(this.camera.position).sub(this.controls.target).normalize();
  }

  setProjection(projection: CameraProjection): void {
    if (this.projection === projection) return;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const aspect = this.container.clientWidth / Math.max(this.container.clientHeight, 1);

    if (projection === 'orthographic') {
      const distance = this.perspectiveCamera.position.distanceTo(this.controls.target);
      this.orthographicHeight = 2 * distance * Math.tan(MathUtils.degToRad(this.perspectiveCamera.fov) / 2);
      this.orthographicCamera.position.copy(this.perspectiveCamera.position);
      this.orthographicCamera.up.copy(this.perspectiveCamera.up);
      this.orthographicCamera.quaternion.copy(this.perspectiveCamera.quaternion);
      this.orthographicCamera.near = this.perspectiveCamera.near;
      this.orthographicCamera.far = this.perspectiveCamera.far;
      this.orthographicCamera.zoom = 1;
      this.updateOrthographicFrustum(aspect);
      this.camera = this.orthographicCamera;
    } else {
      const visibleHeight = this.orthographicHeight / this.orthographicCamera.zoom;
      const distance = visibleHeight / (2 * Math.tan(MathUtils.degToRad(this.perspectiveCamera.fov) / 2));
      this.perspectiveCamera.position.copy(this.controls.target).addScaledVector(direction, distance);
      this.perspectiveCamera.up.copy(this.orthographicCamera.up);
      this.perspectiveCamera.near = this.orthographicCamera.near;
      this.perspectiveCamera.far = this.orthographicCamera.far;
      this.perspectiveCamera.aspect = aspect;
      this.perspectiveCamera.updateProjectionMatrix();
      this.camera = this.perspectiveCamera;
    }

    this.projection = projection;
    this.orbitControls.object = this.camera;
    this.trackballControls.object = this.camera;
    this.controls.update();
  }

  setGridVisible(visible: boolean): void {
    this.gridRequested = visible;
    this.grid.visible = visible && this.currentModel !== null;
    this.invalidate();
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.applyDisplayMode();
  }

  setMeasurementEnabled(enabled: boolean): void {
    if (this.measurementEnabled === enabled) return;
    this.measurementEnabled = enabled;
    this.renderer.domElement.style.cursor = enabled ? 'crosshair' : '';
    this.clearMeasurement();
    if (enabled) this.setSelectedObjects([]);
    this.invalidate();
  }

  clearMeasurement(): void {
    this.measurementPoints.length = 0;
    this.measurementMarkers.forEach((marker) => {
      this.measurementGroup.remove(marker);
      marker.geometry.dispose();
      const materials = Array.isArray(marker.material) ? marker.material : [marker.material];
      materials.forEach((material) => material.dispose());
    });
    this.measurementMarkers.length = 0;
    if (this.measurementLine) {
      this.measurementGroup.remove(this.measurementLine);
      this.measurementLine.geometry.dispose();
      const materials = Array.isArray(this.measurementLine.material) ? this.measurementLine.material : [this.measurementLine.material];
      materials.forEach((material) => material.dispose());
      this.measurementLine = null;
    }
    this.onMeasurementChange({ pointCount: 0, distance: null });
    this.invalidate();
  }

  setSection(enabled: boolean, axis: UpAxis, position: number, flipped: boolean): void {
    this.sectionEnabled = enabled;
    this.sectionAxis = axis;
    this.sectionPosition = MathUtils.clamp(position, 0, 1);
    this.sectionFlipped = flipped;
    this.updateSectionPlane();
  }

  setAnimationClip(index: number): void {
    if (!this.animationMixer || !this.currentModel) return;
    const clip = this.currentAnimations[index];
    if (!clip) return;
    this.animationMixer.stopAllAction();
    this.animationAction = this.animationMixer.clipAction(clip);
    this.configureAnimationLoop();
    this.animationAction.reset().play();
    this.animationAction.paused = true;
    this.animationPlaying = false;
    this.animationMixer.update(0);
    this.notifyAnimationChange();
    this.invalidate();
  }

  setAnimationPlaying(playing: boolean): void {
    if (!this.animationAction) return;
    if (playing && this.animationAction.time >= this.animationAction.getClip().duration) {
      this.animationAction.reset();
    }
    this.animationAction.paused = !playing;
    if (playing) this.animationAction.play();
    this.animationPlaying = playing;
    this.lastFrameTimestamp = 0;
    this.notifyAnimationChange();
    this.invalidate();
  }

  seekAnimation(time: number): void {
    if (!this.animationAction || !Number.isFinite(time)) return;
    this.animationAction.time = MathUtils.clamp(time, 0, this.animationAction.getClip().duration);
    this.animationMixer?.update(0);
    this.notifyAnimationChange();
    this.invalidate();
  }

  resetAnimation(): void {
    if (!this.animationAction) return;
    this.animationAction.reset().play();
    this.animationAction.paused = true;
    this.animationPlaying = false;
    this.animationMixer?.update(0);
    this.notifyAnimationChange();
    this.invalidate();
  }

  setAnimationLoop(loop: boolean): void {
    this.animationLoop = loop;
    this.configureAnimationLoop();
  }

  setAnimationSpeed(speed: number): void {
    if (!this.animationMixer || !Number.isFinite(speed) || speed <= 0) return;
    this.animationMixer.timeScale = speed;
  }

  selectObject(objectId: string | null, additive = false): void {
    const object = objectId ? this.objectById.get(objectId) ?? null : null;
    if (!object || !this.isEffectivelyVisible(object)) {
      if (!additive) this.setSelectedObjects([]);
      return;
    }
    if (!additive) {
      this.setSelectedObjects([object]);
      return;
    }
    const next = this.selectedObjects.includes(object)
      ? this.selectedObjects.filter((selected) => selected !== object)
      : [...this.selectedObjects, object];
    this.setSelectedObjects(next);
  }

  selectObjects(objectIds: readonly string[]): void {
    const objects = objectIds
      .map((objectId) => this.objectById.get(objectId))
      .filter((object): object is Object3D => object !== undefined && this.isEffectivelyVisible(object));
    this.setSelectedObjects(objects);
  }

  previewMaterialPreset(presetId: string, scope: MaterialApplyScope, options?: MaterialPresetOptions): MaterialEditState {
    const preset = findMaterialPreset(presetId);
    if (!preset) throw new Error('Choose a valid Kea3D material preset.');
    this.cancelMaterialPreview();
    const targets = this.getMaterialTargets(scope);
    const meshes = targets.map((target) => target.mesh);
    if (targets.length === 0) return this.getMaterialEditState();
    const before = this.captureMaterials(meshes);
    this.assignPreset(targets, preset, options ?? defaultMaterialPresetOptions(preset));
    this.materialPreview = { before, after: this.captureMaterials(meshes) };
    this.refreshMaterialsAfterEdit();
    return this.getMaterialEditState();
  }

  applyMaterialPreview(): MaterialEditState {
    if (!this.materialPreview) return this.getMaterialEditState();
    this.commandHistory.recordApplied(this.createMaterialCommand(this.materialPreview, 'Apply material'));
    this.materialPreview = null;
    return this.getMaterialEditState();
  }

  cancelMaterialPreview(): MaterialEditState {
    if (this.materialPreview) {
      this.restoreMaterialSnapshot(this.materialPreview.before);
      this.materialPreview = null;
      this.refreshMaterialsAfterEdit();
    }
    return this.getMaterialEditState();
  }

  restoreOriginalMaterials(scope: MaterialApplyScope): MaterialEditState {
    this.cancelMaterialPreview();
    const targets = this.getMaterialTargets(scope).filter((target) => this.materialTargetDiffersFromOriginal(target));
    const meshes = targets.map((target) => target.mesh);
    if (meshes.length === 0) return this.getMaterialEditState();
    const before = this.captureMaterials(meshes);
    targets.forEach((target) => this.restoreMaterialTarget(target));
    const change = { before, after: this.captureMaterials(meshes) };
    this.commandHistory.recordApplied(this.createMaterialCommand(change, 'Restore original material'));
    this.refreshMaterialsAfterEdit();
    return this.getMaterialEditState();
  }

  undoLastChange(): MaterialEditState {
    this.cancelMaterialPreview();
    this.commandHistory.undo();
    return this.getMaterialEditState();
  }

  redoLastChange(): MaterialEditState {
    this.cancelMaterialPreview();
    this.commandHistory.redo();
    return this.getMaterialEditState();
  }

  getMaterialEditState(scope: MaterialApplyScope = 'selection'): MaterialEditState {
    const targets = this.getMaterialTargets(scope);
    const history = this.commandHistory.getState();
    return {
      previewActive: this.materialPreview !== null,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      canRestore: targets.some((target) => this.materialTargetDiffersFromOriginal(target)),
      targetMeshes: targets.length,
    };
  }

  setObjectVisible(objectId: string, visible: boolean): void {
    const object = this.objectById.get(objectId);
    if (!object) return;
    object.visible = visible;
    if (this.measurementPoints.length > 0) this.clearMeasurement();
    const visibleSelection = this.selectedObjects.filter((selected) => this.isEffectivelyVisible(selected));
    if (visibleSelection.length !== this.selectedObjects.length) this.setSelectedObjects(visibleSelection);
    this.invalidate();
  }

  toggleSelectionIsolation(): { active: boolean; visibility: Record<string, boolean> } | null {
    if (this.isolationVisibility) {
      this.isolationVisibility.forEach((visible, object) => {
        object.visible = visible;
      });
      this.isolationVisibility = null;
      const visibleSelection = this.selectedObjects.filter((selected) => this.isEffectivelyVisible(selected));
      if (visibleSelection.length !== this.selectedObjects.length) this.setSelectedObjects(visibleSelection);
      this.invalidate();
      return { active: false, visibility: this.getTreeVisibility() };
    }

    if (!this.currentModel || this.getSelectedMeshes().length === 0) return null;
    const visibility = new Map<Object3D, boolean>();
    this.currentModel.traverse((object) => visibility.set(object, object.visible));
    this.isolationVisibility = visibility;

    const isolatedObjects = new Set<Object3D>();
    this.selectedObjects.forEach((selected) => {
      selected.traverse((object) => isolatedObjects.add(object));
      let ancestor: Object3D | null = selected;
      while (ancestor) {
        isolatedObjects.add(ancestor);
        if (ancestor === this.currentModel) break;
        ancestor = ancestor.parent;
      }
    });
    this.currentModel.traverse((object) => {
      object.visible = isolatedObjects.has(object);
    });
    if (this.measurementPoints.length > 0) this.clearMeasurement();
    this.invalidate();
    return { active: true, visibility: this.getTreeVisibility() };
  }

  setExplodeFactor(factor: number): void {
    this.explodeFactor = MathUtils.clamp(factor, 0, 1);
    this.applyExplosionPositions(this.explodeFactor);
    this.refreshModelLayout();
  }

  setUnitScale(factor: number): [number, number, number] {
    if (!this.currentModel || !Number.isFinite(factor) || factor <= 0) return this.getDimensions();
    this.currentModel.scale.copy(this.baseScale).multiplyScalar(factor);
    return this.refreshModelLayout(true);
  }

  setOrientation(upAxis: UpAxis, forwardAxis: ForwardAxis): [number, number, number] {
    if (!this.currentModel) return this.getDimensions();
    if (!isForwardAxisCompatible(upAxis, forwardAxis)) return this.getDimensions();
    const correction = orientationCorrection(upAxis, forwardAxis);
    this.currentModel.quaternion.copy(correction.multiply(this.baseQuaternion));
    return this.refreshModelLayout(true);
  }

  centerModel(): [number, number, number] {
    if (!this.currentModel) return this.getDimensions();
    const center = new Box3().setFromObject(this.currentModel).getCenter(new Vector3());
    this.currentModel.position.sub(center);
    return this.refreshModelLayout(true);
  }

  groundModel(): [number, number, number] {
    if (!this.currentModel) return this.getDimensions();
    const bounds = new Box3().setFromObject(this.currentModel);
    this.currentModel.position.y -= bounds.min.y;
    return this.refreshModelLayout(true);
  }

  resetAdjustments(): [number, number, number] {
    if (!this.currentModel) return this.getDimensions();
    this.currentModel.position.copy(this.basePosition);
    this.currentModel.quaternion.copy(orientationCorrection(this.initialUpAxis, this.initialForwardAxis).multiply(this.baseQuaternion));
    this.currentModel.scale.copy(this.baseScale).multiplyScalar(unitToMeters[this.initialSourceUnit]);
    return this.refreshModelLayout(true);
  }

  getDimensions(): [number, number, number] {
    if (!this.currentModel) return [0, 0, 0];
    const size = new Box3().setFromObject(this.currentModel).getSize(new Vector3());
    return [size.x, size.y, size.z];
  }

  async exportGlb(options: { onlyVisible?: boolean; includeAnimations?: boolean } = {}): Promise<Blob> {
    if (!this.currentModel) throw new Error('Open a model before exporting.');
    const savedExplosion = this.explodeFactor;
    this.applyExplosionPositions(0);
    this.clearEdgeHelpers();
    this.currentModel.updateMatrixWorld(true);
    try {
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      const result = await new GLTFExporter().parseAsync(this.currentModel, {
        animations: options.includeAnimations === false ? [] : this.currentAnimations,
        binary: true,
        includeCustomExtensions: true,
        onlyVisible: options.onlyVisible ?? false,
        trs: true,
      });
      if (!(result instanceof ArrayBuffer)) throw new Error('The exporter returned an unexpected result.');
      return new Blob([result], { type: 'model/gltf-binary' });
    } finally {
      this.applyExplosionPositions(savedExplosion);
      this.applyDisplayMode();
      this.currentModel.updateMatrixWorld(true);
    }
  }

  private applyExplosionPositions(factor: number): void {
    this.currentModel?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const origin = this.originalPositions.get(object.uuid);
      const offset = this.explodeOffsets.get(object.uuid);
      if (origin && offset) object.position.copy(origin).addScaledVector(offset, factor);
    });
  }

  private refreshModelLayout(fitCamera = false): [number, number, number] {
    if (this.measurementPoints.length > 0) this.clearMeasurement();
    this.currentModel?.updateMatrixWorld(true);
    this.configureGrid();
    if (this.currentModel && this.viewSelector.isVisible()) this.viewSelector.configure(this.currentModel);
    this.updateSectionPlane();
    this.notifySelectionChange();
    if (fitCamera) this.fit();
    this.invalidate();
    return this.getDimensions();
  }

  setTheme(theme: ViewerTheme): void {
    this.viewerTheme = theme;
    this.applyViewportBackground();
    this.orientationGizmo.setTheme(theme);
    this.viewSelector.setTheme(theme);
    this.updateEdgeColors();
  }

  setAccentColor(color: string): void {
    this.accentColor.set(color);
    this.viewSelector.setAccentColor(color);
    this.selectionOverlays.forEach(({ fillMaterial, outlineMaterial }) => {
      fillMaterial.color.copy(this.accentColor);
      outlineMaterial?.uniforms.outlineColor.value.copy(this.accentColor);
    });
    this.anchorMarkers.forEach((marker) => {
      const origin = marker.children.find((child) => child instanceof Mesh) as Mesh | undefined;
      if (origin?.material instanceof MeshBasicMaterial) origin.material.color.copy(this.accentColor);
    });
    this.invalidate();
  }

  setViewportBackground(background: ViewportBackground): void {
    this.viewportBackground = background;
    this.applyViewportBackground();
  }

  setLighting(settings: LightingSettings): void {
    this.lighting = { ...settings };
    this.applyLighting();
  }

  async capturePng(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) => {
      this.renderer.domElement.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The screenshot could not be created.'));
      }, 'image/png');
    });
  }

  private invalidate(): void {
    if (this.disposed || this.animationFrame !== null || document.hidden) return;
    this.animationFrame = window.requestAnimationFrame(this.renderFrame);
  }

  private readonly renderFrame = (timestamp: number): void => {
    this.animationFrame = null;
    const delta = this.lastFrameTimestamp === 0
      ? 0
      : Math.min(Math.max((timestamp - this.lastFrameTimestamp) / 1_000, 0), 0.1);
    this.lastFrameTimestamp = timestamp;
    if (this.animationMixer && this.animationAction && this.animationPlaying) {
      this.animationMixer.update(delta);
      this.animationNotifyElapsed += delta;
      if (!this.animationAction.isRunning()) this.animationPlaying = false;
      if (this.animationNotifyElapsed >= 1 / 15 || !this.animationPlaying) {
        this.notifyAnimationChange();
        this.animationNotifyElapsed = 0;
      }
    }
    this.updateCameraTransition(timestamp);
    const viewSelectorAnimating = this.viewSelector.update(timestamp);
    this.controls.update();
    this.updateMeasurementMarkerScales();
    this.updateAnchorMarkers();
    this.updateSelectionOverlays();
    this.renderer.render(this.scene, this.camera);
    this.orientationGizmo.render(this.camera, this.controls.target);
    if (this.animationPlaying || this.controlsInteracting || this.cameraTransition || viewSelectorAnimating) this.invalidate();
  };

  private updateCameraTransition(timestamp: number): void {
    const transition = this.cameraTransition;
    if (!transition) return;
    transition.startTime ??= timestamp;
    const linearProgress = Math.min((timestamp - transition.startTime) / 220, 1);
    const progress = 1 - (1 - linearProgress) ** 3;
    this.camera.position.lerpVectors(transition.startPosition, transition.endPosition, progress);
    this.camera.up.lerpVectors(transition.startUp, transition.endUp, progress).normalize();
    this.camera.lookAt(this.controls.target);
    if (linearProgress >= 1) this.cameraTransition = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel);
    this.discardProgressivePreview();
    this.clearModel();
    if (this.cameraChangeTimer !== null) window.clearTimeout(this.cameraChangeTimer);
    this.orbitControls.removeEventListener('change', this.handleCameraChange);
    this.trackballControls.removeEventListener('change', this.handleCameraChange);
    this.orbitControls.removeEventListener('start', this.handleControlsStart);
    this.trackballControls.removeEventListener('start', this.handleControlsStart);
    this.orbitControls.removeEventListener('end', this.handleControlsEnd);
    this.trackballControls.removeEventListener('end', this.handleControlsEnd);
    this.orbitControls.dispose();
    this.trackballControls.dispose();
    this.orientationGizmo.dispose();
    this.viewSelector.dispose();
    this.grid.geometry.dispose();
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    gridMaterials.forEach((material) => material.dispose());
    if (this.environmentScene) {
      disposeObject3D(this.environmentScene);
      this.environmentScene = null;
    }
    this.environmentTexture?.dispose();
    this.environmentTexture = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private clearModel(): void {
    this.measurementEnabled = false;
    this.renderer.domElement.style.cursor = '';
    this.clearMeasurement();
    this.setViewSelectorVisible(false);
    if (!this.currentModel) return;
    this.clearSection();
    this.clearAnimations();
    this.clearEdgeHelpers();
    this.clearMaterialEdits();
    this.clearAnchors();
    this.clearInspectionTools();
    this.modelRoot.remove(this.currentModel);
    disposeObject3D(this.currentModel);
    this.currentModel = null;
    this.currentAnimations = [];
    this.grid.visible = false;
    this.orientationGizmo.setVisible(false);
  }

  private applyViewportBackground(): void {
    const color = this.viewportBackground === 'adaptive'
      ? (this.viewerTheme === 'dark' ? '#0c0d0e' : '#e9edf2')
      : {
          black: '#050505',
          charcoal: '#17191c',
          slate: '#252c38',
          light: '#e9edf2',
        }[this.viewportBackground];
    this.renderer.setClearColor(new Color(color), 1);
    this.invalidate();
  }

  private applyLighting(): void {
    const presets = {
      neutral: {
        sky: 0xffffff, ground: 0x667085, hemisphere: 1.35,
        key: 0xffffff, keyIntensity: 2.35, keyPosition: new Vector3(4, 7, 6),
        fill: 0xb8d7ff, fillIntensity: 0.8, fillPosition: new Vector3(-5, 2, -3),
      },
      studio: {
        sky: 0xfff6ea, ground: 0x536174, hemisphere: 1.05,
        key: 0xffe1bd, keyIntensity: 3, keyPosition: new Vector3(3, 6, 4),
        fill: 0xa8cfff, fillIntensity: 1.2, fillPosition: new Vector3(-4, 3, -2),
      },
      outdoor: {
        sky: 0xcfe8ff, ground: 0x8a806e, hemisphere: 1.65,
        key: 0xfff0cf, keyIntensity: 2.65, keyPosition: new Vector3(-4, 8, 5),
        fill: 0xb9d8ff, fillIntensity: 0.45, fillPosition: new Vector3(5, 2, -4),
      },
    } as const;
    const preset = presets[this.lighting.preset];
    this.hemisphereLight.color.setHex(preset.sky);
    this.hemisphereLight.groundColor.setHex(preset.ground);
    this.hemisphereLight.intensity = preset.hemisphere;
    this.keyLight.color.setHex(preset.key);
    this.keyLight.intensity = preset.keyIntensity;
    this.fillLight.color.setHex(preset.fill);
    this.fillLight.intensity = preset.fillIntensity;

    const bounds = this.currentModel ? new Box3().setFromObject(this.currentModel) : null;
    const center = bounds && !bounds.isEmpty() ? bounds.getCenter(new Vector3()) : new Vector3();
    const extent = bounds && !bounds.isEmpty()
      ? Math.max(...bounds.getSize(new Vector3()).toArray(), 0.001)
      : 2;
    this.keyLight.position.copy(center).add(preset.keyPosition.clone().normalize().multiplyScalar(extent * 3));
    this.keyLight.target.position.copy(center);
    this.fillLight.position.copy(center).add(preset.fillPosition.clone().normalize().multiplyScalar(extent * 3));

    const shadowCamera = this.keyLight.shadow.camera;
    const shadowExtent = extent * 0.8;
    shadowCamera.left = -shadowExtent;
    shadowCamera.right = shadowExtent;
    shadowCamera.top = shadowExtent;
    shadowCamera.bottom = -shadowExtent;
    shadowCamera.near = Math.max(extent * 0.01, 0.0001);
    shadowCamera.far = extent * 8;
    shadowCamera.updateProjectionMatrix();
    this.renderer.shadowMap.enabled = this.lighting.shadows;
    this.keyLight.castShadow = this.lighting.shadows;
    this.currentModel?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = this.lighting.shadows;
      object.receiveShadow = this.lighting.shadows;
    });

    this.renderer.toneMappingExposure = this.lighting.exposure;
    this.scene.environmentIntensity = this.lighting.environmentIntensity;
    this.scene.background = this.lighting.backgroundVisible ? this.environmentTexture : null;
    this.scene.backgroundBlurriness = 0.35;
    this.scene.backgroundIntensity = Math.max(this.lighting.environmentIntensity * 0.8, 0.1);
    this.invalidate();
  }

  private readonly handleCameraChange = (): void => {
    this.invalidate();
    if (!this.currentModel) return;
    if (this.cameraChangeTimer !== null) window.clearTimeout(this.cameraChangeTimer);
    this.cameraChangeTimer = window.setTimeout(() => {
      this.cameraChangeTimer = null;
      const state = this.getCameraState();
      if (state) this.onCameraChange(state);
    }, 250);
  };

  private readonly handleControlsStart = (): void => {
    this.cameraTransition = null;
    this.controlsInteracting = true;
    this.invalidate();
  };

  private readonly handleControlsEnd = (): void => {
    this.controlsInteracting = false;
    this.invalidate();
  };

  private readonly handleVisibilityChange = (): void => {
    if (!document.hidden) {
      this.lastFrameTimestamp = 0;
      this.invalidate();
    }
  };

  private prepareAnimations(): void {
    if (!this.currentModel || this.currentAnimations.length === 0) {
      this.notifyAnimationChange();
      return;
    }
    this.animationMixer = new AnimationMixer(this.currentModel);
    this.animationLoop = true;
    this.animationMixer.timeScale = 1;
    this.setAnimationClip(0);
  }

  private configureAnimationLoop(): void {
    if (!this.animationAction) return;
    this.animationAction.setLoop(this.animationLoop ? LoopRepeat : LoopOnce, this.animationLoop ? Infinity : 1);
    this.animationAction.clampWhenFinished = !this.animationLoop;
  }

  private notifyAnimationChange(): void {
    this.onAnimationChange({
      playing: this.animationPlaying,
      time: this.animationAction?.time ?? 0,
    });
  }

  private clearAnimations(): void {
    this.animationMixer?.stopAllAction();
    if (this.animationMixer && this.currentModel) this.animationMixer.uncacheRoot(this.currentModel);
    this.animationMixer = null;
    this.animationAction = null;
    this.animationPlaying = false;
    this.animationLoop = true;
    this.animationNotifyElapsed = 0;
    this.notifyAnimationChange();
  }

  private prepareAnchors(anchors: ComponentAnchor[]): void {
    this.currentAnchors = anchors;
    this.anchorByObjectId.clear();
    anchors.forEach((anchor) => {
      this.anchorByObjectId.set(anchor.object.uuid, anchor);
      const marker = new Group();
      marker.name = `Kea3D Anchor ${anchor.id}`;
      marker.userData.kea3dAnchorObjectId = anchor.object.uuid;

      const origin = new Mesh(
        new SphereGeometry(0.18, 12, 8),
        new MeshBasicMaterial({
          color: this.accentColor,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          transparent: true,
          opacity: 0.92,
        }),
      );
      origin.renderOrder = 10_100;
      origin.userData.kea3dAnchorObjectId = anchor.object.uuid;
      marker.add(origin);

      const axes = new AxesHelper(1);
      const materials = Array.isArray(axes.material) ? axes.material : [axes.material];
      materials.forEach((material) => {
        material.depthTest = false;
        material.depthWrite = false;
        material.transparent = true;
        material.opacity = 0.95;
      });
      axes.renderOrder = 10_099;
      axes.userData.kea3dAnchorObjectId = anchor.object.uuid;
      marker.add(axes);

      this.anchorGroup.add(marker);
      this.anchorMarkers.set(anchor.object, marker);
    });
    this.anchorGroup.visible = this.anchorsVisible && anchors.length > 0;
    this.updateAnchorMarkers();
  }

  private anchorInfo(anchor: ComponentAnchor): AnchorInfo {
    anchor.object.updateWorldMatrix(true, false);
    const position = anchor.object.getWorldPosition(new Vector3());
    const rotation = anchor.object.getWorldQuaternion(new Quaternion()).normalize();
    const localEuler = new Euler().setFromQuaternion(anchor.object.quaternion, 'XYZ');
    return {
      objectId: anchor.object.uuid,
      id: anchor.id,
      name: anchor.name,
      parentName: anchor.parentName,
      position: position.toArray(),
      rotation: rotation.toArray(),
      localPosition: anchor.object.position.toArray(),
      localRotation: [
        MathUtils.radToDeg(localEuler.x),
        MathUtils.radToDeg(localEuler.y),
        MathUtils.radToDeg(localEuler.z),
      ],
    };
  }

  private anchorEditInput(object: Object3D, id = anchorIdForObject(object, 'model') ?? ''): AnchorEditInput {
    const rotation = new Euler().setFromQuaternion(object.quaternion, 'XYZ');
    return {
      id,
      name: object.name.trim() || id,
      position: object.position.toArray(),
      rotation: [MathUtils.radToDeg(rotation.x), MathUtils.radToDeg(rotation.y), MathUtils.radToDeg(rotation.z)],
    };
  }

  private refreshAnchorDocument(selectedObjectIds: readonly string[]): void {
    if (!this.currentModel) return;
    this.clearAnchors();
    this.objectById.clear();
    this.currentAnchors = discoverComponentAnchorDetails(this.currentModel, 'model', {
      allowDuplicateIds: true,
      allowInheritedScale: true,
    });
    this.currentSceneTree = buildSceneTree(this.currentModel, this.objectById);
    this.prepareAnchors(this.currentAnchors);
    this.setSelectedObjects(selectedObjectIds
      .map((objectId) => this.objectById.get(objectId))
      .filter((object): object is Object3D => object !== undefined));
    this.invalidate();
  }

  private updateAnchorMarkers(): void {
    if (!this.anchorGroup.visible) return;
    const viewportHeight = Math.max(this.renderer.domElement.clientHeight, 1);
    this.anchorMarkers.forEach((marker, source) => {
      source.updateWorldMatrix(true, false);
      source.getWorldPosition(marker.position);
      source.getWorldQuaternion(marker.quaternion);
      const worldPerPixel = this.camera === this.perspectiveCamera
        ? 2 * this.camera.position.distanceTo(marker.position) * Math.tan(MathUtils.degToRad(this.perspectiveCamera.fov) / 2) / viewportHeight
        : (this.orthographicCamera.top - this.orthographicCamera.bottom) / this.orthographicCamera.zoom / viewportHeight;
      marker.children.forEach((child) => child.scale.setScalar(Math.max(worldPerPixel * 24, 0.000_001)));
      marker.visible = this.isEffectivelyVisible(source);
      const selected = this.selectedObjects.includes(source);
      const origin = marker.children.find((child) => child instanceof Mesh) as Mesh | undefined;
      if (origin?.material instanceof MeshBasicMaterial) origin.material.opacity = selected ? 1 : 0.78;
    });
  }

  private clearAnchors(): void {
    this.anchorMarkers.forEach((marker) => {
      this.anchorGroup.remove(marker);
      disposeObject3D(marker);
    });
    this.anchorMarkers.clear();
    this.anchorByObjectId.clear();
    this.currentAnchors = [];
    this.anchorGroup.visible = false;
  }

  private prepareInspectionTools(): void {
    if (!this.currentModel) return;
    this.currentModel.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(this.currentModel);
    const center = bounds.getCenter(new Vector3());
    const extent = Math.max(...bounds.getSize(new Vector3()).toArray(), 0.001);
    let meshIndex = 0;

    this.currentModel.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      meshIndex += 1;
      this.originalPositions.set(object.uuid, object.position.clone());
      this.originalMaterials.set(object, object.material);

      const partCenter = new Box3().setFromObject(object).getCenter(new Vector3());
      const direction = partCenter.clone().sub(center);
      if (direction.lengthSq() < 1e-10) {
        direction.set(meshIndex % 2 ? 1 : -1, meshIndex % 3 === 0 ? 0.35 : 0, meshIndex % 4 < 2 ? 1 : -1);
      }
      const worldOffset = direction.normalize().multiplyScalar(extent * 0.42);
      if (object.parent) {
        const localStart = object.parent.worldToLocal(partCenter.clone());
        const localEnd = object.parent.worldToLocal(partCenter.clone().add(worldOffset));
        this.explodeOffsets.set(object.uuid, localEnd.sub(localStart));
      }

    });
  }

  private clearInspectionTools(): void {
    this.isolationVisibility = null;
    this.setSelectedObjects([]);
    this.objectById.clear();
    this.currentSceneTree = [];
    this.originalPositions.clear();
    this.explodeOffsets.clear();
    this.originalMaterials.clear();
    this.explodeFactor = 0;
  }

  private setSelectedObjects(objects: readonly Object3D[]): void {
    const uniqueObjects = [...new Set(objects)];
    if (uniqueObjects.length === this.selectedObjects.length
      && uniqueObjects.every((object, index) => object === this.selectedObjects[index])) return;
    this.cancelMaterialPreview();
    this.clearSelectionHighlight();
    this.selectedObjects = uniqueObjects;
    if (uniqueObjects.length > 0) {
      const selectedMeshes = this.getSelectedMeshes();
      const selectedTriangleCount = selectedMeshes.reduce((total, mesh) => {
        const vertexCount = mesh.geometry.index?.count
          ?? mesh.geometry.getAttribute('position')?.count
          ?? 0;
        return total + Math.floor(vertexCount / 3);
      }, 0);
      const showGeometryOutline = selectedTriangleCount <= maxSelectionOutlineTriangles;
      selectedMeshes.forEach((mesh) => {
        const fillMaterial = new MeshBasicMaterial({
          color: this.accentColor.getHex(),
          depthWrite: false,
          opacity: 0.18,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          toneMapped: false,
          transparent: true,
        });
        const fill = new Mesh(mesh.geometry, fillMaterial);
        fill.frustumCulled = false;
        fill.renderOrder = 9_000;

        const group = new Group();
        group.add(fill);
        let outlineMaterial: ShaderMaterial | null = null;
        if (showGeometryOutline) {
          outlineMaterial = new ShaderMaterial({
            depthWrite: false,
            fragmentShader: selectionOutlineFragmentShader,
            side: BackSide,
            toneMapped: false,
            transparent: true,
            uniforms: {
              outlineColor: { value: this.accentColor.clone() },
              outlineOpacity: { value: 0.98 },
              outlineResolution: { value: this.selectionOutlineResolution },
              outlineWidth: { value: selectionOutlineWidth },
            },
            vertexShader: selectionOutlineVertexShader,
          });
          outlineMaterial.clipping = true;
          if (this.sectionEnabled && this.sectionPlane) outlineMaterial.clippingPlanes = [this.sectionPlane];
          const outline = new Mesh(mesh.geometry, outlineMaterial);
          outline.frustumCulled = false;
          outline.renderOrder = 9_001;
          group.add(outline);
        }
        group.matrixAutoUpdate = false;
        group.name = 'Kea3D selection highlight';
        this.scene.add(group);
        this.selectionOverlays.set(mesh, { group, fillMaterial, outlineMaterial });
      });
      this.updateSelectionOverlays();
    }
    this.notifySelectionChange();
    this.invalidate();
  }

  private notifySelectionChange(): void {
    const selectedAnchors = this.selectedObjects
      .map((object) => this.anchorByObjectId.get(object.uuid))
      .filter((anchor): anchor is ComponentAnchor => anchor !== undefined)
      .map((anchor) => this.anchorInfo(anchor));
    const geometryObjects = this.selectedObjects.filter((object) => !this.anchorByObjectId.has(object.uuid));
    const geometryInfo = geometryObjects.length > 0 ? analyzeSelections(geometryObjects) : null;
    this.onSelectionChange(
      this.selectedObjects.map((object) => object.uuid),
      this.selectedObjects.length > 0 ? {
        meshes: geometryInfo?.meshes ?? 0,
        vertices: geometryInfo?.vertices ?? 0,
        triangles: geometryInfo?.triangles ?? 0,
        materials: geometryInfo?.materials ?? 0,
        dimensions: geometryInfo?.dimensions ?? [0, 0, 0],
        ...(selectedAnchors.length > 0 ? { anchors: selectedAnchors } : {}),
      } : null,
    );
  }

  private getSelectedMeshes(): Mesh[] {
    const meshes = new Set<Mesh>();
    this.selectedObjects.forEach((selected) => {
      selected.traverse((object) => {
        if (object instanceof Mesh) meshes.add(object);
      });
    });
    return [...meshes];
  }

  private selectionBounds(): Box3 {
    const bounds = new Box3();
    this.selectedObjects.forEach((object) => bounds.expandByObject(object));
    if (bounds.isEmpty() && this.selectedObjects.length > 0) {
      const center = this.selectedObjects.at(-1)!.getWorldPosition(new Vector3());
      const modelSize = this.currentModel ? new Box3().setFromObject(this.currentModel).getSize(new Vector3()).length() : 1;
      bounds.setFromCenterAndSize(center, new Vector3(1, 1, 1).multiplyScalar(Math.max(modelSize * 0.04, 0.001)));
    }
    return bounds;
  }

  private updateSelectionOverlays(): void {
    this.selectionOverlays.forEach(({ group }, source) => {
      source.updateWorldMatrix(true, false);
      group.matrix.copy(source.matrixWorld);
      group.visible = this.isEffectivelyVisible(source);
    });
  }

  private clearSelectionHighlight(): void {
    this.selectionOverlays.forEach(({ group, fillMaterial, outlineMaterial }) => {
      this.scene.remove(group);
      fillMaterial.dispose();
      outlineMaterial?.dispose();
    });
    this.selectionOverlays.clear();
  }

  private isEffectivelyVisible(object: Object3D): boolean {
    return isEffectivelyVisible(object);
  }

  private getMaterialTargets(scope: MaterialApplyScope): MaterialTarget[] {
    if (!this.currentModel || this.selectedObjects.length === 0) return [];
    const selectedMeshes = this.getSelectedMeshes();
    if (scope === 'selection') return selectedMeshes.map((mesh) => ({ mesh, materialIndices: null }));

    const selectedMaterialSignatures = new Set<string>();
    selectedMeshes.forEach((mesh) => {
      const original = this.originalMaterials.get(mesh) ?? mesh.material;
      const materials = Array.isArray(original) ? original : [original];
      materials.forEach((material) => selectedMaterialSignatures.add(this.materialFingerprint(material)));
    });
    const matches: MaterialTarget[] = [];
    this.currentModel.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const original = this.originalMaterials.get(object) ?? object.material;
      const materials = Array.isArray(original) ? original : [original];
      const materialIndices = materials.flatMap((material, index) => (
        selectedMaterialSignatures.has(this.materialFingerprint(material)) ? [index] : []
      ));
      if (materialIndices.length > 0) matches.push({ mesh: object, materialIndices });
    });
    return matches;
  }

  private materialFingerprint(material: Material): string {
    const number = (value: number | undefined) => Number.isFinite(value) ? Math.round((value ?? 0) * 100_000) / 100_000 : null;
    const color = (value: Color | undefined) => value ? [number(value.r), number(value.g), number(value.b)] : null;
    const texture = (value: Texture | null | undefined) => value ? {
      source: value.source?.uuid ?? value.uuid,
      colorSpace: value.colorSpace,
      channel: value.channel,
      flipY: value.flipY,
      offset: [number(value.offset.x), number(value.offset.y)],
      repeat: [number(value.repeat.x), number(value.repeat.y)],
      rotation: number(value.rotation),
      wrapS: value.wrapS,
      wrapT: value.wrapT,
    } : null;
    const standard = material instanceof MeshStandardMaterial ? {
      color: color(material.color),
      emissive: color(material.emissive),
      emissiveIntensity: number(material.emissiveIntensity),
      metalness: number(material.metalness),
      roughness: number(material.roughness),
      map: texture(material.map),
      emissiveMap: texture(material.emissiveMap),
      metalnessMap: texture(material.metalnessMap),
      normalMap: texture(material.normalMap),
      roughnessMap: texture(material.roughnessMap),
    } : null;
    const physical = material instanceof MeshPhysicalMaterial ? {
      attenuationColor: color(material.attenuationColor),
      attenuationDistance: number(material.attenuationDistance),
      clearcoat: number(material.clearcoat),
      clearcoatRoughness: number(material.clearcoatRoughness),
      ior: number(material.ior),
      iridescence: number(material.iridescence),
      sheen: number(material.sheen),
      sheenColor: color(material.sheenColor),
      sheenRoughness: number(material.sheenRoughness),
      specularColor: color(material.specularColor),
      specularIntensity: number(material.specularIntensity),
      thickness: number(material.thickness),
      transmission: number(material.transmission),
    } : null;
    return JSON.stringify({
      type: material.type,
      alphaTest: number(material.alphaTest),
      blending: material.blending,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite,
      opacity: number(material.opacity),
      side: material.side,
      transparent: material.transparent,
      vertexColors: material.vertexColors,
      standard,
      physical,
    });
  }

  private captureMaterials(meshes: readonly Mesh[]): MaterialSnapshot {
    return new Map(meshes.map((mesh) => [mesh, mesh.material]));
  }

  private restoreMaterialSnapshot(snapshot: MaterialSnapshot): void {
    snapshot.forEach((material, mesh) => { mesh.material = material; });
  }

  private createMaterialCommand(change: MaterialChange, label: string): ReversibleCommand {
    return {
      label,
      apply: () => {
        this.restoreMaterialSnapshot(change.after);
        this.refreshMaterialsAfterEdit();
      },
      revert: () => {
        this.restoreMaterialSnapshot(change.before);
        this.refreshMaterialsAfterEdit();
      },
    };
  }

  private materialValuesEqual(left: MeshMaterial, right: MeshMaterial): boolean {
    const leftValues = Array.isArray(left) ? left : [left];
    const rightValues = Array.isArray(right) ? right : [right];
    return leftValues.length === rightValues.length && leftValues.every((material, index) => material === rightValues[index]);
  }

  private materialTargetDiffersFromOriginal(target: MaterialTarget): boolean {
    const original = this.originalMaterials.get(target.mesh);
    if (!original) return false;
    if (target.materialIndices === null) return !this.materialValuesEqual(target.mesh.material, original);
    const currentMaterials = Array.isArray(target.mesh.material) ? target.mesh.material : [target.mesh.material];
    const originalMaterials = Array.isArray(original) ? original : [original];
    return target.materialIndices.some((index) => currentMaterials[index] !== originalMaterials[index]);
  }

  private restoreMaterialTarget(target: MaterialTarget): void {
    const original = this.originalMaterials.get(target.mesh);
    if (!original) return;
    if (target.materialIndices === null) {
      target.mesh.material = original;
      return;
    }
    const currentMaterials = Array.isArray(target.mesh.material) ? [...target.mesh.material] : [target.mesh.material];
    const originalMaterials = Array.isArray(original) ? original : [original];
    target.materialIndices.forEach((index) => {
      if (originalMaterials[index]) currentMaterials[index] = originalMaterials[index];
    });
    target.mesh.material = Array.isArray(target.mesh.material) ? currentMaterials : currentMaterials[0]!;
  }

  private assignPreset(targets: readonly MaterialTarget[], preset: MaterialPreset, options: MaterialPresetOptions): void {
    targets.forEach(({ mesh, materialIndices }) => {
      const sourceMaterials = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
      const indices = materialIndices ?? sourceMaterials.map((_, index) => index);
      indices.forEach((index) => {
        const source = sourceMaterials[index];
        if (source) sourceMaterials[index] = this.createPresetMaterial(preset, options, source);
      });
      mesh.material = Array.isArray(mesh.material) ? sourceMaterials : sourceMaterials[0]!;
    });
  }

  private createPresetMaterial(preset: MaterialPreset, options: MaterialPresetOptions, source: Material): Material {
    const color = new Color(preset.color);
    if (options.tone === 'dark') color.lerp(new Color(0x000000), 0.46);
    if (options.tone === 'light') color.lerp(new Color(0xffffff), 0.34);
    const common = {
      color,
      depthTest: source.depthTest,
      metalness: options.metalness,
      name: `Kea3D · ${preset.name}`,
      opacity: options.opacity,
      roughness: options.roughness,
      side: source.side,
      transparent: options.opacity < 1 || options.transmission > 0,
      vertexColors: false,
    };
    const material = preset.transmission !== undefined
      ? new MeshPhysicalMaterial({
          ...common,
          depthWrite: false,
          ior: 1.5,
          thickness: 0.01,
          transmission: options.transmission,
        })
      : new MeshStandardMaterial({
          ...common,
          depthWrite: source.depthWrite,
          emissive: options.emissionEnabled ? preset.emissive ?? '#000000' : '#000000',
          emissiveIntensity: options.emissionEnabled ? options.emissiveIntensity : 0,
        });
    material.userData.kea3dMaterialPreset = preset.id;
    material.userData.kea3dMaterialOptions = { ...options };
    this.ownedMaterialOverrides.add(material);
    return material;
  }

  private refreshMaterialsAfterEdit(): void {
    this.applyDisplayMode();
    this.updateSectionPlane();
    this.notifySelectionChange();
    this.invalidate();
  }

  private clearMaterialEdits(): void {
    if (this.materialPreview) this.restoreMaterialSnapshot(this.materialPreview.before);
    this.materialPreview = null;
    this.originalMaterials.forEach((material, mesh) => { mesh.material = material; });
    this.ownedMaterialOverrides.forEach((material) => material.dispose());
    this.ownedMaterialOverrides.clear();
    this.commandHistory.clear();
  }

  private getTreeVisibility(): Record<string, boolean> {
    const visibility: Record<string, boolean> = {};
    this.objectById.forEach((object, objectId) => {
      visibility[objectId] = object.visible;
    });
    return visibility;
  }

  private addMeasurementPoint(point: Vector3): void {
    if (this.measurementPoints.length >= 2) this.clearMeasurement();

    const measuredPoint = point.clone();
    this.measurementPoints.push(measuredPoint);
    const marker = new Mesh(
      new SphereGeometry(1, 16, 12),
      new MeshBasicMaterial({ color: 0xc8ff63, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    marker.position.copy(measuredPoint);
    marker.renderOrder = 10_001;
    this.measurementGroup.add(marker);
    this.measurementMarkers.push(marker);
    this.updateMeasurementMarkerScales();

    if (this.measurementPoints.length === 2) {
      const material = new LineBasicMaterial({
        color: 0xc8ff63,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
        toneMapped: false,
      });
      this.measurementLine = new Line(new BufferGeometry().setFromPoints(this.measurementPoints), material);
      this.measurementLine.renderOrder = 10_000;
      this.measurementGroup.add(this.measurementLine);
    }

    this.onMeasurementChange({
      pointCount: this.measurementPoints.length as 1 | 2,
      distance: this.measurementPoints.length === 2
        ? this.measurementPoints[0].distanceTo(this.measurementPoints[1])
        : null,
    });
    this.invalidate();
  }

  private updateMeasurementMarkerScales(): void {
    if (this.measurementMarkers.length === 0) return;
    const viewportHeight = Math.max(this.renderer.domElement.clientHeight, 1);
    this.measurementMarkers.forEach((marker) => {
      const worldPerPixel = this.camera === this.perspectiveCamera
        ? 2 * this.camera.position.distanceTo(marker.position) * Math.tan(MathUtils.degToRad(this.perspectiveCamera.fov) / 2) / viewportHeight
        : (this.orthographicCamera.top - this.orthographicCamera.bottom) / this.orthographicCamera.zoom / viewportHeight;
      marker.scale.setScalar(Math.max(worldPerPixel * 6, 0.000_001));
    });
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      pointerType: event.pointerType,
    };
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.viewSelector.isVisible()) return;
    this.updatePointerRay(event);
    this.renderer.domElement.style.cursor = this.viewSelector.hover(this.raycaster) ? 'pointer' : '';
    this.invalidate();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || start.id !== event.pointerId || !this.currentModel) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;

    this.updatePointerRay(event);
    if (this.viewSelector.isVisible()) {
      const direction = this.viewSelector.select(this.raycaster);
      if (direction) {
        this.snapToDirection(direction);
      }
      this.setViewSelectorVisible(false);
      return;
    }
    if (this.anchorsVisible && !this.measurementEnabled) {
      this.updateAnchorMarkers();
      const anchorHit = pickAnchorMarker(this.raycaster, this.anchorMarkers);
      if (anchorHit) {
        const longPress = start.pointerType === 'touch' && performance.now() - start.time >= 450;
        this.selectObject(anchorHit.uuid, event.ctrlKey || event.metaKey || longPress);
        return;
      }
    }
    const hit = pickVisibleMesh(this.raycaster, this.currentModel);
    if (this.measurementEnabled) {
      if (hit) this.addMeasurementPoint(hit.point);
      return;
    }
    const longPress = start.pointerType === 'touch' && performance.now() - start.time >= 450;
    this.selectObject(hit?.object.uuid ?? null, event.ctrlKey || event.metaKey || longPress);
  };

  private readonly handlePointerCancel = (): void => {
    this.pointerStart = null;
  };

  private updatePointerRay(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private configureGrid(): void {
    if (!this.currentModel) return;
    const bounds = new Box3().setFromObject(this.currentModel);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const extent = Math.max(size.x, size.y, size.z, 0.001);
    this.grid.scale.setScalar(extent / 5);
    this.grid.position.set(center.x, bounds.min.y - extent * 0.004, center.z);
    this.grid.visible = this.gridRequested;
  }

  private applyDisplayMode(): void {
    this.clearEdgeHelpers();
    this.currentModel?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const triangleCount = object.geometry.index
        ? object.geometry.index.count / 3
        : (object.geometry.getAttribute('position')?.count ?? 0) / 3;
      const useWireframeFallback = this.displayMode === 'edges' && triangleCount > maxEdgeTriangles;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material: Material) => {
        const wireframeMaterial = material as Material & { wireframe?: boolean };
        if (typeof wireframeMaterial.wireframe !== 'boolean') return;
        wireframeMaterial.wireframe = this.displayMode === 'wireframe' || useWireframeFallback;
        wireframeMaterial.needsUpdate = true;
      });
      if (this.displayMode !== 'edges' || useWireframeFallback) return;
      const edgeMaterial = new LineBasicMaterial({
        color: this.viewerTheme === 'dark' ? 0xc3cad5 : 0x24272d,
        depthWrite: false,
        transparent: true,
        opacity: 0.72,
      });
      if (this.sectionEnabled && this.sectionPlane) edgeMaterial.clippingPlanes = [this.sectionPlane];
      const helper = new LineSegments(new EdgesGeometry(object.geometry, 25), edgeMaterial);
      helper.name = 'Kea3D edges';
      helper.renderOrder = 1;
      object.add(helper);
      this.edgeHelpers.set(object, helper);
    });
    this.invalidate();
  }

  private clearEdgeHelpers(): void {
    this.edgeHelpers.forEach((helper, mesh) => {
      mesh.remove(helper);
      helper.geometry.dispose();
      const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
      materials.forEach((material) => material.dispose());
    });
    this.edgeHelpers.clear();
  }

  private updateEdgeColors(): void {
    const color = this.viewerTheme === 'dark' ? 0xc3cad5 : 0x24272d;
    this.edgeHelpers.forEach((helper) => {
      const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
      materials.forEach((material) => {
        if (material instanceof LineBasicMaterial) material.color.setHex(color);
      });
    });
  }

  private updateSectionPlane(): void {
    if (!this.currentModel) return;
    if (!this.sectionEnabled) {
      this.restoreClippingPlanes();
      this.sectionPlane = null;
      this.invalidate();
      return;
    }

    this.currentModel.updateMatrixWorld(true);
    this.sectionPlane = sectionPlaneForBounds(
      new Box3().setFromObject(this.currentModel),
      this.sectionAxis,
      this.sectionPosition,
      this.sectionFlipped,
    );
    this.currentModel.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!this.originalClippingPlanes.has(material)) {
          this.originalClippingPlanes.set(material, material.clippingPlanes?.slice() ?? null);
        }
        material.clippingPlanes = [...(this.originalClippingPlanes.get(material) ?? []), this.sectionPlane!];
        material.needsUpdate = true;
      });
    });
    this.edgeHelpers.forEach((helper) => {
      const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
      materials.forEach((material) => {
        material.clippingPlanes = [this.sectionPlane!];
        material.needsUpdate = true;
      });
    });
    this.invalidate();
  }

  private restoreClippingPlanes(): void {
    this.originalClippingPlanes.forEach((planes, material) => {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    });
    this.originalClippingPlanes.clear();
  }

  private clearSection(): void {
    this.restoreClippingPlanes();
    this.sectionEnabled = false;
    this.sectionAxis = 'x';
    this.sectionPosition = 0.5;
    this.sectionFlipped = false;
    this.sectionPlane = null;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const maxPixels = 3840 * 2160;
    const requestedRatio = Math.min(window.devicePixelRatio, 2);
    const pixelCount = width * height * requestedRatio * requestedRatio;
    const ratio = pixelCount > maxPixels
      ? requestedRatio * Math.sqrt(maxPixels / pixelCount)
      : requestedRatio;

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.selectionOutlineResolution.set(width, height);
    this.trackballControls.handleResize();
    const aspect = width / height;
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateOrthographicFrustum(aspect);
  }

  private updateOrthographicFrustum(aspect: number): void {
    const halfHeight = this.orthographicHeight / 2;
    this.orthographicCamera.left = -halfHeight * aspect;
    this.orthographicCamera.right = halfHeight * aspect;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.orthographicCamera.updateProjectionMatrix();
    this.invalidate();
  }
}
