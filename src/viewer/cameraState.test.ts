import { describe, expect, it } from 'vitest';
import { parseCameraState } from './cameraState';

const validCamera = {
  position: [2, 1, 2],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: 'perspective',
} as const;

describe('camera state validation', () => {
  it('accepts a usable finite camera', () => {
    expect(parseCameraState(validCamera)).toEqual(validCamera);
  });

  it('rejects degenerate direction and up vectors', () => {
    expect(parseCameraState({ ...validCamera, target: validCamera.position })).toBeNull();
    expect(parseCameraState({ ...validCamera, up: [0, 0, 0] })).toBeNull();
  });

  it('rejects invalid orthographic heights', () => {
    expect(parseCameraState({ ...validCamera, projection: 'orthographic', orthographicHeight: 0 })).toBeNull();
  });
});
