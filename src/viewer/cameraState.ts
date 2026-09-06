import type { CameraState } from './types';

const finiteVector = (value: unknown): value is [number, number, number] => (
  Array.isArray(value)
  && value.length === 3
  && value.every((part) => typeof part === 'number' && Number.isFinite(part) && Math.abs(part) <= 1_000_000)
);

const squaredLength = (value: [number, number, number]): number => (
  value[0] ** 2 + value[1] ** 2 + value[2] ** 2
);

const squaredDistance = (left: [number, number, number], right: [number, number, number]): number => (
  (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2
);

export function parseCameraState(value: unknown): CameraState | null {
  if (!value || typeof value !== 'object') return null;
  const camera = value as Partial<CameraState>;
  if (
    !finiteVector(camera.position)
    || !finiteVector(camera.target)
    || !finiteVector(camera.up)
    || squaredDistance(camera.position, camera.target) <= 1e-12
    || squaredLength(camera.up) <= 1e-12
    || (camera.projection !== 'perspective' && camera.projection !== 'orthographic')
    || (camera.orthographicHeight !== undefined && (
      typeof camera.orthographicHeight !== 'number'
      || !Number.isFinite(camera.orthographicHeight)
      || camera.orthographicHeight <= 0
      || camera.orthographicHeight > 1_000_000
    ))
  ) return null;
  return camera as CameraState;
}
