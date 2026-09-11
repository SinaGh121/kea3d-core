import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json')));
const config = JSON.parse(await readFile(resolve(root, 'src-tauri/tauri.linux.conf.json')));
const expected = ['appimage', 'deb', 'rpm'];
if (JSON.stringify(config.bundle.targets) !== JSON.stringify(expected)) throw new Error('Linux package targets changed; review the release script.');
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--plan')) throw new Error('Usage: node scripts/build-linux-release.mjs [--plan]');
if (args[0] === '--plan') {
  console.log(JSON.stringify({ version, architecture: 'x86_64', targets: expected,
    updates: { appimage: 'Manual until signed replacement/rollback is tested', deb: 'Package manager; no self-replacement', rpm: 'Package manager; no self-replacement' },
    published: false }, null, 2));
  process.exit(0);
}
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build on Linux x64; cross-platform package creation is not claimed.');
const osRelease = await readFile('/etc/os-release', 'utf8');
if (!/^ID=ubuntu$/m.test(osRelease) || !/^VERSION_ID="24\.04"$/m.test(osRelease)) {
  throw new Error('These candidates target Ubuntu 24.04 OCCT packages. Use Ubuntu 24.04 to build; other distributions require separate dependency review.');
}
function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
for (const command of ['node', 'npm', 'cargo', 'rustc', 'cmake', 'pkg-config', 'patchelf', 'rpmbuild']) run(command, ['--version']);
run('pkg-config', ['--exists', 'webkit2gtk-4.1']);
const output = resolve(root, 'artifacts/linux', `${version}-${Date.now()}`);
await mkdir(output, { recursive: true });
run('npm', ['run', 'check']);
run('npm', ['run', 'check:rust']);
// The existing predesktop hooks compile/test the CAD worker and prepare its sidecar.
const started = Date.now();
run('npm', ['run', 'desktop:build', '--', '--config', 'src-tauri/tauri.linux.conf.json', '--bundles', expected.join(',')]);
run('npm', ['run', 'check:bundle']);
const assets = [];
for (const kind of expected) {
  const directory = resolve(root, 'src-tauri/target/release/bundle', kind);
  const extension = kind === 'appimage' ? '.AppImage' : `.${kind}`;
  // Bundlers may delimit the version with underscores or hyphens (notably RPM).
  const versionToken = new RegExp(`(?:_|-)${version.replaceAll('.', '\\.')}(?:_|-)`);
  const names = (await readdir(directory)).filter(name => name.endsWith(extension) && versionToken.test(name));
  if (names.length !== 1) throw new Error(`Expected one version-matched ${kind} package.`);
  const source = resolve(directory, names[0]);
  if ((await stat(source)).mtimeMs < started - 2000) throw new Error(`Refusing stale ${kind} artifact.`);
  const destination = resolve(output, basename(source));
  await copyFile(source, destination);
  const bytes = await readFile(destination);
  assets.push({ file: basename(destination), kind, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(resolve(output, 'SHA256SUMS.txt'), assets.map(a => `${a.sha256}  ${a.file}`).join('\n') + '\n');
await writeFile(resolve(output, 'build-report.json'), JSON.stringify({ version, platform: process.platform, architecture: process.arch, assets,
  releaseApproved: false, remaining: ['Inspect bundled CAD shared libraries and native dependency notices', 'Clean Ubuntu/Debian and Fedora install/launch/uninstall', 'AppImage relocation, read-only folder and supported distro tests', 'Matching source and signed publication'] }, null, 2));
console.log(`Linux candidates prepared at ${output}. Nothing published or installed.`);
