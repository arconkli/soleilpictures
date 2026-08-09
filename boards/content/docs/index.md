---
title: Soleil Clusters Documentation
metaDescription: Complete documentation for Soleil Clusters — the infinite canvas for film, photo and design teams. Features, guides, REST API and MCP reference.
h1: Soleil Clusters documentation
navLabel: Overview
section: start
order: 0
updated: 2026-08-08
answer: Soleil Clusters is an infinite-canvas creative workspace for film, photo, design and brand teams. You collect references, storyboards, shot lists, scripts and schedules onto shared boards called clusters, and you can read and write all of it from your own code through the REST API or an MCP server.
faq:
  - q: Is Soleil Clusters free?
    a: Yes. The free Demo plan gives you 100 cards, unlimited clusters, and unlimited collaborators. Creator removes the card limit and adds any-file-type uploads on a 100GB drive.
  - q: What is a cluster?
    a: A cluster is a board. The interface says "cluster" everywhere; the API and database call the same object a board. They are the same thing, and the two words are used interchangeably in these docs where the API is involved.
  - q: Can AI agents use Soleil Clusters?
    a: Yes. Mint a personal access token under Settings, then use the REST API at /api/v1 or the MCP server. The token acts as you, under the same permissions your account has in the app.
related:
  - /docs/getting-started
  - /docs/concepts
  - /docs/api
---

Everything Soleil Clusters does, written down. If you are looking for something
specific, the sidebar is grouped by what you are trying to do rather than by
where the button lives.

## Start here

If you have never opened Clusters, read [Getting started](/docs/getting-started) —
it walks the path from signing up to a board you would actually show someone,
in about five minutes.

If you have used it for a week and want the vocabulary straight, read
[Core concepts](/docs/concepts). It is short, and it explains the one thing that
confuses everybody: the interface says **cluster**, the API says **board**, and
they mean the same object.

## For developers and AI agents

The [REST API](/docs/api) reads and writes your boards from your own software.
Authentication is a personal access token minted in the app; it acts as you and
reaches exactly what your account can reach, under the same row-level security
the app itself runs on. There is no second permission system to keep in sync.

If you are wiring up an AI assistant, start at [MCP](/docs/mcp) instead — it is
the same API behind a set of tools an agent can call directly.

Three machine-readable entry points exist for agents:

| Resource | What it is |
|---|---|
| [`/llms.txt`](/llms.txt) | Curated index of every documentation page, with descriptions |
| [`/llms-full.txt`](/llms-full.txt) | The entire documentation corpus in one plain-text file |
| Any page + `.md` | The raw Markdown for that page — e.g. [`/docs/api.md`](/docs/api.md) |

## Guides, by what you are making

These are walkthroughs rather than reference — the whole workflow for one kind
of board, start to finish.

- [What you can make with Clusters](/use-cases) — the full index
- [Mood board maker](/tools/mood-board-maker) · [Storyboard maker](/tools/storyboard-maker) · [Shot list maker](/tools/shot-list-maker) · [Look book maker](/tools/look-book-maker)
- [Coming from another tool](/docs/migrating) — PureRef, Milanote, Miro and the rest

## How to read these docs

Every page opens with a short, self-contained answer to the question the page
exists to answer. If that paragraph is all you needed, stop there.

Facts that are also limits — card caps, file size ceilings, rate limits, prices —
are not typed into these pages by hand. They are injected at build time from the
code that enforces them, so a number here cannot drift from the number the
product actually applies.

> **Note:** Screenshots are deliberately sparse. The interface moves faster than
> screenshots can be maintained, and a stale screenshot is worse than none.
> Where a control is hard to find, the docs name the menu path instead.
