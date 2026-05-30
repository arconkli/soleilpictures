// Regression guards for the app-wide UX consistency/polish pass:
// the modalRise keyframe that was previously referenced-but-undefined, the
// motion/disabled design tokens, the canonical :disabled treatment, the shared
// Modal/Spinner/toast primitive classes, the :focus-visible conversions, and
// the reduced-motion guard. Deterministic (stylesheet/computed-style based) so
// they don't depend on reaching individual modals in local QA mode.
import { expect, test } from '@playwright/test';

test('modal/spinner/toast keyframes are defined (modalRise was previously missing)', async ({ page }) => {
  await page.goto('/?local=1');
  const names = await page.evaluate(() => {
    const s = new Set();
    for (const sheet of document.styleSheets) {
      try { for (const r of sheet.cssRules) if (r.type === CSSRule.KEYFRAMES_RULE) s.add(r.name); } catch {}
    }
    return [...s];
  });
  for (const k of ['modalRise', 'spin', 'toastIn', 'toastOut']) expect(names).toContain(k);
});

test('motion + disabled design tokens are defined', async ({ page }) => {
  await page.goto('/?local=1');
  const t = await page.evaluate(() => {
    const r = getComputedStyle(document.documentElement);
    return {
      durQuick: r.getPropertyValue('--dur-quick').trim(),
      disabledOpacity: r.getPropertyValue('--disabled-opacity').trim(),
    };
  });
  expect(t.durQuick).toBe('80ms');
  expect(t.disabledOpacity).toBe('0.4');
});

test('canonical :disabled treatment fills in controls with no own styling', async ({ page }) => {
  await page.goto('/?local=1');
  const res = await page.evaluate(() => {
    const make = (disabled) => {
      const b = document.createElement('button');
      if (disabled) b.disabled = true;
      b.textContent = 'probe';
      document.body.appendChild(b);
      const cs = getComputedStyle(b);
      const out = { opacity: cs.opacity, cursor: cs.cursor };
      b.remove();
      return out;
    };
    return { disabled: make(true), enabled: make(false) };
  });
  expect(parseFloat(res.disabled.opacity)).toBeCloseTo(0.4, 2);
  expect(res.disabled.cursor).toBe('not-allowed');
  expect(parseFloat(res.enabled.opacity)).toBe(1);
});

test('shared Modal/Spinner/toast primitive classes are shipped', async ({ page }) => {
  await page.goto('/?local=1');
  const sels = await page.evaluate(() => {
    const out = [];
    for (const sheet of document.styleSheets) {
      try { for (const r of sheet.cssRules) if (r.selectorText) out.push(r.selectorText); } catch {}
    }
    return out.join(' || ');
  });
  for (const w of ['modal-shell', 'modal-shell-bg', 'modal-shell-x', 'spinner', 'toast-dismiss', 'toast-icon']) {
    // word boundary so `.modal-shell` doesn't match `.modal-shell-bg`, etc.
    const re = new RegExp('\\.' + w + '(?![\\w-])');
    expect(re.test(sels), `expected a .${w} selector`).toBe(true);
  }
});

test('inputs use :focus-visible (not bare :focus) for the focus ring', async ({ page }) => {
  await page.goto('/?local=1');
  const hasFocusVisible = await page.evaluate(() => {
    let ok = false;
    for (const sheet of document.styleSheets) {
      try {
        for (const r of sheet.cssRules) {
          if (r.selectorText === '.share-input:focus-visible' || r.selectorText === '.sb-tag-create-input:focus-visible') ok = true;
        }
      } catch {}
    }
    return ok;
  });
  expect(hasFocusVisible).toBe(true);
});

test('reduced-motion guard neutralizes transforms', async ({ page }) => {
  await page.goto('/?local=1');
  const ok = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const r of sheet.cssRules) {
          if (r.type === CSSRule.MEDIA_RULE && (r.conditionText || '').includes('prefers-reduced-motion')) {
            for (const inner of r.cssRules) {
              if ((inner.style?.transform || '').toLowerCase() === 'none') return true;
            }
          }
        }
      } catch {}
    }
    return false;
  });
  expect(ok).toBe(true);
});

test('no page errors after the modal/toast/spinner refactor', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/?local=1');
  await expect(page.getByRole('main').getByText('Studio', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  expect(errors).toEqual([]);
});
