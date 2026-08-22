const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails, setTaskNote } = require('./helpers');

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
  await setTaskNote(page, row, 'Some **bold** and *italic* and `code()` text');

  const display = row.locator('.task-description-display');
  await expect(display.locator('strong')).toHaveText('bold');
  await expect(display.locator('em')).toHaveText('italic');
  await expect(display.locator('code')).toHaveText('code()');
});

test('code spans protect their contents from bold/italic markers', async ({ page }) => {
  await addTask(page, 'Task with a tricky code span');
  const row = taskRow(page, 'Task with a tricky code span');
  await setTaskNote(page, row, 'Multiplication in code: `a * b` should not become italic');

  const display = row.locator('.task-description-display');
  await expect(display.locator('code')).toHaveText('a * b');
  await expect(display.locator('em')).toHaveCount(0);
});

test('markdown and links can be combined in the same description', async ({ page }) => {
  await addTask(page, 'Task mixing markdown and a link');
  const row = taskRow(page, 'Task mixing markdown and a link');
  await setTaskNote(page, row, '**Important**: see [the ticket](https://example.com/T-1)');

  const display = row.locator('.task-description-display');
  await expect(display.locator('strong')).toHaveText('Important');
  const link = display.locator('a');
  await expect(link).toHaveText('the ticket');
  await expect(link).toHaveAttribute('href', 'https://example.com/T-1');
});

test('headings render as real heading elements in a note', async ({ page }) => {
  await addTask(page, 'Noted with headings');
  const row = taskRow(page, 'Noted with headings');
  await setTaskNote(page, row, '# Plan\nSome intro.\n## Steps\nDetails here.');

  const display = row.locator('.task-description-display');
  await expect(display.locator('h1')).toHaveText('Plan');
  await expect(display.locator('h2')).toHaveText('Steps');
  await expect(display.locator('p').first()).toHaveText('Some intro.');
});

test('bullet and numbered lists render as ul/ol with items', async ({ page }) => {
  await addTask(page, 'Noted with lists');
  const row = taskRow(page, 'Noted with lists');
  await setTaskNote(page, row, 'Groceries:\n- Milk\n- Bread\n\nSteps:\n1. Boil\n2. Stir');

  const display = row.locator('.task-description-display');
  await expect(display.locator('ul li')).toHaveText(['Milk', 'Bread']);
  await expect(display.locator('ol li')).toHaveText(['Boil', 'Stir']);
});

test('blockquotes and horizontal rules render as their elements', async ({ page }) => {
  await addTask(page, 'Noted with quote and rule');
  const row = taskRow(page, 'Noted with quote and rule');
  await setTaskNote(page, row, '> Remember this\n\n---\n\nAfter the rule.');

  const display = row.locator('.task-description-display');
  await expect(display.locator('blockquote')).toContainText('Remember this');
  await expect(display.locator('hr')).toHaveCount(1);
});

test('an @handle is highlighted as a mention in a note', async ({ page }) => {
  await addTask(page, 'Noted with a mention');
  const row = taskRow(page, 'Noted with a mention');
  await setTaskNote(page, row, 'Ask @alice about the rollout.');

  const handle = row.locator('.task-description-display .handle');
  await expect(handle).toHaveText('@alice');
});

test('an @handle is highlighted in the task title too', async ({ page }) => {
  await addTask(page, 'Ping @bob for review');
  await expect(page.locator('.task-text .handle')).toHaveText('@bob');
});

test('an email address is not mistaken for a mention', async ({ page }) => {
  await addTask(page, 'Noted with an email');
  const row = taskRow(page, 'Noted with an email');
  await setTaskNote(page, row, 'Contact person@example.com for access.');

  // No leading word boundary before the @, so the local-part @ must not become
  // a mention; the address should linkify as a whole instead of splitting.
  await expect(row.locator('.task-description-display .handle')).toHaveCount(0);
});

test(':shortcode: renders as an emoji in a note', async ({ page }) => {
  await addTask(page, 'Noted with emoji codes');
  const row = taskRow(page, 'Noted with emoji codes');
  await setTaskNote(page, row, 'Ship it :rocket: and celebrate :tada:');

  const display = row.locator('.task-description-display');
  await expect(display).toContainText('Ship it 🚀 and celebrate 🎉');
  // The literal codes are gone.
  await expect(display).not.toContainText(':rocket:');
});

test('an unknown :shortcode: is left untouched', async ({ page }) => {
  await addTask(page, 'Noted with unknown code');
  const row = taskRow(page, 'Noted with unknown code');
  await setTaskNote(page, row, 'Meeting ratio was 3:1 and :notanemoji: stays.');

  const display = row.locator('.task-description-display');
  await expect(display).toContainText('3:1');
  await expect(display).toContainText(':notanemoji:');
});

test('a :shortcode: inside a code span is not converted', async ({ page }) => {
  await addTask(page, 'Noted with code span');
  const row = taskRow(page, 'Noted with code span');
  await setTaskNote(page, row, 'Use the literal `:rocket:` token here.');

  await expect(row.locator('.task-description-display code')).toHaveText(':rocket:');
});

test(':shortcode: renders as an emoji in a task title', async ({ page }) => {
  await addTask(page, 'Launch :rocket: now');
  await expect(page.locator('.task-text')).toContainText('Launch 🚀 now');
  await expect(page.locator('.task-text')).not.toContainText(':rocket:');
});

test(':shortcode: renders as an emoji in a subtask title', async ({ page }) => {
  await addTask(page, 'Parent with emoji subtask');
  const row = taskRow(page, 'Parent with emoji subtask');
  await openDetails(row);
  await row.locator('#add-subtask-form input').fill('Grab :coffee: first');
  await row.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(row.locator('.subtask-text')).toContainText('Grab ☕ first');
});

test('an unknown :shortcode: stays literal in a task title', async ({ page }) => {
  await addTask(page, 'Ship at 3:1 ratio with :notacode: intact');
  const text = page.locator('.task-text');
  await expect(text).toContainText('3:1');
  await expect(text).toContainText(':notacode:');
});
