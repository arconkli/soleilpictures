# Documents

> A document is a multi-page rich-text editor that lives as a card on your canvas. It has a page tree, a full formatting toolbar, tables, images, code blocks and embedded boards, real-time co-editing with visible cursors, inline comments, and find and replace. Open it full screen or docked beside the canvas.

_Source: https://clusters.soleilpictures.com/docs/documents · Updated 2026-08-08_

A document is where the writing goes. It lives as a card on a canvas, so a
treatment sits beside the references it came from rather than in a different
application.

Add one with the **doc** tool in the rail.

## Opening

Two modes:

- **Full screen** — the document fills the window
- **Side** — docked beside the canvas, resizable, so you can write while looking at the board

## The three panes

**Pages** on the left — a hierarchical tree. Documents are genuinely
multi-page, and pages nest. A new page is created automatically when the current
one fills up, so long-form writing does not stop to manage pagination.

**The body** in the middle, with the formatting toolbar above it.

**Bookmarks** on the right — durable anchors into specific places in the text,
which survive editing around them.

Zoom runs from 25% to 200%.

## Writing and formatting

The toolbar carries the usual: headings, bold, italic, underline, highlight,
lists, task lists, alignment, colour, font and size. Every one has a
[keyboard shortcut](/docs/keyboard-shortcuts#document).

`⌘F` opens **find and replace**.

The footer shows a live word and character count, and an honest save status —
it reports what has actually been persisted rather than an optimistic tick.

## Insert

The **Insert** menu adds:

- **Image**
- **Table**
- **Divider**
- **Code block**
- **Embed board** — a whole [cluster](/docs/clusters), rendered inside the document

Blocks can be reordered by dragging the handle in the left margin.

## Working together

Documents are collaborative in real time, with peer cursors and selections
visible as people type. Edits merge rather than overwriting.

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
