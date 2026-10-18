import { expect, test } from '@playwright/test';

// SHELL-06: the phone topbar must fit its controls, Share last, inside the
// viewport. It used to carry Back, Forward, Search, History, Help and Feedback
// as well, ~540px of fixed-width buttons in a 390px bar, and with #root
// overflow:hidden the controls past the edge (Share among them) were simply
// gone.
//
// ?local=1 mounts its own, smaller topbar (LocalBoardsApp), not App.jsx's, and
// the real one needs a signed-in workspace. So this boots the harness (all the
// real CSS, the phone media query and the real ViewSwitch node) and rebuilds
// .topbar with exactly the set App.jsx renders when mobileShell is true —
// classes and nesting copied from App.jsx. If you add a control to the phone
// topbar there, add it to PHONE_RIGHT below or this check is testing a bar
// that no longer exists.

test.use({ hasTouch: true, isMobile: true });

// peers: how many other people are online; viewOnly drops Undo/Redo for the
// VIEW ONLY pill, as App.jsx does on a phone.
function buildTopbar({ peers, viewOnly }) {
  // Runs in the page, so everything it uses lives inside it.
  const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" /></svg>';
  const topbar = document.querySelector('.topbar');
  const pill = topbar.querySelector('.view-pill');
  const btn = (cls, title) => `<button class="${cls}" title="${title}" aria-label="${title}">${ICON}</button>`;
  const shown = Math.min(peers, 1);   // App.jsx: max={mobileShell ? 1 : 4}
  const avatars = Array.from({ length: shown }, (_, i) => `<button class="ws-presence-avatar" style="background:#4f8df8">${'ABCD'[i]}</button>`).join('')
    + (peers > shown ? `<span class="ws-presence-avatar ws-presence-overflow">+${peers - shown}</span>` : '');
  topbar.innerHTML = `
    <div class="tb-left">
      ${btn('tb-icon', 'Open menu')}
      <div class="crumbs">
        <span class="crumb clk">Production</span><span class="crumb-sep">›</span>
        <span class="crumb clk">Moodboards and references</span><span class="crumb-sep">›</span>
        <span class="crumb here">Lookbook final picks</span>
      </div>
    </div>
    <div class="tb-center"></div>
    <div class="tb-right">
      ${viewOnly ? '' : btn('tb-icon', 'Undo') + btn('tb-icon', 'Redo')}
      <span class="tb-divider"></span>
      <div class="ws-presence"><span class="ws-presence-status on"></span>${avatars}</div>
      <span class="tb-divider"></span>
      ${viewOnly ? '<span class="tb-viewonly">VIEW ONLY</span>' : ''}
      <button class="tb-btn tb-share" data-probe="share" title="Share this cluster" aria-label="Share this cluster">${ICON.replace(/16/g, '14')} <span class="tb-btn-label">Share</span></button>
      ${btn('tb-icon tb-icon-theme', 'Toggle theme')}
      ${btn('tb-icon tb-icon-split', 'Pin alongside')}
    </div>`;
  topbar.querySelector('.tb-center').appendChild(pill);
}

for (const width of [390, 360]) {
  for (const scheme of ['dark', 'light']) {
    for (const [label, opts] of [
      ['alone', { peers: 0, viewOnly: false }],
      ['with one person', { peers: 1, viewOnly: false }],
      ['with six people', { peers: 6, viewOnly: false }],
      ['view only, with two people', { peers: 2, viewOnly: true }],
    ]) {
      test(`phone topbar fits at ${width}px, ${scheme}, ${label}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('/?local=1&reset=1&blank=1');
        await page.locator('.topbar .view-pill').waitFor({ timeout: 30000 });
        await page.evaluate(buildTopbar, opts);
        // The harness keeps its own theme; set the rendered one directly.
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), scheme);

        const report = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const out = [];
          for (const el of document.querySelectorAll('.topbar .tb-left > *, .topbar .tb-center > *, .topbar .tb-right > *, .topbar .ws-presence > *')) {
            if (getComputedStyle(el).display === 'none') continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${el.className || el.tagName} ${Math.round(r.left)}-${Math.round(r.right)} of ${vw}`);
          }
          const tb = document.querySelector('.topbar');
          const here = document.querySelector('.topbar .crumb.here').getBoundingClientRect();
          return { offscreen: out, overflow: tb.scrollWidth - tb.clientWidth, hereWidth: here.width };
        });
        expect(report.offscreen).toEqual([]);
        expect(report.overflow).toBeLessThanOrEqual(0);
        // The name of the cluster you are in stays readable, not a 0px crumb.
        expect(report.hereWidth).toBeGreaterThanOrEqual(48);

        const share = page.locator('[data-probe="share"]');
        await expect(share).toBeVisible();
        // Tap target: the plan's floor for phone chrome.
        const box = await share.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(40);
        expect(box.height).toBeGreaterThanOrEqual(40);
        if (process.env.TOPBAR_SHOTS) {
          await page.locator('.topbar').screenshot({ path: `${process.env.TOPBAR_SHOTS}/topbar-${width}-${scheme}-${label.replace(/\W+/g, '-')}.png` });
        }
      });
    }
  }
}
