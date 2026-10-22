// Emails › Impact (0494; the owner's pick of 2026-10-20, "Over time").
//
// On the DEV-only fixture harness (?adminpreview=1): no auth, no network. The
// figures are invented, on a fixed calendar read on Wednesday 2026-10-21, so the
// dated record of what changed (lib/emailChanges.js) lands inside the weeks.

import { test, expect } from '@playwright/test';

async function openEmails(page, { theme = 'dark', query = '' } = {}) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('soleil.ui', JSON.stringify({ theme: t }));
      window.localStorage.removeItem('admin.emails.view');
      document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }
  }, theme);
  await page.goto(`/?adminpreview=1&tab=emails${query}`);
}

const opensWell = (page) => page.locator('.eml-mult').first();
const sendsWell = (page) => page.locator('.eml-mult').nth(1);
const views = (page) => page.getByRole('tablist', { name: 'Email views' });

// Answers the named RPCs with `value` instead of the fixture.
async function patchRpc(page, overrides) {
  await page.evaluate(async (ov) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const orig = supabase.rpc;
    supabase.rpc = (name, params) => (Object.prototype.hasOwnProperty.call(ov, name)
      ? Promise.resolve(ov[name])
      : orig(name, params));
  }, overrides);
}

test.describe('Emails › Impact', () => {
  test('opens on Impact, under the conditions it measures in', async ({ page }) => {
    await openEmails(page);
    await expect(views(page).getByRole('tab', { name: 'Impact' })).toHaveAttribute('aria-selected', 'true', { timeout: 20000 });
    await expect(page.locator('.eml-row').first()).toBeVisible({ timeout: 20000 });
    const status = page.getByRole('note', { name: 'Current measurement conditions' });
    await expect(status).toContainText('18 wk UTC, from Jun 22 · 3 of 7 days');
    await expect(status).toContainText('within 3 days of the send');
    await expect(status).toContainText('team and banned left out');

    // The band: this month, the three months, and what is due next.
    const band = page.locator('.eml-band');
    await expect(band.locator('.eml-ban-k')).toHaveText('Opened in October so far');
    await expect(band.locator('.eml-mo')).toHaveCount(3);
    await expect(band.locator('.eml-mo-h').last()).toContainText('October so far');
    await expect(band.locator('.eml-ban-now')).toHaveText(/Oct 26\s*inbox read, in 5 days/);
  });

  test('opens: every email, then each one that sent across the split, with the line that rules out the address', async ({ page }) => {
    await openEmails(page);
    const well = opensWell(page);
    await expect(well.locator('.eml-grp').first()).toContainText(/About \d+% opened in August, \d+% in September, \d+% so far in October\./, { timeout: 20000 });
    await expect(well.locator('.eml-grp').nth(1))
      .toContainText('Two of the four halved after Sep 20. Your cluster is waiting and the first nudge did not.');
    await expect(well.locator('.eml-row')).toHaveCount(5);
    await expect(well.locator('.eml-row .eml-name')).toHaveText(['Every email', 'Welcome', 'Second nudge', 'Your cluster is waiting', 'First nudge']);
    await expect(well.locator('.adm-well-meta')).toHaveText('four emails that sent across Sep 20');
    await expect(well.locator('.adm-well-foot')).toHaveText(
      'All four send from the same address, and Your cluster is waiting and the first nudge did not halve, so the address alone does not explain the drop.');
    // The welcome's gap is shaded on its own row, and only there.
    await expect(well.locator('.eml-row[data-row="welcome_board"] .eml-gap')).toHaveCount(1);
    await expect(well.locator('.eml-gap')).toHaveCount(1);
  });

  test('a week read by pointer and by keyboard says the same thing', async ({ page }) => {
    await openEmails(page);
    const well = opensWell(page);
    const welcome = well.locator('.eml-row[data-row="welcome_board"]');
    await expect(welcome).toBeVisible({ timeout: 20000 });
    await welcome.locator('.eml-hit').nth(15).hover({ force: true });
    const tip = welcome.locator('.eml-tip');
    await expect(tip.locator('.eml-tip-w')).toHaveText('week of Oct 5 · Welcome');
    await expect(tip.locator('.eml-tip-v')).toHaveText(/^\d+%\d+ of \d+ opened$/);
    await expect(welcome.locator('.eml-dot.is-on')).toHaveCount(1);
    await expect(well.locator('[aria-live]')).toContainText('week of Oct 5 · Welcome.');

    // The keyboard: End reads this week on the first row, Left a week back,
    // Down the next email, and Escape lets go.
    await page.mouse.move(2, 2);
    await expect(well.locator('.eml-tip')).toHaveCount(0);
    await well.focus();
    await page.keyboard.press('End');
    await expect(well.locator('.eml-row').first().locator('.eml-tip-w')).toHaveText('this week so far · Every email');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await expect(welcome.locator('.eml-tip-w')).toHaveText('week of Oct 12 · Welcome');
    await expect(well.locator('[aria-live]')).toContainText('week of Oct 12 · Welcome.');
    await page.keyboard.press('Escape');
    await expect(well.locator('.eml-tip')).toHaveCount(0);
  });

  test('what changed: each entry worked out from the read, and the one pointed at lit on every row', async ({ page }) => {
    await openEmails(page);
    const list = page.locator('.eml-changes');
    await expect(list.locator('.adm-well-meta')).toHaveText('8 since Jun 22, and one due', { timeout: 20000 });
    const rows = list.locator('.eml-chg');
    await expect(rows).toHaveCount(9);
    await expect(rows.filter({ hasText: 'No welcome emails, Sep 6 to 16' })).toContainText('0 of 27 new accounts in the week of Sep 7');
    await expect(rows.filter({ hasText: 'Invite abuse' })).toContainText('opens halved for 2 of the 4 emails that sent across it');
    await expect(rows.filter({ hasText: 'with a group held out' })).toContainText('8 held back so far');
    // What is due is listed last and quieter, and takes no focus: there is nothing to light.
    const due = rows.last();
    await expect(due).toHaveClass(/is-next/);
    await expect(due).not.toHaveAttribute('tabindex', '0');

    // Every row that draws the split day lights it: all five opens rows and all seven send rows.
    await rows.filter({ hasText: 'Invite abuse' }).hover();
    await expect(page.locator('.eml-mk.is-on')).toHaveCount(12);
    await expect(rows.filter({ hasText: 'Invite abuse' })).toHaveClass(/is-on/);
    // A change about one email lights only that email's rows.
    await rows.filter({ hasText: 'Second nudge paused' }).focus();
    await expect(page.locator('.eml-mk.is-on')).toHaveCount(2);
  });

  test('sends: sending now and paused or stopped, the group held back beside what was sent', async ({ page }) => {
    await openEmails(page);
    const well = sendsWell(page);
    await expect(well.locator('.eml-grp').first()).toContainText(
      'The welcome every week but one; the first nudge every week; Your cluster is waiting again since the week of Oct 5.', { timeout: 20000 });
    await expect(well.locator('.eml-grp').nth(1)).toContainText('None of these has gone out this week or last.');
    await expect(well.locator('.eml-row .eml-name')).toHaveText(
      ['Welcome', 'First nudge', 'Your cluster is waiting', 'Second nudge', 'Early nudge', 'What’s new', 'Come back']);
    const waiting = well.locator('.eml-row[data-row="board_waiting"]');
    await expect(waiting.locator('.eml-val')).toHaveText('79sent · 8 held back');
    await expect(waiting.locator('.eml-when').nth(1)).toHaveText('held back: 1 made something');
    await expect(waiting.locator('.eml-bar.is-held')).toHaveCount(3);
    await expect(well.locator('.eml-row[data-row="activate_nudge_2"] .eml-when').last()).toHaveText('last sent Oct 4');
    await expect(well.locator('.eml-key')).toContainText('held back');
  });

  test('the welcome: by sign-up week, the stall named, the weeks still filling drawn hollow', async ({ page }) => {
    await openEmails(page);
    const plate = page.locator('.eml-go-plate');
    await expect(plate.locator('.eml-val')).toHaveText('0in the week of Sep 7', { timeout: 20000 });
    await expect(plate.locator('.eml-when')).toHaveText('usually about 71 per 100');
    await expect(plate.locator('.eml-zl')).toHaveText('0 of 27');
    await expect(plate.locator('.eml-wbar.is-zero')).toHaveCount(1);
    await expect(plate.locator('.eml-wbar.is-part')).toHaveCount(2);
    await expect(plate.locator('.adm-well-foot')).toHaveText(
      'The week of Sep 7: 0 of 27 new accounts got a welcome. No welcome went out Sep 6 to 16; sending resumed Sep 17.');
    await plate.locator('.eml-go').focus();
    await page.keyboard.press('End');
    await expect(plate.locator('.eml-tip-w')).toHaveText('signed up this week so far');
    await expect(plate.locator('.eml-tip')).toContainText('still filling');
  });

  test('Detail opens on what it counts', async ({ page }) => {
    await openEmails(page);
    const detail = page.locator('.adm-email-details');
    await expect(detail.locator('.adm-detail-count')).toHaveText(['from Jun 22', '16 since Jun 22', '18 lines across 7 emails'], { timeout: 20000 });
    await detail.getByRole('button', { name: /Opens by mailbox/ }).click();
    const boxes = detail.locator('.mny-tbl').first().locator('tbody tr');
    await expect(boxes).toHaveCount(5);
    await expect(boxes.first().locator('td').first()).toHaveText('Gmail');
    await expect(boxes.last().locator('td').first()).toHaveText('Everything else');
    await expect(detail.locator('.eml-note')).toContainText('Apple Mail');
    await detail.getByRole('button', { name: /Sends that never arrived/ }).click();
    await expect(detail.getByRole('cell', { name: 'failed on our side' })).toHaveCount(1);
    await detail.getByRole('button', { name: /Every subject and body test/ }).click();
    await expect(detail.locator('tr.eml-arm-first')).toHaveCount(7);
  });

  test('a read that fails says so, and never shows a zero', async ({ page }) => {
    await openEmails(page);
    await expect(page.locator('.eml-row').first()).toBeVisible({ timeout: 20000 });
    await patchRpc(page, { admin_email_impact: { data: null, error: { message: 'boom' } } });
    // A refresh that fails keeps the last read on screen, and says so.
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect(page.locator('.admin-stale-notice')).toContainText('Couldn’t refresh', { timeout: 15000 });
    await expect(page.locator('.eml-row').first()).toBeVisible();
    // A fresh mount of the view, with the read failing from the start: no chart, no figure.
    await views(page).getByRole('tab', { name: 'Delivery' }).click();
    await views(page).getByRole('tab', { name: 'Impact' }).click();
    await expect(page.locator('.admin-error')).toContainText('Couldn’t load this data', { timeout: 15000 });
    await expect(page.locator('.admin-error').getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.locator('.eml-row')).toHaveCount(0);
    await expect(page.locator('.eml-ban-d')).toHaveCount(0);
    await expect(page.getByRole('note', { name: 'Current measurement conditions' })).toContainText('18 wk UTC');
  });

  test('the other two views, by arrow key and by link, and the choice is kept', async ({ page }) => {
    await openEmails(page);
    const impact = views(page).getByRole('tab', { name: 'Impact' });
    await expect(impact).toHaveAttribute('aria-selected', 'true', { timeout: 20000 });
    await impact.focus();
    await page.keyboard.press('ArrowRight');
    await expect(views(page).getByRole('tab', { name: 'Delivery' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.admin-emails .admin-section-title', { hasText: /template/i }).first()).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(views(page).getByRole('tab', { name: 'Stream' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.admin-emails .admin-feedback-row')).toHaveCount(6);
    await expect(page).toHaveURL(/view=stream/);
    expect(await page.evaluate(() => window.localStorage.getItem('admin.emails.view'))).toBe('stream');

    const other = await page.context().newPage();
    await other.goto('/?adminpreview=1&tab=emails&view=delivery');
    await expect(other.getByRole('tablist', { name: 'Email views' }).getByRole('tab', { name: 'Delivery' }))
      .toHaveAttribute('aria-selected', 'true', { timeout: 20000 });
    await other.close();
  });

  test('on a phone the rows stack and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openEmails(page, { theme: 'light' });
    await expect(page.locator('.eml-row').first()).toBeVisible({ timeout: 20000 });
    const cols = await page.locator('.eml-row').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(1);
    await page.locator('.adm-email-details .adm-detail-trigger').evaluateAll((bs) => bs.forEach((b) => b.click()));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
