// A live shortcut to a file shared with you (components/cards/ShortcutCard.jsx):
// it carries the share's token and nothing that names the file, its index row
// stays nameless, and the canvas opens it in the in-app viewer. Behaviour runs
// on the DEV harness (tests/shortcut-card.spec.js); these are the wiring pins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCardIndexRow } from './cardIndexRow.js';
import { displayName } from './indexRowCard.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const TOKEN = '5c000000-0000-4000-8000-000000000001';

test('a shortcut’s index row has no title, body or token: the file is someone else’s', () => {
  const card = { id: 'shortcut-1', kind: 'shortcut', shareToken: TOKEN, x: 10, y: 20, w: 240, h: 180 };
  const row = buildCardIndexRow({
    workspaceId: '7dc63db0-7313-43bc-b136-72bacd86344c', boardId: 'c666d453-cbc1-4176-af21-f2d86645df73',
    cardId: card.id, get: (k) => card[k], groupNameById: new Map(),
  });
  assert.equal(row.kind, 'shortcut');
  assert.equal(row.title || '', '');
  assert.equal(row.body || '', '');
  assert.doesNotMatch(JSON.stringify(row), new RegExp(TOKEN), 'the token is a key to the file: never in the index');
  assert.equal(displayName({ kind: 'shortcut', title: row.title, meta: row.meta }), 'Shortcut');
});

test('the app puts only the token on the card, and the card never writes', () => {
  const app = src('../App.jsx');
  assert.match(app, /cards: \[\{ id, kind: 'shortcut', shareToken: token, w: 240, h: 180 \}\]/);
  assert.match(app, /<SharedFileHost onSaveCopy=\{saveSharedCopy\} onAddShortcut=\{addSharedShortcut\} \/>/);
  assert.match(app, /onAddShortcut=\{addSharedShortcut\}/);
  assert.match(app, /logEvent\(EV\.SHARED_FILE_SHORTCUT, \{ kind, ok, reason \}\)/);
  const card = src('../components/cards/ShortcutCard.jsx');
  assert.doesNotMatch(card, /onUpdate/, 'what it learns about the file stays on screen');
  assert.match(card, /const \{ status, res \} = useShare\(shareToken, \{ enabled: !!shareToken && !isPublic, api \}\);/, 'a public board asks nothing');
});

test('the canvas draws it, opens it on double-click and from its menu, nothing on a public board', () => {
  const c = src('../components/CanvasSurface.jsx');
  assert.match(c, /else if \(c\.kind === 'shortcut'\)  inner = <ShortcutCard shareToken=\{c\.shareToken\} isPublic=\{isPublic\}\s+onRemove=\{canEdit && !isPublic \? \(\) => doDeleteIds\(\[c\.id\]\) : null\} \/>;/);
  assert.match(c, /if \(c\.kind === 'shortcut'\) \{\s+if \(c\.shareToken && !isPublic\) \{ e\.stopPropagation\?\.\(\); openSharedFile\(\{ token: c\.shareToken, via: 'shortcut' \}\); \}\s+return;\s+\}/);
  assert.match(c, /\} else if \(c\.kind === 'shortcut' && c\.shareToken && !isPublic\) \{\s+openItems\.push\(\{ id: 'open', label: 'Open', run: \(\) => openSharedFile\(\{ token: c\.shareToken, via: 'shortcut' \}\) \}\);/);
  // Never "Share file…": a shortcut is not the file.
  assert.match(src('./fileShares.js'), /export const SHAREABLE_KINDS = Object\.freeze\(\['image', 'video', 'audio', 'pdf', 'file'\]\);/);
});

test('the API cannot make one: shortcut stays out of CARD_KINDS', () => {
  assert.match(src('../worker-api.js'), /CARD_KINDS = \[[^\]]*\]/);
  assert.doesNotMatch(src('../worker-api.js').match(/CARD_KINDS = \[[^\]]*\]/)[0], /shortcut/);
});
