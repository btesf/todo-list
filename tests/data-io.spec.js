const { test, expect } = require('@playwright/test');
const { resetApp, addTask } = require('./helpers');
const fs = require('fs');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('exports tasks as a JSON file', async ({ page }) => {
  await addTask(page, 'Exportable task');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);

  expect(download.suggestedFilename()).toBe('tasks.json');
  const filePath = await download.path();
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  expect(content).toHaveLength(1);
  expect(content[0].text).toBe('Exportable task');
});

test('imports tasks, overwriting current ones and filling in missing fields', async ({ page }) => {
  await addTask(page, 'Will be overwritten');
  const oldFormatTasks = [
    { id: 'legacy-1', text: 'Legacy task', completed: false, order: 0 },
  ];
  await page.locator('#import-input').setInputFiles({
    name: 'tasks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(oldFormatTasks)),
  });

  await expect(page.locator('.task-item', { hasText: 'Will be overwritten' })).toHaveCount(0);
  await expect(page.locator('.task-item', { hasText: 'Legacy task' })).toBeVisible();
});
