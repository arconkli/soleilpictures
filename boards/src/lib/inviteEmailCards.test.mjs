// inviteEmailCards.test.mjs — the invite email's starting-card count is a
// constant in a Deno bundle that cannot import billingCopy.js, so this test
// reads templates.ts as text and keeps the two equal. The sentence itself is
// in the email strings, one table per language, with the count as {cards}.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REFERRED_START_CARDS } from './billingCopy.js';
import en from '../../../supabase/functions/_shared/email/strings/en.mjs';
import es from '../../../supabase/functions/_shared/email/strings/es.mjs';
import fr from '../../../supabase/functions/_shared/email/strings/fr.mjs';
import ptBR from '../../../supabase/functions/_shared/email/strings/pt-BR.mjs';
import ru from '../../../supabase/functions/_shared/email/strings/ru.mjs';
import ja from '../../../supabase/functions/_shared/email/strings/ja.mjs';
import ko from '../../../supabase/functions/_shared/email/strings/ko.mjs';

const src = readFileSync(
  new URL('../../../supabase/functions/_shared/email/templates.ts', import.meta.url),
  'utf8',
);

test('templates.ts REFERRED_START_CARDS equals billingCopy.REFERRED_START_CARDS', () => {
  const m = src.match(/^const REFERRED_START_CARDS = (\d+);/m);
  assert.ok(m, 'const REFERRED_START_CARDS not found in templates.ts');
  assert.equal(Number(m[1]), REFERRED_START_CARDS);
});

test('pendingInvite fills {cards} from the constant, with no typed card number', () => {
  const start = src.indexOf('function pendingInvite(');
  assert.ok(start > 0, 'pendingInvite not found');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /const cards = REFERRED_START_CARDS;/);
  assert.doesNotMatch(body, /\b\d+\s+free cards/);
});

test('every language says the count as {cards} and types no number', () => {
  const tables = { en, es, fr, 'pt-BR': ptBR, ru, ja, ko };
  for (const [loc, table] of Object.entries(tables)) {
    const keys = Object.keys(table).filter((k) => k.startsWith('pending_invite.subtitle_'));
    assert.equal(keys.length, 5, loc);
    for (const key of keys) {
      const v = table[key];
      for (const [form, text] of Object.entries(typeof v === 'string' ? { one: v } : v)) {
        assert.ok(text.includes('{cards}'), `${loc} ${key} ${form}`);
        assert.doesNotMatch(text, /\d/, `${loc} ${key} ${form}`);
      }
    }
  }
});
