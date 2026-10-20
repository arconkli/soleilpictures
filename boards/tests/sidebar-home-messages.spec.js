import { expect, test } from '@playwright/test';

// The files sidebar (preview only), in the sidebar QA harness: the line under
// the workspace's name and Messages in the sidebar's card with its thread in
// bubbles (the owner's picks D, D from the canvas of 2026-10-19), and Home as
// the universe's map (their pick B from the canvas of the same day, with the
// workspace at its top left).

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

test.describe('Home, the universe as the map', () => {
  // The universe drifts; reduced motion holds it still, so a star's name stays
  // where a click can land on it (Playwright waits for a still target). It is
  // drawn in software here (no GPU), so these get the slow tests' time.
  test.beforeEach(async ({ page }) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });
  const home = async (page, query = '') => {
    await open(page, `&surface=home${query}`);
    await page.waitForSelector('.hg-map.is-ready');
  };
  const star = (page, name) => page.locator('.hg-name', { hasText: name });

  test('the universe is the page: every cluster a named star, the workspace at the top left, nothing the sidebar has', async ({ page }) => {
    await home(page);
    const sky = page.locator('.ch-sky');
    const r = await rect(sky);
    expect([Math.round(r.left), Math.round(r.top), Math.round(r.width)]).toEqual([0, 0, page.viewportSize().width]);
    await expect(sky).toHaveCSS('pointer-events', 'auto');
    // The sidebar's cards and the islands still lie over it.
    expect(await page.evaluate(() => !!document.elementFromPoint(24, 24)?.closest('.sbf-card'))).toBe(true);
    for (const name of ['Studio', 'Feature film', 'Music video', 'Moodboards', 'Locations', 'Casting']) {
      await expect(star(page, name)).toHaveCount(1);
    }
    // Clusters inside another are named too, quieter: an orange star with no name reads as a bug.
    expect((await page.locator('.hg-name.is-nested').allInnerTexts()).sort()).toEqual(['Casting', 'Locations']);
    await expect(page.locator('.hg-name:not([data-off="1"])')).not.toHaveCount(0);
    // Every name on show sits in the open area, right of the sidebar.
    const sidebarRight = (await rect(page.locator('.sbf-card.is-tree'))).right;
    for (const box of await page.locator('.hg-name:not([data-off="1"])').evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON()))) {
      expect(box.left).toBeGreaterThanOrEqual(sidebarRight);
    }
    // The workspace, top left: its name, a caret that switches, and the words.
    const ws = page.locator('.ch-ws');
    await expect(ws.locator('.ch-ws-name')).toHaveText('Sidebar QA');
    await expect(ws.getByRole('button', { name: 'Switch workspace' })).toHaveAttribute('aria-haspopup', 'menu');
    for (const w of ['Rename', 'Invite', 'New workspace']) await expect(ws.getByRole('button', { name: w })).toBeVisible();
    await expect(ws.locator('.ch-ws-meta')).toHaveText(/^Your workspace · 4 people · updated /);
    expect((await rect(ws)).top).toBeGreaterThanOrEqual(52);   // under the islands
    // Find and New cluster at the bottom; no rail, no pick-up card.
    await expect(page.getByRole('searchbox', { name: 'Find a cluster' })).toBeVisible();
    await expect(page.locator('.ch-bar').getByRole('button', { name: 'New cluster' })).toBeVisible();
    for (const gone of ['.ch-rail', '.ch-cont', '.ch-grid']) await expect(page.locator(gone)).toHaveCount(0);
    // Home is where you are: the gold bar is on Home, on no cluster.
    await expect(page.locator('.sbf-quickbtn.is-on')).toHaveText('Home');
    await expect(page.locator('.sb-tree-row.active')).toHaveCount(0);
  });

  test('a picked star opens its card beside it: photos, what is inside, who is in it, and what you can do', async ({ page }) => {
    await home(page);
    await star(page, 'Feature film').click();
    const card = page.locator('.hg-card .ch-card');
    await expect(card).toBeVisible();
    await expect(star(page, 'Feature film')).toHaveClass(/is-sel/);
    await expect(card.locator('.ch-card-name')).toHaveText('Feature film');
    await expect(card.locator('.ch-card-sub')).toHaveText(/^\d+ cards · 2 inside · edited /);
    await expect(card.locator('.ch-cover.is-photos.n3 img')).toHaveCount(3);
    await expect(card.locator('.ch-inword')).toHaveText(['Casting', 'Locations']);
    await expect(card.locator('.ch-here')).toHaveText(/Maya is here/);
    for (const w of ['Open', 'Rename', 'Cover', 'Move', 'Star', 'Delete']) await expect(card.getByRole('button', { name: w, exact: true })).toBeVisible();
    // Beside its star, inside the open area, joined by a short line (placed on
    // the frame after it shows, so asked until it is).
    const sidebarRight = (await rect(page.locator('.sbf-card.is-tree'))).right;
    await expect.poll(async () => (await rect(card)).left).toBeGreaterThanOrEqual(sidebarRight);
    expect((await rect(card)).bottom).toBeLessThanOrEqual(page.viewportSize().height);
    await expect(page.locator('.hg-lead')).toHaveCount(1);
    // Star, Open; a name inside picks that cluster; Escape puts the card down.
    await card.getByRole('button', { name: 'Star', exact: true }).click();
    await expect(log(page)).toContainText('star film');
    await expect(card.getByRole('button', { name: 'Unstar' })).toHaveAttribute('aria-pressed', 'true');
    await card.getByRole('button', { name: 'Open' }).click();
    await expect(log(page)).toContainText('home card film');
    await card.locator('.ch-inword', { hasText: 'Casting' }).click();
    await expect(card.locator('.ch-card-name')).toHaveText('Casting');
    await expect(card.locator('.ch-card-sub')).toHaveText(/^In Feature film · /);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    // Rename in place on the card.
    await star(page, 'Music video').click();
    await card.getByRole('button', { name: 'Rename' }).click();
    await card.getByLabel('Cluster name').fill('Music video, cut 2');
    await page.keyboard.press('Enter');
    await expect(log(page)).toContainText('rename mv Music video, cut 2');
    // Delete puts it down and goes through App's delete (its Undo is App's).
    await card.getByRole('button', { name: 'Delete' }).click();
    await expect(log(page)).toContainText('delete mv');
    await expect(card).toHaveCount(0);
    // Twice on a star opens it.
    await star(page, 'Moodboards').dblclick();
    await expect(log(page)).toContainText('home star mood');
  });

  test('find lights what it finds and dims the rest; Enter goes to the first; Escape clears it', async ({ page }) => {
    await home(page);
    const find = page.getByRole('searchbox', { name: 'Find a cluster' });
    await find.fill('film');
    await expect(page.locator('.ch-find-n')).toHaveText('1 found');
    await expect(star(page, 'Feature film')).toHaveClass(/is-hit/);
    await expect(star(page, 'Music video')).toHaveClass(/is-faded/);
    await find.fill('zzz');
    await expect(page.locator('.ch-find-n')).toHaveText('Nothing found');
    await find.fill('MOOD');
    await page.keyboard.press('Enter');
    await expect(page.locator('.hg-card .ch-card-name')).toHaveText('Moodboards');
    await page.keyboard.press('Escape');   // the card first
    await expect(page.locator('.hg-card')).toHaveCount(0);
    await find.focus();
    await page.keyboard.press('Escape');   // then the search
    await expect(find).toHaveValue('');
    await expect(page.locator('.hg-name.is-faded')).toHaveCount(0);
  });

  test('the workspace: switch from the caret, rename in place, invite, a new one; a viewer can only look', async ({ page }) => {
    await home(page);
    const ws = page.locator('.ch-ws');
    await ws.getByRole('button', { name: 'Switch workspace' }).click();
    const menu = page.locator('.ph-ws-pop .ws-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.ws-menu-name')).toContainText(['Personal', 'Sidebar QA', 'Ridgeline']);
    await menu.locator('.ws-menu-row', { hasText: 'Ridgeline' }).click();
    await expect(log(page)).toContainText('switch ws-ridge');
    await expect(menu).toHaveCount(0);
    await ws.getByRole('button', { name: 'Rename' }).click();
    const name = ws.getByLabel('Workspace name');
    await expect(name).toHaveValue('Sidebar QA');
    await expect(ws.locator('.ch-ws-meta')).toHaveText('Enter to save · Esc to cancel');
    await name.fill('Lost Time');
    await page.keyboard.press('Enter');
    await expect(log(page)).toContainText('rename workspace Lost Time');
    await ws.getByRole('button', { name: 'Invite' }).click();
    await expect(log(page)).toContainText('invite ws-qa');
    await ws.getByRole('button', { name: 'New workspace' }).click();
    await expect(log(page)).toContainText('new workspace');

    await home(page, '&viewer=1');
    await expect(ws.getByRole('button', { name: 'Rename' })).toHaveCount(0);
    await expect(ws.getByRole('button', { name: 'Invite' })).toHaveCount(0);
    await expect(ws.getByRole('button', { name: 'New workspace' })).toBeVisible();
    await expect(page.locator('.ch-bar').getByRole('button', { name: 'New cluster' })).toHaveCount(0);
    await star(page, 'Feature film').click();
    const card = page.locator('.hg-card .ch-card');
    await expect(card.locator('.ch-card-acts button')).toHaveText(['Open', 'Star']);
    await expect(card.locator('.ch-card-note')).toHaveText('You can look around this cluster but not change it.');
  });

  test('New cluster is named above the bar; a workspace of only Studio says what its stars will be', async ({ page }) => {
    await home(page);
    await page.locator('.ch-bar').getByRole('button', { name: 'New cluster' }).click();
    const naming = page.locator('.ch-naming');
    await expect(naming.getByLabel('Name the new cluster')).toBeFocused();
    await page.keyboard.type('Trailer');
    await page.keyboard.press('Enter');
    await expect(log(page)).toContainText('new cluster Trailer');
    await expect(naming).toHaveCount(0);

    await home(page, '&empty=1');
    await expect(page.locator('.hg-name')).toHaveText(['Studio']);
    await expect(page.locator('.ch-empty-line')).toHaveText('Every cluster you make becomes a star here.');
    await expect(page.locator('.ch-bar')).toHaveCount(0);
    await page.locator('.ch-empty').getByRole('button', { name: 'New cluster' }).click();
    await expect(page.locator('.ch-naming')).toBeVisible();
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
    // Replies sit in the conversation, quoting what they answer: no thread badge.
    await expect(panel(page).locator('.msg-bubble-replies')).toHaveCount(0);
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
