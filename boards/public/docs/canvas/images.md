# Images and photo editing

> Drag images onto a canvas and they upload and arrange themselves. Every image carries non-destructive adjustments — exposure, contrast, saturation and the rest — that never touch the original file. Click an image to open it full screen, and download it either as shot or with your adjustments baked in.

_Source: https://clusters.soleilpictures.com/docs/canvas/images · Updated 2026-08-08_

Images are the reason most boards exist. Getting them in is meant to be
thoughtless: drag a folder's worth onto the canvas and they upload in parallel
and lay themselves out rather than landing in a heap.

## Adding images

- **Drag from the desktop** — many at once is fine.
- **Paste** from the clipboard.
- **The image tool** in the rail, for a file picker.
- **[Soleil Scout](/docs/scout)** — text them from your phone.

Uploads go straight to storage from your browser. Large batches run a few at a
time so one enormous file cannot block the rest.

HEIC and HEIF from an iPhone are handled, including the awkward case where the
browser reports no MIME type at all.

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

Storage is counted against your account quota — Creator accounts get
100GB. The meter is in Settings → Plan & billing.

---

Building a reference wall specifically? The
[mood board maker](/tools/mood-board-maker) guide walks the whole workflow.
