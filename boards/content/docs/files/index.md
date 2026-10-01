---
title: Files and Uploads — Soleil Clusters
metaDescription: Upload any file type to Soleil Clusters. What is supported free, where the size caps are, how large uploads work, and where storage is counted.
h1: Files and uploads
navLabel: Overview
section: files
order: 0
updated: 2026-10-01
answer: Drag any file onto a canvas and it becomes a card. Images, video, audio and PDFs get real players and viewers; everything else becomes a file card with a type icon and a download. Free accounts can upload standard media within size caps, and Creator adds any file type at all — .psd, .fig, .zip — with no size limit on a {{fact:creatorStorage}} drive.
faq:
  - q: What file types can I upload on the free plan?
    a: Standard media — images, video, audio and PDFs — within the size caps listed below. Images have no size cap on any plan. Non-standard types like .psd, .fig and .zip require Creator.
  - q: How large a file can I upload?
    a: On Creator there is no per-file limit; very large files upload in parts automatically. On the free plan video is capped at {{fact:freeVideoCap}}, audio at {{fact:freeAudioCap}} and PDF at {{fact:freePdfCap}}.
  - q: Where do my files actually live?
    a: In private object storage. Files are served through signed URLs that expire, so a file cannot be reached by guessing a URL.
  - q: Can I bring in my PureRef boards?
    a: Not as .pur files yet — Clusters cannot open a PureRef scene, on any plan. Export the images from PureRef and drop those onto a canvas; they become image cards, which have no size cap on any plan.
  - q: What happens if I drop a screenplay file?
    a: A .fountain or .fdx file becomes a new script document, formatted and ready to edit, with its title page filled in. That is free on every plan.
related:
  - /docs/files/pdf
  - /docs/files/video-and-audio
  - /docs/account/plans
---

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

**File type.** Free accounts can upload standard media. Non-standard types —
`.psd`, `.fig`, `.zip`, project files, archives — require
{{fact:planName}}. This is the "upload anything" feature and it is the paid one.

**Size.** On the free plan:

| Type | Cap |
|---|---|
| Video | {{fact:freeVideoCap}} |
| Audio | {{fact:freeAudioCap}} |
| PDF | {{fact:freePdfCap}} |
| Images | No cap on any plan |

{{fact:planName}} removes the size caps entirely.

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

Uploads count against your account's storage quota. {{fact:planName}} accounts
get {{fact:creatorStorage}}. The meter is in **Settings → Plan & billing**.

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
