// Layout and focus checks for the panel findings of the visual sweep
// (VS-PANELS-*). Most panels are mounted on their own by
// tests/helpers/panelsProbe.js (served by the dev server), on top of the
// ?local=1&blank=1 shell so the page has the app's styles and a real app
// behind the dialog for focus to escape into. Supabase reads go to the fake
// project the config forces; the ones a panel needs are answered here.
import { expect, test } from '@playwright/test';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function probe(page, fn, ...args) {
  await page.evaluate(async ({ fn, args }) => {
    const m = await import('/tests/helpers/panelsProbe.js');
    m[fn](...args);
  }, { fn, args });
}

async function setTheme(page, theme) {
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
}

const rect = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
});

// PostgREST-shaped answers for the tables the panels read.
async function answerRest(page, table, rows) {
  await page.route(`**/rest/v1/${table}*`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(rows),
  }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
});

test('VS-PANELS-01: the tag page header keeps the name, Manage and close on screen on a phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await probe(page, 'mountTagDetail');
  const head = page.locator('.panels-probe-host .tag-detail-head');
  await expect(head).toBeVisible();
  const name = await rect(head.locator('.tag-detail-name'));
  expect(name.w, 'the tag name must not collapse').toBeGreaterThan(60);
  for (const sel of ['.tag-detail-count', '.tag-detail-manage-btn', '.tag-detail-close']) {
    const r = await rect(head.locator(sel));
    expect(r.r, `${sel} must end inside the viewport`).toBeLessThanOrEqual(PHONE.width);
    expect(r.l).toBeGreaterThanOrEqual(0);
  }
  // Name, count, Manage and close share the first row; the chips go below.
  const close = await rect(head.locator('.tag-detail-close'));
  expect(Math.abs(close.t - name.t), 'close sits on the name row').toBeLessThan(name.h);
  // The header itself no longer overflows; the chip strip scrolls instead.
  const sw = await head.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sw).toBeLessThanOrEqual(0);
  const chips = head.locator('.tag-profile-typeswitch');
  expect(await chips.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  await setTheme(page, 'light');
  await page.screenshot({ path: test.info().outputPath('tag-390-light.png') });
  await setTheme(page, 'dark');
  await page.screenshot({ path: test.info().outputPath('tag-390-dark.png') });
});

test('VS-PANELS-02: Settings takes focus, keeps Tab inside, and gives focus back on close', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await probe(page, 'mountSettings', 'profile', 'owner');
  const trigger = page.locator('.probe-settings-trigger');
  await trigger.focus();
  await trigger.press('Enter');
  const modal = page.locator('.settings-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('role', 'dialog');
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  // Focus lands on the active rail tab.
  await expect(page.locator('.settings-tab.is-active')).toBeFocused();
  let outside = 0;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
    if (!(await modal.evaluate((el) => el.contains(document.activeElement)))) outside++;
  }
  expect(outside, 'no Tab stop may land behind the backdrop').toBe(0);
  await page.screenshot({ path: test.info().outputPath('settings-focus-1440-dark.png') });
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
});

function versionRows() {
  const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  return [
    { id: 'v1', snapshot_at: at(1), card_count: 20, label: 'manual', made_by: null, session_id: 's1', trigger_kind: 'manual', op_summary: null, parent_version_id: null },
    { id: 'v2', snapshot_at: at(30), card_count: 21, label: null, made_by: null, session_id: 's2', trigger_kind: 'auto', op_summary: null, parent_version_id: null },
    { id: 'v3', snapshot_at: at(90), card_count: 18, label: null, made_by: null, session_id: 's3', trigger_kind: 'auto', op_summary: null, parent_version_id: null },
  ];
}

test('VS-PANELS-03/04/11: Version history rows stay on one line, the selected tab shows, the band suits the theme', async ({ page }) => {
  await answerRest(page, 'board_versions', versionRows());
  await answerRest(page, 'board_meta_history', []);
  await page.setViewportSize(DESKTOP);
  await probe(page, 'mountVersionHistory');
  const when = page.locator('.hist-when').first();
  await expect(when).toContainText('20 cards');
  // VS-03: one line — "1m ago · 20 cards (-1)", no stacked flex spans.
  const lh = await when.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect((await rect(when)).h).toBeLessThan(lh * 1.5);
  expect(await when.innerText()).not.toContain('\n');

  // VS-04: the selected tab looks selected, and says so.
  const tabs = page.locator('.hist-tabs [role="tab"]');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  const look = (i) => tabs.nth(i).evaluate((el) => {
    const cs = getComputedStyle(el);
    return `${cs.backgroundColor}|${cs.color}`;
  });
  expect(await look(0)).not.toBe(await look(1));
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(await look(1)).not.toBe(await look(0));
  await tabs.nth(0).click();
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath('versions-1440-dark.png') });

  // VS-11: in light, the band is a faint tint, not a mid-grey strip.
  await setTheme(page, 'light');
  const bandAlpha = await page.locator('.modal-actions').evaluate((el) => {
    const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
    const parts = m[1].split(',').map(Number);
    return parts.length === 4 ? parts[3] : 1;
  });
  expect(bandAlpha).toBeLessThanOrEqual(0.05);
  await page.waitForTimeout(300);   // let the tabs' colour transition settle
  await page.screenshot({ path: test.info().outputPath('versions-1440-light.png') });

  // VS-11 on a phone: the hint gets its own line instead of a 7-line column.
  await page.setViewportSize(PHONE);
  const hint = page.locator('.modal-actions .modal-hint');
  const hr = await rect(hint);
  expect(hr.w).toBeGreaterThan(300);
  expect(hr.h).toBeLessThan(70);
  await page.screenshot({ path: test.info().outputPath('versions-390-light.png') });
});

test('VS-PANELS-05: the Settings dialog keeps its size and place across tab switches', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await probe(page, 'mountSettings', 'profile', 'owner');
  await page.locator('.probe-settings-trigger').click();
  const modal = page.locator('.settings-modal');
  await expect(modal).toBeVisible();
  const seen = new Set();
  for (const label of ['Profile', 'Appearance', 'Notifications', 'Connections', 'Members', 'Card defaults', 'Documentation']) {
    await page.locator('.settings-tab', { hasText: label }).click();
    await expect(page.locator('.settings-tab.is-active')).toContainText(label);
    await page.waitForTimeout(150);
    const r = await rect(modal);
    seen.add(`${Math.round(r.t)}/${Math.round(r.h)}`);
  }
  expect([...seen], 'one geometry for every tab').toHaveLength(1);
  // The pane scrolls inside the fixed frame rather than the frame growing.
  const pane = await page.locator('.settings-pane').evaluate((el) => getComputedStyle(el).overflowY);
  expect(pane).toBe('auto');
});

const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

test('VS-PANELS-06: on a phone, a toast over a full-screen sheet clears the sheet header', async ({ page }) => {
  await answerRest(page, 'boards', [{
    id: 'b-del', workspace_id: 'ws-probe', name: 'Old moodboard', view: 'canvas',
    parent_board_id: null, deleted_at: new Date(Date.now() - 3600000).toISOString(), deleted_batch_id: null,
  }]);
  await page.setViewportSize(PHONE);
  await probe(page, 'mountTrash');
  const close = page.locator('.modal-shell .modal-x');
  await expect(close).toBeVisible();
  await page.evaluate(() => window.__probeToast('Cluster deleted.'));
  const toast = page.locator('.toast-stack .toast').last();
  await expect(toast).toBeVisible();
  await page.waitForTimeout(300);   // toastIn slides 12px
  const t = await rect(toast);
  expect(overlaps(t, await rect(close)), 'the toast must not sit on the close button').toBe(false);
  expect(t.b).toBeGreaterThan(PHONE.height - 120);
  expect(t.b).toBeLessThanOrEqual(PHONE.height);
  await page.screenshot({ path: test.info().outputPath('toast-trash-390-dark.png') });
});

test('VS-PANELS-06: with no sheet open the phone toast stays under the topbar', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await probe(page, 'mountSettings', 'profile', 'owner');   // closed until clicked
  await page.evaluate(() => window.__probeToast('Cluster deleted.'));
  const toast = page.locator('.toast-stack .toast').last();
  await expect(toast).toBeVisible();
  expect((await rect(toast)).t).toBeLessThan(120);
});

test('VS-PANELS-07: on a phone the Schedule panel is a full-width sheet that stops at the bottom nav', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const nav = page.locator('.mb-nav');
  await expect(nav).toBeVisible();
  await probe(page, 'mountNotifications');
  const panel = page.locator('.ntf-panel');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);   // the entrance animation scales the box
  const p = await rect(panel);
  const n = await rect(nav);
  expect(p.l).toBe(0);
  expect(p.r).toBe(PHONE.width);
  // The nav's 1px top border sits inside its 56px row, as for Messages.
  expect(p.b, 'the panel must not run over the nav').toBeLessThanOrEqual(n.t + 1.5);
  await page.screenshot({ path: test.info().outputPath('ntf-390-dark.png') });
  await setTheme(page, 'light');
  await page.screenshot({ path: test.info().outputPath('ntf-390-light.png') });
  // Desktop keeps the floating card.
  await page.setViewportSize(DESKTOP);
  expect((await rect(panel)).w).toBe(360);
});

test('VS-PANELS-08: the phone "Add your photos" card keeps a margin on the right', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/?local=1&reset=1&blank=1&tour=mobile');
  const pill = page.locator('.onboarding-tour');
  await expect(pill).toContainText('Add your photos');
  await page.waitForTimeout(600);   // entrance animation + the placement loop settling
  const r = await rect(pill);
  expect(r.r, 'the card must not run into the screen edge').toBeLessThanOrEqual(PHONE.width - 8);
  const btn = await rect(pill.locator('.onboarding-coachmark-dismiss'));
  expect(btn.r).toBeLessThanOrEqual(r.r);
  // It still clears the tool rail on the left.
  const rail = page.locator('.cnv-tools');
  if (await rail.count()) expect(r.l).toBeGreaterThanOrEqual((await rect(rail)).r);
  await page.screenshot({ path: test.info().outputPath('tour-390-dark.png') });
});

const LONG_EMAIL = 'jordan.longname.director@productioncompany-example.com';

async function answerShareReads(page) {
  const rpc = (name, rows) => page.route(`**/rest/v1/rpc/${name}*`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(rows),
  }));
  await rpc('list_board_shares', []);
  await rpc('list_inherited_board_shares', []);
  await rpc('list_pending_invites_for_workspace', []);
  await rpc('list_pending_invites_for_board', [{
    id: 'inv-1', email: LONG_EMAIL, role: 'editor', created_at: new Date().toISOString(),
    invited_by: '00000000-0000-4000-8000-000000000001',
  }]);
}

test('VS-PANELS-09: a long name in the Share list ends in an ellipsis, not a cut glyph', async ({ page }) => {
  await answerShareReads(page);
  await page.setViewportSize(PHONE);
  await probe(page, 'mountShare');
  const name = page.locator('.share-row-name', { hasText: 'jordan.longname' });
  await expect(name).toBeVisible();
  const m = await name.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { display: cs.display, overflow: cs.textOverflow, clipped: el.scrollWidth > el.clientWidth };
  });
  expect(m.clipped).toBe(true);
  expect(m.overflow).toBe('ellipsis');
  // text-overflow has no effect on the text of a flex container.
  expect(m.display).not.toMatch(/flex/);
  await page.screenshot({ path: test.info().outputPath('share-390-dark.png') });
});
