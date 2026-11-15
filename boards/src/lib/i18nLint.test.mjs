// The translation checks (scripts/i18nLint.mjs): one test per check and per
// normalize rule, each with a passing and a failing case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintTranslation, normalizeTranslation } from '../../scripts/i18nLint.mjs';

const lint = (en, tr, locale) => lintTranslation(en, tr, locale);
const ok = (en, tr, locale) => assert.deepEqual(lint(en, tr, locale).errors, [], `${locale}: ${tr}`);
const bad = (en, tr, locale, pattern) => {
  const { errors } = lint(en, tr, locale);
  assert.ok(errors.some((e) => pattern.test(e)), `${locale}: ${tr}\n  errors: ${JSON.stringify(errors)}`);
};
const norm = (en, tr, locale) => normalizeTranslation(en, tr, locale);

const CARDS = '{count, plural, one {# card} other {# cards}}';

test('empty or uncompilable is refused', () => {
  bad('Save', '', 'es', /empty/);
  bad('Save', '   ', 'es', /empty/);
  bad(CARDS, '{count, plural, one {# carta} other {# cartas}', 'es', /does not compile/);
  ok('Save', 'Guardar', 'es');
});

test('placeholders and tags match the English', () => {
  ok('Hello {name}', 'Hola {name}', 'es');
  bad('Hello {name}', 'Hola', 'es', /missing \{name\}/);
  bad('Hello {name}', 'Hola {nombre}', 'es', /missing \{name\}.*\{nombre\}/);
  ok('Read <0>the docs</0>', 'Lee <0>la documentación</0>', 'es');
  bad('Read <0>the docs</0>', 'Lee <1>la documentación</1>', 'es', /<0>/);
  ok('A <0/> B', 'A <0/> B', 'fr');
  bad('A <0/> B', 'A <1/> B', 'fr', /<0\/>/);
});

test('the quote trap: a straight apostrophe before { or <', () => {
  bad('Hello {name}', "l'{name}", 'fr', /a straight ' before \{name\} hides it: write ’/);
  bad('Open <0>it</0>', "l'<0>it</0>", 'fr', /a straight ' before <0> hides it/);
  ok('Hello {name}', 'l’{name}', 'fr');
  ok('Hello {name}', "l''{name}", 'fr');
});

test('plural categories come from the language', () => {
  const ru = '{count, plural, one {# карточка} few {# карточки} many {# карточек} other {# карточки}}';
  ok(CARDS, ru, 'ru');
  bad(CARDS, '{count, plural, one {# карточка} other {# карточек}}', 'ru', /plural \{count\}: Russian needs one, few, many, other \(missing: few, many\)/);
  ok(CARDS, '{count, plural, one {# carta} other {# cartas}}', 'es');
  ok(CARDS, '{count, plural, one {# carta} many {# cartas} other {# cartas}}', 'es');
  bad(CARDS, '{count, plural, one {# carta} few {# cartas} other {# cartas}}', 'es', /has no few/);
  ok(CARDS, '{count, plural, other {# 枚のカード}}', 'ja');
  bad(CARDS, '{count, plural, one {# 枚} other {# 枚のカード}}', 'ja', /Japanese has no one/);
  bad(CARDS, '{count, plural, one {# 장} other {# 장}}', 'ko', /Korean has no one/);
  bad(CARDS, 'un {count} cartes', 'fr', /plural \{count\} is missing/);
});

test('a plural keeps the English exact =N keys and works at every nesting level', () => {
  const en = '{n, plural, =0 {No cards} one {# card} other {# cards}}';
  ok(en, '{n, plural, =0 {Sin tarjetas} one {# tarjeta} other {# tarjetas}}', 'es');
  bad(en, '{n, plural, one {# tarjeta} other {# tarjetas}}', 'es', /exact =0/);
  const nested = '{g, select, a {Group {n, plural, one {# card} other {# cards}}} other {Other}}';
  ok(nested, '{g, select, a {Grupo {n, plural, one {# tarjeta} other {# tarjetas}}} other {Otro}}', 'es');
  bad(nested, '{g, select, a {Grupo {n, plural, one {# tarjeta} few {# t} other {# tarjetas}}} other {Otro}}', 'es', /has no few/);
});

test('select needs exactly the English keys', () => {
  const en = '{role, select, owner {Owner} editor {Editor} other {Member}}';
  ok(en, '{role, select, owner {Propietario} editor {Editor} other {Miembro}}', 'es');
  bad(en, '{role, select, owner {Propietario} other {Miembro}}', 'es', /select \{role\}.*missing: editor/);
  bad(en, '{role, select, owner {P} editor {E} viewer {V} other {M}}', 'es', /not allowed: viewer/);
  bad(en, '{role, plural, one {a} other {b}}', 'es', /is a select in the English/);
});

test('selectordinal uses the ordinal categories', () => {
  const en = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
  ok(en, '{n, selectordinal, other {#.}}', 'es');
  bad(en, '{n, selectordinal, one {#st} other {#th}}', 'es', /has no one/);
});

test('** comes in as many pairs as the English', () => {
  ok('Press **Enter** now', 'Pulsa **Intro** ahora', 'es');
  bad('Press **Enter** now', 'Pulsa Intro ahora', 'es', /\*\* appears 0 times, the English has 2/);
});

test('Soleil, Creator, web addresses, emails and key symbols are kept as written', () => {
  ok('Upgrade to Creator', 'Pasa a Creator', 'es');
  bad('Upgrade to Creator', 'Pasa a Creador', 'es', /"Creator" must stay as written/);
  ok('Welcome to Soleil Clusters', 'Bienvenido a Soleil Clusters', 'es');
  bad('Welcome to Soleil Clusters', 'Bienvenido a Clusters de Soleil', 'es', /"Soleil Clusters"/);
  ok('See https://clusters.soleilpictures.com/docs', 'Mira https://clusters.soleilpictures.com/docs', 'es');
  bad('See https://clusters.soleilpictures.com/docs', 'Mira https://clusters.soleilpictures.com', 'es', /must stay as written/);
  ok('Visit clusters.soleilpictures.com', 'Visita clusters.soleilpictures.com', 'ja');
  bad('Visit clusters.soleilpictures.com', 'Visita el sitio', 'ja', /clusters\.soleilpictures\.com/);
  ok('Write to help@soleilpictures.com', 'Escribe a help@soleilpictures.com', 'es');
  bad('Write to help@soleilpictures.com', 'Escribe a ayuda@soleilpictures.com', 'es', /help@soleilpictures\.com/);
  ok('Press ⌘K or Ctrl+K, Esc closes', 'Pulsa ⌘K o Ctrl+K, Esc cierra', 'es');
  bad('Press ⌘K', 'Pulsa Cmd+K', 'es', /"⌘"/);
  bad('Press Ctrl+K', 'Pulsa Control+K', 'es', /"Ctrl"/);
  bad('Esc closes', 'Escape cierra', 'es', /"Esc"/);
});

test('quote marks follow the language', () => {
  ok('Say “hi”', 'Dis « salut »', 'fr');
  bad('Say hi', 'Dis “salut”', 'fr', /do not use “ ” in French/);
  bad('Say hi', 'Скажи “привет”', 'ru', /do not use/);
  ok('Say hi', 'Скажи «привет»', 'ru');
  ok('Say hi', '「こんにちは」と言う', 'ja');
  bad('Say hi', '“こんにちは”', 'ja', /do not use/);
  bad('Say hi', '«こんにちは»', 'ja', /do not use/);
  bad('Say hi', 'Di «hola»', 'es', /do not use « » in Spanish/);
  bad('Say hi', 'Di 「hola」', 'pt-BR', /do not use/);
  bad('Say hi', '«안녕»', 'ko', /do not use/);
  ok('Say hi', 'Di “hola”', 'es');
});

test('warnings: identical, long label, line breaks, ja punctuation', () => {
  assert.ok(lint('Hello there friend', 'Hello there friend', 'es').warnings.some((w) => /identical/.test(w)));
  assert.equal(lint('Soleil', 'Soleil', 'es').warnings.length, 0);
  assert.equal(lint('Hello {name} {other}', 'Hola {name} {other}', 'es').warnings.length, 0);
  assert.ok(lint('Save', 'Guardar todos los cambios ahora', 'es').warnings.some((w) => /long label/.test(w)));
  assert.ok(!lint('Save', 'Guardar', 'es').warnings.some((w) => /long label/.test(w)));
  assert.ok(lint('Save', '保存してすべての変更を', 'ja').warnings.some((w) => /long label/.test(w)));
  assert.ok(!lint('A much longer sentence of English that is more than 24 chars.', 'Una frase mucho más larga en español, claro que sí, y bastante más larga.', 'es').warnings.some((w) => /long label/.test(w)));
  assert.ok(lint('One\nTwo', 'Uno Dos', 'es').warnings.some((w) => /line break/.test(w)));
  assert.equal(lint('One\nTwo', 'Uno\nDos', 'es').warnings.length, 0);
  assert.ok(lint('Done. Next', '完了. 次へ', 'ja').warnings.some((w) => /ja:/.test(w)));
  assert.ok(!lint('Done. Next', '完了。次へ', 'ja').warnings.some((w) => /ja:/.test(w)));
});

test('normalize: the English ends', () => {
  assert.equal(norm(' · {n} left', '· quedan {n}', 'es'), ' · quedan {n}');
  assert.equal(norm('Save', '  Guardar \n', 'es'), 'Guardar');
  assert.equal(norm('Name: ', 'Nombre:', 'es'), 'Nombre: ');
  assert.equal(norm('Save', 'Guardar', 'es'), 'Guardar');
});

test('normalize: ... becomes …', () => {
  assert.equal(norm('Loading…', 'Cargando...', 'es'), 'Cargando…');
  assert.equal(norm('Loading…', 'Cargando…', 'es'), 'Cargando…');
});

test('normalize: an apostrophe between letters becomes ’', () => {
  assert.equal(norm('Image', "l'image", 'fr'), 'l’image');
  assert.equal(norm('Hello {name}', "l'{name}", 'fr'), "l'{name}");
  assert.equal(norm('x', "it''s", 'en'), "it''s");
});

test('normalize: French spacing', () => {
  assert.equal(norm('Delete?', 'Supprimer ?', 'fr'), 'Supprimer ?');
  assert.equal(norm('Delete?', 'Supprimer?', 'fr'), 'Supprimer ?');
  assert.equal(norm('Delete?', 'Supprimer ?', 'fr'), 'Supprimer ?');
  assert.equal(norm('{name}:', '{name}:', 'fr'), '{name} :');
  assert.equal(norm('Name: {x}', 'Nom : {x}', 'fr'), 'Nom : {x}');
  assert.equal(norm('Open https://x.y', 'Ouvrir https://x.y', 'fr'), 'Ouvrir https://x.y');
  assert.equal(norm('Open https://x.y?a=1', 'Ouvrir https://x.y?a=1 !', 'fr'), 'Ouvrir https://x.y?a=1 !');
  assert.equal(norm('Open clusters.soleilpictures.com', 'Ouvrir clusters.soleilpictures.com', 'fr'), 'Ouvrir clusters.soleilpictures.com');
  assert.equal(norm('Really?!', 'Vraiment?!', 'fr'), 'Vraiment ?!');
  assert.equal(norm('Really?!', 'Vraiment ?!', 'fr'), 'Vraiment ?!');
  assert.equal(norm('Say hi', 'Dire « salut »', 'fr'), 'Dire « salut »');
  assert.equal(norm('Say hi', 'Dire «salut»', 'fr'), 'Dire « salut »');
  assert.equal(norm('At 10:30', 'À 10:30', 'fr'), 'À 10:30');
  assert.equal(norm('{n, number, ::currency/USD}', '{n, number, ::currency/USD}', 'fr'), '{n, number, ::currency/USD}');
  // a colon with nothing but a token after it is not punctuation
  assert.equal(norm('m:ss', 'm:ss', 'fr'), 'm:ss');
  assert.equal(norm('{m}:{ss}', '{m}:{ss}', 'fr'), '{m}:{ss}');
  assert.equal(norm('https://', 'https://', 'fr'), 'https://');
  assert.equal(norm('Note: hi', 'Remarque: salut', 'fr'), 'Remarque : salut');
  // no space after an opening bracket
  assert.equal(norm('Unknown (?)', 'Inconnu (?)', 'fr'), 'Inconnu (?)');
  assert.equal(norm('Unknown (?)', 'Inconnu ( ?)', 'fr'), 'Inconnu (?)');
  assert.equal(norm('Unknown (?)', 'Inconnu ( ?)', 'fr'), 'Inconnu (?)');
  assert.equal(norm('Really (yes)?', 'Vraiment (oui)?', 'fr'), 'Vraiment (oui) ?');
  // other languages are left alone
  assert.equal(norm('Delete?', 'Eliminar ?', 'es'), 'Eliminar ?');
  // ICU syntax never holds these characters
  const plural = '{count, plural, one {# carte} other {# cartes}}';
  assert.equal(norm(plural, plural, 'fr'), plural);
  ok('{count, plural, one {# card} other {# cards}}', plural, 'fr');
});

test('normalize is idempotent', () => {
  for (const [en, tr, l] of [['Delete?', 'Supprimer ?', 'fr'], ['Save', "  l'image... ", 'fr'], ['Say hi', 'Dire «salut» !', 'fr']]) {
    const once = norm(en, tr, l);
    assert.equal(norm(en, once, l), once);
  }
});

test('a message with a plural may repeat kept words and ** in its extra branches', () => {
  const en = '{n, plural, one {Creator **takes** it} other {Creator **takes** them}}';
  ok(en, '{n, plural, one {Creator **a** x} few {Creator **b** x} many {Creator **c** x} other {Creator **d** x}}', 'ru');
  bad(en, '{n, plural, one {x **a** x} few {x **b** x} many {x **c** x} other {x **d** x}}', 'ru', /"Creator"/);
  bad(en, '{n, plural, one {Creator **a} few {Creator b} many {Creator c} other {Creator d}}', 'ru', /\*\*/);
});
