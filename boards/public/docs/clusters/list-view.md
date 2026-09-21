# List view

> Every cluster has a list view as well as a canvas — the same contents as a sortable, searchable file browser. It has table and gallery modes, sorting by name, type, size or date, filters by content type, and a detail panel with a large preview and metadata. Nothing is converted; it is one set of contents with two ways to look at it.

_Source: https://clusters.soleilpictures.com/docs/clusters/list-view · Updated 2026-09-21_

The canvas is for arranging. List view is for finding.

Same cluster, same contents, different question being asked. Switch with the
view control in the cluster header.

## Table and gallery

**Table** — a row per item, with type, size and dates. Dense, scannable, sortable.

**Gallery** — a tile per item with a real preview. Better when you are looking
for something you would recognise by sight; for audio the preview is the
waveform, so no two loops look the same.

## When a cluster is mostly audio

The table swaps its columns. **Type** and **Size** give way to **Time**,
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

Above the table you get the pack in one line: **how many audio files, the tempo
range they span, and how much material there is in total**. It follows the
search and the filters, so narrowing to `128` re-reads the selection you are
actually looking at.

On a narrow window, in a split pane, or with the detail panel open, columns
drop in order of how much they matter — the waveform first, then Format and the
date — and on a phone the remaining values fold onto a second line under the
filename. The name is the last thing to give up room.

## Sorting and filtering

Sort by **name**, **type**, **size**, **date modified** or **date added** — plus
**length**, **tempo**, **key** and **format** when the cluster is mostly audio.

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

In **gallery** mode a loop's tile *is* its waveform, so a pack reads as a wall
of shapes rather than a wall of identical icons.

For going through a lot of them, use the keyboard: `↑` and `↓` move a highlight
down the rows, `Space` plays whatever is highlighted, `Enter` selects it. **When
a clip finishes, the next audio row starts on its own** and the highlight
follows — so a pack of loops plays through while you keep your hands still. It
stops at the end rather than wrapping.

Only one thing plays at a time, everywhere: starting a row stops a clip playing
on the canvas, and vice versa. Sorting by tempo or key and then holding `↓` is
the fastest way through a folder of samples.

## Downloading

Hover any row holding a file — an image, PDF, video, audio clip or attachment —
and a download button appears at the end of it. The file keeps its **original
name**, so renaming a card for readability never costs you the extension.

**Download all** sits above the table whenever there is more than one file to
take. It follows the search and the filters, so it reads *Download 14* once you
have narrowed to fourteen. Select particular rows instead and the selection bar
offers **Download** for just those.

Either way you get a single zip named after the cluster. Zips are capped at
**500 files** or **500 MB**, whichever comes
first; past either, take it in batches. In the phone and tablet apps files come
down one at a time, through the system share sheet.

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
something in list view puts you in front of it in context. It and **Copy link**
are app actions, so they are not offered to a signed-out visitor on a shared
link — there is no canvas for them to open, and the deep link would not resolve.

For an audio clip the panel also reports its **length, tempo, key and format**,
which is most of the reason to open it at all.

## Adding files here

Drag files into list view, or use **Add files** in the toolbar. They land on the
cluster exactly as if dropped on the canvas, auto-placed in free space.

## Presence

List view shows who else is in the cluster, and what they have selected — the
same [presence](/docs/collaborate/presence) information the canvas shows, so
switching views does not mean losing sight of your collaborators.

## Every cluster is a drive

This is the framing worth internalising. A cluster is not "a canvas that also
has a list" — it is a set of contents that can be arranged spatially or browsed
like a folder. Teams that come from a shared-drive workflow can use Clusters
that way from day one and discover the canvas later.

That discovery is nudged exactly once, the first time a cluster gets full enough
for it to matter.

---

Coming from a reference tool that only does one of these? See
[how Clusters compares](/docs/migrating).
