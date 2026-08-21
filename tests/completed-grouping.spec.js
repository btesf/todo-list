const { test, expect } = require('@playwright/test');

const STORAGE_KEY = 'enhancedTodoAppTasks_vue_v2';

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function seedCompleted(page, tasks) {
  await page.goto('/');
  await page.evaluate(({ key, tasks }) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(tasks));
  }, { key: STORAGE_KEY, tasks });
  await page.reload();
}

function completedTask(overrides) {
  return {
    id: 'c1', text: 'Completed thing', completed: true, completionDate: daysAgoIso(0),
    description: '', subtasks: [], isImportant: false, order: 0,
    dueDate: null, dueTime: null, tags: [],
    ...overrides,
  };
}

test('date groups are quiet labels with a count, not collapsible headers with a rule', async ({ page }) => {
  await seedCompleted(page, [
    completedTask({ id: 'a', text: 'Finished today', completionDate: daysAgoIso(0) }),
    completedTask({ id: 'b', text: 'Also finished today', completionDate: daysAgoIso(0), order: 1 }),
    completedTask({ id: 'c', text: 'Finished yesterday', completionDate: daysAgoIso(1), order: 2 }),
  ]);

  // Two groups, each labelled with its own count.
  const labels = page.locator('.completion-date');
  await expect(labels).toHaveCount(2);
  await expect(labels.nth(0)).toContainText('Today');
  await expect(labels.nth(0)).toContainText('2');
  await expect(labels.nth(1)).toContainText('Yesterday');
  await expect(labels.nth(1)).toContainText('1');

  // The old collapsible header markup is gone entirely - the label is a plain
  // heading, not a button/click target, and carries no bottom rule.
  await expect(page.locator('.date-header-container')).toHaveCount(0);
  await expect(page.locator('.collapse-toggle-icon')).toHaveCount(0);
  await expect(labels.first()).toHaveJSProperty('tagName', 'H3');
  await expect(labels.first()).toHaveCSS('border-bottom-width', '0px');
});

test('an old completed group is no longer collapsed - its tasks are visible immediately', async ({ page }) => {
  await seedCompleted(page, [
    completedTask({ id: 'old', text: 'Old completed task', completionDate: daysAgoIso(30) }),
  ]);

  await expect(page.locator('.completion-date')).toContainText('1');
  await expect(page.locator('.task-item', { hasText: 'Old completed task' })).toBeVisible();
  await expect(page.locator('.completed-list')).not.toHaveClass(/collapsed/);
});

test('a completed task with subtasks and a description can still be expanded individually', async ({ page }) => {
  await seedCompleted(page, [
    completedTask({
      id: 'detailed',
      text: 'Old completed task with history',
      completionDate: daysAgoIso(30),
      description: 'Investigated the flaky test.',
      subtasks: [{ id: 'sub-1', text: 'Reproduce issue', completed: true, order: 0 }],
    }),
  ]);

  const row = page.locator('.task-item', { hasText: 'Old completed task with history' });
  await expect(row).toBeVisible();

  // Detail is hidden until the row's own chevron is used.
  await expect(row.locator('.subtask-item')).toBeHidden();

  await row.getByRole('button', { name: 'View details' }).click();
  await expect(row).toHaveClass(/show-details/);
  await expect(row.locator('.subtask-item', { hasText: 'Reproduce issue' })).toBeVisible();
  await expect(row.locator('.task-description-display')).toContainText('Investigated the flaky test.');

  await row.getByRole('button', { name: 'View details' }).click();
  await expect(row).not.toHaveClass(/show-details/);
  await expect(row.locator('.subtask-item')).toBeHidden();
});

test('a completed task with no detail offers no expand control', async ({ page }) => {
  await seedCompleted(page, [
    completedTask({ id: 'bare', text: 'Nothing to see here' }),
  ]);

  const row = page.locator('.task-item', { hasText: 'Nothing to see here' });
  await expect(row.getByRole('button', { name: 'View details' })).toHaveCount(0);
});
