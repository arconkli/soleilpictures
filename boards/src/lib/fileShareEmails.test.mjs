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
  assert.match(sw, /sharerName:\s+safePerson\(data\.sharerName, 60, s\.t\("common\.fallback_person"\)\)/);
  // The extension moves out of the name before safeLabel sees it (fileLabel).
  assert.match(sw, /fileName:\s+doc \? safeLabel\(data\.fileName, 60, s\.t\("common\.fallback_document"\)\) : fileLabel\(data\.fileName, s\)/);
  assert.match(tpl, /function fileLabel\(raw: unknown, s: EmailStrings\): string \{[\s\S]*?safeLabel\(m\[1\], 52, s\.t\("common\.fallback_file"\)\)/);
  assert.match(sw, /commenterName:\s+safePerson\(data\.commenterName, 60, s\.t\("common\.fallback_person"\)\)/);
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
// The words moved into strings/en.mjs, so this reads what the email says (the
// rendered English) and keeps the source pins on which role picks which line.
const { renderTemplate } = await import(new URL('_shared/email/templates.ts', root));
const TOKEN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const shared = (kind, role) => renderTemplate('file_shared', {
  sharerName: 'Sam', fileName: 'Notes', kind, role, token: TOKEN, origin: '',
});

test('a doc is "a document" you can view, or view and edit', () => {
  const fn = tpl.slice(tpl.indexOf('function fileShared('), tpl.indexOf('interface FileCommentedData'));
  assert.match(fn, /d\.role === "edit"\s+\? s\.t\("file_shared\.subtitle_doc_edit"[\s\S]*?: s\.t\("file_shared\.subtitle_doc_view"/);
  assert.match(fn, /d\.role === "comment"\s+\? s\.t\("file_shared\.subtitle_file_comment"[\s\S]*?: s\.t\("file_shared\.subtitle_file_view"/);
  const text = (m) => m.text;
  assert.match(text(shared('doc', 'edit')), /Sam shared a document with you\.\nYou can view and edit "Notes"\./);
  assert.match(text(shared('doc', 'view')), /You can view "Notes"\./);
  assert.match(text(shared('file', 'comment')), /Sam shared a file with you\.\nYou can view and comment on "Notes"\./);
  assert.match(text(shared('file', 'view')), /You can view "Notes"\./);
  assert.match(text(shared('doc', 'edit')), /Open document: /);
  assert.match(text(shared('file', 'view')), /Open file: /);
  assert.match(shared('doc', 'edit').html, /Document shared/);
  assert.match(shared('file', 'view').html, /File shared/);
  assert.equal(shared('doc', 'edit').subject, 'Sam shared "Notes" with you');
});

test('file_commented carries the comment-reply unsubscribe', () => {
  assert.match(tpl, /unsubUrl\(d\.unsubscribeToken, "email_comment_replies"\)/);
  assert.match(tpl, /bodyHtml: quoteBlock\(d\.commentPreview, d\.commenterName\)/);
});

test('no \\u escapes in either file (the MCP deploy rewrites them)', () => {
  assert.doesNotMatch(tpl, /\\u[0-9a-fA-F]{4}/);
  assert.doesNotMatch(idx, /\\u[0-9a-fA-F]{4}/);
});
