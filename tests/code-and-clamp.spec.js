const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

async function setDescription(page, taskText, description) {
  const row = taskRow(page, taskText);
  await openDetails(row);
  await row.locator('.task-description-display').click();
  await row.locator('textarea').fill(description);
  await row.getByRole('button', { name: 'Save' }).click();
  return row;
}

test('a fenced code block renders as a pre block, not reflowed prose', async ({ page }) => {
  await addTask(page, 'Has a code block');
  const row = await setDescription(page, 'Has a code block',
    'Repro:\n```js\nconst a = 1;\nif (a) { return a; }\n```\ndone');

  const pre = row.locator('pre.code-block');
  await expect(pre).toHaveCount(1);
  await expect(pre.locator('code')).toContainText('const a = 1;');
  await expect(pre.locator('code')).toContainText('if (a) { return a; }');

  // Newlines inside the block are preserved rather than collapsed.
  await expect(pre.locator('code')).toHaveCSS('white-space', 'pre');

  // Long lines scroll instead of wrapping.
  await expect(pre).toHaveCSS('overflow-x', 'auto');
});

test('the language tag after the opening fence is not rendered as content', async ({ page }) => {
  await addTask(page, 'Fence with language');
  const row = await setDescription(page, 'Fence with language', '```python\nprint("hi")\n```');

  const code = row.locator('pre.code-block code');
  await expect(code).toContainText('print("hi")');
  await expect(code).not.toContainText('python');
});

test('markdown inside a fenced block is left alone', async ({ page }) => {
  await addTask(page, 'Fence protects markdown');
  const row = await setDescription(page, 'Fence protects markdown',
    '```\n**not bold** and *not italic* and [not](https://a.example) a link\n```');

  const pre = row.locator('pre.code-block');
  await expect(pre.locator('strong')).toHaveCount(0);
  await expect(pre.locator('em')).toHaveCount(0);
  await expect(pre.locator('a')).toHaveCount(0);
  await expect(pre).toContainText('**not bold**');
});

test('inline code is visually styled, not bare text', async ({ page }) => {
  await addTask(page, 'Inline `snippet` here');
  const code = taskRow(page, 'Inline').locator('code');
  await expect(code).toHaveText('snippet');

  // Distinct monospace family + a filled, bordered chip - previously nothing
  // styled <code> at all.
  await expect(code).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(code).not.toHaveCSS('border-top-width', '0px');
  const family = await code.evaluate(el => getComputedStyle(el).fontFamily);
  expect(family.toLowerCase()).toMatch(/mono/);
});

test('a fenced block and inline code can coexist in one description', async ({ page }) => {
  await addTask(page, 'Mixed code');
  const row = await setDescription(page, 'Mixed code',
    'Call `init()` first:\n```\ninit();\n```');

  await expect(row.locator('.task-description-display > code')).toHaveText('init()');
  await expect(row.locator('pre.code-block code')).toContainText('init();');
});

test('a long subtask is clamped to two lines with a more/less toggle', async ({ page }) => {
  await addTask(page, 'Parent of long subtask');
  const row = taskRow(page, 'Parent of long subtask');
  await openDetails(row);

  // Comfortably more than two lines at any plausible card width - a borderline
  // string can land on exactly two lines and legitimately not overflow.
  const long = 'This subtask captures a fairly long train of thought that keeps going well past a single line, '
    + 'covering the background, the constraints we discovered along the way, the alternatives that were '
    + 'considered and rejected, and the follow-up work that will be needed once the first part ships, '
    + 'so that it definitely wraps far more than twice in the available width of the card.';
  await row.locator('#add-subtask-form input').fill(long);
  await row.getByRole('button', { name: 'Add', exact: true }).click();

  const subtask = row.locator('.subtask-item', { hasText: 'fairly long train of thought' });
  const text = subtask.locator('.subtask-text');
  await expect(text).toHaveClass(/clamped/);

  const toggle = subtask.getByRole('button', { name: 'more' });
  await expect(toggle).toBeVisible();

  const clampedHeight = await text.evaluate(el => el.clientHeight);

  await toggle.click();
  await expect(text).not.toHaveClass(/clamped/);
  await expect(subtask.getByRole('button', { name: 'less' })).toBeVisible();
  const expandedHeight = await text.evaluate(el => el.clientHeight);
  expect(expandedHeight).toBeGreaterThan(clampedHeight);

  await subtask.getByRole('button', { name: 'less' }).click();
  await expect(text).toHaveClass(/clamped/);
  expect(await text.evaluate(el => el.clientHeight)).toBe(clampedHeight);
});

test('a short subtask gets no more/less toggle', async ({ page }) => {
  await addTask(page, 'Parent of short subtask');
  const row = taskRow(page, 'Parent of short subtask');
  await openDetails(row);

  await row.locator('#add-subtask-form input').fill('Short one');
  await row.getByRole('button', { name: 'Add', exact: true }).click();

  const subtask = row.locator('.subtask-item', { hasText: 'Short one' });
  await expect(subtask.locator('.subtask-text')).toHaveClass(/clamped/);
  await expect(subtask.locator('.subtask-text-toggle')).toHaveCount(0);
});

test('an overdue due badge carries a warning icon, not just red colour', async ({ page }) => {
  await addTask(page, 'Overdue icon check');
  const row = taskRow(page, 'Overdue icon check');
  await openDetails(row);
  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2024-01-01');
  await row.locator('input[type="date"]').blur();
  await openDetails(row); // collapse to the summary badge

  const badge = row.locator('.due-badge');
  await expect(badge).toHaveClass(/overdue/);
  await expect(badge.locator('svg.feather-alert-triangle')).toHaveCount(1);
  await expect(badge.locator('svg.feather-calendar')).toHaveCount(0);
});

test('a future due badge keeps the calendar icon', async ({ page }) => {
  await addTask(page, 'Future icon check');
  const row = taskRow(page, 'Future icon check');
  await openDetails(row);
  await row.getByRole('button', { name: 'Due date', exact: true }).click();
  await row.locator('input[type="date"]').fill('2999-01-01');
  await row.locator('input[type="date"]').blur();
  await openDetails(row);

  const badge = row.locator('.due-badge');
  await expect(badge).not.toHaveClass(/overdue/);
  await expect(badge.locator('svg.feather-calendar')).toHaveCount(1);
  await expect(badge.locator('svg.feather-alert-triangle')).toHaveCount(0);
});

test('the search field is narrower than the add-task field', async ({ page }) => {
  const searchW = await page.locator('.search-box input').evaluate(el => el.getBoundingClientRect().width);
  const addW = await page.getByPlaceholder('Add a new task...').evaluate(el => el.getBoundingClientRect().width);
  expect(searchW).toBeLessThan(addW);
});

test('the empty state teaches the slash-date shortcuts', async ({ page }) => {
  const placeholder = page.locator('.placeholder').first();
  await expect(placeholder).toContainText('/today');
  await expect(placeholder).toContainText('/tomorrow');
  await expect(placeholder).toContainText('/yesterday');
});

test('drag handles stay out of the way until the row is hovered', async ({ page }) => {
  await addTask(page, 'Hover handle check');
  const row = taskRow(page, 'Hover handle check');
  const handle = row.locator('.drag-handle');

  await expect(handle).toHaveCSS('opacity', '0');
  await row.hover();
  await expect(handle).toHaveCSS('opacity', '1');
});
