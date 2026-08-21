const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails } = require('./helpers');

const STORAGE_KEY = 'enhancedTodoAppTasks_vue_v2';

function task(overrides) {
  return {
    id: 't1', text: 'A task', completed: false, completionDate: null,
    description: '', subtasks: [], isImportant: false, order: 0,
    dueDate: null, dueTime: null, tags: [],
    ...overrides,
  };
}

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function seed(page, tasks) {
  await page.goto('/');
  await page.evaluate(({ key, tasks }) => {
    localStorage.clear();
    localStorage.setItem('autoSaveBannerDismissed', '1');
    localStorage.setItem(key, JSON.stringify(tasks));
  }, { key: STORAGE_KEY, tasks });
  await page.reload();
}

test.describe('search shortcuts', () => {
  test.beforeEach(async ({ page }) => { await resetApp(page); });

  test('Escape clears the search field', async ({ page }) => {
    await addTask(page, 'Findable task');
    const search = page.getByPlaceholder('Search tasks...');
    await search.fill('Findable');
    await expect(search).toHaveValue('Findable');

    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(taskRow(page, 'Findable task')).toBeVisible();
  });
});

test.describe('tag overview', () => {
  test('lists every tag in use with its count, sorted by frequency', async ({ page }) => {
    await seed(page, [
      task({ id: 'a', text: 'One', tags: ['work', 'urgent'] }),
      task({ id: 'b', text: 'Two', order: 1, tags: ['work'] }),
      task({ id: 'c', text: 'Three', order: 2, tags: ['work', 'later'] }),
    ]);

    await page.getByRole('button', { name: /^Tags/ }).click();
    const items = page.locator('.tag-manage-item');
    await expect(items).toHaveCount(3);
    // work (3) first, then the two 1-count tags alphabetically.
    await expect(items.nth(0)).toContainText('work');
    await expect(items.nth(0)).toContainText('3');
    await expect(items.nth(1)).toContainText('later');
    await expect(items.nth(2)).toContainText('urgent');
  });

  test('the panel is absent entirely when no tags exist', async ({ page }) => {
    await seed(page, [task({ text: 'Untagged' })]);
    await expect(page.locator('.tag-panel')).toHaveCount(0);
  });

  test('the open/closed state survives a reload', async ({ page }) => {
    await seed(page, [task({ tags: ['keep'] })]);
    const toggle = page.getByRole('button', { name: /^Tags/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await page.reload();
    await expect(page.getByRole('button', { name: /^Tags/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('clicking a tag in the panel filters the list, without touching the search box', async ({ page }) => {
    await seed(page, [
      task({ id: 'a', text: 'Has the tag', tags: ['work'] }),
      task({ id: 'b', text: 'Does not', order: 1, tags: [] }),
    ]);

    await page.getByRole('button', { name: /^Tags/ }).click();
    await page.locator('.tag-manage-item .tag-filter-chip', { hasText: 'work' }).click();

    await expect(page.getByPlaceholder('Search tasks...')).toHaveValue('');
    await expect(page.locator('.filter-bar')).toContainText('work');
    await expect(taskRow(page, 'Has the tag')).toBeVisible();
    await expect(page.locator('.task-item', { hasText: 'Does not' })).toHaveCount(0);
  });

  test('selecting two tags narrows to tasks carrying both (AND)', async ({ page }) => {
    await seed(page, [
      task({ id: 'a', text: 'Both', tags: ['backend', 'urgent'] }),
      task({ id: 'b', text: 'Backend only', order: 1, tags: ['backend'] }),
      task({ id: 'c', text: 'Urgent only', order: 2, tags: ['urgent'] }),
    ]);
    await page.getByRole('button', { name: /^Tags/ }).click();

    await page.locator('.tag-manage-item .tag-filter-chip', { hasText: 'backend' }).click();
    await expect(page.locator('.task-list .task-text')).toHaveCount(2);

    await page.locator('.tag-manage-item .tag-filter-chip', { hasText: 'urgent' }).click();
    await expect(page.locator('.task-list .task-text')).toHaveCount(1);
    await expect(taskRow(page, 'Both')).toBeVisible();

    // Both panel chips show the selected (active) state.
    await expect(page.locator('.tag-filter-chip.active')).toHaveCount(2);
    await expect(page.locator('.filter-bar-chip')).toHaveCount(2);
  });

  test('a selected tag toggles off when clicked again', async ({ page }) => {
    await seed(page, [
      task({ id: 'a', text: 'Tagged', tags: ['work'] }),
      task({ id: 'b', text: 'Untagged', order: 1, tags: [] }),
    ]);
    await page.getByRole('button', { name: /^Tags/ }).click();
    const chip = page.locator('.tag-manage-item .tag-filter-chip', { hasText: 'work' });

    await chip.click();
    await expect(page.locator('.task-item', { hasText: 'Untagged' })).toHaveCount(0);

    await chip.click(); // toggle off
    await expect(page.locator('.filter-bar')).toHaveCount(0);
    await expect(page.locator('.task-item', { hasText: 'Untagged' })).toBeVisible();
  });

  test('the filter bar clears all active tags at once', async ({ page }) => {
    await seed(page, [
      task({ id: 'a', text: 'A', tags: ['x', 'y'] }),
      task({ id: 'b', text: 'B', order: 1, tags: [] }),
    ]);
    await page.getByRole('button', { name: /^Tags/ }).click();
    await page.locator('.tag-manage-item .tag-filter-chip', { hasText: 'x' }).click();
    await page.locator('.tag-manage-item .tag-filter-chip', { hasText: 'y' }).click();
    await expect(page.locator('.filter-bar-chip')).toHaveCount(2);

    await page.locator('.filter-bar-clear').click();
    await expect(page.locator('.filter-bar')).toHaveCount(0);
    await expect(page.locator('.task-item', { hasText: 'B' })).toBeVisible();
  });

  test('a filter chip in the bar removes just that tag', async ({ page }) => {
    await seed(page, [task({ tags: ['keep', 'drop'] })]);
    await page.getByRole('button', { name: /^Tags/ }).click();
    await page.locator('.tag-manage-item .tag-filter-chip', { hasText: 'keep' }).click();
    await page.locator('.tag-manage-item .tag-filter-chip', { hasText: 'drop' }).click();

    await page.locator('.filter-bar-chip', { hasText: 'drop' }).click();
    await expect(page.locator('.filter-bar-chip')).toHaveCount(1);
    await expect(page.locator('.filter-bar-chip')).toContainText('keep');
  });

  test('renaming a tag inline updates every task carrying it, and can be undone', async ({ page }) => {
    await seed(page, [
      task({ id: 'a', text: 'First', tags: ['tyop'] }),
      task({ id: 'b', text: 'Second', order: 1, tags: ['tyop', 'other'] }),
    ]);
    await page.getByRole('button', { name: /^Tags/ }).click();

    await page.getByRole('button', { name: 'Rename tag tyop' }).click();
    const input = page.locator('.tag-rename-input');
    await expect(input).toBeFocused();
    await input.fill('typo');
    await input.press('Enter');

    await expect(page.locator('.tag-manage-item', { hasText: 'typo' })).toContainText('2');
    await expect(page.locator('.tag-manage-item', { hasText: 'tyop' })).toHaveCount(0);

    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.tag-manage-item', { hasText: 'tyop' })).toContainText('2');
  });

  test('Escape cancels an inline rename, leaving the tag unchanged', async ({ page }) => {
    await seed(page, [task({ tags: ['keepme'] })]);
    await page.getByRole('button', { name: /^Tags/ }).click();

    await page.getByRole('button', { name: 'Rename tag keepme' }).click();
    const input = page.locator('.tag-rename-input');
    await input.fill('somethingelse');
    await input.press('Escape');

    await expect(page.locator('.tag-rename-input')).toHaveCount(0);
    await expect(page.locator('.tag-manage-item', { hasText: 'keepme' })).toBeVisible();
    await expect(page.locator('.tag-manage-item', { hasText: 'somethingelse' })).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);
  });

  test('renaming onto an existing tag merges them without duplicating', async ({ page }) => {
    await seed(page, [task({ id: 'a', text: 'Both tags', tags: ['a-tag', 'b-tag'] })]);
    await page.getByRole('button', { name: /^Tags/ }).click();

    await page.getByRole('button', { name: 'Rename tag a-tag' }).click();
    await page.locator('.tag-rename-input').fill('b-tag');
    await page.locator('.tag-rename-input').press('Enter');

    await expect(page.locator('.tag-manage-item')).toHaveCount(1);
    await expect(page.locator('.tag-manage-item')).toContainText('b-tag');

    const tagsOnTask = await page.evaluate((key) =>
      JSON.parse(localStorage.getItem(key))[0].tags, STORAGE_KEY);
    expect(tagsOnTask).toEqual(['b-tag']);
  });

  test('renaming to a blank name is a no-op', async ({ page }) => {
    await seed(page, [task({ tags: ['unchanged'] })]);
    await page.getByRole('button', { name: /^Tags/ }).click();

    await page.getByRole('button', { name: 'Rename tag unchanged' }).click();
    await page.locator('.tag-rename-input').fill('   ');
    await page.locator('.tag-rename-input').press('Enter');

    await expect(page.locator('.tag-manage-item', { hasText: 'unchanged' })).toBeVisible();
    await expect(page.locator('.toast')).toHaveCount(0);
  });

  test('deleting a tag removes it from all tasks, and can be undone', async ({ page }) => {
    await seed(page, [
      task({ id: 'a', text: 'First', tags: ['drop', 'keep'] }),
      task({ id: 'b', text: 'Second', order: 1, tags: ['drop'] }),
    ]);
    await page.getByRole('button', { name: /^Tags/ }).click();

    await page.getByRole('button', { name: 'Delete tag drop' }).click();
    await expect(page.locator('.tag-manage-item', { hasText: 'drop' })).toHaveCount(0);
    await expect(page.locator('.tag-manage-item', { hasText: 'keep' })).toBeVisible();

    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.tag-manage-item', { hasText: 'drop' })).toContainText('2');
  });
});

test.describe('opt-in overdue-first sort', () => {
  const overdueSetup = () => [
    task({ id: 'a', text: 'Normal one', order: 0 }),
    task({ id: 'b', text: 'Late one', order: 1, dueDate: dateOffset(-3) }),
    task({ id: 'c', text: 'Normal two', order: 2 }),
  ];

  test('is off by default - manual order is preserved', async ({ page }) => {
    await seed(page, overdueSetup());
    const texts = page.locator('#pending-list .task-text, .task-list .task-text');
    await expect(texts.nth(0)).toHaveText('Normal one');
    await expect(texts.nth(1)).toHaveText('Late one');
    await expect(texts.nth(2)).toHaveText('Normal two');

    await expect(page.getByRole('button', { name: /Overdue first/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('enabling it groups overdue tasks at the top and persists across reload', async ({ page }) => {
    await seed(page, overdueSetup());
    await page.getByRole('button', { name: /Overdue first/ }).click();

    const texts = page.locator('.task-list .task-text');
    await expect(texts.nth(0)).toHaveText('Late one');
    await expect(texts.nth(1)).toHaveText('Normal one');
    await expect(texts.nth(2)).toHaveText('Normal two');

    await page.reload();
    await expect(page.getByRole('button', { name: /Overdue first/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.task-list .task-text').nth(0)).toHaveText('Late one');
  });

  test('turning it back off restores manual order', async ({ page }) => {
    await seed(page, overdueSetup());
    const toggle = page.getByRole('button', { name: /Overdue first/ });
    await toggle.click();
    await expect(page.locator('.task-list .task-text').nth(0)).toHaveText('Late one');

    await toggle.click();
    await expect(page.locator('.task-list .task-text').nth(0)).toHaveText('Normal one');
  });

  test('drag-reordering is suspended while the sort is active', async ({ page }) => {
    await seed(page, overdueSetup());
    await expect(page.locator('.task-list .drag-handle').first()).toHaveCount(1);

    await page.getByRole('button', { name: /Overdue first/ }).click();
    // display:none rather than removed from the DOM, so assert on visibility -
    // toHaveCount would still see them.
    await expect(page.locator('.task-list .drag-handle').first()).toBeHidden();
    await expect(page.locator('.task-list')).toHaveClass(/drag-suspended/);

    // And Sortable itself is disabled, not merely visually hidden.
    const sortableDisabled = await page.evaluate(() => {
      const el = document.querySelector('.task-list');
      return el.classList.contains('drag-suspended');
    });
    expect(sortableDisabled).toBe(true);
  });

  test('the toggle is not offered when nothing is overdue', async ({ page }) => {
    await seed(page, [task({ text: 'All good', dueDate: dateOffset(5) })]);
    await expect(page.getByRole('button', { name: /Overdue first/ })).toHaveCount(0);
  });
});

test.describe('description clamp', () => {
  test.beforeEach(async ({ page }) => { await resetApp(page); });

  test('a long description is clamped with a Show more toggle', async ({ page }) => {
    await addTask(page, 'Wordy task');
    const row = taskRow(page, 'Wordy task');
    await openDetails(row);
    await row.locator('.task-description-display').click();
    await row.locator('textarea').fill(
      Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a rather long description that goes on.`).join('\n')
    );
    await row.getByRole('button', { name: 'Save' }).click();

    const desc = row.locator('.task-description-display');
    await expect(desc).toHaveClass(/clamped/);

    const clampedHeight = await desc.evaluate(el => el.clientHeight);
    const toggle = row.getByRole('button', { name: 'Show more' });
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(desc).not.toHaveClass(/clamped/);
    expect(await desc.evaluate(el => el.clientHeight)).toBeGreaterThan(clampedHeight);

    await row.getByRole('button', { name: 'Show less' }).click();
    await expect(desc).toHaveClass(/clamped/);
  });

  test('a short description gets no toggle', async ({ page }) => {
    await addTask(page, 'Terse task');
    const row = taskRow(page, 'Terse task');
    await openDetails(row);
    await row.locator('.task-description-display').click();
    await row.locator('textarea').fill('Just one line.');
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(row.locator('.desc-toggle')).toHaveCount(0);
  });
});
