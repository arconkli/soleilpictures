# Coming from another tool

> There is no connector to another app. Moving to Soleil Clusters means downloading your files and dragging them in, which is usually one drag: drop the folder, or the zip a cloud drive gives you, and its folders become nested clusters. What differs by tool is what you lose and what you gain — this page maps the concepts across from the six tools people most often arrive from.

_Source: https://clusters.soleilpictures.com/docs/migrating · Updated 2026-10-21_

There is no connector to another app. That is less of a problem than it
sounds — [dropping a folder or a zip](/docs/clusters#importing-folders-and-zips)
takes about as long as a connector would, and its folders become nested
clusters with their files in each one's Files. The steps for the usual places
are [below](#bringing-files-from-google-drive-dropbox-and-other-apps).

What is worth knowing is how the concepts map.

## What transfers

| | |
|---|---|
| **Images and files** | Drag them in, folders and zips included. [Any type, at any size](/docs/files). |
| **Screenplays** | Import Final Draft `.fdx` or Fountain — see [screenplay mode](/docs/documents/screenplay) |
| **Text** | Paste into [notes](/docs/canvas/notes) or [documents](/docs/documents) |
| **Layout** | Does not transfer from anything |
| **Comments and history** | Does not transfer from anything |

## Concept mapping

| Their idea | Here |
|---|---|
| Board / canvas / project | [Cluster](/docs/clusters) |
| Folder | A nested cluster — [nesting is unlimited](/docs/clusters) |
| Frame / panel | A [grid](/docs/canvas/grids) cell |
| Sticky note | A [note](/docs/canvas/notes) |
| Tag / label | A [tag](/docs/organize/tags), which can also be a typed entity |
| Comment | A [comment](/docs/collaborate/comments), anchored to a card, group, point or text range |
| Share link | A [public link](/docs/collaborate/sharing), always view-only |

## By tool

**[PureRef](/vs/pureref)** — the closest match for pure reference work. You gain
collaboration, sharing and cloud storage; the tradeoff is that Clusters is a
browser app rather than a native always-on-top window.

**[Eagle](/vs/eagle)** — a different job, so it is usually not a move at all.
Eagle stays the private library on your disk; bring the references one project
needs onto a cluster, where the team builds the board together. Eagle keeps every
original as a real file, so they drag in like any other files.

**[Google Drive](/vs/google-drive)** — keep it for backup and sync. Download the
folder a project needs (Drive hands you a zip) and drop the zip on a canvas as
it is: it becomes a cluster with its folders nested inside, every file under its
own name.

**[Milanote](/vs/milanote)** — very similar shape. Boards become clusters,
nesting maps directly, and the card model is comparable.

**[Miro](/vs/miro)** — the whiteboard-to-canvas mapping is direct. Clusters is
built around media and reference rather than diagramming and facilitation.

**[Storyflow](/vs/storyflow)** — boards map to clusters and the references come
across as files. What does not come across is the AI drafting: Clusters does not
generate boards, and connects to [your own assistant](/docs/mcp) instead.

**[Boords, Storyboarder and the other storyboard
tools](/best/storyboard-software)** — panels become
[grid](/docs/canvas/grids) cells, and the script side becomes a
[screenplay document](/docs/documents/screenplay) on the same board.

**StudioBinder** — production management. Clusters covers the visual and
document side; it is not a call-sheet-and-crew-management system. The
[storyboard software roundup](/best/storyboard-software) compares the two
directly.

## Bringing files from Google Drive, Dropbox and other apps

Clusters has no connector to these services: you download your files from
them, then drop what you downloaded on a cluster. In the app, the sidebar's
**Upload** menu → **Bring files from another app…** shows these steps, with a
place to drop and pickers, and brings what you give it into the cluster that is
open, or one you pick.

**Google Drive.** For a whole Drive, open [Google
Takeout](https://takeout.google.com/), choose **Deselect all** and select
**Drive**, then **Next step**; keep **.zip**, set the size to **50 GB**, and
choose **Create export**. Google emails a link when it is ready, which can take
days for a big Drive, and the link lasts a week. Download every part, then drop
all the parts at once: they become one tree. For a few folders, right-click one
in Drive and choose **Download** — Drive hands you a zip (a big folder comes as
several) that comes in the same way.

**Google Photos.** The same Takeout steps with **Google Photos** selected. Each
album and each year becomes a cluster, so a photo in an album can come in
twice. The `.json` files Google puts beside each photo are left out.

**Dropbox.** On dropbox.com, select the folders you want and choose
**Download**: Dropbox makes one zip of them, as long as it is under 250 GB and
fewer than 10,000 files. For more than that, make the folder available offline
in the Dropbox app on your computer and drag the folder in.

**OneDrive.** On onedrive.com, select the folders and choose **Download** for
one zip, up to 250 GB and 10,000 files. For more, set the folder to **Always
keep on this device** in the OneDrive app and drag the folder in.

**iCloud Drive.** On a Mac, iCloud Drive is already a folder: in Finder,
Control-click the folder, choose **Download Now**, wait for it to finish, and
drag it in. On an iPhone or iPad, touch and hold the folder in the Files app,
tap **Compress**, and choose the zip.

**Anything else** — Box, Notion, an old hard drive, a camera card: if it
downloads as a zip, or sits in a folder on your computer, it comes in the same
way. What fits on your plan comes in at once, and the rest waits for room —
see [Importing folders and zips](/docs/clusters#importing-folders-and-zips) for
the limits.

## Comparisons and alternatives

Roundups of what else is out there, with pricing checked at the date shown:

- [The best PureRef alternatives](/best/pureref-alternatives)
- [The best Milanote alternatives](/best/milanote-alternatives)
- [The best mood board apps](/best/mood-board-apps)
- [The best storyboard software](/best/storyboard-software)

## Practical route in

1. Pick **one** live project rather than migrating an archive.
2. Drop its reference folder, or the zip you downloaded, onto a canvas — it
   becomes a cluster, with a nested one for each folder inside it.
3. Give things names — names are what [search](/docs/organize/search) works on.
4. Nest sub-clusters where the old tool had folders.
5. Invite the team. Up to 10 people [edit free](/docs/collaborate) on Free and Creator, so there is no seat maths; a bigger team moves to [Team](/docs/account/team).

Archives are usually not worth moving. Leave them where they are and start with
work that is live.

## Moving out again

Worth knowing before you commit: [board exports](/docs/canvas/export) as PNG and
PDF, [document exports](/docs/documents/export) as PDF, Markdown, HTML, `.fdx`
and Fountain, every original file downloadable as uploaded, and the
[REST API](/docs/api) can read everything programmatically.
