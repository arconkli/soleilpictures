// The line Stripe shows beside the submit button on a Creator trial's Checkout
// page (custom_text.submit.message, 1200 characters at most), in the account's
// language, from the email strings. It is sent on a trial session only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import en from '../../../supabase/functions/_shared/email/strings/en.mjs';
import es from '../../../supabase/functions/_shared/email/strings/es.mjs';
import fr from '../../../supabase/functions/_shared/email/strings/fr.mjs';
import ptBR from '../../../supabase/functions/_shared/email/strings/pt-BR.mjs';
import ru from '../../../supabase/functions/_shared/email/strings/ru.mjs';
import ja from '../../../supabase/functions/_shared/email/strings/ja.mjs';
import ko from '../../../supabase/functions/_shared/email/strings/ko.mjs';
import { EMAIL_LOCALES, emailStrings } from '../../../supabase/functions/_shared/email/i18n.mjs';

const KEY = 'checkout.trial_note';
const TABLES = { en, es, fr, 'pt-BR': ptBR, ru, ja, ko };
const src = readFileSync(new URL('../../../supabase/functions/create-checkout-session/index.ts', import.meta.url), 'utf8');

test('every language has a short note with no placeholder', () => {
  assert.ok(EMAIL_LOCALES.length >= 7);
  for (const loc of EMAIL_LOCALES) {
    const s = emailStrings(loc).t(KEY);
    assert.equal(typeof s, 'string', loc);
    assert.ok(s.length > 0 && s.length <= 1200, loc);
    assert.ok(!s.includes('{'), loc);
  }
});

test('each non-English language has its own words, not the English', () => {
  for (const loc of EMAIL_LOCALES) {
    if (loc === 'en') continue;
    const own = TABLES[loc][KEY];
    assert.ok(typeof own === 'string' && own.length > 0, `${loc} table lacks ${KEY}`);
    assert.notEqual(own, en[KEY], loc);
    assert.equal(emailStrings(loc).t(KEY), own, loc);
  }
});

test('no language means English', () => {
  assert.equal(emailStrings(undefined).t(KEY), en[KEY]);
});

test('create-checkout-session sends it on a trial session only', () => {
  assert.match(src, /import \{ emailStrings \} from "\.\.\/_shared\/email\/i18n\.mjs";/);
  assert.ok(src.includes('...(trial ? { custom_text: { submit: { message: emailStrings(locale).t("checkout.trial_note") } } } : {})'));
  assert.equal(src.split('custom_text').length - 1, 1);
});
