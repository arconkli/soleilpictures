# Capacitor — native iOS / Android wrapper

The boards app ships to the web via Cloudflare Pages and to the App Store /
Play Store via Capacitor, which wraps the same Vite build (`dist/`) in a
native shell. There is no separate React Native codebase — every change to
the React app updates both web and native.

## One-time setup

### Prerequisites

- macOS with **Xcode 26+** for iOS — install from the App Store.
- **CocoaPods** for iOS native dependencies — `brew install cocoapods` (or
  `sudo gem install cocoapods` on systems without Homebrew).
- **Android Studio** with the Android SDK + Platform Tools for Android.
- **JDK 17+** for the Android Gradle build.

Verify each is on `PATH`:

```bash
xcodebuild -version    # Xcode
pod --version          # CocoaPods
adb --version          # Android SDK
java --version         # JDK
```

### Add the native platforms

Once the prerequisites are installed, scaffold the two native projects from
`boards/`:

```bash
cd boards
npm run cap:add:ios       # creates boards/ios/
npm run cap:add:android   # creates boards/android/
```

Both directories are committed to the repo so anyone cloning gets a working
native build. They're separate from the Vite build and won't be rebuilt by
Cloudflare Pages.

## Day-to-day workflow

```bash
# After web code changes, sync the dist/ output into the native projects.
npm run cap:sync

# Open in Xcode or Android Studio (lets you tweak native config, signing).
npm run cap:open:ios
npm run cap:open:android

# Build + run on a simulator / connected device.
npm run cap:run:ios
npm run cap:run:android

# Live reload — point the native shell at your LAN dev server so you can
# iterate on web code with hot reload on a real phone. Make sure the
# dev server is bound to your LAN IP (npm run dev -- --host 0.0.0.0)
# and update CAP_DEV_URL if 127.0.0.1 isn't what the phone can reach.
CAP_DEV=1 CAP_DEV_URL=http://192.168.1.42:5173 npm run cap:dev:ios
```

## How this fits with Cloudflare Pages

Capacitor is additive. Cloudflare Pages continues to build `dist/` from a
git push exactly as before — `wrangler.toml`, the Vite config, and the
Worker entry are unchanged. The native shells point at the same `dist/`
output for production releases.

## Already wired (in `src/lib/capacitorInit.js`, called from `main.jsx`)

- Status bar style tracks `data-theme` (dark theme → light icons, light
  theme → dark icons; re-applies on theme toggle).
- Keyboard resize mode = `Native` (the WebView slides up so safe-area
  insets handle visible spacing).
- Splash screen auto-hides 350ms after first paint.
- Deep links: `appUrlOpen` is forwarded into the hand-rolled router via
  `history.replaceState` + a `popstate` dispatch.
- Android hardware back button: `history.back` if possible, else
  `CapApp.exitApp`.

All of the above is a no-op in the web build (every plugin checks
`Capacitor.isNativePlatform()` first) — Cloudflare Pages deploys keep
working exactly as before.

## Still to do (after `npx cap add ios/android`)

- **App icons + splash from a single SVG**: install `@capacitor/assets`
  (dev dep), drop a 1024px icon and a 2732px splash in `assets/`, run
  `npx capacitor-assets generate`.
- **Push notifications**: install `@capacitor/push-notifications` and
  wire token registration to the existing realtime / messages backend.
- **Live Updates** (optional but useful): `@capacitor/live-updates` or
  `@capgo/capacitor-updater` so we can iterate on the web bundle without
  an app-store re-review for every change.

## App store / store listings

- Bundle ID: `com.soleilpictures.clusters`
- App name: `Soleil Clusters`
- Initial distribution: TestFlight (iOS) / Internal testing track (Android).
  Public store submission happens after the full P1–P4 mobile work lands.
