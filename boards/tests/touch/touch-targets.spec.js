// Every control a finger can see must be one a finger can take, on every touch
// device: a hit area of at least 40px each way (measured the way a tap finds it,
// as tests/touch/helpers.js hitBox does, all in one pass so a page that
// re-renders as it settles can't lose a control between steps), text fields at 16px or more (smaller and iOS
// zooms the page in on focus), and nothing tappable sitting invisible at rest.
//
// The pages are the dev-only harnesses that draw the new tools with no backend,
// plus the local app's canvas and Files, some with a menu or a popover opened
// first. A control is a button, a link, a field or a role, or anything else
// with a pointer cursor (a breadcrumb, a zoom readout). A control that is small
// on purpose goes in ALLOW with the reason; a failure prints every offender.
import { expect, test } from '@playwright/test';

const tapOn = async (page, sel) => {
  const el = page.locator(sel).first();
  if (!(await el.isVisible())) return false;
  await el.tap();
  return true;
};

// `open` runs once the page is ready: false skips the page on this device (its
// way in isn't drawn here, e.g. the floating bar's ⋯ in the phone's drawer).
// `scope`: what it opened, the only part judged (the page under it has its own
// test, and an open menu half-covers whatever it hangs over).
// Home with `drawer=0`: on a phone the harness opens the drawer over it, as
// the menu button would.
const PAGES = [
  { name: 'sidebar + board', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]' },
  { name: 'home', url: '/?sidebarqa=1&surface=home&drawer=0', ready: '[data-sidebarqa-ready]' },
  { name: 'home naming', url: '/?sidebarqa=1&surface=home&drawer=0', ready: '[data-sidebarqa-ready]',
    // The map's bottom bar, or a phone's row under the search.
    open: (page) => tapOn(page, '.ch-bar .ch-quiet, .ch-find-row .ch-quiet'), scope: '.ch-naming' },
  { name: 'bar menu', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.chrome-more-btn'), scope: '.chrome-menu' },
  { name: 'new cluster', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.tb-newcluster'), scope: '.ncl-pop' },
  { name: 'cluster switcher', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.sbf-tab.is-cluster'), scope: '.sbf-switch' },
  { name: 'files filter', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.sbf-filter-btn'), scope: '.sbf-menu' },
  { name: 'import tray', url: '/?importqa=1', ready: '#root[data-importqa-ready]' },
  { name: 'import guide', url: '/?importqa=1&guide=1', ready: '#root[data-importqa-ready]' },
  { name: 'import ask', url: '/?importqa=1&dialog=free', ready: '#root[data-importqa-ready]' },
  { name: 'upload menu', url: '/?importqa=1&menu=1', ready: '#root[data-importqa-ready]' },
  { name: 'canvas', url: '/?local=1&reset=1', ready: '.canvas-wrap .card' },
  { name: 'files', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await page.locator('.view-pill--primary .view-pill-btn').nth(1).tap();
      await page.locator('.list-wrap .ct-tile').first().waitFor();
      return true;
    } },
];

// selector → why it may be smaller than a finger.
const ALLOW = {
  // The sidebar harness's own readout and fake canvas, not app chrome.
  '.sbqa-readout, .sbqa-readout *': 'harness readout',
  '.sbqa-card, .sbqa-card *': 'harness stand-in card',
  // The local app still draws the old workspace rail; the app dropped it.
  '.rail, .rail *': 'local harness only',
  // Inside a card: drawn at the board's zoom, like the card itself. Zoom in to
  // use them; the selection's ⋯ is the route that holds at every zoom.
  '.canvas .card, .canvas .card *': 'card content, scaled with the board',
  // Messages belongs to the messages-rework session; its findings were handed over.
  '.msg-panel, .msg-panel *': 'Messages UI (handed to its own session)',
};

async function audit(page, scope = null) {
  return page.evaluate(([allow, scope]) => {
    const out = [];
    const SEL = 'button, [role=button], a[href], input:not([type=hidden]), select, textarea, [role=menuitem], [role=tab], [role=option], [role=switch], [role=checkbox], [contenteditable=true]';
    const allowed = (el) => Object.keys(allow).some((s) => { try { return el.matches(s); } catch (_) { return false; } });
    const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
    const name = (el) => {
      const cls = [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tip') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      return `${el.tagName.toLowerCase()}${cls}${label ? ` "${label}"` : ''}`;
    };
    // The outermost element of a pointer-cursor patch that isn't a control
    // already (cursor inherits, so its children all say pointer too).
    const pointerOnly = (el) => !el.matches(SEL) && !el.closest(SEL)
      && getComputedStyle(el).cursor === 'pointer'
      && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer');
    // Partly scrolled out of its list, or off the screen: a scroll away from
    // whole, so it's judged where it shows whole. A list's own pinned foot (a
    // sticky row at its bottom, the drawer's meter) is where its view ends.
    const stickies = [...document.querySelectorAll('body *')].filter((k) => getComputedStyle(k).position === 'sticky');
    const scrolledOut = (el, r) => {
      if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) return true;
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const o = getComputedStyle(n);
        if (!/auto|scroll/.test(o.overflowX + o.overflowY)) continue;
        if (n.scrollHeight <= n.clientHeight && n.scrollWidth <= n.clientWidth) continue;
        const b = n.getBoundingClientRect();
        let bottom = b.bottom;
        for (const k of stickies) {
          if (!n.contains(k) || k.contains(el)) continue;
          const kr = k.getBoundingClientRect();
          if (kr.height > 0 && kr.top > r.top && kr.bottom >= b.bottom - kr.height - 64) bottom = Math.min(bottom, kr.top);
        }
        if (r.top < b.top - 0.5 || r.bottom > bottom + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5) return true;
      }
      return false;
    };
    // helpers.js hitBox: walk out from the centre while a tap there still lands
    // on the control. Covered at its centre: under a menu or a sheet right now.
    const hitOf = (el, r) => {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hits = (x, y) => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        const at = document.elementFromPoint(x, y);
        return !!at && (at === el || el.contains(at));
      };
      if (!hits(cx, cy)) return { covered: true };
      const run = (dx, dy) => {
        let n = 0;
        while (n < 40 + Math.max(r.width, r.height) && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
        return n;
      };
      return { w: run(-1, 0) + run(1, 0) + 1, h: run(0, -1) + run(0, 1) + 1 };
    };
    for (const el of document.querySelectorAll('body *')) {
      if (scope && !el.closest(scope)) continue;
      if (!el.matches(SEL) && !pointerOnly(el)) continue;
      if (el.disabled || el.closest('[inert], [aria-hidden=true]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
      if (allowed(el) || scrolledOut(el, r)) continue;
      const field = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]), textarea, [contenteditable=true]');
      out.push({ name: name(el), field, fontSize: parseFloat(cs.fontSize), opacity: opacityOf(el), box: hitOf(el, r) });
    }
    return out;
  }, [ALLOW, scope]);
}

for (const p of PAGES) {
  test(`${p.name}: every control fits a finger`, async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('soleil.dev.sidebarFiles', '1');
        localStorage.setItem('soleil.dev.bulkImport', '1');
        localStorage.setItem('soleil.dev.clusterNudges', '1');
      } catch (_) {}
    });
    await page.goto(p.url);
    await page.waitForSelector(p.ready, { timeout: 30000 });
    // What only the dev harness draws: the LOCAL QA banner over the bar's top
    // edge, and the tweaks gear in the corner.
    await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
    // Home's map fades its names in once the sky is drawn.
    if (await page.locator('.hg-map').count()) await page.locator('.hg-map.is-ready').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    if (p.open) {
      const shown = await p.open(page);
      test.skip(!shown, `${p.name} isn't reached this way on this device`);
      await page.waitForTimeout(500);
    }
    const found = await audit(page, p.scope);
    if (p.scope) expect(found.length, `${p.name}: nothing to judge in ${p.scope}`).toBeGreaterThan(0);
    const bad = [];
    for (const c of found) {
      if (c.opacity < 0.05) { bad.push(`${c.name}: invisible at rest (opacity ${c.opacity.toFixed(2)})`); continue; }
      if (c.field && c.fontSize < 16) bad.push(`${c.name}: field text ${c.fontSize}px (iOS zooms below 16)`);
      const { box } = c;
      if (box.covered) continue;  // under something else right now (a menu, a sheet): not reachable to judge
      // A pixel of slack: a 40px control flush with the screen's edge, or on a
      // half-pixel, measures 39.
      if (Math.min(box.w, box.h) < 39) bad.push(`${c.name}: hit area ${box.w}×${box.h}`);
    }
    expect(bad, `${p.name} — controls a finger can't take:\n  ${bad.join('\n  ')}`).toEqual([]);
  });
}
