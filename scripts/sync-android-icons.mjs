import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "src-tauri", "icons", "android");
const targetRoot = join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "res",
);

async function pathExists(path) {
  try {
    await readdir(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

if (await pathExists(targetRoot)) {
  for (const directory of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) {
      continue;
    }

    const source = join(sourceRoot, directory.name);
    const target = join(targetRoot, directory.name);
    await mkdir(target, { recursive: true });
    await cp(source, target, { recursive: true, force: true });
  }
}
