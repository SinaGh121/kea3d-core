import { expect, test } from '@playwright/test';
import { motionSample } from '../../scripts/motion-sample.mjs';
import { zipSync } from 'fflate';

test('motion export explains snapshot limits without advertising embedded clips', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Motion-Lab.kea3dp', mimeType: 'application/octet-stream', buffer: motionSample().package });
  await page.getByRole('button', { name: 'Export model', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Include animations' })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Include animations' })).not.toBeChecked();
  await expect(page.getByText('GLB saves the current pose only. Save as .kea3d or .kea3dp to preserve the motion definitions.')).toBeVisible();
});

test('project motions play, pause, seek and keep the document clean', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Motion-Lab.kea3dp', mimeType: 'application/octet-stream', buffer: motionSample().package });
  await expect(page.getByRole('button', { name: /Open another model.*Motion-Lab/ })).toBeVisible();
  const play = page.getByRole('button', { name: 'Play animation', exact: true });
  await expect(play).toBeVisible();
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause animation', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Animation timeline' }).getAttribute('aria-valuenow'))).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(play).toBeVisible();
  await page.getByRole('button', { name: 'Restart animation' }).click();
  await expect(page.getByRole('slider', { name: 'Animation timeline' })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('combobox', { name: 'Animation clip' }).click();
  await page.getByRole('option', { name: 'Lid: direct frame 0 to 2' }).click();
  await play.click(); await expect(play).toBeVisible();
  await page.screenshot({ path: 'artifacts/motion-lab-desktop.png' });
  await page.getByRole('button', { name: /Open another model.*Motion-Lab/ }).click();
  await expect(page.getByText('Unsaved model changes', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('motion controls fit a compact touch viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Motion-Lab.kea3dp', mimeType: 'application/octet-stream', buffer: motionSample().package });
  await expect(page.getByRole('button', { name: /Open another model.*Motion-Lab/ })).toBeVisible();
  await page.getByRole('button', { name: 'Animations', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Animation timeline' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Animation timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'Less', exact: true }).click();
  const play = page.getByRole('button', { name: 'Play animation', exact: true });
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause animation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(play).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Fit model', exact: true }).click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  await page.screenshot({ path: 'artifacts/motion-lab-mobile.png' });
  expect(errors).toEqual([]);
});

test('numeric editing starts at the animated position and repeat UI matches playback', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Motion-Lab.kea3dp', mimeType: 'application/octet-stream', buffer: motionSample().package });
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Animation timeline' }).getAttribute('aria-valuenow'))).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Adjust model', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Connection motion' });
  await expect.poll(async () => Number(await panel.getByRole('spinbutton').inputValue())).toBeGreaterThan(0);
  await panel.getByRole('spinbutton').fill('2');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel.getByRole('spinbutton')).toHaveValue('2');
  await panel.getByRole('combobox').click();
  await page.getByRole('option', { name: 'rotor', exact: true }).click();
  await panel.getByRole('spinbutton').fill('-30');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Animations', exact: true }).click();
  await page.getByRole('button', { name: 'Loop animation', exact: true }).click();
  await expect(page.getByText('Repeats continuously. Pause keeps the current pose. Dragging a part pauses playback.')).toBeVisible();
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause animation', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Animation timeline' }).getAttribute('aria-valuenow'))).toBeGreaterThan(1.1);
  expect(errors).toEqual([]);
});

test('invalid motion targets preserve the previously loaded scene', async ({ page }) => {
  const sample = motionSample();
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Motion-Lab.kea3dp', mimeType: 'application/octet-stream', buffer: sample.package });
  await expect(page.getByRole('button', { name: /Open another model.*Motion-Lab/ })).toBeVisible();
  sample.project.motions[0].steps = [{ type: 'joint', instance: 'slider', to: 10, durationMs: 1000 }];
  sample.entries['project.kea3d'] = Buffer.from(JSON.stringify(sample.project));
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Invalid.kea3dp', mimeType: 'application/octet-stream', buffer: Buffer.from(zipSync(sample.entries)) });
  await expect(page.getByText('Motion target for slider exceeds joint limits.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Open another model.*Motion-Lab/ })).toBeVisible();
});
