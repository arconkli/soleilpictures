// Source-guard for the guided-tour integration that runs on the Supabase
// Workspace path (not reachable by the backend-free harness). Mirrors the
// undo-redo.spec.js "this machinery is wired in" style — cheap regression
// insurance for the App.jsx / CanvasSurface wiring.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const canvas = () => read('src/components/CanvasSurface.jsx');
const styles = () => read('src/styles.css');
const tourComp = () => read('src/components/OnboardingTour.jsx');

test.describe('guided tour wiring', () => {
  test('App mounts the tour and retires the static pill for arm B', () => {
    const s = app();
    expect(s).toMatch(/import \{ OnboardingTour \}/);
    expect(s).toMatch(/useOnboardingTour\(/);
    expect(s).toMatch(/showCoachmark && !onboardingArmB/);
    expect(s).toMatch(/<OnboardingTour\b/);
  });

  test('App fires every tour advance trigger', () => {
    const s = app();
    for (const ev of ['cluster_created', 'cluster_renamed', 'cluster_opened', 'nav_back', 'content_added']) {
      expect(s).toContain(`type: '${ev}'`);
    }
  });

  test('CanvasSurface exposes the cluster + image data-tour anchors', () => {
    const s = canvas();
    expect(s).toContain("'cluster-tool'");
    expect(s).toContain("'image-tool'");
    expect(s).toContain("'empty-cluster-tile'");
  });

  test('App tags the nav breadcrumb anchor', () => {
    expect(app()).toContain('className="crumbs" data-tour="nav"');
  });

  test('OnboardingTour sets the body[data-tour-active] lock flag', () => {
    expect(tourComp()).toContain("setAttribute('data-tour-active'");
    expect(tourComp()).toContain("removeAttribute('data-tour-active')");
  });

  test('styles.css locks chrome under body[data-tour-active] and keeps target+pill live', () => {
    const s = styles();
    expect(s).toContain('body[data-tour-active]');
    expect(s).toMatch(/body\[data-tour-active\][^{]*\.tour-target[\s\S]*pointer-events:\s*auto/);
    expect(s).toContain('body[data-tour-active] .cnv-empty-tiles');
  });

  test('CanvasSurface bails note-creating gestures while the tour is active', () => {
    const s = canvas();
    // both the desktop dblclick quick-add and the mobile add listener must yield
    const hits = s.match(/dataset\.tourActive === '1'/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
