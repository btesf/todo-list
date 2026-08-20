const { test, expect } = require('@playwright/test');

const STORAGE_KEY = 'enhancedTodoAppTasks_vue_v2';

async function seedOldCompletedTask(page) {
  await page.goto('/');
  await page.evaluate((key) => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    const tasks = [
      {
        id: 'old-1',
        text: 'Old completed task with history',
        completed: true,
        completionDate: oldDate.toISOString(),
        description: 'Investigated the flaky test.',
        dueDate: null,
        link: null,
        isImportant: false,
        order: 0,
        subtasks: [{ id: 'sub-1', text: 'Reproduce issue', completed: true, order: 0 }],
      },
    ];
    localStorage.setItem(key, JSON.stringify(tasks));
  }, STORAGE_KEY);
  await page.reload();
}

test('a completed-task date group older than 10 days starts collapsed and expands on click', async ({ page }) => {
  await seedOldCompletedTask(page);

  const header = page.locator('.date-header-container');
  const list = page.locator('.completed-list');
  await expect(header).toHaveClass(/collapsed/);
  await expect(list).toHaveClass(/collapsed/);

  await header.click();
  await expect(header).not.toHaveClass(/collapsed/);
  await expect(list).not.toHaveClass(/collapsed/);
  await expect(page.locator('.task-item', { hasText: 'Old completed task with history' })).toBeVisible();

  await header.click();
  await expect(header).toHaveClass(/collapsed/);
  await expect(list).toHaveClass(/collapsed/);
});
