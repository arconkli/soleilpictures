# Notes

> A note is a rich-text card you can put anywhere on a canvas. Press N to add one. Notes support formatting, checklists and @-mentions of other boards, docs and cards, they auto-link URLs into previews, and two people can type in the same note at once and see each other's cursors.

_Source: https://clusters.soleilpictures.com/docs/canvas/notes · Updated 2026-11-09_

A note is the general-purpose card: a caption, a brief, a to-do list, a
paragraph of context beside a set of images. Press `N`, or right-click where you
want it.

For anything longer than a few paragraphs, use a [document](/docs/documents)
instead — it has pages, a proper toolbar and export.

## Writing

Double-click a note to start editing; the caret lands where you clicked. On a
phone or tablet, tap the note to select it, then tap it again where you want to
type, or double-tap it, and the keyboard comes up. Click or tap away — or press
`Esc` — to finish; your edits are shared live with collaborators as you type, so
there is no separate "cancel". `⌘Z` undoes inside the note, and the note's undo
history survives closing and reopening it. Right after a colour, font, size or
**Center in the box** from the toolbar, `⌘Z` takes that back first.

Formatting works as you would expect: `⌘B`, `⌘I`, `⌘U` for bold, italic and
underline. A toolbar appears at the bottom of the canvas while a note is
focused, carrying colour, size, font and alignment, and **Tx** — clear
formatting (`⌘\`), which strips the selection back to the note's own font and
size while keeping links and comments. `⌥F10` (`Alt+F10` on Windows) takes you
from the note's text to that toolbar, and `Esc` brings you back.

Lists come from the toolbar. In a bulleted or numbered list, `Tab` tucks an item
under the one above and `⇧Tab` brings it back out; outside a list, `Tab` types
two spaces. Neither key takes you out of the note.

Typing `- ` or `>` at the start of a line, or backticks around a word, leaves
them as you typed them: nothing turns into a list, a quote or code. A line that
starts with `- ` starts the next one with a dash too when you press `Enter`.
Quotes and code already in older notes stay, drawn quietly in the note's own
font.

Pasting from Google Docs, Word or a web page brings the words, structure and
emphasis but not the source's font, size or background, so pasted text matches
the rest of the note. Blank lines between paragraphs stay, and linked words keep
their link.

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

`Enter` starts the next item unticked, even after a ticked one; at the very
start of a ticked item it opens a new, unticked item above. Checklists don't
nest, so `Tab` does nothing in one, and `⇧Tab` turns the item back into a plain
line. On a phone or tablet each box takes a fingertip, and a tap never ticks the
box next to it.

## Mentions

Type `@` to mention another cluster, document, card, tag or person. The mention
becomes a real link with a hover preview, and it registers as a backlink on the
thing you mentioned — so that item's panel can show everywhere it is referenced.

See [Links and mentions](/docs/organize/links-and-mentions).

## Automatic links

Paste or type a URL into a note and it becomes a link, with a preview card on
hover. You do not have to do anything to make this happen. Words pasted with a
link — from a web page, an email or a document — keep their address, so they
stay clickable.

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

On a computer, browser spellcheck and Grammarly are switched off inside notes on
purpose. Their injected markup conflicted with the collaborative editor and could
corrupt formatting mid-sentence.

On a phone or tablet, a note types the way everything else on the device does:
the keyboard's autocorrect, automatic capitals and spellcheck are on. Grammarly
stays off there too. Neither is a setting.
