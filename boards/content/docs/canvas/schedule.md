---
title: Schedule Cards — Soleil Clusters
metaDescription: Real-date calendar cards on the Soleil Clusters canvas — day tiles, a list, a month grid, and days that run as a timed running order.
h1: Schedules
navLabel: Schedules
section: canvas
order: 8
updated: 2026-09-01
answer: A schedule card is a real calendar on your canvas. It shows a month as day tiles, as a list, or as a grid, with a wall chart above it spanning the whole production. Each date can hold notes, images and files, and whole clusters that carry a date. A day opens as a running order — every item has a length, and the start times cascade.
faq:
  - q: Can I add a schedule card right now?
    a: Not at the moment. Schedule cards are being rebuilt, so the Schedule entry is off the Add menu. Cards you already have keep working, and everything on this page still describes them.
  - q: Can I drop images and notes into a schedule?
    a: Yes. Any card can go into a date, not just text. A location photo attached to the day it is needed works exactly as you would expect.
  - q: If I change one item's length, what moves?
    a: Everything below it, and the estimated wrap. Nothing above it moves, and nothing after a pinned row moves — a pin is a fixed time of day and it holds.
  - q: Why do the days show pictures?
    a: Because each one is a cluster, and every cluster already renders a thumbnail of its own canvas. In a production nearly every day is a board full of that day's material, so the calendar shows you the actual day rather than an icon standing in for one.
  - q: Can I still have a plain month grid?
    a: Yes — it is the third density in the header control. A month grid is built for a sparse calendar, which is exactly what a release plan or a prep calendar is, so it is kept rather than traded away.
  - q: Why can I not type directly into the calendar grid?
    a: Loose content in the month and week grids is deliberately read-only, because inline editing in a dense calendar produced constant mis-clicks. Clicking a date selects it; double-clicking a grid cell opens the day panel.
  - q: Does paging to next month move it for everyone?
    a: No. Navigation is yours alone. The card remembers where it opens, but stepping through months, jumping to a date and "Go to today" are all local to you.
related:
  - /docs/canvas/grids
  - /docs/clusters
  - /docs/clusters/production-schedule
---

> **Being rebuilt.** Schedule cards are temporarily off the Add menu while the
> calendar and the day view are reworked. Existing cards keep rendering and
> keep their content — nothing has been removed. This page describes what those
> cards do today; it will grow again as the rebuild lands.

A schedule card is a calendar with real dates, sitting on the canvas next to
everything it refers to. Shooting days beside the location photos; a release
plan beside the assets.

## Three densities, one control

The same calendar, shown three ways. Pick with the control in the header.

| | What you get | Good for |
|---|---|---|
| **Tiles** | Weeks as rows, each day a tile showing that day's **cluster** — its own thumbnail and name | A production, where nearly every day is a board |
| **List** | Day rows with a small preview and the name | Running the week; a fortnight at a glance |
| **Grid** | The classic month grid | A release plan or a prep calendar — anything **sparse** |

Tiles is the default because in a production nearly every day *is* a board: a
cluster holding that day's call sheet, shot list, script pages and running
order. A calendar's job there is not to show events, it is to be the way into
those boards — and a coloured bar with a date on it cannot carry a board's
identity, but a picture of the day can.

Grid is kept rather than traded away. A month grid is built for a *sparse*
calendar, most cells empty, and that is exactly what a release plan is.

### The wall chart

Above Tiles and List sits a strip: one row per month, one thin column per day.
It spans the **whole production**, not the month you happen to be looking at,
because its only job is the shape of the schedule — ten weeks of prep, eight of
production, two of wrap, in about a hundred pixels. Click any day to jump the
surface below to it.

It does not try to be readable up close. It navigates; the surface below
details.

**Full screen** (the ⤢ in the header) gives the whole window over. A production
calendar is a wall chart, and on a canvas it is always negotiating for width
with everything around it.

## Views

Three ways into the same schedule:

| View | Shows |
|---|---|
| **Month** | A whole month — or three, or six |
| **Week** | Seven days side by side |
| **Day** | The day's running order — see below |

In month view, the **1 / 3 / 6** control sets how many months are on the card at
once. Three months is a block of principal photography; you can see the whole
shoot without paging. Asking for more months grows the card to fit them — three
readable months need the room, and silently shrinking each one into a grid of
dots would defeat the point.

A prep week can sit at month view while the shoot day sits at day view in the
same board.

## The day is a running order

Day view is not a column of hours. It is a **list of items, each with a
length**, and the start times work themselves out from the top down.

```
07:00  ◆ Crew call                  0:30
07:30    Breakfast                  0:30
08:00    Rehearse — sc 14A          0:45
08:45    Shoot 14A                  2:15
11:00    Company move → Ext. Dock   0:45
```

Change one length and **everything below it moves.** That is the whole point:
when rehearsal runs twenty-five minutes long you edit one number, not twelve.

Three things to do here, and nothing else:

- **Type a length.** `2:15`, `2h15` and `135` all mean the same thing.
- **Drag a row** to move it. The times stay put and re-cascade around it.
- **Pin a row** to lock it to a time of day. A pinned row shows its time as an
  editable field; everything else is calculated and cannot be typed into.

### Pins, and what they cost

A crew call and a meal break happen at a time, not "whenever we get to them".
Pin them, and the pin holds — what moves is the report:

- **runs 12m past the pin** — the item above overruns it. The pin does not
  slide; the day after it stays on schedule and you are told what has to give.
- **20m spare before the pin** — dead air you can fill.

The header carries the day's start and its **estimated wrap**.

A day can also cross midnight: an 18:00 start wrapping at 04:00 accumulates past
midnight rather than reading as time travel.

A row can also be a **cluster** — the setup's own board, with its shot list,
references and pages inside — opened straight from the row.

Adding a day with **Set up this day** seeds three rows: the call, a first setup,
and a meal break six hours after the call. An empty list is a blank page.

### Navigation is yours

Stepping through months, jumping to a date, and **Go to today** only move *your*
view. The card remembers the date it opens on, but a schedule shared with fifty
people does not jerk under everyone else when you page forward.

## Two things live on a date

**Loose content** — a note, an image, a file, a link — dropped straight onto a
date. This is the quick kind: a reminder on a Tuesday, a reference photo on the
day it is needed.

**Days** — whole clusters that carry a date. A day tile on the calendar is a
real cluster you can open, containing whatever the day needs: the script pages,
the call sheet, the shot list, the running order. See
[Production schedules](/docs/clusters/production-schedule).

## Reading it

The month grid has no vertical rules — just a line between weeks, and space.
Dates you can act on are bright; days from the neighbouring month and weekend
dates step back. Today is a filled circle.

Where a month is too narrow for a word — a three-month strip, say — a day
renders as a bar rather than a truncated name. Switch to List for names at a
size you can read.

## The day panel

For loose content, the month and week grids are **read-only**. A dense calendar
grid with inline editing produced constant mis-clicks: reaching for a slot and
accidentally editing the one next to it.

Clicking a date **selects** it. Double-clicking a tile opens that day's cluster;
double-clicking a cell in Grid density opens the **day panel**, where loose
content is edited at a comfortable size whatever the card's size on the canvas.
The day's running order lives in Day view, not here.

## What a schedule is for

Anything where the cells mean *time*:

- Shoot days and unit moves
- Call sheets, with the location photo attached to the day
- Delivery and release timelines
- A prep calendar with references attached to the day they are needed

If the cells mean *position* rather than time — a storyboard, a contact sheet,
a comparison — you want a [grid](/docs/canvas/grids).
