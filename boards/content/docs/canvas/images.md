---
title: Images and Photo Editing — Soleil Clusters
metaDescription: Add images to a Soleil Clusters canvas and adjust them non-destructively — exposure, contrast and colour. Lightbox, downloads with edits baked in.
h1: Images and photo editing
navLabel: Images
section: canvas
order: 2
updated: 2026-10-02
answer: Drag images onto a canvas and they upload and arrange themselves. Every image carries non-destructive adjustments — exposure, contrast, saturation and the rest — that never touch the original file. Click an image to open it full screen, and download it either as shot or with your adjustments baked in.
faq:
  - q: Do adjustments change my original file?
    a: No. Adjustments are stored as settings on the card and applied at display time. The uploaded file is never modified, and resetting returns you to the original exactly.
  - q: Why does an image look blurry for a moment?
    a: Images load in tiers — a tiny blurred placeholder first, then a preview, then full resolution. On a board with hundreds of images this is what keeps it usable.
  - q: Does it handle photos straight off an iPhone?
    a: Yes, including HEIC and HEIF, even when the browser reports no file type at all.
related:
  - /docs/canvas/cards
  - /docs/files
  - /docs/canvas/palettes-and-color
---

Images are the reason most boards exist. Getting them in is meant to be
thoughtless: drag a whole folder onto the canvas and it becomes a cluster of its
own, or select the files you want and drop them where you are — either way they
upload in parallel and lay themselves out rather than landing in a heap. See
[dropping a folder](/docs/clusters#dropping-a-folder).

## Adding images

- **Drag from the desktop** — many at once is fine.
- **Drag from another tab** — an image dragged off a web page is kept as a
  copy in your workspace (see [below](#images-from-the-web)).
- **Paste** from the clipboard.
- **The image tool** in the rail, for a file picker.
- **[Soleil Scout](/docs/scout)** — text them from your phone.

Uploads go straight to storage from your browser. Large batches run a few at a
time so one enormous file cannot block the rest.

Each image keeps the name its file had — `diner_ext_dusk_04.jpg` stays that in
[Files](/docs/clusters/list-view) and comes back out of Download under it.
Give a card a caption and the caption is what Files shows; the download
still uses the file's own name. A pasted image has no real name (browsers call
every one `image.png`), so it is not given one.

HEIC and HEIF from an iPhone are handled, including the awkward case where the
browser reports no MIME type at all.

## Images from the web

Drag an image out of another tab and it shows up on the canvas straight away,
loaded from the page it came from. A moment later Clusters keeps its own copy in
your workspace and the card switches to it. A link to someone else's server
breaks when that page moves, expires its link or goes behind a login, and the
copy does not. It keeps the file's name when the address has one, like
`ext_dusk_04.jpg`.

The copy counts against storage like any upload. In a cluster someone else
owns, that is the owner's storage. Web images that went onto a board before
copies were kept get copied the same way. It happens a few at a time, whenever
someone who can edit that cluster opens it.

Sometimes no copy can be made: the image sits behind a login, is larger than
{{fact:webImageMaxSize}}, your storage is full, or it isn't a format every
browser can show (SVG and HEIC from the web stay as links). The card then keeps showing the image from
the page it came from, the way every web image did before.

## Progressive loading

An image appears in three stages: a tiny blurred placeholder that arrives
almost instantly, then a preview, then the full file. On a board with hundreds
of images this is the difference between usable and not.

Full resolution is fetched as you zoom in, and released again as you zoom out,
so a board stays responsive no matter how much is on it.

## Adjustments

Every image card has a full set of non-destructive adjustments — the kind you
would expect in a photo tool, applied live on the canvas.

Three ways in, depending on how much room you need:

- **Edit popover** — a compact panel beside the image with the essentials.
- **Full screen editor** — everything, with the image large.
- **Lightbox** — click an image to fill the screen; click again for 1:1 and drag to pan.

Adjustments are stored as settings on the card. The uploaded file is never
touched, so **Reset** returns you to the original exactly, and a collaborator
who downloads the image gets to choose whether your edits come with it.

> **Note:** Adjustments live on the card, not the file. Duplicate the card and
> you get an independent copy of the settings — useful for comparing two grades
> of the same still side by side.

## Downloading

From the lightbox or the card menu. You choose between the original file and a
version with your adjustments baked in.

## Auto-arranging a moodboard

Select a set of images and use **auto-arrange** to lay them out as a colour-ordered
masonry grid — images sorted so that neighbouring ones relate tonally rather
than by the order you happened to drop them. It is the fastest way to turn a
pile of references into something presentable.

For a fixed layout with defined cells instead, use a [grid](/docs/canvas/grids).

## Cropping and thumbnails

Cluster cover images use the same machinery: right-click a cluster →
**Upload custom thumbnail** to pick your own, with a 16:9 crop and reposition
step. **Reset to auto thumbnail** returns to the generated miniature of the
board itself.

## Limits

Images are not size-capped on any plan. The caps that exist are on
[video, audio and PDF](/docs/files) for free accounts.

Storage is counted against your account quota — {{fact:planName}} accounts get
{{fact:creatorStorage}}. The meter is in Settings → Plan & billing.

---

Building a reference wall specifically? The
[mood board maker](/tools/mood-board-maker) guide walks the whole workflow.
