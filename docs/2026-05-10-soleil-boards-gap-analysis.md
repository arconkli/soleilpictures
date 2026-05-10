# The "Open Gap" — How Much Has Soleil Boards Actually Solved?

**Date:** 2026-05-10
**Companion to:** `2026-05-10-soleil-boards-market-research.md`

The original report identified an open gap in the market:

> No indie has combined Milanote's workspace model + Heptabase's reusable cards + better real-time collab + AI organization layer.

This document audits what Soleil Boards has actually shipped against each of the four pillars, plus the "unforced errors" the report said you needed to beat Milanote on. The audit is based on reading the current codebase (51 SQL migrations, ~30,600 LoC, 80+ React components), not memory.

**TL;DR — You have already shipped 70-90% of the four-pillar gap.** The hard infra is done. What's missing is mostly capture-side workflow (web clipper, mobile, PDF) and a few synthesis features. The "unforced errors" are partially solved — tags are completely done, search is partially done, mobile is barely started, free-tier model doesn't exist yet.

The strategic implication isn't "build the gap" — it's "the gap is mostly already built, you need to ship the last 10-30% and tell people about it."

---

## Pillar 1 — Milanote's Workspace Model

**What this means:** Nested boards as the primary primitive. Beautiful, calm UI. Freeform drag-arrange canvas. Async-not-live workflow. Web clipper for capture from anywhere. Templates for fast onboarding. Public share links. Workspace sharing.

### What you have

| Feature | Status | Notes |
|---|---|---|
| Nested boards as primary | ✅ | `SidebarBoardTree.jsx`, parent_board_id model, nested via card kind 'board' |
| Canvas + list view per board | ✅ | `CanvasSurface.jsx` + `ListSurface.jsx` |
| Freeform drag-arrange | ✅ | Y.Doc-backed positions, group drag, marquee select |
| Shapes / drawing / arrows | ✅ | `ShapeCard`, `SketchPadOverlay.jsx`, free-draw arrows |
| Color palettes as cards | ✅ | First-class palette card; threads into ToolOptionsBar |
| Templates | ✅ | `templatesApi.js`, `0033_board_templates.sql`, `0048_board_templates_update.sql`, `DocTemplatePicker.jsx` |
| Public share links | ✅ | `PublicBoardView.jsx` + `0018_public_share_links.sql` |
| Workspace sharing | ✅ | `ShareModal.jsx`, granular permissions, `useBoardPermission.js` |
| Version history | ✅ | `HistoryModal.jsx`, board_versions table |
| Async commenting | ✅ | `CanvasComment.jsx`, `CommentGutter.jsx`, `CommentInlinePopover.jsx`, `useCanvasComments.js` |
| Custom fonts | ✅ | Beyond Milanote — `CustomFontsModal.jsx`, Google Fonts integration |

### What you're missing

| Feature | Status | Why it matters |
|---|---|---|
| **Web clipper browser extension** | ❌ | Milanote's #1 capture flow — "see something on the web → save to a board." Without this, you lose the capture muscle memory war. |
| **Mobile capture flow** | ❌ | Only 3 `@media` queries in `styles.css`. The "snap a photo on the go and it lands in your inbox" flow doesn't exist. |
| **Inbox** | ⚠️ | Migration 0007 is `drop_inbox_items.sql` — appears to have been removed. If capture-first workflow is part of the bet, this gap matters. |
| **System clipboard image paste** | ✅ | Already wired — paste from Figma/screenshots works |
| **Drag-from-Finder** | ✅ | Already wired — file drop uploads to R2 |

### Verdict on Pillar 1

**~85% solved.** The mechanics are there and arguably better than Milanote (real comments, version history is included not Pro-only, custom fonts, public share links, granular permissions). Two material capture gaps: **web clipper** and **mobile**. Both are well-bounded, shippable projects.

---

## Pillar 2 — Heptabase's Reusable Cards

**What this means:** The same card surfacing across multiple boards. Bidirectional links. PDF highlight + OCR workflow. The "card is the atom, boards are views" model. A card you wrote in one whiteboard appears as a reference in another, with backlinks showing every place it's used.

### What you have

| Feature | Status | Notes |
|---|---|---|
| **Entity reference system** | ✅ | `entityRef.js` defines refs to boards, cards, docs, doc positions, messages, users, URLs, tags. Stable shape across all surfaces. |
| **Bidirectional links** | ✅ | `entity_links` table, `BacklinksList.jsx`, `EntityBacklinksPanel.jsx`, `useEntityNavigate.js`. Migration 0022, 0036b, 0036c. |
| **Entity search** | ✅ | `entitySearch.js` + `entity_search` Postgres view, ILIKE-based with rank ordering (exact > prefix > contains). Migrations 0003, 0006, 0021, 0036. |
| **Entity hover popover** | ✅ | `EntityHoverPopover.jsx` with `entityPreviews/` per-kind |
| **Entity picker** | ✅ | `EntityPicker.jsx` — `@`-mention style insertion into docs, comments, messages |
| **Entity name trie** | ✅ | `entityNameTrie.js` + `useEntityNameTrie.js` — fast in-memory autocomplete |
| **Auto-detect link scanner** | ✅ | `scanForAutoLinks.js`, `recordEntityLinks.js` — detects mentions in text without manual `@` |
| **Aliases** | ✅ | `0022_entity_links_and_aliases.sql` — same entity reachable by multiple names |
| **Cross-board navigation graph** | ✅ | `HomeGraph.jsx`, `HomeGraph2DFallback.jsx`, `HomeGraphDetailDrawer.jsx`, `graphData.js`. **Roam-style relationship graph — Heptabase doesn't even have this.** |
| **Doc surface (rich text)** | ✅ | `DocSurface.jsx`, `DocPageEditor.jsx` (TipTap-based), `DocSlashMenu.jsx`, `DocOutlinePanel.jsx`, `DocPageTree.jsx`, `DocLinksPanel.jsx`, `DocRefsPanel.jsx`, `DocFindReplace.jsx`. **Notion-grade docs alongside the canvas — neither Milanote nor Heptabase has this.** |

### What you're missing

| Feature | Status | Why it matters |
|---|---|---|
| **Same card object reused across boards** | ❌ | This is the actual Heptabase model — one card row, surfaces on N whiteboards. Soleil's model is "card lives in board A, you LINK to it from board B." Different mental model. The entity system is arguably *better* for cross-doc references but it's not the same as card reuse. Decide if you care. |
| **PDF reader + highlight + OCR** | ❌ | Heptabase's killer differentiator. You only have PDF *export*, not import. This is the #1 reason researchers/students choose Heptabase over Milanote. If those segments matter, this is required. |
| **Bidirectional [[wiki-link]] syntax in card text** | ⚠️ | Entity picker exists, auto-link scanner exists, but unclear if `[[brackets]]` work as a typing convention. Minor. |

### Verdict on Pillar 2

**~70% solved.** The bidirectional reference system is genuinely best-in-class — you have things Heptabase doesn't (graph view, doc surface, hover popovers). But two real gaps: **same-card-on-multiple-boards reuse** (different model — debatable whether you need it) and **PDF workflow** (real gap if research/student segment matters).

---

## Pillar 3 — Better Real-Time Collab Than Milanote

**What this means:** Yjs-based CRDT for conflict-free editing. Live presence (cursors). No lag at scale. Works on slow connections. Token rotation handled. Cross-tab sync.

### What you have

| Feature | Status | Notes |
|---|---|---|
| **Yjs core** | ✅ | `yboard.js`, `yhelpers.js` — Y.Doc per board, Y.Map per card, Y.Array for arrows |
| **Real-time provider** | ✅ | `yPartyKit.js` — y-partykit over PartyKit websocket, native Yjs sync protocol |
| **Awareness / presence** | ✅ | `CanvasPresence.jsx`, `WorkspacePresenceStack.jsx`, `PresenceStack.jsx`, `presenceColor.js` |
| **JWT rotation handling** | ✅ | Worker rebuilds provider on Supabase TOKEN_REFRESHED — addresses a known gotcha that bites most ad-hoc Yjs+Supabase setups |
| **Workspace presence** (separate channel) | ✅ | `workspacePartyKit.js` — knows who's online in the workspace independent of which board they're on |
| **Doc collab** | ✅ | TipTap collab + collaboration-cursor extensions |
| **Realtime comments** | ✅ | `commentsApi.js`, comment realtime |
| **Realtime messages** | ✅ | `messages.js`, `messageRealtime.js` |
| **Undo/redo with origin tagging** | ✅ | `Y.UndoManager` only tracks 'local' origin — snapshot loads and remote applies don't pollute the undo stack |
| **Snapshot-based persistence** | ✅ | `ySupabase.js` — debounced snapshot writer with origin tagging |

### What you're missing

| Feature | Status | Why it matters |
|---|---|---|
| **Offline-first / local-first sync** | ⚠️ | `LocalBoardsApp.jsx` exists but it's a QA mode (`?local=1`), NOT a true offline-first story. Yjs is *capable* of this (IndexedDB persistence + on-reconnect sync) — you just haven't wired it. The "local-first" macro narrative could be ridden harder. |

### Verdict on Pillar 3

**~95% solved. This is genuinely a moat.** Real Yjs + PartyKit + handled JWT rotation + dual presence channels (workspace + board) is materially better infrastructure than what Milanote ships. Almost nothing to do here unless you want to lean into the offline-first narrative.

---

## Pillar 4 — AI Organization Layer

**What this means:** Auto-tag dropped content. Semantic search across cards. Smart clustering of similar items. AI synthesis ("turn this messy board into a brief"). Discovery of emergent themes.

### What you have

| Feature | Status | Notes |
|---|---|---|
| **Two-tier autotag engine** | ✅ | Local TF-IDF (`autotagEngine.js` + `autotagWorker.js` as Web Worker, off main thread) AND cloud embeddings (`worker-tags.js` as Cloudflare Worker) |
| **OpenAI integration** | ✅ | text-embedding-3-small for embeddings, gpt-4o-mini for verdicts and cluster naming. Wired through a CF Worker that validates Supabase JWTs. |
| **pgvector storage** | ✅ | `card_embeddings` table, dim 1536, HNSW indexes for fast cosine similarity. Migration 0042. |
| **Tag centroids + drift detection** | ✅ | `tag_centroids` table tracks the mean embedding for each tag and re-validates when drift exceeds threshold |
| **Emergent cluster discovery** | ✅ | `pending_clusters` table — finds groups of ≥3 similar cards that don't have a tag yet, AI-names them, surfaces in Suggested Tags sidebar (`useSuggestedTags.js`) |
| **Cluster → tag promotion** | ✅ | Status flow: pending → named → promoted (user accepts) / dismissed / rejected |
| **Triggered autotag on writes** | ✅ | Postgres triggers (migrations 0044, 0045, 0046) auto-fire scoring on card insert/update, respect `autotag_ignored` |
| **Tag merge** | ✅ | `0039_merge_tags_rpc.sql` |
| **Tag UI** | ✅ | `SidebarTags.jsx`, `TagPicker.jsx`, `TagDetailView.jsx` |
| **Workspace-scoped tag corpus** | ✅ | TF-IDF learned from workspace's actual tagged cards — gets smarter per-workspace |
| **Cosine similarity math** | ✅ | `clusterMath.js` — used for both similarity scoring and meaningful-change detection |

### What you're missing

| Feature | Status | Why it matters |
|---|---|---|
| **Semantic search across cards** | ❌ | Embeddings exist; entity search is ILIKE-based not vector-based. "Find me boards about X" using vector search isn't wired. **Lowest-hanging-fruit AI feature** — you have the embeddings, just need to query against them. |
| **AI synthesis** ("turn this board into a brief / treatment") | ❌ | Heptabase ships this; users want it; you have the LLM connection already. |
| **Image embeddings** | ⚠️ | text-embedding-3-small is text-only. Image cards likely embed only by their title/caption text, not visually. For a moodboard tool this is a real limitation — "find me more like this image" isn't possible. |
| **AI-suggested cluster *visualization* on canvas** | ❌ | You detect emergent themes; do you spatially group them on the board to make the discovery visible? |
| **AI-driven inbox triage** | ⚠️ | Inbox seems to have been removed. If reintroduced, "auto-route capture to the right board" is the prosumer-creator wedge from the main report. |

### Verdict on Pillar 4

**~75% solved.** The infrastructure is *more sophisticated* than Mymind's auto-tag (which is the AI-organization market leader for visual content) — pgvector + emergent cluster naming + drift detection is a genuinely differentiated stack. What's missing is mostly **user-facing AI features that consume the existing embeddings**: semantic search, image embeddings, AI synthesis. These are weeks of work, not months.

---

## The Unforced Errors — How Are You Doing?

The original report said that beating Milanote on these doesn't require an AI moat — they're table-stakes that Milanote has neglected.

### 1. Performance at 1K+ cards

**Status: ⚠️ partially addressed; needs verification**

You have:
- Yjs + pgvector at the data layer (handles scale)
- `useHoverPrefetch.js`, `useIdlePrefetch.js`, `useBoardPreview.js`, `prefetch.js`, `prefetchKinds.js` — proactive prefetching infrastructure
- Web Worker for autotag (off main thread)
- HNSW indexes for fast similarity queries
- z-sorted card render with bring-to-front

You don't have (or it's untested):
- Proven canvas perf at 1K+ cards — need to actually test this. Render virtualization may be needed.
- Memory profiling at scale.

**Recommendation:** Generate a synthetic 2K-card board, profile it. If it's fine, this becomes marketing material. If it's not, fix it before you market against Milanote on perf.

### 2. Mobile experience

**Status: ❌ not solved**

Only 3 `@media` queries in `styles.css`. No PWA manifest visible. No mobile-specific capture flow. The "snap a photo on the go, it lands in your inbox" Milanote weakness is also a Soleil weakness right now.

**Recommendation:** Even a great PWA capture flow (camera → upload → land in inbox) beats every indie competitor's mobile story. This is a 1-2 week project that closes a market-wide gap.

### 3. Search

**Status: ⚠️ partially solved**

You have:
- Entity name trie for fast autocomplete on entity titles
- `entity_search` view with ILIKE on title + body + ranking
- Hover popover previews

You don't have:
- Full-text search with proper indexing (Postgres tsvector / GIN)
- **Semantic search using embeddings** (you have the embeddings!)
- Search across attachment content (PDF text, image OCR)

**Recommendation:** Semantic search is the easy win. You're one query away from "find me boards about X" using the embeddings you're already storing.

### 4. Free tier model

**Status: ❌ not started (no monetization at all yet)**

No pricing page, no Stripe integration visible, no plan limits. This is a feature in the "decide what business you want to run" sense, not a code gap.

**Recommendation:** When you're ready to monetize, the report's advice still stands: feature-limited free tier, NOT a card-cap. Milanote's 100-card lifetime trap is the most-complained-about thing in the category.

### 5. Tags

**Status: ✅ FULLY SOLVED**

You have a more sophisticated tag system than any competitor in the report — cloud + local engines, drift detection, emergent cluster discovery, aliases, AI naming. This is straightforwardly best-in-category.

---

## Synthesis: Where the Original Gap Stands

The report's framing was: **"the four-pillar combo is open."**

After audit, the four-pillar combo is **largely closed by Soleil itself.** Here's the honest scorecard:

| Pillar | Solved | Gap |
|---|---|---|
| 1. Milanote workspace model | 85% | Web clipper + mobile capture |
| 2. Heptabase reusable cards | 70% | PDF workflow (gap), card-reuse-vs-link model (philosophical) |
| 3. Better real-time collab | 95% | Maybe lean into local-first |
| 4. AI organization layer | 75% | Semantic search, image embeddings, AI synthesis |

**The strategic implication isn't "build the gap" — it's: the gap is mostly built, you need to ship the last 10-30% AND tell people about it.**

The remaining work falls into three buckets:

### Bucket A — Ship the visible gaps (3-6 weeks each)
1. **Web clipper Chrome extension** — closes the Milanote capture-flow gap
2. **Mobile PWA capture flow** — closes a market-wide gap nobody owns
3. **Semantic search using existing embeddings** — closes the "broken search" complaint with a single query
4. **AI synthesis: board → brief / treatment** — uses existing OpenAI wiring

### Bucket B — Decide on philosophical questions
5. **Same-card-on-multiple-boards** — the entity link system already gives you the user-visible benefit; deciding to ship a true reuse model is a big architectural change. Probably not worth it.
6. **PDF reader + highlight workflow** — only matters if you target the researcher/student segment that Heptabase owns. If you stay in creative-pro/prosumer-creative, skip.
7. **Image embeddings** — would need a vision model (CLIP, OpenAI's vision, or Cohere Embed v3 multimodal). For a moodboard tool, this is genuinely high-leverage. ~2 weeks of work.

### Bucket C — Pre-launch table-stakes
8. **Perf testing at 1K+ cards** — verify Yjs + your render path actually scales
9. **Pricing / billing wiring** (Stripe) — when ready to charge
10. **Onboarding / templates marketing** — Milanote leans hard on creative-workflow templates; you have the system, surface it

---

## What This Changes About the Go/No-Go

The main report said "conditional go" with the condition that you build a sharp wedge and beat Milanote on unforced errors.

**Updated read:** You're materially closer to "ready to launch" than the surface-level reading suggests. The four-pillar moat — which I claimed nobody had built — you've quietly already built. The real question isn't "is the market open" but "are you ready to compete on the marketing/distribution side?" Because the product side is mostly there.

The four wedges from the original report, re-evaluated against current product state:

| Wedge | How well does current Soleil serve it? | Gap to close |
|---|---|---|
| **AI triage layer for AI-generated content** | Strong fit — embeddings + clusters already classify | Image embeddings + an "AI gallery" import flow |
| **Prosumer creator workspace** (Substack/YT/indie) | Good fit — docs + canvas + tags + nested = the workflow they need | Templates for creator workflows, public share polish |
| **Agency studio archive** | Strong fit — version history + entity links + workspace sharing exist | Client review mode (read-only with comment), better exports |
| **Are.na for paid client work** | Medium fit — public share exists, aesthetic UX is subjective | Better aesthetic polish, taste-driven default styling |

**My read:** Wedges 1 (AI triage) and 3 (agency archive) are the strongest current fits given what's shipped. Wedge 2 (creator workspace) is strong but needs ICP-specific marketing. Wedge 4 (Are.na for paid work) is mostly a positioning play, not a build.

**Bottom line on the gap:** Mostly closed. The work to fully close it is well-defined and small relative to what's already shipped. The real risk is no longer "can we build it" — it's "will anyone notice."
