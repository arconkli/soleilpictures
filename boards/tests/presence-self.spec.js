// COMMS-20: with a cluster open in a second tab or on another device, the
// board facepile listed YOU as "1 other person here" — it skipped only this
// tab's awareness clientID, not your user id. Driven through the
// ?presenceqa=1 harness, which mounts the real <PresenceStack selfId="self">.

import { expect, test } from '@playwright/test';

test('your own user on another client is not "another person here"', async ({ page }) => {
  await page.goto('/?presenceqa=1');
  await page.waitForSelector('#root[data-presenceqa-ready="1"]');
  await page.evaluate(() => {
    const aw = window.__soleilPresenceAw;
    aw._states.clear();
    // Client 7 is you in another tab; client 8 is a real peer.
    aw._setState(7, { user: { id: 'self', name: 'Me Elsewhere', color: '#888888' } });
    aw._setState(8, { user: { id: 'peer', name: 'Pat', color: '#4f8df8' } });
    aw._emit();
  });
  const stack = page.locator('.presence-stack');
  await expect(stack).toHaveAttribute('aria-label', '1 other person here');
  await expect(stack.locator('.presence-dot')).toHaveCount(1);
  await expect(stack.locator('.presence-dot')).toHaveAttribute('title', 'Pat');

  // Only you, elsewhere: nobody else is here, so no facepile at all.
  await page.evaluate(() => {
    const aw = window.__soleilPresenceAw;
    aw._delete(8);
    aw._emit();
  });
  await expect(page.locator('.presence-stack')).toHaveCount(0);
});
