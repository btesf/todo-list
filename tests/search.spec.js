const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails, completeTask } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('filters the pending list by search text and restores it when cleared', async ({ page }) => {
  await addTask(page, 'Buy milk');
  await addTask(page, 'Walk the dog');

  await page.getByPlaceholder('Search tasks...').fill('milk');
  await expect(page.locator('.task-list .task-item')).toHaveCount(1);
  await expect(page.locator('.task-item', { hasText: 'Buy milk' })).toBeVisible();

  await page.getByPlaceholder('Search tasks...').fill('');
  await expect(page.locator('.task-list .task-item')).toHaveCount(2);
});

test('task icons are still rendered after a filtered-out task reappears', async ({ page }) => {
  await addTask(page, 'Buy milk');
  await addTask(page, 'Walk the dog');

  await page.getByPlaceholder('Search tasks...').fill('milk');
  await page.getByPlaceholder('Search tasks...').fill('');

  await expect(page.locator('.task-list .task-item')).toHaveCount(2);
  await expect(page.locator('.star-btn svg')).toHaveCount(2);
  await expect(page.locator('.add-subtask-btn svg')).toHaveCount(2);
  await expect(page.locator('.delete-btn svg')).toHaveCount(2);
});

test('an expanded task stays expanded after a search filters it out and back in', async ({ page }) => {
  await addTask(page, 'Buy milk');
  await addTask(page, 'Walk the dog');

  const milkRow = taskRow(page, 'Buy milk');
  await openDetails(milkRow);
  await expect(milkRow).toHaveClass(/show-details/);

  await page.getByPlaceholder('Search tasks...').fill('dog');
  await page.getByPlaceholder('Search tasks...').fill('');

  await expect(taskRow(page, 'Buy milk')).toHaveClass(/show-details/);
});

test('expanded state survives completing and un-completing a task', async ({ page }) => {
  await addTask(page, 'Task with history');
  const row = taskRow(page, 'Task with history');
  await openDetails(row);
  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2027-01-01'); // gives the completed row a "View details" button

  await completeTask(page, 'Task with history');
  const completedRow = page.locator('#completed-container .task-item', { hasText: 'Task with history' });
  await completedRow.getByRole('button', { name: 'View details' }).click();
  await expect(completedRow).toHaveClass(/show-details/);

  await completedRow.getByRole('checkbox', { name: 'Mark task complete' }).click();
  await expect(taskRow(page, 'Task with history')).toHaveClass(/show-details/);
});

test('expanded state survives a full page reload, but is not written to the exported task data', async ({ page }) => {
  await addTask(page, 'Persisted expand');
  await addTask(page, 'Stays collapsed');
  await openDetails(taskRow(page, 'Persisted expand'));

  const exported = JSON.parse(await page.evaluate(() => localStorage.getItem('enhancedTodoAppTasks_vue_v2')));
  expect(Object.keys(exported[0])).not.toContain('expanded');

  await page.reload();
  await expect(taskRow(page, 'Persisted expand')).toHaveClass(/show-details/);
  await expect(taskRow(page, 'Stays collapsed')).not.toHaveClass(/show-details/);
});
