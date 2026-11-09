// "Help improve Clusters?" (layout outlines), driven through the REAL signed-in
// app with every Supabase call stubbed (helpers/signedInStub.js).
//
// It asks once the person has placed 3 cards (or, with fewer, once the account
// is a day old) and the canvas has been quiet for 20 s of visible time. The
// stub's account has no layout_outlines answer, so the only things between it
// and the ask are the card count, the account's age and the pause. Playwright's
// clock stands in for the 20 s.
import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID } from './helpers/signedInStub.js';

const ASK = 'Help improve Clusters?';
const ask = (page) => page.getByRole('dialog', { name: ASK });
const cardCount = (page) => page.locator('.card[data-card-id]').count();

// The one-shot feature tips are ambient and would take the visit's slot.
const seeTipsAlready = (page) => page.addInitScript(() => {
  try {
    for (const k of ['grids', 'list_drive', 'docs', 'palette']) localStorage.setItem(`soleil.reveal.${k}`, '1');
  } catch (_) {}
});

// What the server counts. get_my_tier reconciles the app's own running count
// with it after every placement, so a server stuck at 0 would pull the count
// back to 0; it follows the cards instead, as card_index does.
let serverCards = 0;

// The stub's user has no created_at, so each test gives its account one: stored
// with the session, before the app reads it (the shared helper is untouched).
const accountMadeAgo = (page, ms) => page.addInitScript((createdAt) => {
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'sb-example-auth-token') {
      try { const s = JSON.parse(v); s.user.created_at = createdAt; v = JSON.stringify(s); } catch (_) {}
    }
    return set.call(this, k, v);
  };
}, new Date(Date.now() - ms).toISOString());

async function boot(page, { accountAgeMs = 60_000 } = {}) {
  serverCards = 0;
  if (accountAgeMs != null) await accountMadeAgo(page, accountAgeMs);
  await seeTipsAlready(page);
  await page.clock.install();
  await bootSignedIn(page, {
    // A free account: the ask counts the server's cards plus the ones placed here.
    rpc: { get_my_tier: () => [{ tier: 'demo', demo_card_count: serverCards, onboarding: { done: true } }] },
    // A profile with no layout_outlines answer. getOwnProfile uses maybeSingle(),
    // which reads one object; the stub's default "no rows" 406 is a failed read,
    // and a failed read never shows the ask. A new account also gets the setup
    // tips (lib/setupTips.js), which would hold the screen; they are marked done.
    rest: { profiles: (url, method) => (method === 'GET' ? { user_id: USER_ID, settings: { setup_tips: { v: 1, done: true } } } : []) },
  });
  await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add note tool', exact: true })).toBeVisible();
  await page.addStyleTag({ content: '.toast-stack,.toast-stack *{pointer-events:none!important}' });
}

async function addNote(page, i) {
  const at = i === 0
    ? { x: 900, y: 650 }
    : { x: 420 + ((i - 1) % 3) * 150, y: 120 + Math.floor((i - 1) / 3) * 130 };
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: at });
  await page.locator('.note-body[contenteditable="true"]').last().click();
  await page.keyboard.type(`note ${i + 1}`);
  await page.locator('.canvas-wrap').click({ position: { x: 400, y: 700 } });
  await expect.poll(() => cardCount(page)).toBe(i + 1);
  serverCards = i + 1;
}

test('a new account is asked after its 3rd card and a pause, not before', async ({ page }) => {
  await boot(page);

  await addNote(page, 0);
  await addNote(page, 1);
  // Two cards: far longer than the 20 s pause, and still no ask.
  await page.clock.runFor(60_000);
  await page.waitForTimeout(500);
  await expect(ask(page)).toHaveCount(0);

  await addNote(page, 2);
  // The clock restarts with the card, so 10 s later it is still not there.
  await page.clock.runFor(10_000);
  await page.waitForTimeout(300);
  await expect(ask(page)).toHaveCount(0);

  await page.clock.runFor(40_000);
  await expect(ask(page)).toBeVisible({ timeout: 5000 });
});

test('an account made 2 days ago is asked with no cards, after a pause', async ({ page }) => {
  await boot(page, { accountAgeMs: 2 * 24 * 60 * 60 * 1000 });

  await page.clock.runFor(10_000);
  await page.waitForTimeout(300);
  await expect(ask(page)).toHaveCount(0);

  await page.clock.runFor(40_000);
  await expect(ask(page)).toBeVisible({ timeout: 5000 });
});
