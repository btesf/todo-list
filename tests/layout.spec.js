const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

test('add-task button spans full width under the input on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await resetApp(page);
  const input = page.getByPlaceholder('Add a new task...');
  const button = page.getByRole('button', { name: 'Add Task' });
  const inputBox = await input.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(Math.abs(inputBox.width - buttonBox.width)).toBeLessThan(2);
});

test('add-task button sits inline next to the input on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await resetApp(page);
  const input = page.getByPlaceholder('Add a new task...');
  const button = page.getByRole('button', { name: 'Add Task' });
  const inputBox = await input.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(Math.abs(inputBox.y - buttonBox.y)).toBeLessThan(5);
});
