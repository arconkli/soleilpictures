# Mobile and tablet

> Clusters works in a mobile browser and can be added to your home screen as a web app, where it opens without browser chrome. On touch devices the canvas gets pinch-zoom and long-press menus, a bottom navigation bar replaces the sidebar, and a focus view strips everything back to the board. Tablets with a stylus get pressure-sensitive drawing with palm rejection. There is no App Store or Play Store listing yet.

_Source: https://clusters.soleilpictures.com/docs/account/mobile · Updated 2026-10-20_

Two ways to run it on a phone or tablet: the mobile browser, or the same app
added to your home screen. They are the same app.

## Touch on the canvas

| Gesture | Does |
|---|---|
| One finger drag | Pan |
| Pinch | Zoom |
| Tap | Select a card; on empty canvas, clear the selection |
| Double tap | Add menu at that point |
| Touch and hold a card | Pick it up to move it (on a cluster you can only view, its menu) |
| Touch and hold anything else | Its menu: the board's, or a group label's, an arrow's, a tag's, the comments button's archive |
| **⋯** on the selection | The menu for every selected card |

With the draw tool active, one finger draws and two fingers still pinch-zoom.
Starting a pinch part-way through a stroke discards that stroke rather than
smearing it across the board as the canvas moves underneath — the failure that
makes drawing on touch unusable.

## Layout differences

**Bottom navigation** replaces the sidebar — Home, the current board, Messages,
and more.

**The top bar** keeps what you reach for on the board: the cluster's name,
the Board/Files switch, Undo, Redo, who else is here, and Share.

**A drawer** holds navigation that does not fit, including the cluster tree,
Search, Version history, Focus view and Help.
Tap a cluster to open it. Hold one to pick it up, then drag it onto another
cluster to nest it there; hold and let go without moving for its menu —
rename, colour, delete. A swipe that starts on a row just scrolls the list.

**Back** — the phone's gesture or button — closes whatever is open on top, the
drawer, a sheet or Settings, instead of leaving the app.

**The add sheet** replaces the tool rail's `+` menu with a full-width sheet,
sized for thumbs.

**Focus view** — touch only — strips everything back to the board itself, for
reviewing on a phone without chrome in the way. Open it from the drawer, or from
the top bar on a tablet held in landscape.

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
