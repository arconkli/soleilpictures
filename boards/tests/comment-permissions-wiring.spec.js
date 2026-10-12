// comment-permissions-wiring.spec.js
//
// Canvas comments talk to Supabase directly and the ?local=1 harness has no
// comments backend, so these pin the wiring at the source level, the way
// share-panel-simplicity.spec.js does.
//
// SHARE-4: the comments UPDATE policy is "author, or anyone who can write the
// board". PostgREST reports an UPDATE that RLS filtered to zero rows as a
// success, so a viewer's Resolve / Hide on a teammate's comment did nothing
// with no message, and the archive's Delete fell back to such an UPDATE and
// showed "Comment deleted" for a comment that never was.

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

test.describe('a refused comment write says so', () => {
  test('updateComment asks for the rows back and throws on none', () => {
    const body = fnBody(read('src/lib/commentsApi.js'), 'updateComment');
    expect(body).toMatch(/\.update\(row\)\.eq\('id', id\)\.select\('id'\)/);
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
  test('the bubble shows Resolve / Hide to the author or a board writer', () => {
    const s = read('src/components/CanvasComment.jsx');
    expect(s).toMatch(/const canModerate = isAuthor \|\| canEdit;/);
    const at = s.indexOf('<div className="canvas-comment-actions">');
    expect(at).toBeGreaterThan(-1);
    expect(s.slice(at - 60, at)).toContain('{canModerate && (');
  });

  test('the archive shows Reopen / Unhide / Delete to the author or a board writer', () => {
    const s = read('src/components/CanvasComment.jsx');
    const at = s.indexOf('<div className="comment-archive-row-actions">');
    expect(at).toBeGreaterThan(-1);
    expect(s.slice(at - 80, at)).toContain('{(c.author === userId || canEdit) && (');
  });

  test('the canvas passes the board permission to both', () => {
    const s = read('src/components/CanvasSurface.jsx');
    const layer = s.slice(s.indexOf('<CanvasCommentLayer'), s.indexOf('/>', s.indexOf('<CanvasCommentLayer')));
    expect(layer).toContain('canEdit={canEdit}');
    const archive = s.slice(s.indexOf('<CommentArchivePopover'), s.indexOf('/>', s.indexOf('<CommentArchivePopover')));
    expect(archive).toContain('canEdit={canEdit}');
  });
});
