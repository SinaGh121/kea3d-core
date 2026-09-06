import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshStandardMaterial, type Material } from 'three';
import { Channel, invoke } from '@tauri-apps/api/core';
import { loadCancelledError, throwIfLoadCancelled } from './loadControl';
import { registerPreparedModel } from './preparedModel';
import { disposeObject3D } from './disposeObject';
import { createNativeCadDeliveryBarrier } from './nativeCadDelivery';
import type { LoadProgress } from './types';

export interface NativeCadProgressiveHandlers {
  onFirstBatch?: (scene: Group) => void;
  onBatch?: (scene: Group) => void;
  onDiscard?: (scene: Group) => void;
}

type NativeBytes = ArrayBuffer | Uint8Array | number[];
type NativeCadHeader = {
  type: 'manifest' | 'progress' | 'meshBatch' | 'terminal';
  stage?: 'reading' | 'transferring' | 'tessellating';
  completed?: number;
  total?: number;
  batchId?: string;
  vertexCount?: number;
  triangleCount?: number;
  status?: 'success' | 'cancelled' | 'failure';
  message?: string;
};

function copyBytes(value: NativeBytes): Uint8Array {
  const source = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : Array.isArray(value) ? Uint8Array.from(value) : value;
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function readFrame(value: NativeBytes): { header: NativeCadHeader; payload: Uint8Array } {
  const frame = copyBytes(value);
  if (frame.byteLength < 4) throw new Error('The native CAD worker returned a truncated frame.');
  const headerLength = new DataView(frame.buffer).getUint32(0, true);
  const payloadOffset = 4 + headerLength;
  if (headerLength === 0 || payloadOffset > frame.byteLength) {
    throw new Error('The native CAD worker returned an invalid frame header.');
  }
  const header = JSON.parse(new TextDecoder().decode(frame.subarray(4, payloadOffset))) as NativeCadHeader;
  return { header, payload: frame.slice(payloadOffset) };
}

function materialForColor(red: number, green: number, blue: number, alpha: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(red, green, blue),
    metalness: 0.04,
    opacity: alpha,
    roughness: 0.58,
    side: DoubleSide,
    transparent: alpha < 1,
  });
}

function meshFromBatch(header: NativeCadHeader, payload: Uint8Array): Mesh {
  if (payload.byteLength < 16 || new TextDecoder().decode(payload.subarray(0, 4)) !== 'K3M1') {
    throw new Error('The native CAD worker returned an invalid mesh batch.');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const vertexCount = view.getUint32(4, true);
  const triangleCount = view.getUint32(8, true);
  const groupCount = view.getUint32(12, true);
  if (vertexCount !== header.vertexCount || triangleCount !== header.triangleCount) {
    throw new Error('The native CAD mesh counts do not match their validated header.');
  }

  const positionsOffset = 16;
  const vectorBytes = vertexCount * 3 * 4;
  const normalsOffset = positionsOffset + vectorBytes;
  const indicesOffset = normalsOffset + vectorBytes;
  const indexBytes = triangleCount * 3 * 4;
  const groupsOffset = indicesOffset + indexBytes;
  if (groupsOffset + groupCount * 24 !== payload.byteLength) {
    throw new Error('The native CAD mesh payload has an invalid length.');
  }

  const geometry = new BufferGeometry();
  geometry.name = header.batchId ?? 'CAD body';
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(payload.buffer, positionsOffset, vertexCount * 3), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(payload.buffer, normalsOffset, vertexCount * 3), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(payload.buffer, indicesOffset, triangleCount * 3), 1));

  const materials: Material[] = [];
  for (let index = 0; index < groupCount; index += 1) {
    const offset = groupsOffset + index * 24;
    const firstTriangle = view.getUint32(offset, true);
    const count = view.getUint32(offset + 4, true);
    materials.push(materialForColor(
      view.getFloat32(offset + 8, true),
      view.getFloat32(offset + 12, true),
      view.getFloat32(offset + 16, true),
      view.getFloat32(offset + 20, true),
    ));
    geometry.addGroup(firstTriangle * 3, count * 3, index);
  }

  const mesh = new Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = header.batchId ?? 'CAD body';
  return mesh;
}

export async function importNativeCadFile(
  pendingId: number,
  name: string,
  sourceSize: number,
  onProgress: (progress: LoadProgress) => void,
  signal?: AbortSignal,
  progressive?: NativeCadProgressiveHandlers,
): Promise<{ file: File; warning: string | null }> {
  throwIfLoadCancelled(signal);
  const sessionId = crypto.randomUUID();
  const root = new Group();
  root.name = name.replace(/\.[^.]+$/, '');
  let manifestSeen = false;
  let terminalStatus: NativeCadHeader['status'];
  let terminalMessage: string | undefined;
  let eventError: Error | null = null;
  const events = new Channel<NativeBytes>();
  const terminalDelivery = createNativeCadDeliveryBarrier();

  events.onmessage = (value) => {
    if (eventError) return;
    try {
      const { header, payload } = readFrame(value);
      if (header.type === 'manifest') {
        const manifest = JSON.parse(new TextDecoder().decode(payload)) as { nodes?: Array<{ displayName?: string }> };
        root.name = manifest.nodes?.[0]?.displayName?.trim() || root.name;
        manifestSeen = true;
      } else if (header.type === 'meshBatch') {
        root.add(meshFromBatch(header, payload));
        if (root.children.length === 1) progressive?.onFirstBatch?.(root);
        progressive?.onBatch?.(root);
      } else if (header.type === 'progress') {
        const total = header.total ?? 0;
        onProgress({ stage: 'decoding', value: total > 0 ? (header.completed ?? 0) / total : undefined });
      } else if (header.type === 'terminal') {
        terminalStatus = header.status;
        terminalMessage = header.message;
        terminalDelivery.markDelivered();
      }
    } catch (error) {
      eventError = error instanceof Error ? error : new Error(String(error));
      terminalDelivery.markDelivered();
      void invoke('cancel_native_cad_import', { sessionId }).catch(() => undefined);
    }
  };

  const abort = () => { void invoke('cancel_native_cad_import', { sessionId }).catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  let completed = false;
  try {
    await invoke('import_pending_native_cad', { id: pendingId, sessionId, events });
    // Tauri does not guarantee that queued channel callbacks run before the command promise resolves.
    await terminalDelivery.wait();
    throwIfLoadCancelled(signal);
    if (eventError) throw eventError;
    if (terminalStatus === 'cancelled') throw loadCancelledError();
    if (terminalStatus !== 'success') throw new Error(terminalMessage || 'The native CAD worker could not open this STEP file.');
    if (!manifestSeen || root.children.length === 0) throw new Error('The native CAD worker did not produce renderable geometry.');

    const file = new File([], name, { lastModified: Date.now() });
    registerPreparedModel(file, {
      scene: root,
      animations: [],
      totalSize: sourceSize,
      sourceUnit: 'mm',
      upAxis: 'z',
    });
    completed = true;
    return { file, warning: terminalMessage?.trim() || null };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) {
      if (progressive?.onDiscard) progressive.onDiscard(root);
      else disposeObject3D(root);
    }
  }
}
