---
title: Colour Palettes and the Picker — Soleil Clusters
metaDescription: Palette cards, the colour picker with eyedropper and hex input, recent colours, and how board colours stay readable in light and dark themes.
h1: Colour palettes and the picker
navLabel: Palettes and colour
section: canvas
order: 10
updated: 2026-08-08
answer: A palette card holds a set of colours on your board that everything else can pull from — notes, shapes, arrows, backgrounds and outlines. The picker has a saturation-value pad, hue slider, hex field, presets, an eyedropper, and swatches from any palette on the board. Recently used colours are remembered so a board stays in one scheme.
faq:
  - q: Where does the eyedropper sample from?
    a: Anywhere on your screen, using the browser's native colour picker. Sampling a colour straight out of a reference image on the canvas is the usual case.
  - q: Will my colours be unreadable in dark mode?
    a: No. Note and document text colours are resolved for contrast against their actual background, so text stays legible whichever theme a reader is using.
  - q: Can I reuse a palette across boards?
    a: Copy the palette card and paste it into another cluster. Its swatches then feed that board's picker.
related:
  - /docs/canvas/notes
  - /docs/canvas/shapes-and-drawing
  - /docs/account/theme-and-defaults
---

Colour shows up in two places: as a **palette card** that holds a scheme, and as
the **picker** that appears anywhere a colour is set.

## Palette cards

A palette card is a set of swatches living on the board. Add one from the rail's
**+** menu → *Tools* → **Palette**.

It does two jobs. It documents the scheme — visible to anyone who opens the
board — and it feeds the picker: every palette on a board contributes its
swatches to the colour picker everywhere else on that board. Set a scheme once
and the notes, shapes and arrows you make afterwards can be built from it in one
click.

## The picker

The same picker, everywhere a colour is chosen:

- **Saturation-value pad** and **hue slider** for picking by eye
- **Hex field** for an exact value
- **Presets** — the standard set
- **Palette swatches** — from every palette card on this board
- **Recent colours** — what you have been using
- **Eyedropper** — sample any pixel on screen, including from a reference image on the canvas

Recent colours are the quiet one that matters most: a board built in one scheme
stays in that scheme without anybody maintaining a system.

## Where colour applies

| Surface | What you can set |
|---|---|
| [Notes](/docs/canvas/notes) | Background, text |
| [Shapes](/docs/canvas/shapes-and-drawing) | Stroke, fill |
| [Arrows](/docs/canvas/arrows) | Line colour |
| [Groups](/docs/canvas/groups) | Outline colour |
| Canvas | Background — seven presets plus custom |
| Clusters | Cover colour |
| You | Your [presence colour](/docs/collaborate/presence) |

## Readability

Text colour in notes and documents is resolved against the actual background it
sits on, so a note authored in a light [theme](/docs/account/theme-and-defaults)
stays readable to someone reading in dark mode. You do not have to think about
it and there is no setting.

## One reserved colour

The gold accent is reserved for the interface: active state, current selection,
focus. It is not part of the content palette. This keeps "this thing is selected"
visually distinct from "this thing is gold", which matters on a board where the
content is itself colourful.

---

Building a colour-led look book? The [look book maker](/tools/look-book-maker)
guide covers the workflow end to end.
