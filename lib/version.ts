// Auto-read from package.json at build time — never hardcode version strings
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json') as { version: string }
export const APP_VERSION = pkg.version
