---
title: Mobile and Tablet — Soleil Clusters
metaDescription: Soleil Clusters on phones and tablets — touch gestures, focus view, the mobile add sheet, and adding it to your home screen as a web app.
h1: Mobile and tablet
navLabel: Mobile and tablet
section: account
order: 4
updated: 2026-10-21
answer: Clusters works in a mobile browser and can be added to your home screen as a web app, where it opens without browser chrome. On touch devices the canvas gets pinch-zoom, long-press menus and hold-then-drag to select, Files open with a tap, a bottom navigation bar replaces the sidebar, and a focus view strips everything back to the board. Tablets with a stylus get pressure-sensitive drawing with palm rejection. There is no App Store or Play Store listing yet.
faq:
  - q: Is there a real app?
    a: Not in the app stores yet. Clusters runs in the mobile browser and can be added to your home screen from the browser's share or menu button, where it opens full-screen without browser chrome. Native iOS and Android builds are in development and will be announced in the changelog when they ship.
  - q: Can I draw on a tablet?
    a: Yes, with a stylus or a finger. A stylus gets pressure-sensitive strokes, and once one has been used on the device your finger switches to panning so a resting palm cannot draw. A "Draw with finger" toggle in the draw options puts that back if you want it.
  - q: Why did my finger stop drawing?
    a: Because a stylus was used on this device, so the finger became a pan gesture — that is how palm rejection works. Turn "Draw with finger" back on under Brush in the draw options.
  - q: How do I select several cards with a finger?
    a: Touch and hold empty canvas until the ring under your finger fills, then drag a box over them. Or hold, let go, and choose Select… — until you press Done, each tap adds a card or takes it out.
  - q: Is anything unavailable on mobile?
    a: Nothing that matters is removed, but dense surfaces like long documents are much better on a large screen. On a phone or a touch tablet, Home shows your projects on their own, without the 3D workspace graph behind them.
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
| Tap | Select a card; on empty canvas, clear the selection |
| Double tap | Add menu at that point |
| Touch and hold empty canvas, then drag | A selection box, as dragging one with a mouse draws |
| Touch and hold empty canvas, then let go | The board's menu, with **Select…** in it |
| Touch and hold a card | Pick it up to move it (on a cluster you can only view, its menu) |
| Touch and hold anything else | Its menu: a group label's, an arrow's, a tag's, the comments button's archive |
| **⋯** on the selection | The menu for every selected card |

While you hold empty canvas, a ring fills under your finger; once it is full,
the press is a hold, and moving draws the box instead of panning. The menu
opens when you let go, never under a box you were about to draw. A second
finger at any point hands it to the pinch: no box, no menu, and the selection
as it was.

**Select…** is for picking cards a box can't reach together: until you press
**Done** in the bar that says "Tap cards to select", each tap adds a card or
takes it out, and a hold-and-drag box adds to what is picked. **Done** keeps the
selection; a tap on empty canvas drops it.

With the draw tool active, one finger draws and two fingers still pinch-zoom.
Starting a pinch part-way through a stroke discards that stroke rather than
smearing it across the board as the canvas moves underneath — the failure that
makes drawing on touch unusable.

## Layout differences

**Bottom navigation** replaces the sidebar — Home, the current board, Messages,
and more.

**The top bar** keeps what you reach for on the board: the cluster's name,
Undo, Redo, who else is here, and Share.

**A drawer**, behind **Open menu**, holds the [sidebar](/docs/clusters/sidebar#on-a-phone)
— Home, Messages, the cluster tree and every cluster's Files — with Search,
Version history, Focus view and Help. ⤢ on its Files opens the full Files
page.
Tap a cluster to open it. Hold one to pick it up, then drag it onto another
cluster to nest it there; hold and let go without moving for its menu —
rename, colour, delete. A swipe that starts on a row just scrolls the list.

## Files with a finger

In [Files](/docs/clusters/list-view), both the full page and the sidebar's
Files card, a finger works the way the iPad's Files app does:

| Gesture | Does |
|---|---|
| Tap a file | Opens it in [Quick look](/docs/clusters/list-view#quick-look) |
| Tap a folder | Opens it |
| Touch and hold a file or a folder | Its menu, with **Select** first |
| **Select** | A check on every file: each tap adds one or takes it out |

While you are selecting, the selection bar acts on what is checked —
put it on the board, move it, copy it to another cluster, delete it — and
**Done** ends it. A hold opens the menu, so on a touch screen a file isn't
dragged out of Files; putting it on the board or moving it from the bar or the
menu does that instead.

**Back** — the phone's gesture or button — closes whatever is open on top, the
drawer, a sheet or Settings, instead of leaving the app.

**The add sheet**, behind the **+** in the middle of the bottom bar, lays out
everything you can add across the screen, sized for thumbs. The tool rail keeps
its own `+`, whose menu opens beside the rail.

**Focus view** — touch only — strips everything back to the board itself, for
reviewing on a phone without chrome in the way. Open it from the drawer, or from
the top bar on a tablet held in landscape.

## Tablets

Held upright, a tablet gets the phone's layout: the bottom bar, the drawer and
the add sheet. On its side, most iPads are wide enough for the desktop layout,
with a finger for a pointer. Either way it adds stylus drawing. On iPad,
drawing, annotating and reviewing all work properly; long document editing is
still better on a laptop.

**Drawing** is on the rail directly on touch, and in the add sheet, rather than
behind the `D` shortcut there is no keyboard for. A stylus draws with pressure;
flipping it over erases. The full-screen [sketch pad](/docs/canvas/shapes-and-drawing#the-sketch-pad)
goes edge to edge, with pinch-to-zoom inside the frame for detail work. Its
chrome is two rows that never scroll — leaving and committing on one, the tools
and **Layers** on the other — with the brushes, colours and sizes a tap behind
the chip showing what you are drawing with, and the frame formats offered on the
bar itself while the frame is still empty.

On a phone or a touch tablet, [Home](/docs/clusters/home-graph) is your clusters
on their own: the ones you were last in, every cluster at the top of your
workspace, and **New cluster**.
The 3D workspace graph is left for larger screens, and is never loaded here.

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
