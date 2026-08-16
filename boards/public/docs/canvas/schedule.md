# Schedules

> A schedule card is a real calendar living on your canvas, split into two panes: a month grid showing the shape of the schedule, and a day rail listing what is actually on each date — start time, place, and whether the call sheet has been published. It shows one, three or six months at once, and each day can hold both loose content and whole clusters. Dragging a day to another date moves that cluster and, if it has been published, tells everyone who can see it.

_Source: https://clusters.soleilpictures.com/docs/canvas/schedule · Updated 2026-08-16_

A schedule card is a calendar with real dates, sitting on the canvas next to
everything it refers to. Shooting days beside the location photos; a release
plan beside the assets.

Add one from the rail's **+** menu → *Create* → **Schedule**.

## Two panes

The card is a **calendar** and a **day rail**, side by side.

The calendar answers *what is the shape of this schedule* — where the work
falls, where the gaps are, which weeks are heavy. That is what a month grid is
good at, and it is all it is good at: a cell is about ninety pixels wide.

The rail answers *what is actually happening*. Every date with something on it
gets a full-width row carrying the day's name, its start time, where it is, and
whether the call sheet has been published. Today is pinned at the top with the
start time set large, because that is the line people open a schedule to read,
and **Next** sits under it.

The rail appears when the card is wide enough to keep both panes readable. On a
narrow card, a week bar, or a card zoomed far out, the calendar takes the whole
box and the peek panel does the rail's job.

**Full screen** (the ⤢ in the header) gives both panes the whole window. A
production calendar is a wall chart; on a canvas it is always negotiating for
width with everything around it.

## Views

Four zoom levels of the same schedule:

| View | Shows |
|---|---|
| **Month** | A whole month in a grid — or three, or six |
| **Week** | Seven days side by side |
| **Day** | One day, broken into hours |
| **Hour** | One hour, broken into minutes |

In month view, the **1 / 3 / 6** control sets how many months are on the card at
once. Three months is a block of principal photography; you can see the whole
shoot and drag a day from the first month to the last without paging. Asking for
more months grows the card to fit them — three readable months need the room,
and silently shrinking each one into a grid of dots would defeat the point.

Break a day down into hours, and an hour down into minutes, when a day needs
that resolution. A prep week can sit at month view while the shoot day sits at
hour view in the same board.

### Navigation is yours

Stepping through months, jumping to a date, and **Go to today** only move *your*
view. The card remembers the date it opens on, but a schedule shared with fifty
people does not jerk under everyone else when you page forward.

## Two things live on a date

**Loose content** — a note, an image, a file, a link — dropped straight into a
slot. This is the quick kind: a reminder on a Tuesday, a reference photo on the
day it is needed.

**Days** — whole clusters that carry a date. A day tile on the calendar is a
real cluster you can open, containing whatever the day needs: the script pages,
the call sheet, the shotlist, an hour-by-hour schedule. Each one carries a start
time, an end, a place and a day type. See
[Production schedules](/docs/clusters/production-schedule).

## Moving things

**Drag a day tile** onto another date. The cluster moves, and if it has been
published, everyone who can see it is notified that it moved — including what it
moved from and to. A multi-day block keeps its length.

**Loose content** moves from the peek panel, or with **Move to date** on the
slot. It stays read-only in the month grid for the reason below.

## Reading it

The month grid has no vertical rules — just a line between weeks, and space.
Dates you can act on are bright; days from the neighbouring month and weekend
dates step back. Today is a filled circle.

### Colour means phase

A day's colour is its **type** — prep, production, travel, off, wrap, milestone
— so three months of work reads as a shape rather than a wall of identical
tiles. The types are yours to rename: a film production calls the middle one
*Shoot*, a game studio calls it *Sprint* and renames *Wrap* to *Ship*. A
schedule that has never been customised uses those six defaults.

Publish state is a **mark**, not a hue: a hollow ring while a day is a draft,
the version number once it is published, and a struck-through *Cancelled* if it
is called off. Colour is spent on the question a calendar is for; once a shoot
is running every day is published, so colouring by that would say nothing.

Where a month is too narrow for a word — a three-month strip, say — a day
renders as a coloured bar instead of a truncated name. The rail beside it
carries the name at a size you can read.

## The peek panel

For loose content, the month and week grids are **read-only**. A dense calendar
grid with inline editing produced constant mis-clicks: reaching for a slot and
accidentally editing the one next to it.

Clicking a date **selects** it in the rail. Double-clicking it — or clicking the
date mark in the rail — opens the **peek**, the day broken into hours, which is
where loose content is edited.

Day tiles are the exception to read-only. They are draggable in the grid,
because moving a day to a new date is the single thing a production schedule
exists to do, and routing that through a panel would miss the point. Rows in
the rail drag the same way.

## What a schedule is for

Anything where the cells mean *time*:

- Shoot days and unit moves
- Call sheets, with the location photo attached to the hour
- Delivery and release timelines
- A prep calendar with references attached to the day they are needed

If the cells mean *position* rather than time — a storyboard, a contact sheet,
a comparison — you want a [grid](/docs/canvas/grids).
