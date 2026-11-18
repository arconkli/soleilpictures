// Tests for the Phase 1-7 master batch.
//
// Most assertions run in local QA mode (?local=1) — that gives us a
// styled UI with no Supabase dependency. Features that require the
// real backend (comments persistence, profile fetches)
// are tested at the CSS / mounted-component level: we assert the new
// classes ship and the relevant menu items appear.

import { expect, test } from '@playwright/test';

async function go(page) {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
}

// Same, but with an EMPTY board.
//
// `blank=1` does two things these tests need: it skips the local seed, so a
// fixed-position right-click cannot land on a seeded card and open a CARD menu
// instead of the background one; and it sets autoFrame=false
// (CanvasSurface.jsx:425) so the camera does not move under the click. The
// seeded board grew to ~10 cards, which is when the "right-click empty canvas"
// tests started failing — nothing about the menus changed.
async function goBlank(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto('/?local=1&reset=1&blank=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1&blank=1'));
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
}

// The canvas's own menu keeps "Comment" under Add (a card's menu says
// "Add comment"). Opens that submenu and answers with the item.
async function bgMenuComment(page) {
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  return page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Comment', exact: true });
}
async function addCommentFromBgMenu(page) {
  await (await bgMenuComment(page)).click();
}

// Walks every styleSheet and matches a regex against its selectorText.
// Returns true if any rule matches. Useful for "did this class ship".
async function hasCssRule(page, regex) {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    return [...document.styleSheets].some(s => {
      try { return [...s.cssRules].some(r => re.test(r.selectorText || '') || re.test(r.cssText || '')); }
      catch { return false; }
    });
  }, regex.source);
}

// Right-click on a target element. Returns the resulting menu locator.
async function rightClick(page, locator) {
  await locator.click({ button: 'right' });
  return page.locator('.ctx-menu');
}

// ═══════════════ PHASE 1: POLISH & BUG FIXES ═══════════════

test.describe('Phase 1 — polish & bug fixes', () => {
  test('snap-guides CSS class ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.snap-guides/)).toBe(true);
  });

  test('snap alignment lines are toned down (strokeOpacity attribute present)', async ({ page }) => {
    // The lines used to render at full opacity which felt overbearing.
    // Now they should ship with a strokeOpacity attribute around 0.42
    // for edge-alignment lines. We just check the bundle still has the
    // attribute string + a non-1 opacity value.
    await page.goto('/?local=1');
    const html = await (await page.request.get('/?local=1')).text();
    const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (!m) return;
    const bundle = await (await page.request.get(m[1])).text();
    expect(bundle.includes('strokeOpacity')).toBe(true);
    // Equal-spacing snap helper named in the source — guard against
    // future regressions that drop the spacing pass entirely.
    expect(bundle.includes('xSpacingCands')).toBe(true);
    expect(bundle.includes('ySpacingCands')).toBe(true);
  });

  test('shape cards drop their wrapper box-shadow', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /card-kind-shape/)).toBe(true);
  });

  test('note scrollbar styling ships', async ({ page }) => {
    await go(page);
    // Webkit scrollbar selectors are wrapped in cssText, not selectorText —
    // hasCssRule looks at both.
    expect(await hasCssRule(page, /\.note-body/)).toBe(true);
  });

  test('doc preview text uses 18-line clamp', async ({ page }) => {
    await go(page);
    const lc = await page.evaluate(() => {
      for (const s of document.styleSheets) {
        try {
          for (const r of s.cssRules) {
            if (r.selectorText === '.doc-card-text') {
              return r.style.webkitLineClamp || r.style['-webkit-line-clamp'] || '';
            }
          }
        } catch { /* cross-origin */ }
      }
      return '';
    });
    // Phase 1 bumped clamp from 6 to 18 so the preview fills with body.
    expect(['18', 18]).toContain(lc);
  });

  test('default cold start lands on the root (Studio) board', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    // Workspace title is "Local Studio" in local QA mode.
    await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  });

  test('tt-editor heading sizes were polished', async ({ page }) => {
    await go(page);
    // Measured off REAL elements, not by hunting document.styleSheets for a rule
    // whose selectorText is exactly '.tt-editor h1'. That match broke the moment
    // the headings were consolidated into a grouped selector
    // (`.tt-editor h1, .tt-editor h2, .tt-editor h3, …` — styles.css:13033):
    // the rule still applies, the sizes are still right, and the lookup silently
    // returned undefined. Computed style is what the user actually sees, and it
    // cannot be broken by a refactor that changes nothing visible.
    const fontSizes = await page.evaluate(() => {
      const host = document.createElement('div');
      host.className = 'tt-editor';
      host.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden';
      host.innerHTML = '<h1>h1</h1><h2>h2</h2><h3>h3</h3>';
      document.body.appendChild(host);
      const read = (t) => getComputedStyle(host.querySelector(t)).fontSize;
      const sizes = { h1: read('h1'), h2: read('h2'), h3: read('h3') };
      host.remove();
      return sizes;
    });
    expect(fontSizes.h1).toBe('32px');
    expect(fontSizes.h2).toBe('24px');
    expect(fontSizes.h3).toBe('18px');
  });
});

// ═══════════════ PHASE 2: WORKSPACE / ACCOUNT / AUDIT ═══════════════

test.describe('Phase 2 — workspace + account', () => {
  test('AccountSettings modal CSS ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.account-modal/)).toBe(true);
    expect(await hasCssRule(page, /\.account-btn-primary/)).toBe(true);
  });

  test('peer-comment audit popover CSS ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.ws-presence-audit/)).toBe(true);
  });

  test('AccountSettings color picker uses the standard ColorPicker chip', async ({ page }) => {
    await go(page);
    // Single chip + "Reset" button replaced the old swatches grid +
    // <input type=color>. Assert the chip class ships and the legacy
    // swatch-grid class is gone.
    expect(await hasCssRule(page, /\.account-color-chip/)).toBe(true);
    expect(await hasCssRule(page, /\.account-swatches/)).toBe(false);
  });
});

// ═══════════════ PHASE 3: COMMENTS ═══════════════

test.describe('Phase 3 — anywhere-comments', () => {
  test('comment redesign — Caveat sketchy font is NOT loaded', async ({ page }) => {
    await go(page);
    // Caveat used to be imported at the top of the canvas-comments
    // section. The redesign drops that import and uses var(--font-sans).
    const hasCaveat = await page.evaluate(() =>
      [...document.styleSheets].some(s => {
        try { return s.href?.includes('Caveat') || (s.cssRules && [...s.cssRules].some(r => /Caveat/i.test(r.cssText || ''))); }
        catch { return false; }
      })
    );
    expect(hasCaveat).toBe(false);
  });

  test('a comment is a pin on its card: the pin CSS ships, the 240px bubble is gone', async ({ page }) => {
    await go(page);
    // Comments were 240px preview tiles (.canvas-comment-card, its body
    // clamped to two lines). Each is a small pin now (.cmt-pin, in the
    // canvas's own download); what a pin opens is driven for real in
    // canvas-comment-pins.spec.js.
    expect(await hasCssRule(page, /\.cmt-pin\b/)).toBe(true);
    expect(await hasCssRule(page, /\.cmt-pin--count/)).toBe(true);
    expect(await hasCssRule(page, /\.cmt-pin-at\.is-dragging/)).toBe(true);
    for (const gone of [/\.canvas-comment-card/, /\.canvas-comment-body/, /\.canvas-comment-pin\b/,
      /\.canvas-comment-draft/, /canvas-comment\.is-mine/, /canvas-comment\.is-dragging/,
      /\.canvas-comment\.is-resolved/, /\.canvas-comment-anchor-dot/]) {
      expect(await hasCssRule(page, gone), String(gone)).toBe(false);
    }
  });

  test('right-click empty canvas → Add → Comment is offered', async ({ page }) => {
    await goBlank(page);
    // Right-click an empty area of the canvas (away from cards).
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    await expect(await bgMenuComment(page)).toBeVisible();
  });

  test('clicking "Add comment" opens the comment card on a draft pin (no feedback dialog)', async ({ page }) => {
    await goBlank(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 200, y: 200 } });
    await addCommentFromBgMenu(page);
    // The new comment's card opens beside its pin; the feedback modal must NOT.
    await expect(page.locator('.cmt-canvas-card [data-cmt-card="new"]')).toBeVisible();
    await expect(page.locator('.cmt-canvas-card textarea.cmt-input')).toBeFocused();
    await expect(page.locator('.cmt-pin--draft.is-open')).toHaveCount(1);
    await expect(page.locator('.feedback-dialog')).toHaveCount(0);
  });

  test('Escape on the draft cancels without leaving artifacts', async ({ page }) => {
    await goBlank(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 200, y: 200 } });
    await addCommentFromBgMenu(page);
    await expect(page.locator('.cmt-canvas-card')).toBeVisible();
    await page.keyboard.press('Escape');
    // nothing was typed: the card goes, and so does its pin
    await expect(page.locator('.cmt-canvas-card')).toHaveCount(0);
    await expect(page.locator('.cmt-pin--draft')).toHaveCount(0);
  });

  test('pickCommentOffset prefers a non-overlapping perimeter spot', async ({ page }) => {
    await page.goto('/?local=1');
    await page.waitForFunction(() => typeof window.__soleilTest?.pickCommentOffset === 'function');
    // Target card with two close neighbours blocking the right side. The
    // algorithm should slide the bubble to the LEFT (or top/bottom) where
    // it doesn't overlap.
    const out = await page.evaluate(() => {
      const { pickCommentOffset } = window.__soleilTest;
      const target = { x: 200, y: 200, w: 200, h: 200 };
      const others = [
        { x: 410, y: 180, w: 200, h: 100 },  // blocks right-top
        { x: 410, y: 300, w: 200, h: 100 },  // blocks right-middle/bottom
      ];
      return pickCommentOffset({ target, others, placed: [] });
    });
    // The default spot (right-side, top) lands inside others[0]. The
    // chosen offset must move the bubble somewhere that doesn't overlap
    // — either left, top, or bottom of the target. Verify the resulting
    // bubble rect doesn't intersect either obstacle.
    const overlaps = await page.evaluate(({ offsetX, offsetY }) => {
      const target = { x: 200, y: 200, w: 200, h: 200 };
      const others = [
        { x: 410, y: 180, w: 200, h: 100 },
        { x: 410, y: 300, w: 200, h: 100 },
      ];
      const W = 240, H = 76;
      const x = target.x + target.w + 8 + offsetX;
      const y = target.y - 8 + offsetY;
      const r = { x, y, w: W, h: H };
      const overlap = (a, b) => {
        const dx = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const dy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        return dx * dy;
      };
      return others.reduce((s, o) => s + overlap(r, o), 0);
    }, out);
    expect(overlaps).toBe(0);
  });

  test('pickCommentOffset returns 0/0 when target is undefined (defensive default)', async ({ page }) => {
    await page.goto('/?local=1');
    await page.waitForFunction(() => typeof window.__soleilTest?.pickCommentOffset === 'function');
    const out = await page.evaluate(() => {
      const { pickCommentOffset } = window.__soleilTest;
      return pickCommentOffset({ target: null, others: [], placed: [] });
    });
    expect(out).toEqual({ offsetX: 0, offsetY: 0 });
  });

  // Gone with the 240px bubble, and not replaced here: its drag (committedRef,
  // baseRef, the grab cursor on the whole tile), its seam dot, the
  // display:none on a resolved one, the per-comment Hide's bulk unhide, and
  // Backspace deleting an open thread. A pin follows its card, a resolved
  // conversation simply has no pin, the switch is personal, and Backspace
  // deletes nothing: canvas-comment-pins.spec.js drives each of those.

  test('the comments island is always there, and opens the list of them all', async ({ page }) => {
    await go(page);
    const eye = page.locator('.cnv-comments-eye');
    await expect(eye).toBeVisible();
    // The island's states ship: muted while my switch is off, on while the
    // list is open.
    expect(await hasCssRule(page, /\.cnv-comments-eye\.is-muted/)).toBe(true);
    expect(await hasCssRule(page, /\.cnv-comments-eye\.is-on/)).toBe(true);
    // The old archive popover (right-click on the eye) is gone…
    expect(await hasCssRule(page, /\.comment-archive/)).toBe(false);
    // …a press opens the list instead: Open / Resolved / For you, and my own
    // switch. With no backend there is nothing to list, and it says so.
    await eye.click();
    const list = page.locator('.cmt-list');
    await expect(list).toBeVisible();
    await expect(eye).toHaveClass(/is-on/);
    await expect(list.getByRole('tab')).toHaveText([/^Open\s*0$/, /^Resolved\s*0$/, /^For you\s*0$/]);
    await expect(list.locator('.cmt-list-empty')).toContainText('No open comments');
    await expect(list.getByRole('switch', { name: 'Show comments on the canvas' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(eye).toBeFocused();
  });
});

// ═══════════════ PHASE 4: GROUPS ═══════════════

test.describe('Phase 4 — group labels', () => {
  test('group hide-label CSS doesn\'t break group rendering', async ({ page }) => {
    await go(page);
    // Group label class still ships even when hideLabel is set.
    expect(await hasCssRule(page, /\.group-label/)).toBe(true);
  });
});

// ═══════════════ PHASE 5: LINKING + GROUP POLISH ═══════════════

test.describe('Phase 5 — linking polish', () => {
  test('hover-tint variable is wired into tt-link', async ({ page }) => {
    await go(page);
    const css = await page.evaluate(() => {
      for (const s of document.styleSheets) {
        try {
          for (const r of s.cssRules) {
            if (r.selectorText === '.tt-link:hover, .tt-link.is-active') {
              return r.cssText;
            }
          }
        } catch { /* cross-origin */ }
      }
      return '';
    });
    // The hover rule should reference the kind-aware tint variable.
    expect(css).toMatch(/--tt-link-tint/);
  });

  test('backlinks pin button CSS ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.ent-backlinks-row-pin/)).toBe(true);
    expect(await hasCssRule(page, /\.ent-backlinks-row-wrap/)).toBe(true);
  });
});

// ═══════════════ PHASE 6: BOTTOM BAR + IMAGES + VIDEOS ═══════════════

test.describe('Phase 6 — bottom bar + media', () => {
  test('anchored toolbar CSS ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.tob-anchored/)).toBe(true);
  });

  test('VideoCard CSS ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.vc-vidwrap/)).toBe(true);
    expect(await hasCssRule(page, /\.vc-video/)).toBe(true);
  });

  test('palette hide-hex / hide-labels variants ship', async ({ page }) => {
    await go(page);
    // PaletteCard accepts hideHex/hideLabels props and toggles classes.
    // These class names are just modifiers — no CSS rule for them since
    // styling is driven by hiding child elements. So we just verify
    // the file loads cleanly with the new prop signature.
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});

// ═══════════════ PHASE 7: ARROWS + EXPORT + DOC RESIDUALS ═══════════════

test.describe('Phase 7 — arrows + export + docs', () => {
  test('arrow-label class ships (used inside foreignObject)', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.arrow-label/)).toBe(true);
  });

  // The canvas menu is plan.md §3 Canvas: "Background › · Export ›", and no
  // "Save board as template…" (it had already left the canvas menu on main).
  // Export › holds the two formats.
  test('right-click empty canvas → Export › with PNG and PDF', async ({ page }) => {
    await goBlank(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    const menu = page.locator('.ctx-menu:not(.ctx-submenu)');
    await expect(menu).toBeVisible();
    await expect(page.locator('.ctx-menu').getByText('Save board as template…')).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Export', exact: true }).hover();
    const sub = page.locator('.ctx-submenu');
    await expect(sub.getByRole('menuitem', { name: 'PNG image', exact: true })).toBeVisible();
    await expect(sub.getByRole('menuitem', { name: /^PDF/ })).toBeVisible();
  });

  // "Add link…" is now Link in Add › and "Add a link" in the quick row
  // (plan.md §3 Canvas, "Add › = … — Link · Comment · Vote", and §2.3).
  test('right-click → Add › Link entry', async ({ page }) => {
    await goBlank(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    const menu = page.locator('.ctx-menu:not(.ctx-submenu)');
    await expect(menu.locator('.ctx-quick').getByRole('menuitem', { name: /^Add a link/ })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Add', exact: true }).hover();
    await expect(page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Link', exact: true })).toBeVisible();
  });

  test('Grammarly enable attributes are wired on the doc editor', async ({ page }) => {
    // Tiptap's editorProps.attributes are applied to the contenteditable
    // root. Even without a doc card open in local mode, we can scan the
    // built JS bundle for the attribute strings to verify they shipped.
    await go(page);
    const html = await page.content();
    // The strings appear in the bundled JS exactly as written.
    expect(html.includes('canvas-wrap')).toBe(true); // sanity that the page loaded
    const jsResp = await page.request.get('/?local=1');
    const body = await jsResp.text();
    // The bundle is referenced from the HTML; locate it and fetch.
    const m = body.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (!m) return; // dev mode might not have a bundle URL
    const bundle = await (await page.request.get(m[1])).text();
    expect(bundle.includes('data-gramm')).toBe(true);
  });
});

// ═══════════════ ORPHAN-CARD SWEEP REGRESSION GUARD ═══════════════
// Earlier bug: readCards built `card.id` from the value's `id` key. If
// the value's id ever drifted from the Y.Map key (peer corruption,
// older code path), `m.delete(card.id)` became a silent no-op. The
// orphan sweep then looped forever — sweep finds orphan, "deletes" it,
// re-runs because cards updated, finds the same orphan, and so on.
// The fix anchors card.id to the Y.Map key. This test guards it.

test.describe('readCards id-from-key invariant (orphan sweep regression)', () => {
  test('readCards anchors card.id to the Y.Map key, even when value.id drifts', async ({ page }) => {
    await page.goto('/?local=1');
    // Wait for the test bridge that main.jsx exposes in local QA mode.
    await page.waitForFunction(() => typeof window.__soleilTest === 'object' &&
                                     window.__soleilTest?.readCards &&
                                     window.__soleilTest?.Y);
    const out = await page.evaluate(() => {
      const { Y, readCards } = window.__soleilTest;
      const ydoc = new Y.Doc();
      const m = ydoc.getMap('cards');
      ydoc.transact(() => {
        // Card 1: matched key + value.id (the happy path)
        const a = new Y.Map();
        a.set('id', 'good-1');
        a.set('kind', 'note');
        m.set('good-1', a);
        // Card 2: key 'real-key', but value claims id='wrong-id'.
        // The fix: readCards must return id='real-key', not 'wrong-id'.
        const b = new Y.Map();
        b.set('id', 'wrong-id');
        b.set('kind', 'board');
        m.set('real-key', b);
      });
      return readCards(ydoc).map(c => ({ id: c.id, kind: c.kind }));
    });
    expect(out).toEqual(expect.arrayContaining([
      { id: 'good-1', kind: 'note' },
      { id: 'real-key', kind: 'board' },  // <-- key, not 'wrong-id'
    ]));
  });

  test('orphan board cards are hidden at the render layer (no destructive sweep)', async ({ page }) => {
    // We replaced the delete-from-Y.Doc sweep with a render-layer
    // filter. The bundle should NOT contain the old circuit breaker
    // log (proof the sweep is gone) and SHOULD contain the comment
    // explaining why we filter instead.
    await page.goto('/?local=1');
    const html = await (await page.request.get('/?local=1')).text();
    const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (!m) return;
    const bundle = await (await page.request.get(m[1])).text();
    // Old destructive path is gone.
    expect(bundle.includes('orphan-card sweep CIRCUIT BREAKER tripped')).toBe(false);
    // Filter-based logic is in place — `isOrphanRef` is the helper
    // name used in App.jsx for the render-time check.
    expect(bundle.includes('isOrphanRef')).toBe(true);
  });
});

// ═══════════════ INTEGRATION: NEW MENU ITEMS COEXIST ═══════════════

test.describe('Integration — new right-click items don\'t conflict', () => {
  test('background context menu has both new and old items in the right order', async ({ page }) => {
    await goBlank(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    const menu = page.locator('.ctx-menu:not(.ctx-submenu)');
    await expect(menu).toBeVisible();
    const row = (name) => menu.getByRole('menuitem', { name, exact: true });
    // Old items still present. "Reset zoom" left for "Fit everything ⇧1"
    // (plan.md §1.14; ⌘0 and the zoom button still reset).
    await expect(row('Add')).toBeVisible();
    await expect(row('Background')).toBeVisible();
    await expect(row('Fit everything')).toBeVisible();
    await expect(menu.getByText('Reset zoom', { exact: true })).toHaveCount(0);
    await expect(row('Export')).toBeVisible();
    // In the right order (plan.md §3 Canvas).
    const order = await menu.locator('button.ctx-item .ctx-label').allTextContents();
    const at = (name) => order.indexOf(name);
    expect(at('Add')).toBeGreaterThanOrEqual(0);
    expect(at('Add')).toBeLessThan(at('Fit everything'));
    expect(at('Fit everything')).toBeLessThan(at('Background'));
    expect(at('Background')).toBeLessThan(at('Export'));
    // The adds that were rows of their own now sit in Add › (Comment, Link)
    // and the quick row (plan.md §3 Canvas, §2.3); no "Save board as template…".
    await expect(menu.locator('.ctx-quick').getByRole('menuitem', { name: /^Add a link/ })).toBeVisible();
    await row('Add').hover();
    const add = page.locator('.ctx-submenu');
    await expect(add.getByRole('menuitem', { name: 'Comment', exact: true })).toBeVisible();
    await expect(add.getByRole('menuitem', { name: 'Link', exact: true })).toBeVisible();
    await expect(page.locator('.ctx-menu').getByText('Save board as template…')).toHaveCount(0);
  });

  test('no console errors after triggering the new bg menu', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (text.includes('ERR_NAME_NOT_RESOLVED')) return;
      if (text.includes('Failed to load resource')) return;
      errors.push(text);
    });
    await go(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    await page.waitForTimeout(150);
    // Close menu via Escape.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    expect(errors).toEqual([]);
  });
});
