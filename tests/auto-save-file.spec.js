const { test, expect } = require('@playwright/test');
const { resetApp, addTask } = require('./helpers');

// Playwright can't drive the native OS "Save File" dialog, so we replace
// window.showSaveFilePicker with a fake handle that records writes to an
// array. The fake handle also isn't structured-cloneable (it has function
// properties, unlike a real FileSystemFileHandle), so window.indexedDB is
// replaced with a tiny stand-in too - just enough for the app's get/put/
// delete-by-key usage. Both the permission state and the stored handle
// marker live in sessionStorage rather than plain JS globals, since
// addInitScript re-runs (resetting any globals) on every reload, but a
// real reload is exactly what these tests need to exercise.
async function mockFileSystemAccess(page, { permissionState = 'granted' } = {}) {
  await page.addInitScript((initialPermission) => {
    window.__autoSaveWrites = [];
    const PERMISSION_KEY = '__mockFilePermission';
    const STORE_PREFIX = '__mockFileStore:';

    if (sessionStorage.getItem(PERMISSION_KEY) === null) {
      sessionStorage.setItem(PERMISSION_KEY, initialPermission);
    }
    const getPermission = () => sessionStorage.getItem(PERMISSION_KEY);
    const setPermission = (value) => sessionStorage.setItem(PERMISSION_KEY, value);

    // Lets a test force a permission change (simulating revoked access)
    // that survives the reload it's about to trigger.
    Object.defineProperty(window, '__fakePermission', {
      get: getPermission, set: setPermission, configurable: true,
    });

    function makeFakeHandle(name, fileContents) {
      return {
        name,
        kind: 'file',
        // Existing-backup adoption reads the file before writing; a plain save
        // handle has no meaningful contents, so default to an empty array.
        async getFile() {
          const text = fileContents != null ? fileContents : '[]';
          return { async text() { return text; } };
        },
        async createWritable() {
          return {
            async write(data) { window.__autoSaveWrites.push(data); },
            async close() {},
          };
        },
        async queryPermission() { return getPermission(); },
        async requestPermission() { setPermission('granted'); return 'granted'; },
      };
    }

    window.showSaveFilePicker = async () => makeFakeHandle('tasks.json');
    // Tests seed the backup contents via window.__backupFileContents before
    // triggering the open picker.
    window.showOpenFilePicker = async () =>
      [makeFakeHandle('my-backup.json', window.__backupFileContents)];

    // window.indexedDB is an accessor property with a getter but no setter,
    // so a plain assignment silently no-ops - Object.defineProperty is required
    // to actually replace it.
    const fakeIndexedDB = {
      open() {
        const req = {};
        setTimeout(() => {
          req.result = {
            createObjectStore() {},
            transaction() {
              const tx = {};
              const store = {
                get(key) {
                  const r = {};
                  setTimeout(() => {
                    const stored = sessionStorage.getItem(STORE_PREFIX + key);
                    r.result = stored ? makeFakeHandle(JSON.parse(stored).name) : undefined;
                    if (r.onsuccess) r.onsuccess();
                  }, 0);
                  return r;
                },
                put(value, key) {
                  sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify({ name: value.name }));
                  return {};
                },
                delete(key) {
                  sessionStorage.removeItem(STORE_PREFIX + key);
                  return {};
                },
              };
              tx.objectStore = () => store;
              setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
              return tx;
            },
          };
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      },
    };
    Object.defineProperty(window, 'indexedDB', { value: fakeIndexedDB, configurable: true, writable: true });
  }, permissionState);
}

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test('auto-save button is hidden when the File System Access API is unsupported', async ({ page }) => {
  await page.addInitScript(() => { delete window.showSaveFilePicker; });
  await page.reload();
  await expect(page.getByRole('button', { name: /auto-save/i })).toHaveCount(0);
});

test('shows a one-time banner nudging the user to enable auto-save', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();

  await expect(page.locator('.auto-save-banner')).toBeVisible();
  // Only one "Enable auto-save" control should exist at a time (the banner's).
  await expect(page.getByRole('button', { name: 'Enable auto-save' })).toHaveCount(1);
});

test('dismissing the banner hides it permanently and reveals the footer button instead', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();

  await page.locator('.auto-save-banner').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.auto-save-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable auto-save' })).toBeVisible();

  await page.reload();
  await expect(page.locator('.auto-save-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable auto-save' })).toBeVisible();
});

test('connecting via the banner replaces it with the footer control from then on', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();

  await page.locator('.auto-save-banner').getByRole('button', { name: 'Enable auto-save' }).click();
  await expect(page.locator('.auto-save-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toBeVisible();

  // Disconnecting afterwards should not bring the banner back.
  await page.getByRole('button', { name: 'Auto-saving' }).click();
  await expect(page.locator('.auto-save-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable auto-save' })).toBeVisible();
});

test('connecting auto-save writes current tasks to the file and stays in sync on changes', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();
  await addTask(page, 'Autosaved task');

  await page.getByRole('button', { name: 'Enable auto-save' }).click();
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toBeVisible();

  const writesAfterConnect = await page.evaluate(() => window.__autoSaveWrites.length);
  expect(writesAfterConnect).toBeGreaterThan(0);
  const firstWrite = await page.evaluate(() => JSON.parse(window.__autoSaveWrites.at(-1)));
  expect(firstWrite.some(t => t.text === 'Autosaved task')).toBe(true);

  await addTask(page, 'Second task');
  await expect.poll(() => page.evaluate(() => window.__autoSaveWrites.length)).toBeGreaterThan(writesAfterConnect);
  const latestWrite = await page.evaluate(() => JSON.parse(window.__autoSaveWrites.at(-1)));
  expect(latestWrite).toHaveLength(2);
});

test('disconnecting auto-save stops writes and reverts the button label', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();

  await page.getByRole('button', { name: 'Enable auto-save' }).click();
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toBeVisible();

  await page.getByRole('button', { name: 'Auto-saving' }).click();
  await expect(page.getByRole('button', { name: 'Enable auto-save' })).toBeVisible();

  const writesBefore = await page.evaluate(() => window.__autoSaveWrites.length);
  await addTask(page, 'Should not be written');
  const writesAfter = await page.evaluate(() => window.__autoSaveWrites.length);
  expect(writesAfter).toBe(writesBefore);
});

test('reconnects automatically on reload when permission is still granted', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();
  await page.getByRole('button', { name: 'Enable auto-save' }).click();
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toBeVisible();
});

test('shows a reconnect prompt on reload when permission needs to be re-granted', async ({ page }) => {
  await mockFileSystemAccess(page, { permissionState: 'granted' });
  await page.reload();
  await page.getByRole('button', { name: 'Enable auto-save' }).click();
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toBeVisible();

  await page.evaluate(() => { window.__fakePermission = 'prompt'; });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reconnect auto-save' })).toBeVisible();

  await page.getByRole('button', { name: 'Reconnect auto-save' }).click();
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toBeVisible();
});

test('the first-run banner offers an "Open a backup file" action', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();
  await expect(page.locator('.auto-save-banner').getByRole('button', { name: 'Open a backup file' })).toBeVisible();
});

test('opening an existing backup loads its tasks and connects auto-save to that file', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();

  // Seed the backup file the picker will "open".
  await page.evaluate(() => {
    window.__backupFileContents = JSON.stringify([
      { id: 'b1', text: 'Restored task one', completed: false, subtasks: [], order: 0 },
      { id: 'b2', text: 'Restored task two', completed: true, subtasks: [], order: 1 },
    ]);
  });

  await page.locator('.auto-save-banner').getByRole('button', { name: 'Open a backup file' }).click();

  // Tasks from the file are now shown, and auto-save is connected to it.
  await expect(page.locator('.task-item', { hasText: 'Restored task one' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toBeVisible();
  await expect(page.locator('.auto-save-banner')).toHaveCount(0);

  // Subsequent edits write to the adopted file.
  await addTask(page, 'Added after restore');
  await expect.poll(() => page.evaluate(() => window.__autoSaveWrites.length)).toBeGreaterThan(0);
  const latest = await page.evaluate(() => JSON.parse(window.__autoSaveWrites.at(-1)));
  expect(latest.some(t => t.text === 'Added after restore')).toBe(true);
  expect(latest.some(t => t.text === 'Restored task one')).toBe(true);
});

test('opening a backup does not overwrite it before reading (existing tasks are replaced with Undo)', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();
  await addTask(page, 'In-app task');

  await page.evaluate(() => {
    window.__backupFileContents = JSON.stringify([
      { id: 'b1', text: 'From the backup', completed: false, subtasks: [], order: 0 },
    ]);
  });
  // Dismiss the banner first so we exercise the footer entry point too.
  await page.locator('.auto-save-banner').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Open backup' }).click();

  // The backup's content replaced the in-app list...
  await expect(page.locator('.task-item', { hasText: 'From the backup' })).toBeVisible();
  await expect(page.locator('.task-item', { hasText: 'In-app task' })).toHaveCount(0);

  // ...but an Undo restores what was there before.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.task-item', { hasText: 'In-app task' })).toBeVisible();
});

test('opening an invalid backup file surfaces an error and does not connect', async ({ page }) => {
  await mockFileSystemAccess(page);
  await page.reload();

  await page.evaluate(() => { window.__backupFileContents = 'not valid json {'; });
  await page.locator('.auto-save-banner').getByRole('button', { name: 'Open a backup file' }).click();

  await expect(page.locator('.toast-error')).toBeVisible();
  // Still disconnected - the banner remains.
  await expect(page.locator('.auto-save-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto-saving' })).toHaveCount(0);
});
