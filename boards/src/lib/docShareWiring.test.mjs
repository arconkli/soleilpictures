// Source pins for sharing one doc (0426, party/doc.ts): every entry point is
// held by docSharesAllowed(), the dialog speaks view | edit and wakes the
// rooms after a change, and the shared doc view is a guest that can bring
// nothing in and writes only where the room allows. Reads source text (the
// components import JSX and import.meta.env, which node --test cannot load).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isShareableDoc, docRoomsOf } from './fileShares.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Lifted for the sidebar release (2026-10-21), with docs/collaborate/sharing's
// "Sharing a doc". It stays the one switch, and stays in featureFlags().
test('the hold is open, and still listed', () => {
  const host = src('./appHost.js');
  assert.match(host, /export function docSharesAllowed\(\) \{\n(  \/\/[^\n]*\n)?  return true;\n\}/);
  assert.match(host, /docShares: docSharesAllowed,/);
  assert.match(src('../../content/docs/collaborate/sharing.md'), /^## Sharing a doc$/m, 'the docs that ship with it');
});

test('a doc card is shareable; a pending one or any other kind is not', () => {
  assert.equal(isShareableDoc({ kind: 'doc', id: 'd1' }), true);
  assert.equal(isShareableDoc({ kind: 'doc', pending: true }), false);
  assert.equal(isShareableDoc({ kind: 'image', src: 'r2:a' }), false);
  assert.equal(isShareableDoc(null), false);
});

test('a doc’s two rooms come from the room get_file_share named', () => {
  const s = 'bf59559b-bace-49f5-971c-93cbc348deb9';
  assert.deepEqual(docRoomsOf(`${s}.edit.bcc7e3849c35`), [`${s}.edit.bcc7e3849c35`, `${s}.view.bcc7e3849c35`]);
  assert.deepEqual(docRoomsOf(`${s}.view.bcc7e3849c35`), [`${s}.edit.bcc7e3849c35`, `${s}.view.bcc7e3849c35`]);
  assert.deepEqual(docRoomsOf('nope'), []);
  const lib = src('./fileShares.js');
  assert.match(lib, /fetch\(`\$\{PARTY_ORIGIN\}\/parties\/doc\/\$\{r\}\/recheck`, \{\s+method: 'POST', headers: \{ Authorization: `Bearer \$\{bearer\}` \},/);
});

test('every way in is held: the open doc’s header, the canvas menu, the list menu', () => {
  const bus = src('./fileShareBus.js');
  assert.match(bus, /return docSharesAllowed\(\) && isShareableDoc\(card\) \? 'Share doc…' : null;/);
  const card = src('../components/DocCard.jsx');
  assert.match(card, /\{!isPublic && canEdit && scope\?\.boardId && docSharesAllowed\(\) && isShareableDoc\(card\) && \(\s+<FileShareButton variant="doc" surface="doc" boardId=\{scope\.boardId\}/);
  const canvas = src('../components/CanvasSurface.jsx');
  assert.match(canvas, /const shareDoc = !multi && canEdit && !isPublic \? docShareLabel\(c\) : null;/);
  assert.match(canvas, /items\.push\(\{ id: 'share-doc', label: shareDoc,\s+run: \(\) => openFileShare\(\{ boardId: board\.id, cardId: c\.id, card: c, boardName: board\.name, surface: 'canvas' \}\) \}\);/);
  const list = src('../components/ListSurface.jsx');
  assert.match(list, /canEdit && docShareLabel\(card\) && \{ id: 'share-doc', label: docShareLabel\(card\), run: \(\) => openFileShare\(\{ boardId: board\.id, cardId: card\.id, card, boardName: board\.name, surface: 'list' \}\) \}/);
});

test('the dialog speaks a doc’s roles and wakes its rooms after a confirmed write', () => {
  const d = src('../components/fileShare/FileShareDialog.jsx');
  assert.match(d, /const upperRole = \(isDoc\) => \(isDoc \? 'edit' : 'comment'\);/);
  assert.match(d, /const \[inviteRole, setInviteRole\] = useState\(\(\) => upperRole\(card\?\.kind === 'doc'\)\);/);
  assert.match(d, /const role = inviteRole === 'view' \? 'view' : upper;/, 'never a file role on a doc');
  assert.match(d, /if \(isDocRef\.current \|\| data\?\.kind === 'doc'\) scheduleRecheck\(data\?\.token \|\| sRef\.current\.token\);/);
  assert.match(d, /\{phase === 'ready' && !isDoc && s\.commentCount > 0 && s\.token && \(/, 'a doc’s comments live in the doc');
});

test('the page opens a doc in its room, held, and keyed by room', () => {
  const p = src('../components/fileShare/FileSharePage.jsx');
  assert.match(p, /if \(kind === 'doc'\) \{/);
  assert.match(p, /\{docSharesAllowed\(\) \? \(\s+<Suspense fallback=\{[\s\S]*?\}>\s+<DocShareView key=\{res\.room \|\| 'none'\} token=\{token\} res=\{res\} onRefresh=\{onRefresh\}/);
  // A doc keeps the reader's theme: never the pinned-dark screening room.
  assert.match(p, /<div className=\{doc \? 'fsp fsp--doc' : 'fsp public-dark'\}>/);
});

test('the shared doc is a guest: nothing brought in, the room’s word on writing, its own copy', () => {
  const v = src('../components/fileShare/DocShareView.jsx');
  assert.match(v, /const canEdit = !!res\.can_edit && hello\?\.readOnly === false && phase !== 'ended';/);
  assert.match(v, /workspaceId=\{null\}/);
  assert.match(v, /isPublic=\{!canEdit\}\s+guestMode/);
  assert.match(v, /allowExport=\{!!res\.allow_download\}/);
  assert.match(v, /return \{ \.\.\.s, comments: s\.comments \|\| emptyComments, cardId: cardKey, docCardId: cardKey, boardId: null \};/);
  assert.match(v, /const c = cards\.get\(cardKey\);/, 'the card is the one the share named');
  assert.doesNotMatch(v, /initCardDocStore/, 'a guest never backfills the card (a write outside the doc)');
  assert.match(v, /for \(const k of r2KeysIn\(update\)\) \{[\s\S]{0,120}setKeyResolver\(k, resolver\);/);
  assert.match(v, /const doc = new Y\.Doc\(\);/, 'a copy of its own, made by the effect that runs the room');
});

test('guest mode leaves the doc’s housekeeping to its members and filters what a guest pastes', () => {
  const s = src('../components/DocSurface.jsx');
  assert.match(s, /if \(!canEdit \|\| !awareness \|\| guestMode\) return;/);
  assert.match(s, /if \(!canEdit \|\| guestMode\) return;/);
  assert.match(s, /if \(!titleOverride \|\| titleOverride === prev \|\| !pages\.length \|\| guestMode\) return;/);
  assert.match(s, /onInsertImage=\{guestMode \? null : pickImageFromDisk\}\s+onInsertBoardEmbed=\{guestMode \? null : pickBoardEmbed\}/);
  assert.match(s, /guestMode=\{guestMode\}/);
  const e = src('../components/DocPageEditor.jsx');
  assert.match(e, /\.\.\.\(guestMode \? \[\] : \[mentionExt\]\),/);
  assert.match(e, /\.\.\.\(guestMode \? \{ transformPasted: guestPasteSlice \} : \{\}\),/);
  assert.match(e, /if \(moved\) return false;\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+if \(guestMode\) return false;/);
  const menu = src('../components/DocInsertMenu.jsx');
  assert.match(menu, /\]\.filter\(\(it\) => \(it\.id === 'image' \? !!onInsertImage : it\.id === 'embed' \? !!onInsertBoardEmbed : true\)\);/);
});
