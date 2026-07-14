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
    for (const ev of ['cluster_created', 'cluster_renamed', 'cluster_opened', 'nav_back', 'content_added', 'view_switched']) {
      expect(s).toContain(`type: '${ev}'`);
    }
  });

  test('App tags the List toggle as the list-step anchor', () => {
    expect(app()).toContain('data-tour="view-toggle"');
  });

  test('the touch "Add photos" tour action is wired end to end', () => {
    // Pill action → App dispatches → CanvasSurface picker (NOT tour-locked).
    expect(app()).toContain("soleil-pick-photos");
    const cs = canvas();
    expect(cs).toContain("addEventListener('soleil-pick-photos'");
    expect(cs).toContain('pickPhotosAt');
    // The mobile first-card one-tap goes to photos, never a reflexive note.
    expect(cs).toContain("pickPhotosAtRef.current?.(pos, 'plus_empty')");
  });

  test('first-card dismiss + first-value nudge never fire mid-tour', () => {
    const s = app();
    // The step-1 cluster is a genuine card: dismissing on it killed the whole
    // tour in prod (0 users ever advanced past step 1). Keep both gates.
    expect(s).toContain("if (onboardingUiActive && !tourActive) dismissOnboarding('placed')");
    expect(s).toMatch(/tier === 'demo' && !tourActive && genuine\.length >= 2/);
  });

  test('first-value nudge has no first-session timer (2nd genuine card only)', () => {
    // The old ~15s-after-card-1 timer surfaced the upsell at a median of 40s
    // after first app open with 0 conversions ever — it must not come back.
    expect(app()).not.toContain('firstValueTimerRef');
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

const mbnav = () => read('src/components/shell/MobileBottomNav.jsx');

test.describe('mobile onboarding wiring', () => {
  test('App latches the tour variant once (isPhone → mobile_lite) and never re-derives it', () => {
    const s = app();
    expect(s).toMatch(/tourVariantRef/);
    // latched from isPhone at first decision, passed into the hook
    expect(s).toMatch(/isPhone \? 'mobile_lite' : 'full'/);
    expect(s).toMatch(/variant: tourVariantRef\.current/);
  });

  test('App gates the tour on onboardingUiActive OR the latched desktop handoff', () => {
    const s = app();
    // handoff must be a decide-once latch, NOT re-derived from live settings
    // (a live gate would self-destruct once the first full advance persists variant:'full')
    expect(s).toMatch(/desktopHandoff/);
    expect(s).toMatch(/tour\??\.variant === 'mobile_lite'/);
    expect(s).toMatch(/tourActive = onboardingArmB && \(onboardingUiActive \|\| desktopHandoff\)/);
  });

  test('the 7/10 tour-kill guards remain intact under the new gate', () => {
    const s = app();
    // persistTour still re-asserts seeded:true; dismiss still gated on !tourActive
    expect(s).toMatch(/seeded: true/);
    expect(s).toContain("if (onboardingUiActive && !tourActive) dismissOnboarding('placed')");
  });

  test('the step funnel carries the variant so mobile vs full is separable', () => {
    expect(app()).toMatch(/variant: tourVariantRef\.current/);
    // emitTourStep payload includes variant
    expect(app()).toMatch(/EV\.ONBOARDING_STEP, \{[\s\S]*?variant/);
  });

  test('MobileBottomNav tags the create puck as the mb-create anchor', () => {
    expect(mbnav()).toContain('data-tour="mb-create"');
  });

  test('OnboardingTour honors a per-step lock:false (mobile steps do not lock)', () => {
    const s = tourComp();
    expect(s).toMatch(/step\?\.lock !== false/);
    expect(s).toContain("setAttribute('data-tour-variant'");
  });

  test('CanvasSurface emits the photo-picker adoption + depth events', () => {
    const s = canvas();
    expect(s).toContain('EV.PHOTO_PICK_OPEN');
    expect(s).toContain('EV.PHOTO_PICK_COMMIT');
    expect(s).toContain('n_selected');
  });

  test('the momentum beat is device-local + once-ever + never mid-tour', () => {
    const s = canvas();
    expect(s).toContain('momentumHintSeen');
    expect(s).toContain('markMomentumHintSeen');
    // suppressed while a tour pill (either variant flag) is showing
    expect(s).toMatch(/tourVariant|tourActive === '1'/);
    // never re-fires from its own re-pick
    expect(s).toMatch(/source !== 'momentum'/);
  });

  test('the mobile completion beat mentions the desktop studio (no reintroduced interstitial)', () => {
    const s = app();
    expect(s).toMatch(/computer/i);
    // the deleted MobileDesktopNotice must NOT come back
    expect(s).not.toContain('MobileDesktopNotice');
  });
});
