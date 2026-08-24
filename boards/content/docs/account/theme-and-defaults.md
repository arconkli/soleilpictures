---
title: Theme, Fonts and Defaults — Soleil Clusters
metaDescription: Set light or dark mode, an accent colour and a body font in Soleil Clusters, and choose what new notes, shapes and clusters start as.
h1: Theme and defaults
navLabel: Theme and defaults
section: account
order: 2
updated: 2026-08-08
answer: Theme covers light or dark mode, an accent colour and a body font chosen from a curated list or anything on Google Fonts. Defaults set what new notes and shapes start as — colours, font, size, stroke — and whether clusters open as a canvas or a list. All of it is stored on your account and follows you between devices.
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

## Theme

**Settings → Theme.**

- **Mode** — light or dark. `⌘K` → "toggle theme" switches it without opening settings.
- **Accent** — the highlight colour used through the interface.
- **Body font** — a curated list of around twenty-five families, plus anything available on Google Fonts.

Theme is stored on your **account**, not the browser, so it follows you to any
device you sign in on. Fonts you have used recently are pre-loaded so text does
not flash in a fallback face on a cold load.

### Readability across themes

Text colour in [notes](/docs/canvas/notes) and
[documents](/docs/documents) is resolved against the background it actually sits
on. A note authored in light mode stays readable to a collaborator working in
dark mode, and to anyone opening a
[public link](/docs/collaborate/sharing).

### The reserved accent

The gold accent means active, selected or focused. It is reserved for the
interface and is not part of the content
[palette](/docs/canvas/palettes-and-color) — so "this is selected" never gets
confused with "this is gold" on a colourful board.

## Defaults

**Settings → Defaults.** What new things start as, so you are not restyling
every one.

| Default | Applies to |
|---|---|
| Note background, text colour, font, size | Every new [note](/docs/canvas/notes) |
| Shape font, stroke colour, fill colour, stroke width | Every new [shape](/docs/canvas/shapes-and-drawing) |
| Default view | Whether clusters open as [canvas or list](/docs/clusters/list-view) |

Defaults are workspace-scoped, so a workspace can have a consistent look without
anyone enforcing it by hand.

## Display

**Settings → Display.**

- **Clean mode** (`⌘.`) — hides interface chrome for presenting or screenshots
- **Sidebar open by default**
- **Scroll wheel** — **Pan** (the default: `⌘`-scroll zooms) or **Zoom** (a plain
  scroll zooms at the pointer; `⌘`, `Alt` or `Shift` pans)

The wheel setting exists because the convention genuinely splits across the
tools people arrive from — PureRef and Miro zoom on scroll, Figma and Milanote
pan — so there is no default that is right for everyone. It follows your
account like the rest of this tab, and pinching a trackpad zooms either way.

## Custom fonts

Beyond the curated list, any Google Fonts family can be added and is then
available everywhere a font is chosen — notes, documents, shapes and the body
font.

[Screenplays](/docs/documents/screenplay) are the exception: they are always
Courier, because the format requires it and page count depends on it.
