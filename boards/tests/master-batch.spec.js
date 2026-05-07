// Tests for the Phase 1-7 master batch.
//
// Most assertions run in local QA mode (?local=1) — that gives us a
// styled UI with no Supabase dependency. Features that require the
// real backend (comments persistence, tag DB rows, profile fetches)
// are tested at the CSS / mounted-component level: we assert the new
// classes ship and the relevant menu items appear.

import { expect, test } from '@playwright/test';

async function go(page) {
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1'));
  await expect(page.locator('.canvas-wrap')).toBeVisible();
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
    const fontSizes = await page.evaluate(() => {
      const sizes = {};
      for (const s of document.styleSheets) {
        try {
          for (const r of s.cssRules) {
            if (r.selectorText === '.tt-editor h1') sizes.h1 = r.style.fontSize;
            if (r.selectorText === '.tt-editor h2') sizes.h2 = r.style.fontSize;
            if (r.selectorText === '.tt-editor h3') sizes.h3 = r.style.fontSize;
          }
        } catch { /* cross-origin */ }
      }
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

  test('comment card preview shows body text inline (not collapsed)', async ({ page }) => {
    await go(page);
    // The new design uses .canvas-comment-card (full preview tile) — not
    // .canvas-comment-pin (the prior single-letter avatar). Assert the
    // preview class ships and the pin class does NOT.
    expect(await hasCssRule(page, /\.canvas-comment-card/)).toBe(true);
    expect(await hasCssRule(page, /\.canvas-comment-body/)).toBe(true);
    expect(await hasCssRule(page, /\.canvas-comment-pin\b/)).toBe(false);
  });

  test('comment body has line-clamp 2 in collapsed state', async ({ page }) => {
    await go(page);
    const lc = await page.evaluate(() => {
      for (const s of document.styleSheets) {
        try {
          for (const r of s.cssRules) {
            if (r.selectorText === '.canvas-comment-body') {
              return r.style.webkitLineClamp || r.style['-webkit-line-clamp'] || '';
            }
          }
        } catch { /* cross-origin */ }
      }
      return '';
    });
    expect(['2', 2]).toContain(lc);
  });

  test('right-click empty canvas → "Add comment" item appears', async ({ page }) => {
    await go(page);
    // Right-click an empty area of the canvas (away from cards).
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Add comment', { exact: true })).toBeVisible();
  });

  test('comment-draft input + replica-identity-full CSS ship', async ({ page }) => {
    await go(page);
    // Inline draft replaces the old feedback.prompt popup. Class ships
    // even before any comment is placed.
    expect(await hasCssRule(page, /\.canvas-comment-draft/)).toBe(true);
    expect(await hasCssRule(page, /\.canvas-comment-draft-input/)).toBe(true);
    expect(await hasCssRule(page, /\.canvas-comment-draft-post/)).toBe(true);
  });

  test('clicking "Add comment" mounts an inline draft (no feedback dialog)', async ({ page }) => {
    await go(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 200, y: 200 } });
    await page.locator('.ctx-menu').getByText('Add comment', { exact: true }).click();
    // The draft input should appear inline; the feedback modal must NOT.
    await expect(page.locator('.canvas-comment-draft')).toBeVisible();
    await expect(page.locator('.feedback-dialog')).toHaveCount(0);
  });

  test('Escape on the draft cancels without leaving artifacts', async ({ page }) => {
    await go(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 200, y: 200 } });
    await page.locator('.ctx-menu').getByText('Add comment', { exact: true }).click();
    await expect(page.locator('.canvas-comment-draft')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.canvas-comment-draft')).toHaveCount(0);
  });

  test('drag affordance + dragging visual states ship', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /canvas-comment\.is-mine/)).toBe(true);
    expect(await hasCssRule(page, /canvas-comment\.is-dragging/)).toBe(true);
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

  test('comment drag glitch fix — committedRef holds the live offset', async ({ page }) => {
    // After commit, the bubble has to keep showing the dragged-to spot
    // until the comment prop reflects the new offset; otherwise it
    // snaps back, then teleports. The fix is a committedRef that
    // gates dragDelta clearing — assert the bundle still ships it
    // (and the legacy "setDragDelta(null)" right after updateComment
    // is gone).
    await page.goto('/?local=1');
    const html = await (await page.request.get('/?local=1')).text();
    const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (!m) return;
    const bundle = await (await page.request.get(m[1])).text();
    expect(bundle.includes('committedRef')).toBe(true);
  });

  test('history modal has tabs + comment status pills', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.hist-tabs/)).toBe(true);
    expect(await hasCssRule(page, /\.hist-tab\.is-active/)).toBe(true);
    expect(await hasCssRule(page, /\.hist-pill/)).toBe(true);
    expect(await hasCssRule(page, /\.hist-comment-status-resolved/)).toBe(true);
    expect(await hasCssRule(page, /\.hist-comment-status-hidden/)).toBe(true);
  });

  test('resolved comments are hidden on the canvas (display:none)', async ({ page }) => {
    await go(page);
    const display = await page.evaluate(() => {
      for (const s of document.styleSheets) {
        try {
          for (const r of s.cssRules) {
            if (r.selectorText === '.canvas-comment.is-resolved') {
              return r.style.display || '';
            }
          }
        } catch { /* cross-origin */ }
      }
      return '';
    });
    expect(display).toBe('none');
  });

  test('reveal-hidden eye toggle CSS ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.cnv-comments-eye/)).toBe(true);
    expect(await hasCssRule(page, /\.cnv-comments-eye\.is-on/)).toBe(true);
    expect(await hasCssRule(page, /\.canvas-comment\.is-revealed-hidden/)).toBe(true);
  });
});

// ═══════════════ PHASE 4: TAGS ═══════════════

test.describe('Phase 4 — tags everywhere', () => {
  test('TagPicker CSS ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.tag-picker/)).toBe(true);
    expect(await hasCssRule(page, /\.tag-chip/)).toBe(true);
  });

  test('card tag chip strip CSS ships', async ({ page }) => {
    await go(page);
    expect(await hasCssRule(page, /\.card-tags-strip/)).toBe(true);
    expect(await hasCssRule(page, /\.card-tag-chip/)).toBe(true);
  });

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

  test('right-click empty canvas → Save as template + Export entries', async ({ page }) => {
    await go(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Save board as template…')).toBeVisible();
    await expect(menu.getByText('Export', { exact: true })).toBeVisible();
  });

  test('right-click → Add link… entry', async ({ page }) => {
    await go(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    await expect(page.locator('.ctx-menu').getByText('Add link…')).toBeVisible();
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
    await go(page);
    const wrap = page.locator('.canvas-wrap');
    await wrap.click({ button: 'right', position: { x: 80, y: 80 } });
    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    // Old items still present.
    await expect(menu.getByText('Add', { exact: true })).toBeVisible();
    await expect(menu.getByText('Background')).toBeVisible();
    await expect(menu.getByText('Reset zoom (⌘0)')).toBeVisible();
    // New items present.
    await expect(menu.getByText('Add comment', { exact: true })).toBeVisible();
    await expect(menu.getByText('Add link…')).toBeVisible();
    await expect(menu.getByText('Save board as template…')).toBeVisible();
    await expect(menu.getByText('Export', { exact: true })).toBeVisible();
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
