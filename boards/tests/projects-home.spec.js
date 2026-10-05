// projects-home.spec.js — Home shows your projects over the universe, and a new
// project starts at the top level, opened, the way a first board does.
//
// Runs on the local harness (?local=1), which mounts the same ProjectsHome and
// CanvasSurface as the app, with its own mirror of App.jsx's addNewProject. The
// App.jsx-only wiring (sidebar "+", cmd-K, the cap check, the trial offer) is
// pinned in new-project-wiring.spec.js.
import { expect, test } from '@playwright/test';

const openHome = async (page) => {
  await page.locator('.sb-row', { hasText: 'Home' }).first().click();
  await expect(page.locator('.ph-panel')).toBeVisible();
};

test.describe('projects home', () => {
  test('Home is a projects panel over the universe, not the graph alone', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1');
    await openHome(page);
    const panel = page.locator('.ph-panel');
    await expect(panel.locator('.ph-eyebrow', { hasText: 'Your projects' })).toBeVisible();
    await expect(panel.locator('.ph-tile', { hasText: 'Studio' })).toBeVisible();
    await expect(panel.locator('.ph-tile-new')).toBeVisible();
    // The graph is still there, behind the panel.
    await expect(page.locator('.ph-graph .home-graph-wrap')).toHaveCount(1);
  });

  test('Explore puts the panel away and Projects brings it back', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1');
    await openHome(page);
    await page.locator('.ph-explore').click();
    await expect(page.locator('.ph-panel')).toHaveCount(0);
    await expect(page.locator('.ph-projects-pill')).toBeVisible();
    await page.locator('.ph-projects-pill').click();
    await expect(page.locator('.ph-panel')).toBeVisible();
  });

  test('a new project is named where it was asked for, opens at the top level, and starts like a first board', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1');
    await openHome(page);
    await page.locator('.ph-tile-new').click();
    const input = page.locator('.ph-new-input');
    await expect(input).toBeFocused();
    await input.fill('Spec ad');
    await input.press('Enter');

    // Landed inside it, with the root in the breadcrumb — a sibling of whatever
    // was open, never a child of it.
    const crumbs = page.locator('.crumbs .crumb');
    await expect(crumbs).toHaveText(['Studio', 'Spec ad']);

    // The empty project gets the first board's treatment: material from
    // elsewhere, writing tiles only, and its name in the headline slot.
    const panel = page.locator('.cnv-empty-tiles');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-project/);
    await expect(panel.locator('.cnv-empty-tile-hero-hint')).toContainText(/paste or drag/i);
    const labels = await panel.locator('.cnv-empty-tile:not(.cnv-empty-tile-hero) .cnv-empty-tile-lbl').allTextContents();
    expect(labels).toEqual(['Note', 'Doc']);
    const name = panel.locator('.cnv-empty-project-name');
    await expect(name).toHaveValue('Spec ad');
    // Never autofocused: a focused field would swallow the paste the panel asks for.
    await expect(name).not.toBeFocused();

    // Back on Home it is listed among the projects.
    await openHome(page);
    await expect(page.locator('.ph-grid .ph-tile', { hasText: 'Spec ad' })).toBeVisible();
  });

  test('an untitled project shows the ask as a placeholder, and naming it renames the cluster', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1');
    await openHome(page);
    await page.locator('.ph-tile-new').click();
    await page.locator('.ph-new-input').press('Enter');
    const name = page.locator('.cnv-empty-project-name');
    await expect(name).toHaveValue('');
    await expect(name).toHaveAttribute('placeholder', 'Name this project');
  });

  test('the root keeps the full panel: only top-level projects get the project variant', async ({ page }) => {
    await page.goto('/?local=1&reset=1&blank=1');
    const panel = page.locator('.cnv-empty-tiles');
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveClass(/is-project/);
    await expect(panel.locator('.cnv-empty-project-name')).toHaveCount(0);
  });
});
