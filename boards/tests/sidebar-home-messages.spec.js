import { expect, test } from '@playwright/test';

// Round 8 of the files sidebar (preview only), in the sidebar QA harness: the
// line under the workspace's name, Home as the workspace at a glance, and
// Messages in the sidebar's card with its thread in bubbles — the owner's
// picks (D, D, D) from the canvas of 2026-10-19.

async function open(page, query = '') {
  await page.goto(`/?sidebarqa=1${query}`);
  await page.waitForSelector('[data-sidebarqa-ready]');
}
const log = (page) => page.getByTestId('sbqa-log');
const rect = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());
const panel = (page) => page.locator('.msg-panel').first();

test.describe('the sidebar\'s top', () => {
  test('the line under the name says who is here, or whose it is, or nothing', async ({ page }) => {
    await open(page);
    const who = page.locator('.sb-top .sbf-who');
    await expect(who.locator('.sbf-who-text')).toHaveText('Maya and Jon are here');
    await expect(who.locator('.sbf-who-face')).toHaveText(['M', 'J']);
    await expect(page.locator('.sb-mid-subtitle, .sb-members')).toHaveCount(0);          // no "Yours"
    await open(page, '&who=shared');
    await expect(page.locator('.sb-top .sbf-who .sbf-who-text')).toHaveText('Shared by Maya Ortiz');
    await open(page, '&who=none');
    await expect(page.locator('.sb-top .sbf-who')).toHaveCount(0);
  });

  test('Home and Messages are words on the cluster names\' edge; Messages open is pressed, not gold', async ({ page }) => {
    await open(page, '&messages=1');
    const [home, msgs] = [page.locator('.sbf-quickbtn').nth(0), page.locator('.sbf-quickbtn').nth(1)];
    const studio = page.locator('.sb-tree-row', { hasText: 'Studio' }).first().locator('.sb-row-label');
    const left = async (loc) => Math.round((await rect(loc)).left);
    expect(await left(home.locator('.sbf-quick-label'))).toBe(await left(studio));
    await expect(msgs.locator('.sbf-quick-count')).toHaveText('2');
    await expect(msgs).toHaveClass(/is-pressed/);
    await expect(msgs).toHaveAttribute('aria-pressed', 'true');
    // Pressed is the chip alone; the gold bar stays on the cluster you're in.
    expect(await msgs.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
    const active = page.locator('.sb-tree-row.active');
    await expect(active).toHaveCount(1);
    expect(await active.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).toBe('rgb(255, 165, 0)');
  });
});

test.describe('Home, the workspace at a glance', () => {
  test('the cluster to pick up: its newest photos, where it is, who is in it; the next few as chips', async ({ page }) => {
    await open(page, '&surface=home');
    const cont = page.locator('.ch-cont');
    await expect(cont.locator('.ch-cont-name')).toHaveText('Feature film');
    await expect(cont.locator('.ch-cont-sub')).toContainText('Studio · edited');
    await expect(cont.locator('.ch-here')).toHaveText(/Maya is here/);
    await expect(cont.locator('.ch-collage.n3 img')).toHaveCount(3);
    await expect(page.locator('.ch-chip')).toHaveText(['Casting', 'Music video', 'Moodboards']);
    await cont.click();
    await expect(log(page)).toContainText('home continue film');
    await page.locator('.ch-chip', { hasText: 'Casting' }).click();
    await expect(log(page)).toContainText('home recent cast');
    // Home is where you are: the gold bar is on Home, on no cluster.
    await expect(page.locator('.sbf-quickbtn.is-on')).toHaveText('Home');
    await expect(page.locator('.sb-tree-row.active')).toHaveCount(0);
  });

  test('the clusters at the top as covers, a sort, and New cluster named in place', async ({ page }) => {
    await open(page, '&surface=home');
    const names = page.locator('.ch-grid .ch-tile:not(.ch-new) .ch-tile-name');
    await expect(names).toHaveText(['Feature film', 'Music video', 'Moodboards']);
    await expect(page.locator('.ch-grid .ch-tile', { hasText: 'Studio' })).toHaveCount(0);  // the root is the sidebar's
    await page.locator('.ch-sort .ch-btn').click();
    await page.getByRole('menuitemradio', { name: 'Name' }).click();
    await expect(names).toHaveText(['Feature film', 'Moodboards', 'Music video']);
    await page.locator('.ch-tile', { hasText: 'Music video' }).click();
    await expect(log(page)).toContainText('home tile mv');
    await page.locator('.ch-new').click();
    await page.getByLabel('New cluster name').fill('Pitch deck');
    await page.keyboard.press('Enter');
    await expect(log(page)).toContainText('new cluster Pitch deck');
  });

  test('the rail: messages, who is here, what is shared, storage', async ({ page }) => {
    await open(page, '&surface=home');
    const msgs = page.locator('.ch-card[aria-label="Messages"] .ch-item');
    await expect(msgs).toHaveCount(3);
    await expect(msgs.nth(0).locator('.ch-item-name')).toHaveText('Maya Ortiz');
    await expect(msgs.nth(0).locator('.ch-count')).toHaveText('2');
    await expect(msgs.nth(1).locator('.ch-item-sub')).toHaveText(/^Lena: Callbacks moved/);
    await msgs.nth(1).click();
    await expect(log(page)).toContainText('messages c-cast');
    const here = page.locator('.ch-card[aria-label="Here now"] .ch-item');
    await expect(here.locator('.ch-item-sub')).toHaveText(['In Feature film', 'In Casting']);
    await here.nth(1).click();
    await expect(log(page)).toContainText('jump cast');
    const shared = page.locator('.ch-card[aria-label="Shared with you"] .ch-item');
    await expect(shared).toHaveCount(2);
    await expect(shared.nth(0).locator('.ch-tag')).toHaveText('View');
    await expect(page.locator('.ch-card[aria-label="Storage"] .sbf-meter-text')).toHaveText('38 of 50 cards · 1.2 of 5.0 GB');
  });

  test('the universe is behind a button, with a way back', async ({ page }) => {
    await open(page, '&surface=home');
    await expect(page.getByTestId('sbqa-universe')).toHaveCount(0);
    await page.getByRole('button', { name: 'Universe' }).click();
    await expect(page.getByTestId('sbqa-universe')).toBeVisible();
    // The way back clears the floating islands.
    const back = page.getByRole('button', { name: 'Home', exact: true }).last();
    expect((await rect(back)).top).toBeGreaterThanOrEqual(52);
    await back.click();
    await expect(page.locator('.ch-cont')).toBeVisible();
  });
});

test.describe('Messages in the sidebar\'s card', () => {
  test('a glass card below the islands, a find line, unread as weight and a quiet pill', async ({ page }) => {
    await open(page, '&messages=1');
    // It rises 4px as it opens; measure it settled.
    await expect.poll(() => panel(page).evaluate((el) => el.getAnimations().length)).toBe(0);
    const r = await rect(panel(page));
    const vw = page.viewportSize().width;
    expect(Math.round(r.top)).toBe(52);
    expect(Math.round(vw - r.right)).toBe(8);
    expect(Math.round(r.width)).toBe(360);
    await expect(panel(page).locator('.msg-panel-name')).toHaveText('Messages');
    await expect(panel(page).locator('.msg-row-dot')).toHaveCount(0);                     // no gold dot
    const maya = panel(page).locator('.msg-row', { hasText: 'Maya Ortiz' });
    await expect(maya.locator('.msg-row-count')).toHaveText('2');
    await expect(maya.locator('.msg-row-time')).toHaveText('4m');
    await panel(page).getByLabel('Find a conversation').fill('lut');
    await expect(panel(page).locator('.msg-row')).toHaveCount(1);
    await expect(panel(page).locator('.msg-row')).toContainText('Grade');
    await panel(page).getByLabel('Find a conversation').fill('nothing like this');
    await expect(panel(page).locator('.msg-empty')).toHaveText(/No conversations match/);
  });

  test('a group thread: who is in it, the pinned row, bubbles, yours on the right, a neutral Send', async ({ page }) => {
    await open(page, '&messages=1&conv=c-cast');
    await expect(panel(page).locator('.msg-panel-name')).toHaveText('Casting · Feature film');
    await expect(panel(page).locator('.msg-panel-sub')).toHaveText('Lena, Jon, Sam and you');
    await expect(panel(page).locator('.msg-pinned-text')).toHaveText('Callback list v3 is the source of truth.');
    await expect(panel(page).locator('.msg-pinned-n')).toHaveText('1 pinned');
    await expect(panel(page).locator('.msg-thread-body.is-group')).toHaveCount(1);
    const p = await rect(panel(page));
    const mine = await rect(panel(page).locator('.msg-bubble--mine .msg-bubble-body').first());
    const theirs = await rect(panel(page).locator('.msg-bubble:not(.msg-bubble--mine) .msg-bubble-body').last());
    expect(p.right - mine.right).toBeLessThan(24);                                       // yours on the right
    expect(theirs.left - p.left).toBeGreaterThan(40);                                    // theirs past the marks
    await expect(panel(page).locator('.msg-bubble-replies')).toContainText('3 replies');
    const send = panel(page).locator('.msg-composer-send');
    expect(await send.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 165, 0)');
  });

  test('a direct message has no marks beside its bubbles; a viewer gets the notice', async ({ page }) => {
    await open(page, '&messages=1&conv=c-maya');
    await expect(panel(page).locator('.msg-panel-sub')).toHaveText('Direct message');
    await expect(panel(page).locator('.msg-thread-body.is-dm')).toHaveCount(1);
    await expect(panel(page).locator('.msg-bubble-avatar').first()).toBeHidden();
    await open(page, '&messages=1&conv=c-maya&readonly=1');
    await expect(panel(page).locator('.msg-composer')).toHaveCount(0);
    await expect(panel(page).locator('.msg-composer-readonly')).toBeVisible();
  });
});
