const { test, expect } = require('@playwright/test');
const { resetApp, addTask } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('task text containing HTML renders as literal text and never executes', async ({ page }) => {
  let dialogFired = false;
  page.on('dialog', d => { dialogFired = true; d.dismiss(); });

  const payload = '<img src=x onerror="window.__xss=true">';
  await addTask(page, payload);

  expect(await page.evaluate(() => window.__xss)).toBeFalsy();
  await expect(page.locator('.task-text')).toHaveText(payload);
  expect(dialogFired).toBeFalsy();

  await page.reload();
  expect(await page.evaluate(() => window.__xss)).toBeFalsy();
  await expect(page.locator('.task-text')).toHaveText(payload);
});
