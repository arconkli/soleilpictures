---
title: Files and Uploads — Soleil Clusters
metaDescription: Upload any file to Soleil Clusters, at any size, on every plan. How large uploads work, what counts toward your storage, and how deleting frees space.
h1: Files and uploads
navLabel: Overview
section: files
order: 0
updated: 2026-10-27
answer: Drag any file onto a canvas and it becomes a card. Images (camera raws and Photoshop documents included), video, audio and PDFs get real players and viewers; Word, PowerPoint, Excel and other documents show their first page; everything else — a .fig, a .zip, a project file — becomes a file card with a type icon and a download, on every plan. There is no per-file size limit on any plan: the free plan has a {{fact:freeStorage}} drive and Creator a {{fact:creatorStorage}} one, and the drive is the only limit.
faq:
  - q: What file types can I upload on the free plan?
    a: Any, at any size. Video, audio, PDFs and images, camera raws and Photoshop documents among them, get their own cards; every other type — .fig, .zip, project files, archives — is a file card with a download. The only limit is the drive, {{fact:freeStorage}} on the free plan.
  - q: How large a file can I upload?
    a: As large as the room left on your drive — there is no per-file limit on any plan, and very large files upload in parts automatically. The drive is {{fact:freeStorage}} on the free plan and {{fact:creatorStorage}} on {{fact:planName}}.
  - q: Where do my files actually live?
    a: In private object storage. Files are served through signed URLs that expire, so a file cannot be reached by guessing a URL.
  - q: Can I bring in my PureRef boards?
    a: Not as .pur files yet — Clusters cannot open a PureRef scene, on any plan. Export the images from PureRef and drop those onto a canvas; they become image cards.
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
| Image (incl. HEIC, TIFF, JPEG XL, OpenEXR, JPEG 2000, camera raw, Photoshop `.psd`) | An [image card](/docs/canvas/images) with adjustments, shown in every browser |
| Video | An inline [player](/docs/files/video-and-audio) |
| Audio | A [waveform player](/docs/files/video-and-audio) with cover art |
| PDF | A [page-one thumbnail](/docs/files/pdf) opening into a full viewer |
| Document (Word, PowerPoint, Excel, Keynote, Pages, Numbers, OpenDocument, RTF) | A card showing its first page, opening on all its pages |
| Text, Markdown, code, logs, `.csv`, `.tsv`, `.srt`, `.vtt` | A white page showing the start of the file: Markdown set as a document, a table's rows, subtitle cues, code and logs as the file has them |
| Font (`.ttf`, `.otf`, `.woff`, `.woff2`, `.ttc`) | A specimen drawn in the font: Aa, its name and style, a sample line and its alphabet |
| Email (`.eml`, `.msg`) | A letter: its subject, who it's from and to, the date and its first lines |
| Screenplay (`.fountain`, `.fdx`) | A new [script document](/docs/documents/screenplay), title page included — free on every plan |
| PureRef scene (`.pur`) | Nothing yet — Clusters cannot open PureRef boards. Export the images from PureRef and drop those |
| An unfinished download (`.crdownload`, `.part`) | Skipped, with a note to drop it again once it has finished |
| Anything else | A file card — type icon, name, size, download |

Double-click a file card to open it full screen, with **Download** and **Share**
there.

A document's card shows its first page, at the page's own shape, as a
[PDF](/docs/files/pdf)'s does — a spreadsheet's shows its first sheet — and
counts its pages. It opens on its pages, which page through as a PDF's do.
They are made once, in the background, so a new document's card takes a few
seconds to show its page: the first {{fact:docMaxPages}} pages of a document up
to {{fact:docMaxSize}}. A document with a password, or one that's damaged,
stays a file card, with the download.

A text file opens as its page, with line numbers, up to its first
{{fact:textStageMax}}; past that, the page says so, and **Download all of it**
saves the whole file. A `.csv` or `.tsv` opens as a table under its header row,
up to {{fact:tableStageRows}} rows. Subtitles open as their cues, and Markdown
as a document whose links open in a new tab.

A font opens as a page to try it on: type your own words and change the size,
with the font set at five sizes and its letters and numbers below, and its
style, format and licence as the font itself states them. A font over
{{fact:fontFaceMax}}, or one that won't load, keeps its icon.

An email opens as it was sent, with its attachments below it, to download one
by one or put on the board together. Pictures from the web stay hidden until
you choose **Show pictures**, and nothing in an email can run. An email over
{{fact:mailMaxSize}} doesn't open there (download it to read it), and an
Outlook `.msg` over {{fact:mailCardMax}} keeps its icon on the board.

## Limits

**File type and size.** Any, on every plan. `.psd`, `.fig`, `.zip`, project
files, archives, a 4K clip, a WAV stem — each lands as its own card, at any
size. There is no per-file limit on any plan.

**Storage.** The only limit is the drive: {{fact:freeStorage}} on the free
plan, {{fact:creatorStorage}} on {{fact:planName}}. A drop that would not fit is
caught before anything uploads, and you can add the part that fits; the rest
waits in the tab and goes on by itself when you upgrade or add storage
([Hitting a limit](/docs/account/plans#hitting-a-limit)). Inviting
someone new adds {{fact:referralBonusStorage}} to your drive once they get
started, and to theirs when they join ([Referrals](/docs/account/referrals)).

> **Note:** The drive and the [card cap](/docs/canvas/cards) are the real,
> enforced differences between free and paid — a free account stops at
> whichever it reaches first. Clusters and editing are not limited on any
> plan, and up to {{fact:editorLimit}} people can edit on Free and Creator alike.

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
delete files or upgrade — nothing already there is touched. Files you drop in
the meantime wait in the tab: they go on by themselves when you upgrade or add
storage, or when you press **Upload now** after deleting. On {{fact:planName}}
you can also add [more storage](/docs/account/plans#more-storage),
{{fact:storageAddonSize}} at a time.

Storage is counted against the **owner of the cluster**, not the person who
uploaded. If you are an editor on someone else's board, your uploads use their
quota — which is the same rule that governs the [card cap](/docs/canvas/cards).

### What counts

- **A file counts while a cluster uses it.** Delete its card and the file stops
  counting within a few minutes — unless another cluster still uses the same
  file, as a [copy](/docs/clusters/sidebar#moving-and-copying-files) does.
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

## On a phone or tablet

With a finger, a tap on a file in Files opens it in Quick look, and touching
and holding it opens its menu, whose **Select** lets each tap pick another file
for the selection bar: put them on the board, move, copy or delete them. See
[Files with a finger](/docs/account/mobile#files-with-a-finger).

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

To send someone one file on its own — a page with just that file, its player
and its comments, and nothing else from the cluster — use **Share file…**
([Sharing a single file](/docs/collaborate/sharing#sharing-a-single-file)), or
**Share** wherever the file is open full screen: the player, the image and PDF
viewers, and Quick look from the sidebar or the file list.
