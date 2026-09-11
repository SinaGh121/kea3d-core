import { expect, test } from '@playwright/test';
import { motionSample } from '../../scripts/motion-sample.mjs';

test('Android folder grant reads companions and opens the project', async ({ page }) => {
  const sample = motionSample();
  const resources = Object.fromEntries(Object.entries(sample.entries).filter(([path]) => path.endsWith('.glb')).map(([path, bytes]) => [path, Array.from(bytes as Uint8Array)]));
  await page.addInitScript((resources) => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Android Kea3D test' });
    localStorage.setItem('kea3d.update-checks.v1', 'off');
    const folder = {
      onmessage: null as null | ((event: { data: string }) => void),
      postMessage: (message: string) => queueMicrotask(() => folder.onmessage?.({ data: JSON.stringify({ files: (JSON.parse(message).paths as string[]).map(path => ({ path, uri: `content://test/${path}`, size: resources[path].length })) }) })),
    };
    const reader = {
      onmessage: null as null | ((event: { data: string | ArrayBuffer }) => void),
      postMessage: (message: string) => {
        const request = JSON.parse(message);
        queueMicrotask(() => reader.onmessage?.({ data: request.action === 'open' ? new Uint8Array(resources[request.uri.slice('content://test/'.length)]).buffer : 'done' }));
      },
    };
    Object.assign(window, {
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (name: string) => name === 'take_pending_open_files' ? [] : null },
      kea3dProjectFolder: folder, kea3dNativeFile: reader,
    });
  }, resources);
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Motion-Lab.kea3d', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sample.project)) });
  await page.getByRole('button', { name: 'Allow folder access' }).click();
  await expect(page.getByRole('button', { name: /Open another model.*Motion-Lab/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Project resources' })).toHaveCount(0);
});

test('Android recovery distinguishes permission, cancellation and checked missing paths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Android Kea3D test' });
    localStorage.setItem('kea3d.update-checks.v1', 'off');
    let attempt = 0;
    const folder = {
      onmessage: null as null | ((event: { data: string }) => void),
      postMessage: () => queueMicrotask(() => folder.onmessage?.({ data: JSON.stringify(++attempt === 1 ? { cancelled: true } : { files: [] }) })),
    };
    Object.assign(window, {
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (name: string) => name === 'take_pending_open_files' ? [] : null },
      kea3dProjectFolder: folder,
      kea3dNativeFile: { onmessage: null, postMessage: () => undefined },
    });
  });
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Motion-Lab.kea3d', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(motionSample().project)) });
  const panel = page.getByRole('complementary', { name: 'Project resources' });
  await expect(panel.getByText('Access needed', { exact: true }).first()).toBeVisible();
  await panel.getByRole('button', { name: 'Allow folder access' }).click();
  await expect(panel.getByRole('status')).toContainText('cancelled');
  await expect(panel.getByText('Not in folder', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Allow folder access' }).click();
  await expect(panel.getByText('Not in folder', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText(/Not found at this path/).first()).toBeVisible();
});
