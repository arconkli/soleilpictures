# Changelog

> Soleil Clusters ships continuously; this page lists every user-visible change, newest first, with the date it went live. Each entry covers one week. Fixes and additions are described in the same list rather than split apart, because the distinction rarely matters to the person reading.

_Source: https://clusters.soleilpictures.com/changelog · Feed: https://clusters.soleilpictures.com/changelog.xml_

## 2026-10-04 — Folders become clusters, files keep their names, and search reads documents

A dropped folder arrives as nested clusters, images keep their file names, web images are kept as copies, search reads inside documents, and Home lists your projects.

This release brings several weeks of work to the live site at once. Most of it
is about getting material in without losing anything on the way: a folder keeps
its shape, a file keeps its name, and an image dragged in from the web stops
depending on the page it came from.

### Folders, file names and web images

- Drag a folder from your desktop onto a canvas and it becomes a cluster named
  after it, each folder inside it a nested cluster in the same shape, and every
  file a card in the cluster it was in. **Add → Folder…** does the same from a
  picker, on a desktop browser. See
  [dropping a folder](/docs/clusters#dropping-a-folder).
- It runs with a progress bar and a **Cancel** that keeps what has landed, and
  its Undo takes every cluster it made to Trash. One drop reads up to
  500 files and makes up to 60
  clusters; folders nested deeper than 6 levels merge into
  the deepest cluster rather than being left out. On the free plan a folder is
  counted before anything uploads — a card per file, one per cluster — and
  **Add what fits** brings files in, in order, up to what fits, without ever
  making an empty cluster.
- Images and videos uploaded from now on keep the names their files had.
  `diner_ext_dusk_04.jpg` stays that in list view and comes back out of Download
  under it, rather than as `download.jpg`. Audio, PDFs and attachments always
  kept theirs.
- An image dragged in from another tab is kept as a copy in your workspace,
  counted against the cluster owner's storage like any upload. It shows at once
  from the page, then switches to the copy, so it no longer breaks when that
  page moves, its link expires or the picture goes behind a login. Web images
  placed before this are copied a few at a time when someone who can edit the
  cluster opens it. Past 25 MB, behind a login, or in a
  format not every browser can show, an image stays a link, as before.
- A `.fountain` or `.fdx` file dropped or pasted in becomes a new script
  document, title page included, on every plan. It used to be treated as a plain
  file, which the free plan refused. An unfinished download (`.crdownload`,
  `.part`) is skipped with a note to drop it again once it has finished, and on
  the free plan a PureRef `.pur` file gets a plain answer instead of an upgrade
  offer.

### Search reads documents

- `⌘K` searches the words inside documents, not only their titles. A match shows
  the line it came from under **Inside docs** and opens the document at that
  page. A document written before this is indexed the next time it, or anything
  in its cluster, is edited.
- It also finds an image or video by the name its file was uploaded with — a
  photo nobody captioned turns up as `diner_ext_dusk_04.jpg` — in the palette
  and in list view's search across clusters.
- A search with brackets in it, such as `Act II (rev)`, finds the words instead
  of failing and showing nothing.

### Projects and Home

- **New project** — on Home, from the **+** beside Clusters in the sidebar, or
  `⌘K` → New project — makes a cluster at the top of your workspace, beside
  Studio, and opens it. Before, every way of making a cluster put it inside
  whichever one was open, unnamed and unopened. The canvas tool and right-click
  still add one inside the current cluster.
- **Home** shows your projects: **Jump back in** with the clusters you were last
  in, then Studio and every project, newest work first, on a panel over the
  workspace graph. **Explore universe** puts the panel away. On a phone or a
  touch tablet, Home is the panel alone.
- The sidebar opens on your projects, most recently worked on first, and **All
  clusters** at the bottom of its list opens the cluster you pick. It used to
  drop a link card onto the canvas, which on the free plan cost a card.
- Cards get **Move to cluster…** in the right-click menu, listing every cluster
  in the workspace, so material gathered on one can be filed into another
  without a drag. Its Undo puts both sides back.
- Moving cards at the card limit could lose the ones the destination would not
  take. A move now takes off the source only what landed, and a move within one
  workspace never changes your count.

### Audio, downloads and list view

- Audio cards draw a real waveform, decoded from the file as it uploads. It used
  to be an invented shape, so two copies of the same take drew two different
  ones. Older cards get theirs filled in while the cluster is open; files over
  25 MB or longer than 10 minutes show a
  flat strip and still play.
- Tempo and key are read from the filename — `SFL_120_Gmin_Loop_Piano.wav` — and
  are editable on the card, where what you type is never overwritten. Cover art
  is lifted from the file's own tag in MP3, M4A and FLAC.
- In list view, a cluster that is mostly audio swaps Type and Size for **Time**,
  **BPM**, **Key** and **Format**, all sortable, with key in circle-of-fifths
  order. A row's thumbnail plays it, `↑` `↓` and `Space` audition from the
  keyboard, and when a clip ends the next row starts on its own. On the canvas,
  `Enter` plays the selected clip and `L` loops it.
- Audio and video cards get a download button, there for anyone who can see the
  card, including a visitor on a shared link. **Download all** in list view, or
  **Download** on a selection, makes one zip of up to 500 files
  or 500 MB.
- A `.flac` or `.aiff` dropped in Safari, and an `.mp3` pasted from the
  clipboard, arrive as audio cards, which the free plan takes, instead of as
  file cards it turned away.
- A cluster set to list view opens as a list on a shared or published link too,
  with its search, sorting, playback and downloads. List view also keeps its
  header and selection bar in view while you scroll, `Shift`-click selects a
  range, and in a narrow pane its columns give way in order, the name last.

### New pages, and a treatment to start from

- Comparisons with [Eagle](/vs/eagle) and [Google Drive](/vs/google-drive):
  what each does better, and when to keep both. The list view docs gain a plain
  yes-and-no table for
  [using Clusters like a drive](/docs/clusters/list-view#can-i-use-clusters-like-google-drive).
- Five pages for production departments:
  [shared reference boards](/tools/shared-reference-board) for art teams, the
  [director's treatment](/tools/directors-treatment),
  [production design](/tools/production-design-mood-board),
  [costume design](/tools/costume-design-mood-board) and the
  [cinematography lookbook](/tools/cinematography-lookbook).
- The director's treatment page hands you a document to start from. Press its
  button and, once you are signed in, a treatment — a cover, then a page for
  each section — is added to a cluster in your own workspace and opens. Until
  you change it, it is a template: it does not count toward your cards and
  search does not list it.

### Plans and pricing

- Pressing **Get Creator** on [/pricing](/pricing) before you have an
  account now carries through sign-in: once you are in, the offer opens with the
  monthly or annual plan you picked. The choice is kept on that device for
  24 hours, and **Start free** drops it.
- An empty grid costs no cards, however many boxes it has: only filled boxes
  count, so a storyboard laid out but not yet drawn is free.
- When a Creator plan or trial ends, nothing you made is deleted. A
  card placed on Creator that had not yet been counted could be taken
  off the canvas at the next sync; now a card over the limit stays where it is,
  and new cards wait until you are back under it.
- Starting a trial no longer returns you to a page saying a payment was taken:
  it says nothing was charged, and when the first charge will be. About three
  days before it, an email gives the date and the amount, with a link to
  **Settings → Plan & billing**.
- Plans, pricing and marketing pages stop calling clusters unlimited. There is
  no separate limit on clusters, but each one sits on its parent's canvas as a
  card, and on the free plan it counts as one of your 50.
- The pricing page can be read without JavaScript, by search engines and
  assistants, and as Markdown at [/pricing.md](/pricing.md). The Milanote, Miro,
  Storyflow, Eagle and Google Drive comparisons, and the five professional
  pages, show **What it costs** on the page.

### API and MCP

- Uploads can keep a file's own name: pass `filename` to `POST /uploads` or the
  multipart complete call, and `file_name` on the card. `GET /images` returns it,
  and `GET /images/:key` sends it in `Content-Disposition`.
- On the hosted MCP server, `upload_image` takes `file_name`, and `add_cards`
  creates `audio` and `pdf` cards — two kinds the REST API always accepted but
  the tool's schema left out.
- Webhook deliveries no longer follow redirects: a `3xx` counts as a failed
  delivery, so point each webhook at its final address. The address is also
  checked again at every delivery. The importer still follows redirects, but
  every hop must pass the same public-host rule, and one that does not fails
  that item with `source_refused`.

### Elsewhere

- With your system set to reduce motion, the canvas could not pan or zoom at
  all. It can now.
- A photo whose upload never finished — the tab closed, or a phone sent the
  browser to the background — no longer spins on the board forever or counts
  toward your card limit. Once it clearly cannot finish, it is removed the next
  time someone who can edit the cluster opens it, with a note saying how many to
  add again.
- Coming back to look at a board no longer means being asked to add to it every
  visit. The add-more prompts stop after a couple of visits to the same board,
  suggestions take turns at one per visit rather than one a minute, and the tour
  no longer starts over on a new device for an account that has already built
  something.
- **Send feedback** opens on a one-tap topic, with words and a screenshot both
  optional and **OK to email me about this** unticked. Two one-time questions
  join the return question — what best describes you, and, after you close an
  upgrade offer on the free plan, what is holding you back — and each shows what
  is sent with your answer before you send it. See
  [data and privacy](/docs/account/data-and-privacy).
- Several pages described things the product does not do, and now say what it
  does. Nothing files or tags a dropped image for you: automatic tagging reads
  text, never a picture, and marks what it applies as auto for you to confirm or
  remove. A palette is built with the eyedropper, a swatch at a time, rather
  than extracted from an image. [Soleil Scout](/scout) is invite-only and not
  running yet.

## 2026-08-26 — Settings you can find, and a tab that says which cluster

Settings collapse from two modals into one grouped panel, every open cluster puts its own name in the browser tab, and the documentation is finally reachable from inside the app.

Settings used to be two separate modals, and Theme and Display — both personal
preferences — sat behind a button labelled **Workspace**. There is now one
grouped Settings panel, and the personal settings live under a heading that
describes them.

- Uploading a profile picture and then closing the panel no longer discards it.
- Two checkboxes in Settings silently ticked each other. They are independent now.
- All 64 documentation pages are reachable from inside the app, and from each
  other — every page now links to this changelog too. They were public and
  indexed the whole time, but nothing in the product ever pointed at them.

### Canvas

- Every open cluster now puts **its own name** in the browser tab. Previously
  every tab said the same thing, and it was not the cluster's name — which made
  a row of open clusters unreadable at exactly the point you had enough of them
  to need it.
- Vertical scroll pans the canvas. On an infinite surface, scrolling up and down
  past the content was close to meaningless.
- A video clip on a reference board behaves like the GIF it replaced: it loops
  quietly instead of presenting a player with controls you did not ask for.
- Which right-click menu you got in the cluster panel depended on exactly where
  in the panel you clicked. One menu now, wherever you click.

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

- Dropping a big batch of photos gives you a block, not a 5,200-pixel strip.
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

