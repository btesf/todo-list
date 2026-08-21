const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

// While a task is expanded the collapsed-row .due-badge is intentionally hidden
// (the editable meta-row pill supersedes it, and rendering both duplicated the
// date on screen). So expanded-state assertions target .meta-pill; .due-badge is
// asserted after collapsing.
//
// The populated due-date pill only exists once the date editor is closed - while
// editing, the meta-row holds the date/time inputs and the only .meta-pill
// present is a ghost ("Due date" / "Tag"). Hence blur-then-assert, and a locator
// that excludes ghosts.
const duePill = (row) => row.locator('.meta-pill:not(.meta-pill-ghost)');
test('shows overdue styling for a past due date and neutral styling for a future one', async ({ page }) => {
  await addTask(page, 'Task with due date');
  const row = taskRow(page, 'Task with due date');
  await openDetails(row);

  // The date input is revealed by clicking the "Due date" ghost pill (see the
  // compact meta-row design in task-item-template) rather than always visible.
  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2024-01-01');
  await row.locator('input[type="date"]').blur();
  await expect(duePill(row)).toHaveClass(/overdue/);

  await duePill(row).click(); // reopen the editor
  await row.locator('input[type="date"]').fill('2999-01-01');
  await row.locator('input[type="date"]').blur();
  await expect(duePill(row)).not.toHaveClass(/overdue/);

  await row.getByRole('button', { name: 'Clear due date' }).click();
  await expect(row.locator('.due-badge')).toHaveCount(0);
  await expect(duePill(row)).toHaveCount(0);
});

test('the collapsed row shows the due badge, and expanding hides it so the date is not shown twice', async ({ page }) => {
  await addTask(page, 'No duplicate metadata');
  const row = taskRow(page, 'No duplicate metadata');

  await openDetails(row);
  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2024-01-01');
  await row.locator('input[type="date"]').blur();
  await row.getByRole('button', { name: 'Tag' }).click();
  await row.locator('.tag-input').fill('errand');
  await row.locator('.tag-input').press('Enter');

  // Expanded: meta-row owns the date + tag, collapsed-row copies are suppressed.
  await expect(row.locator('.meta-pill').first()).toHaveClass(/overdue/);
  await expect(row.locator('.due-badge')).toHaveCount(0);
  await expect(row.locator('.tag-chip-strip')).toHaveCount(0);

  // Collapsed: the badge and compact tag chip come back as the summary view.
  await openDetails(row);
  await expect(row.locator('.due-badge')).toHaveClass(/overdue/);
  await expect(row.locator('.tag-chip-strip')).toContainText('errand');
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

test('an optional due time combines with the date in the pill, and overdue styling considers it', async ({ page }) => {
  await addTask(page, 'Task with due time');
  const row = taskRow(page, 'Task with due time');
  await openDetails(row);

  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2999-01-01');
  await row.locator('input[type="time"]').fill('14:15');
  await row.locator('input[type="time"]').blur();

  await expect(row.locator('.meta-pill', { hasText: '2:15 PM' })).toBeVisible();
  await expect(row.locator('.meta-pill').first()).not.toHaveClass(/overdue/);

  // Collapsing shows the same combined date+time in the summary badge.
  await openDetails(row);
  await expect(row.locator('.due-badge')).toContainText('2:15 PM');
  await expect(row.locator('.due-badge')).not.toHaveClass(/overdue/);
});

test('due today is overdue once its time has passed, not before (visual styling)', async ({ page }) => {
  // Local date components, not toISOString() (UTC) - see the identical fix
  // and explanation in overdue-alerts.spec.js's dateOffset() helper.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  await addTask(page, 'Overdue by time');
  const overdueRow = taskRow(page, 'Overdue by time');
  await openDetails(overdueRow);
  await overdueRow.getByRole('button', { name: 'Due date', exact: true }).click();
  await overdueRow.locator('input[type="date"]').fill(today);
  await overdueRow.locator('input[type="time"]').fill('00:01');
  await overdueRow.locator('input[type="time"]').blur();
  await expect(duePill(overdueRow)).toHaveClass(/overdue/);

  await addTask(page, 'Not yet overdue by time');
  const laterRow = taskRow(page, 'Not yet overdue by time');
  await openDetails(laterRow);
  await laterRow.getByRole('button', { name: 'Due date', exact: true }).click();
  await laterRow.locator('input[type="date"]').fill(today);
  await laterRow.locator('input[type="time"]').fill('23:59');
  await laterRow.locator('input[type="time"]').blur();
  await expect(duePill(laterRow)).not.toHaveClass(/overdue/);
});

test('clearing the due date also clears the due time', async ({ page }) => {
  await addTask(page, 'Clear date and time');
  const row = taskRow(page, 'Clear date and time');
  await openDetails(row);

  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2999-01-01');
  await row.locator('input[type="time"]').fill('14:15');
  await row.locator('input[type="time"]').blur();

  await row.getByRole('button', { name: 'Clear due date' }).click();
  await expect(row.locator('.due-badge')).toHaveCount(0);

  // Re-adding just a date should not resurrect the old time.
  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2999-02-02');
  await row.locator('input[type="date"]').blur();
  await expect(row.locator('.meta-pill').first()).toHaveText('Feb 2');
});

test('tabbing focus from the date input to the time input does not collapse the editor', async ({ page }) => {
  await addTask(page, 'Focus move check');
  const row = taskRow(page, 'Focus move check');
  await openDetails(row);

  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2999-01-01');
  await row.locator('input[type="time"]').focus();

  await expect(row.locator('input[type="date"]')).toBeVisible();
  await expect(row.locator('input[type="time"]')).toBeVisible();
});
