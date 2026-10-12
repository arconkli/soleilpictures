---
title: Files and Uploads — Soleil Clusters
metaDescription: Upload any file type to Soleil Clusters. What is supported free, where the size caps are, how large uploads work, and where storage is counted.
h1: Files and uploads
navLabel: Overview
section: files
order: 0
updated: 2026-10-12
answer: Drag any file onto a canvas and it becomes a card. Images, video, audio and PDFs get real players and viewers; everything else — a .psd, a .fig, a .zip — becomes a file card with a type icon and a download, on every plan. Free accounts upload any file within size caps, and Creator lifts the size limits on a {{fact:creatorStorage}} drive.
faq:
  - q: What file types can I upload on the free plan?
    a: Any. Images have no size cap on any plan; video, audio and PDFs have the size caps listed below; every other type — .psd, .fig, .zip, project files, archives — is a file card up to {{fact:freeFileCap}}.
  - q: How large a file can I upload?
    a: On Creator there is no per-file limit; very large files upload in parts automatically. On the free plan video is capped at {{fact:freeVideoCap}}, audio at {{fact:freeAudioCap}}, and a PDF or any other file at {{fact:freeFileCap}}.
  - q: Where do my files actually live?
    a: In private object storage. Files are served through signed URLs that expire, so a file cannot be reached by guessing a URL.
  - q: Can I bring in my PureRef boards?
    a: Not as .pur files yet — Clusters cannot open a PureRef scene, on any plan. Export the images from PureRef and drop those onto a canvas; they become image cards, which have no size cap on any plan.
  - q: What happens if I drop a screenplay file?
    a: A .fountain or .fdx file becomes a new script document, formatted and ready to edit, with its title page filled in. That is free on every plan.
  - q: What happens if the page closes while photos are still uploading?
    a: Photos upload from your device while the page is open. If it closes first — on a phone, switching to another app can do that — a photo that had not finished cannot be completed. Once it clearly is not still uploading, it stops counting toward your card limit. Later still — long enough that no upload anywhere could be finishing it — it is removed the next time someone who can edit that cluster opens it on the canvas, with a note saying how many, so they can be added again. A photo that did finish uploading is kept. One that finished after you had switched to another cluster is put back in place once it is clearly not still uploading, the next time that cluster is opened on the canvas.
  - q: How do I upload a new version of a file?
    a: Drop the new file onto the old one — on the board or in Files — and it becomes the next version, with the old one kept. Or right-click the file and choose Upload new version…. Info lists every version, and any of them can be made current again.
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

**File type.** Any, on every plan. `.psd`, `.fig`, `.zip`, project files,
archives — each lands as a file card with a download. On the free plan one of
those is capped at {{fact:freeFileCap}}, the same ceiling as a PDF.

**Size.** On the free plan:

| Type | Cap |
|---|---|
| Video | {{fact:freeVideoCap}} |
| Audio | {{fact:freeAudioCap}} |
| PDF | {{fact:freePdfCap}} |
| Any other file | {{fact:freeFileCap}} |
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

Uploads count against your account's storage quota: {{fact:freeStorage}} on the
free plan, {{fact:creatorStorage}} on {{fact:planName}}. The meter is in
**Settings → Plan & billing**. When it is full, new uploads stop until you
delete files or upgrade — nothing already there is touched.

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
{{fact:versionDeletedDays}} days, where **Restore** brings it back; after that
it's gone. A file keeps up to {{fact:versionLimit}} versions, and the one on
show can't be deleted while it's the only one left — deleting the card is how
you delete the file. Every change is one step of `⌘Z`.

Every version is a stored file, so every version counts toward your
[storage](#storage). Copying or moving a card brings its versions with it.

## Downloading

Every file card has a download. [Images](/docs/canvas/images) additionally offer
a version with adjustments applied. [PDFs](/docs/files/pdf) can be downloaded
from the viewer.
