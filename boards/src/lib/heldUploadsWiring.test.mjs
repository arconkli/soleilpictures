// heldUploadsWiring.test.mjs — a drop that did not fit is kept and goes on when
// there is room (lib/heldUploads.js). The store is tested on its own in
// heldUploads.test.mjs; this pins the wiring around it, source-level, because
// the drop paths live in App.jsx and CanvasSurface.jsx, which ?local=1 never
// runs as a signed-in owner — and a hold that silently stopped happening would
// look exactly like the old behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const app = read('../App.jsx');
const canvas = read('../components/CanvasSurface.jsx');
const checkout = read('./checkout.js');
const success = read('../auth/PricingSuccess.jsx');
const sheet = read('../components/StorageAddonSheet.jsx');
const hook = read('../hooks/useHeldUploads.js');

function region(src, from, until) {
  const a = src.indexOf(from);
  assert.ok(a > -1, `not found: ${from}`);
  const b = src.indexOf(until, a + from.length);
  assert.ok(b > a, `no end after: ${from}`);
  return src.slice(a, b);
}

test('the preflight offers a hold only on the person\'s own plan, and Cancel never holds', () => {
  const pre = region(app, 'const preflightImportOnce = async', 'const addCard = (');
  assert.match(pre, /const holdFor = \(limit, quota = null\) => \(cs\.own\s*\?/, 'a hold is for the owner alone');
  // Every refusal and every question carries it: drive full, drive partial,
  // cards blocked, cards partial.
  assert.equal((pre.match(/hold: holdFor\('storage', drive\.quota\)/g) || []).length, 2);
  assert.equal((pre.match(/hold: holdFor\('cards', drive\?\.quota\)/g) || []).length, 2);
  const answer = region(app, 'const answerImportAsk = useCallback(', '}, []);');
  assert.match(answer, /ask\.resolve\?\.\(\{ take, hold: action === 'cancel' \? null : \(ask\.hold \|\| null\) \}\)/);
  // A held upgrade does not also tell the return to ask for the files again.
  assert.match(answer, /if \(!ask\.hold\) notePendingImport\(\{ n: ask\.n \}\)/);
});

test('one import question at a time, app-wide', () => {
  const pre = region(app, 'const preflightImport = async (args = {}) => {', 'const preflightImportOnce = async');
  assert.match(pre, /importAskQueueRef\.current = new Promise/);
  assert.match(pre, /await before;\s*return await preflightImportOnce\(args\);\s*\} finally \{ done\(\); \}/,
    'the next question waits for this one, and a throw still lets it go');
  assert.match(app, /const importAskQueueRef = useRef\(Promise\.resolve\(\)\);/);
});

test('the canvas keeps what did not fit, and a file the drive refused mid-upload', () => {
  const ingest = region(canvas, 'const ingestFiles = useCallback(async (fileList, cx, cy', 'ingestFilesRef.current = ingestFiles;');
  const hold = ingest.indexOf("holdDrop({\n          boardId: board.id, via: 'canvas'");
  const splice = ingest.indexOf('if (keep < classified) accepted.splice(keep);');
  assert.ok(hold > 0 && splice > hold, 'the tail is held before it is cut off');
  assert.match(ingest, /files: accepted\.slice\(keep\)\.map\(\(it\) => it\.file\)/);
  // A release never lands on what is already there.
  assert.match(ingest, /if \(source === 'held' && rects\.length\) \{[\s\S]*nearestFreeSpot\(solid/);
  const reject = region(canvas, 'const handleUploadReject = useCallback(', "} else if (err?.code === 403) {");
  assert.match(reject, /if \(ownsWorkspace && retry\?\.file && dropBoardId\) \{[\s\S]*holdDrop\(\{[\s\S]*limit: 'storage', files: \[retry\.file\]/);
  assert.match(reject, /storageRoom\(dropBoardId\)\.then\(\(r\) => setHeldBaseline\(held, r\?\.quota\)\)/,
    'a hold with no drive size takes one at once, so a block added right after still releases it');
  // The plan as known — null while it loads, never a guessed 'demo', which a
  // loaded 'paid' would read as an upgrade and release into the same wall.
  assert.match(reject, /at: \{ x: retry\.cx, y: retry\.cy \}, tier: planTier,/);
  assert.match(app, /files: \[it\.file\], tier: \(myTierRef\.current \|\| myTier\)\.tier \|\| null \}\);/);
});

test('the canvas claims its own cluster\'s holds and puts them back through the drop', () => {
  const claim = region(canvas, 'const heldEnvRef = useRef(null);', 'const off = subscribeHeld(later);');
  assert.match(claim, /claimReady\(\{ boardId, via: 'canvas' \}\)/);
  assert.match(claim, /ingestFilesRef\.current\?\.\(files, p\?\.x \?\? 200, p\?\.y \?\? 200, 'held'\)/);
  assert.match(claim, /claimReady\(\{ boardId, via: 'folder' \}\)/);
  assert.match(claim, /const env = heldEnvRef\.current;\s*\(async \(\) => \{\s*for \(let i = 0; i < folders\.length; i\+\+\) \{/,
    'one folder at a time, with the mutators of the cluster they were claimed for');
  assert.match(claim, /if \(boardIdRef\.current !== boardId \|\| !env\?\.onImportFolder\) \{\s*\/\/[^\n]*\n\s*restoreHeld\(folders\.slice\(i\)\);/,
    'the canvas moved on: the rest go back, released, instead of into another cluster');
  assert.match(claim, /await env\.onImportFolder\(\{\s*walked: e\.folder\?\.walked/);
  assert.doesNotMatch(claim, /out\.loose/, 'a folder\'s loose files went on when it was dropped');
});

test('the canvas claims nothing until its cluster\'s doc is live', () => {
  assert.match(canvas, /const heldReady = Boolean\(boardReady && mutators\?\.addCard && mutators\?\.preflightImport && !mutators\?\.captureGuarded\);/,
    'Capture Mode\'s guarded mutators refuse every add: a claim through them loses the files');
  const effect = region(canvas, 'const heldReady = Boolean(', '}, [board?.id, useLocalImages, clientToCanvas, heldReady, mutators]);');
  assert.match(effect, /if \(!boardId \|\| useLocalImages \|\| !heldReady\) return undefined;/);
  // App's claimers likewise wait for the board surface, and the bar names
  // a cluster as open only while it is.
  assert.match(app, /if \(currentSurface !== 'board'\) return undefined;\s*const panes = \[/);
  assert.match(app, /openBoardIds=\{currentSurface === 'board' \? \[currentId, splitId\] : \[\]\}/);
});

test('the list drop holds its tail and its refused files; a folder is held only whole', () => {
  const list = region(app, 'const ingestFilesArranged = async (fileList) => {', 'const addNewBoard = async');
  assert.match(list, /if \(keep < nClassified && hold\) \{\s*holdDrop\(\{ boardId, via: 'list', limit: hold\.limit, files: accepted\.slice\(keep\)/);
  assert.match(list, /if \(csFiles\.own && it\.file\) \{\s*const held = holdDrop\(\{ boardId, via: 'list', limit: 'storage', files: \[it\.file\]/);
  const folder = region(app, 'const importFolderOnce = useCallback(async ({', 'const nodes = slicePlan(');
  assert.match(folder, /const walked = walkedBefore \|\| \(entries \? await walkEntries\(entries\)/, 'a release hands back the tree, not the drop event');
  assert.match(folder, /if \(!\(Number\(take\) > 0\) && hold\) \{\s*holdDrop\(\{[\s\S]*via: 'folder'/);
});

test('App claims list drops, and a full-Files cluster\'s canvas drops, and mounts the watcher and the bar', () => {
  const claim = region(app, 'useHeldUploads({ tier: myTier.tier, refetchTier: myTier.refetch, userId: user?.id });', 'const off = subscribeHeld(later);');
  assert.match(claim, /\[currentId, mainMutators, mainFilesMode === 'full'\]/);
  assert.match(claim, /claimReady\(\{ boardId: bid, via: 'list' \}\)/);
  assert.match(claim, /\.\.\.\(filesOnly \? claimReady\(\{ boardId: bid, via: 'canvas' \}\) : \[\]\)/);
  assert.match(app, /<HeldUploadsBar\s/);
});

test('Checkout opens in a new tab while files are held, before the first await', () => {
  const fn = region(checkout, 'export async function startCheckout(', '\n}\n');
  const tab = fn.indexOf('const tab = holding ? openCheckoutTab() : null;');
  const firstAwait = fn.indexOf('await ');
  assert.ok(tab > 0 && tab < firstAwait, 'a browser opens a tab only inside the click that asked for it');
  assert.ok(fn.indexOf('if (holding) noteCheckoutStart(') < tab, 'the trial note is copied into the new tab, so it is written first');
  assert.match(fn, /if \(tab\) \{[\s\S]*?if \(tab\.closed\) return \{ tab: true \};\s*tab\.location\.href = body\.url;[\s\S]*?noteAwaitingPayment\(Date\.now\(\), AWAIT_PAYMENT_MS, tab\);\s*return \{ tab: true \};/,
    'the wait is tied to the checkout tab, so closing it ends the wait');
  // The app keeps its page through a checkout in the system browser.
  assert.match(fn, /if \(holding && inNativeApp\(\)\) \{[\s\S]*?noteAwaitingPayment\(\);\s*window\.location\.assign\(body\.url\);\s*return \{ tab: true \};/);
  // Where no tab could open, the files are let go before the page leaves, and
  // the return asks for them again.
  assert.match(fn, /if \(holding\) \{\s*const n = letGoHeld\(\);\s*if \(body\.mode !== 'portal'\) notePendingImport\(\{ n \}\);\s*\}\s*window\.location\.assign\(body\.url\);/);
  assert.match(fn, /tab\?\.close\(\)/, 'a failed checkout closes the blank tab it opened');
});

test('the success page asks for the holding tab before it sends this one into the app', () => {
  const effect = region(success, 'if (!celebrating) return undefined;', '}, [celebrating]);');
  const ask = effect.indexOf('askForHolder()');
  const redirect = effect.indexOf("window.location.assign('/')");
  assert.ok(ask > 0 && redirect > ask, 'asked first');
  assert.match(effect, /if \(n > 0\) \{ setHeldElsewhere\(n\); return; \}/);
});

test('a block added in the sheet tells held drops to look, and a bank page makes them wait', () => {
  const confirm = region(sheet, 'const confirm = async () => {', 'onClose?.();\n  };');
  assert.match(confirm, /else announceBillingChange\('storage'\);/);
  assert.match(confirm, /setPhase\('pay'\);[\s\S]*noteAwaitingPayment\(\);/);
});

test('the watcher reads the drive per cluster, never releases on an unset baseline, and guards the tab', () => {
  assert.match(hook, /quotas\.set\(id, \(await storageRoom\(id\)\)\?\.quota \?\? null\)/);
  assert.match(hook, /if \(e\.limit === 'storage' && e\.quotaAtHold == null && quota != null\) setHeldBaseline\(e\.id, quota\);/);
  assert.match(hook, /window\.addEventListener\('beforeunload', guard\)/);
  assert.match(hook, /window\.removeEventListener\('beforeunload', guard\)/);
  assert.match(hook, /if \(!hasHeld\(\)\) return undefined;/, 'the guard only stands while something is held');
});

test('a canceled checkout stops the wait; a new build does not reload the files away', () => {
  assert.match(app, /'Checkout canceled\. Nothing was charged\.' \}\);\s*\n(\s*\/\/[^\n]*\n)*\s*announceBillingChange\('canceled'\);/);
  assert.match(hook, /if \(msg\?\.kind === 'canceled'\) \{ clearAwaitingPayment\(\); return; \}/);
  assert.match(hook, /if \(hasHeld\(\) && !releaseReload\) releaseReload = holdReload\(\);/);
});

test('a released folder waits for a running import instead of being refused and lost', () => {
  const fn = region(app, 'const importFolder = useCallback(async (args = {}) => {', '}, [importFolderOnce, feedback, startBulkImportHere]);');
  // Behind its gate the bulk import takes every folder but one held by this
  // old path, which goes back the way it came.
  assert.match(fn, /if \(bulkImportAllowed\(\) && args\.source !== 'held'\) return startBulkImportHere\(args\);/);
  assert.ok(fn.indexOf('startBulkImportHere(args)') < fn.indexOf('while (folderImportBusyRef'), 'before the old path\'s wait');
  assert.match(fn, /while \(folderImportBusyRef\.current && args\.source === 'held'\) await folderImportIdleRef\.current;/);
  assert.ok(fn.indexOf("args.source === 'held'") < fn.indexOf('A folder is still importing'), 'it waits before the refusal');
  assert.match(fn, /finally \{ folderImportBusyRef\.current = false; idle\(\); \}/);
});
