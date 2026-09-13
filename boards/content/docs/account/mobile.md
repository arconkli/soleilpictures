---
title: Mobile and Tablet — Soleil Clusters
metaDescription: Soleil Clusters on phones and tablets — touch gestures, focus view, the mobile add sheet, and adding it to your home screen as a web app.
h1: Mobile and tablet
navLabel: Mobile and tablet
section: account
order: 4
updated: 2026-09-13
answer: Clusters works in a mobile browser and can be added to your home screen as a web app, where it opens without browser chrome. On touch devices the canvas gets pinch-zoom and long-press menus, a bottom navigation bar replaces the sidebar, and a focus view strips everything back to the board. Tablets with a stylus get pressure-sensitive drawing with palm rejection. There is no App Store or Play Store listing yet.
faq:
  - q: Is there a real app?
    a: Not in the app stores yet. Clusters runs in the mobile browser and can be added to your home screen from the browser's share or menu button, where it opens full-screen without browser chrome. Native iOS and Android builds are in development and will be announced in the changelog when they ship.
  - q: Can I draw on a tablet?
    a: Yes, with a stylus or a finger. A stylus gets pressure-sensitive strokes, and once one has been used on the device your finger switches to panning so a resting palm cannot draw. A "Draw with finger" toggle in the draw options puts that back if you want it.
  - q: Why did my finger stop drawing?
    a: Because a stylus was used on this device, so the finger became a pan gesture — that is how palm rejection works. Turn "Draw with finger" back on under Brush in the draw options.
  - q: Is anything unavailable on mobile?
    a: Nothing is removed, but dense surfaces like long documents and the 3D home graph are much better on a large screen. The graph falls back to 2D on tablets.
related:
  - /docs/canvas
  - /docs/scout
  - /docs/account/settings
---

Two ways to run it on a phone or tablet: the mobile browser, or the same app
added to your home screen. They are the same app.

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
goes edge to edge, with pinch-to-zoom inside the frame for detail work. Its
chrome is two rows that never scroll — leaving and committing on one, the tools
and **Layers** on the other — with the brushes, colours and sizes a tap behind
the chip showing what you are drawing with, and the frame formats offered on the
bar itself while the frame is still empty.

The [Home graph](/docs/clusters/home-graph) renders its 2D fallback on most
tablets, which has the same nodes and interactions.

## Installing

**Add to Home Screen** from the browser's share or menu button. It runs
standalone, without browser chrome, and keeps its own sign-in — so sign in once
from the home-screen icon itself.

## Getting photos in from a phone

Two routes today:

1. **Upload** from the add sheet — the camera roll picker, which takes several
   photos at once.
2. **[Soleil Scout](/docs/scout)** — text them, with no app at all. Note that Scout's phone line is not live yet.

Saving into a cluster from another app's share sheet is not available yet.

## What is worse on a small screen

Honestly: dense surfaces. Long [documents](/docs/documents),
[screenplay](/docs/documents/screenplay) writing, big
[grid](/docs/canvas/grids) layouts and the 3D graph are all usable and all
better on a large screen.

What is genuinely good on mobile is capture and review — getting photos in, and
looking at a board someone sent you.
