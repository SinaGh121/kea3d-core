export type CameraView = 'iso' | 'front' | 'top';
export type CameraProjection = 'perspective' | 'orthographic';
export type RotationMode = 'fixed-up' | 'free';
export type DisplayMode = 'solid' | 'edges' | 'wireframe';
export type LinearUnit = 'um' | 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type UpAxis = 'x' | 'y' | 'z';
export type ForwardAxis = 'x' | '-x' | 'y' | '-y' | 'z' | '-z';
export type MaterialApplyScope = 'selection' | 'same-material';

export interface MaterialEditState {
  previewActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canRestore: boolean;
  targetMeshes: number;
}

export interface LoadProgress {
  stage: 'reading' | 'resolving' | 'caching' | 'decoding' | 'preparing';
  value?: number;
}

export interface ModelInfo {
  fileName: string;
  fileSize: number;
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  dimensions: [number, number, number];
}

export interface SelectionInfo {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  dimensions: [number, number, number];
  anchors?: AnchorInfo[];
}

export interface AnchorInfo {
  objectId: string;
  id: string;
  name: string;
  parentName: string | null;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface SceneNode {
  id: string;
  name: string;
  type: 'group' | 'mesh' | 'anchor';
  visible: boolean;
  children: SceneNode[];
}

export interface AnimationClipInfo {
  name: string;
  duration: number;
}

export interface AnimationPlaybackState {
  playing: boolean;
  time: number;
}

export interface MeasurementState {
  pointCount: 0 | 1 | 2;
  distance: number | null;
}

export interface LoadedModel {
  info: ModelInfo;
  sceneTree: SceneNode[];
  animations: AnimationClipInfo[];
  initialSourceUnit: LinearUnit;
  initialUpAxis: UpAxis;
  initialForwardAxis: ForwardAxis;
  anchors: AnchorInfo[];
  project?: Kea3dProjectSession;
}

export type ViewerTheme = 'dark' | 'light';
export type ViewportBackground = 'adaptive' | 'black' | 'charcoal' | 'slate' | 'light';
export type LightingPreset = 'neutral' | 'studio' | 'outdoor';

export interface LightingSettings {
  preset: LightingPreset;
  exposure: number;
  environmentIntensity: number;
  backgroundVisible: boolean;
  shadows: boolean;
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  projection: CameraProjection;
  orthographicHeight?: number;
}
import type { Kea3dProjectSession } from '@/project/projectFormat';
