import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

test('Robot Cart keeps the selected motion part despite matching anchor names', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles(resolve('tests/fixtures/robot-cart-motion.kea3dp'));
  await page.getByRole('button', { name: 'Adjust model', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Connection motion' });
  for (const id of ['front-left', 'front-right', 'rear-left', 'rear-right']) {
    await panel.getByRole('combobox').click();
    await page.getByRole('option', { name: id, exact: true }).click();
    await expect(panel.getByRole('combobox')).toContainText(id);
    await panel.getByRole('spinbutton').fill('1');
    await panel.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(panel.getByRole('spinbutton')).toHaveValue('1');
    await expect(panel.getByRole('alert')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
