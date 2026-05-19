// Capacitor native shell wiring. Safe to import unconditionally — each
// plugin's `isAvailable()` (or the Capacitor.isNativePlatform() check)
// short-circuits the web build to a no-op, so this module costs ~nothing
// outside the native app.
//
// Called once from main.jsx at startup; the platform-specific bits run
// only when wrapped in iOS / Android via Capacitor.

import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';

let initDone = false;

export async function initCapacitor() {
  if (initDone) return;
  initDone = true;
  if (!Capacitor.isNativePlatform()) return;

  // ── Status bar ───────────────────────────────────────────────────────
  // Match the app's data-theme: dark theme = light icons, light theme
  // = dark icons. Re-evaluate when the theme attribute flips so users
  // who toggle theme in-session don't end up with mismatched icons.
  const applyStatusBarStyle = async () => {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    try {
      await StatusBar.setStyle({ style: theme === 'light' ? Style.Dark : Style.Light });
      await StatusBar.setOverlaysWebView({ overlay: true });
    } catch (_) {}
  };
  applyStatusBarStyle();
  const themeObs = new MutationObserver(applyStatusBarStyle);
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ── Keyboard ─────────────────────────────────────────────────────────
  // Resize mode 'native' pushes the WebView up, letting our CSS env()
  // safe-area-inset-bottom handle visible spacing. Combined with
  // touch-action: manipulation it gives a fluid keyboard flow.
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
    await Keyboard.setScroll({ isDisabled: false });
  } catch (_) {}

  // ── Splash ───────────────────────────────────────────────────────────
  // Hide the launch screen after a short delay so first paint lands
  // without a white flash. capacitor.config.ts can extend this for
  // slower startup paths if needed.
  try {
    setTimeout(() => SplashScreen.hide().catch(() => {}), 350);
  } catch (_) {}

  // ── Deep links ───────────────────────────────────────────────────────
  // When the OS launches us via a clusters://… or
  // https://clusters.soleilpictures.com/… URL, hand the path off to our
  // hand-rolled router by updating history.
  try {
    CapApp.addListener('appUrlOpen', (event) => {
      const url = event?.url || '';
      try {
        const u = new URL(url);
        const path = u.pathname + u.search + u.hash;
        if (path && path !== window.location.pathname + window.location.search + window.location.hash) {
          window.history.replaceState({}, document.title, path);
          // Trigger a popstate so the surface-state-driven router picks it up.
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      } catch (_) {}
    });
  } catch (_) {}

  // ── Back button (Android) ────────────────────────────────────────────
  // Default Capacitor behavior is to exit the app on back; reroute to a
  // standard "history.back when possible, exit otherwise" pattern.
  try {
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else CapApp.exitApp();
    });
  } catch (_) {}
}
