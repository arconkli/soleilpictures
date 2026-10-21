# Documents

> A document is a multi-page rich-text editor that lives as a card on your canvas. It has a page tree, a full formatting toolbar, tables, images, code blocks and embedded boards, real-time co-editing with visible cursors, inline comments, and find and replace. Open it full screen or docked beside the canvas.

_Source: https://clusters.soleilpictures.com/docs/documents · Updated 2026-10-21_

A document is where the writing goes. It lives as a card on a canvas, so a
treatment sits beside the references it came from rather than in a different
application.

Add one with the **doc** tool in the rail.

## Starting from a treatment

The [director's treatment](/tools/directors-treatment) page hands you a
document to start from. Press its button, and once you are signed in a
treatment document is added to a cluster in your own workspace and opens. It
holds a cover, then a page for each section: concept, tone and references,
look and light, casting, wardrobe and art direction, locations, and edit,
music and pace. Each page has a line saying what goes on it. Replace the lines
with your own, bring the chosen images in, and
[export](/docs/documents/export) a PDF.

Until you change something in it, the treatment is a template: it does not
count toward your cards and search does not list it. Your first change makes
it your document like any other.

## Opening

Two modes:

- **Full screen** — the document fills the window
- **Side** — docked beside the canvas, resizable, so you can write while looking at the board

Double-clicking a document card opens it in **whichever mode you used last**, so
if you work docked you stay docked. On a phone or a tablet, tap the card twice.
The dock and full screen swap either way from the buttons in the document's
header.

A docked document is held by the workspace, not by the canvas underneath it. You
can open other clusters, drill into nested ones, and move around the sidebar with
the document still open beside you — it stays put until you close it. Docking a
document also takes over the [split view](/docs/clusters#side-by-side) pane, since
there is only one.

A document reopens **where you left it** — the same page, scrolled to the same
spot — even after you close the tab. That position is remembered per browser,
not synced between devices. Following a collaborator's avatar into a document
still takes you to where *they* are.

### Two documents side by side

With a document docked, open another one on the board and it takes the board's
place, so the two sit side by side: a script beside its treatment, notes beside
the draft they are about. Each keeps its own toolbar, find and zoom, and `⌘Z` and
`⌘F` act on the one you are working in. The sidebar tucks away while both are
open; `⌘B` brings it back. Opening a third puts it in place of the second, and a
card's **Open beside** button still changes which one is docked.

**×** on either document brings the board back; close the docked one and the
other moves into the dock. Going to another cluster closes the one from the
board you left, and the docked one stays. On a phone, where there is room for
one, the document you open takes the dock instead.

## Layout

**Pages** on the left — a hierarchical tree. Documents are genuinely
multi-page, and pages nest. A page holds as much as you write: set to real
pages, its text flows from one sheet onto the next as you type, so long-form
writing does not stop to manage pagination. Collapsing a page's sub-pages (the
arrow beside it) is yours alone: it is remembered on this device and changes
nothing for anyone else in the document. On a phone or a touch tablet the tree
folds into a drawer: tap **Page list** above the toolbar to open it (**Scenes**
in a screenplay, where the drawer also lists the scenes).

**Bookmarks** under the page tree — durable anchors into specific places in the
text, which survive editing around them. Add one with the bookmark button in the
toolbar; click it in the list to jump there.

**The body** in the middle, with the formatting toolbar above it.

Zoom runs from 25% to 200%.

On a phone the text stays full size. A document set to real pages shows as one
continuous sheet there (its exports and wider screens keep the pages), and a
screenplay fits its text column to the screen, with the margins (and the
comment dots in them) a swipe away.

The same goes wherever a document is narrower than a page, on any screen:
docked beside the board, one of [two side by side](#two-documents-side-by-side),
or in a small window. A screenplay fits its text column to the width, at full
size where there is room, and its lines still break where the printed page
breaks them. Prose takes narrower margins on screen. The page list tucks away to
the arrow at its edge, which brings it back for as long as the document stays
that narrow without changing how it opens anywhere else.

## Writing and formatting

The toolbar carries the usual: headings, bold, italic, underline, highlight,
lists, task lists, alignment, colour, font and size. Every one has a
[keyboard shortcut](/docs/keyboard-shortcuts#document). To reach the toolbar
from the keyboard, press `⌥F10` (`Alt+F10` on Windows) in the text; the arrow
keys move along it, and `Esc` brings you back to where you were typing.

`⌘F` opens **find and replace**. **All** replaces every match on the page and
says how many; the toast's **Undo** puts them all back, and so does one `⌘Z`.

**Right-click** a selection for cut, copy, paste, formatting, links and
comments. Right-click a word with nothing selected — or `⇧`-right-click
anywhere — for your browser's own menu, with its spelling suggestions.

Text pasted from Google Docs, Word or a web page keeps its structure and
emphasis — headings, lists, links, bold, italic, real colours — but drops the
source's font, size, background and default black ink, so it takes on the
document's own typography instead of arriving as a patch of 11pt Arial. Text
copied from another Clusters note or document keeps everything. **Clear
formatting** (`⌘\`, or the **Tx** button) strips the selection back to plain;
links and comments stay.

The footer shows a live word and character count, and the document's save
status.

## Insert

The **Insert** menu adds:

- **Image**
- **Table**
- **Divider**
- **Code block**
- **Embed board** — a whole [cluster](/docs/clusters), rendered inside the document

You can also paste an image, or drop one in from your computer. While it
uploads it shows in the spot it will land, with how far it has got, and you can
cancel it there; if the upload fails, it says so in the same spot, with
**Retry**.

## Working together

Documents are collaborative in real time, with peer cursors and selections
visible as people type. Edits merge rather than overwriting.

If the cluster is [restored to an earlier version](/docs/clusters/trash-and-recovery#version-history)
while you have a document open, or someone moves cards into it, the cluster
reloads, and the document reopens where you were and says what happened. If
that took anything off the page you had open (a restore to before you wrote
it, or your last few words before they were saved), it offers you the page as
you had it, to copy and paste back what you want to keep.

## Undo

Two histories, matching how documents are edited:

- **Typing:** `⌘Z` while the caret is in the text undoes your writing, as in
  any editor.
- **Structure:** `⌘Z` with the document open but the caret elsewhere undoes
  page operations — deletes, moves, renames. Deleting a page with its
  sub-pages, comments and bookmarks is one step, and page deletes also offer
  an undo toast.

Both undo only *your* edits, never a collaborator's.

## Comments, tags and links

The margins do a lot of work:

- **[Inline comments](/docs/documents/comments-and-tags)** on a text range, with dots in the right margin
- **[Tag ranges](/docs/documents/comments-and-tags)** underlining text, with dots in the left margin
- **Suggested entities** — names the app noticed, with a tick or a cross in the margin to confirm or dismiss
- **[Links and mentions](/docs/organize/links-and-mentions)** — `@` anything, with hover previews
- **Backlinks** — everywhere this document is referenced from

## Screenplays

Documents have a dedicated [screenplay mode](/docs/documents/screenplay) with
industry-standard formatting, correct pagination, a scene navigator, a title
page, and Final Draft and Fountain import and export.

## Exporting

PDF, Markdown, HTML, and for screenplays `.fdx` and `.fountain`. See
[Exporting documents](/docs/documents/export).

## Documents versus notes

| | [Note](/docs/canvas/notes) | Document |
|---|---|---|
| Lives | On the canvas | As a card, opens full screen or docked |
| Length | A paragraph or a list | Pages |
| Structure | None | Page tree, bookmarks |
| Comments | On the card | On a text range |
| Export | With the board | Its own formats |

If you find yourself scrolling inside a note, you wanted a document.
