const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails, setTaskNote } = require('./helpers');

const STORAGE_KEY = 'enhancedTodoAppTasks_vue_v2';

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept());
  await resetApp(page);
});

async function addSubtask(row, text) {
  await row.locator('#add-subtask-form input').fill(text);
  await row.getByRole('button', { name: 'Add', exact: true }).click();
}

test.describe('task notes', () => {
  test('a task with no note shows no indicator; adding one via the overlay makes it obvious', async ({ page }) => {
    await addTask(page, 'Needs a note');
    const row = taskRow(page, 'Needs a note');

    // No note yet → no indicator in the row actions.
    await expect(row.locator('.note-btn')).toHaveCount(0);

    await setTaskNote(page, row, 'Remember to check the staging config first.');

    // Now the indigo indicator is present, and the rendered note shows in-card.
    await expect(row.locator('.note-btn.has-note')).toHaveCount(1);
    await expect(row.locator('.task-description-display')).toContainText('staging config');

    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k))[0], STORAGE_KEY);
    expect(stored.description).toContain('staging config');
  });

  test('an existing note opens in rendered read mode by default, not the raw textarea', async ({ page }) => {
    await addTask(page, 'Read first');
    const row = taskRow(page, 'Read first');
    await setTaskNote(page, row, 'Ship **today** with `--flag`');

    await row.getByRole('button', { name: 'Open notes' }).click();
    // Read mode: formatted markdown shown, no textarea until you choose to edit.
    const preview = page.locator('.note-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('strong')).toHaveText('today');
    await expect(preview.locator('code')).toHaveText('--flag');
    await expect(page.locator('.note-textarea')).toHaveCount(0);
  });

  test('Edit reveals the textarea; Done returns to the rendered view', async ({ page }) => {
    await addTask(page, 'Toggle modes');
    const row = taskRow(page, 'Toggle modes');
    await setTaskNote(page, row, 'Original.');

    await row.getByRole('button', { name: 'Open notes' }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    const textarea = page.locator('.note-textarea');
    await expect(textarea).toHaveValue('Original.');
    await textarea.fill('Original. Plus more.');

    // Header Done returns to read mode (does NOT close the overlay).
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.note-modal')).toBeVisible();
    await expect(page.locator('.note-textarea')).toHaveCount(0);
    await expect(page.locator('.note-preview')).toContainText('Plus more.');

    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k))[0], STORAGE_KEY);
    expect(stored.description).toBe('Original. Plus more.');
  });

  test('an empty note opens straight in edit mode', async ({ page }) => {
    await addTask(page, 'Fresh note');
    const row = taskRow(page, 'Fresh note');
    await openDetails(row);
    await row.getByRole('button', { name: 'Add note' }).click();
    // Nothing to read yet → textarea immediately, focused.
    await expect(page.locator('.note-textarea')).toBeFocused();
  });

  test('Esc closes the overlay and still saves', async ({ page }) => {
    await addTask(page, 'Esc saves');
    const row = taskRow(page, 'Esc saves');
    await openDetails(row);
    await row.getByRole('button', { name: 'Add note' }).click();
    await page.locator('.note-textarea').fill('Saved on escape.');
    await page.locator('.note-textarea').press('Escape');

    await expect(page.locator('.note-modal')).toHaveCount(0);
    await expect(row.locator('.task-description-display')).toContainText('Saved on escape.');
  });

  test('the backdrop is a scrim that locks background scroll while open', async ({ page }) => {
    await addTask(page, 'Scroll lock');
    const row = taskRow(page, 'Scroll lock');
    await openDetails(row);
    await row.getByRole('button', { name: 'Add note' }).click();

    await expect(page.locator('.note-backdrop')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/modal-open/);

    await page.locator('.note-modal').getByRole('button', { name: 'Close notes' }).click();
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  });
});

test('rendered links carry an external-link ↗ affordance', async ({ page }) => {
  await addTask(page, 'Task with a [ticket](https://example.com/T-1) link');
  // ::after content is CSS-only, so it doesn't change the link's text...
  const link = page.locator('.task-text a');
  await expect(link).toHaveText('ticket');
  await expect(link).toHaveAttribute('href', 'https://example.com/T-1');
  // ...but the arrow glyph is present as generated content.
  const after = await link.evaluate(el => getComputedStyle(el, '::after').content);
  expect(after).toContain('↗');
});

test.describe('subtask notes', () => {
  test('the subtask note icon is faint when empty, indigo once a note exists', async ({ page }) => {
    await addTask(page, 'Parent');
    const row = taskRow(page, 'Parent');
    await openDetails(row);
    await addSubtask(row, 'A step');

    const subtask = row.locator('.subtask-item', { hasText: 'A step' });
    const noteBtn = subtask.locator('.subtask-note-btn');
    await expect(noteBtn).not.toHaveClass(/has-note/);

    await noteBtn.click();
    await expect(page.locator('.note-modal-title')).toHaveText('Notes · A step');
    await page.locator('.note-textarea').fill('Blocked on the API key.');
    await page.locator('.note-modal').getByRole('button', { name: 'Close notes' }).click();

    await expect(subtask.locator('.subtask-note-btn')).toHaveClass(/has-note/);
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k))[0].subtasks[0], STORAGE_KEY);
    expect(stored.note).toBe('Blocked on the API key.');
  });

  test('each subtask edits its own note, not another', async ({ page }) => {
    await addTask(page, 'Two steps');
    const row = taskRow(page, 'Two steps');
    await openDetails(row);
    await addSubtask(row, 'Step one');
    await addSubtask(row, 'Step two');

    const one = row.locator('.subtask-item', { hasText: 'Step one' });
    const two = row.locator('.subtask-item', { hasText: 'Step two' });

    await one.locator('.subtask-note-btn').click();
    await page.locator('.note-textarea').fill('note for one');
    await page.locator('.note-modal').getByRole('button', { name: 'Close notes' }).click();

    await two.locator('.subtask-note-btn').click();
    // Opening step two's note must not show step one's text.
    await expect(page.locator('.note-textarea')).toHaveValue('');
    await page.locator('.note-textarea').fill('note for two');
    await page.locator('.note-modal').getByRole('button', { name: 'Close notes' }).click();

    const subs = await page.evaluate((k) => JSON.parse(localStorage.getItem(k))[0].subtasks, STORAGE_KEY);
    const byText = Object.fromEntries(subs.map(s => [s.text, s.note]));
    expect(byText['Step one']).toBe('note for one');
    expect(byText['Step two']).toBe('note for two');
  });
});
