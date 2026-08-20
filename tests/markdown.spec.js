const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('renders bold, italic, and code in task text', async ({ page }) => {
  await addTask(page, 'This is **bold**, *italic*, and `code`');
  const text = page.locator('.task-text');
  await expect(text.locator('strong')).toHaveText('bold');
  await expect(text.locator('em')).toHaveText('italic');
  await expect(text.locator('code')).toHaveText('code');
});

test('renders bold, italic, and code in the description', async ({ page }) => {
  await addTask(page, 'Task with formatted description');
  const row = taskRow(page, 'Task with formatted description');
  await openDetails(row);

  await row.locator('.task-description-placeholder').click();
  await row.locator('textarea').fill('Some **bold** and *italic* and `code()` text');
  await row.getByRole('button', { name: 'Save' }).click();

  const display = row.locator('.task-description-display');
  await expect(display.locator('strong')).toHaveText('bold');
  await expect(display.locator('em')).toHaveText('italic');
  await expect(display.locator('code')).toHaveText('code()');
});

test('code spans protect their contents from bold/italic markers', async ({ page }) => {
  await addTask(page, 'Task with a tricky code span');
  const row = taskRow(page, 'Task with a tricky code span');
  await openDetails(row);

  await row.locator('.task-description-placeholder').click();
  await row.locator('textarea').fill('Multiplication in code: `a * b` should not become italic');
  await row.getByRole('button', { name: 'Save' }).click();

  const display = row.locator('.task-description-display');
  await expect(display.locator('code')).toHaveText('a * b');
  await expect(display.locator('em')).toHaveCount(0);
});

test('markdown and links can be combined in the same description', async ({ page }) => {
  await addTask(page, 'Task mixing markdown and a link');
  const row = taskRow(page, 'Task mixing markdown and a link');
  await openDetails(row);

  await row.locator('.task-description-placeholder').click();
  await row.locator('textarea').fill('**Important**: see [the ticket](https://example.com/T-1)');
  await row.getByRole('button', { name: 'Save' }).click();

  const display = row.locator('.task-description-display');
  await expect(display.locator('strong')).toHaveText('Important');
  const link = display.locator('a');
  await expect(link).toHaveText('the ticket');
  await expect(link).toHaveAttribute('href', 'https://example.com/T-1');
});
