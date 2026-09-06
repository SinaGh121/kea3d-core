import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argv, stdout } from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..');
const paths = {
  packageJson: resolve(projectRoot, 'package.json'),
  packageLock: resolve(projectRoot, 'package-lock.json'),
  tauriConfig: resolve(projectRoot, 'src-tauri', 'tauri.conf.json'),
  cargoManifest: resolve(projectRoot, 'src-tauri', 'Cargo.toml'),
  cargoLock: resolve(projectRoot, 'src-tauri', 'Cargo.lock'),
};
const semverPattern = /^\d+\.\d+\.\d+$/;

function assertVersion(version) {
  if (!semverPattern.test(version)) {
    throw new Error(`Product version must use major.minor.patch: ${version}`);
  }
  const [major, minor, patch] = version.split('.').map(Number);
  const androidVersionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (minor > 999 || patch > 999 || androidVersionCode > 2_147_483_647) {
    throw new Error(`Product version cannot be represented by the Android version code: ${version}`);
  }
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function packageVersionFromToml(contents, fileName) {
  const match = contents.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/);
  if (!match) throw new Error(`Could not find [package] version in ${fileName}.`);
  return match[1];
}

function packageVersionFromCargoLock(contents) {
  const match = contents.match(/\[\[package\]\]\r?\nname = "kea3d"\r?\nversion = "([^"]+)"/);
  if (!match) throw new Error('Could not find the Kea3D package version in Cargo.lock.');
  return match[1];
}

async function readState() {
  const [packageText, lockText, tauriText, cargoManifest, cargoLock] = await Promise.all([
    readFile(paths.packageJson, 'utf8'),
    readFile(paths.packageLock, 'utf8'),
    readFile(paths.tauriConfig, 'utf8'),
    readFile(paths.cargoManifest, 'utf8'),
    readFile(paths.cargoLock, 'utf8'),
  ]);
  return {
    packageJson: JSON.parse(packageText),
    packageLock: JSON.parse(lockText),
    tauriConfig: JSON.parse(tauriText),
    cargoManifest,
    cargoLock,
  };
}

async function setVersion(version) {
  assertVersion(version);
  const state = await readState();
  state.packageJson.version = version;
  state.packageLock.version = version;
  state.packageLock.packages[''].version = version;
  state.tauriConfig.version = version;
  state.cargoManifest = state.cargoManifest.replace(
    /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
  state.cargoLock = state.cargoLock.replace(
    /(\[\[package\]\]\r?\nname = "kea3d"\r?\nversion = ")[^"]+(")/,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
  await Promise.all([
    writeFile(paths.packageJson, jsonText(state.packageJson)),
    writeFile(paths.packageLock, jsonText(state.packageLock)),
    writeFile(paths.tauriConfig, jsonText(state.tauriConfig)),
    writeFile(paths.cargoManifest, state.cargoManifest),
    writeFile(paths.cargoLock, state.cargoLock),
  ]);
  stdout.write(`Kea3D product version set to ${version}.\n`);
}

async function checkVersion() {
  const state = await readState();
  const version = state.packageJson.version;
  assertVersion(version);
  const versions = {
    'package-lock.json': state.packageLock.version,
    'package-lock.json root package': state.packageLock.packages['']?.version,
    'src-tauri/tauri.conf.json': state.tauriConfig.version,
    'src-tauri/Cargo.toml': packageVersionFromToml(state.cargoManifest, 'Cargo.toml'),
    'src-tauri/Cargo.lock': packageVersionFromCargoLock(state.cargoLock),
  };
  const mismatches = Object.entries(versions).filter(([, candidate]) => candidate !== version);
  if (mismatches.length > 0) {
    throw new Error(
      `Product version is ${version}, but these files differ:\n`
      + mismatches.map(([file, candidate]) => `- ${file}: ${candidate ?? 'missing'}`).join('\n'),
    );
  }
  stdout.write(`Product version ${version} is synchronized across npm, Tauri, and Cargo.\n`);
}

const [command = 'check', value] = argv.slice(2);
if (command === 'set') {
  if (!value) throw new Error('Usage: npm run version:set -- <major.minor.patch>');
  await setVersion(value);
  await checkVersion();
} else if (command === 'check') {
  await checkVersion();
} else {
  throw new Error(`Unknown product-version command: ${command}`);
}
