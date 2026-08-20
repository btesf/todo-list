const { test, expect } = require('@playwright/test');
const { resetApp, addTask, completeTask } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('select and delete specific completed tasks', async ({ page }) => {
  await addTask(page, 'Task 1');
  await addTask(page, 'Task 2');
  await completeTask(page, 'Task 1');
  await completeTask(page, 'Task 2');

  await page.getByRole('button', { name: 'Select' }).click();
  const row1 = page.locator('#completed-container .task-item', { hasText: 'Task 1' });
  await row1.getByRole('checkbox', { name: 'Select task' }).check();
  await page.getByRole('button', { name: /Delete Selected/ }).click();

  await expect(page.locator('#completed-container .task-item', { hasText: 'Task 1' })).toHaveCount(0);
  await expect(page.locator('#completed-container .task-item', { hasText: 'Task 2' })).toHaveCount(1);
});

test('cancel exits selection mode without deleting anything', async ({ page }) => {
  await addTask(page, 'Task 1');
  await completeTask(page, 'Task 1');

  await page.getByRole('button', { name: 'Select' }).click();
  const row = page.locator('#completed-container .task-item', { hasText: 'Task 1' });
  await row.getByRole('checkbox', { name: 'Select task' }).check();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
  await expect(row).toBeVisible();
});

test('clear completed removes all completed tasks at once', async ({ page }) => {
  await addTask(page, 'Task 1');
  await addTask(page, 'Task 2');
  await completeTask(page, 'Task 1');
  await completeTask(page, 'Task 2');

  await page.getByRole('button', { name: 'Clear completed' }).click();
  await expect(page.locator('#completed-container .task-item')).toHaveCount(0);
});
