const { test, expect } = require('@playwright/test');
const { addTask, taskRow, completeTask, openDetails } = require('./helpers');

// window.Notification is a plain writable global (unlike window.indexedDB,
// which is getter-only and needs Object.defineProperty - see auto-save-file
// tests), so a straightforward assignment in an init script is enough.
async function mockNotification(page, initialPermission = 'default') {
  await page.addInitScript((perm) => {
    window.__notifications = [];
    class FakeNotification {
      constructor(title, options) {
        window.__notifications.push({ title, body: options && options.body });
      }
      static requestPermission() {
        FakeNotification.permission = 'granted';
        return Promise.resolve('granted');
      }
    }
    FakeNotification.permission = perm;
    window.Notification = FakeNotification;
  }, initialPermission);
}

// Only installs a fake clock when explicitly given a `time` - most scenarios
// below don't need controlled time and are simpler/more robust using plain
// relative real dates instead.
async function setup(page, { permission = 'default', time } = {}) {
  await mockNotification(page, permission);
  if (time) await page.clock.install({ time });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

// Local date components, not toISOString() (which is UTC) - the app parses
// due dates as local time (see getTaskDueDateTime in script.js), so in any
// timezone ahead of UTC there are hours each day where the UTC date and local
// date disagree, which made "today" here silently mean "yesterday" to the app.
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
const YESTERDAY = dateOffset(-1);
const TWO_DAYS_AGO = dateOffset(-2);
const TODAY = dateOffset(0);
const TOMORROW = dateOffset(1);

// The due-date pill is a ghost "Due date" button before a date is set, and a
// populated pill (e.g. "Jan 1") once one is - .meta-pill covers both states
// and is always the first such pill in the row (the "+ Tag" ghost button
// also carries this class, but only appears after the due-date control).
async function openDueEditor(row) {
  if (await row.locator('input[type="date"]').isVisible()) {
    return; // already mid-edit from a prior call in this test - setDue never closes it
  }
  const pill = row.locator('.meta-pill').first();
  if (!(await pill.isVisible())) {
    await openDetails(row); // first time: the meta-row only exists once details are expanded
  }
  await row.locator('.meta-pill').first().click();
}
async function setDue(row, dateStr, timeStr) {
  await openDueEditor(row);
  await row.locator('input[type="date"]').fill(dateStr);
  if (timeStr !== undefined) await row.locator('input[type="time"]').fill(timeStr);
}

test.describe('overdue alerts', () => {
  test('a past due date alerts on load, with both banner and native notification', async ({ page }) => {
    await setup(page, { permission: 'granted' });
    await addTask(page, 'Overdue on load');
    await setDue(taskRow(page, 'Overdue on load'), YESTERDAY);

    await expect(page.locator('.overdue-alert-banner')).toContainText('"Overdue on load" is overdue');
    const notifications = await page.evaluate(() => window.__notifications);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toContain('Overdue on load');
  });

  test('due today is overdue once its time has passed, not before', async ({ page }) => {
    await setup(page, { permission: 'granted' });
    await addTask(page, 'Later today');
    await setDue(taskRow(page, 'Later today'), TODAY, '23:59');
    await expect(page.locator('.overdue-alert-banner')).toHaveCount(0);

    await addTask(page, 'Earlier today');
    await setDue(taskRow(page, 'Earlier today'), TODAY, '00:01');
    await expect(page.locator('.overdue-alert-banner')).toContainText('Earlier today');
    await expect(page.locator('.overdue-alert-banner')).not.toContainText('Later today');
  });

  test('dismissing the banner keeps it hidden on a same-day reload', async ({ page }) => {
    await setup(page, { permission: 'granted' });
    await addTask(page, 'Dismiss and reload');
    await setDue(taskRow(page, 'Dismiss and reload'), YESTERDAY);
    await expect(page.locator('.overdue-alert-banner')).toBeVisible();

    await page.locator('.overdue-alert-banner').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.overdue-alert-banner')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.overdue-alert-banner')).toHaveCount(0);
  });

  test('the 15-minute periodic check catches a task becoming overdue intraday, with no reload', async ({ page }) => {
    await setup(page, { permission: 'granted', time: new Date('2027-06-15T10:00:00') });
    await addTask(page, 'Intraday task');
    await setDue(taskRow(page, 'Intraday task'), '2027-06-15', '10:10');
    await expect(page.locator('.overdue-alert-banner')).toHaveCount(0);

    await page.clock.fastForward(16 * 60 * 1000); // past both the 10:15 interval tick and the 10:10 due time
    await expect(page.locator('.overdue-alert-banner')).toContainText('Intraday task');
  });

  test('a still-overdue task alerts again the next day, even though it was dismissed and the due date is unchanged', async ({ page }) => {
    await setup(page, { permission: 'granted', time: new Date('2027-06-15T10:00:00') });
    await addTask(page, 'Daily repeat');
    await setDue(taskRow(page, 'Daily repeat'), '2027-06-14');
    await expect(page.locator('.overdue-alert-banner')).toContainText('Daily repeat');

    await page.locator('.overdue-alert-banner').getByRole('button', { name: 'Dismiss' }).click();
    await page.clock.fastForward(25 * 60 * 60 * 1000); // past midnight
    await expect(page.locator('.overdue-alert-banner')).toContainText('Daily repeat');
  });

  test('editing the due date to a different past date re-alerts the same day', async ({ page }) => {
    await setup(page, { permission: 'granted' });
    await addTask(page, 'Edited due date');
    const row = taskRow(page, 'Edited due date');
    await setDue(row, YESTERDAY);
    await expect(page.locator('.overdue-alert-banner')).toContainText('Edited due date');
    await page.locator('.overdue-alert-banner').getByRole('button', { name: 'Dismiss' }).click();

    await setDue(row, TWO_DAYS_AGO);
    await expect(page.locator('.overdue-alert-banner')).toContainText('Edited due date');
  });

  test('pushing the due date to the future clears the overdue state, and pulling it back into the past alerts again', async ({ page }) => {
    await setup(page, { permission: 'granted' });
    await addTask(page, 'Future then past');
    const row = taskRow(page, 'Future then past');
    await setDue(row, YESTERDAY);
    await expect(page.locator('.overdue-alert-banner')).toContainText('Future then past');
    await page.locator('.overdue-alert-banner').getByRole('button', { name: 'Dismiss' }).click();

    await setDue(row, TOMORROW);
    // setDue leaves the date editor open, and the collapsed-row .due-badge is
    // suppressed while a task is expanded - blur to render the populated pill.
    await row.locator('input[type="date"]').blur();
    await expect(row.locator('.meta-pill:not(.meta-pill-ghost)')).not.toHaveClass(/overdue/);
    await expect(page.locator('.overdue-alert-banner')).toHaveCount(0);

    await setDue(row, YESTERDAY);
    await expect(page.locator('.overdue-alert-banner')).toContainText('Future then past');
  });

  test('completing an overdue task clears its bookkeeping; un-completing it while still overdue re-alerts', async ({ page }) => {
    await setup(page, { permission: 'granted' });
    await addTask(page, 'Toggle complete');
    const row = taskRow(page, 'Toggle complete');
    await setDue(row, YESTERDAY);
    await expect(page.locator('.overdue-alert-banner')).toContainText('Toggle complete');
    await page.locator('.overdue-alert-banner').getByRole('button', { name: 'Dismiss' }).click();

    await completeTask(page, 'Toggle complete');
    await expect(page.locator('.overdue-alert-banner')).toHaveCount(0);

    const completedRow = page.locator('#completed-container .task-item', { hasText: 'Toggle complete' });
    await completedRow.getByRole('checkbox', { name: 'Mark task complete' }).click();
    await expect(page.locator('.overdue-alert-banner')).toContainText('Toggle complete');
  });

  test('multiple simultaneously overdue tasks produce one consolidated banner and notification, not one each', async ({ page }) => {
    // Seeded directly (rather than added one at a time through the UI) so both
    // tasks are already overdue at the very first check, in the same cycle -
    // adding them sequentially would alert on the first before the second
    // exists, which is correct behavior but not what this test is after.
    await mockNotification(page, 'granted');
    await page.goto('/');
    await page.evaluate(({ a, b }) => {
      localStorage.setItem('enhancedTodoAppTasks_vue_v2', JSON.stringify([
        { id: '1', text: 'Overdue A', completed: false, completionDate: null, description: '', subtasks: [], isImportant: false, order: 0, dueDate: a, dueTime: null, tags: [] },
        { id: '2', text: 'Overdue B', completed: false, completionDate: null, description: '', subtasks: [], isImportant: false, order: 1, dueDate: b, dueTime: null, tags: [] },
      ]));
    }, { a: YESTERDAY, b: TWO_DAYS_AGO });
    await page.reload();

    await expect(page.locator('.overdue-alert-banner')).toContainText('Overdue A');
    await expect(page.locator('.overdue-alert-banner')).toContainText('Overdue B');
    await expect(page.locator('.overdue-alert-banner')).toHaveCount(1);
    const notifications = await page.evaluate(() => window.__notifications);
    expect(notifications).toHaveLength(1);
  });

  test('the in-app banner still works when notification permission is not granted', async ({ page }) => {
    await setup(page, { permission: 'denied' });
    await addTask(page, 'No permission fallback');
    await setDue(taskRow(page, 'No permission fallback'), YESTERDAY);

    await expect(page.locator('.overdue-alert-banner')).toContainText('No permission fallback');
    const notifications = await page.evaluate(() => window.__notifications);
    expect(notifications).toHaveLength(0);
  });

  test('enabling notifications via the permission banner allows subsequent alerts to fire a native notification', async ({ page }) => {
    await setup(page, { permission: 'default' });
    await expect(page.getByText('Get notified when a task becomes overdue')).toBeVisible();

    await page.getByRole('button', { name: 'Enable notifications' }).click();
    await expect(page.getByText('Get notified when a task becomes overdue')).toHaveCount(0);

    await addTask(page, 'Notify after enabling');
    await setDue(taskRow(page, 'Notify after enabling'), YESTERDAY);
    const notifications = await page.evaluate(() => window.__notifications);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toContain('Notify after enabling');
  });

  test('no overdue tasks means no banner and no notification', async ({ page }) => {
    await setup(page, { permission: 'granted' });
    await addTask(page, 'Not due yet');
    await setDue(taskRow(page, 'Not due yet'), TOMORROW);

    await expect(page.locator('.overdue-alert-banner')).toHaveCount(0);
    const notifications = await page.evaluate(() => window.__notifications);
    expect(notifications).toHaveLength(0);
  });
});
