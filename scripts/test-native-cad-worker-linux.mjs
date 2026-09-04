import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'linux') process.exit(0);

const worker = resolve(process.env.KEA3D_NATIVE_CAD_WORKER ?? 'native/cad-worker/build-linux/kea3d-cad-worker');
const fixture = resolve(process.env.KEA3D_NATIVE_CAD_FIXTURE
  ?? 'node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp');
const sessionId = 'linux-material-smoke';
const maxHeaderBytes = 64 * 1024;
const maxPayloadBytes = 64 * 1024 * 1024;

async function fingerprint(path) {
  const metadata = await stat(path);
  const bytes = await readFile(path);
  return {
    size: metadata.size,
    modified: metadata.mtimeMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const before = await fingerprint(fixture);
const result = spawnSync(worker, [
  '--protocol', '1', '--session', sessionId, '--input', fixture,
], { encoding: null, maxBuffer: 128 * 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Native Linux CAD worker failed (${result.status}): ${result.stderr.toString('utf8')}`);
}

let offset = 0;
let sequence = 1;
let manifests = 0;
let batches = 0;
let colorGroups = 0;
let coloredFaces = 0;
let terminalStatus = null;
while (offset < result.stdout.length) {
  if (offset + 4 > result.stdout.length) throw new Error('Native CAD stream ended inside a frame length.');
  const headerLength = result.stdout.readUInt32LE(offset);
  offset += 4;
  if (headerLength === 0 || headerLength > maxHeaderBytes || offset + headerLength > result.stdout.length) {
    throw new Error(`Invalid native CAD header length: ${headerLength}`);
  }
  const header = JSON.parse(result.stdout.subarray(offset, offset + headerLength).toString('utf8'));
  offset += headerLength;
  if (header.protocolVersion !== 1 || header.sessionId !== sessionId || header.sequence !== sequence) {
    throw new Error(`Native CAD protocol ordering failed at sequence ${sequence}.`);
  }
  sequence += 1;
  const payloadLength = Number(header.payloadLength);
  if (!Number.isSafeInteger(payloadLength) || payloadLength < 0 || payloadLength > maxPayloadBytes) {
    throw new Error(`Invalid native CAD payload length: ${header.payloadLength}`);
  }
  if (offset + payloadLength > result.stdout.length) throw new Error('Native CAD stream ended inside a payload.');
  const payload = result.stdout.subarray(offset, offset + payloadLength);
  offset += payloadLength;

  if (header.type === 'manifest') {
    JSON.parse(payload.toString('utf8'));
    manifests += 1;
  } else if (header.type === 'meshBatch') {
    if (manifests !== 1 || payload.length < 16 || payload.toString('ascii', 0, 4) !== 'K3M1') {
      throw new Error('Invalid native CAD mesh payload ordering or signature.');
    }
    const vertices = payload.readUInt32LE(4);
    const triangles = payload.readUInt32LE(8);
    const groups = payload.readUInt32LE(12);
    const expectedLength = 16 + vertices * 24 + triangles * 12 + groups * 24;
    if (expectedLength !== payload.length || vertices !== header.vertexCount || triangles !== header.triangleCount) {
      throw new Error('Native CAD mesh counts do not match its payload.');
    }
    batches += 1;
    colorGroups += groups;
    coloredFaces += Number(header.coloredFaceCount);
  } else if (header.type === 'terminal') {
    terminalStatus = header.status;
  } else if (header.type !== 'progress') {
    throw new Error(`Unknown native CAD event type: ${header.type}`);
  }
}

const after = await fingerprint(fixture);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('The native CAD worker modified its source fixture.');
if (manifests !== 1 || batches < 1 || colorGroups < 1 || coloredFaces < 1 || terminalStatus !== 'success') {
  throw new Error(`Native Linux CAD material smoke failed: ${JSON.stringify({ manifests, batches, colorGroups, coloredFaces, terminalStatus })}`);
}
console.log(`Native Linux CAD material smoke passed: ${batches} batch, ${coloredFaces} colored faces, ${colorGroups} color groups.`);
