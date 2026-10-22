// whatsNew — the one-time "New" hint on the Files card for accounts that were
// here before the files sidebar. The words, who gets it, what it records and
// where it sits are pure (lib/whatsNew.js); how it is wired is pinned from the
// source (the component imports JSX and import.meta.env, which node --test
// cannot load).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WHATS_NEW_HINT, WHATS_NEW_KEY, WHATS_NEW_ACTIONS, CHANGELOG_PATH, WHATS_NEW_ANCHORS, CLUSTER_TAB,
  predatesFilesSidebar, whatsNewEligible, whatsNewCopy, whatsNewRecord, whatsNewWidth, whatsNewPlace,
} from './whatsNew.js';
import { SETUP_EPOCH } from './workspaceSetup.js';
import { tipsEligible } from './setupTips.js';
import { EV, WORK_EVENTS } from './analyticsEvents.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const BEFORE = new Date(Date.parse(SETUP_EPOCH) - 86_400_000).toISOString();

test('an account from before the files sidebar gets it; a newer one gets the setup tips instead', () => {
  assert.equal(whatsNewEligible({ createdAt: BEFORE }), true);
  assert.equal(whatsNewEligible({ createdAt: SETUP_EPOCH }), false);
  // Nobody gets both, and nobody falls between them.
  for (const createdAt of [BEFORE, SETUP_EPOCH, '2026-12-01T00:00:00Z']) {
    assert.notEqual(whatsNewEligible({ createdAt }), tipsEligible({ allowed: true, createdAt }), createdAt);
  }
});

test('App asks only the account’s age before loading it, an answer that never changes mid-show', () => {
  assert.equal(predatesFilesSidebar(BEFORE), true);
  assert.equal(predatesFilesSidebar(SETUP_EPOCH), false);
  assert.equal(predatesFilesSidebar(undefined), false);
  // Whoever it loads for, the rest is the component's to check.
  assert.equal(whatsNewEligible({ createdAt: BEFORE }), predatesFilesSidebar(BEFORE));
});

test('a record on the profile or a mark on this device means it has been shown', () => {
  assert.equal(whatsNewEligible({ createdAt: BEFORE, record: { v: 1, hint: 'files_card', action: 'shown' } }), false);
  assert.equal(whatsNewEligible({ createdAt: BEFORE, seenHere: true }), false);
  assert.equal(whatsNewEligible({ createdAt: 'not a date' }), false);
  assert.equal(whatsNewEligible({}), false);
});

// The owner, 2026-10-21: it says there has been a visual refresh, and that
// any file can be uploaded and kept in Files.
test('the words say the look is new and Files keeps any file, naming the cluster it is showing', () => {
  assert.deepEqual(whatsNewCopy({ phone: false, cluster: 'Feature film' }), {
    eyebrow: 'New',
    title: 'A visual refresh, and a home for your files',
    body: 'Upload any file and it stays here in Files, whether it’s on a board or not. This lists every file in Feature film. Search it, or open it as a full page.',
    link: 'What else is new',
    ok: 'Got it',
  });
  assert.equal(whatsNewCopy({ phone: true, cluster: 'Feature film' }).body,
    'Upload any file and it stays here in Files. Search it, or open it as a full page.');
  assert.match(whatsNewCopy({ cluster: '   ' }).body, / This lists every file in Untitled\. /);
  assert.equal(CHANGELOG_PATH, '/changelog');
});

test('the record carries the hint’s name and what happened, nothing else', () => {
  const at = '2026-10-22T20:00:00.000Z';
  assert.deepEqual(whatsNewRecord({ action: 'dismissed', now: at }), { v: 1, hint: 'files_card', action: 'dismissed', at });
  assert.equal(whatsNewRecord({ action: 'pressed', now: at }).action, null);
  assert.deepEqual([...WHATS_NEW_ACTIONS], ['shown', 'dismissed', 'changelog']);
  assert.equal(WHATS_NEW_HINT, 'files_card');
  assert.equal(WHATS_NEW_KEY, 'whats_new_files_card');
});

test('its event is a named EV constant, and reading about the product is not work', () => {
  assert.equal(EV.WHATS_NEW_HINT, 'whats_new_hint');
  assert.equal(WORK_EVENTS.has(EV.WHATS_NEW_HINT), false);
});

test('as wide as the mockup on a computer; the drawer’s width less its inset on a phone', () => {
  assert.equal(whatsNewWidth({ phone: false, vw: 1440 }), 300);
  assert.equal(whatsNewWidth({ phone: false, vw: 300 }), 280);
  assert.equal(whatsNewWidth({ phone: true, frame: { width: 320 }, vw: 390 }), 304);
  assert.equal(whatsNewWidth({ phone: true, frame: null, vw: 430 }), 360);
});

// The desktop mockup: the sidebar's frame ends at 320, the Files heading's
// middle is at 410, and the hint sits at 332, 393 with its tail 17px down.
const HEADING = { left: 20, right: 300, top: 395, bottom: 425, width: 280, height: 30 };
const FRAME = { left: 8, right: 320, top: 8, bottom: 892, width: 312, height: 884 };
const POP = { width: 300, height: 130 };

test('on a computer it sits beside the sidebar, its tail on the Files heading', () => {
  assert.deepEqual(whatsNewPlace({ anchor: HEADING, pop: POP, frame: FRAME, vw: 1440, vh: 900 }),
    { side: 'right', left: 332, top: 393, tail: 17 });
});

test('low in the window it stays inside it, and the tail still finds the heading', () => {
  const low = { ...HEADING, top: 850, bottom: 880 };
  const at = whatsNewPlace({ anchor: low, pop: POP, frame: FRAME, vw: 1440, vh: 900 });
  assert.equal(at.top, 900 - 130 - 10);
  assert.equal(at.tail, 865 - at.top);
});

test('with no room beside the sidebar it hangs under the heading', () => {
  const at = whatsNewPlace({ anchor: HEADING, pop: POP, frame: FRAME, vw: 600, vh: 900 });
  assert.equal(at.side, 'bottom');
  assert.equal(at.top, HEADING.bottom + 12);
  assert.equal(at.tail, HEADING.left + 40 - at.left);
});

// The phone mockup: the drawer is 320 wide and its Files header ends at 581;
// the hint sits 8px inside the drawer, 12px under the header, its tail on the
// cluster's tab.
const DRAWER = { left: 0, right: 320, top: 0, bottom: 844, width: 320, height: 844 };
const FILES_HEAD = { left: 25, right: 295, top: 545, bottom: 581, width: 270, height: 36 };
const PHONE_POP = { width: 304, height: 120 };

test('on a phone it hangs under the Files header inside the drawer', () => {
  assert.deepEqual(whatsNewPlace({ anchor: FILES_HEAD, pop: PHONE_POP, frame: DRAWER, vw: 390, vh: 844, phone: true }),
    { side: 'bottom', left: 8, top: 593, tail: 57 });
});

test('a header low in the drawer gets it above, never behind the bottom of the screen', () => {
  const low = { ...FILES_HEAD, top: 700, bottom: 736 };
  const at = whatsNewPlace({ anchor: low, pop: PHONE_POP, frame: DRAWER, vw: 390, vh: 844, phone: true });
  assert.equal(at.side, 'top');
  assert.equal(at.top, 700 - 12 - 120);
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('it points where the mockup does: the Files label on a computer, the cluster’s tab on a phone', () => {
  assert.deepEqual([...WHATS_NEW_ANCHORS.desk.anchors], ['.sbf-files-heading .sbf-files-heading-label', '.sbf-files-head']);
  assert.deepEqual([...WHATS_NEW_ANCHORS.phone.anchors], ['.sbf-files-head .sbf-tab.is-cluster', '.sbf-files-head']);
});

test('every class it looks for is one the sidebar draws, or it would never show', () => {
  const sidebar = src('../components/sidebar/ClusterSidebar.jsx');
  const app = src('../App.jsx');
  const selectors = [WHATS_NEW_ANCHORS.desk, WHATS_NEW_ANCHORS.phone]
    .flatMap((s) => [s.scope, ...s.anchors, s.frame]).concat(CLUSTER_TAB);
  const classes = new Set(selectors.join(' ').match(/\.[a-z][\w-]*/g).map((c) => c.slice(1)));
  for (const c of classes) {
    // The drawer itself is App's: <aside className={`sidebar${… ' is-mobile-open' …}`}>.
    const where = c === 'sidebar' || c === 'is-mobile-open' ? app : sidebar;
    assert.match(where, new RegExp(`[\\s"'\`]${c}[\\s"'\`$]`), c);
  }
});

test('App mounts it wherever the files sidebar is, and it keeps its own record', () => {
  const app = src('../App.jsx');
  assert.match(app, /const WhatsNewHint = lazyWithReload\(\(\) => import\('\.\/components\/whatsNew\/WhatsNewHint\.jsx'\)\);/);
  assert.match(app, /\{filesSidebar && user\?\.id && predatesFilesSidebar\(user\.created_at\) && \(\s*<Suspense fallback=\{null\}>\s*<WhatsNewHint\b/);
  assert.match(app, /save=\{\(rec\) => updateOwnSettings\(\{ \[WHATS_NEW_KEY\]: rec \}\)\}/);
});

test('it waits its turn: one hint, one moment, nothing over a dialog', () => {
  const c = src('../components/whatsNew/WhatsNewHint.jsx');
  assert.match(c, /claimHint\('whats_new'\)/);
  assert.match(c, /claimUpsellSlot\('whats-new'\)/);
  assert.match(c, /releaseHint\('whats_new'\)/);
  // The claims come before the device is marked, and the mark before it shows.
  const claim = c.indexOf("claimUpsellSlot('whats-new')");
  const mark = c.indexOf('setFlag(flagKey');
  const show = c.indexOf("setPhase('up')");
  assert.ok(claim > 0 && mark > claim && show > mark, 'claim, then mark, then show');
});

test('its event says only which hint and what happened, through EV', () => {
  const c = src('../components/whatsNew/WhatsNewHint.jsx');
  assert.doesNotMatch(c, /'whats_new_hint'/);
  const calls = c.match(/logEvent(?:Now)?\(EV\.WHATS_NEW_HINT, \{[^}]*\}\)/g) || [];
  assert.ok(calls.length >= 2, 'shown, and how it ended');
  for (const call of calls) assert.match(call, /\{ hint: WHATS_NEW_HINT, action(?:: '(?:shown|dismissed|changelog)')? \}/, call);
});
