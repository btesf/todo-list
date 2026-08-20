const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, completeTask } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('deleting a task shows a toast and undo restores it', async ({ page }) => {
  await addTask(page, 'Task to delete');
  const row = taskRow(page, 'Task to delete');
  await row.getByRole('button', { name: 'Delete task' }).click();

  await expect(taskRow(page, 'Task to delete')).toHaveCount(0);
  const toast = page.locator('.toast');
  await expect(toast).toContainText('Deleted "Task to delete"');

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(taskRow(page, 'Task to delete')).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('dismissing the toast without undo keeps the task deleted', async ({ page }) => {
  await addTask(page, 'Task to delete permanently');
  const row = taskRow(page, 'Task to delete permanently');
  await row.getByRole('button', { name: 'Delete task' }).click();

  await page.locator('.toast').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(taskRow(page, 'Task to delete permanently')).toHaveCount(0);
});

test('bulk delete selected completed tasks can be undone', async ({ page }) => {
  await addTask(page, 'Bulk 1');
  await addTask(page, 'Bulk 2');
  await completeTask(page, 'Bulk 1');
  await completeTask(page, 'Bulk 2');

  await page.getByRole('button', { name: 'Select' }).click();
  const row1 = page.locator('#completed-container .task-item', { hasText: 'Bulk 1' });
  await row1.getByRole('checkbox', { name: 'Select task' }).check();
  await page.getByRole('button', { name: /Delete Selected/ }).click();

  await expect(page.locator('#completed-container .task-item', { hasText: 'Bulk 1' })).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#completed-container .task-item', { hasText: 'Bulk 1' })).toBeVisible();
  await expect(page.locator('#completed-container .task-item', { hasText: 'Bulk 2' })).toBeVisible();
});

test('clear completed can be undone', async ({ page }) => {
  await addTask(page, 'Completed A');
  await completeTask(page, 'Completed A');

  await page.getByRole('button', { name: 'Clear completed' }).click();
  await expect(page.locator('#completed-container .task-item')).toHaveCount(0);

  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#completed-container .task-item', { hasText: 'Completed A' })).toBeVisible();
});

test('importing tasks can be undone, restoring the previous list', async ({ page }) => {
  await addTask(page, 'Original task');
  const imported = [{ id: 'x1', text: 'Imported task', completed: false, order: 0 }];
  await page.locator('#import-input').setInputFiles({
    name: 'tasks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });

  await expect(taskRow(page, 'Imported task')).toBeVisible();
  await expect(taskRow(page, 'Original task')).toHaveCount(0);

  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(taskRow(page, 'Original task')).toBeVisible();
  await expect(taskRow(page, 'Imported task')).toHaveCount(0);
});

test('importing an invalid file shows an error toast with no undo, and does not change the list', async ({ page }) => {
  await addTask(page, 'Safe task');
  await page.locator('#import-input').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not valid json'),
  });

  const toast = page.locator('.toast');
  await expect(toast).toContainText('invalid');
  await expect(toast.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(taskRow(page, 'Safe task')).toBeVisible();
});
