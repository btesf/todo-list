const { test, expect } = require('@playwright/test');
const { addTask, taskRow, openDetails, setTaskNote } = require('./helpers');

// A fixed Tuesday 10:00 - the clock is later advanced 24h to make this
// "yesterday" relative to the app's own notion of "now".
const ANCHOR_TIME = '2026-01-06T10:00:00';

async function mockClipboard(page) {
  await page.addInitScript(() => {
    window.__clipboard = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text) => { window.__clipboard.push(text); return Promise.resolve(); } },
      configurable: true,
    });
  });
}

async function setup(page, { time = ANCHOR_TIME } = {}) {
  await mockClipboard(page);
  await page.clock.install({ time });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function openActivity(page) {
  // The button's accessible name comes from its visible text ("Activity"),
  // not the `title` tooltip.
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
}

test.describe('activity log', () => {
  test('opens defaulting to Yesterday, and shows a fully completed task', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Ship the release');
    await taskRow(page, 'Ship the release').getByRole('checkbox', { name: 'Mark task complete' }).check();

    // Move the clock forward so the completion above is now "yesterday".
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await openActivity(page);
    const modal = page.locator('.activity-modal');
    await expect(modal.locator('.activity-date-label')).toContainText('Yesterday');
    const item = modal.locator('.activity-item', { hasText: 'Ship the release' });
    await expect(item).toBeVisible();
    await expect(item.locator('.activity-item-icon')).toHaveClass(/task/);
    await expect(item.locator('.activity-item-parent')).toHaveCount(0);
  });

  test('a completed subtask shows up too, with its parent task as context, even though the parent is still pending', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Follow up on vendor contract');
    const row = taskRow(page, 'Follow up on vendor contract');
    await openDetails(row);
    await row.getByPlaceholder('Add a subtask...').fill('Draft the email');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    await row.locator('.subtask-item', { hasText: 'Draft the email' }).getByRole('checkbox').check();

    // The parent task itself is NOT completed.
    await expect(row.locator('input[type="checkbox"][aria-label="Mark task complete"]')).not.toBeChecked();

    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await openActivity(page);

    const item = page.locator('.activity-item', { hasText: 'Draft the email' });
    await expect(item).toBeVisible();
    await expect(item.locator('.activity-item-icon')).toHaveClass(/subtask/);
    await expect(item.locator('.activity-item-parent')).toContainText('part of: Follow up on vendor contract');
  });

  test('navigating to Today shows nothing yet, and the empty state reads correctly', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Something done yesterday');
    await taskRow(page, 'Something done yesterday').getByRole('checkbox', { name: 'Mark task complete' }).check();
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await openActivity(page);
    await page.getByRole('button', { name: 'Today', exact: true }).click();

    await expect(page.locator('.activity-modal .placeholder')).toContainText('Nothing completed on Today');
    await expect(page.locator('.activity-item')).toHaveCount(0);
  });

  test('completing a task today shows it under Today, while Yesterday keeps its own item', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Old work');
    await taskRow(page, 'Old work').getByRole('checkbox', { name: 'Mark task complete' }).check();
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await addTask(page, 'New work');
    await taskRow(page, 'New work').getByRole('checkbox', { name: 'Mark task complete' }).check();

    await openActivity(page);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page.locator('.activity-item', { hasText: 'New work' })).toBeVisible();
    await expect(page.locator('.activity-item', { hasText: 'Old work' })).toHaveCount(0);

    await page.locator('.activity-date-nav').getByRole('button', { name: 'Previous day' }).click();
    await expect(page.locator('.activity-date-label')).toContainText('Yesterday');
    await expect(page.locator('.activity-item', { hasText: 'Old work' })).toBeVisible();
    await expect(page.locator('.activity-item', { hasText: 'New work' })).toHaveCount(0);
  });

  test('the next-day arrow and the direct date picker both navigate correctly', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Old work');
    await taskRow(page, 'Old work').getByRole('checkbox', { name: 'Mark task complete' }).check();
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await openActivity(page);
    // Yesterday -> Today via the forward arrow.
    await page.locator('.activity-date-nav').getByRole('button', { name: 'Next day' }).click();
    await expect(page.locator('.activity-date-label')).toContainText('Today');

    // Jump directly to an arbitrary past date with nothing completed.
    await page.locator('.activity-date-input').fill('2025-12-25');
    await expect(page.locator('.activity-modal .placeholder')).toContainText('Nothing completed');
    await expect(page.locator('.activity-item')).toHaveCount(0);
  });

  test('un-completing a task removes it from the log - it is live, not a separate record', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Flaky task');
    const row = taskRow(page, 'Flaky task');
    await row.getByRole('checkbox', { name: 'Mark task complete' }).check();
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await openActivity(page);
    await expect(page.locator('.activity-item', { hasText: 'Flaky task' })).toBeVisible();
    await page.locator('.activity-backdrop').click({ position: { x: 5, y: 5 } }); // click outside to close
    await expect(page.locator('.activity-modal')).toHaveCount(0);

    // Un-complete it from the Completed section. A plain click, not uncheck():
    // this moves the task to a different list (Completed -> Pending), so the
    // checkbox node itself gets torn down mid-action - uncheck() polls that
    // same node for its end state and hangs on the now-detached element.
    const completedRow = page.locator('#completed-container .task-item', { hasText: 'Flaky task' });
    await completedRow.getByRole('checkbox', { name: 'Mark task complete' }).click();

    await openActivity(page);
    await page.locator('.activity-date-nav').getByRole('button', { name: 'Previous day' }).click();
    await expect(page.locator('.activity-item', { hasText: 'Flaky task' })).toHaveCount(0);
  });

  test('Esc closes the modal', async ({ page }) => {
    await setup(page);
    await openActivity(page);
    await expect(page.locator('.activity-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.activity-modal')).toHaveCount(0);
  });

  test('copy summary puts a correctly formatted plain-text list on the clipboard', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Ship the release');
    await taskRow(page, 'Ship the release').getByRole('checkbox', { name: 'Mark task complete' }).check();

    await addTask(page, 'Parent task');
    const parentRow = taskRow(page, 'Parent task');
    await openDetails(parentRow);
    await parentRow.getByPlaceholder('Add a subtask...').fill('Draft the email');
    await parentRow.getByRole('button', { name: 'Add', exact: true }).click();
    await parentRow.locator('.subtask-item', { hasText: 'Draft the email' }).getByRole('checkbox').check();

    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await openActivity(page);
    await page.getByRole('button', { name: 'Copy summary' }).click();

    const copied = await page.evaluate(() => window.__clipboard.at(-1));
    expect(copied).toContain('What I did');
    expect(copied).toContain('- Ship the release');
    expect(copied).toContain('- Draft the email (part of: Parent task)');

    await expect(page.locator('.toast')).toContainText('Copied to clipboard');
  });

  test('copy summary on an empty day says so explicitly', async ({ page }) => {
    await setup(page);
    await openActivity(page);
    await page.getByRole('button', { name: 'Copy summary' }).click();

    const copied = await page.evaluate(() => window.__clipboard.at(-1));
    expect(copied).toContain('Nothing completed.');
  });

  test('markdown, emoji shortcodes, links and @mentions render the same as everywhere else', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Ship it :rocket: **today** and tell @sam [the ticket](https://example.com/T-1)');
    await taskRow(page, 'Ship it').getByRole('checkbox', { name: 'Mark task complete' }).check();
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await openActivity(page);
    const item = page.locator('.activity-item', { hasText: 'Ship it' });
    await expect(item).toContainText('🚀');
    await expect(item.locator('strong')).toHaveText('today');
    await expect(item.locator('.handle')).toHaveText('@sam');
    const link = item.locator('a');
    await expect(link).toHaveText('the ticket');
    await expect(link).toHaveAttribute('href', 'https://example.com/T-1');
    // Raw markdown source should not leak through as literal text.
    await expect(item).not.toContainText(':rocket:');
    await expect(item).not.toContainText('**today**');
  });

  test('the parent task name in "part of" also renders formatting', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Q3 :fire: cleanup');
    const row = taskRow(page, 'Q3');
    await openDetails(row);
    await row.getByPlaceholder('Add a subtask...').fill('Fix the redirect');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    await row.locator('.subtask-item', { hasText: 'Fix the redirect' }).getByRole('checkbox').check();
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await openActivity(page);
    const parentLine = page.locator('.activity-item-parent');
    await expect(parentLine).toContainText('🔥');
    await expect(parentLine).not.toContainText(':fire:');
  });

  test('items from the same task stay adjacent even if another task was completed in between', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Follow up on vendor contract');
    const row = taskRow(page, 'Follow up on vendor contract');
    await openDetails(row);
    await row.getByPlaceholder('Add a subtask...').fill('Draft the email');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    await row.locator('.subtask-item', { hasText: 'Draft the email' }).getByRole('checkbox').check();

    // A different task finishes in between - chronologically, this sits
    // between the vendor contract's two subtask completions.
    await addTask(page, 'Ship the release');
    await taskRow(page, 'Ship the release').getByRole('checkbox', { name: 'Mark task complete' }).check();

    await row.getByPlaceholder('Add a subtask...').fill('Call the vendor');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    await row.locator('.subtask-item', { hasText: 'Call the vendor' }).getByRole('checkbox').check();

    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await openActivity(page);

    const texts = await page.locator('.activity-item .activity-item-text').allTextContents();
    const draftIdx = texts.findIndex(t => t.includes('Draft the email'));
    const callIdx = texts.findIndex(t => t.includes('Call the vendor'));
    // The vendor contract's two subtasks are adjacent, regardless of where
    // "Ship the release" actually landed chronologically in between them.
    expect(Math.abs(draftIdx - callIdx)).toBe(1);
  });

  test('a task completed alongside its own subtasks leads its group', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Q3 auth cleanup');
    const row = taskRow(page, 'Q3 auth cleanup');
    await openDetails(row);
    await row.getByPlaceholder('Add a subtask...').fill('Fix the redirect');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    await row.locator('.subtask-item', { hasText: 'Fix the redirect' }).getByRole('checkbox').check();
    await row.getByRole('checkbox', { name: 'Mark task complete' }).check();

    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await openActivity(page);

    const texts = await page.locator('.activity-item .activity-item-text').allTextContents();
    expect(texts[0]).toContain('Q3 auth cleanup');
    expect(texts[1]).toContain('Fix the redirect');
  });

  test('every row carries a Task or Subtask badge', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Ship the release');
    await taskRow(page, 'Ship the release').getByRole('checkbox', { name: 'Mark task complete' }).check();

    await addTask(page, 'Parent task');
    const row = taskRow(page, 'Parent task');
    await openDetails(row);
    await row.getByPlaceholder('Add a subtask...').fill('A step');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    await row.locator('.subtask-item', { hasText: 'A step' }).getByRole('checkbox').check();

    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await openActivity(page);

    const taskItem = page.locator('.activity-item', { hasText: 'Ship the release' });
    await expect(taskItem.locator('.activity-type-pill')).toHaveText('Task');
    const subtaskItem = page.locator('.activity-item', { hasText: 'A step' });
    await expect(subtaskItem.locator('.activity-type-pill')).toHaveText('Subtask');
  });

  test('a task with a note shows a note icon; one without does not', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Noted task');
    const row = taskRow(page, 'Noted task');
    await setTaskNote(page, row, 'Used the renewal-v2 template.');
    await taskRow(page, 'Noted task').getByRole('checkbox', { name: 'Mark task complete' }).check();

    await addTask(page, 'Plain task');
    await taskRow(page, 'Plain task').getByRole('checkbox', { name: 'Mark task complete' }).check();

    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await openActivity(page);

    await expect(page.locator('.activity-item', { hasText: 'Noted task' }).locator('.activity-note-btn')).toHaveCount(1);
    await expect(page.locator('.activity-item', { hasText: 'Plain task' }).locator('.activity-note-btn')).toHaveCount(0);
  });

  test('clicking the note icon closes the activity log and opens the note in read mode', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Noted task');
    const row = taskRow(page, 'Noted task');
    await setTaskNote(page, row, 'Sent to procurement for sign-off.');
    await taskRow(page, 'Noted task').getByRole('checkbox', { name: 'Mark task complete' }).check();
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await openActivity(page);
    await page.locator('.activity-item', { hasText: 'Noted task' }).locator('.activity-note-btn').click();

    await expect(page.locator('.activity-modal')).toHaveCount(0);
    await expect(page.locator('.note-modal')).toBeVisible();
    await expect(page.locator('.note-modal-title')).toContainText('Noted task');
    await expect(page.locator('.note-preview')).toContainText('Sent to procurement for sign-off.');
  });

  test('a subtask note opens correctly too, scoped to the right subtask', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Parent task');
    const row = taskRow(page, 'Parent task');
    await openDetails(row);
    await row.getByPlaceholder('Add a subtask...').fill('Step with a note');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    const subtask = row.locator('.subtask-item', { hasText: 'Step with a note' });
    await subtask.locator('.subtask-note-btn').click();
    await page.locator('.note-textarea').fill('Details only relevant to this step.');
    await page.locator('.note-modal').getByRole('button', { name: 'Close notes' }).click();
    await subtask.getByRole('checkbox').check();

    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await openActivity(page);
    await page.locator('.activity-item', { hasText: 'Step with a note' }).locator('.activity-note-btn').click();

    await expect(page.locator('.note-modal-title')).toContainText('Step with a note');
    await expect(page.locator('.note-preview')).toContainText('Details only relevant to this step.');
  });

  test('the item count in the footer matches what is shown', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Task one');
    await addTask(page, 'Task two');
    await taskRow(page, 'Task one').getByRole('checkbox', { name: 'Mark task complete' }).check();
    await taskRow(page, 'Task two').getByRole('checkbox', { name: 'Mark task complete' }).check();
    await page.clock.fastForward(24 * 60 * 60 * 1000);

    await openActivity(page);
    await expect(page.locator('.activity-foot-hint')).toHaveText('2 items completed');
  });
});
