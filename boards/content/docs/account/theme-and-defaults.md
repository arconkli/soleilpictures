---
title: Theme, Fonts and Defaults — Soleil Clusters
metaDescription: Follow your system theme or pick light or dark in Soleil Clusters, set an accent colour and body font, and choose what new notes, shapes and clusters start as.
h1: Theme and defaults
navLabel: Theme and defaults
section: account
order: 2
updated: 2026-08-26
answer: Appearance covers the theme — System, Light or Dark, where System follows your device — an accent colour, a body font chosen from a curated list or anything on Google Fonts, and what a plain scroll wheel does. Card defaults set what new notes, docs and shapes start as, and whether clusters open as a canvas or a list. Appearance is personal and follows your account between devices; card defaults belong to the workspace.
faq:
  - q: Does my theme follow me between devices?
    a: Yes. Theme is a per-user account setting, not a browser one, so it syncs everywhere you sign in.
  - q: Can I use any font?
    a: A curated list of about twenty-five is built in, and beyond that you can pull any family from Google Fonts.
  - q: Will notes made in light mode be unreadable in dark mode?
    a: No. Text colours are resolved against the actual background, so notes stay legible in either theme.
related:
  - /docs/account/settings
  - /docs/canvas/palettes-and-color
  - /docs/canvas/notes
---

## Appearance

**Settings → Appearance.** Personal — these change how Clusters looks and
behaves for you, on every device you sign in on, and nobody else in the
workspace sees them. Three sections.

### Theme

- **Mode** — **System**, **Light** or **Dark**. System follows your device's
  own setting and changes live when it does; it is what you get until you pick
  one of the other two, and you can always come back to it. `⌘K` →
  "toggle theme" flips between light and dark without opening settings, which
  counts as picking one.
- **Accent** — the highlight colour used through the interface.
- **Body font** — a curated list of around twenty-five families, plus anything available on Google Fonts.

Theme is stored on your **account**, not the browser, so it follows you to any
device you sign in on. Fonts you have used recently are pre-loaded so text does
not flash in a fallback face on a cold load.

#### Readability across themes

Text colour in [notes](/docs/canvas/notes) and
[documents](/docs/documents) is resolved against the background it actually sits
on. A note authored in light mode stays readable to a collaborator working in
dark mode, and to anyone opening a
[public link](/docs/collaborate/sharing).

#### The reserved accent

The gold accent means active, selected or focused. It is reserved for the
interface and is not part of the content
[palette](/docs/canvas/palettes-and-color) — so "this is selected" never gets
confused with "this is gold" on a colourful board.

### Layout

- **Clean mode** (`⌘.`) — hides interface chrome for presenting or screenshots
- **Sidebar open by default** — `⌘B` and the collapse chevron write this same
  preference, so where you left the sidebar is where it is on your next device

### Canvas

- **Scroll wheel** — **Pan** (the default: `⌘`-scroll zooms) or **Zoom** (a plain
  scroll zooms at the pointer; `⌘`, `Alt` or `Shift` pans)

The wheel setting exists because the convention genuinely splits across the
tools people arrive from — PureRef and Miro zoom on scroll, Figma and Milanote
pan — so there is no default that is right for everyone. It follows your
account like the rest of this tab, and pinching a trackpad zooms either way.

## Card defaults

**Settings → Card defaults.** What new cards start as, so you are not restyling
every one. Existing cards are never changed.

| Default | Applies to |
|---|---|
| Background, text colour, font, size | Every new [note](/docs/canvas/notes) |
| Shape, stroke colour, fill colour, stroke width, line style | Every new [shape](/docs/canvas/shapes-and-drawing) |
| Font | Every new [document](/docs/documents) |
| Default view | Whether clusters open as [canvas or list](/docs/clusters/list-view) |

Unlike Appearance, these belong to the **workspace**, not to you — so a
workspace can have a consistent look without anyone enforcing it by hand.
Editors and owners can change them; viewers see them read-only.

## Custom fonts

Beyond the curated list, any Google Fonts family can be added and is then
available everywhere a font is chosen — notes, documents, shapes and the body
font.

[Screenplays](/docs/documents/screenplay) are the exception: they are always
Courier, because the format requires it and page count depends on it.
