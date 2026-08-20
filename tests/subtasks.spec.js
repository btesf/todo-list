const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails, dragHandle } = require('./helpers');

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept());
  await resetApp(page);
});

test('adds, completes, and deletes a subtask', async ({ page }) => {
  await addTask(page, 'Parent task');
  const row = taskRow(page, 'Parent task');
  await openDetails(row);
  await row.getByPlaceholder('Add a subtask...').fill('Sub one');
  await row.getByRole('button', { name: 'Add', exact: true }).click();

  const subtask = row.locator('.subtask-item', { hasText: 'Sub one' });
  await expect(subtask).toBeVisible();
  await subtask.getByRole('checkbox').check();
  await expect(subtask).toHaveClass(/completed/);
  await subtask.getByRole('button', { name: 'Delete subtask' }).click();
  await expect(row.locator('.subtask-item')).toHaveCount(0);
});

test('drag-reorders incomplete subtasks, keeps completed ones pinned at the bottom', async ({ page }) => {
  await addTask(page, 'Parent task');
  const row = taskRow(page, 'Parent task');
  await openDetails(row);
  const subtaskInput = row.getByPlaceholder('Add a subtask...');
  const addBtn = row.getByRole('button', { name: 'Add', exact: true });
  for (const text of ['Sub A', 'Sub B', 'Sub C']) {
    await subtaskInput.fill(text);
    await addBtn.click();
  }

  // Newest subtask goes to the top of the incomplete group, same as main tasks.
  let texts = row.locator('.subtask-item .subtask-text');
  await expect(texts).toHaveText(['Sub C', 'Sub B', 'Sub A']);

  // Complete Sub A - it should sink below the incomplete ones.
  await row.locator('.subtask-item', { hasText: 'Sub A' }).getByRole('checkbox').check();
  texts = row.locator('.subtask-item .subtask-text');
  await expect(texts).toHaveText(['Sub C', 'Sub B', 'Sub A']);

  // Drag Sub B above Sub C.
  const handles = row.locator('.subtask-drag-handle');
  await dragHandle(page, handles.nth(1), handles.nth(0), -3); // Sub B above Sub C

  texts = row.locator('.subtask-item .subtask-text');
  await expect(texts).toHaveText(['Sub B', 'Sub C', 'Sub A']);
});

test('expanding a completed task reveals its subtasks via the chevron badge', async ({ page }) => {
  await addTask(page, 'Task with history');
  const row = taskRow(page, 'Task with history');
  await openDetails(row);
  await row.getByPlaceholder('Add a subtask...').fill('Did this already');
  await row.getByRole('button', { name: 'Add', exact: true }).click();

  await row.getByRole('checkbox', { name: 'Mark task complete' }).check();
  const completedRow = page.locator('#completed-container .task-item', { hasText: 'Task with history' });
  await expect(completedRow.locator('.subtask-progress-badge')).toContainText('0/1');
  await expect(completedRow.locator('.subtask-item')).not.toBeVisible(); // collapsed by default

  await completedRow.locator('.subtask-progress-badge').click();
  await expect(completedRow.locator('.subtask-item', { hasText: 'Did this already' })).toBeVisible();
});
