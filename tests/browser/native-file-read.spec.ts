import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('Android provider Cancel releases the batch and permits another model', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Android Kea3D test' });
    localStorage.setItem('kea3d.update-checks.v1', 'off');
    let taken = false;
    let callbackId = 0;
    const finished: number[] = [];
    const messages: string[] = [];
    Object.assign(window, {
      nativeReadTest: { finished, messages },
      __TAURI_INTERNALS__: {
        transformCallback: () => ++callbackId,
        invoke: async (command: string, args: { id?: number } = {}) => {
          if (command === 'take_pending_open_files') {
            if (taken) return [];
            taken = true;
            return [1, 2].map(id => ({ id, name: `large-${id}.glb`, size: 1024, requiresStreaming: true, sourceUrl: `content://test/${id}`, nativeCadAvailable: false }));
          }
          if (command === 'finish_pending_open_file') finished.push(args.id!);
          return 1;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      kea3dNativeFile: { onmessage: null, postMessage: (message: string) => messages.push(JSON.parse(message).action) },
    });
  });
  await page.goto('/');
  await expect(page.getByText('Reading local file', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Reading local file', { exact: true })).toBeHidden();
  await expect(page.getByText('Could not open model', { exact: true })).toBeHidden();
  const result = await page.evaluate(() => (window as unknown as { nativeReadTest: { finished: number[]; messages: string[] } }).nativeReadTest);
  expect(result.finished).toEqual([1, 2]);
  expect(result.messages).toEqual(['open', 'cancel']);
  await page.locator('input[type="file"]').first().setInputFiles(resolve('tests/fixtures/AnimatedMorphCube.glb'));
  await expect(page.getByRole('button', { name: /Open another model.*AnimatedMorphCube/ })).toBeVisible();
});
