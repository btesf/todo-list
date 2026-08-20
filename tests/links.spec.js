const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('auto-links a raw URL typed into the description', async ({ page }) => {
  await addTask(page, 'Task with inline link');
  const row = taskRow(page, 'Task with inline link');
  await openDetails(row);

  await row.locator('.task-description-placeholder').click();
  await row.locator('textarea').fill('See https://github.com/example/repo/issues/1');
  await row.getByRole('button', { name: 'Save' }).click();

  const link = row.locator('.task-description-display a');
  await expect(link).toHaveAttribute('href', 'https://github.com/example/repo/issues/1');
  await expect(link).toHaveText('https://github.com/example/repo/issues/1');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('shortens a link with markdown-style [label](url) syntax', async ({ page }) => {
  await addTask(page, 'Task with a Jira ticket');
  const row = taskRow(page, 'Task with a Jira ticket');
  await openDetails(row);

  await row.locator('.task-description-placeholder').click();
  await row.locator('textarea').fill('Tracked in [PROJ-123](https://example.atlassian.net/browse/PROJ-123)');
  await row.getByRole('button', { name: 'Save' }).click();

  const link = row.locator('.task-description-display a');
  await expect(link).toHaveAttribute('href', 'https://example.atlassian.net/browse/PROJ-123');
  await expect(link).toHaveText('PROJ-123');
});

test('mixes a shortened link and a bare auto-linked URL in the same description', async ({ page }) => {
  await addTask(page, 'Task with two links');
  const row = taskRow(page, 'Task with two links');
  await openDetails(row);

  await row.locator('.task-description-placeholder').click();
  await row.locator('textarea').fill(
    'See [the PR](https://github.com/example/repo/pull/9) and also https://example.com/notes'
  );
  await row.getByRole('button', { name: 'Save' }).click();

  const links = row.locator('.task-description-display a');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveText('the PR');
  await expect(links.nth(0)).toHaveAttribute('href', 'https://github.com/example/repo/pull/9');
  await expect(links.nth(1)).toHaveText('https://example.com/notes');
  await expect(links.nth(1)).toHaveAttribute('href', 'https://example.com/notes');
});

test('task text itself also auto-links and shortens the same way', async ({ page }) => {
  await addTask(page, 'Check [the ticket](https://example.atlassian.net/browse/PROJ-9) please');
  const link = page.locator('.task-text a');
  await expect(link).toHaveText('the ticket');
  await expect(link).toHaveAttribute('href', 'https://example.atlassian.net/browse/PROJ-9');
});
