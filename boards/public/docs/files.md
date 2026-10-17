# Files and uploads

> Drag any file onto a canvas and it becomes a card. Images, video, audio and PDFs get real players and viewers; everything else — a .psd, a .fig, a .zip — becomes a file card with a type icon and a download, on every plan. Free accounts upload any file within size caps, and Creator lifts the size limits on a 100GB drive.

_Source: https://clusters.soleilpictures.com/docs/files · Updated 2026-10-12_

Drag a file onto the canvas. The type is detected and the right kind of card is
created — you never pick "upload as image" from a menu.

## What each type becomes

| You drop | You get |
|---|---|
| Image (incl. HEIC/HEIF) | An [image card](/docs/canvas/images) with adjustments |
| Video | An inline [player](/docs/files/video-and-audio) |
| Audio | A [waveform player](/docs/files/video-and-audio) with cover art |
| PDF | A [page-one thumbnail](/docs/files/pdf) opening into a full viewer |
| Screenplay (`.fountain`, `.fdx`) | A new [script document](/docs/documents/screenplay), title page included — free on every plan |
| PureRef scene (`.pur`) | Nothing yet — Clusters cannot open PureRef boards. Export the images from PureRef and drop those |
| An unfinished download (`.crdownload`, `.part`) | Skipped, with a note to drop it again once it has finished |
| Anything else | A file card — type icon, name, size, download |

Small text files get an inline preview on the card rather than only a download.

## Limits

Two different things are limited, and they are limited for different reasons.

**File type.** Any, on every plan. `.psd`, `.fig`, `.zip`, project files,
archives — each lands as a file card with a download. On the free plan one of
those is capped at 50 MB, the same ceiling as a PDF.

**Size.** On the free plan:

| Type | Cap |
|---|---|
| Video | 30 MB |
| Audio | 50 MB |
| PDF | 50 MB |
| Any other file | 50 MB |
| Images | No cap on any plan |

Creator removes the size caps entirely.

> **Note:** These are the real, enforced differences between free and paid —
> along with the [card cap](/docs/canvas/cards). Clusters, collaborators and
> editing are not limited on any plan.

## Large uploads

Files beyond roughly a gigabyte upload in parts automatically, so a big video or
a project archive is not one fragile request. If an upload is interrupted it can
resume rather than starting over.

Batches upload a few at a time so one huge file does not block eleven small ones
behind it.

## Storage

Uploads count against your account's storage quota: 5GB on the
free plan, 100GB on Creator. The meter is in
**Settings → Plan & billing**. When it is full, new uploads stop until you
delete files or upgrade — nothing already there is touched.

Storage is counted against the **owner of the cluster**, not the person who
uploaded. If you are an editor on someone else's board, your uploads use their
quota — which is the same rule that governs the [card cap](/docs/canvas/cards).

### What counts

- **A file counts while a cluster uses it.** Delete its card and the file stops
  counting within a few minutes — unless another cluster still uses the same
  file, as a [linked copy](/docs/clusters/list-view) does.
- **Clusters in the trash still count** until the trash is emptied. Emptying
  it frees their space at once.
- **A deleted [version](#versions) counts** until it leaves Recently deleted.
- **A file that is uploaded but not placed yet counts**, however long ago it
  was uploaded — a file sent through the [API](/docs/api) that no card uses
  yet, for example.
- **Previews and thumbnails never count.** They are copies Clusters makes for
  itself, not your files.

## How files are stored

Files go directly from your browser into private object storage, and are served
back through signed URLs that expire. Nothing is in a public bucket and nothing
is reachable by guessing a path.

Files referenced by a board are protected from cleanup for as long as the board
references them. Removing the last card that uses a file stops it counting
toward your storage within a few minutes; the file itself becomes eligible for
deletion later, not immediately, so undo and version history can still bring it
back.

## Versions

A file can have versions. Drop a new file onto a file of the same kind — on
the board or in [Files](/docs/clusters/list-view) — and it becomes that file's
next version: the card shows the new one, and the old one is kept. The card
lights up and says **Drop to add as v2** before you let go. A toast confirms it
with **Undo**, and with **Keep as separate file** for when you meant it as a
file of its own. Hold `⌥` while you drop to skip all of that and add it as a
separate file straight away.

**Upload new version…** in the right-click menu does the same with a file
picker — for images it's under **Edit**. Images, videos, audio, PDFs and other
files all take versions; the new one has to be the same kind as the old.

Once a file has more than one, a small **v2** chip on the card (and beside its
name in Files) says which version is on show; it opens
[Info](/docs/canvas/cards#info), whose **Versions** section lists every
version, newest first, with who uploaded it, when, and its size. From each
version's menu:

| Action | What it does |
|---|---|
| **Make current** | Shows that version on the card again, everywhere the card appears |
| **Download** | That version's original file |
| **Add a label…** | A name for it — "Picture lock", "Director's cut" |
| **Delete version** | Removes it, with undo |

A deleted version waits under **Recently deleted** for
30 days, where **Restore** brings it back; after that
it's gone. A file keeps up to 50 versions, and the one on
show can't be deleted while it's the only one left — deleting the card is how
you delete the file. Every change is one step of `⌘Z`.

Every version is a stored file, so every version counts toward your
[storage](#storage). Copying or moving a card brings its versions with it.

## Downloading

Every file card has a download. [Images](/docs/canvas/images) additionally offer
a version with adjustments applied. [PDFs](/docs/files/pdf) can be downloaded
from the viewer.
