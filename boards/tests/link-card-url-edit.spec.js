import { expect, test } from '@playwright/test';

// Editing a link card's URL replaces the old site's preview: its image and
// favicon go, the new page's preview is fetched, and a YouTube address turns
// the card into a player (CARDS-15). The preview endpoints are mocked.

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const OG = {
  'https://first.example/': { title: 'First page', image: `${PIXEL}#first` },
  'https://second.example/': { title: 'Second page', image: `${PIXEL}#second` },
};

async function editUrl(page, card, url) {
  const src = card.locator('.lc-src-text');
  await src.dblclick();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(url);
  await page.keyboard.press('Enter');
}

test('a new URL brings its own preview and drops the old one', async ({ page }) => {
  await page.route('**/api/og?**', (route) => {
    const u = new URL(route.request().url()).searchParams.get('url');
    const hit = OG[u] || OG[u + '/'];
    return route.fulfill({ json: hit ? { ...hit, url: u } : { error: 'nope' } });
  });
  await page.route('https://api.microlink.io/**', (route) => route.fulfill({ status: 500, body: '' }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  const card = page.locator('[data-card-id="home-link"]');
  await card.waitFor({ state: 'visible' });

  await editUrl(page, card, 'https://first.example/');
  await expect(card.locator('.lc-preview-img')).toHaveAttribute('src', /#first$/);

  await editUrl(page, card, 'https://second.example/');
  await expect(card.locator('.lc-preview-img')).toHaveAttribute('src', /#second$/);
  // The user's own title is never replaced by a page's.
  await expect(card.locator('.lc-title')).toHaveText('Q4 production calendar');

  await editUrl(page, card, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(card.locator('.lc-embed-frame')).toBeVisible();
  await expect(card.locator('.lc-preview-img')).toHaveCount(0);
});
