import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_MESH_BYTES = 64 * 1024 * 1024;

function parsePositiveNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${option} must be a positive number.`);
  return parsed;
}

function parseOptions(arguments_) {
  const options = {
    files: [],
    worker: resolve('native/cad-worker/build/Release/kea3d-cad-worker.exe'),
    repeat: 1,
    timeoutMs: 10 * 60 * 1000,
    output: null,
    maxProcessTreeMiB: null,
    maxTotalSeconds: null,
    expectedBatches: null,
    expectedTriangles: null,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${option}.`);
    if (option === '--file') {
      options.files.push(resolve(value)); index += 1;
    } else if (option === '--worker') {
      options.worker = resolve(value); index += 1;
    } else if (option === '--repeat') {
      options.repeat = parsePositiveNumber(value, option); index += 1;
    } else if (option === '--timeout-ms') {
      options.timeoutMs = parsePositiveNumber(value, option); index += 1;
    } else if (option === '--output') {
      options.output = resolve(value); index += 1;
    } else if (option === '--max-process-tree-mib') {
      options.maxProcessTreeMiB = parsePositiveNumber(value, option); index += 1;
    } else if (option === '--max-total-seconds') {
      options.maxTotalSeconds = parsePositiveNumber(value, option); index += 1;
    } else if (option === '--expected-batches') {
      options.expectedBatches = parsePositiveNumber(value, option); index += 1;
    } else if (option === '--expected-triangles') {
      options.expectedTriangles = parsePositiveNumber(value, option); index += 1;
    }
    else throw new Error(`Unknown or incomplete option: ${option}`);
  }
  if (process.platform !== 'win32') throw new Error('The native CAD benchmark currently requires Windows x64.');
  if (options.files.length === 0) throw new Error('Provide at least one STEP file with --file.');
  if (!Number.isInteger(options.repeat)) throw new Error('--repeat must be an integer.');
  return options;
}

class ExactReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.chunk = Buffer.alloc(0);
    this.offset = 0;
    this.ended = false;
  }

  async fill() {
    if (this.offset < this.chunk.length) return true;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    this.chunk = Buffer.from(next.value);
    this.offset = 0;
    return true;
  }

  async readExact(length, allowEof = false) {
    const result = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      if (!(await this.fill())) {
        if (allowEof && written === 0) return null;
        throw new Error('Native CAD worker stream ended inside a frame.');
      }
      const available = this.chunk.length - this.offset;
      const take = Math.min(available, length - written);
      this.chunk.copy(result, written, this.offset, this.offset + take);
      this.offset += take;
      written += take;
    }
    return result;
  }

  async discardExact(length) {
    let remaining = length;
    while (remaining > 0) {
      if (!(await this.fill())) throw new Error('Native CAD worker stream ended inside a payload.');
      const take = Math.min(this.chunk.length - this.offset, remaining);
      this.offset += take;
      remaining -= take;
    }
  }
}

function waitForExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

async function startProcessTreeSampler(rootProcessId) {
  const directory = await mkdtemp(join(tmpdir(), 'kea3d-native-benchmark-'));
  const stopFile = join(directory, 'stop');
  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', resolve('scripts/sample-windows-process-tree.ps1'),
    '-RootProcessId', String(rootProcessId), '-StopFile', stopFile, '-IntervalMilliseconds', '200',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const deadline = Date.now() + 15_000;
  while (!stdout.includes('READY') && child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  if (!stdout.includes('READY')) {
    child.kill();
    await rm(directory, { recursive: true, force: true });
    throw new Error(`Windows process sampler did not become ready: ${stderr.trim()}`);
  }
  return async () => {
    await writeFile(stopFile, 'stop');
    const exit = await waitForExit(child);
    try {
      if (exit.code !== 0) throw new Error(`Windows process sampler failed (${exit.code}): ${stderr.trim()}`);
      const json = stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
      if (!json) throw new Error('Windows process sampler returned no metrics.');
      return JSON.parse(json);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function seconds(startedAt, timestamp = performance.now()) {
  return Number(((timestamp - startedAt) / 1000).toFixed(3));
}

async function readWorkerStream(stream, sessionId, startedAt) {
  const reader = new ExactReader(stream);
  const metrics = {
    frames: 0,
    manifests: 0,
    batches: 0,
    faces: 0,
    coloredFaces: 0,
    vertices: 0,
    triangles: 0,
    payloadBytes: 0,
    readingSeconds: null,
    transferSeconds: null,
    manifestSeconds: null,
    firstBatchSeconds: null,
    firstBatchAfterManifestSeconds: null,
    terminal: null,
  };
  let expectedSequence = 1;
  let transferStartedAt = null;
  while (true) {
    const lengthBytes = await reader.readExact(4, true);
    if (!lengthBytes) break;
    const headerLength = lengthBytes.readUInt32LE(0);
    if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) throw new Error(`Invalid native CAD header length: ${headerLength}`);
    const header = JSON.parse((await reader.readExact(headerLength)).toString('utf8'));
    if (header.protocolVersion !== 1 || header.sessionId !== sessionId || header.sequence !== expectedSequence) {
      throw new Error(`Native CAD protocol ordering failed at sequence ${expectedSequence}.`);
    }
    expectedSequence += 1;
    metrics.frames += 1;
    const payloadLength = Number(header.payloadLength);
    if (!Number.isSafeInteger(payloadLength) || payloadLength < 0) throw new Error('Invalid native CAD payload length.');
    metrics.payloadBytes += payloadLength;
    const now = performance.now();

    if (header.type === 'manifest') {
      if (payloadLength === 0 || payloadLength > MAX_MANIFEST_BYTES) throw new Error('Invalid native CAD manifest payload.');
      JSON.parse((await reader.readExact(payloadLength)).toString('utf8'));
      metrics.manifests += 1;
      metrics.manifestSeconds ??= seconds(startedAt, now);
    } else if (header.type === 'meshBatch') {
      if (metrics.manifests !== 1 || payloadLength < 16 || payloadLength > MAX_MESH_BYTES) throw new Error('Invalid native CAD mesh payload ordering or size.');
      const prefix = await reader.readExact(16);
      if (prefix.toString('ascii', 0, 4) !== 'K3M1') throw new Error('Invalid kea3d-mesh-v1 signature.');
      const vertices = prefix.readUInt32LE(4);
      const triangles = prefix.readUInt32LE(8);
      const groups = prefix.readUInt32LE(12);
      const expectedLength = 16 + vertices * 24 + triangles * 12 + groups * 24;
      if (vertices !== header.vertexCount || triangles !== header.triangleCount || expectedLength !== payloadLength) {
        throw new Error('Native CAD mesh payload counts do not match its frame.');
      }
      await reader.discardExact(payloadLength - 16);
      metrics.batches += 1;
      metrics.faces += header.faceCount;
      metrics.coloredFaces += header.coloredFaceCount;
      metrics.vertices += vertices;
      metrics.triangles += triangles;
      if (metrics.firstBatchSeconds === null) {
        metrics.firstBatchSeconds = seconds(startedAt, now);
        metrics.firstBatchAfterManifestSeconds = metrics.manifestSeconds === null ? null : Number((metrics.firstBatchSeconds - metrics.manifestSeconds).toFixed(3));
      }
    } else {
      if (payloadLength !== 0) throw new Error(`${header.type} must not contain a payload.`);
      if (header.type === 'progress') {
        if (header.stage === 'reading' && header.completed === header.total) metrics.readingSeconds = seconds(startedAt, now);
        if (header.stage === 'transferring' && header.completed === 0) transferStartedAt = now;
        if (header.stage === 'transferring' && header.completed === header.total) {
          metrics.transferSeconds = transferStartedAt === null ? null : seconds(transferStartedAt, now);
        }
      } else if (header.type === 'terminal') {
        metrics.terminal = { status: header.status, message: header.message || null };
      } else {
        throw new Error(`Unknown native CAD event type: ${header.type}`);
      }
    }
  }
  if (metrics.manifests !== 1 || !metrics.terminal) throw new Error('Native CAD stream ended without one manifest and a terminal event.');
  return metrics;
}

async function runOnce(file, worker, iteration, timeoutMs) {
  const before = await stat(file);
  const sessionId = `benchmark-${process.pid}-${iteration}-${Date.now()}`;
  const child = spawn(worker, ['--protocol', '1', '--session', sessionId, '--input', file], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdin.end();
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const startedAt = performance.now();
  const stopSampler = await startProcessTreeSampler(child.pid);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  let stream;
  let exit;
  let processTree;
  let totalSeconds;
  const exitPromise = waitForExit(child);
  try {
    [stream, exit] = await Promise.all([
      readWorkerStream(child.stdout, sessionId, startedAt),
      exitPromise,
    ]);
    totalSeconds = seconds(startedAt);
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    await exitPromise.catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
    processTree = await stopSampler();
  }
  if (timedOut) throw new Error(`${basename(file)} exceeded the ${timeoutMs} ms native CAD timeout.`);
  if (exit.code !== 0 || stream.terminal.status !== 'success') {
    throw new Error(`Native CAD worker failed (${exit.code ?? exit.signal}): ${stream.terminal.message || stderr.trim()}`);
  }
  const after = await stat(file);
  return {
    file: basename(file),
    iteration,
    timing: { ...stream, totalSeconds },
    processTree,
    sourceModified: before.size !== after.size || before.mtimeMs !== after.mtimeMs,
  };
}

function maxOf(runs, getter) {
  return Math.max(...runs.map(getter));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  await stat(options.worker);
  const files = await Promise.all(options.files.map(async (file) => {
    const metadata = await stat(file);
    if (!['.step', '.stp'].includes(extname(file).toLowerCase())) throw new Error(`${basename(file)} is not a STEP file.`);
    return { name: basename(file), sizeBytes: metadata.size, sha256: await sha256(file) };
  }));
  const runs = [];
  for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
    for (const file of options.files) runs.push(await runOnce(file, options.worker, iteration, options.timeoutMs));
  }
  const summary = {
    maxTotalSeconds: maxOf(runs, (run) => run.timing.totalSeconds),
    maxProcessTreeWorkingSetMiB: maxOf(runs, (run) => run.processTree.peakWorkingSetMiB),
    maxProcessTreePrivateMemoryMiB: maxOf(runs, (run) => run.processTree.peakPrivateMemoryMiB),
    maxObservedCpuSeconds: maxOf(runs, (run) => run.processTree.observedCpuSeconds),
  };
  const violations = [];
  for (const run of runs) {
    if (run.sourceModified) violations.push(`${run.file}: source file was modified`);
    if (options.maxProcessTreeMiB && run.processTree.peakWorkingSetMiB > options.maxProcessTreeMiB) violations.push(`${run.file}: ${run.processTree.peakWorkingSetMiB} MiB exceeds process-tree limit ${options.maxProcessTreeMiB} MiB`);
    if (options.maxTotalSeconds && run.timing.totalSeconds > options.maxTotalSeconds) violations.push(`${run.file}: ${run.timing.totalSeconds}s exceeds time limit ${options.maxTotalSeconds}s`);
    if (options.expectedBatches && run.timing.batches !== options.expectedBatches) violations.push(`${run.file}: expected ${options.expectedBatches} batches, received ${run.timing.batches}`);
    if (options.expectedTriangles && run.timing.triangles !== options.expectedTriangles) violations.push(`${run.file}: expected ${options.expectedTriangles} triangles, received ${run.timing.triangles}`);
  }
  const report = {
    schema: 'kea3d-native-cad-benchmark-v1',
    generatedAt: new Date().toISOString(),
    platform: { platform: process.platform, architecture: process.arch, node: process.version },
    worker: basename(options.worker),
    files,
    limits: {
      timeoutMs: options.timeoutMs,
      processTreeMiB: options.maxProcessTreeMiB,
      totalSeconds: options.maxTotalSeconds,
      expectedBatches: options.expectedBatches,
      expectedTriangles: options.expectedTriangles,
    },
    summary,
    violations,
    runs,
  };
  const output = options.output || resolve('artifacts/benchmarks', `native-cad-${Date.now()}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${runs.length} native CAD benchmark run(s) to ${output}`);
  console.log(JSON.stringify(summary));
  if (violations.length > 0) throw new Error(`Native CAD benchmark limits failed:\n- ${violations.join('\n- ')}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
