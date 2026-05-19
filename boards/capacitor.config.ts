import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor wraps the Vite build (`dist/`) in a native iOS/Android shell.
// Same web codebase = native app; we don't maintain a parallel React Native
// or Swift/Kotlin codebase.
//
// `webDir` points at the Vite production output. Run `npm run build` before
// `npx cap sync` so the latest assets are bundled into the native projects.
//
// Live reload during dev: set CAP_DEV=1 in your shell and the server block
// is honored — the native app loads from your LAN dev server so you can
// iterate on web code with hot reload on a real device.
const isDev = process.env.CAP_DEV === '1';
const devServerUrl = process.env.CAP_DEV_URL || 'http://localhost:5173';

const config: CapacitorConfig = {
  appId: 'com.soleilpictures.clusters',
  appName: 'Soleil Clusters',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: isDev
    ? {
        url: devServerUrl,
        cleartext: true,
      }
    : undefined,
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
    // Stop iOS WebView rubber-band / elastic scrolling — our scroll
    // containers handle their own overscroll-behavior, and the
    // horizontal pan a user reported on the auth screen was the
    // WebView's own bounce. Vertical scroll inside .modal-body /
    // .picker-list / etc. still works (those use their own scrollers).
    scrollEnabled: false,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
