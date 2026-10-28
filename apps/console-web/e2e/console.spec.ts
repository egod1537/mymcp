import { expect, test } from '@playwright/test';

test('operator sees live MCP state and can run a tool from the compact console', async ({
  page,
}) => {
  const unauthorized = await page.request.get('/api/servers');
  expect(unauthorized.status()).toBe(401);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'mymcp Console' })).toBeVisible();
  await page.getByLabel('Admin password').fill('console-e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'MCP status' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Example / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^DCInside / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Google Routes / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Japanese Vocabulary / })).toBeVisible();
  await expect(page.getByText('API OK', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Not enabled', { exact: true })).toHaveCount(2);

  const mcpSelect = page.locator('select').nth(0);
  const toolSelect = page.locator('select').nth(1);
  await expect(mcpSelect).toHaveValue('example');
  await expect(toolSelect).toHaveValue('echo');
  await expect(page.getByLabel('Tool arguments')).toContainText('hello from mymcp console');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('hello from mymcp console', { exact: true })).toBeVisible();

  await mcpSelect.selectOption('dcinside');
  await toolSelect.selectOption('dc_import_post');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('may change local data');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Run', exact: true }).click();

  await page.getByLabel('Use light theme').check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
