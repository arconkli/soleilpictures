import { expect, test } from '@playwright/test';

// Shell regressions from the platform audit (group G2b): the sidebar cluster
// tree, overlays, toasts and the modal registry. Against the local QA shell
// (?local=1), no backend.

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.sb-search')).toBeVisible();
});

// ── sidebar cluster tree ───────────────────────────────────────────────
//
// The local shell has its own sidebar, so the real SidebarBoardTree is mounted
// on its own here. Vite serves the component and its deps from the same
// optimized React the page already loaded (found via the resource timeline),
// so it is the production component, not a copy.

async function mountTree(page) {
  await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource').map(e => e.name);
    const reactUrl = urls.find(u => /\/deps\/react\.js/.test(u));
    const clientUrl = urls.find(u => /\/deps\/react-dom_client\.js/.test(u));
    const React = (await import(reactUrl)).default;
    const clientMod = await import(clientUrl);
    const createRoot = clientMod.createRoot || clientMod.default.createRoot;
    const { SidebarBoardTree } = await import('/src/components/SidebarBoardTree.jsx');
    const ws = 'ws-qa';
    const boards = {
      root: { id: 'root', name: 'Studio', workspace_id: ws, parent_board_id: null, created_at: '2026-01-01' },
      a: { id: 'a', name: 'Alpha', workspace_id: ws, parent_board_id: 'root', created_at: '2026-01-02' },
      b: { id: 'b', name: 'Beta', workspace_id: ws, parent_board_id: 'root', created_at: '2026-01-03' },
    };
    window.__treeQa = { opened: [], dropped: [] };
    for (const t of ['soleil-board-reparent-drop', 'soleil-touch-board-drop']) {
      document.addEventListener(t, (e) => window.__treeQa.dropped.push(t));
    }
    const host = document.createElement('div');
    host.id = 'tree-qa';
    host.style.cssText = 'position:fixed;left:400px;top:100px;width:260px;z-index:99999;background:#111';
    document.body.appendChild(host);
    createRoot(host).render(React.createElement(SidebarBoardTree, {
      boards, workspaceId: ws, rootId: 'root', activeBoardId: null,
      onOpenBoard: (id) => window.__treeQa.opened.push(id),
      canEditBoard: () => true,
    }));
  });
  await expect(page.locator('#tree-qa .sb-tree-row')).toHaveCount(3);
}

// Synthetic touch pointer events on a tree row. Real touch can't be driven on
// desktop-chrome, but the bridge only reads pointerType and coordinates.
async function touchGesture(page, rowText, steps) {
  await page.evaluate(async ({ rowText, steps }) => {
    const row = [...document.querySelectorAll('#tree-qa .sb-tree-row')]
      .find(r => r.querySelector('.sb-row-label')?.textContent === rowText);
    const label = row.querySelector('.sb-row-label');
    const r = label.getBoundingClientRect();
    const x0 = r.left + 10, y0 = r.top + r.height / 2;
    const ev = (type, target, dx, dy) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, isPrimary: true,
      clientX: x0 + dx, clientY: y0 + dy,
    }));
    for (const s of steps) {
      if (s.wait) { await new Promise(res => setTimeout(res, s.wait)); continue; }
      ev(s.type, s.type === 'pointerdown' ? label : document, s.dx || 0, s.dy || 0);
    }
    await new Promise(res => setTimeout(res, 50));
  }, { rowText, steps });
  return page.evaluate(() => window.__treeQa.dropped);
}

test('a swipe that starts on a tree row is a scroll, not a drag', async ({ page }) => {
  await mountTree(page);
  const dropped = await touchGesture(page, 'Alpha', [
    { type: 'pointerdown' },
    { type: 'pointermove', dy: 14 },
    { type: 'pointermove', dy: 40 },
    { type: 'pointerup', dy: 40 },
  ]);
  expect(dropped).toEqual([]);
  await expect(page.locator('.sb-tree-touch-ghost')).toHaveCount(0);
});

test('pointercancel mid-drag drops nothing', async ({ page }) => {
  await mountTree(page);
  const dropped = await touchGesture(page, 'Alpha', [
    { type: 'pointerdown' },
    { wait: 450 },
    { type: 'pointermove', dy: 30 },
    { type: 'pointercancel', dy: 30 },
  ]);
  expect(dropped).toEqual([]);
  await expect(page.locator('.sb-tree-touch-ghost')).toHaveCount(0);
});

test('a hold then a move then a release still drops', async ({ page }) => {
  await mountTree(page);
  const dropped = await touchGesture(page, 'Alpha', [
    { type: 'pointerdown' },
    { wait: 450 },
    { type: 'pointermove', dx: 300, dy: 300 },
    { type: 'pointerup', dx: 300, dy: 300 },
  ]);
  // (The local canvas underneath answers a touch drop with its own reparent
  // event, so only require that the bridge dropped.)
  expect(dropped).toContain('soleil-touch-board-drop');
});

test('a hold released without moving opens the row menu, not the cluster', async ({ page }) => {
  await mountTree(page);
  const dropped = await touchGesture(page, 'Alpha', [
    { type: 'pointerdown' },
    { wait: 600 },
    { type: 'pointerup' },
  ]);
  expect(dropped).toEqual([]);
  await expect(page.locator('.ctx-menu').first()).toBeVisible();
  await expect(page.locator('.ctx-menu').first()).toContainText('Rename');
  expect(await page.evaluate(() => window.__treeQa.opened)).toEqual([]);
});

test('a slow tap (under the long-press length) does not open the row menu', async ({ page }) => {
  await mountTree(page);
  const dropped = await touchGesture(page, 'Alpha', [
    { type: 'pointerdown' },
    { wait: 400 },
    { type: 'pointerup' },
  ]);
  expect(dropped).toEqual([]);
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
});

test('a held Enter opens the cluster once, not on every key repeat', async ({ page }) => {
  await mountTree(page);
  const row = page.locator('#tree-qa .sb-tree-row[data-board-id="b"]');
  await row.focus();
  await row.dispatchEvent('keydown', { key: 'Enter', repeat: false, bubbles: true, cancelable: true });
  for (let i = 0; i < 5; i++) {
    await row.dispatchEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true });
  }
  expect(await page.evaluate(() => window.__treeQa.opened)).toEqual(['b']);
});

test('tree rows are reachable and openable from the keyboard', async ({ page }) => {
  await mountTree(page);
  const row = page.locator('#tree-qa .sb-tree-row[data-board-id="b"]');
  await expect(row).toHaveAttribute('role', 'treeitem');
  await expect(row).toHaveAttribute('tabindex', '0');
  await row.focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__treeQa.opened)).toEqual(['b']);
  // ←/→ collapse and expand the root.
  const root = page.locator('#tree-qa .sb-tree-row[data-board-id="root"]');
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  await root.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(root).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#tree-qa .sb-tree-row')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tree-qa .sb-tree-row')).toHaveCount(3);
});

// ── overlay registry: Escape and Back close only the top layer ─────────

// Mount real components next to the local shell (same React, same
// lib/modalGuard instance as the page), driven from window.__layerQa.
async function mountLayers(page) {
  await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource').map(e => e.name);
    const React = (await import(urls.find(u => /\/deps\/react\.js/.test(u)))).default;
    const clientMod = await import(urls.find(u => /\/deps\/react-dom_client\.js/.test(u)));
    const createRoot = clientMod.createRoot || clientMod.default.createRoot;
    const { Sheet } = await import('/src/components/shell/Sheet.jsx');
    const { Modal } = await import('/src/components/Modal.jsx');
    const guard = await import('/src/lib/modalGuard.js');
    const h = React.createElement;
    const qa = { closed: [], guard };
    window.__layerQa = qa;
    function Host() {
      const [sheet, setSheet] = React.useState(false);
      const [modal, setModal] = React.useState(false);
      const [rows, setRows] = React.useState(['one', 'two']);
      qa.openSheet = () => setSheet(true);
      qa.openModal = () => setModal(true);
      return h(React.Fragment, null,
        h(Sheet, { open: sheet, title: 'Add to cluster', onClose: () => { qa.closed.push('sheet'); setSheet(false); } },
          h('input', { type: 'search', id: 'sheet-search', placeholder: 'Search' }),
          h('button', { type: 'button', id: 'sheet-tile' }, 'Note')),
        h(Modal, { open: modal, ariaLabel: 'Trash', onClose: () => { qa.closed.push('modal'); setModal(false); } },
          rows.map(r => h('button', { key: r, type: 'button', className: 'qa-restore', onClick: () => setRows(x => x.filter(y => y !== r)) }, `Restore ${r}`))));
    }
    const host = document.createElement('div');
    host.id = 'layer-qa';
    document.body.appendChild(host);
    createRoot(host).render(h(Host));
  });
}

test('the bottom sheet is a named layer: canvas shortcuts stand down, focus moves in, Escape closes it', async ({ page }) => {
  await mountLayers(page);
  await page.evaluate(() => window.__layerQa.openSheet());
  const sheet = page.getByRole('dialog', { name: 'Add to cluster' });
  await expect(sheet).toBeVisible();
  expect(await page.evaluate(() => window.__layerQa.guard.anyModalOpen())).toBe(true);
  // The first control that won't raise a phone keyboard, not the search field.
  await expect(page.locator('#sheet-tile')).toBeFocused();
  await expect(page.locator('#sheet-search')).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => window.__layerQa.closed)).toEqual(['sheet']);
  expect(await page.evaluate(() => window.__layerQa.guard.anyModalOpen())).toBe(false);
});

test('Back closes the open sheet instead of leaving the page', async ({ page }) => {
  await mountLayers(page);
  const before = page.url();
  await page.evaluate(() => window.__layerQa.openSheet());
  await expect(page.getByRole('dialog', { name: 'Add to cluster' })).toBeVisible();
  // The history entry is pushed on a microtask after the sheet opens.
  await page.waitForFunction(() => history.state && history.state.soleilLayer);
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Add to cluster' })).toBeHidden();
  expect(page.url()).toBe(before);
  await expect(page.locator('.sb-search')).toBeVisible();
});

test('closing a sheet by the UI consumes its history entry', async ({ page }) => {
  await mountLayers(page);
  const len0 = await page.evaluate(() => history.length);
  await page.evaluate(() => window.__layerQa.openSheet());
  await page.waitForFunction(() => history.state && history.state.soleilLayer);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(history.state && history.state.soleilLayer));
  // Back now leaves the layer-free entry list as it was: nothing is open, so
  // nothing gets closed, and the shell is still there.
  expect(await page.evaluate(() => window.__layerQa.closed)).toEqual(['sheet']);
  expect(await page.evaluate(() => history.length)).toBeGreaterThanOrEqual(len0);
});

test('Escape still closes a modal after the focused row button was removed', async ({ page }) => {
  await mountLayers(page);
  await page.evaluate(() => window.__layerQa.openModal());
  const modal = page.getByRole('dialog', { name: 'Trash' });
  await expect(modal).toBeVisible();
  await page.locator('.qa-restore').first().click();
  await expect(page.locator('.qa-restore')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  expect(await page.evaluate(() => window.__layerQa.closed)).toEqual(['modal']);
});

test('Escape closes only the top layer', async ({ page }) => {
  await mountLayers(page);
  await page.evaluate(() => window.__layerQa.openSheet());
  await page.evaluate(() => window.__layerQa.openModal());
  await expect(page.getByRole('dialog', { name: 'Trash' })).toBeVisible();
  // The modal takes focus on the next frame.
  await expect(page.locator('.qa-restore').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Trash' })).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Add to cluster' })).toBeVisible();
  expect(await page.evaluate(() => window.__layerQa.closed)).toEqual(['modal']);
});
