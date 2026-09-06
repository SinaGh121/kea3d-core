import { describe, expect, it } from 'vitest';
import { decodeSharedView, encodeSharedView, type SharedViewState } from './sharedView';

const view: SharedViewState = {
  version: 1,
  camera: {
    position: [2.123456789, 1, -3],
    target: [0, 0.25, 0],
    up: [0, 1, 0],
    projection: 'orthographic',
    orthographicHeight: 2.75,
  },
  displayMode: 'edges',
  gridVisible: true,
  rotationMode: 'free',
};

describe('shared view links', () => {
  it('round-trips a compact validated view state', () => {
    expect(decodeSharedView(encodeSharedView(view))).toEqual({
      ...view,
      camera: { ...view.camera, position: [2.123457, 1, -3] },
    });
  });

  it('rejects malformed and unsupported states', () => {
    expect(decodeSharedView('#view=not-base64')).toBeNull();
    expect(decodeSharedView('')).toBeNull();
    const unsupported = btoa(JSON.stringify({ ...view, version: 2 }));
    expect(decodeSharedView(`#view=${unsupported}`)).toBeNull();
  });

  it('accepts older view links without a rotation mode', () => {
    const legacy = { ...view, rotationMode: undefined };
    expect(decodeSharedView(encodeSharedView(legacy))).toMatchObject({ version: 1, displayMode: 'edges' });
  });
});
