const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails, completeTask } = require('./helpers');

const STORAGE_KEY = 'enhancedTodoAppTasks_vue_v2';

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept());
  await resetApp(page);
});

async function addSubtask(row, text) {
  await row.locator('#add-subtask-form input').fill(text);
  await row.getByRole('button', { name: 'Add', exact: true }).click();
}

function shortToday() {
  return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

test('checking a subtask stamps its completion date; it shows in the ledger column', async ({ page }) => {
  await addTask(page, 'Parent');
  const row = taskRow(page, 'Parent');
  await openDetails(row);
  await addSubtask(row, 'Do the thing');

  const subtask = row.locator('.subtask-item', { hasText: 'Do the thing' });
  await expect(subtask.locator('.subtask-completed-date')).toHaveCount(0);

  await subtask.getByRole('checkbox').check();
  await expect(subtask.locator('.subtask-completed-date')).toHaveText(shortToday());

  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
  expect(stored[0].subtasks[0].completionDate).toBeTruthy();
});

test('un-checking a subtask clears its completion date', async ({ page }) => {
  await addTask(page, 'Parent');
  const row = taskRow(page, 'Parent');
  await openDetails(row);
  await addSubtask(row, 'Toggle me');

  const subtask = row.locator('.subtask-item', { hasText: 'Toggle me' });
  await subtask.getByRole('checkbox').check();
  await expect(subtask.locator('.subtask-completed-date')).toBeVisible();

  await subtask.getByRole('checkbox').uncheck();
  await expect(subtask.locator('.subtask-completed-date')).toHaveCount(0);

  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
  expect(stored[0].subtasks[0].completionDate).toBeNull();
});

test('re-checking after an un-check stamps a fresh date', async ({ page }) => {
  // Seed a subtask completed long ago, then toggle it off and on: the old date
  // must not survive; the new stamp is today.
  await page.evaluate((k) => {
    localStorage.setItem(k, JSON.stringify([{
      id: 't1', text: 'Parent', completed: false, completionDate: null,
      description: '', isImportant: false, order: 0, dueDate: null, dueTime: null, tags: [],
      subtasks: [{ id: 's1', text: 'Old completion', completed: true, completionDate: '2020-01-02T00:00:00.000Z', order: 0 }],
    }]));
  }, STORAGE_KEY);
  await page.reload();

  const row = taskRow(page, 'Parent');
  await openDetails(row);
  const subtask = row.locator('.subtask-item', { hasText: 'Old completion' });
  // Old year is shown with a year.
  await expect(subtask.locator('.subtask-completed-date')).toContainText('2020');

  await subtask.getByRole('checkbox').uncheck();
  await subtask.getByRole('checkbox').check();
  await expect(subtask.locator('.subtask-completed-date')).toHaveText(shortToday());
});

test('a completion in a previous year shows the year; the current year omits it', async ({ page }) => {
  const thisYear = new Date().getFullYear();
  await page.evaluate(({ k, y }) => {
    localStorage.setItem(k, JSON.stringify([{
      id: 't1', text: 'Parent', completed: false, completionDate: null,
      description: '', isImportant: false, order: 0, dueDate: null, dueTime: null, tags: [],
      subtasks: [
        { id: 's1', text: 'This year', completed: true, completionDate: new Date(y, 7, 14).toISOString(), order: 0 },
        { id: 's2', text: 'Last year', completed: true, completionDate: new Date(y - 1, 11, 20).toISOString(), order: 1 },
      ],
    }]));
  }, { k: STORAGE_KEY, y: thisYear });
  await page.reload();

  const row = taskRow(page, 'Parent');
  await openDetails(row);
  const thisYearDate = row.locator('.subtask-item', { hasText: 'This year' }).locator('.subtask-completed-date');
  const lastYearDate = row.locator('.subtask-item', { hasText: 'Last year' }).locator('.subtask-completed-date');

  await expect(thisYearDate).not.toContainText(String(thisYear));
  await expect(lastYearDate).toContainText(String(thisYear - 1));
});

test('pre-existing completed subtasks with no date simply show none', async ({ page }) => {
  await page.evaluate((k) => {
    localStorage.setItem(k, JSON.stringify([{
      id: 't1', text: 'Legacy parent', completed: false, completionDate: null,
      description: '', isImportant: false, order: 0, dueDate: null, dueTime: null, tags: [],
      // Old-format subtask: completed, but no completionDate field at all.
      subtasks: [{ id: 's1', text: 'Legacy done', completed: true, order: 0 }],
    }]));
  }, STORAGE_KEY);
  await page.reload();

  const row = taskRow(page, 'Legacy parent');
  await openDetails(row);
  const subtask = row.locator('.subtask-item', { hasText: 'Legacy done' });
  await expect(subtask).toBeVisible();
  await expect(subtask.locator('.subtask-completed-date')).toHaveCount(0);
});

test('subtask dates are visible read-only inside a completed parent (no delete control)', async ({ page }) => {
  await addTask(page, 'Wraps up');
  const row = taskRow(page, 'Wraps up');
  await openDetails(row);
  await addSubtask(row, 'Finished step');
  await row.locator('.subtask-item', { hasText: 'Finished step' }).getByRole('checkbox').check();

  await completeTask(page, 'Wraps up');
  const completedRow = page.locator('#completed-container .task-item', { hasText: 'Wraps up' });
  await completedRow.getByRole('button', { name: 'View details' }).click();

  const subtask = completedRow.locator('.subtask-item', { hasText: 'Finished step' });
  await expect(subtask.locator('.subtask-completed-date')).toHaveText(shortToday());
  await expect(subtask.locator('.delete-subtask-btn')).toHaveCount(0);
});
