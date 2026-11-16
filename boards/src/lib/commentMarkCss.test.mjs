import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentMarkCss, markable, markOpens } from './commentMarkCss.js';

test('only open threads get the neutral tint; resolved and unknown ids get no rule', () => {
  const { rest, open } = commentMarkCss({
    scope: '.dl-surface',
    threads: [{ id: 'cm_a1', resolved: false }, { id: 'cm_b2', resolved: true }, { id: 'cm_a1', resolved: false }, { id: 'bad"id' }, null],
  });
  assert.equal(rest, '.dl-surface .tt-comment[data-comment-id="cm_a1"]{background:var(--cmt-mark);cursor:pointer}');
  assert.equal(open, '');
  assert.ok(!/soleil/.test(rest), 'never gold at rest');
});

test('the open thread is the one gold mark, resolved or not', () => {
  const { rest, open } = commentMarkCss({ scope: '[data-card-id="n1"]', threads: [{ id: 'a' }, { id: 'b', resolved: true }], openId: 'b' });
  assert.match(rest, /data-comment-id="a"/);
  assert.ok(!/data-comment-id="b"/.test(rest));
  assert.match(open, /^\[data-card-id="n1"\] \.tt-comment\[data-comment-id="b"\]\{[^}]*var\(--soleil/);
});

test('nothing to say: empty text', () => {
  assert.deepEqual(commentMarkCss({ threads: [], scope: '.x' }), { rest: '', open: '' });
  assert.deepEqual(commentMarkCss({ threads: [{ id: 'a', resolved: true }], scope: '.x', openId: 'no good' }), { rest: '', open: '' });
});

test('ids are the comment keys; a mark opens only for a thread that is there and open', () => {
  assert.equal(markable('cm_abc-1'), true);
  assert.equal(markable('a"]{}'), false);
  assert.equal(markable(''), false);
  assert.equal(markOpens({ id: 'a', resolved: false }), true);
  assert.equal(markOpens({ id: 'a', resolved: true }), false);
  assert.equal(markOpens(null), false);
});

test('the open thread\'s words go plain when the thread is gone', () => {
  assert.equal(commentMarkCss({ threads: [{ id: 'a' }], scope: '.x', openId: 'gone' }).open, '');
  assert.notEqual(commentMarkCss({ threads: [{ id: 'a' }], scope: '.x', openId: 'a' }).open, '');
});

// A note that is only being read asks the browser whether the words under a
// finger open a thread: getComputedStyle(mark).cursor === 'pointer'
// (components/cards.jsx NoteCardCollab). That answer is right only while the
// rules above are the one place a comment mark gets the pointer.
test('the pointer goes to live open threads only, and to the one that is open', () => {
  const threads = [
    { id: 'cm_open', resolved: false }, { id: 'cm_done', resolved: true },
    { id: 'cm_other', resolved: false }, { id: 'bad id' }, null,
  ];
  const pointerIds = (css) => [...css.matchAll(/([^{}]*)\{[^}]*cursor:pointer[^}]*\}/g)]
    .flatMap((m) => [...m[1].matchAll(/data-comment-id="([^"]+)"/g)].map((x) => x[1]));
  const { rest, open } = commentMarkCss({ scope: '.note-body', threads });
  assert.deepEqual(pointerIds(rest), ['cm_open', 'cm_other']);
  assert.equal(open, '');
  // every rule names a thread by its id: none reaches a mark without one
  for (const css of [rest, commentMarkCss({ scope: '.note-body', threads, openId: 'cm_open' }).open]) {
    for (const m of css.matchAll(/([^{}]*)\{/g)) {
      for (const one of m[1].split(',')) assert.match(one, /\.tt-comment\[data-comment-id="[A-Za-z0-9_-]+"\]$/);
    }
  }
  // a thread that is gone (deleted, or never there) gets nothing, open or not
  assert.deepEqual(commentMarkCss({ scope: '.note-body', threads, openId: 'cm_gone' }), { rest, open: '' });
  assert.deepEqual(commentMarkCss({ scope: '.note-body', threads: [], openId: 'cm_open' }), { rest: '', open: '' });
  // the one that is open keeps the pointer (it is lit, and a press goes to it)
  assert.deepEqual(pointerIds(commentMarkCss({ scope: '.note-body', threads, openId: 'cm_done' }).open), ['cm_done']);
});

test('no stylesheet gives a comment mark the pointer', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const SRC = fileURLToPath(new URL('..', import.meta.url));
  const sheets = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const at = join(dir, name);
      if (statSync(at).isDirectory()) walk(at);
      else if (name.endsWith('.css')) sheets.push(at);
    }
  };
  walk(SRC);
  assert.ok(sheets.length > 20, 'the stylesheets were found');
  // What a selector's last part must not be: the mark itself, or something
  // wide enough to be it inside a note's or a doc's words (any element, any
  // span, anything with a data-comment-id).
  const words = /(?:^|[\s>+~])(?:\.(?:note-body|note-read|ProseMirror|tiptap|dl-surface|dl-doc)\b[^\s>+~]*)\s*>?\s*(?:\*|span)(?::[a-z-]+(?:\([^)]*\))?)*$/;
  const reaches = (one) => /tt-comment|data-comment-id/.test(one) || words.test(one.trim());
  const hits = [];
  for (const file of sheets) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/cursor\s*:\s*pointer/.test(m[2])) continue;
      for (const one of m[1].split(',')) {
        if (reaches(one)) hits.push(`${file.slice(SRC.length)}: ${one.trim()}`);
      }
    }
  }
  assert.deepEqual(hits, []);
  // and the check sees one when it is there
  assert.ok(reaches('.note-body .tt-comment'));
  assert.ok(reaches('.note-body span'));
  assert.ok(reaches('.ProseMirror > *'));
  assert.ok(!reaches('.note-body a'));
});
