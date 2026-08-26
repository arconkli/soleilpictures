# Files and uploads

> Drag any file onto a canvas and it becomes a card. Images, video, audio and PDFs get real players and viewers; everything else becomes a file card with a type icon and a download. Free accounts can upload standard media within size caps, and Creator adds any file type at all — .psd, .fig, .zip — with no size limit on a 100GB drive.

_Source: https://clusters.soleilpictures.com/docs/files · Updated 2026-08-08_

Drag a file onto the canvas. The type is detected and the right kind of card is
created — you never pick "upload as image" from a menu.

## What each type becomes

| You drop | You get |
|---|---|
| Image (incl. HEIC/HEIF) | An [image card](/docs/canvas/images) with adjustments |
| Video | An inline [player](/docs/files/video-and-audio) |
| Audio | A [waveform player](/docs/files/video-and-audio) with cover art |
| PDF | A [page-one thumbnail](/docs/files/pdf) opening into a full viewer |
| Anything else | A file card — type icon, name, size, download |

Small text files get an inline preview on the card rather than only a download.

## Limits

Two different things are limited, and they are limited for different reasons.

**File type.** Free accounts can upload standard media. Non-standard types —
`.psd`, `.fig`, `.zip`, project files, archives — require
Creator. This is the "upload anything" feature and it is the paid one.

**Size.** On the free plan:

| Type | Cap |
|---|---|
| Video | 30 MB |
| Audio | 50 MB |
| PDF | 50 MB |
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

Uploads count against your account's storage quota. Creator accounts
get 100GB. The meter is in **Settings → Plan & billing**.

Storage is counted against the **owner of the cluster**, not the person who
uploaded. If you are an editor on someone else's board, your uploads use their
quota — which is the same rule that governs the [card cap](/docs/canvas/cards).

## How files are stored

Files go directly from your browser into private object storage, and are served
back through signed URLs that expire. Nothing is in a public bucket and nothing
is reachable by guessing a path.

Files referenced by a board are protected from cleanup for as long as the board
references them. Removing the last card that uses a file makes it eligible for
deletion later, not immediately.

## Downloading

Every file card has a download. [Images](/docs/canvas/images) additionally offer
a version with adjustments applied. [PDFs](/docs/files/pdf) can be downloaded
from the viewer.
