// The tray's guide to bringing files from another app (lib/importGuide.js,
// the owner's pick D, 2026-10-20) on the import QA page (?importqa=1): the
// Upload menu opens it, the apps are tabs, each links out to its app, its
// pickers and a drop on it start the import, which the tray then shows, and
// gold is on focus and a drag over it alone. The words are pinned in
// src/lib/importGuide.test.mjs; this checks the drawing and the wiring.
import { expect, test } from '@playwright/test';

async function open(page, query) {
  const guided = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[importqa] guide ')) guided.push(t.slice('[importqa] guide '.length));
  });
  await page.goto(`/?importqa=1&${query}`);
  await page.waitForSelector('[data-importqa-ready]');
  return guided;
}
const guide = (page) => page.locator('section.imptray.is-guide');
const tab = (page, name) => guide(page).getByRole('tab', { name, exact: true });
const selected = (page) => guide(page).locator('[role="tab"][aria-selected="true"]');

test.describe('the import guide', () => {
  test("the Upload menu's last item opens it; without it the menu keeps its one line", async ({ page }) => {
    await open(page, 'menu=1');
    const item = page.locator('.sbf-upmenu').getByRole('menuitem', { name: /Bring files from another app/ });
    await expect(item).toBeVisible();
    await expect(item).toContainText('Google Drive, Dropbox and more');
    await expect(page.locator('.sbf-upmenu .sbf-upnote')).toHaveCount(0);
    await item.click();
    await expect(page.locator('.sbf-upmenu')).toHaveCount(0);
    await expect(guide(page)).toBeVisible();
    await expect(guide(page).getByText('Bring files from another app', { exact: true })).toBeVisible();
    await expect(selected(page)).toHaveText('Google Drive');
    await expect(selected(page)).toBeFocused();

    await open(page, 'menu=1&noguide=1');
    await expect(page.locator('.sbf-upmenu .sbf-upnote')).toBeVisible();
    await expect(page.locator('.sbf-upmenu').getByRole('menuitem', { name: /Bring files/ })).toHaveCount(0);
  });

  test('the apps are tabs: a click or the arrows choose, the panel follows, and the choice is remembered', async ({ page }) => {
    await open(page, 'guide=1&app=drive');
    await expect(guide(page).getByRole('tab')).toHaveText(['Google Drive', 'Google Photos', 'Dropbox', 'OneDrive', 'iCloud Drive', 'Anything else']);
    await expect(guide(page).getByRole('tabpanel')).toContainText('Google Takeout packs your whole Drive');
    await tab(page, 'Dropbox').click();
    await expect(selected(page)).toHaveText('Dropbox');
    await expect(guide(page).getByRole('tabpanel')).toContainText('Dropbox downloads the folders you pick as one zip.');
    await expect(guide(page).getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'imptray-guide-tab-dropbox');
    await page.keyboard.press('ArrowRight');
    await expect(selected(page)).toHaveText('OneDrive');
    await expect(selected(page)).toBeFocused();
    await page.keyboard.press('End');
    await expect(selected(page)).toHaveText('Anything else');
    await page.keyboard.press('ArrowRight');
    await expect(selected(page)).toHaveText('Google Drive');
    await page.keyboard.press('ArrowLeft');
    await expect(selected(page)).toHaveText('Anything else');
    await page.keyboard.press('Home');
    await expect(selected(page)).toHaveText('Google Drive');
    // Roving focus: one tab stop for the whole set.
    await expect(guide(page).locator('[role="tab"][tabindex="0"]')).toHaveCount(1);

    await tab(page, 'iCloud Drive').click();
    await open(page, 'guide=1');
    await expect(selected(page)).toHaveText('iCloud Drive');
  });

  test('each app links out to itself in a new tab; anything else has no link', async ({ page }) => {
    await open(page, 'guide=1&app=drive');
    const links = {
      'Google Drive': ['Open Google Takeout', 'https://takeout.google.com/'],
      'Google Photos': ['Open Google Takeout', 'https://takeout.google.com/'],
      Dropbox: ['Open Dropbox', 'https://www.dropbox.com/home'],
      OneDrive: ['Open OneDrive', 'https://onedrive.live.com/'],
      'iCloud Drive': ['Open iCloud.com', 'https://www.icloud.com/iclouddrive/'],
    };
    for (const [name, [label, href]] of Object.entries(links)) {
      await tab(page, name).click();
      const a = guide(page).getByRole('link');
      await expect(a).toHaveText(label);
      await expect(a).toHaveAttribute('href', href);
      await expect(a).toHaveAttribute('target', '_blank');
      await expect(a).toHaveAttribute('rel', /noopener/);
    }
    await tab(page, 'Anything else').click();
    await expect(guide(page).getByRole('link')).toHaveCount(0);
  });

  test("each app's pickers are what its download is, and a pick starts the import", async ({ page }) => {
    const guided = await open(page, 'guide=1&app=drive');
    const picks = () => guide(page).locator('footer button');
    await expect(picks()).toHaveText(['Choose zip files…']);
    await tab(page, 'Dropbox').click();
    await expect(picks()).toHaveText(['Choose a zip…', 'Choose a folder…']);
    await tab(page, 'iCloud Drive').click();
    await expect(picks()).toHaveText(['Choose a folder…', 'Choose a zip…']);

    const zip = guide(page).locator('input[data-guide-pick="zips"]');
    await expect(zip).toHaveAttribute('accept', /\.zip/);
    await expect(zip).toHaveAttribute('multiple', '');
    await zip.setInputFiles([
      { name: 'takeout-001.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') },
      { name: 'takeout-002.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') },
    ]);
    await expect.poll(() => guided).toEqual(['zips 2']);
    await expect(guide(page).locator('input[data-guide-pick="folder"]')).toHaveAttribute('webkitdirectory', '');
  });

  test('a file dragged over it lights it gold; dropped, it starts the import', async ({ page }) => {
    const guided = await open(page, 'guide=1&app=dropbox');
    const fire = (type) => page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['PK'], 'Dropbox.zip', { type: 'application/zip' }));
      const el = document.querySelector('section.imptray.is-guide .imptray-guide-body');
      el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, type);
    await fire('dragenter');
    await fire('dragover');
    await expect(guide(page)).toHaveClass(/is-over/);
    const soleil = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--soleil').trim());
    expect(soleil).not.toBe('');
    await fire('dragleave');
    await expect(guide(page)).not.toHaveClass(/is-over/);
    await fire('dragenter');
    await fire('drop');
    await expect(guide(page)).not.toHaveClass(/is-over/);
    await expect.poll(() => guided).toEqual(['files 1']);
  });

  test('the import it starts takes its place; Close and Escape put back the one under it', async ({ page }) => {
    await open(page, 'guide=1&state=run');
    await expect(guide(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(guide(page)).toHaveCount(0);
    await expect(page.locator('section.imptray')).toContainText('Importing Night Shift');

    await page.evaluate(() => window.__importQa.openGuide());
    await expect(guide(page)).toBeVisible();
    await guide(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(guide(page)).toHaveCount(0);
    await expect(page.locator('section.imptray')).toContainText('Importing Night Shift');

    // One import runs at a time: a second waits its turn behind the first.
    const takeout = () => window.__importQa.put('takeout', {
      phase: 'reading', title: 'takeout-001', reading: { files: 120, folders: 3, bytes: 1 << 20 },
    });
    await page.evaluate(() => window.__importQa.openGuide('drive'));
    await expect(guide(page)).toBeVisible();
    await page.evaluate(takeout);
    await expect(guide(page)).toHaveCount(0);
    await expect(page.locator('section.imptray')).toContainText('1 more import after this');

    await open(page, 'guide=1&app=drive');
    await expect(guide(page)).toBeVisible();
    await page.evaluate(takeout);
    await expect(guide(page)).toHaveCount(0);
    await expect(page.locator('section.imptray')).toContainText('Reading takeout-001');

    // One a reload stopped, offered again on load, is not one the guide started.
    await page.evaluate(() => window.__importQa.openGuide('drive'));
    await page.evaluate(() => window.__importQa.put('stopped-j1', {
      phase: 'stopped', title: 'Old Drive', canResume: false, landed: 10, total: 40, targetName: 'Studio',
      stopped: { jobId: 'j1', targetBoardId: 'b1', source: 'zip', tops: [], zips: [] },
    }));
    await page.waitForTimeout(150);
    await expect(guide(page)).toBeVisible();
  });

  test('the room line follows the plan, and says nothing in a workspace someone else pays for', async ({ page }) => {
    const room = () => guide(page).locator('.imptray-guide-room');
    await open(page, 'guide=1&app=drive&plan=free');
    await expect(room()).toHaveText('Free plan: 12 more files fit now; the rest waits for room.');
    await expect(room().locator('b')).toHaveText('12 more files');
    await open(page, 'guide=1&app=drive&plan=full');
    await expect(room()).toHaveText('Your free plan is full; what you bring waits for room.');
    await open(page, 'guide=1&app=drive&plan=trial');
    await expect(room()).toHaveText('87.6 GB free on your Creator trial.');
    await open(page, 'guide=1&app=drive&plan=paid');
    await expect(room()).toHaveText('412 GB free in your drive.');
    await open(page, 'guide=1&app=drive&plan=guest');
    await expect(room()).toHaveCount(0);
  });

  test('with no open cluster the steps say here; with one, anywhere in it', async ({ page }) => {
    await open(page, 'guide=1&app=drive');
    await expect(guide(page).locator('.imptray-step').last()).toHaveText(/4Drop all the parts anywhere in Studio at once\./);
    await open(page, 'guide=1&app=drive&target=0');
    await expect(guide(page).locator('.imptray-step').last()).toHaveText(/4Drop all the parts here at once\./);
  });

  test('on a phone it sits over the nav, has no folder picker, and says to choose the zip', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'guide=1&app=icloud&phone=1');
    await expect(guide(page)).toHaveClass(/is-above-nav/);
    await expect(guide(page).getByRole('tabpanel')).toContainText('Touch and hold the folder you want, then tap Compress.');
    await expect(guide(page).locator('footer button')).toHaveText(['Choose a zip…']);
    await expect(guide(page).locator('input[data-guide-pick="folder"]')).toHaveCount(0);
    await expect(guide(page).getByRole('link')).toHaveCount(0);
    const box = await guide(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  test('gold is on focus alone: the chosen app is a neutral selection, in both themes', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await open(page, `guide=1&app=onedrive&theme=${theme}`);
      await page.evaluate(() => document.activeElement?.blur());
      const looks = await selected(page).evaluate((el) => {
        const cs = getComputedStyle(el);
        const probe = document.createElement('i');
        probe.style.color = 'var(--soleil)';
        document.body.appendChild(probe);
        const gold = getComputedStyle(probe).color;
        probe.remove();
        return { gold, all: [cs.backgroundColor, cs.boxShadow, cs.color, cs.outlineColor, cs.borderColor].join(' | '), outline: cs.outlineStyle };
      });
      expect(looks.all.includes(looks.gold), `${theme}: ${looks.all}`).toBe(false);
      await selected(page).focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowRight');
      await expect(selected(page)).toHaveCSS('outline-style', 'solid');
    }
  });
});
