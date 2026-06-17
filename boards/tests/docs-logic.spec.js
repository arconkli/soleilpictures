// Pure-logic tests for the doc data layer (boards/src/lib/docState.js), driven
// through the ?docqa=1 harness bridge (window.__soleilDocTest exposes the whole
// docState namespace + Y). Each test builds its OWN fresh Y.Doc inside
// page.evaluate for perfect isolation, and the important behaviours are run
// against BOTH a root scope and a card scope to prove the scope plumbing is
// identical. Deterministic — no UI, no waits.

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
});

const SCOPES = ['root', 'card'];

// ── Pages ────────────────────────────────────────────────────────────────────
for (const kind of SCOPES) {
  test(`[${kind}] addPage seeds defaults and readPages round-trips plain objects`, async ({ page }) => {
    const res = await page.evaluate((k) => {
      const T = window.__soleilDocTest;
      const ydoc = new T.Y.Doc();
      let scope;
      if (k === 'card') {
        const cardYMap = new T.Y.Map();
        ydoc.transact(() => { ydoc.getMap('cards').set('c1', cardYMap); }, 'local');
        T.initCardDocStore(ydoc, cardYMap);
        scope = { ...T.cardScope(cardYMap), cardId: 'c1', docCardId: 'c1' };
      }
      const id = T.addPage(ydoc, { name: 'Hello', scope });
      const pages = T.readPages(ydoc, scope);
      return { id, pages };
    }, kind);
    expect(res.pages).toHaveLength(1);
    expect(res.pages[0]).toMatchObject({ id: res.id, name: 'Hello', parent_id: null, order: 0 });
    // readPages must return plain objects (not Yjs proxies)
    expect(typeof res.pages[0]).toBe('object');
  });

  test(`[${kind}] child pages nest and order increments among siblings`, async ({ page }) => {
    const res = await page.evaluate((k) => {
      const T = window.__soleilDocTest;
      const ydoc = new T.Y.Doc();
      let scope;
      if (k === 'card') {
        const cardYMap = new T.Y.Map();
        ydoc.transact(() => { ydoc.getMap('cards').set('c1', cardYMap); }, 'local');
        T.initCardDocStore(ydoc, cardYMap);
        scope = { ...T.cardScope(cardYMap), cardId: 'c1', docCardId: 'c1' };
      }
      const root = T.addPage(ydoc, { name: 'Root', scope });
      const a = T.addPage(ydoc, { name: 'A', parent_id: root, scope });
      const b = T.addPage(ydoc, { name: 'B', parent_id: root, scope });
      const pages = T.readPages(ydoc, scope);
      const byId = Object.fromEntries(pages.map(p => [p.id, p]));
      return { root, a, b, orderA: byId[a].order, orderB: byId[b].order, parentA: byId[a].parent_id };
    }, kind);
    expect(res.parentA).toBe(res.root);
    expect(res.orderA).toBe(0);
    expect(res.orderB).toBe(1);
  });

  test(`[${kind}] renamePage persists; missing id is a no-op`, async ({ page }) => {
    const res = await page.evaluate((k) => {
      const T = window.__soleilDocTest;
      const ydoc = new T.Y.Doc();
      let scope;
      if (k === 'card') {
        const cardYMap = new T.Y.Map();
        ydoc.transact(() => { ydoc.getMap('cards').set('c1', cardYMap); }, 'local');
        T.initCardDocStore(ydoc, cardYMap);
        scope = { ...T.cardScope(cardYMap), cardId: 'c1', docCardId: 'c1' };
      }
      const id = T.addPage(ydoc, { name: 'Old', scope });
      T.renamePage(ydoc, id, 'New Name', scope);
      T.renamePage(ydoc, 'nope', 'X', scope); // no-op
      const pages = T.readPages(ydoc, scope);
      return { name: pages.find(p => p.id === id).name, count: pages.length };
    }, kind);
    expect(res.name).toBe('New Name');
    expect(res.count).toBe(1);
  });
}

test('setPageExpanded toggles the flag', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const id = T.addPage(ydoc, { name: 'P' });
    T.setPageExpanded(ydoc, id, false);
    const collapsed = T.readPages(ydoc).find(p => p.id === id).expanded;
    T.setPageExpanded(ydoc, id, true);
    const expanded = T.readPages(ydoc).find(p => p.id === id).expanded;
    return { collapsed, expanded };
  });
  expect(res.collapsed).toBe(false);
  expect(res.expanded).toBe(true);
});

test('movePage reorders within siblings', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const a = T.addPage(ydoc, { name: 'A' });
    const b = T.addPage(ydoc, { name: 'B' });
    const c = T.addPage(ydoc, { name: 'C' });
    // Move C to the front (index 0)
    T.movePage(ydoc, c, null, 0);
    const order = T.readPages(ydoc)
      .filter(p => p.parent_id == null)
      .sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
      .map(p => p.name);
    return { order };
  });
  expect(res.order).toEqual(['C', 'A', 'B']);
});

test('movePage nests under a new parent', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const a = T.addPage(ydoc, { name: 'A' });
    const b = T.addPage(ydoc, { name: 'B' });
    T.movePage(ydoc, b, a, 0); // nest B under A
    return { parentB: T.readPages(ydoc).find(p => p.name === 'B').parent_id, a };
  });
  expect(res.parentB).toBe(res.a);
});

test('movePage rejects creating a cycle (parent under its own descendant)', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const a = T.addPage(ydoc, { name: 'A' });
    const b = T.addPage(ydoc, { name: 'B', parent_id: a });
    T.movePage(ydoc, a, b, 0); // illegal: A under its child B
    return { parentA: T.readPages(ydoc).find(p => p.id === a).parent_id };
  });
  expect(res.parentA).toBeNull(); // unchanged
});

test('deletePage cascades to descendants and cleans up content/sheets/bookmarks/comments', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const a = T.addPage(ydoc, { name: 'A' });
    const b = T.addPage(ydoc, { name: 'B', parent_id: a });
    const c = T.addPage(ydoc, { name: 'C', parent_id: b }); // grandchild
    const other = T.addPage(ydoc, { name: 'Keep' });
    // attach a sheet, bookmark, comment to B so we can assert cleanup
    const sheet = T.addPageSheet(ydoc, b);
    T.addBookmark(ydoc, { name: 'bm', pageId: b, anchor: 1 });
    T.addCommentThread(ydoc, { pageId: b, body: 'note' });
    const contentMap = T.pageContentMap(ydoc);
    const sheetsMap = T.pageSheetsMap(ydoc);
    const sContent = T.sheetContentMap(ydoc);

    T.deletePage(ydoc, a); // should remove A, B, C; keep "Keep"

    const remaining = T.readPages(ydoc).map(p => p.name);
    return {
      remaining,
      contentAGone: !contentMap.get(a),
      contentBGone: !contentMap.get(b),
      sheetsBGone: !sheetsMap.get(b),
      sheetContentGone: !sContent.get(sheet),
      bookmarksLeft: T.readBookmarks(ydoc).length,
      commentsLeftForB: T.readComments(ydoc).filter(c => c.pageId === b).length,
    };
  });
  expect(res.remaining).toEqual(['Keep']);
  expect(res.contentAGone).toBe(true);
  expect(res.contentBGone).toBe(true);
  expect(res.sheetsBGone).toBe(true);
  expect(res.sheetContentGone).toBe(true);
  expect(res.bookmarksLeft).toBe(0);
  // Comment threads on deleted pages should not be orphaned.
  expect(res.commentsLeftForB).toBe(0);
});

test('buildPageTree assembles the hierarchy with sibling ordering', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const a = T.addPage(ydoc, { name: 'A' });
    const a1 = T.addPage(ydoc, { name: 'A1', parent_id: a });
    const a2 = T.addPage(ydoc, { name: 'A2', parent_id: a });
    const b = T.addPage(ydoc, { name: 'B' });
    const tree = T.buildPageTree(T.readPages(ydoc));
    return {
      roots: tree.map(n => n.name),
      aChildren: tree.find(n => n.name === 'A').children.map(c => c.name),
      bChildren: tree.find(n => n.name === 'B').children.length,
    };
  });
  expect(res.roots).toEqual(['A', 'B']);
  expect(res.aChildren).toEqual(['A1', 'A2']);
  expect(res.bChildren).toBe(0);
});

// ── Sheets ───────────────────────────────────────────────────────────────────
test('getPageSheetIds starts with the implicit primary (= pageId)', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const p = T.addPage(ydoc, { name: 'P' });
    return { ids: T.getPageSheetIds(ydoc, p), p };
  });
  expect(res.ids).toEqual([res.p]);
});

test('addPageSheet appends; afterSheetId inserts at the right index; primary is protected', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const p = T.addPage(ydoc, { name: 'P' });
    const s1 = T.addPageSheet(ydoc, p);                                  // [p, s1]
    const s2 = T.addPageSheet(ydoc, p);                                  // [p, s1, s2]
    const sMid = T.addPageSheet(ydoc, p, undefined, { afterSheetId: s1 }); // [p, s1, sMid, s2]
    const sFront = T.addPageSheet(ydoc, p, undefined, { afterSheetId: p }); // [p, sFront, s1, sMid, s2]
    const order = T.getPageSheetIds(ydoc, p);
    T.deletePageSheet(ydoc, p, p); // primary protected — no-op
    const afterPrimaryDelete = T.getPageSheetIds(ydoc, p).length;
    T.deletePageSheet(ydoc, p, s2); // remove a real sheet
    const afterRealDelete = T.getPageSheetIds(ydoc, p);
    return { order, p, s1, s2, sMid, sFront, afterPrimaryDelete, afterRealDelete };
  });
  expect(res.order).toEqual([res.p, res.sFront, res.s1, res.sMid, res.s2]);
  expect(res.afterPrimaryDelete).toBe(5); // primary delete was a no-op
  expect(res.afterRealDelete).not.toContain(res.s2);
});

test('getOrCreateSheetContent for the primary returns the page content fragment', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const p = T.addPage(ydoc, { name: 'P' });
    const primary = T.getOrCreateSheetContent(ydoc, p, p);
    const viaContent = T.pageContentMap(ydoc).get(p);
    return { same: primary === viaContent };
  });
  expect(res.same).toBe(true);
});

// ── Comments ─────────────────────────────────────────────────────────────────
test('comment lifecycle: add, reply, resolve, delete', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const p = T.addPage(ydoc, { name: 'P' });
    const id = T.addCommentThread(ydoc, { pageId: p, body: 'first', author: 'Me' });
    T.addCommentReply(ydoc, id, { body: 'reply', author: 'You' });
    const afterReply = T.readComments(ydoc).find(c => c.id === id);
    T.resolveComment(ydoc, id, true);
    const resolved = T.readComments(ydoc).find(c => c.id === id).resolved;
    T.deleteCommentThread(ydoc, id);
    const afterDelete = T.readComments(ydoc).length;
    return {
      body: afterReply.body,
      replyCount: afterReply.replies.length,
      replyBody: afterReply.replies[0].body,
      resolved,
      afterDelete,
    };
  });
  expect(res.body).toBe('first');
  expect(res.replyCount).toBe(1);
  expect(res.replyBody).toBe('reply');
  expect(res.resolved).toBe(true);
  expect(res.afterDelete).toBe(0);
});

// ── Bookmarks ────────────────────────────────────────────────────────────────
test('bookmark lifecycle: add, rename, delete', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const p = T.addPage(ydoc, { name: 'P' });
    const id = T.addBookmark(ydoc, { name: 'Intro', pageId: p, anchor: 5 });
    const added = T.readBookmarks(ydoc).find(b => b.id === id);
    T.renameBookmark(ydoc, id, 'Overview');
    const renamed = T.readBookmarks(ydoc).find(b => b.id === id).name;
    T.deleteBookmark(ydoc, id);
    const afterDelete = T.readBookmarks(ydoc).length;
    return { name: added.name, pageId: added.pageId, anchor: added.anchor, renamed, afterDelete };
  });
  expect(res.name).toBe('Intro');
  expect(res.anchor).toBe(5);
  expect(res.renamed).toBe('Overview');
  expect(res.afterDelete).toBe(0);
});

// ── Card scope sanity (the only real-world scope) ─────────────────────────────
test('[card] full page + sheet + comment flow works under card scope', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const cardYMap = new T.Y.Map();
    ydoc.transact(() => { ydoc.getMap('cards').set('c1', cardYMap); }, 'local');
    T.initCardDocStore(ydoc, cardYMap);
    const scope = { ...T.cardScope(cardYMap), cardId: 'c1', docCardId: 'c1' };
    const p = T.addPage(ydoc, { name: 'CardPage', scope });
    const s = T.addPageSheet(ydoc, p, scope);
    const cm = T.addCommentThread(ydoc, { pageId: p, body: 'hi', scope });
    return {
      pages: T.readPages(ydoc, scope).map(x => x.name),
      sheetCount: T.getPageSheetIds(ydoc, p, scope).length,
      comments: T.readComments(ydoc, scope).length,
    };
  });
  expect(res.pages).toEqual(['CardPage']);
  expect(res.sheetCount).toBe(2); // primary + 1
  expect(res.comments).toBe(1);
});

// Delete-sheet → Undo (detach keeps content; reattach restores it exactly).
test('detachPageSheet keeps content; reattachPageSheet restores the same sheet', async ({ page }) => {
  const r = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const cardYMap = new T.Y.Map();
    ydoc.transact(() => { ydoc.getMap('cards').set('c1', cardYMap); }, 'local');
    T.initCardDocStore(ydoc, cardYMap);
    const scope = { ...T.cardScope(cardYMap), cardId: 'c1', docCardId: 'c1' };
    const pid = T.addPage(ydoc, { name: 'P', scope });
    const sid = T.addPageSheet(ydoc, pid, scope);
    const frag = T.getOrCreateSheetContent(ydoc, pid, sid, scope);
    ydoc.transact(() => {
      const p = new T.Y.XmlElement('paragraph'); const t = new T.Y.XmlText();
      t.insert(0, 'KEEPME'); p.insert(0, [t]); frag.insert(0, [p]);
    }, 'local');
    const idx = T.detachPageSheet(ydoc, pid, sid, scope);
    const afterDetach = T.getPageSheetIds(ydoc, pid, scope).length;
    const contentKept = !!T.sheetContentMap(ydoc, scope).get(sid);
    T.reattachPageSheet(ydoc, pid, sid, idx, scope);
    const afterReattach = T.getPageSheetIds(ydoc, pid, scope).length;
    const text = T.pageFragmentToText(T.sheetContentMap(ydoc, scope).get(sid));
    return { afterDetach, contentKept, afterReattach, text };
  });
  expect(r.afterDetach).toBe(1);     // back to just the primary
  expect(r.contentKept).toBe(true);  // content survived the detach
  expect(r.afterReattach).toBe(2);   // sheet restored
  expect(r.text).toContain('KEEPME');
});
