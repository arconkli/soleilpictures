// The translation catalogs (src/locales/<locale>/messages.po and the compiled
// messages.mjs next to it). A translator can break a message without any
// build noticing: drop a {name}, renumber a <0> tag, or leave the compiled file
// behind the .po. This catches each. npm run i18n:check covers the other half:
// that the catalogs are what extract and compile write from the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { formatter } from '@lingui/format-po';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { shape, lintTranslation, normalizeTranslation } from '../../scripts/i18nLint.mjs';

const LOCALES_DIR = fileURLToPath(new URL('../locales/', import.meta.url));
const locales = readdirSync(LOCALES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

// Languages whose catalog is finished: every message has a translation. A
// language joins this list when its translation lands.
const COMPLETE_LOCALES = ['es', 'fr', 'ja', 'ko', 'pt-BR', 'ru'];

const po = formatter({ lineNumbers: false });
const catalogOf = (locale) => po.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.po'), 'utf8'), { locale, sourceLocale: 'en', filename: 'messages.po' });

const unique = (a) => [...new Set(a)].sort();

test('every language has a catalog, and the source language is English', () => {
  for (const l of ['en', 'es', 'fr', 'pt-BR', 'ru', 'ja', 'ko']) assert.ok(locales.includes(l), l);
  for (const l of locales) assert.ok(existsSync(join(LOCALES_DIR, l, 'messages.po')), `${l}: messages.po`);
});

test('a translation keeps its source message\'s {placeholders} and <tags>', () => {
  for (const locale of locales.filter((l) => l !== 'en')) {
    for (const [id, entry] of Object.entries(catalogOf(locale))) {
      if (!entry.translation) continue;
      assert.deepEqual(
        unique(shape(compileMessage(entry.translation))),
        unique(shape(compileMessage(entry.message || ''))),
        `${locale} ${id}: ${entry.translation}`,
      );
    }
  }
});

test('every translation passes the checks, and is already normalized', () => {
  for (const locale of locales.filter((l) => l !== 'en')) {
    for (const [id, entry] of Object.entries(catalogOf(locale))) {
      if (!entry.translation || entry.obsolete) continue;
      const { errors } = lintTranslation(entry.message || '', entry.translation, locale);
      assert.deepEqual(errors, [], `${locale} ${id}: ${entry.translation}`);
      assert.equal(normalizeTranslation(entry.message || '', entry.translation, locale), entry.translation, `${locale} ${id}: not normalized`);
    }
  }
});

test('a finished language has every message translated', () => {
  for (const locale of COMPLETE_LOCALES) {
    for (const [id, entry] of Object.entries(catalogOf(locale))) {
      if (entry.obsolete) continue;
      assert.ok(entry.translation, `${locale} ${id}: ${entry.message}`);
    }
  }
});

test('each compiled catalog holds the messages of its .po file', async () => {
  for (const locale of locales.filter((l) => l !== 'en')) {
    const file = join(LOCALES_DIR, locale, 'messages.mjs');
    assert.ok(existsSync(file), `${locale}: messages.mjs is missing: run npm run i18n:build`);
    const { messages } = await import(pathToFileURL(file).href);
    const ids = Object.entries(catalogOf(locale)).filter(([, e]) => !e.obsolete).map(([id]) => id);
    assert.deepEqual(Object.keys(messages).sort(), ids.sort(), `${locale}: run npm run i18n:build`);
  }
});
