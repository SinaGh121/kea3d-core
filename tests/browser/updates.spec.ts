import { expect, test } from '@playwright/test';

test('native update notice and manual retry do not interrupt viewing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI__: {} });
    localStorage.setItem('kea3d.update-checks.v1', 'off');
  });
  let available = true;
  await page.route('https://kea3d.com/releases.json', route => route.fulfill({
    status: available ? 200 : 503,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ schema: 1, platforms: { windows: '9.0.0', linux: '9.0.0', macos: '9.0.0' } }),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'About Kea3D' }).click();
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByText('Version 9.0.0 is available.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View downloads' })).toHaveAttribute('href', 'https://kea3d.com/download/');
  available = false;
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByText('Could not check. You can try again when online.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
});

test('startup check is quiet and web mode does not contact release service', async ({ page }) => {
  let requests = 0;
  await page.route('https://kea3d.com/releases.json', route => {
    requests++;
    return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ schema: 1, platforms: { windows: '0.1.1', linux: '0.1.1', macos: '0.1.1' } }) });
  });
  await page.goto('/');
  await page.waitForTimeout(5500);
  expect(requests).toBe(0);
  await page.addInitScript(() => { Object.assign(window, { __TAURI__: {} }); });
  await page.reload();
  await expect.poll(() => requests, { timeout: 10000 }).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'About Kea3D' }).click();
  await expect(page.getByText('No newer public version is available.')).toBeVisible();
});
