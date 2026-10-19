// The Shared page and the in-app viewer: pure helpers, and the wiring that
// keeps a shared file's media scoped and the whole thing behind its hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fsRef, parseFsKey, FS_PREFIX } from './fileShareBundle.js';
import { accessSummary, typeTile } from './sharedFiles.js';
import { unreadCount } from '../hooks/useSharedFiles.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const T = '0f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';

test('a shared file’s media keys name the token and the url, nothing else', () => {
  assert.equal(FS_PREFIX, '__fs/');
  assert.equal(fsRef(T, 'src'), `r2:__fs/${T}/src`);
  assert.equal(fsRef(T.toUpperCase(), 'poster'), `r2:__fs/${T}/poster`, 'one spelling per token');
  assert.deepEqual(parseFsKey(`__fs/${T}/download`), { token: T, name: 'download' });
  assert.equal(parseFsKey(`__fs/${T}/keys`), null, 'only src, poster and download');
  assert.equal(parseFsKey('__fs/not-a-token/src'), null);
  assert.equal(parseFsKey(`ws/${T}/src`), null, 'an ordinary storage key is never read as one');
});

test('rows say who can open what, in words', () => {
  assert.equal(accessSummary({ link_access: 'view', people_count: 2 }), 'Anyone with the link can view · 2 people');
  assert.equal(accessSummary({ link_access: 'comment', people_count: 0 }), 'Anyone with the link can comment');
  assert.equal(accessSummary({ link_access: 'none', people_count: 1 }), 'Only people added · 1 person');
  assert.equal(accessSummary({ link_access: 'none', people_count: 0 }), '');
  assert.equal(typeTile({ ext: 'zip' }), 'ZIP');
  assert.equal(typeTile({ kind: 'video' }), 'VIDE');
  assert.equal(unreadCount([{ unread: true }, { unread: false }, null, { unread: true }]), 2);
});

test('r2.js asks a scoped resolver before the page-wide override and /sign-reads', () => {
  const r2 = src('./r2.js');
  const at = (needle) => { const i = r2.indexOf(needle); assert.ok(i > 0, needle); return i; };
  const signed = r2.slice(at('export function getSignedUrl('), at('export async function resolveSrc('));
  assert.ok(signed.indexOf('prefixResolverFor(key)') < signed.indexOf('if (_override)'), 'scoped first in getSignedUrl');
  const cached = r2.slice(at('export function cachedUrl('));
  assert.ok(cached.indexOf('prefixResolverFor(key)') < cached.indexOf('if (_override)'), 'scoped first in cachedUrl');
  assert.match(r2, /export async function getDownloadUrl\(key, filename\) \{\n  if \(!key \|\| typeof key !== 'string' \|\| !filename \|\| _override \|\| prefixResolverFor\(key\)\) return null;/);
  assert.match(r2, /const scoped = prefixResolverFor\(key\);\n  if \(scoped\) \{ try \{ scoped\.onAuthError\?\.\(key\); \} catch \(_\) \{\} return; \}/);
  const urls = src('./fileShareUrls.js');
  assert.match(urls, /setPrefixResolver\(FS_PREFIX, \{/);
  assert.match(urls, /onAuthError\(key\) \{/);
});

test('the /f/ page reads its media through the scoped resolver, not a page-wide one', () => {
  const page = src('../components/fileShare/FileSharePage.jsx');
  assert.doesNotMatch(page, /setReadUrlResolver|clearReadUrlResolver/);
  assert.match(page, /rememberShare\(token, r\);/);
  assert.match(page, /const SRC = fsRef\(token, 'src'\);/);
  // Inside the app: a dialog over the app that stands down under anything above it.
  assert.match(page, /role="dialog" aria-modal="true" aria-label=\{label\}/);
  assert.match(page, /modalGuard\.isTopModal && !modalGuard\.isTopModal\(modalRef\.current\)/);
  assert.match(page, /else if \(name === 'escape' && overlay\) onCloseRef\.current\?\.\(\);/, 'the player hands Escape on');
  // A signed-in open is marked, once.
  assert.match(page, /if \(r\.signed_in && !markedRef\.current\) \{\s+markedRef\.current = true;\s+Promise\.resolve\(api\.markFileShareOpened\?\.\(token\)\)/);
  // The page offers the app only behind the Shared page's hold.
  assert.match(page, /const openInApp = !overlay && signedIn && sharedFilesAllowed\(\) \?/);
  assert.match(page, /\{!signedIn && !overlay && \(\s+<footer className="fsp-cta">/);
});

test('the Shared page, the in-app viewer and the sidebar row sit behind sharedFilesAllowed', () => {
  const host = src('./appHost.js');
  assert.match(host, /export function sharedFilesAllowed\(\) \{\n  return import\.meta\.env\.DEV \|\| onPreviewHost\(\);\n\}/);
  const app = src('../App.jsx');
  assert.match(app, /\{sharedFilesAllowed\(\) && <SharedFileHost onSaveCopy=\{saveSharedCopy\} onAddShortcut=\{addSharedShortcut\} \/>\}/);
  assert.match(app, /\) : currentSurface === 'shared' && sharedFilesAllowed\(\) \? \(/);
  assert.match(app, /const sharedFiles = useSharedFiles\(\{ enabled: sharedFilesAllowed\(\) \}\);/);
  assert.match(app, /const sharedFilesRow = sharedFilesAllowed\(\) && /);
  assert.equal(app.match(/filesRow=\{sharedFilesRow\}/g)?.length, 2, 'both sidebars');
  // Save a copy checks your own card limit first, and a full drive is the storage wall.
  const save = app.slice(app.indexOf('const saveSharedCopy = useCallback('), app.indexOf('const saveSharedCopy = useCallback(') + 3500);
  assert.match(save, /if \(Number\(mt\.demoCardCount\) >= limit\) \{ pitchCapWall\(/);
  assert.match(save, /if \(out\.reason === 'over_quota'\)/);
  assert.match(save, /appendCards\(\{ boardId: dest\.id, cards: \[out\.card\] \}\)/);
});

test('the Shared page’s menus and undo are the app’s', () => {
  const page = src('../components/shared/SharedPage.jsx');
  assert.match(page, /\{ id: 'hide', label: 'Remove from Shared with me'/);
  assert.match(page, /\{ id: 'stop', label: 'Stop sharing', danger: true/);
  assert.match(page, /label: 'Undo'/);
  assert.match(page, /undoStopFileShare\(row\.board_id, row\.card_id,\s+\{ linkAccess: data\.link_access, stoppedAt: data\.stopped_at \}\)/);
  assert.match(page, /item\.allow_download && SAVEABLE\.has\(item\.kind\)/, 'Save a copy only where downloading is allowed');
  const css = src('../components/shared/sharedPage.css');
  const dot = css.match(/\.shp-dot \{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(dot, /soleil/, 'the unread dot is not gold');
});
