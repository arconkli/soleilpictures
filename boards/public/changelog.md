# Changelog

> Soleil Clusters ships continuously; this page lists every user-visible change, newest first, with the date it went live. Each entry covers one week. Fixes and additions are described in the same list rather than split apart, because the distinction rarely matters to the person reading.

_Source: https://clusters.soleilpictures.com/changelog · Feed: https://clusters.soleilpictures.com/changelog.xml_

## 2026-08-26 — Settings you can find, and a tab that says which cluster

Settings collapse from two modals into one grouped panel, every open cluster gets its own browser tab title, and the documentation is finally reachable from inside the app.

Settings used to be two separate modals, and Theme and Display — both personal
preferences — sat behind a button labelled **Workspace**. There is now one
grouped Settings panel, and the personal settings live under a heading that
describes them.

- Uploading a profile picture and then closing the panel no longer discards it.
- Every open cluster now puts **its own name** in the browser tab. Previously
  every tab said the same thing, and it was not the cluster's name.
- Two checkboxes in Settings silently ticked each other. They are independent now.
- All 64 documentation pages are reachable from inside the app. They were public
  and indexed, but nothing in the product ever linked to them.

### Canvas

- Vertical scroll pans the canvas. On an infinite surface, scrolling up and down
  past the content was close to meaningless.
- A video clip on a reference board now behaves like the GIF it replaced — it
  loops quietly instead of presenting a player.
- Which right-click menu you got in the cluster panel depended on exactly where
  you clicked. One menu now, wherever you click.

## 2026-08-23 — Screenplay mode grows up, and split panes stop fighting each other

Pagination that counts what the renderers actually draw, autocomplete that stops stealing Tab, and split panes where each side navigates itself without dragging the other along.

A long pass over screenplay documents. The short version: text you typed now
survives everything you can do to it afterwards.

### Screenplay

- Pressing Enter on an empty script line could never insert a line. It can now.
- Pagination counts what the renderers actually draw, rather than estimating
  from the source — so the page breaks you see are the page breaks you export.
- Autocomplete no longer steals Tab, no longer clobbers the line you were on,
  and closes when you dismiss it.
- Content survives paste, mode toggles, block joins and marks. Round-trips are
  honest in both directions.
- The scene rail lines up with the gutters, and Dual dialogue can no longer be
  paired blind.
- Find and replace reports what it actually did.

### Split panes and docs

- Each side of a split now navigates independently, and a docked document
  survives the trip instead of being torn down.
- A docked script used to hold the caret and leave the canvas beside it dead to
  the mouse. Both surfaces stay live.
- The split's close control moved onto the divider, where nothing else competes
  for the space.
- With two boards open, the toolbar tells you which board it means.
- Document gutters stay correct when the canvas is zoomed.

### Elsewhere

- On a shared board, the photos were the one thing you could not open. Fixed.
- The press-and-hold gesture on mobile was invisible, so most people never found
  it. It announces itself now.

## 2026-08-16 — Undo, everywhere — and a universe that does not stop at a thousand

About nineteen operations that used to be permanent now undo, version history comes back as a restore browser, and the universe view renders every board instead of the first thousand.

The theme of the week was reversibility. Deleting something in Clusters has
always shown an undo toast; a surprising number of operations quietly did not.

### Undo

- Tag operations were the most casually destructive clicks in the app. They undo
  now.
- Document structure changes and note text edits are recoverable.
- Board-level operations that run on the server get an inverse, or at minimum a
  confirmation step before they run.
- Soft-deleted items existed in the database but nothing in the interface could
  reach them. Trash and recovery are reachable.
- Undo could previously lie: split panes double-fired it, and a toast could undo
  something other than what it named.
- The sketch pad had no undo at all — and pressing it there mangled the board
  behind the pad.
- Version history is back, as a browser you restore from rather than a crutch
  for undo.

### The universe view

- Every board is now a real solar system, and the galaxy earned its own bar.
- The view showed exactly 1,000 nodes and presented that as everything. It
  renders the whole set now.
- Spiral arms emerge from the layout instead of being drawn on, so large
  workspaces look ragged the way real galaxies do.

### Production schedule

- A day is a rundown, not a column of hour buckets.
- The calendar could show you a month but not a day. It can show you a day.
- It could show you a date but never let you change it. Now it can.
- Laying out a shoot was documented but not reachable from anywhere.
- In light theme the calendar drew nothing at all.
- Instead of mailing a fresh call sheet every night, the crew is told what
  changed.

### Elsewhere

- Opening a shared board on a phone landed you at 11% scale.
- The free card allowance is now tracked per account, so it can be adjusted for
  new people without moving anyone else's.

## 2026-08-09 — A public API, an MCP server, and the documentation to go with them

Clusters becomes programmable — a REST API at /api/v1 with personal access tokens, a hosted MCP server for AI agents, OAuth 2.1, webhooks, service accounts, and a public documentation site.

The largest week in the product's history, and almost all of it is surface you
can build against.

### The API

- A public REST API at `/api/v1`, authenticated with personal access tokens you
  mint in Settings. A token acts as you, under exactly the permissions your
  account already has.
- Multipart uploads for large files, bulk board operations, and resumable
  listing.
- Service accounts — a credential that belongs to the workspace rather than to a
  person.
- Webhooks that fire for app edits, bulk writes, video and file cards, and audit
  reads.
- Identifiers, custom properties, delta reads, whole-board-tree reads, and OMC
  export.
- Import: bring reference in from wherever it currently lives.
- Arrange: named layout algorithms and a coordinate system you can build with.

### MCP, for AI agents

- An MCP server, available both as an npm package and hosted at a URL you paste
  into a client. One registry serves both transports.
- OAuth 2.1, so connecting an assistant is a button rather than a copied secret,
  with a panel that shows you what is connected.
- Published to the MCP Registry as `com.soleilpictures/clusters`.

### Documentation

- A public documentation site at [/docs](/docs), generated from source so it
  cannot describe a version of the product that no longer exists.
- Every page has a raw Markdown twin — append `.md` to any documentation URL —
  plus [/llms.txt](/llms.txt) for agents that want the index.

### Canvas and images

- Dropping a folder of photos gives you a block, not a 5,200-pixel strip.
- Image cards serve the smaller rendition when the larger one is not needed.

### Soleil Scout

- Text photos from set straight onto a canvas, with no app to open. Instant
  session links, multi-card deep links, and a Settings tab that connects a phone
  to an account you already have.

## 2026-08-02 — Bend an arrow by hand

Arrows get a draggable midpoint so you can shape the curve yourself, and the just-in-time tips stay on screen long enough to act on.

A quiet week.

- Arrows have a draggable midpoint dot. The automatic routing is still the
  default; this is for the cases where you want the curve to go somewhere else.
- The just-in-time tips that teach one feature at a time were disappearing
  before you could act on them. They now stay long enough to be useful.

## 2026-07-26 — The tour gets out of the way

The upfront feature tour is replaced by tips that appear when the feature is actually in front of you, and the mobile viewer stops crashing iOS Safari on zoom.

- The tour that ran before you had done anything is gone. In its place, a tip
  appears when you are about to need the feature it describes — and only then.
- New accounts are asked what they are working on rather than walked through
  desktop mechanics they have not needed yet.
- Zooming an image in the mobile viewer could crash Safari on iOS by running the
  device out of memory. Image tiers are capped on mobile so it does not.
- Collaborative notes recover on their own from a class of corruption that
  previously required reloading, and a batch of rich-text editor errors are
  fixed.

## 2026-07-19 — Editors are free, and the schedule opens where you clicked

Collaboration stops being the thing you pay for — editors are free and capacity is what is billed — plus invite links, a photos-first mobile start, and a schedule you edit by clicking into a day.

### Collaboration is free

- Editors do not cost anything. Capacity does. Whoever owns a cluster carries
  its card and storage allowance, and everyone they invite can edit without
  needing a plan of their own.
- Invite links: send one link instead of collecting addresses, and see it when
  somebody joins.

### Mobile

- A photos-first start on phones — two steps, camera roll first, because that is
  what a phone is good for.
- Sign-in fields are 16 pixels on touch devices, which stops iOS zooming the
  page the moment you tap one. This covers iPad as well.
- Starting on a phone and continuing on a computer is a handoff the product
  knows about rather than something you improvise.
- The text-selection bubble in documents appears on any touch-capable device,
  not just narrow ones.

### Production schedule

- Clicking into a day opens a peek, and the peek is the editing surface. The
  grid itself stays read-only.
- Row types are legible at every zoom level, with honest overflow badges instead
  of clipped text.

## 2026-07-12 — The schedule becomes a calendar, and list view becomes a browser

Production schedules move onto real dates with a day-level peek, list view is rebuilt as a Cluster Browser with table and gallery modes, and grids gain full image controls.

### The schedule is a calendar now

Production schedules used to be an abstract grid. They sit on real dates.

- Create, switch and navigate months; jump to a date from the header title.
- A Day and Hour peek that zooms into one date without leaving the view.
- Drop, paste or add content directly into a slot.
- Inline breakdowns, and the ability to graft one schedule into another.
- Two-tier level-of-detail so a dense month stays readable.

### Cluster Browser

List view was rebuilt as something you can actually work in.

- Table and Gallery modes, with real previews for every card kind.
- Sort, filter and search across the cluster.
- Live presence, so you can see who else is in there.
- Drag files straight into list mode.
- A detail popout, and linked grids grouped together.

### Grids and images

- Full image controls in grid cells: fit, reposition, zoom, and the same
  non-destructive photo adjustments as anywhere else.
- A genuinely full-screen cell lightbox, with download.
- Background colour on grid cells, matching note colours.
- A pop-out cell menu, so a tiny cell can still reach every insert and split
  option.

### Elsewhere

- Custom cluster thumbnails — right-click a cluster, upload an image, crop and
  reposition it, or reset back to the automatic one.
- [/explore](/explore) gains search, sort and topic filters over the public
  catalogue.
- Right-click menus are grouped into labelled sections, consistently across all
  three of them.
- Creating a linked cluster from the right-click menu lands it where you
  clicked, instead of a fixed drop zone.
- Typing `- ` in a note stays literal, and toolbar bullets get visible markers.
- Double-click a group label to rename it in place.
- Sessions survive properly — the daily handoff used to invalidate refresh
  tokens and send everyone back to a one-time code.

