const { test, expect } = require('@playwright/test');
const { addTask, taskRow, openDetails, completeTask } = require('./helpers');

// A fixed Wednesday so "Tomorrow" (Thu), "Next Monday" (+5 days), and "In a
// week" (+7 days) land on three distinct, deterministic dates.
const ANCHOR_TIME = '2026-01-07T10:00:00';

async function setup(page, { time = ANCHOR_TIME } = {}) {
  await page.clock.install({ time });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

// The periodic snooze check runs every 15 minutes (same interval as the
// overdue check). This lands the fake clock exactly on the first tick that
// falls at least a second past the given date's end-of-day, so the check is
// guaranteed to run - and because we land exactly ON that tick (not partway
// past it), the toast it shows has 6 full seconds left before its own
// auto-dismiss timer fires, so it's still visible right after fastForward.
async function fastForwardPastSnoozeEnd(page, snoozeDateStr, fromTime = ANCHOR_TIME) {
  const expiry = new Date(`${snoozeDateStr}T23:59:59.999`).getTime();
  const now = new Date(fromTime).getTime();
  const tickMs = 15 * 60 * 1000;
  const ticksNeeded = Math.ceil((expiry - now + 1000) / tickMs);
  await page.clock.fastForward(ticksNeeded * tickMs);
}

async function snoozeVia(row, optionName) {
  await row.getByRole('button', { name: 'Snooze task' }).click();
  await row.getByRole('button', { name: optionName, exact: true }).click();
}

test.describe('snoozing a task', () => {
  test('snoozing via "Tomorrow" hides the task from Pending', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Follow up on vendor contract');
    const row = taskRow(page, 'Follow up on vendor contract');

    await snoozeVia(row, 'Tomorrow');

    // Pending is always the first .task-section in the DOM, whether or not a
    // Snoozed/Completed section is present alongside it.
    const pendingSection = page.locator('.task-section').first();
    await expect(pendingSection.locator('.task-item', { hasText: 'Follow up on vendor contract' })).toHaveCount(0);

    // Still exists - relocated into Snoozed, not deleted.
    await page.locator('.section-toggle-btn', { hasText: 'Snoozed' }).click();
    await expect(page.locator('#snoozed-section-content .task-item', { hasText: 'Follow up on vendor contract' })).toBeVisible();
  });

  test('the Snoozed section is collapsed by default and sits before Completed', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Renew the domain');
    await snoozeVia(taskRow(page, 'Renew the domain'), 'Tomorrow');

    const snoozedToggle = page.locator('.section-toggle-btn', { hasText: 'Snoozed' });
    await expect(snoozedToggle).toBeVisible();
    await expect(snoozedToggle).toHaveClass(/collapsed/);
    await expect(page.locator('#snoozed-section-content .task-item')).toBeHidden();

    // DOM order: Snoozed appears before Completed.
    const sectionTitles = await page.locator('.task-section .section-header, .task-section h2').allTextContents();
    const snoozedIndex = sectionTitles.findIndex(t => t.includes('Snoozed'));
    const completedIndex = sectionTitles.findIndex(t => t.includes('Completed'));
    expect(snoozedIndex).toBeGreaterThan(-1);
    expect(snoozedIndex).toBeLessThan(completedIndex);

    await snoozedToggle.click();
    await expect(page.locator('#snoozed-section-content .task-item', { hasText: 'Renew the domain' })).toBeVisible();
  });

  test('the section is hidden entirely when nothing is snoozed', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Just a normal task');
    await expect(page.locator('.section-toggle-btn', { hasText: 'Snoozed' })).toHaveCount(0);
  });

  test('the badge shows the relative and absolute return date', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Ping the team');
    const row = taskRow(page, 'Ping the team');
    await snoozeVia(row, 'Tomorrow');
    await page.locator('.section-toggle-btn', { hasText: 'Snoozed' }).click();

    const snoozedRow = page.locator('#snoozed-section-content .task-item', { hasText: 'Ping the team' });
    await expect(snoozedRow.locator('.snooze-badge')).toContainText('Tomorrow');
    await expect(snoozedRow.locator('.snooze-badge')).toContainText('Jan 8');
  });

  test('"Next Monday" and "In a week" resolve to distinct, correct dates', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Plan the sprint');
    await addTask(page, 'Archive old files');

    await snoozeVia(taskRow(page, 'Plan the sprint'), 'Next Monday');
    await snoozeVia(taskRow(page, 'Archive old files'), 'In a week');
    await page.locator('.section-toggle-btn', { hasText: 'Snoozed' }).click();

    const monday = page.locator('#snoozed-section-content .task-item', { hasText: 'Plan the sprint' });
    const week = page.locator('#snoozed-section-content .task-item', { hasText: 'Archive old files' });
    await expect(monday.locator('.snooze-badge')).toContainText('in 5 days');
    await expect(monday.locator('.snooze-badge')).toContainText('Jan 12');
    await expect(week.locator('.snooze-badge')).toContainText('in 7 days');
    await expect(week.locator('.snooze-badge')).toContainText('Jan 14');
  });

  test('a custom date can be picked directly', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Quarterly review');
    const row = taskRow(page, 'Quarterly review');
    await row.getByRole('button', { name: 'Snooze task' }).click();
    await row.locator('.snooze-date-input').fill('2026-03-15');
    await page.locator('.section-toggle-btn', { hasText: 'Snoozed' }).click();

    const snoozedRow = page.locator('#snoozed-section-content .task-item', { hasText: 'Quarterly review' });
    await expect(snoozedRow.locator('.snooze-badge')).toContainText('Mar 15');
  });

  test('the clear button unsnoozes immediately, no waiting required', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Call the plumber');
    await snoozeVia(taskRow(page, 'Call the plumber'), 'Tomorrow');
    await page.locator('.section-toggle-btn', { hasText: 'Snoozed' }).click();

    const snoozedRow = page.locator('#snoozed-section-content .task-item', { hasText: 'Call the plumber' });
    await snoozedRow.getByRole('button', { name: 'Move back to Pending now' }).click();

    await expect(page.locator('.section-toggle-btn', { hasText: 'Snoozed' })).toHaveCount(0);
    await expect(taskRow(page, 'Call the plumber')).toBeVisible();
  });

  test('a snoozed task returns to Pending on its own once the date passes, with a toast', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Follow up on vendor contract');
    await snoozeVia(taskRow(page, 'Follow up on vendor contract'), 'Tomorrow');
    await expect(page.locator('.section-toggle-btn', { hasText: 'Snoozed' })).toBeVisible();

    await fastForwardPastSnoozeEnd(page, '2026-01-08');

    await expect(page.locator('.toast')).toContainText('"Follow up on vendor contract" is back from snooze');
    await expect(page.locator('.section-toggle-btn', { hasText: 'Snoozed' })).toHaveCount(0);
    await expect(taskRow(page, 'Follow up on vendor contract')).toBeVisible();
  });

  test('multiple tasks returning at once get one consolidated toast', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Task A');
    await addTask(page, 'Task B');
    await snoozeVia(taskRow(page, 'Task A'), 'Tomorrow');
    await snoozeVia(taskRow(page, 'Task B'), 'Tomorrow');

    await fastForwardPastSnoozeEnd(page, '2026-01-08');

    await expect(page.locator('.toast')).toContainText('2 tasks are back from snooze');
    await expect(taskRow(page, 'Task A')).toBeVisible();
    await expect(taskRow(page, 'Task B')).toBeVisible();
  });

  test('the collapsed/expanded state persists across a reload', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Something to snooze');
    await snoozeVia(taskRow(page, 'Something to snooze'), 'Tomorrow');

    const toggle = page.locator('.section-toggle-btn', { hasText: 'Snoozed' });
    await expect(toggle).toHaveClass(/collapsed/);
    await toggle.click();
    await expect(toggle).not.toHaveClass(/collapsed/);

    await page.reload();
    await expect(page.locator('.section-toggle-btn', { hasText: 'Snoozed' })).not.toHaveClass(/collapsed/);
  });

  test('subtasks of a snoozed task stay hidden by default, same as a completed task', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Parent with subtasks');
    const row = taskRow(page, 'Parent with subtasks');
    await openDetails(row);
    await row.getByPlaceholder('Add a subtask...').fill('Step one');
    await row.getByRole('button', { name: 'Add', exact: true }).click();

    await snoozeVia(row, 'Tomorrow');
    await page.locator('.section-toggle-btn', { hasText: 'Snoozed' }).click();

    const snoozedRow = page.locator('#snoozed-section-content .task-item', { hasText: 'Parent with subtasks' });
    await expect(snoozedRow.locator('.subtask-progress-badge')).toContainText('0/1');
    await expect(snoozedRow.locator('.subtask-item')).not.toBeVisible();

    await snoozedRow.locator('.subtask-progress-badge').click();
    await expect(snoozedRow.locator('.subtask-item', { hasText: 'Step one' })).toBeVisible();
  });

  test('there is no per-subtask snooze control - task-level only', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Parent task');
    const row = taskRow(page, 'Parent task');
    await openDetails(row);
    await row.getByPlaceholder('Add a subtask...').fill('A step');
    await row.getByRole('button', { name: 'Add', exact: true }).click();

    const subtask = row.locator('.subtask-item', { hasText: 'A step' });
    await expect(subtask.getByRole('button', { name: 'Snooze task' })).toHaveCount(0);
    await expect(subtask.locator('.snooze-btn')).toHaveCount(0);
  });

  test('a completed task cannot be snoozed', async ({ page }) => {
    await setup(page);
    await addTask(page, 'Done already');
    await completeTask(page, 'Done already');

    const completedRow = page.locator('#completed-container .task-item', { hasText: 'Done already' });
    await expect(completedRow.getByRole('button', { name: 'Snooze task' })).toHaveCount(0);
  });
});
