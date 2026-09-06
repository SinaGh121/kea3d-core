import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function parseArguments(arguments_) {
  const options = { files: [], repeat: 3, output: '', port: 4174 };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === '--file' && value) { options.files.push(resolve(value)); index += 1; }
    else if (argument === '--repeat' && value) { options.repeat = Number.parseInt(value, 10); index += 1; }
    else if (argument === '--output' && value) { options.output = resolve(value); index += 1; }
    else if (argument === '--port' && value) { options.port = Number.parseInt(value, 10); index += 1; }
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  if (options.files.length === 0) options.files.push(resolve('tests/fixtures/AnimatedMorphCube.glb'));
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 20) throw new Error('--repeat must be between 1 and 20.');
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('--port must be between 1024 and 65535.');
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

function summarize(runs) {
  return [...new Set(runs.map((run) => run.file))].map((file) => {
    const matching = runs.filter((run) => run.file === file);
    const stageNames = [...new Set(matching.flatMap((run) => Object.keys(run.load.stagesMs)))];
    return {
      file,
      runs: matching.length,
      averageTotalMs: average(matching.map((run) => run.load.totalMs)),
      slowestTotalMs: Math.max(...matching.map((run) => run.load.totalMs)),
      averageStagesMs: Object.fromEntries(stageNames.map((stage) => [
        stage,
        average(matching.map((run) => run.load.stagesMs[stage] ?? 0)),
      ])),
      peakJsHeapUsedMiB: Math.max(...matching.map((run) => run.browser.jsHeapUsedMiB ?? 0)),
    };
  });
}

const options = parseArguments(process.argv.slice(2));
const baseUrl = `http://127.0.0.1:${options.port}`;
const preview = spawn(process.execPath, [
  resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(options.port), '--strictPort',
], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let previewError = '';
preview.stderr.on('data', (chunk) => { previewError += chunk.toString(); });

let browser;
try {
  await waitForServer(baseUrl);
  browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
  const runs = [];
  for (const file of options.files) {
    for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      const metricPromise = page.evaluate(() => new Promise((resolveMetric) => {
        globalThis.addEventListener('kea3d:load-metric', (event) => resolveMetric(event.detail), { once: true });
      }));
      await page.locator('input[type="file"]').first().setInputFiles(file);
      const load = await metricPromise;
      await page.waitForTimeout(250);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const performanceMetrics = (await cdp.send('Performance.getMetrics')).metrics;
      runs.push({
        file: basename(file),
        iteration,
        load,
        browser: {
          jsHeapUsedMiB: (metricValue(performanceMetrics, 'JSHeapUsedSize') ?? 0) / 1024 / 1024,
          jsHeapTotalMiB: (metricValue(performanceMetrics, 'JSHeapTotalSize') ?? 0) / 1024 / 1024,
          documents: metricValue(performanceMetrics, 'Documents'),
          nodes: metricValue(performanceMetrics, 'Nodes'),
        },
        errors,
      });
      await context.close();
      if (load.status !== 'success' || errors.length > 0) throw new Error(`${basename(file)} benchmark run ${iteration} failed.`);
    }
  }

  const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const report = {
    schema: 'kea3d-viewer-benchmark-v1',
    createdAt: new Date().toISOString(),
    commit,
    platform: { os: process.platform, arch: process.arch, node: process.version, browser: browser.version() },
    repeat: options.repeat,
    summaries: summarize(runs),
    runs,
  };
  const defaultName = `viewer-${report.createdAt.replaceAll(':', '-').replaceAll('.', '-')}.json`;
  const output = options.output || resolve('artifacts/benchmarks', defaultName);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${runs.length} benchmark run(s) to ${output}`);
  for (const run of runs) {
    console.log(`${run.file} #${run.iteration}: ${run.load.totalMs.toFixed(1)} ms, ${run.browser.jsHeapUsedMiB.toFixed(1)} MiB JS heap`);
  }
} finally {
  if (browser) await browser.close();
  preview.kill();
  if (preview.exitCode && preview.exitCode !== 0) process.stderr.write(previewError);
}
