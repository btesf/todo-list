const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('shows overdue styling for a past due date and neutral styling for a future one', async ({ page }) => {
  await addTask(page, 'Task with due date');
  const row = taskRow(page, 'Task with due date');
  await openDetails(row);

  await row.locator('input[type="date"]').fill('2024-01-01');
  await expect(row.locator('.due-badge')).toHaveClass(/overdue/);

  await row.locator('input[type="date"]').fill('2999-01-01');
  await expect(row.locator('.due-badge')).not.toHaveClass(/overdue/);

  await row.getByRole('button', { name: 'Clear due date' }).click();
  await expect(row.locator('.due-badge')).toHaveCount(0);
});
