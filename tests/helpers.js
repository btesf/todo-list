async function resetApp(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function addTask(page, text) {
  await page.getByPlaceholder('Add a new task...').fill(text);
  await page.getByRole('button', { name: 'Add Task' }).click();
}

function taskRow(page, text) {
  return page.locator('.task-item', { hasText: text }).first();
}

async function completeTask(page, text) {
  const row = taskRow(page, text);
  await row.getByRole('checkbox', { name: 'Mark task complete' }).check();
}

async function openDetails(row) {
  await row.getByRole('button', { name: 'Show subtasks, description, and due date' }).click();
}

// SortableJS runs in forceFallback mode (plain pointer-emulated dragging rather
// than native HTML5 drag-and-drop, for consistent cross-browser behavior). That
// mode has a small movement tolerance before a drag is recognized, so a single
// big jump isn't enough - move in small steps like a real drag gesture.
async function dragHandle(page, sourceHandle, targetHandle, targetYOffset = -5) {
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHandle.boundingBox();
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetYOffset;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Clear the fallback tolerance threshold with a tiny initial move first.
  await page.mouse.move(startX, startY + 6, { steps: 2 });
  await page.waitForTimeout(50);
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.waitForTimeout(50);
  await page.mouse.up();
}

module.exports = { resetApp, addTask, taskRow, completeTask, openDetails, dragHandle };
