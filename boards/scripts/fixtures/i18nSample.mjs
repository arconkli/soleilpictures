// Sample messages for src/lib/i18n.test.mjs. It sits outside src so extraction
// ignores it, and it has no JSX, so the test imports it as node does: through
// scripts/linguiNodeLoader.mjs, which runs the macro on it.
import { t, plural, msg } from '@lingui/core/macro';

export const LATER = msg`Later thing`;

export function words(n) {
  return [t`Save`, t`Delete ${n} cards`, plural(n, { one: '# card', other: '# cards' })];
}

// Not a macro's: left as written.
export const toast = { id: 'toast-1', message: 'Saved {n}' };
