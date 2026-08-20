const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails, completeTask } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('adding a tag shows a chip both in details and on the collapsed row', async ({ page }) => {
  await addTask(page, 'Task with tags');
  const row = taskRow(page, 'Task with tags');
  await openDetails(row);

  await row.locator('.tag-input').fill('urgent');
  await row.locator('.tag-input').press('Enter');

  await expect(row.locator('.tags-row .tag-chip')).toHaveCount(1);
  await expect(row.locator('.tag-chip-strip .tag-chip')).toHaveCount(1);
  await expect(row.locator('.tag-chip-strip .tag-chip')).toHaveText('urgent');
});

test('removing a tag removes its chip from both places', async ({ page }) => {
  await addTask(page, 'Task to untag');
  const row = taskRow(page, 'Task to untag');
  await openDetails(row);
  await row.locator('.tag-input').fill('temp');
  await row.locator('.tag-input').press('Enter');
  await expect(row.locator('.tag-chip-strip .tag-chip')).toHaveCount(1);

  await row.locator('.tags-row .tag-chip-remove').click();
  await expect(row.locator('.tags-row .tag-chip')).toHaveCount(0);
  await expect(row.locator('.tag-chip-strip .tag-chip')).toHaveCount(0);
});

test('clicking a tag chip filters the list by that tag', async ({ page }) => {
  await addTask(page, 'Design review');
  await addTask(page, 'Coffee break');
  const row = taskRow(page, 'Design review');
  await openDetails(row);
  await row.locator('.tag-input').fill('work');
  await row.locator('.tag-input').press('Enter');

  await row.locator('.tag-chip-strip .tag-chip').click();

  await expect(page.getByPlaceholder('Search tasks...')).toHaveValue('work');
  await expect(taskRow(page, 'Design review')).toBeVisible();
  await expect(taskRow(page, 'Coffee break')).toHaveCount(0);
});

test('a completed task with only tags can still be expanded to view them, read-only', async ({ page }) => {
  await addTask(page, 'Complete me');
  const row = taskRow(page, 'Complete me');
  await openDetails(row);
  await row.locator('.tag-input').fill('done-later');
  await row.locator('.tag-input').press('Enter');

  await completeTask(page, 'Complete me');
  const completedRow = page.locator('#completed-container .task-item', { hasText: 'Complete me' });
  await expect(completedRow.locator('.tag-chip-strip .tag-chip')).toHaveText('done-later');

  await completedRow.getByRole('button', { name: 'View details' }).click();
  await expect(completedRow.locator('.tags-row .tag-chip')).toHaveText('done-later');
  await expect(completedRow.locator('.tags-row .tag-chip-remove')).toHaveCount(0);
  await expect(completedRow.locator('.tags-row .tag-input')).toHaveCount(0);
});

test('duplicate tags are not added twice', async ({ page }) => {
  await addTask(page, 'No dupes');
  const row = taskRow(page, 'No dupes');
  await openDetails(row);
  await row.locator('.tag-input').fill('same');
  await row.locator('.tag-input').press('Enter');
  await row.locator('.tag-input').fill('same');
  await row.locator('.tag-input').press('Enter');

  await expect(row.locator('.tags-row .tag-chip')).toHaveCount(1);
});
