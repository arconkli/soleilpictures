// The app's languages (owner, 2026-11-09): English, the source, written in the
// code, and six translations. The public site, help docs, admin and the API and
// MCP messages stay English, so they are left out of extraction.
//
// npm run i18n:build extracts every message into src/locales/<locale>/messages.po
// and compiles each into messages.mjs, which lib/i18nBoot.js loads; both are
// committed, so the Cloudflare build never runs this. npm run i18n:check fails
// when they are behind the code.
import { formatter } from '@lingui/format-po';

export default {
  sourceLocale: 'en',
  locales: ['en', 'es', 'fr', 'pt-BR', 'ru', 'ja', 'ko'],
  fallbackLocales: { default: 'en' },
  catalogs: [{
    path: '<rootDir>/src/locales/{locale}/messages',
    include: ['<rootDir>/src'],
    exclude: [
      '**/node_modules/**',
      '<rootDir>/src/locales/**',
      '<rootDir>/src/pages/admin/**',
      '<rootDir>/src/local/**',
      '**/*.test.mjs',
    ],
  }],
  // File names without line numbers, so moving code doesn't rewrite every catalog.
  format: formatter({ lineNumbers: false }),
  compileNamespace: 'es',
};
