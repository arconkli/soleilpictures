// The words of every email (supabase/functions/_shared/email/strings/) and the
// small reader that picks them (i18n.mjs). Three promises: the code and the
// English table agree key for key; a finished translation is complete and
// keeps every placeholder; and the reader falls back to English, never to a
// broken sentence. The six non-English tables start empty and fill as
// translations land.
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
import { EMAIL_LOCALES, emailLocale, emailStrings } from '../../../supabase/functions/_shared/email/i18n.mjs';
import { lintTranslation, normalizeTranslation } from '../../scripts/i18nLint.mjs';

const TABLES = { es, fr, 'pt-BR': ptBR, ru, ja, ko };

// Locales whose table is finished (every key, every plural form). A language
// moves here when its translation lands; the checks below then hold it to en.
const EMAIL_COMPLETE = ['es', 'fr', 'ja', 'ko', 'pt-BR', 'ru'];

const SOURCES = [
  '../../../supabase/functions/_shared/email/templates.ts',
  '../../../supabase/functions/_shared/email/theme.ts',
  '../../../supabase/functions/_shared/email/layout.ts',
  '../../../supabase/functions/_shared/email/trialEnding.ts',
  // Not an email: the trial's line on Stripe's checkout page (checkout.trial_note).
  '../../../supabase/functions/create-checkout-session/index.ts',
  '../../scripts/gen-magic-link.mjs',
];
const source = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const placeholders = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const isPlural = (v) => typeof v === 'object' && v !== null;
// The English a translated plural form is judged against: the en form with the
// same placeholders (en's "one" is "a photo", with no {count}, and so is
// Spanish's "una foto"; Russian's "one" is "{count} фото" and reads against
// "other"), else en's `other`, so a form with the wrong placeholders is told so.
// (Whether a form may drop {count} at all is singleNumber's question, below.)
const englishFor = (v, form) => {
  if (!isPlural(v)) return v;
  const want = placeholders(form).join();
  return Object.values(v).find((e) => placeholders(e).join() === want) ?? v.other;
};

// True when exactly one whole number selects the category in the language, so
// a form for it may say "una foto" and leave {count} out. Spanish "one" is only
// 1; French and Portuguese "one" also holds 0, Russian "one" holds 1, 21, 31...
// and every "many" holds many, so those forms must carry the number.
const singleNumber = (locale, category) => {
  const rules = new Intl.PluralRules(locale);
  let n = 0;
  for (const x of [...Array(1001).keys(), 1000000, 2000000]) if (rules.select(x) === category) n++;
  return n === 1;
};

test('singleNumber is true only for a category that holds exactly one number', () => {
  assert.equal(singleNumber('es', 'one'), true);
  for (const [l, c] of [['fr', 'one'], ['pt-BR', 'one'], ['ru', 'one'], ['ru', 'few'], ['es', 'many'], ['ru', 'other']]) {
    assert.equal(singleNumber(l, c), false, `${l} ${c}`);
  }
});

test('en values are strings, or plurals with exactly one and other', () => {
  assert.ok(Object.keys(en).length > 0);
  for (const [key, v] of Object.entries(en)) {
    if (typeof v === 'string') { assert.ok(v.trim(), `${key} is empty`); continue; }
    assert.ok(isPlural(v), `${key} is neither a string nor a plural`);
    assert.deepEqual(Object.keys(v).sort(), ['one', 'other'], `${key} plural forms`);
    for (const [cat, s] of Object.entries(v)) {
      assert.equal(typeof s, 'string', `${key}.${cat}`);
      assert.ok(s.trim(), `${key}.${cat} is empty`);
    }
  }
});

test('no string holds HTML, a template or a line break', () => {
  const all = (v) => (isPlural(v) ? Object.values(v) : [v]);
  for (const [key, v] of Object.entries(en)) {
    for (const s of all(v)) {
      assert.doesNotMatch(s, /<\/?[a-z][^>]*>/i, `${key} holds markup`);
      assert.doesNotMatch(s, /\{\{|\}\}/, `${key} holds template syntax`);
      assert.doesNotMatch(s, /\n/, `${key} holds a line break`);
    }
  }
});

test('every literal key the code reads exists in en, and every en key is read', () => {
  const used = new Set();
  for (const p of SOURCES) {
    const text = source(p);
    for (const m of text.matchAll(/\.(?:t|n)\(\s*"([^"]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in en));
  assert.deepEqual(missing, [], `keys read but not in en.mjs: ${missing.join(', ')}`);
  const unused = Object.keys(en).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], `keys in en.mjs nothing reads: ${unused.join(', ')}`);
});

test('keys that hold plurals are read with n(), the rest with t()', () => {
  for (const p of SOURCES) {
    const text = source(p);
    for (const m of text.matchAll(/\.(t|n)\(\s*"([^"]+)"/g)) {
      const [, fn, key] = m;
      if (!(key in en)) continue;
      assert.equal(isPlural(en[key]), fn === 'n', `${key} is read with ${fn}()`);
    }
  }
});

test('the six non-English tables hold only keys that are in en', () => {
  for (const [locale, table] of Object.entries(TABLES)) {
    for (const key of Object.keys(table)) assert.ok(key in en, `${locale} has ${key}, which en does not`);
  }
});

test('every locale the senders know has a table, and they are the seven', () => {
  assert.deepEqual([...EMAIL_LOCALES], ['en', 'es', 'fr', 'pt-BR', 'ru', 'ja', 'ko']);
  assert.deepEqual(Object.keys(TABLES).sort(), EMAIL_LOCALES.filter((l) => l !== 'en').sort());
});

for (const locale of EMAIL_COMPLETE) {
  test(`${locale} is complete: en's keys, its own plural forms, en's placeholders`, () => {
    const table = TABLES[locale];
    assert.deepEqual(Object.keys(table).sort(), Object.keys(en).sort(), 'exactly en\'s keys');
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories.slice().sort();
    for (const [key, e] of Object.entries(en)) {
      const t = table[key];
      if (isPlural(e)) {
        assert.ok(isPlural(t), `${key} must be a plural`);
        assert.deepEqual(Object.keys(t).sort(), categories, `${key} plural categories`);
        for (const [cat, s] of Object.entries(t)) {
          assert.ok(String(s).trim(), `${key}.${cat} is empty`);
          // A form whose category holds more than one number keeps every
          // placeholder en's `other` has, {count} included. Only a form for a
          // single number ("one": "una foto" in Spanish) may drop {count}, as
          // en's own "one" does, but it never adds a placeholder en lacks.
          const want = placeholders(e.other);
          const got = placeholders(s);
          if (!singleNumber(locale, cat)) assert.deepEqual(got, want, `${key}.${cat} placeholders`);
          else assert.deepEqual(got.filter((x) => !want.includes(x)), [], `${key}.${cat} has a placeholder en does not`);
        }
      } else {
        assert.equal(typeof t, 'string', `${key} must be a string`);
        assert.ok(t.trim(), `${key} is empty`);
        assert.deepEqual(placeholders(t), placeholders(e), `${key} placeholders`);
      }
    }
  });
}

// Whatever is translated so far (a table may be half done) meets the same
// lint every other catalog does, and is already in the form the tools write.
for (const [locale, table] of Object.entries(TABLES)) {
  test(`${locale}: each translated string passes the translation lint and is normalized`, () => {
    for (const [key, t] of Object.entries(table)) {
      const forms = isPlural(t) ? Object.entries(t) : [[null, t]];
      for (const [cat, s] of forms) {
        const english = englishFor(en[key], s);
        const label = cat ? `${key}.${cat}` : key;
        const { errors } = lintTranslation(english, s, locale);
        assert.deepEqual(errors, [], `${locale} ${label}: ${errors.join('; ')}`);
        assert.equal(s, normalizeTranslation(english, s, locale), `${locale} ${label} is not normalized`);
      }
    }
  });
}

test('the lint reads the English strings themselves without errors (so a translation is judged fairly)', () => {
  for (const [key, v] of Object.entries(en)) {
    for (const s of isPlural(v) ? Object.values(v) : [v]) {
      const { errors } = lintTranslation(s, s, 'es');
      assert.deepEqual(errors, [], `${key}: ${errors.join('; ')}`);
    }
  }
});

test('emailLocale: exact, case, region, any pt, unknown gives English', () => {
  for (const l of EMAIL_LOCALES) assert.equal(emailLocale(l), l);
  assert.equal(emailLocale('ES'), 'es');
  assert.equal(emailLocale('pt-br'), 'pt-BR');
  assert.equal(emailLocale('pt_BR'), 'pt-BR');
  assert.equal(emailLocale(' fr '), 'fr');
  assert.equal(emailLocale('es-MX'), 'es');
  assert.equal(emailLocale('fr-CA'), 'fr');
  assert.equal(emailLocale('ja-JP'), 'ja');
  assert.equal(emailLocale('pt'), 'pt-BR');
  assert.equal(emailLocale('pt-PT'), 'pt-BR');
  assert.equal(emailLocale('de'), 'en');
  assert.equal(emailLocale('zh-Hans'), 'en');
  assert.equal(emailLocale('en-GB'), 'en');
  assert.equal(emailLocale(''), 'en');
  assert.equal(emailLocale(null), 'en');
  assert.equal(emailLocale(undefined), 'en');
  assert.equal(emailLocale(42), 'en');
});

test('t fills placeholders once, leaves an unknown one, and refuses a key en lacks', () => {
  const s = emailStrings('en');
  assert.equal(s.t('edit_request.headline', { name: 'Sam' }), 'Sam asked to edit.');
  // A value that looks like a placeholder is data, not a second fill.
  assert.equal(s.t('edit_request.headline', { name: '{board}' }), '{board} asked to edit.');
  assert.equal(s.t('edit_request.headline', {}), '{name} asked to edit.');
  assert.throws(() => s.t('no.such.key'), /not in en\.mjs/);
  assert.throws(() => s.t('added.image'), /plural/);
  assert.equal(emailStrings('xx').locale, 'en');
});

test('n picks the plural form and fills {count}', () => {
  const s = emailStrings('en');
  assert.equal(s.n('added.image', 1), 'a photo');
  assert.equal(s.n('added.image', 38), '38 photos');
  assert.equal(s.n('added.image', 0), '0 photos');
  assert.equal(s.n('invite_reward.headline', 25), 'You earned 25 more cards.');
  // A language the emails don't have reads English, with English's rules.
  assert.equal(emailStrings('de').n('added.image', 1), 'a photo');
  assert.equal(emailStrings('de').n('added.image', 5), '5 photos');
  // Russian picks its own forms by its own rules: 1 and 21 one, 2 few, 5 and 11 many.
  const ru = emailStrings('ru');
  assert.deepEqual([1, 21, 2, 5, 11].map((c) => ru.n('added.note', c)), ['1 заметка', '21 заметка', '2 заметки', '5 заметок', '11 заметок']);
});

test('list: en keeps its plain join, other languages use Intl', () => {
  const en2 = emailStrings('en');
  assert.equal(en2.list([]), '');
  assert.equal(en2.list(['38 photos']), '38 photos');
  assert.equal(en2.list(['38 photos', '4 notes']), '38 photos and 4 notes');
  assert.equal(en2.list(['38 photos', '4 notes', 'a PDF']), '38 photos, 4 notes and a PDF');
  const fr2 = emailStrings('fr');
  assert.equal(fr2.list(['a', 'b', 'c']), new Intl.ListFormat('fr', { type: 'conjunction' }).format(['a', 'b', 'c']));
  assert.equal(fr2.list(['a', 'b']), new Intl.ListFormat('fr', { type: 'conjunction' }).format(['a', 'b']));
  assert.equal(fr2.list(['a']), 'a');
});
