# Production schedules

> A production schedule is one cluster holding a multi-month calendar, with each day as a child cluster that carries a date. Open a day and you get its script pages, call sheet, shot list and running order — every item with a length, so the day re-times itself when one runs long. Share the production once and every day inside it comes with it.

_Source: https://clusters.soleilpictures.com/docs/clusters/production-schedule · Updated 2026-09-01_

> **Being rebuilt.** The schedule card is temporarily off the Add menu, and with
> it the "Add days" flow that lays a production out. Productions you already
> built keep working. Publishing a day and notifying the crew is part of the
> rebuild and is not available yet — this page no longer describes it.

A production runs on two questions: *what are we shooting, and when*. This is
how Clusters answers both in one place.

## The shape

One cluster is the production. On its canvas sits a
[schedule card](/docs/canvas/schedule) set to **3 months** — a block of
principal photography you can see at once.

Each day is a **child cluster with a date**. It appears as a tile on its day in
the calendar. Open it and you are inside a normal canvas holding whatever the
day needs:

- the day's **script pages** (a PDF or a document)
- the **call sheet**
- the **shot list**
- the day's **running order** — every item with a length, so the day re-times
  itself when one runs long

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

## The running order

The part of a day that changes most during the day itself is its schedule, and
it lives in the day's own schedule card, in Day view. Each item carries a
length; start times cascade from the one above; a crew call or a meal break can
be **pinned** to a wall-clock time, and the pin holds while the report of what
overran it moves. An overnight day is fine: start at 18:00, wrap at 04:00.

Full detail is on the [schedule card](/docs/canvas/schedule) page.

## Driving it from another system

Boards carry `scheduled_date`, `scheduled_end` and `day_label` over the
[API](/docs/api/boards) and [MCP](/docs/mcp), so a scheduling package or a
call-sheet generator can create days and move them without anyone opening the
app.

## A note on timezones

Dates are plain calendar dates, with no timezone attached — a production shoots
in one place, and `2026-08-18` means the same day to everyone on it. If your
unit is split across a date line, that assumption is the one to watch.
