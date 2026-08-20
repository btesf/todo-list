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

    function makeFakeHandle(name) {
      return {
        name,
        kind: 'file',
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
