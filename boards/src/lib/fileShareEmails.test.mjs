// Source pins for the file_shared / file_commented templates (single-file
// sharing). The edge function is Deno, so these read the .ts as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../supabase/functions/', import.meta.url);
const tpl = readFileSync(new URL('_shared/email/templates.ts', root), 'utf8');
const idx = readFileSync(new URL('send-transactional-email/index.ts', root), 'utf8');

const NAMES = ['file_shared', 'file_commented'];

test('both names are in TemplateName and TEMPLATE_NAMES', () => {
  const union = tpl.slice(tpl.indexOf('export type TemplateName'), tpl.indexOf('export const TEMPLATE_NAMES'));
  const list = tpl.slice(tpl.indexOf('export const TEMPLATE_NAMES'), tpl.indexOf('export interface RenderedEmail'));
  for (const n of NAMES) {
    assert.ok(union.includes(`"${n}"`), `${n} in union`);
    assert.ok(list.includes(`"${n}"`), `${n} in TEMPLATE_NAMES`);
  }
});

test('both names are USER_TRIGGERED; file_commented is list-unsubscribable', () => {
  const trig = idx.slice(idx.indexOf('const USER_TRIGGERED ='), idx.indexOf('const USER_TRIGGERED_HOURLY_CEILING'));
  for (const n of NAMES) assert.ok(trig.includes(`"${n}"`), `${n} in USER_TRIGGERED`);
  const lu = idx.slice(idx.indexOf('const LIST_UNSUB_TEMPLATES'), idx.indexOf('const UNSUB_KEY_BY_TEMPLATE'));
  assert.ok(lu.includes('"file_commented"'));
  assert.match(idx, /file_commented:\s+"email_comment_replies"/);
});

test('the switch sanitises every attacker-typed field', () => {
  const sw = tpl.slice(tpl.indexOf('case "file_shared"'), tpl.indexOf('case "activate_nudge_1"'));
  assert.match(sw, /sharerName:\s+safePerson\(data\.sharerName\)/);
  // The extension moves out of the name before safeLabel sees it (fileLabel).
  assert.match(sw, /fileName:\s+doc \? safeLabel\(data\.fileName, 60, "a document"\) : fileLabel\(data\.fileName\)/);
  assert.match(tpl, /function fileLabel\(raw: unknown\): string \{[\s\S]*?safeLabel\(m\[1\], 52, "a file"\)/);
  assert.match(sw, /commenterName:\s+safePerson\(data\.commenterName\)/);
  assert.match(sw, /commentPreview: safeLabel\(data\.commentPreview, 280\)/);
  assert.match(sw, /role:\s+data\.role === "comment" \? "comment" : data\.role === "edit" \? "edit" : "view"/);
  assert.match(sw, /kind:\s+doc \? "doc" : "file"/);
  assert.match(sw, /\[0-9a-f-\]\{36\}/);
  assert.match(sw, /throw new Error\("file_shared needs a token"\)/);
});

test('the link points at /f/<token>', () => {
  assert.match(tpl, /FILE_URL_BASE = "https:\/\/clusters\.soleilpictures\.com\/f\/"/);
  assert.match(tpl, /fileUrlBase\(d\.origin\) \+ d\.token/);
  assert.equal(tpl.match(/fileUrlBase\(d\.origin\) \+ d\.token/g).length, 2);
});

test('the link origin is production unless it is exactly the preview origin', () => {
  assert.match(tpl, /FILE_PREVIEW_ORIGIN = "https:\/\/main-soleil-boards\.arconkli\.workers\.dev"/);
  assert.match(tpl, /origin === FILE_PREVIEW_ORIGIN \? FILE_PREVIEW_ORIGIN \+ "\/f\/" : FILE_URL_BASE/);
  const sw = tpl.slice(tpl.indexOf('case "file_shared"'), tpl.indexOf('case "activate_nudge_1"'));
  assert.equal(sw.match(/origin:\s+String\(data\.origin \?\? ""\)/g).length, 2);
});

// 0426: the invitation names a doc and the edit role (the trigger sends both).
test('a doc is "a document" you can view, or view and edit', () => {
  const fn = tpl.slice(tpl.indexOf('function fileShared('), tpl.indexOf('interface FileCommentedData'));
  assert.match(fn, /shared \$\{doc \? "a document" : "a file"\} with you\./);
  assert.match(fn, /\? \(d\.role === "edit" \? "view and edit" : "view"\)/);
  assert.match(fn, /: \(d\.role === "comment" \? "view and comment on" : "view"\);/);
  assert.match(fn, /const open = doc \? "Open document" : "Open file";/);
  assert.match(fn, /eyebrow: doc \? "Document shared" : "File shared",/);
});

test('file_commented carries the comment-reply unsubscribe', () => {
  assert.match(tpl, /unsubUrl\(d\.unsubscribeToken, "email_comment_replies"\)/);
  assert.match(tpl, /bodyHtml: quoteBlock\(d\.commentPreview\)/);
});

test('no \\u escapes in either file (the MCP deploy rewrites them)', () => {
  assert.doesNotMatch(tpl, /\\u[0-9a-fA-F]{4}/);
  assert.doesNotMatch(idx, /\\u[0-9a-fA-F]{4}/);
});
