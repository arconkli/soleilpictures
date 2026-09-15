// surface-gallery-wiring.spec.js — the admin Surface Gallery is admin-gated,
// invisible to the docs surface gate, and cannot write anything.
//
// Source guards, not behaviour. ?local=1 mounts LocalBoardsApp, which never
// mounts App.jsx or SettingsPanel, so the wiring these assert on is
// unreachable from the harness. The registry itself is covered under node in
// src/lib/galleryIndex.test.mjs.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

test.describe('surface gallery wiring', () => {
  test('the tab is admin-only and invisible to the docs surface gate', () => {
    const s = read('src/components/SettingsPanel.jsx');
    // publicSurface.mjs finds the settings tabs by slicing the TABS literal and
    // bracket-matching only that. A tab declared in ADMIN_TABS never enters the
    // hash — which is the whole reason the gallery needs no docs page.
    const tabs = s.slice(s.indexOf('const TABS ='), s.indexOf('const ADMIN_TABS'));
    expect(tabs).not.toMatch(/gallery/i);
    const adminTabs = s.slice(s.indexOf('const ADMIN_TABS'), s.indexOf('const GROUPS'));
    expect(adminTabs).toMatch(/\{ id: 'gallery', label: 'Gallery', group: 'admin' \}/);
    // The pane re-checks isAdmin independently, so a mid-session tier drop
    // cannot leave the tab rendering.
    expect(s).toMatch(/tab === 'gallery' && isAdmin &&/);
    // Opening closes Settings: the gallery mounts at the app root because
    // .settings-bg is one below the maximum z-index.
    expect(s).toMatch(/onOpen=\{\(\) => \{ onClose\?\.\(\); onOpenGallery\?\.\(\); \}\}/);
  });

  test('the gate is the tier read, and losing admin disarms', () => {
    const s = read('src/App.jsx');
    expect(s).toMatch(/useEffect\(\(\) => \{ armGallery\(captureAllowed\); \}, \[captureAllowed\]\)/);
    expect(s).toMatch(/const captureAllowed = myTier\.tier === 'admin'/);
    // Lazy, so the registry and every fixture stay out of the main bundle.
    expect(s).toMatch(/const SurfaceGallery = lazyWithReload\(\(\) => import\('\.\/components\/gallery\/SurfaceGallery\.jsx'\)\)/);
    expect(s).toMatch(/\{galleryActive && \(\s*<Suspense fallback=\{null\}><SurfaceGallery \/><\/Suspense>/);
    expect(s).toMatch(/available: captureAllowed,\s*run: \(\) => openGallery\(\)/);
  });

  test('the store boots disarmed and persists nothing', () => {
    const s = read('src/lib/galleryState.js');
    expect(s).toMatch(/let armed = false;/);
    // Every writer folds in `armed` — that is the gate, not the UI.
    for (const fn of ['openGallery', 'closeGallery', 'previewSurface']) {
      const body = s.slice(s.indexOf(`export function ${fn}`), s.indexOf('\n}', s.indexOf(`export function ${fn}`)));
      expect(body, fn).toMatch(/if \(!armed/);
    }
    // A flag that survived a reload would silently stop recording a real
    // session's events. Memory only, deliberately. Comments are stripped first:
    // the header names both APIs in the course of explaining why it uses
    // neither, and a guard that fails on its own rationale gets deleted.
    const code = s.split('\n').filter((ln) => !ln.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/sessionStorage|localStorage/);
  });

  test('nothing rendered in the gallery can write', () => {
    // Five paths, five guards, one predicate. The analytics one is the
    // consequential one: it keeps preview exposures out of the conversion
    // funnel the monetization read grades on.
    expect(read('src/lib/analytics.js'))
      .toMatch(/isAnyQaMode\(\) \|\| isCaptureActive\(\) \|\| isGalleryActive\(\)\) merged\.synthetic = true/);
    expect(read('src/lib/upsellSlot.js')).toMatch(/if \(isGalleryActive\(\)\) return true;/);
    expect(read('src/lib/upgradePrompts.js')).toMatch(/if \(isGalleryActive\(\)\) return chain;/);
    const latches = read('src/lib/upsellLatches.js');
    expect(latches).toMatch(/if \(isGalleryActive\(\)\) return false;/);   // markPriceSeen
    expect(latches).toMatch(/if \(isGalleryActive\(\)\) return;/);         // markNearCapWarned
    // Checkout is the one previewable action with an external consequence.
    const checkout = read('src/lib/checkout.js');
    expect(checkout.match(/if \(isGalleryActive\(\)\) throw new Error\('gallery_preview'\)/g) || [])
      .toHaveLength(2);
    expect(read('src/lib/checkoutErrors.js')).toMatch(/gallery_preview: 'Preview only/);
  });

  test('the two preview seams are narrow and default to off', () => {
    // A state you cannot be in has to be fed in. Both seams default null/absent
    // so no live path can reach them by accident.
    const pm = read('src/components/PricingModal.jsx');
    expect(pm).toMatch(/tierPreview = null \}\) \{/);
    expect(pm).toMatch(/const live = useMyTier\(\{ userId: user\?\.id \}\);/);
    expect(pm).toMatch(/tierPreview \|\| live;/);
    // The pill takes no props in the real chip, so its three pressure states
    // were unreachable until it was split out presentationally.
    const chip = read('src/components/UpgradeChip.jsx');
    expect(chip).toMatch(/export function UpgradePill\(\{ innerRef = null, near, count, limit, showCount, showPrice, onClick \}\)/);
    expect(chip).toMatch(/<UpgradePill\s/);
    // The share bar moved to its own module so previewing it does not drag the
    // Y.js decode path and CanvasSurface along.
    expect(read('src/components/PublicTopbar.jsx')).toMatch(/export function PublicTopbar\(\{ hrefFor,/);
    expect(read('src/components/PublicBoardView.jsx'))
      .toMatch(/import \{ PublicTopbar \} from '\.\/PublicTopbar\.jsx'/);
  });

  test('the render probe is reachable only from the test suite', () => {
    // src/local/galleryRenderProbe.js exists so Vite can rewrite its bare
    // 'react' import; it is in no chunk because nothing in the app imports it.
    // That is a stronger guarantee than a DEV guard, which would still let a
    // careless import pull it into a bundle — so assert the guarantee.
    const hits = execSync(
      "grep -rl galleryRenderProbe src tests scripts 2>/dev/null || true",
      { cwd: new URL('../', import.meta.url).pathname, encoding: 'utf8' },
    ).split('\n').filter(Boolean).sort();
    expect(hits).toEqual([
      'src/local/galleryRenderProbe.js',
      'tests/surface-gallery-render.spec.js',
      'tests/surface-gallery-wiring.spec.js',   // this assertion names it too
    ]);
  });

  test('gold stays reserved for selection, and the bar can outrank a portal', () => {
    const css = read('src/styles.css');
    const block = css.slice(css.indexOf('/* ─── Surface Gallery (admin)'));
    expect(block).toMatch(/\.gal-row\.is-active \.gal-row-label \{ color: var\(--soleil/);
    expect(block).toMatch(/\.gal-bar \{[^}]*z-index: 2147483647/s);
    // Portals append to <body> in mount order, so the bar re-appends itself
    // after whatever the preview mounted.
    expect(read('src/components/gallery/SurfaceGallery.jsx'))
      .toMatch(/document\.body\.appendChild\(node\)/);
    // Escape must work even when the bar is covered.
    expect(read('src/components/gallery/SurfaceGallery.jsx'))
      .toMatch(/window\.addEventListener\('keydown', onKey, true\)/);
  });
});
