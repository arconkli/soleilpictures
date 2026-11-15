// modalGuardHistory.test.mjs — Back and Forward between clusters, and the
// layers on top of them, against a fake browser history.
//
//   node --test src/lib/modalGuardHistory.test.mjs
//
// The fake is an entries array and an index. pushState and replaceState are
// synchronous; go(n) moves the index and fires popstate on a LATER TASK, as
// browsers do, so a write made right after go() runs before its popstate.
// The app side is the few lines of App.jsx's recordNav / reconcile that
// matter here: a list of entries with ids, and an index.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerBackLayer, pushNavEntry, stampNavEntry, setCurrentNav, setNavHandler,
  newNavId, backLayerDepth, __resetModalGuardForTests,
} from './modalGuard.js';

function fakeBrowser() {
  const listeners = {};
  const entries = [{ state: null, url: 'https://x.test/' }];
  let idx = 0;
  const location = { get href() { return entries[idx].url; } };
  const history = {
    get state() { return entries[idx].state; },
    get length() { return entries.length; },
    pushState(state, _t, url) { entries.splice(idx + 1); entries.push({ state, url: url || entries[idx].url }); idx += 1; },
    replaceState(state, _t, url) { entries[idx] = { state, url: url || entries[idx].url }; },
    go(n) {
      const to = idx + n;
      if (to < 0 || to >= entries.length || n === 0) return;
      setTimeout(() => { idx = to; (listeners.popstate || []).forEach(f => f({})); }, 0);
    },
    back() { this.go(-1); },
    forward() { this.go(1); },
  };
  globalThis.window = {
    history, location,
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
  };
  return {
    entries, history,
    get idx() { return idx; },
    get state() { return entries[idx].state; },
    back: () => history.back(), forward: () => history.forward(),
    // What sits in history, bottom to top: 'nav' or 'layer' per entry.
    kinds: () => entries.map(e => (e.state?.soleilLayer ? 'layer' : 'nav')),
  };
}

// App.jsx in miniature: one in-app history for one workspace.
function fakeApp() {
  const h = { entries: [], index: -1 };
  const app = {
    h,
    get here() { return h.entries[h.index]?.name; },
    open(name) {
      h.entries = h.entries.slice(0, h.index + 1);
      const entry = { id: newNavId(), name };
      h.entries.push(entry);
      h.index = h.entries.length - 1;
      if (h.entries.length === 1) stampNavEntry(entry.id);
      else pushNavEntry(entry.id);
      return entry.id;
    },
    cuts: 0,
    mount() {
      setNavHandler((id) => {
        const i = id == null ? -1 : h.entries.findIndex(e => e.id === id);
        if (i < 0) {
          const cur = h.entries[h.index]?.id;
          if (cur != null) stampNavEntry(cur);
          return;
        }
        if (i === h.index) return;
        h.index = i;
        setCurrentNav(id);
      }, () => { app.cuts += 1; h.entries = h.entries.slice(0, h.index + 1); });
    },
  };
  app.mount();
  return app;
}

// Enough turns for a go(), its popstate, a queued write and a second go().
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => { __resetModalGuardForTests(); });
afterEach(() => { delete globalThis.window; });

test('a mouse (no current id) writes no soleilNav', async () => {
  const b = fakeBrowser();
  const off = registerBackLayer(() => {});
  await settle();
  assert.equal(b.entries.length, 2);
  assert.equal('soleilNav' in b.entries[1].state, false);
  off();
  await settle();
  assert.equal(b.idx, 0);
  assert.equal(b.entries[0].state, null, 'the entry it started on is untouched');
});

test('opening clusters adds one entry each, and Back then Forward walk them', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  const home = app.open('home');
  assert.equal(b.entries.length, 1, 'the first place is stamped, not pushed');
  assert.equal(b.state.soleilNav, home);
  const a = app.open('A');
  const bb = app.open('B');
  await settle();
  assert.deepEqual(b.entries.map(e => e.state.soleilNav), [home, a, bb]);
  b.back(); await settle();
  assert.equal(app.here, 'A');
  b.back(); await settle();
  assert.equal(app.here, 'home');
  assert.equal(b.entries.length, 3, 'moving through history writes nothing');
  b.forward(); await settle();
  assert.equal(app.here, 'A');
  b.forward(); await settle();
  assert.equal(app.here, 'B');
});

test('a nav push while a self-back is scheduled waits for it to land', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  const closed = [];
  const off = registerBackLayer(() => closed.push('drawer'));
  await settle();
  assert.deepEqual(b.kinds(), ['nav', 'layer']);
  // The drawer closes (its go(-1) is only scheduled), then the cluster opens.
  off();
  const y = app.open('Y');
  await settle();
  assert.deepEqual(b.kinds(), ['nav', 'nav'], 'the layer entry is gone and Y sits on X');
  assert.equal(b.idx, 1);
  assert.equal(b.state.soleilNav, y);
  assert.deepEqual(closed, [], 'the traversal we caused is not a Back');
  b.back(); await settle();
  assert.equal(app.here, 'X');
});

test('a nav push while a self-back is in flight waits for it to land', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  const off = registerBackLayer(() => {});
  await settle();
  off();
  await Promise.resolve();          // history.go(-1) issued, popstate not yet fired
  assert.equal(b.idx, 1, 'still on the layer entry');
  const y = app.open('Y');
  assert.equal(b.entries.length, 2, 'nothing pushed under the traversal');
  await settle();
  assert.deepEqual(b.kinds(), ['nav', 'nav']);
  assert.equal(b.state.soleilNav, y);
  assert.equal(b.idx, 1);
});

test('a layer that closes AFTER the navigation it caused: the nav closes it', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  const closed = [];
  let off = null;
  off = registerBackLayer(() => { closed.push('search'); off(); });
  await settle();
  // React commits the navigation first; the sheet's own close comes later.
  const y = app.open('Y');
  off();
  await settle();
  assert.deepEqual(closed, ['search'], 'closed once, by the navigation');
  assert.deepEqual(b.kinds(), ['nav', 'nav']);
  assert.equal(b.state.soleilNav, y);
  b.back(); await settle();
  assert.equal(app.here, 'X', 'Back returns to where Search was opened');
  assert.equal(b.idx, 0);
});

test('two layers open when a cluster opens: both close, one traversal', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  const closed = [];
  registerBackLayer(() => closed.push('drawer'));
  registerBackLayer(() => closed.push('menu'));
  await settle();
  assert.deepEqual(b.kinds(), ['nav', 'layer', 'layer']);
  app.open('Y');
  await settle();
  assert.deepEqual(closed, ['menu', 'drawer'], 'top first');
  assert.deepEqual(b.kinds(), ['nav', 'nav']);
  assert.equal(b.idx, 1);
});

test('a dialog opened by the same tap as the cluster stays open, on top of it', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  const closed = [];
  registerBackLayer(() => closed.push('dialog'));   // registered, not yet pushed
  const y = app.open('Y');
  await settle();
  assert.deepEqual(closed, []);
  assert.deepEqual(b.kinds(), ['nav', 'nav', 'layer']);
  assert.equal(b.state.soleilNav, y, 'the layer entry knows which cluster it is on');
  b.back(); await settle();
  assert.deepEqual(closed, ['dialog']);
  assert.equal(app.here, 'Y');
});

test('Back over a layer closes it and stays; Back again goes to the cluster before', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  app.open('Y');
  const closed = [];
  registerBackLayer(() => closed.push('share'));
  await settle();
  b.back(); await settle();
  assert.deepEqual(closed, ['share']);
  assert.equal(app.here, 'Y', 'the same cluster is still on screen');
  b.back(); await settle();
  assert.equal(app.here, 'X');
  assert.equal(b.idx, 0);
});

test('a layer closed by its own button leaves no dead entry', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  app.open('Y');
  const off = registerBackLayer(() => {});
  await settle();
  off();
  await settle();
  assert.equal(b.idx, 1);
  b.back(); await settle();
  assert.equal(app.here, 'X');
});

test('a menu row that opens a dialog leaves exactly one layer entry on top', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  app.open('Y');
  const closed = [];
  const offMenu = registerBackLayer(() => closed.push('menu'));
  await settle();
  // The row closes the menu and opens Share in the same commit.
  offMenu();
  registerBackLayer(() => closed.push('share'));
  await settle();
  assert.deepEqual(b.kinds(), ['nav', 'nav', 'layer']);
  assert.equal(b.idx, 2, 'the dialog entry is the current one');
  b.back(); await settle();
  assert.deepEqual(closed, ['share'], 'Back closes the dialog only');
  assert.equal(app.here, 'Y');
  b.back(); await settle();
  assert.equal(app.here, 'X');
});

test('StrictMode register, unregister, register leaves one layer entry', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  const x = app.open('X');
  const closed = [];
  const off = registerBackLayer(() => closed.push('first'));
  off();
  registerBackLayer(() => closed.push('second'));
  await settle();
  assert.deepEqual(b.kinds(), ['nav', 'layer']);
  assert.equal(b.state.soleilNav, x);
  b.back(); await settle();
  assert.deepEqual(closed, ['second']);
  assert.equal(b.idx, 0);
});

test('a silent move updates the id the next layer entry carries', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  const x = app.open('X');
  app.open('Y');
  await settle();
  b.back(); await settle();
  assert.equal(app.here, 'X');
  registerBackLayer(() => {});
  await settle();
  assert.equal(b.state.soleilNav, x);
  assert.equal(app.cuts, 1, 'the push dropped Forward, and App was told');
  assert.equal(app.h.entries.length, 1);
});

test('a workspace switch: old entries never move the new workspace', async () => {
  const b = fakeBrowser();
  const one = fakeApp();
  one.open('X');
  one.open('Y');
  await settle();
  // Workspace unmounts; the new one mounts with an empty in-app history.
  setNavHandler(null); setCurrentNav(null);
  const two = fakeApp();
  const p = two.open('P');
  await settle();
  assert.equal(b.entries.length, 2, 'the switch stamps the entry it is on');
  assert.equal(b.state.soleilNav, p);
  const q = two.open('Q');
  await settle();
  b.back(); await settle();
  assert.equal(two.here, 'P');
  b.back(); await settle();           // lands on workspace one's X
  assert.equal(two.here, 'P', 'an id from another workspace stays put');
  assert.equal(one.here, 'Y', 'and the old history is not consulted');
  b.forward(); await settle();
  b.forward(); await settle();
  assert.equal(two.here, 'Q');
  assert.equal(b.state.soleilNav, q);
});

test('an entry with no id (written before the app) stays put', async () => {
  const b = fakeBrowser();
  b.history.pushState(null, '', 'https://x.test/');   // some earlier same-page entry
  const app = fakeApp();
  app.open('X');
  app.open('Y');
  await settle();
  b.back(); await settle();
  b.back(); await settle();
  assert.equal(b.idx, 0);
  assert.equal(app.here, 'X');
});

test('after landing on another workspace\'s entry, the next place opened goes Back to the place before', async () => {
  const b = fakeBrowser();
  const one = fakeApp();
  one.open('X');
  one.open('Y');
  await settle();
  setNavHandler(null); setCurrentNav(null);
  const two = fakeApp();
  const p = two.open('P');
  two.open('Q');
  await settle();
  b.back(); await settle();
  b.back(); await settle();           // workspace one's X: stay on P
  assert.equal(two.here, 'P');
  assert.equal(b.idx, 0);
  assert.equal(b.state.soleilNav, p, 'the entry landed on now stands for P');
  two.open('R');
  await settle();
  assert.equal(two.here, 'R');
  b.back(); await settle();
  assert.equal(two.here, 'P');
});

test('after landing on an entry with no id, the next place opened goes Back to the place before', async () => {
  const b = fakeBrowser();
  b.history.pushState(null, '', 'https://x.test/');
  const app = fakeApp();
  const x = app.open('X');
  app.open('Y');
  await settle();
  b.back(); await settle();
  b.back(); await settle();           // the entry from before the app: stay on X
  assert.equal(app.here, 'X');
  assert.equal(b.state.soleilNav, x);
  app.open('Z');
  await settle();
  assert.equal(app.here, 'Z');
  b.back(); await settle();
  assert.equal(app.here, 'X');
});

test('backLayerDepth counts the layers whose entries are in history', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  app.open('X');
  app.open('Y');
  const closed = [];
  assert.equal(backLayerDepth(), 0);
  registerBackLayer(() => closed.push('messages'));
  assert.equal(backLayerDepth(), 0, 'registered, not yet pushed');
  await settle();
  assert.equal(backLayerDepth(), 1);
  // The toolbar's Back: over the panel's entry and one more.
  b.history.go(-(1 + backLayerDepth())); await settle();
  assert.deepEqual(closed, ['messages']);
  assert.equal(app.here, 'X');
  assert.equal(backLayerDepth(), 0);
});

test('a URL the app rewrote survives the self-back, and the landed entry keeps its state', async () => {
  const b = fakeBrowser();
  const app = fakeApp();
  const x = app.open('X');
  const off = registerBackLayer(() => {});
  await settle();
  b.history.replaceState(b.history.state, '', 'https://x.test/?to=1');
  off();
  await settle();
  assert.equal(b.idx, 0);
  assert.equal(b.entries[0].url, 'https://x.test/?to=1');
  assert.equal(b.entries[0].state.soleilNav, x);
  assert.equal('soleilLayer' in b.entries[0].state, false);
});
