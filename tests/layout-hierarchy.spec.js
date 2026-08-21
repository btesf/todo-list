const { test, expect } = require('@playwright/test');
const { resetApp, addTask, taskRow, openDetails } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('the add-task form comes before the search box in the document', async ({ page }) => {
  const order = await page.evaluate(() => {
    const form = document.querySelector('.app-sticky form');
    const search = document.querySelector('.app-sticky .search-box');
    // 4 === DOCUMENT_POSITION_FOLLOWING: search follows the form.
    return form.compareDocumentPosition(search) & 4 ? 'form-first' : 'search-first';
  });
  expect(order).toBe('form-first');
});

test('the pinned region holds the title, add-task form and search - not just the title', async ({ page }) => {
  const sticky = page.locator('.app-sticky');
  await expect(sticky).toHaveCSS('position', 'sticky');
  await expect(sticky.locator('h1')).toHaveText('Docket');
  await expect(sticky.locator('form input[aria-label="New task text"]')).toBeVisible();
  await expect(sticky.locator('.search-box input')).toBeVisible();
});

test('the add-task input stays on screen while a long list scrolls', async ({ page }) => {
  await page.evaluate(() => {
    const tasks = Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`, text: `Task number ${i + 1}`, completed: false, completionDate: null,
      description: '', subtasks: [], isImportant: false, order: i,
      dueDate: null, dueTime: null, tags: [],
    }));
    localStorage.setItem('enhancedTodoAppTasks_vue_v2', JSON.stringify(tasks));
  });
  await page.reload();

  const input = page.getByPlaceholder('Add a new task...');
  await expect(input).toBeInViewport();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(input).toBeInViewport();
});

test('the pinned region is opaque enough that content scrolling under it does not show through', async ({ page }) => {
  // The earlier 82% background let the red overdue banner smear through the blur.
  const alpha = await page.evaluate(() => {
    const bg = getComputedStyle(document.querySelector('.app-sticky')).backgroundColor;
    const m = bg.match(/[\d.]+%?\s*\/\s*([\d.]+)/) || bg.match(/rgba?\([^)]*,\s*([\d.]+)\)$/);
    return m ? parseFloat(m[1]) : 1; // no alpha component at all === fully opaque
  });
  expect(alpha).toBeGreaterThanOrEqual(0.95);
});

test('the search field is visually quieter than the add-task field', async ({ page }) => {
  const px = (v) => parseFloat(v);
  const searchSize = await page.locator('.search-box input').evaluate(el => getComputedStyle(el).fontSize);
  const addSize = await page.getByPlaceholder('Add a new task...').evaluate(el => getComputedStyle(el).fontSize);
  expect(px(searchSize)).toBeLessThan(px(addSize));

  // Leading magnifier sits inside the field, clear of the text.
  const icon = page.locator('.search-box-icon');
  await expect(icon).toBeVisible();
  const padLeft = await page.locator('.search-box input').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
  const iconRight = await icon.evaluate(el => {
    const r = el.getBoundingClientRect();
    const box = el.closest('.search-box').getBoundingClientRect();
    return r.right - box.left;
  });
  expect(padLeft).toBeGreaterThanOrEqual(iconRight);
});

test('Add Task is the only filled primary button; the subtask Add is a ghost button', async ({ page }) => {
  await addTask(page, 'Has a subtask form');
  const row = taskRow(page, 'Has a subtask form');
  await openDetails(row);

  const primaryBg = await page.getByRole('button', { name: 'Add Task' }).evaluate(el => getComputedStyle(el).backgroundColor);
  const subtaskAdd = row.locator('#add-subtask-form button');
  const subtaskBg = await subtaskAdd.evaluate(el => getComputedStyle(el).backgroundColor);

  expect(primaryBg).not.toBe(subtaskBg);
  // Ghost = transparent fill with a visible border.
  expect(subtaskBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  await expect(subtaskAdd).not.toHaveCSS('border-left-width', '0px');
});

test('delete is separated from the add-subtask button by a divider', async ({ page }) => {
  await addTask(page, 'Check action spacing');
  const row = taskRow(page, 'Check action spacing');

  const del = row.getByRole('button', { name: 'Delete task' });
  await expect(del).not.toHaveCSS('border-left-width', '0px');
  const marginLeft = await del.evaluate(el => parseFloat(getComputedStyle(el).marginLeft));
  expect(marginLeft).toBeGreaterThan(0);
});

test('the long title on a narrow screen keeps its checkbox on the same line', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await addTask(page, 'A deliberately long task title that will certainly wrap onto two lines on a phone');
  const row = taskRow(page, 'A deliberately long task title');

  const boxes = await row.evaluate(el => {
    const cb = el.querySelector('.checkbox-wrap').getBoundingClientRect();
    const txt = el.querySelector('.task-text').getBoundingClientRect();
    return { cbTop: cb.top, cbBottom: cb.bottom, txtTop: txt.top, txtBottom: txt.bottom };
  });
  // Checkbox must sit within the title's vertical band, not on a line above it.
  expect(boxes.cbTop).toBeLessThan(boxes.txtBottom);
  expect(boxes.cbBottom).toBeGreaterThan(boxes.txtTop);
});

test('the pinned region does not eat the viewport on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.app-sticky')).toHaveCSS('position', 'static');
});

test('dark mode stacks surfaces so raised elements are lighter, not darker', async ({ page }) => {
  await addTask(page, 'Elevation check');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // .task-item transitions background-color, and mid-transition Chrome
  // serializes the interpolated value as oklab(...) - still the light-mode
  // colour. Wait for it to settle back to the declared oklch() before sampling.
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.task-item')).backgroundColor.startsWith('oklch(')
  );

  const lightness = await page.evaluate(() => {
    const L = (el) => {
      const m = getComputedStyle(el).backgroundColor.match(/oklch\(([\d.]+)/);
      return m ? parseFloat(m[1]) : null;
    };
    return {
      page: L(document.body),
      container: L(document.querySelector('.app-container')),
      card: L(document.querySelector('.task-item')),
    };
  });

  expect(lightness.page).not.toBeNull();
  expect(lightness.container).toBeGreaterThan(lightness.page);
  expect(lightness.card).toBeGreaterThan(lightness.container);
});
