# Production schedules

> A production schedule is one cluster holding a multi-month calendar, with each day as a child cluster carrying a date, a start time and a place. Open a day and you get its script pages, call sheet, shotlist and hour-by-hour schedule. Drag the day to a new date and everyone who can see the schedule is told it moved. Publishing a day bumps its call-sheet version and notifies the crew, which is the replacement for mailing a new attachment every night.

_Source: https://clusters.soleilpictures.com/docs/clusters/production-schedule · Updated 2026-08-16_

A production runs on two questions: *what are we shooting, and when*. This is
how Clusters answers both in one place.

## The shape

One cluster is the production. On its canvas sits a
[schedule card](/docs/canvas/schedule) set to **3 months** — a block of
principal photography you can see at once.

Each day is a **child cluster with a date**. It appears as a tile on its
day in the calendar. Open it and you are inside a normal canvas holding whatever
the day needs:

- the day's **script pages** (a PDF or a document)
- the **call sheet**
- the **shotlist**
- the day's **running order** — every item with a length, so the day re-times itself when one runs long

Share the production cluster with the crew once. Everything inside it — every
day, every call sheet — comes with it.

## Laying it out

**Add days** takes a date range, optionally skips weekends, and creates a
numbered day for each date. The days arrive empty; open one and **set up this
day** fills it with the four cards above.

They are created empty on purpose. Clusters are unlimited on every plan, but
cards are capped on the free plan, and scaffolding sixty days up front would
spend the whole allowance before anyone had opened one.

The date is never written into a day's name. `Day 12` stays `Day 12`; the date
is rendered from the calendar every time it is shown, so a day that moves twice
still reads correctly everywhere.

## What a day carries

Beyond its date, a day holds a **start time**, an **end**, a **place** and a
**type**. The start time is the one that matters most — it is the first thing
anyone opens a schedule to find — so it is set large in the rail's Today block
and shown on every row.

Changing a start time or a place on a **published** day notifies the crew
straight away, with what changed: *"Start 07:00 → 05:30"*. Renaming a day or
retyping it does not — that is housekeeping, and a call sheet that pings forty
times is a call sheet nobody opens.

An overnight day is fine: call at 18:00, wrap at 04:00. Nothing treats that as
an error.

### Day types are yours

The six types — Prep, Production, Travel, Off, Wrap, Milestone — are a starting
point, not a vocabulary. Rename them per production: a feature calls the middle
one *Shoot*; a game studio calls it *Sprint* and renames *Wrap* to *Ship*; a
photo studio uses *Scout / Shoot / Edit / Deliver*. The colour is what makes a
quarter of work legible at a glance, and which word sits on it is the
production's business.

## Moving a day

Drag its tile to another date.

That is one write. The day moves on everyone's calendar, the hour-by-hour card
inside it re-anchors itself, and — if the day was published — everyone who can
read the schedule is notified, told what it moved from and to. There is an undo
on the toast.

A multi-day block (travel, a company move) keeps its length when dragged.

## Publishing, instead of the nightly email

A day is a **draft** until someone publishes it. Drafts are silent: you
can build twelve weeks of schedule, drag days around and rewrite call sheets
without anyone hearing anything.

**Publish** bumps the day's version — v1, v2, v3 — and notifies everyone who can
read it. That is the unit a crew already works in: *"Day 12, call sheet v3"*.

State is a quiet mark rather than a colour, because colour is spent on the day's
type — see [reading the calendar](/docs/canvas/schedule).

| State | On the calendar | Who is told |
|---|---|---|
| **Draft** | Dashed outline; a hollow ring on its row | Nobody |
| **Published** | Solid, with its version on the row | Everyone who can read it, on publish, on any move, and when its start time or place changes |
| **Cancelled** | Red, struck through, still visible | Everyone, if it had been published |

A cancelled day stays on the calendar rather than disappearing. Deleting it
would leave the crew with no record of a day they had planned around.

## What the crew sees

The **Schedule** item in the sidebar carries an unread count and opens two
things:

**Updates** — what changed and when. These persist until you read them, so a
call sheet published at 21:40 is still there at 06:00.

**Your schedule** — every dated cluster you can reach, from today forward,
across every production, with the ones that changed since you last looked
marked. This is the thing to open when you want to know what you are called for.

If you are not in the app when a day is published or moved, you get an email
instead — one per change, not a nightly attachment. It is a separate switch in
**Settings → Notifications** and carries a one-click unsubscribe. If you *are*
in the app you only get the in-app notification, because a duplicate email is
how people learn to filter you.

## Driving it from another system

Boards carry `scheduled_date`, `scheduled_end` and `day_label` over the
[API](/docs/api/boards) and [MCP](/docs/mcp), so a scheduling package or a
call-sheet generator can create days and move them without anyone opening the
app. Moving a published day through the API notifies the crew exactly as
dragging it would; pass `notify: false` to move one quietly.

## A note on timezones

Dates are plain calendar dates, with no timezone attached — a production shoots
in one place, and `2026-08-18` means the same day to everyone on it. If your
unit is split across a date line, that assumption is the one to watch.
