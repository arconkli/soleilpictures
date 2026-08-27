# Mobile and tablet

> Clusters works in a mobile browser, installs as a PWA, and ships as iOS and Android apps. On touch devices the canvas gets pinch-zoom and long-press menus, a bottom navigation bar replaces the sidebar, and a focus view strips everything back to the board. Tablets with a stylus get pressure-sensitive drawing with palm rejection.

_Source: https://clusters.soleilpictures.com/docs/account/mobile · Updated 2026-08-27_

Three ways to run it on a phone or tablet: the mobile browser, an installed PWA,
or the native iOS and Android apps. They are the same app.

## Touch on the canvas

| Gesture | Does |
|---|---|
| One finger drag | Pan |
| Pinch | Zoom |
| Tap | Select |
| Long press | Context menu |
| Double tap | Add menu at that point |

With the draw tool active, one finger draws and two fingers still pinch-zoom.
Starting a pinch part-way through a stroke discards that stroke rather than
smearing it across the board as the canvas moves underneath — the failure that
makes drawing on touch unusable.

## Layout differences

**Bottom navigation** replaces the sidebar — Home, the current board, Messages,
and more.

**A drawer** holds navigation that does not fit.

**The add sheet** replaces the tool rail's `+` menu with a full-width sheet,
sized for thumbs.

**Focus view** — touch only — strips everything back to the board itself, for
reviewing on a phone without chrome in the way.

## Tablets

Tablets get closer to the desktop layout — the rail rather than the sheet — plus
stylus drawing. On iPad, drawing, annotating and reviewing all work properly;
long document editing is still better on a laptop.

**Drawing** is on the rail directly on touch, and in the add sheet, rather than
behind the `D` shortcut there is no keyboard for. A stylus draws with pressure;
flipping it over erases. The full-screen [sketch pad](/docs/canvas/shapes-and-drawing#the-sketch-pad)
goes edge to edge, with pinch-to-zoom inside the frame for detail work and its
brushes, colours, layers and frame formats in a sheet sized for thumbs.

The [Home graph](/docs/clusters/home-graph) renders its 2D fallback on most
tablets, which has the same nodes and interactions.

## Installing

**As a PWA** — "Add to Home Screen" from the browser. It runs standalone,
without browser chrome.

**Native apps** for iOS and Android handle the status bar, keyboard behaviour,
the splash screen, deep links, the Android back button, and the system share
sheet — so [exports](/docs/documents/export) land in Files or another app
rather than a downloads folder.

## Getting photos in from a phone

Three routes:

1. **Upload** from the add sheet — the camera roll picker.
2. **Share sheet** from Photos.
3. **[Soleil Scout](/docs/scout)** — text them, with no app at all. Note that Scout's phone line is not live yet.

## What is worse on a small screen

Honestly: dense surfaces. Long [documents](/docs/documents),
[screenplay](/docs/documents/screenplay) writing, big
[grid](/docs/canvas/grids) layouts and the 3D graph are all usable and all
better on a large screen.

What is genuinely good on mobile is capture and review — getting photos in, and
looking at a board someone sent you.
