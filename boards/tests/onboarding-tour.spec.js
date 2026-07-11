// Browser test for the OnboardingTour overlay + anchoring, driven through the
// dev-only ?tourqa=1 harness (mirrors ?alignqa / ?noteqa). The harness renders
// fake data-tour anchors and mounts the real <OnboardingTour> driven by the real
// step engine, isolated from Supabase.
import { expect, test } from '@playwright/test';

const near = (a, b, slop = 40) =>
  a && b &&
  a.x < b.x + b.width + slop && a.x + a.width + slop > b.x &&
  a.y < b.y + b.height + slop && a.y + a.height + slop > b.y;

test.describe('onboarding tour overlay', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await page.goto('/?tourqa=1');
    await expect(page.locator('#tourqa-ready')).toBeVisible({ timeout: 15000 });
  });

  test('shows the create step anchored to the left-rail Cluster tool, with a target ring', async ({ page }) => {
    const pill = page.locator('.onboarding-tour');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Make your first cluster');
    await expect(pill).toHaveAttribute('data-tour-anchor', 'cluster-tool');

    const pillBox = await pill.boundingBox();
    const anchorBox = await page.locator('[data-tour="cluster-tool"]').boundingBox();
    expect(near(pillBox, anchorBox)).toBe(true);

    // The target element gets the highlight ring so it's obvious what's pointed at.
    await expect(page.locator('[data-tour="cluster-tool"]')).toHaveClass(/tour-target/);
  });

  test('moves the target ring from one anchor to the next as steps advance', async ({ page }) => {
    await expect(page.locator('[data-tour="cluster-tool"]')).toHaveClass(/tour-target/);
    await page.evaluate(() => window.__soleilTourTest.fire({ type: 'cluster_created', boardId: 'b1' }));
    // ring leaves the tool, lands on the cluster card (rename step)
    await expect(page.locator('[data-tour="cluster-tool"]')).not.toHaveClass(/tour-target/);
    await expect(page.locator('[data-tour="cluster-card"]')).toHaveClass(/tour-target/);
  });

  test('advances through the steps as events fire, re-anchoring each time', async ({ page }) => {
    const pill = page.locator('.onboarding-tour');

    await page.evaluate(() => window.__soleilTourTest.fire({ type: 'cluster_created', boardId: 'b1' }));
    await expect(pill).toContainText('Name it');
    await expect(pill).toHaveAttribute('data-tour-anchor', 'cluster-card');

    await page.evaluate(() => window.__soleilTourTest.fire({ type: 'cluster_renamed', boardId: 'b1' }));
    await expect(pill).toContainText('Step inside');
    // Clusters open on a single click — copy must not say "double-click".
    await expect(pill).toContainText('Click your cluster to open it');
    await expect(pill).not.toContainText(/double-click/i);

    await page.evaluate(() => window.__soleilTourTest.fire({ type: 'cluster_opened', boardId: 'b1' }));
    await expect(pill).toContainText('Find your way back');
    await expect(pill).toHaveAttribute('data-tour-anchor', 'nav');
  });

  test('the nav step advances via its Got it button', async ({ page }) => {
    await page.evaluate(() => {
      const T = window.__soleilTourTest;
      T.fire({ type: 'cluster_created', boardId: 'b1' });
      T.fire({ type: 'cluster_renamed', boardId: 'b1' });
      T.fire({ type: 'cluster_opened', boardId: 'b1' });
    });
    const pill = page.locator('.onboarding-tour');
    await expect(pill).toContainText('Find your way back');
    await pill.getByRole('button', { name: /got it/i }).click();
    await expect(pill).toContainText('Now add anything');
    await expect(pill).toHaveAttribute('data-tour-anchor', 'rail');
  });

  test('the content step hands off to the list step, anchored to the view toggle', async ({ page }) => {
    await page.evaluate(() => {
      const T = window.__soleilTourTest;
      for (const e of [
        { type: 'cluster_created', boardId: 'b1' },
        { type: 'cluster_renamed', boardId: 'b1' },
        { type: 'cluster_opened', boardId: 'b1' },
        { type: 'nav_ack' },
        { type: 'content_added', boardId: 'b1', kind: 'image' },
      ]) T.fire(e);
    });
    const pill = page.locator('.onboarding-tour');
    await expect(pill).toContainText('Every cluster is also a drive');
    await expect(pill).toHaveAttribute('data-tour-anchor', 'view-toggle');
    await expect(page.locator('[data-tour="view-toggle"]')).toHaveClass(/tour-target/);
    // Anchored → the real List button is the action; no Got-it fallback shown.
    await expect(pill.getByRole('button', { name: /got it/i })).toHaveCount(0);
  });

  test('clicking the real List toggle finishes the tour', async ({ page }) => {
    await page.evaluate(() => {
      const T = window.__soleilTourTest;
      for (const e of [
        { type: 'cluster_created', boardId: 'b1' },
        { type: 'cluster_renamed', boardId: 'b1' },
        { type: 'cluster_opened', boardId: 'b1' },
        { type: 'nav_ack' },
        { type: 'content_added', boardId: 'b1', kind: 'image' },
      ]) T.fire(e);
    });
    await page.locator('[data-tour="view-toggle"]').click();
    await expect(page.locator('.onboarding-tour')).toHaveCount(0);
    expect(await page.evaluate(() => window.__soleilTourTest.getState().done)).toBe(true);
  });

  test('the list step falls back to a centered Got-it when the toggle is hidden', async ({ page }) => {
    await page.evaluate(() => {
      const T = window.__soleilTourTest;
      for (const e of [
        { type: 'cluster_created', boardId: 'b1' },
        { type: 'cluster_renamed', boardId: 'b1' },
        { type: 'cluster_opened', boardId: 'b1' },
        { type: 'nav_ack' },
        { type: 'content_added', boardId: 'b1', kind: 'image' },
      ]) T.fire(e);
      T.setViewToggleVisible(false);
    });
    const pill = page.locator('.onboarding-tour');
    await expect(pill).toContainText('Every cluster is also a drive');
    // Unanchored → centered pill with the acknowledge CTA.
    await expect(pill).toHaveClass(/tour-centered/);
    await pill.getByRole('button', { name: /got it/i }).click();
    await expect(page.locator('.onboarding-tour')).toHaveCount(0);
    expect(await page.evaluate(() => window.__soleilTourTest.getState().done)).toBe(true);
  });

  test('locks the app (body[data-tour-active]) while showing, unlocks when done', async ({ page }) => {
    await expect(page.locator('body')).toHaveAttribute('data-tour-active', '1');
    await page.evaluate(() => {
      const T = window.__soleilTourTest;
      for (const e of [
        { type: 'cluster_created', boardId: 'b1' },
        { type: 'cluster_renamed', boardId: 'b1' },
        { type: 'cluster_opened', boardId: 'b1' },
        { type: 'nav_ack' },
        { type: 'content_added', boardId: 'b1', kind: 'image' },
        { type: 'view_switched', view: 'list', boardId: 'b1' },
      ]) T.fire(e);
    });
    await expect(page.locator('.onboarding-tour')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-tour-active', '1');
  });

  test('Skip ends the tour immediately', async ({ page }) => {
    const pill = page.locator('.onboarding-tour');
    await expect(pill).toBeVisible();
    await pill.getByRole('button', { name: /skip/i }).click();
    await expect(pill).toHaveCount(0);
    expect(await page.evaluate(() => window.__soleilTourTest.getState().done)).toBe(true);
  });

  test('emits onboarding_step events for view / advance / skip', async ({ page }) => {
    await page.evaluate(() => window.__soleilTourTest.fire({ type: 'cluster_created', boardId: 'b1' }));
    await page.locator('.onboarding-tour').getByRole('button', { name: /skip/i }).click();
    const actions = await page.evaluate(() => window.__soleilTourTest.getEmitted().map((e) => e.action));
    expect(actions).toContain('view');
    expect(actions).toContain('advance');
    expect(actions).toContain('skip');
  });
});
