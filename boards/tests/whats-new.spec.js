// The one-time "New" hint on the Files card (components/whatsNew), as an
// account from before the files sidebar gets it, driven through the sidebar
// harness (?sidebarqa=1&whatsnew=1: the real WhatsNewHint over the real
// sidebar, its record written to the harness's log as "whatsnew <action>"
// instead of a profile; &whatsnew=again keeps this device's mark). The words,
// who gets it and where it sits are lib/whatsNew.test.mjs.
import { expect, test } from '@playwright/test';

const hint = (page) => page.locator('.wn-hint');
const log = (page) => page.getByTestId('sbqa-log');

async function open(page, q = 'whatsnew=1') {
  await page.goto(`/?sidebarqa=1&${q}`);
  await page.waitForSelector('[data-sidebarqa-ready]');
}
// On screen: placed (past the hidden first measure) with its tail drawn.
async function up(page) {
  await expect(hint(page)).toBeVisible({ timeout: 12_000 });
  await expect(hint(page).locator('.wn-tail')).toHaveCount(1);
}
// Longer than it waits before it shows, plus a look or two.
const PAST_ITS_TURN = 6_500;

test.describe('on a computer', () => {
  test('a moment after the page opens it sits beside the sidebar, its tail on the word Files', async ({ page }) => {
    await open(page);
    await expect(hint(page)).toHaveCount(0);
    await up(page);
    await expect(hint(page).getByRole('heading', { name: 'A visual refresh, and a home for your files' })).toBeVisible();
    await expect(hint(page)).toContainText('Upload any file and it stays here in Files, whether it’s on a board or not. This lists every file in Feature film.');
    const at = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const h = box('.wn-hint'); const t = box('.wn-tail'); const f = box('.sbf-frame'); const l = box('.sbf-files-heading-label');
      return { left: h.left, frameRight: f.right, tailMid: t.top + t.height / 2, labelMid: l.top + l.height / 2 };
    });
    expect(Math.abs(at.left - (at.frameRight + 12))).toBeLessThan(1);
    expect(Math.abs(at.tailMid - at.labelMid)).toBeLessThan(1.5);
    await expect(log(page)).toContainText('whatsnew shown');
  });

  test('Got it ends it, and this device never sees it again', async ({ page }) => {
    await open(page);
    await up(page);
    await hint(page).getByRole('button', { name: 'Got it' }).click();
    await expect(hint(page)).toHaveCount(0);
    await expect(log(page)).toContainText('whatsnew dismissed');
    await open(page, 'whatsnew=again');
    await page.waitForTimeout(PAST_ITS_TURN);
    await expect(hint(page)).toHaveCount(0);
  });

  test('What else is new opens the changelog in a new tab, and ends it', async ({ page, context }) => {
    await open(page);
    await up(page);
    const link = hint(page).getByRole('link', { name: 'What else is new' });
    await expect(link).toHaveAttribute('href', '/changelog');
    await expect(link).toHaveAttribute('target', '_blank');
    const [tab] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await expect(hint(page)).toHaveCount(0);
    await expect(log(page)).toContainText('whatsnew changelog');
    expect(new URL(tab.url()).pathname).toBe('/changelog');
  });

  test('Escape inside it ends it, and so does folding the Files card away', async ({ page }) => {
    await open(page);
    await up(page);
    await hint(page).getByRole('button', { name: 'Got it' }).focus();
    await page.keyboard.press('Escape');
    await expect(hint(page)).toHaveCount(0);
    await expect(log(page)).toContainText('whatsnew dismissed');

    await open(page);
    await up(page);
    await page.getByRole('button', { name: 'Hide files' }).click();
    await expect(hint(page)).toHaveCount(0);
    await expect(log(page)).toContainText('whatsnew dismissed');
  });

  test('it waits behind a dialog, and shows once the dialog has gone', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'qa-dialog';
      d.setAttribute('aria-modal', 'true');
      document.body.appendChild(d);
    });
    await page.waitForTimeout(PAST_ITS_TURN);
    await expect(hint(page)).toHaveCount(0);
    await page.evaluate(() => document.getElementById('qa-dialog').remove());
    await up(page);
  });

  test('it waits while the Recent tab is on, since its words name a cluster', async ({ page }) => {
    await open(page);
    await page.locator('.sbf-files').getByRole('tab', { name: 'Recent', exact: true }).click();
    await page.waitForTimeout(PAST_ITS_TURN);
    await expect(hint(page)).toHaveCount(0);
    await page.locator('.sbf-files').getByRole('tab', { name: 'Feature film', exact: true }).click();
    await up(page);
  });
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('it hangs under the cluster’s tab in the open drawer, with a finger’s room on both ways out', async ({ page }) => {
    await open(page);
    await up(page);
    await expect(hint(page)).toContainText('Upload any file and it stays here in Files. Search it, or open it as a full page.');
    const at = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const h = box('.wn-hint'); const t = box('.wn-tail');
      const tab = box('.sidebar.is-mobile-open .sbf-tab.is-cluster'); const d = box('.sidebar.is-mobile-open');
      return { top: h.top, left: h.left, right: h.right, tailMid: t.left + t.width / 2, tabMid: tab.left + tab.width / 2, tabBottom: tab.bottom, dLeft: d.left, dRight: d.right };
    });
    expect(Math.abs(at.top - (at.tabBottom + 12))).toBeLessThan(1);
    expect(Math.abs(at.tailMid - at.tabMid)).toBeLessThan(1.5);
    expect(Math.abs(at.left - (at.dLeft + 8))).toBeLessThan(1);
    expect(Math.abs(at.right - (at.dRight - 8))).toBeLessThan(1);
    for (const name of ['Got it', 'What else is new']) {
      const b = await hint(page).getByRole(name === 'Got it' ? 'button' : 'link', { name }).boundingBox();
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('with the drawer shut it waits for the person to open it, and ends when they shut it', async ({ page }) => {
    // The Files page starts with the drawer shut, as App leaves it after ⤢.
    await open(page, 'whatsnew=1&surface=files');
    await page.waitForTimeout(PAST_ITS_TURN);
    await expect(hint(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await up(page);
    await page.evaluate(() => document.querySelector('.sidebar').classList.remove('is-mobile-open'));
    await expect(hint(page)).toHaveCount(0);
    await expect(log(page)).toContainText('whatsnew dismissed');
  });
});
