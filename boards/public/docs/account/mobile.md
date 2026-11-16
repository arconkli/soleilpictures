# Mobile and tablet

> Clusters works in a mobile browser and can be added to your home screen as a web app, where it opens without browser chrome. On touch devices the canvas gets pinch-zoom, long-press menus and hold-then-drag to select, Files open with a tap, a bottom navigation bar replaces the sidebar, and a focus view strips everything back to the board. Tablets with a stylus get pressure-sensitive drawing with palm rejection. There is no App Store or Play Store listing yet.

_Source: https://clusters.soleilpictures.com/docs/account/mobile · Updated 2026-11-15_

Two ways to run it on a phone or tablet: the mobile browser, or the same app
added to your home screen. They are the same app.

## Touch on the canvas

| Gesture | Does |
|---|---|
| One finger drag | Pan |
| Two finger drag | Pan |
| Pinch | Zoom, keeping the spot between your fingers under them |
| Tap | Select a card; on empty canvas, clear the selection |
| Tap a selected note | Type where you tapped, with the keyboard up |
| Double tap | On empty canvas, the add menu at that point; on a note, type where you tapped |
| Tap outside the note you are typing in | Finish; the keyboard goes down |
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

A pinch follows your hand, so you can zoom and move the board in one motion.
Lift one finger and the other keeps panning. Past the closest or farthest zoom
the board gives a little, and settles back when you let go. Every finger in a
pinch belongs to the zoom: a card under one is not picked up or selected, and
lifting your fingers opens nothing.

**Select…** is for picking cards a box can't reach together: until you press
**Done** in the bar that says "Tap cards to select", each tap adds a card or
takes it out, and a hold-and-drag box adds to what is picked. **Done** keeps the
selection; a tap on empty canvas drops it.

While you type in a note, the board glides to keep your line above the keyboard
and the note's toolbar, and the page doesn't zoom in on an iPhone or iPad. The
keyboard's autocorrect, automatic capitals and spellcheck work in notes, as in
any text field.

With the draw tool active, one finger draws and two fingers still pinch-zoom.
Starting a pinch part-way through a stroke discards that stroke rather than
smearing it across the board as the canvas moves underneath — the failure that
makes drawing on touch unusable.

## Menus under a finger

On a phone, a row with a **›** (**Arrange**, **Edit**, **Background**,
**Export**, **Tidy up**, **Move to cluster**) steps into the menu itself instead
of opening beside it. The back row at its top goes back a level, and a list
inside a list works the same way, one level at a time. A menu taller than the
screen stops above the bottom bar and scrolls.

On an iPad held sideways, a tap on a row with a **›** opens its list beside the
menu and leaves it open. A list's own list, such as a group's **Outline shape**,
opens beside it.

On a touch screen, **Delete** is on the first screen of a card's menu. Selected
drawings and arrows have **Delete** in the board's menu, and a toast offers
**Undo**. A photo's menu has **View full size**. A hold on the title of a link,
palette or picture card lifts it or opens its menu, like the rest of the card.

In a document, a hold on a page in the page list opens its menu: rename, new
sub-page, delete.

## Turning and resizing a card

On a phone or an iPad, the one selected card shows two handles: a finger-sized
dot on a short stalk above it turns the card, and a round grip on its corner
resizes it. They keep their size whatever the zoom, and turn with the card. On a
card that is very small on screen the turn dot gives way; zoom in to turn it.
Several selected cards share one grip.

## Haptic feedback

On a phone, Clusters gives a light tap at the moments where your finger needs
confirming:

- a hold picks up a card, or a cluster in the sidebar
- a card you drag reaches a cluster, and you drop it in (or into a grid cell)
- a snap guide catching
- zoom passing 100% or reaching its limit
- an arrow attaching to a card
- ticking a checklist item
- a hold opening a menu
- choosing **Delete**, or another red option, in a menu
- the card-limit notice

On Android you feel all of them, in Chrome and most other browsers. In Safari
on iPhone a website can only make the phone tap when you tap, so there you feel
it on red menu options such as **Delete** and on checklist ticks, and not at
the other moments. iPads have no vibration motor, so there is nothing to feel
there, and it never happens with a mouse or trackpad.

Switch it off for a device with **Vibration** in **Settings → Appearance**, under Canvas. The
switch is kept on that device, not on your account.

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
drawer, a sheet or Settings, instead of leaving the app. Once nothing is open
on top, Back returns to the cluster you were on before.

**The add sheet**, behind the **+** in the middle of the bottom bar, lays out
everything you can add across the screen, sized for thumbs. The tool rail keeps
its own `+`, whose menu opens beside the rail. A new card lands in free space
where you are looking, and a new note or document zooms in so you can read and
type in it.

**Comments** — on a phone or an upright iPad, **Add comment** opens a bar above
the keyboard with **Cancel** and **Post**, and the keyboard's return key sends.

Controls a mouse only sees on hover always show under a finger: a vote's delete,
a backlink's pin, a schedule item's remove.

**Focus view** — touch only — strips everything back to the board itself, for
reviewing on a phone without chrome in the way. Open it from the drawer, or from
the top bar on a tablet held in landscape.

## Tablets

Held upright, a tablet gets the phone's layout: the bottom bar, the drawer and
the add sheet. On its side, most iPads are wide enough for the desktop layout,
with a finger for a pointer. Either way it adds stylus drawing. On iPad,
drawing, annotating and reviewing all work properly; long document editing is
still better on a laptop.

On an upright iPad, Settings, Share, Search and Notifications open as windows in
the middle of the screen instead of across it. A tap outside one closes it.

On the 10.2-inch iPad held sideways, Files start folded under the clusters to
give the board room. Tap **Show** to open them; your choice is kept.

Turning an iPad keeps the board where it was.

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

Going the other way, a photo's **Download** on an iPhone or iPad opens the share
sheet, where **Save Image** puts it in Photos. See [Images](/docs/canvas/images).

## What is worse on a small screen

Honestly: dense surfaces. Long [documents](/docs/documents),
[screenplay](/docs/documents/screenplay) writing, big
[grid](/docs/canvas/grids) layouts and the 3D graph are all usable and all
better on a large screen.

What is genuinely good on mobile is capture and review — getting photos in, and
looking at a board someone sent you.
