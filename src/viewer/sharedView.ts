import { parseCameraState } from './cameraState';
import type { CameraState, DisplayMode, RotationMode } from './types';

export interface SharedViewState {
  version: 1;
  camera: CameraState;
  displayMode: DisplayMode;
  gridVisible: boolean;
  rotationMode?: RotationMode;
}

const roundVector = (value: [number, number, number]): [number, number, number] => (
  value.map((part) => Number(part.toPrecision(7))) as [number, number, number]
);

export function encodeSharedView(state: SharedViewState): string {
  const compact: SharedViewState = {
    ...state,
    camera: {
      ...state.camera,
      position: roundVector(state.camera.position),
      target: roundVector(state.camera.target),
      up: roundVector(state.camera.up),
      ...(state.camera.orthographicHeight === undefined
        ? {}
        : { orthographicHeight: Number(state.camera.orthographicHeight.toPrecision(7)) }),
    },
  };
  return `#view=${btoa(JSON.stringify(compact)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

export function decodeSharedView(hash: string): SharedViewState | null {
  const encoded = new URLSearchParams(hash.replace(/^#/, '')).get('view');
  if (!encoded || encoded.length > 2_048) return null;
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const value = JSON.parse(atob(base64)) as Partial<SharedViewState>;
    const camera = value.camera as Partial<CameraState> | undefined;
    if (
      value.version !== 1
      || !camera
      || !parseCameraState(camera)
      || (value.displayMode !== 'solid' && value.displayMode !== 'edges' && value.displayMode !== 'wireframe')
      || typeof value.gridVisible !== 'boolean'
      || (value.rotationMode !== undefined && value.rotationMode !== 'fixed-up' && value.rotationMode !== 'free')
    ) return null;
    return value as SharedViewState;
  } catch {
    return null;
  }
}
