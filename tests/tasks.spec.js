const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, dragHandle, completeTask } = require('./helpers');

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept());
  await resetApp(page);
});

function formatSlashDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

test('typing /today expands in place once followed by a space', async ({ page }) => {
  const input = page.getByPlaceholder('Add a new task...');
  await input.pressSequentially('/today');
  await input.press('Space');
  await expect(input).toHaveValue(formatSlashDate(0) + ' ');
});

test('/tomorrow and /yesterday expand at submit time even with no trailing space typed', async ({ page }) => {
  await addTask(page, '/tomorrow');
  await expect(taskRow(page, formatSlashDate(1))).toBeVisible();

  await addTask(page, '/yesterday plan');
  await expect(taskRow(page, `${formatSlashDate(-1)} plan`)).toBeVisible();
});

test('adds a task and shows it in Pending', async ({ page }) => {
  await addTask(page, 'Buy milk');
  await expect(page.locator('.task-list .task-item')).toHaveCount(1);
  await expect(taskRow(page, 'Buy milk')).toBeVisible();
  await expect(page.getByText('Pending (1)')).toBeVisible();
});

test('new tasks are added to the top of the list', async ({ page }) => {
  await addTask(page, 'Task A');
  await addTask(page, 'Task B');
  const items = page.locator('.task-list .task-item .task-text');
  await expect(items.nth(0)).toHaveText('Task B');
  await expect(items.nth(1)).toHaveText('Task A');
});

test('stars a task as important', async ({ page }) => {
  await addTask(page, 'Important task');
  const row = taskRow(page, 'Important task');
  await row.getByRole('button', { name: 'Toggle importance' }).click();
  await expect(row).toHaveClass(/important/);
});

test('edits a task by double-clicking its text', async ({ page }) => {
  await addTask(page, 'Original text');
  const row = taskRow(page, 'Original text');
  await row.locator('.task-text').dblclick();
  // Once editing starts, the text moves into an input's value, so it's no
  // longer matched by the row's hasText filter - target the editor directly.
  const editor = page.locator('.task-text-editor');
  await editor.fill('Updated text');
  await editor.press('Enter');
  await expect(taskRow(page, 'Updated text')).toBeVisible();
});

test('completes a task and moves it to Completed', async ({ page }) => {
  await addTask(page, 'Finish report');
  const row = taskRow(page, 'Finish report');
  await row.getByRole('checkbox', { name: 'Mark task complete' }).check();
  await expect(page.locator('#completed-container')).toContainText('Finish report');
  await expect(page.getByText('Pending (0)')).toBeVisible();
});

test('deletes a task after confirming', async ({ page }) => {
  await addTask(page, 'Throwaway task');
  const row = taskRow(page, 'Throwaway task');
  await row.getByRole('button', { name: 'Delete task' }).click();
  await expect(page.locator('.task-item', { hasText: 'Throwaway task' })).toHaveCount(0);
});

test('drag-reorders pending tasks', async ({ page }) => {
  await addTask(page, 'Task A');
  await addTask(page, 'Task B');
  // Task B is on top (added last), Task A below. Drag Task A above Task B.
  const handles = page.locator('.task-list .drag-handle');
  await dragHandle(page, handles.nth(1), handles.nth(0)); // drag Task A above Task B

  const texts = page.locator('.task-list .task-item .task-text');
  await expect(texts.nth(0)).toHaveText('Task A');
  await expect(texts.nth(1)).toHaveText('Task B');
});

test('the Completed section can be collapsed and expanded, and the choice persists across reload', async ({ page }) => {
  await addTask(page, 'Finished task');
  await completeTask(page, 'Finished task');

  const toggle = page.getByRole('button', { name: 'Completed', exact: true });
  const completedItem = page.locator('#completed-container .task-item', { hasText: 'Finished task' });
  await expect(completedItem).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();
  await expect(completedItem).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await page.reload();
  await expect(page.locator('#completed-container .task-item', { hasText: 'Finished task' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.locator('#completed-container .task-item', { hasText: 'Finished task' })).toBeVisible();
});
