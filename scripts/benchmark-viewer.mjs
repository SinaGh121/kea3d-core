import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function parseArguments(arguments_) {
  const options = {
    files: [], repeat: 3, output: '', port: 4174, cacheMode: 'isolated', timeoutMs: 300_000,
    verifyCacheInvalidation: false, maxProcessTreeMiB: 0, maxGpuProcessMiB: 0, headed: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === '--file' && value) { options.files.push(resolve(value)); index += 1; }
    else if (argument === '--repeat' && value) { options.repeat = Number.parseInt(value, 10); index += 1; }
    else if (argument === '--output' && value) { options.output = resolve(value); index += 1; }
    else if (argument === '--port' && value) { options.port = Number.parseInt(value, 10); index += 1; }
    else if (argument === '--cache-mode' && value) { options.cacheMode = value; index += 1; }
    else if (argument === '--timeout-ms' && value) { options.timeoutMs = Number.parseInt(value, 10); index += 1; }
    else if (argument === '--verify-cache-invalidation') options.verifyCacheInvalidation = true;
    else if (argument === '--max-process-tree-mib' && value) { options.maxProcessTreeMiB = Number.parseFloat(value); index += 1; }
    else if (argument === '--max-gpu-process-mib' && value) { options.maxGpuProcessMiB = Number.parseFloat(value); index += 1; }
    else if (argument === '--headed') options.headed = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  if (options.files.length === 0) options.files.push(resolve('tests/fixtures/AnimatedMorphCube.glb'));
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 20) throw new Error('--repeat must be between 1 and 20.');
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('--port must be between 1024 and 65535.');
  if (!['isolated', 'cold-warm'].includes(options.cacheMode)) throw new Error('--cache-mode must be isolated or cold-warm.');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) throw new Error('--timeout-ms must be at least 1000.');
  if (options.verifyCacheInvalidation && options.cacheMode !== 'cold-warm') throw new Error('--verify-cache-invalidation requires --cache-mode cold-warm.');
  if (![options.maxProcessTreeMiB, options.maxGpuProcessMiB].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Memory limits must be non-negative numbers.');
  return options;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Preview did not start at ${url}.`);
}

function metricValue(metrics, name) {
  return metrics.find((metric) => metric.name === name)?.value ?? null;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function maximumAvailable(values) {
  const available = values.filter((value) => Number.isFinite(value));
  return available.length > 0 ? Math.max(...available) : null;
}

function summarize(runs) {
  const groups = [...new Set(runs.map((run) => `${run.file}\0${run.cacheState}`))];
  return groups.map((group) => {
    const [file, cacheState] = group.split('\0');
    const matching = runs.filter((run) => run.file === file && run.cacheState === cacheState);
    const stageNames = [...new Set(matching.flatMap((run) => Object.keys(run.load.stagesMs)))];
    return {
      file,
      cacheState,
      runs: matching.length,
      averageTotalMs: average(matching.map((run) => run.load.totalMs)),
      slowestTotalMs: Math.max(...matching.map((run) => run.load.totalMs)),
      averageStagesMs: Object.fromEntries(stageNames.map((stage) => [
        stage,
        average(matching.map((run) => run.load.stagesMs[stage] ?? 0)),
      ])),
      peakJsHeapUsedMiB: Math.max(...matching.map((run) => run.browser.jsHeapUsedMiB ?? 0)),
      peakIndexedDbMiB: Math.max(...matching.map((run) => run.browser.indexedDbMiB ?? 0)),
      peakProcessTreeWorkingSetMiB: maximumAvailable(matching.map((run) => run.processTree?.peakWorkingSetMiB)),
      peakProcessTreePrivateMemoryMiB: maximumAvailable(matching.map((run) => run.processTree?.peakPrivateMemoryMiB)),
      peakGpuProcessWorkingSetMiB: maximumAvailable(matching.map((run) => run.processTree?.peakGpuProcessWorkingSetMiB)),
      peakGpuDedicatedMiB: maximumAvailable(matching.map((run) => run.processTree?.peakGpuDedicatedMiB)),
      peakGpuSharedMiB: maximumAvailable(matching.map((run) => run.processTree?.peakGpuSharedMiB)),
    };
  });
}

function compareCadCache(summaries) {
  const files = [...new Set(summaries.map((summary) => summary.file))];
  return files.flatMap((file) => {
    const cold = summaries.find((summary) => summary.file === file && summary.cacheState === 'cold');
    const warm = summaries.find((summary) => summary.file === file && summary.cacheState === 'warm');
    if (!cold || !warm) return [];
    return [{
      file,
      coldAverageTotalMs: cold.averageTotalMs,
      warmAverageTotalMs: warm.averageTotalMs,
      speedup: cold.averageTotalMs / warm.averageTotalMs,
      reductionPercent: (1 - warm.averageTotalMs / cold.averageTotalMs) * 100,
      indexedDbMiB: Math.max(cold.peakIndexedDbMiB, warm.peakIndexedDbMiB),
    }];
  });
}

function memoryLimitViolations(summaries, options) {
  return summaries.flatMap((summary) => {
    const violations = [];
    if (options.maxProcessTreeMiB > 0 && summary.peakProcessTreeWorkingSetMiB > options.maxProcessTreeMiB) {
      violations.push(`${summary.file} (${summary.cacheState}) process-tree peak ${summary.peakProcessTreeWorkingSetMiB.toFixed(1)} MiB exceeds ${options.maxProcessTreeMiB.toFixed(1)} MiB`);
    }
    if (options.maxGpuProcessMiB > 0 && summary.peakGpuProcessWorkingSetMiB > options.maxGpuProcessMiB) {
      violations.push(`${summary.file} (${summary.cacheState}) GPU-process peak ${summary.peakGpuProcessWorkingSetMiB.toFixed(1)} MiB exceeds ${options.maxGpuProcessMiB.toFixed(1)} MiB`);
    }
    return violations;
  });
}

function isCadFile(file) {
  return /\.(?:step|stp|iges|igs|brep)$/i.test(file);
}

function fileLabel(file) {
  return typeof file === 'string' ? basename(file) : file.name;
}

async function createDigestVariant(file) {
  const source = await readFile(file);
  return {
    name: basename(file),
    mimeType: 'application/octet-stream',
    buffer: Buffer.concat([source, Buffer.from('\n')]),
  };
}

function promiseWithTimeout(promise, timeoutMs, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => clearTimeout(timeout));
}

async function startProcessTreeSampler(rootProcessId) {
  if (process.platform !== 'win32' || !rootProcessId) return null;
  const directory = await mkdtemp(join(tmpdir(), 'kea3d-benchmark-'));
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
  try {
    await promiseWithTimeout(new Promise((resolveReady, rejectReady) => {
      const checkReady = () => { if (stdout.includes('READY')) resolveReady(); };
      child.stdout.on('data', checkReady);
      child.once('exit', (code) => rejectReady(new Error(`Process sampler exited before it was ready (${code}): ${stderr.trim()}`)));
    }), 15_000, 'Windows process sampler did not become ready.');
  } catch (error) {
    child.kill();
    await rmdir(directory).catch(() => undefined);
    throw error;
  }

  return {
    async stop() {
      await writeFile(stopFile, 'stop');
      const exitCode = await promiseWithTimeout(new Promise((resolveExit) => child.once('exit', resolveExit)), 15_000, 'Windows process sampler did not stop.');
      try {
        if (exitCode !== 0) throw new Error(`Windows process sampler failed (${exitCode}): ${stderr.trim()}`);
        const json = stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
        if (!json) throw new Error(`Windows process sampler returned no metrics: ${stderr.trim()}`);
        return JSON.parse(json);
      } finally {
        await rm(stopFile, { force: true });
        await rmdir(directory).catch(() => undefined);
      }
    },
  };
}

async function waitForLoadMetric(page, file, timeoutMs) {
  const metricPromise = page.evaluate(() => new Promise((resolveMetric) => {
    globalThis.addEventListener('kea3d:load-metric', (event) => resolveMetric(event.detail), { once: true });
  }));
  await page.locator('input[type="file"]').first().setInputFiles(file);
  let timeout;
  try {
    return await Promise.race([
      metricPromise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${fileLabel(file)} exceeded the ${timeoutMs} ms benchmark timeout.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForCadCache(page, minimumEntries, timeoutMs) {
  return await page.evaluate(async ({ minimum, timeout }) => {
    const deadline = Date.now() + timeout;
    const recordCount = () => new Promise((resolveCount) => {
      const request = globalThis.indexedDB.open('kea3d-cad-cache', 1);
      request.onerror = () => resolveCount(0);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('tessellations', 'readonly');
        const count = transaction.objectStore('tessellations').count();
        count.onerror = () => { database.close(); resolveCount(0); };
        count.onsuccess = () => { database.close(); resolveCount(count.result); };
      };
    });
    while (Date.now() < deadline) {
      const count = await recordCount();
      if (count >= minimum) return count;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error('Timed out waiting for the CAD cache write to finish.');
  }, { minimum: minimumEntries, timeout: timeoutMs });
}

async function runPage(context, file, iteration, cacheState, timeoutMs, browserProcessId) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const sampler = await startProcessTreeSampler(browserProcessId);
    let load;
    let performanceMetrics = [];
    let storage = { usage: 0, usageBreakdown: [] };
    let processTree = null;
    try {
      load = await waitForLoadMetric(page, file, timeoutMs);
      await page.waitForTimeout(250);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      performanceMetrics = (await cdp.send('Performance.getMetrics')).metrics;
      try {
        storage = await cdp.send('Storage.getUsageAndQuota', { origin: baseUrl });
      } catch {
        // Storage accounting is unavailable in some Chromium builds.
      }
    } finally {
      if (sampler) processTree = await sampler.stop();
    }
    const indexedDbBytes = storage.usageBreakdown.find((entry) => entry.storageType === 'indexeddb')?.usage ?? 0;
    const run = {
      file: fileLabel(file),
      iteration,
      cacheState,
      load,
      browser: {
        jsHeapUsedMiB: (metricValue(performanceMetrics, 'JSHeapUsedSize') ?? 0) / 1024 / 1024,
        jsHeapTotalMiB: (metricValue(performanceMetrics, 'JSHeapTotalSize') ?? 0) / 1024 / 1024,
        documents: metricValue(performanceMetrics, 'Documents'),
        nodes: metricValue(performanceMetrics, 'Nodes'),
        originStorageMiB: storage.usage / 1024 / 1024,
        indexedDbMiB: indexedDbBytes / 1024 / 1024,
      },
      processTree,
      errors,
    };
    if (load.status !== 'success' || errors.length > 0) throw new Error(`${fileLabel(file)} benchmark run ${iteration} (${cacheState}) failed.`);
    return { page, run };
  } catch (error) {
    await page.close();
    throw error;
  }
}

const options = parseArguments(process.argv.slice(2));
const baseUrl = `http://127.0.0.1:${options.port}`;
const preview = spawn(process.execPath, [
  resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(options.port), '--strictPort',
], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let previewError = '';
preview.stderr.on('data', (chunk) => { previewError += chunk.toString(); });

let browser;
let browserServer;
try {
  await waitForServer(baseUrl);
  browserServer = await chromium.launchServer({ headless: !options.headed, args: ['--enable-precise-memory-info'] });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const browserProcessId = browserServer.process().pid;
  let gpu = null;
  try {
    const browserCdp = await browser.newBrowserCDPSession();
    const systemInfo = await browserCdp.send('SystemInfo.getInfo');
    gpu = {
      devices: systemInfo.gpu.devices.map(({ deviceString, vendorString, driverVendor, driverVersion }) => ({ deviceString, vendorString, driverVendor, driverVersion })),
      renderer: systemInfo.gpu.auxAttributes?.glRenderer ?? null,
      vendor: systemInfo.gpu.auxAttributes?.glVendor ?? null,
      featureStatus: systemInfo.gpu.featureStatus,
    };
  } catch {
    // GPU identity is optional; process sampling still runs on Windows.
  }
  const runs = [];
  const cacheInvalidations = [];
  for (const file of options.files) {
    const digestVariant = options.verifyCacheInvalidation && isCadFile(file) ? await createDigestVariant(file) : null;
    for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        if (options.cacheMode === 'cold-warm' && isCadFile(file)) {
          const cold = await runPage(context, file, iteration, 'cold', options.timeoutMs, browserProcessId);
          runs.push(cold.run);
          const entriesAfterOriginal = await waitForCadCache(cold.page, 1, options.timeoutMs);
          await cold.page.close();
          const warm = await runPage(context, file, iteration, 'warm', options.timeoutMs, browserProcessId);
          runs.push(warm.run);
          await warm.page.close();
          if (cold.run.load.cadCache !== 'miss' || warm.run.load.cadCache !== 'hit') {
            throw new Error(`${basename(file)} did not produce the expected cold-miss/warm-hit cache sequence.`);
          }
          if (digestVariant) {
            const invalidated = await runPage(context, digestVariant, iteration, 'changed-source', options.timeoutMs, browserProcessId);
            runs.push(invalidated.run);
            const entriesAfterChangedSource = await waitForCadCache(invalidated.page, 2, options.timeoutMs);
            await invalidated.page.close();
            if (invalidated.run.load.cadCache !== 'miss') {
              throw new Error(`${basename(file)} changed-source probe reused a stale CAD cache entry.`);
            }
            cacheInvalidations.push({
              file: basename(file),
              iteration,
              outcome: 'pass',
              entriesAfterOriginal,
              entriesAfterChangedSource,
            });
          }
        } else {
          const isolated = await runPage(context, file, iteration, 'isolated', options.timeoutMs, browserProcessId);
          runs.push(isolated.run);
          await isolated.page.close();
        }
      } finally {
        await context.close();
      }
    }
  }

  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const summaries = summarize(runs);
  const memoryLimits = { processTreeMiB: options.maxProcessTreeMiB || null, gpuProcessMiB: options.maxGpuProcessMiB || null };
  const limitViolations = memoryLimitViolations(summaries, options);
  const report = {
    schema: 'kea3d-viewer-benchmark-v2',
    createdAt: new Date().toISOString(),
    commit,
    platform: { os: process.platform, arch: process.arch, node: process.version, browser: browser.version(), browserMode: options.headed ? 'headed' : 'headless', processTreeSampling: process.platform === 'win32' ? 'windows-200ms' : 'unavailable', gpu },
    repeat: options.repeat,
    cacheMode: options.cacheMode,
    verifyCacheInvalidation: options.verifyCacheInvalidation,
    summaries,
    cadCacheComparisons: compareCadCache(summaries),
    cacheInvalidations,
    memoryLimits,
    limitViolations,
    runs,
  };
  const defaultName = `viewer-${report.createdAt.replaceAll(':', '-').replaceAll('.', '-')}.json`;
  const output = options.output || resolve('artifacts/benchmarks', defaultName);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${runs.length} benchmark run(s) to ${output}`);
  for (const run of runs) {
    const processMemory = run.processTree ? `, ${run.processTree.peakWorkingSetMiB.toFixed(1)} MiB process-tree peak` : '';
    console.log(`${run.file} #${run.iteration} (${run.cacheState}): ${run.load.totalMs.toFixed(1)} ms, ${run.browser.jsHeapUsedMiB.toFixed(1)} MiB JS heap, ${run.browser.indexedDbMiB.toFixed(1)} MiB IndexedDB${processMemory}`);
  }
  for (const comparison of report.cadCacheComparisons) {
    console.log(`${comparison.file} warm-cache speedup: ${comparison.speedup.toFixed(2)}x (${comparison.reductionPercent.toFixed(1)}% less time)`);
  }
  for (const invalidation of report.cacheInvalidations) {
    console.log(`${invalidation.file} source-digest invalidation: ${invalidation.outcome} (${invalidation.entriesAfterOriginal} -> ${invalidation.entriesAfterChangedSource} entries)`);
  }
  if (report.limitViolations.length > 0) throw new Error(`Memory regression gate failed:\n${report.limitViolations.join('\n')}`);
} finally {
  if (browser) await browser.close();
  if (browserServer) await browserServer.close();
  preview.kill();
  if (preview.exitCode && preview.exitCode !== 0) process.stderr.write(previewError);
}
