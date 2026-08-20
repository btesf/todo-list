// Nativefier bundles the legacy `electron-packager` package, whose macOS
// packaging step silently hangs (resolves neither success nor failure) under
// very new Node versions (confirmed here on Node v26.4.0) - `packager()`'s
// returned promise never settles, and the process exits cleanly once nothing
// else is keeping the event loop alive, with no error ever surfacing.
//
// The actively-maintained successor, `@electron/packager`, does not have this
// problem. This script intercepts nativefier's internal
// `require('electron-packager')` call and redirects it to `@electron/packager`
// (adapted to the old package's plain-function export shape), then calls
// nativefier's normal programmatic API. Nothing on disk outside this project
// is modified - the redirect only exists for the lifetime of this process.
const Module = require('module');
const path = require('path');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron-packager') {
    return path.join(__dirname, 'electron-packager-shim.js');
  }
  return originalResolveFilename.call(this, request, ...args);
};

// nativefier is only installed globally (via Homebrew), not as a project
// dependency, so it's required by its absolute path rather than by name.
const { buildNativefierApp } = require('/opt/homebrew/lib/node_modules/nativefier');

async function main() {
  const targetUrl = process.argv[2];
  const outputDirectory = process.argv[3];
  if (!targetUrl || !outputDirectory) {
    console.error('Usage: node build-nativefier-app.js <targetUrl> <outputDirectory>');
    process.exit(1);
  }

  const rawOptions = {
    targetUrl,
    out: outputDirectory,
    name: 'Docket',
    platform: 'mac',
    arch: 'arm64',
    electronVersion: '43.4.1',
    width: 900,
    height: 800,
    singleInstance: true,
    fastQuit: true,
    overwrite: true,
  };

  const appPath = await buildNativefierApp(rawOptions);
  console.log('Built app at:', appPath);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
