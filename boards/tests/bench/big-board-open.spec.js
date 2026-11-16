// Speed bench: opening a big, picture-heavy cluster in the public share viewer.
// Skipped unless BENCH is set, so normal e2e runs never execute it.
//
//   BENCH=1 BENCH_LABEL=baseline npx playwright test tests/bench/big-board-open.spec.js \
//     --project=desktop-chrome --workers=1 --repeat-each=2
//
// 300 image cards (20x15), served from a modelled shared link: every response
// finishes at max(now, linkFreeAt) + bytes/BW (+120ms latency), so the bench
// sees how many bytes the viewer asks for, not just how many requests.
//
// DOM signals (components/R2Image.jsx, styles.css .r2p-*):
//   blur shown : an <img class="r2p-blur"> exists inside a card (.r2p)
//   pictured   : the card's <img class="r2p-img is-loaded"> has src on imgcdn.test,
//                complete && naturalWidth > 0 (is-loaded gates opacity: 1)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { TOKEN, ROOT_ID, makeBundles, snapshotB64, routeShareBundle, routeAnalytics } from '../helpers/share-fixture.js';
import { makeBenchImages, FIXTURE_DIR, SOURCE_COUNT } from './make-bench-images.mjs';

test.skip(!process.env.BENCH, 'speed bench: set BENCH=1 to run');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '../../test-results/bench');
const LABEL = process.env.BENCH_LABEL || 'run';

const COLS = 20, ROWS = 15, COUNT = COLS * ROWS;
const BW = 1.5 * 1024 * 1024;   // bytes per second, shared by every response
const LATENCY_MS = 120;
const HOLD_MS = 10_000;

const SCENARIOS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const MIME = { jpg: 'image/jpeg', webp: 'image/webp' };

function buildBoard(manifest) {
  const cards = {};
  const urls = {};
  const meta = {};
  for (let i = 0; i < COUNT; i++) {
    const s = i % SOURCE_COUNT;
    const f = manifest.sources[s].files;
    const key = `ws1/img-${i}.jpg`;
    const lg = `ws1/img-${i}.lg.webp`, sm = `ws1/img-${i}.sm.webp`, xs = `ws1/img-${i}.xs.webp`;
    cards[`card-img-${i}`] = {
      kind: 'image', src: `r2:${key}`,
      x: (i % COLS) * 460 + 100, y: Math.floor(i / COLS) * 360 + 100, w: 400, h: 300,
    };
    urls[key] = `https://imgcdn.test/orig-${s}.jpg?c=${i}`;
    urls[lg] = `https://imgcdn.test/lg-${s}.webp?c=${i}`;
    urls[sm] = `https://imgcdn.test/sm-${s}.webp?c=${i}`;
    urls[xs] = `https://imgcdn.test/xs-${s}.webp?c=${i}`;
    meta[key] = {
      blur: manifest.sources[s].blur,
      preview: lg, preview_w: f[`lg-${s}.webp`].w, preview_h: f[`lg-${s}.webp`].h,
      preview_sm: sm, preview_sm_w: f[`sm-${s}.webp`].w, preview_sm_h: f[`sm-${s}.webp`].h,
      preview_xs: xs, preview_xs_w: f[`xs-${s}.webp`].w, preview_xs_h: f[`xs-${s}.webp`].h,
      w: f[`orig-${s}.jpg`].w, h: f[`orig-${s}.jpg`].h,
    };
  }
  return { cards, urls, meta };
}

// Runs in the page. Polls every animation frame; timestamps are Date.now().
function installProbe() {
  const B = (window.__bench = { tFirstBlur: null, tAllPictured: null, snaps: {} });
  const tierOf = (src) => {
    const m = /imgcdn\.test\/(orig|lg|sm|xs)-/.exec(src || '');
    return m ? m[1] : 'other';
  };
  const inView = (r) => r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && r.width > 0 && r.height > 0;
  const shown = (img) => !!img && img.classList.contains('is-loaded')
    && /imgcdn\.test/.test(img.src) && img.complete && img.naturalWidth > 0;
  const snapshot = () => {
    const hist = { xs: 0, sm: 0, lg: 0, orig: 0, other: 0, notShown: 0 };
    let cardsInView = 0;
    for (const card of document.querySelectorAll('.r2p')) {
      if (!inView(card.getBoundingClientRect())) continue;
      cardsInView++;
      const img = card.querySelector('img.r2p-img');
      if (shown(img)) hist[tierOf(img.currentSrc || img.src)]++; else hist.notShown++;
    }
    let texBytes = 0, shownImgs = 0;
    for (const img of document.querySelectorAll('img.r2p-img')) {
      if (!shown(img)) continue;
      shownImgs++;
      texBytes += img.naturalWidth * img.naturalHeight * 4;
    }
    return { t: Date.now(), cardsInView, hist, shownImgs, textureMB: +(texBytes / 1048576).toFixed(1) };
  };
  const tick = () => {
    const now = Date.now();
    if (B.tFirstBlur == null && document.querySelector('.r2p .r2p-blur')) B.tFirstBlur = now;
    if (B.tAllPictured == null) {
      let n = 0, ok = true;
      for (const card of document.querySelectorAll('.r2p')) {
        if (!inView(card.getBoundingClientRect())) continue;
        n++;
        if (!shown(card.querySelector('img.r2p-img'))) { ok = false; break; }
      }
      if (ok && n > 0) {
        B.tAllPictured = now;
        B.snaps.atPictured = snapshot();
        setTimeout(() => { B.snaps.plus10s = snapshot(); }, 10_000);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

for (const [name, opts] of Object.entries(SCENARIOS)) {
  test.describe(name, () => {
    test.use(opts);
    test(`open big board: ${name}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const manifest = await makeBenchImages();
      const { cards, urls, meta } = buildBoard(manifest);
      const files = new Map();
      for (const f of fs.readdirSync(FIXTURE_DIR)) {
        if (/\.(jpg|webp)$/.test(f)) files.set(f, fs.readFileSync(path.join(FIXTURE_DIR, f)));
      }

      const served = []; // { t, url, tier, bytes }
      let linkFreeAt = 0;
      await page.route('https://imgcdn.test/**', async (route) => {
        const u = new URL(route.request().url());
        const file = u.pathname.slice(1).replace(/^(orig|lg|sm|xs)-(\d+)\.(\w+)$/, '$1-$2.$3');
        const tier = file.split('-')[0];
        const body = files.get(file);
        if (!body) return route.fulfill({ status: 404, body: 'no fixture' });
        const now = Date.now();
        const finish = Math.max(now, linkFreeAt) + (body.length / BW) * 1000;
        linkFreeAt = finish;
        await new Promise((r) => setTimeout(r, finish + LATENCY_MS - now));
        try {
          await route.fulfill({ status: 200, contentType: MIME[file.split('.').pop()], body });
          served.push({ t: Date.now(), url: route.request().url(), tier, bytes: body.length });
        } catch (_) { /* page closed or request aborted */ }
      });

      await routeAnalytics(page, []);
      await routeShareBundle(page, {});
      // Override the root bundle route with the big picture board.
      const bundles = makeBundles();
      bundles[ROOT_ID] = { ...bundles[ROOT_ID], snapshot: snapshotB64(cards), image_urls: urls, image_meta: meta };
      await page.route('**/parties/upload/share/share-bundle', async (route) => {
        let boardId = null;
        try { boardId = route.request().postDataJSON()?.boardId || null; } catch (_) {}
        const bundle = bundles[boardId || ROOT_ID];
        if (!bundle) return route.fulfill({ status: 404, body: 'out of subtree' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle) });
      });

      await page.addInitScript(installProbe);
      let navs = 0;
      page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) { navs++; console.log(`[bench] main frame navigated (#${navs}) at +${Date.now() - t0}ms: ${fr.url()}`); } });
      page.on('console', (m) => { if (m.type() === 'error') console.log(`[bench] page console error: ${m.text().slice(0, 300)}`); });
      page.on('crash', () => console.log('[bench] PAGE CRASH'));
      page.on('pageerror', (e) => console.log(`[bench] pageerror: ${String(e).slice(0, 300)}`));
      const t0 = Date.now();
      await page.goto(`/share/${TOKEN}?shareqa=1&prefetch=0`);

      await expect.poll(() => page.evaluate(() => window.__bench?.tAllPictured), { timeout: 90_000, intervals: [250] }).not.toBeNull();
      await expect.poll(() => page.evaluate(() => !!window.__bench?.snaps?.plus10s), { timeout: HOLD_MS + 15_000, intervals: [250] }).toBe(true);
      const b = await page.evaluate(() => window.__bench);

      const upTo = (t) => {
        const rows = served.filter((r) => r.t <= t);
        const byTier = {};
        for (const r of rows) byTier[r.tier] = (byTier[r.tier] || 0) + 1;
        return { requests: rows.length, bytes: rows.reduce((s, r) => s + r.bytes, 0), requestsByTier: byTier };
      };
      const stage = (snap) => ({
        ...upTo(snap.t),
        cardsInView: snap.cardsInView, shownImgs: snap.shownImgs,
        tierHistogram: snap.hist, textureMB: snap.textureMB,
      });
      const result = {
        label: LABEL, scenario: name, repeat: testInfo.repeatEachIndex,
        cards: COUNT, bwBytesPerSec: BW, latencyMs: LATENCY_MS, mainFrameNavigations: navs, // 2 = clean (goto + the viewer dropping ?shareqa); more = a reload spoiled the run
        tFirstBlurMs: b.tFirstBlur == null ? null : b.tFirstBlur - t0,
        tAllPicturedMs: b.tAllPictured - t0,
        atPictured: stage(b.snaps.atPictured),
        plus10s: stage(b.snaps.plus10s),
      };
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, `${LABEL}-${name}-${testInfo.repeatEachIndex}.json`), JSON.stringify(result, null, 2));
      console.log(`BENCH ${JSON.stringify(result)}`);

      expect(result.tAllPicturedMs).toBeLessThan(60_000);
      const h = result.atPictured.tierHistogram;
      expect(h.xs + h.sm + h.lg + h.orig + h.other + h.notShown).toBe(result.atPictured.cardsInView);
    });
  });
}
