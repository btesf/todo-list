// Adapts @electron/packager's named `packager` export to the plain
// default-exported-function shape the legacy `electron-packager` package
// (and nativefier's compiled TS output, via __importDefault) expects.
const { packager } = require('@electron/packager');

module.exports = packager;
