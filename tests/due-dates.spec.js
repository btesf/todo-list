const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('shows overdue styling for a past due date and neutral styling for a future one', async ({ page }) => {
  await addTask(page, 'Task with due date');
  const row = taskRow(page, 'Task with due date');
  await openDetails(row);

  // The date input is revealed by clicking the "Due date" ghost pill (see the
  // compact meta-row design in task-item-template) rather than always visible.
  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2024-01-01');
  await expect(row.locator('.due-badge')).toHaveClass(/overdue/);

  await row.locator('input[type="date"]').fill('2999-01-01');
  await expect(row.locator('.due-badge')).not.toHaveClass(/overdue/);

  await row.locator('input[type="date"]').blur();
  await row.getByRole('button', { name: 'Clear due date' }).click();
  await expect(row.locator('.due-badge')).toHaveCount(0);
});

test('the due date input collapses back to a pill on blur', async ({ page }) => {
  await addTask(page, 'Pill collapse check');
  const row = taskRow(page, 'Pill collapse check');
  await openDetails(row);

  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2027-03-15');
  await row.locator('input[type="date"]').blur();

  await expect(row.locator('input[type="date"]')).toHaveCount(0);
  await expect(row.locator('.meta-pill', { hasText: 'Mar 15' })).toBeVisible();
});
