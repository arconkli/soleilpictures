---
title: Production Schedules — Soleil Clusters
metaDescription: Run a production schedule in Soleil Clusters — a multi-month calendar shared with the crew, each shoot day its own cluster holding that day's material.
h1: Production schedules
navLabel: Production schedules
section: clusters
order: 3
updated: 2026-09-01
answer: A production schedule is one cluster holding a multi-month calendar, with each shoot day as a child cluster carrying a date. Open a day and you get its script pages, call sheet, shotlist and hour-by-hour schedule. Drag the day to a new date and it moves on everyone's calendar, with an undo on the toast. Share the production once and every day inside it comes with it.
faq:
  - q: Can I start a production schedule right now?
    a: Not at the moment. The schedule card is being rebuilt, so it is off the Add menu and new shoot days cannot be laid out. Productions you already built keep working and keep their days.
  - q: Does everyone need an account on my plan?
    a: Editors you share with are free. Capacity is charged to whoever owns the boards, not per seat. See Sharing and roles.
  - q: What happens to the hour-by-hour schedule when a day moves?
    a: It follows. The schedule card inside a shoot day reads its date from the cluster, so it re-anchors itself and there is nothing to keep in sync.
  - q: Can another system push the schedule in?
    a: Yes. Boards carry scheduled_date over the API and MCP, so a stripboard or scheduling tool can create and move days programmatically.
related:
  - /docs/canvas/schedule
  - /docs/clusters
  - /docs/collaborate/sharing
---

> **Being rebuilt.** The schedule card is temporarily off the Add menu, and with
> it the "Add shoot days" flow that lays a production out. Productions you
> already built keep working. Publishing a day and notifying the crew is part of
> the rebuild and is not available yet — this page no longer describes it.

A production runs on two questions: *what are we shooting, and when*. This is
how Clusters answers both in one place.

## The shape

One cluster is the production. On its canvas sits a
[schedule card](/docs/canvas/schedule) set to **3 months** — a block of
principal photography you can see at once.

Each shoot day is a **child cluster with a date**. It appears as a tile on its
day in the calendar. Open it and you are inside a normal canvas holding whatever
the day needs:

- the day's **script pages** (a PDF or a document)
- the **call sheet**
- the **shotlist**
- an **hour-by-hour** schedule card

Share the production cluster with the crew once. Everything inside it — every
shoot day, every call sheet — comes with it.

## Laying it out

**Add shoot days** takes a date range, optionally skips weekends, and creates a
numbered day for each date. The days arrive empty; open one and **set up this
day** fills it with the four cards above.

They are created empty on purpose. Clusters are unlimited on every plan, but
cards are capped on the free plan, and scaffolding sixty days up front would
spend the whole allowance before anyone had opened one.

The date is never written into a day's name. `Day 12` stays `Day 12`; the date
is rendered from the calendar every time it is shown, so a day that moves twice
still reads correctly everywhere.

## Moving a day

Drag its tile to another date.

That is one write. The day moves on everyone's calendar, the hour-by-hour card
inside it re-anchors itself, and there is an undo on the toast.

A multi-day block (travel, a company move) keeps its length when dragged.

## What the crew sees

The **Schedule** item in the sidebar opens **your schedule** — every dated
cluster you can reach, from today forward, across every production. This is the
thing to open when you want to know what you are called for.

## Driving it from another system

Boards carry `scheduled_date`, `scheduled_end` and `day_label` over the
[API](/docs/api/boards) and [MCP](/docs/mcp), so a scheduling package or a
call-sheet generator can create days and move them without anyone opening the
app.

## A note on timezones

Dates are plain calendar dates, with no timezone attached — a production shoots
in one place, and `2026-08-18` means the same day to everyone on it. If your
unit is split across a date line, that assumption is the one to watch.
