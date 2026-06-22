// Regression guards for the docs UX-polish pass. Deterministic
// (stylesheet-based) so they don't depend on reaching the DocSurface, which
// only mounts against the authenticated Yjs/realtime backend — not in local
// QA mode. These lock in the CSS contracts the polish introduced:
//   - the page-switch settle animation (doc-sheet-fade-in) + reduced-motion guard
//   - the eyebrow/title empty + loading state classes
//   - the enriched empty-page-tree affordance classes
import { expect, test } from '@playwright/test';

// Collect every selector text + keyframe name from the loaded stylesheets,
// plus the raw cssText of any rule whose selector matches a probe so we can
// assert specific declarations without needing the element in the DOM.
async function collectCss(page) {
  await page.goto('/?local=1');
  // In dev, Vite injects the bundled CSS via JS after load — wait for it to be
  // present so the stylesheet scan is deterministic (not racing CSS injection).
  await page.waitForFunction(() => {
    for (const s of document.styleSheets) {
      try { for (const r of s.cssRules) if (r.cssText && r.cssText.includes('doc-sheet-fade-in')) return true; }
      catch { /* cross-origin */ }
    }
    return false;
  }, null, { timeout: 15000 });
  return page.evaluate(() => {
    const selectors = new Set();
    const keyframes = new Set();
    const rules = []; // { sel, text } per style rule (incl. those nested in @media)
    const walk = (cssRules) => {
      for (const r of cssRules) {
        if (r.type === CSSRule.KEYFRAMES_RULE) { keyframes.add(r.name); continue; }
        if (r.selectorText) { selectors.add(r.selectorText); rules.push({ sel: r.selectorText, text: r.cssText }); }
        if (r.cssRules) walk(r.cssRules); // descend into @media etc.
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* cross-origin */ }
    }
    return { selectors: [...selectors], keyframes: [...keyframes], rules };
  });
}

test('page-switch settle animation keyframe is defined and used', async ({ page }) => {
  const { keyframes, rules } = await collectCss(page);
  expect(keyframes).toContain('doc-sheet-fade-in');
  // The base .doc-editor-wrap rule must reference the keyframe by name.
  expect(rules.some(r => r.sel === '.doc-editor-wrap' && r.text.includes('doc-sheet-fade-in'))).toBeTruthy();
});

test('reduced-motion disables the sheet animation', async ({ page }) => {
  const { rules } = await collectCss(page);
  // Inside a prefers-reduced-motion block the wrap animation is turned off.
  // CSSOM expands `animation: none` to the full shorthand (e.g.
  // "auto ease 0s 1 normal none running none"), so the disabled override is
  // the .doc-editor-wrap rule whose animation value contains `none` rather
  // than referencing the keyframe.
  expect(rules.some(r => r.sel === '.doc-editor-wrap'
    && /animation:[^;]*\bnone\b/.test(r.text)
    && !r.text.includes('doc-sheet-fade-in'))).toBeTruthy();
});

test('empty + loading states use the eyebrow/title class contract', async ({ page }) => {
  const { selectors } = await collectCss(page);
  expect(selectors).toContain('.doc-state-title');
  expect(selectors).toContain('.doc-state-sub');
  // The empty/loading containers were converted from centered italics to a column.
  expect(selectors.some(s => /\.doc-empty/.test(s) && /\.doc-loading/.test(s))).toBeTruthy();
});

test('enriched empty-page-tree affordance classes exist', async ({ page }) => {
  const { selectors } = await collectCss(page);
  for (const cls of ['.doc-tree-empty-plus', '.doc-tree-empty-title', '.doc-tree-empty-sub']) {
    expect(selectors).toContain(cls);
  }
});

test('always-readable note ink: bidirectional surface-tone rules, no wildcard sledgehammer', async ({ page }) => {
  const { selectors } = await collectCss(page);
  // Both surface tones drive default ink now (was light-only).
  expect(selectors).toContain('.note.is-light-bg');
  expect(selectors).toContain('.note.is-dark-bg');
  // The old `.note.is-light-bg .note-body *` wildcard (which nuked every accent
  // color with !important) must be gone — accents are preserved + made readable
  // per-run instead.
  expect(selectors.some((s) => s.includes('.note-body *'))).toBeFalsy();
});
