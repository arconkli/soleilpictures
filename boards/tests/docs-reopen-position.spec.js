// Reopening a doc puts the reader back where they left off — same page, same
// spot — instead of the top (or, with autofocus 'end', the very bottom).
// Driven via ?docqa=1 (window.__soleilDocTest).
import { expect, test } from '@playwright/test';

async function openDoc(page) {
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

test('a reopened doc resumes at the block it was closed on', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await openDoc(page);
  await page.evaluate(() => {
    const ps = Array.from({ length: 120 }, (_, i) => `<p>Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog.</p>`).join('');
    window.__soleilDocTest.editor.chain().setContent(ps).run();
  });
  await page.waitForTimeout(300);

  const paper = page.locator('.doc-card-modal .doc-paper');
  await paper.hover();
  await page.mouse.wheel(0, 2200);
  await page.waitForTimeout(500); // past the 250ms capture throttle
  const topText = () => page.evaluate(() => {
    const p = document.querySelector('.doc-card-modal .doc-paper');
    const pr = p.getBoundingClientRect();
    const el = [...p.querySelectorAll('.tt-editor p')].find(n => n.getBoundingClientRect().bottom > pr.top + 12);
    return el?.textContent.split('.')[0];
  });
  const before = await topText();
  expect(before).not.toBe('Paragraph 1');

  await page.getByRole('button', { name: 'Close document' }).click();
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
  await openDoc(page);
  await page.waitForTimeout(800);
  expect(await topText()).toBe(before);
});
