---
title: Files View — Soleil Clusters
metaDescription: Every cluster in Soleil Clusters is also a drive. Files shows it as a grid or a list, with search, sort, type filters and a detail panel with previews.
h1: Files view
navLabel: Files view
section: clusters
order: 1
updated: 2026-10-08
answer: Every cluster has a board and its files. Press F, or Files at the top of the screen, and Files opens beside the board — a grid of previews or a list, with search, sorting and type filters — and expands to fill the screen when you want only files. Nothing is converted; it is one set of contents with two ways to look at it.
faq:
  - q: Does opening Files change my board?
    a: No. It is a different view of the same contents. Positions on the canvas are untouched, and opening Files beside the board never changes how anyone else sees the cluster.
  - q: Can I see my files and my board at the same time?
    a: Yes. Files opens as a panel beside the board. Drag its edge to make it wider, or press the expand button to fill the screen with it.
  - q: Can I upload from Files?
    a: Yes. Drag files into it, or use Add files in the toolbar. They land on the cluster exactly as if you had dropped them on the canvas.
  - q: Can I make Files the default?
    a: Yes, in Settings under Defaults. A cluster also remembers the view it was last left in, and a dropped folder opens in Files.
  - q: Can I use Clusters like Google Drive?
    a: For the files a project is working from, largely yes. You can browse, sort, filter, preview and download them, nest folders as clusters, and share a whole cluster with one link. It is not a backup or sync service — no desktop sync, no offline copy, no link to a single file — so keep a drive for that.
related:
  - /docs/clusters
  - /docs/canvas
  - /docs/organize/search
---

The board is for arranging. Files is for finding.

Same cluster, same contents, different question being asked — and you can ask
both at once.

## Files beside the board

Press `F`, or **Files** in **Board · Files** at the top of the screen, and Files
opens as a panel on the right of the board. The board stays where it was and
keeps working: you can pan, select and arrange while the panel is open. The
Files side of the switch counts the cards inside, not counting nested clusters.

| To do this | Do this |
|---|---|
| Open or close Files beside the board | `F`, or **Files** / **Board** at the top |
| Make the panel wider or narrower | Drag its left edge; double-click the edge to reset it |
| Fill the screen with Files | The expand button in the panel, or drag the edge most of the way across |
| Put full-screen Files back beside the board | **Beside board** in its toolbar |
| Find a file on the board | Double-click it in the panel — the board flies to it |

`⌘K` → "Show Files" does the same as `F`. Whether the panel is open, and how
wide, is remembered on your device; it never changes the cluster for anyone
else. Full-screen Files is the cluster's own view, so a cluster you leave in
Files opens in Files for everyone, and on shared and published links.

The panel needs room: in a narrow window, and on phones and tablets, Files
fills the screen instead. In split view, the switch and `F` act on the pane you
last worked in, and Files there fills that pane.

A cluster remembers which view it was left in. Clusters made from a folder you
[drop in](/docs/clusters#dropping-a-folder) open in Files for you, because a
dropped folder is files first; their cards are still laid out on each canvas,
and on the parent board they keep their thumbnail.

## Grid and list

**Grid** — a tile per item with a real preview. The default, because most of
what you are looking for you would recognise by sight; for audio the preview is
the waveform, so no two loops look the same.

**List** — a row per item, with type, size and dates. Dense, scannable,
sortable. A cluster that is mostly audio opens in the list, for the columns
below.

Your choice is remembered per cluster on the device you made it on.

## When a cluster is mostly audio

The list swaps its columns. **Type** and **Size** give way to **Time**,
**BPM**, **Key** and **Format**, and each one sorts — so a folder of samples
becomes something you can order by tempo or by key.

It switches on its own once half of what you are looking at is audio, which is
also true the moment you filter to Audio. Nothing to turn on, and a cluster of
notes and images never grows four empty columns.

**Key sorts by the circle of fifths, not the alphabet.** Sorting a pack by key
is really asking what stacks with what, so C, G, D, A and E land next to each
other rather than A, B, C.

Tempo and key come from the filename as the file uploads, and are editable on
the card — see [video and audio](/docs/files/video-and-audio).

Above the list you get the pack in one line: **how many audio files, the tempo
range they span, and how much material there is in total**. It follows the
search and the filters, so narrowing to `128` re-reads the selection you are
actually looking at.

On a narrow window, in a split pane, or with the detail panel open, columns
drop in order of how much they matter — the waveform first, then Format and the
date — and on a phone the remaining values fold onto a second line under the
filename. The name is the last thing to give up room.

## Sorting and filtering

Files opens in **board order**: the canvas read like a page, top row first and
each row left to right, so what you see is the board you just left, lined up.
Sort by **name**, **type**, **size**, **date modified** or **date added**
instead — plus **length**, **tempo**, **key** and **format** when the cluster is
mostly audio.

Filter to a single content type: Images, PDFs, Video, Audio, Files, Notes,
Links, Docs, Palettes, Other.

**Search** filters as you type, against names and content.

The combination is the answer to "where is that PDF someone dropped in here last
week" — filter to PDFs, sort by date added, done. On the canvas that is a
hunting expedition.

## Auditioning audio

An audio row's thumbnail is a play button. Press it and the clip plays in
place. The waveform beside it is drawn from the file itself, and it **fills as
the clip plays**. While it is playing, click anywhere along that waveform to
jump there — the fastest way to the part of a long sample you actually want. A
line fills along the bottom of the row as well, for when the waveform has no
room.

In the **grid** a loop's tile *is* its waveform, so a pack reads as a wall
of shapes rather than a wall of identical icons.

For going through a lot of them, use the keyboard in the **list** layout: `↑`
and `↓` move a highlight down the rows, `Space` plays whatever is highlighted, `Enter` selects it. **When
a clip finishes, the next audio row starts on its own** and the highlight
follows — so a pack of loops plays through while you keep your hands still. It
stops at the end rather than wrapping.

Only one thing plays at a time, everywhere: starting a row stops a clip playing
on the canvas, and vice versa. Sorting by tempo or key and then holding `↓` is
the fastest way through a folder of samples.

## Downloading

Hover any row holding a file — an image, PDF, video, audio clip or attachment —
and a download button appears at the end of it. Files come down under their
**original names**, so renaming a card for readability never costs you the
extension. Images and videos uploaded before they started keeping names come
down under the card's title, or a generic name if it has none. A name a browser invents for a pasted image — `image.png` — is
not kept.

**Download all** sits above the files whenever there is more than one file to
take. It follows the search and the filters, so it reads *Download 14* once you
have narrowed to fourteen. Select particular rows instead and the selection bar
offers **Download** for just those.

Either way you get a single zip named after the cluster. Zips are capped at
**{{fact:zipMaxFiles}} files** or **{{fact:zipMaxSize}}**, whichever comes
first; past either, take it in batches.

Anything in the selection with no file behind it — a note, a link — is skipped,
and the count of what was skipped is reported rather than quietly dropped. The
same is true of a file storage cannot hand back: the archive still contains
everything that could be read, and says how many could not.

## Previews

Everything gets a real preview, not a generic icon. Images and video show
themselves; [grids](/docs/canvas/grids), [docs](/docs/documents),
[schedules](/docs/canvas/schedule), shapes, notes and links get schematic marks
that indicate their shape and content.

## The detail panel

Select an item for a large preview plus its metadata — type, size, dimensions,
dates, and where it lives. From there:

| Action | What it does |
|---|---|
| **Open on canvas** | Jumps to the card, selected, on the canvas |
| **Download** | The original file |
| **Copy link** | A deep link that opens the board with the card selected |
| **Delete** | Removes it, with undo |

**Open on canvas** is the important one: it connects the two views, so finding
something in Files puts you in front of it in context. It and **Copy link**
are app actions, so they are not offered to a signed-out visitor on a shared
link — there is no canvas for them to open, and the deep link would not resolve.

For an audio clip the panel also reports its **length, tempo, key and format**,
which is most of the reason to open it at all.

## Adding files here

Drag files into Files, or use **Add files** in the toolbar. They land on the
cluster exactly as if dropped on the canvas, auto-placed in free space.

## Presence

Files shows who else is in the cluster, and what they have selected — the
same [presence](/docs/collaborate/presence) information the canvas shows, so
switching views does not mean losing sight of your collaborators.

## Every cluster is a drive

This is the framing worth internalising. A cluster is not "a canvas that also
has a list" — it is a set of contents that can be arranged spatially or browsed
like a folder. Teams that come from a shared-drive workflow can use Clusters
that way from day one and discover the canvas later.

That discovery is nudged exactly once, the first time a cluster gets full enough
for it to matter.

## Can I use Clusters like Google Drive?

For the files a project is working from, largely yes — and the difference is
that the same files are also a canvas your team arranges and argues over. For
what a drive is really for, no. Here is the line:

| Like a drive | In Clusters |
|---|---|
| Browse a folder's contents | Yes — the Files view, as a grid or a list |
| Sort and filter | Yes — by name, type, size and dates, filtered to one kind of content |
| Search | Yes — [⌘K](/docs/organize/search) finds files by name, card text and the words inside documents. It does not read text inside images or PDFs |
| Preview without opening | Yes — every item has a real preview, and the detail panel a large one |
| Download | Yes — one file, or a selection as a zip of up to {{fact:zipMaxFiles}} files or {{fact:zipMaxSize}} |
| Folders inside folders | Yes — nested clusters, as deep as you like |
| Upload a whole folder | Yes — [drop it on a canvas](/docs/clusters#dropping-a-folder) and its folders become nested clusters |
| Share | A whole cluster, yes: one link opens it read-only, and everyone you invite edits free |
| Store any kind of file | Yes, on every plan. The free plan caps each file at {{fact:freeFileCap}} (standard media at its own [size caps](/docs/account/plans)), and every file is one of its {{fact:demoCardLimit}} cards; {{fact:planName}} lifts the size caps on a {{fact:creatorStorage}} drive |
| Keep each file's original name | Yes — images and videos since names were kept; audio, PDFs and attachments always |
| Share one file by its own link | No — sharing is per cluster. **Copy link** opens a card on its board, for people who can already open that board |
| Sync a folder on your computer | No — there is no desktop sync app |
| Work offline | No |
| Back up your files | No — a cluster is where work happens, not a backup of it |

So use a cluster the way a team uses a project folder: the references, files
and documents a production is working from, organised where everyone on it can
see them. Keep Google Drive, Dropbox or your own server for what a drive does
best — backup, sync to your computer and offline copies.

---

Coming from a reference tool that only does one of these? See
[how Clusters compares](/docs/migrating).
