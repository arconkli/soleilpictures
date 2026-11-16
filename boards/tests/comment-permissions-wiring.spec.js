// comment-permissions-wiring.spec.js
//
// Canvas comments talk to Supabase directly and the ?local=1 harness has no
// comments backend, so these pin the wiring at the source level, the way
// share-panel-simplicity.spec.js does.
//
// SHARE-4: the comments UPDATE policy is "author, or anyone who can write the
// board". PostgREST reports an UPDATE that RLS filtered to zero rows as a
// success, so a viewer's Resolve / Hide on a teammate's comment did nothing
// with no message, and the old archive's Delete fell back to such an UPDATE
// and showed "Comment deleted" for a comment that never was.
//
// Who is OFFERED what is one rule now, lib/commentRules.js commentPowers,
// with its own unit tests (commentRules.test.mjs). What is pinned here is that
// the canvas's parts ask that rule, and are handed the board permission it
// needs. The behaviour itself (a view-only person is offered no Resolve on a
// teammate's conversation, Edit only on their own words) is driven for real
// in canvas-comment-pins.spec.js.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const fnBody = (src, name) => {
  const at = src.indexOf(`export async function ${name}(`);
  expect(at, `${name} is gone`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n}\n', at));
};
// One JSX element's opening tag, props and all.
const element = (src, name) => {
  const at = src.indexOf(`<${name}\n`);
  expect(at, `<${name}> is gone`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('/>', at));
};

test.describe('a refused comment write says so', () => {
  test('updateComment asks for the rows back and throws on none', () => {
    const body = fnBody(read('src/lib/commentsApi.js'), 'updateComment');
    expect(body).toMatch(/\.update\(r\)\.eq\('id', id\)\.select\('\*'\)/);
    expect(body).toMatch(/data\.length === 0\) throw/);
  });

  test('deleteComment never falls back past a permission refusal', () => {
    const body = fnBody(read('src/lib/commentsApi.js'), 'deleteComment');
    // The refusal is checked BEFORE the fallback UPDATE can run.
    expect(body.indexOf("error.code === '42501'")).toBeGreaterThan(-1);
    expect(body.indexOf("error.code === '42501'")).toBeLessThan(body.indexOf('.update('));
    // And the fallback itself counts what it changed.
    expect(body).toMatch(/\.select\('id'\);\s*if \(upd\.error\) throw upd\.error;\s*if \(!upd\.data \|\| upd\.data\.length === 0\) throw/);
  });

  test('restoreComment follows the same rule', () => {
    const body = fnBody(read('src/lib/commentsApi.js'), 'restoreComment');
    expect(body.indexOf("error.code === '42501'")).toBeLessThan(body.indexOf('.update('));
    expect(body).toMatch(/upd\.data\.length === 0\) throw/);
  });
});

test.describe('actions are offered only to the people they work for', () => {
  test('the open conversation asks the one rule, with the board permission', () => {
    const s = read('src/components/comments/CanvasCommentCard.jsx');
    expect(s).toMatch(/commentPowers\(\{ me, row, thread, canRead: !!userId, canWrite: !!canEdit \}\)/);
  });

  test('the card shows Resolve and Delete, and a row Edit and Delete, only as that rule allows', () => {
    const card = read('src/components/comments/CommentCard.jsx');
    expect(card).toMatch(/const showResolve = !!thread && !resolved && !!top\.resolve && !!onResolve;/);
    expect(card).toMatch(/if \(thread && top\.delete && onDeleteThread\)/);
    const row = read('src/components/comments/CommentRow.jsx');
    expect(row).toMatch(/const canEdit = !!p\.edit && !!onEdit;/);
    expect(row).toMatch(/const canDelete = !!p\.delete && !!onDelete;/);
  });

  test('a doc\'s and a note\'s threads ask the same rule, and a guest of a shared doc is held to their own', () => {
    const s = read('src/components/comments/docThreadOps.js');
    expect(s).toMatch(/commentPowers\(\{ me, row, thread, canRead: !!canEdit, canWrite: !!canEdit \}\)/);
    expect(s).toMatch(/edit: p\.edit && filed && !guest,/);
    for (const f of ['src/components/comments/DocThreadsPanel.jsx', 'src/components/comments/DocFloatCards.jsx']) {
      expect(read(f), f).toMatch(/powers=\{ops\.powers\(/);
    }
  });

  test('a point comment moves only for whoever may delete it', () => {
    const s = read('src/components/comments/CanvasCommentPins.jsx');
    expect(s).toMatch(/commentPowers\(\{.*canWrite: !!canEdit \}\)\.delete/);
  });

  test('the canvas passes the board permission to the pins and to the conversation', () => {
    const s = read('src/components/CanvasSurface.jsx');
    expect(element(s, 'CanvasCommentPins')).toContain('canEdit={canEdit}');
    expect(element(s, 'CanvasCommentCard')).toContain('canEdit={canEdit}');
  });

  test('the old bubble and archive are gone, and nothing on the canvas unhides for everyone', () => {
    const s = read('src/components/CanvasSurface.jsx');
    expect(s).not.toContain('<CanvasCommentLayer');
    expect(s).not.toContain('<CommentArchivePopover');
    // C5: the island's switch is personal. The bulk unhide wrote shared rows.
    for (const f of ['src/components/CanvasSurface.jsx', 'src/components/comments/CanvasCommentsIsland.jsx',
      'src/components/comments/CanvasCommentsList.jsx', 'src/components/comments/CanvasCommentPins.jsx',
      'src/components/comments/CanvasCommentCard.jsx']) {
      expect(read(f), f).not.toContain('unhideAllOnBoard');
    }
  });
});
