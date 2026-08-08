import { expect, test } from '@playwright/test';

// Messages must stay reachable while a document is open.
//
// The doc overlay portals to <body> at z-index 2147483600; .msg-panel sat at 30
// as an inline child of .app. Fullscreen buried it completely, and side mode
// docks to the right — exactly where the panel lives — so opening a doc made
// the app a dead end for conversation.
//
// The panel is now portaled to <body> too, and lifted above the overlay ONLY
// while one is up. The "only while" matters: an unconditional bump would also
// float it over ordinary modals (.modal-bg is z-index 200). DocCard sets the
// body flag these rules key off, refcounted so side mode's still-live canvas
// can open a second card without clearing it early.
//
// The header button itself needs MessagesUiContext, which lives in App and is
// absent from this backend-free harness — so this spec guards the stacking
// mechanism, which is what actually broke.

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
}

// Mount a probe carrying the real classes and read the z-index the cascade
// actually resolves — so this fails if either rule is renamed or removed.
//
// Probes are torn down before returning: they wear real component class names,
// so a leftover would collide with those components' own locators.
async function probeZIndexes(page, classes) {
  return page.evaluate((classes) => {
    const read = (cls) => {
      const el = document.createElement('div');
      el.className = 'zprobe ' + cls;
      document.body.appendChild(el);
      const z = parseInt(getComputedStyle(el).zIndex, 10);
      el.remove();
      return z;
    };
    const out = { flag: document.body.getAttribute('data-doc-overlay') };
    for (const [key, cls] of Object.entries(classes)) out[key] = read(cls);
    return out;
  }, classes);
}

const MAIN_PROBES = {
  msgPanel: 'msg-panel',
  newConvPop: 'msg-newconv-pop',
  groupMenu: 'msg-group-menu',
  docModal: 'doc-card-modal doc-card-modal-full',
  modalBg: 'modal-bg',
};

test('the doc overlay flag lifts the messages panel above it, and clears on close', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });

  // Closed: no flag, and the panel sits below ordinary modals.
  const before = await probeZIndexes(page, MAIN_PROBES);
  expect(before.flag).toBeNull();
  expect(before.msgPanel).toBeLessThan(before.modalBg);

  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();

  const during = await probeZIndexes(page, MAIN_PROBES);
  expect(during.flag).toBe('1');
  // The whole point: reachable over the doc.
  expect(during.msgPanel).toBeGreaterThan(during.docModal);
  // …and the panel's own portaled popovers must clear the panel.
  expect(during.newConvPop).toBeGreaterThan(during.msgPanel);
  expect(during.groupMenu).toBeGreaterThan(during.msgPanel);

  // Close → flag gone, panel back under modals.
  await page.locator('.doc-card-close').click();
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
  const after = await probeZIndexes(page, MAIN_PROBES);
  expect(after.flag).toBeNull();
  expect(after.msgPanel).toBeLessThan(after.modalBg);
});

test('side mode keeps the panel above the docked doc too', async ({ page }) => {
  await openDoc(page);
  await page.locator('.doc-card-icon[aria-label="Dock to side"]').click();
  await expect(page.locator('.doc-card-modal-side')).toBeVisible();

  const z = await probeZIndexes(page, {
    msgPanel: 'msg-panel',
    sideModal: 'doc-card-modal doc-card-modal-side',
    divider: 'doc-card-side-divider',
  });
  // Side mode docks over the panel's own right-hand slot, so it has to win
  // against both the panel and its drag divider.
  expect(z.msgPanel).toBeGreaterThan(z.sideModal);
  expect(z.msgPanel).toBeGreaterThan(z.divider);
});

// The header button itself. It reads MessagesUiContext (normally supplied by
// App); the doc QA harness provides a stub so the button, its unread dot and
// its toggle are exercised rather than silently rendering null.
test('the doc header exposes a Messages button with an unread marker', async ({ page }) => {
  await openDoc(page);

  const btn = page.locator('.doc-card-messages');
  await expect(btn).toBeVisible();
  // Unread > 0 in the harness stub → the dot renders.
  await expect(page.locator('.doc-card-messages-dot')).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');

  // Clicking drives the shared toggle, which is what flips the real panel.
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveClass(/is-active/);

  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
});

test('the Messages button is hidden for public doc viewers', async ({ page }) => {
  // An anonymous /share viewer has no inbox, so the button must not appear even
  // though the overlay does. ?public=1 mounts the card exactly as the share
  // surface does (isPublic), which is what gates it in DocCard.
  await page.goto('/?docqa=1&public=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();

  await expect(page.locator('.doc-card-messages')).toHaveCount(0);
  // The mode toggles are suppressed on public too — proves we're really in the
  // public branch and not just failing to find the button.
  await expect(page.locator('.doc-card-icon[aria-label="Dock to side"]')).toHaveCount(0);
  // Sanity: the signed-in mount in the same harness DOES show it.
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-messages')).toHaveCount(1);
});
