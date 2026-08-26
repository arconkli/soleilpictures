---
title: Notes — Soleil Clusters
metaDescription: Rich-text notes on the Soleil Clusters canvas — formatting, checklists, @-mentions, auto-linking and real-time co-typing with other people.
h1: Notes
navLabel: Notes
section: canvas
order: 3
updated: 2026-08-08
answer: A note is a rich-text card you can put anywhere on a canvas. Press N to add one. Notes support formatting, checklists and @-mentions of other boards, docs and cards, they auto-link URLs into previews, and two people can type in the same note at once and see each other's cursors.
faq:
  - q: Can two people edit the same note at once?
    a: Yes. Notes are collaborative in real time, with visible carets for whoever else is typing. Edits merge rather than overwriting each other.
  - q: Why is there no spellcheck underline?
    a: Browser and Grammarly spellcheck are deliberately disabled inside notes. Their injected markup fought with the collaborative editor and corrupted formatting.
  - q: How do I resize a note?
    a: Drag its corner. Notes also grow downward on their own as you type past the bottom edge.
related:
  - /docs/canvas/cards
  - /docs/organize/links-and-mentions
  - /docs/documents
---

A note is the general-purpose card: a caption, a brief, a to-do list, a
paragraph of context beside a set of images. Press `N`, or right-click where you
want it.

For anything longer than a few paragraphs, use a [document](/docs/documents)
instead — it has pages, a proper toolbar and export.

## Writing

Double-click a note to start editing. Click away — or press `Esc` — to finish;
your edits are shared live with collaborators as you type, so there is no
separate "cancel". `⌘Z` undoes inside the note, and the note's undo history
survives closing and reopening it.

Formatting works as you would expect: `⌘B`, `⌘I`, `⌘U` for bold, italic and
underline. A toolbar appears at the bottom of the canvas while a note is
focused, carrying colour, size, font and alignment.

> **Note:** With the caret merely placed in a note and nothing selected,
> formatting applies to the **whole note** rather than doing nothing. This is
> deliberate — it is almost always what you meant.

Right-clicking while you are editing gives you the **browser's** text menu —
Paste, Copy, Look Up, Emoji & Symbols — not the card menu. A right-click on a
note you are not editing gives the card menu as usual.

## Checklists

Start a line with a checkbox from the toolbar to make a task list. Boxes are
clickable directly on the canvas without entering edit mode, so a note can serve
as a live shot list or a packing list that anyone on the board can tick off.

## Mentions

Type `@` to mention another cluster, document, card, tag or person. The mention
becomes a real link with a hover preview, and it registers as a backlink on the
thing you mentioned — so that item's panel can show everywhere it is referenced.

See [Links and mentions](/docs/organize/links-and-mentions).

## Automatic links

Paste or type a URL into a note and it becomes a link, with a preview card on
hover. You do not have to do anything to make this happen.

Names that match an existing tag or entity are also detected and quietly
underlined, so a note that says "Diner" connects itself to the Diner entity you
already created elsewhere.

## Working together

Notes are collaborative in real time. Two people can type in the same note at
once, with visible carets showing who is where. Edits merge — there is no
last-write-wins overwrite and no lock.

## Colours and defaults

A note's background and text colour are set from the toolbar or the right-click
menu. Text colour is always resolved for readability, so a note stays legible if
someone switches between light and dark [themes](/docs/account/theme-and-defaults).

To stop setting the same thing every time, Settings → **Card defaults** sets the
background, text colour, font and size every new note starts with.

## Spellcheck

Browser spellcheck and Grammarly are switched off inside notes on purpose. Their
injected markup conflicted with the collaborative editor and could corrupt
formatting mid-sentence. This is not a setting.
