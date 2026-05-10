# Soleil Boards — Market Research & Go/No-Go Analysis

**Date:** 2026-05-10
**Scope:** Visual collaboration / creative workspace category, with focus on creative pros (agencies/studios/directors) and prosumer creatives (solo creators, students, hobbyists)
**Decision the report informs:** Should we keep building Soleil Boards, and if so, how?

---

## Executive Summary

**Verdict: Conditional Go.** Build it, but as a bootstrap-economic indie product (Obsidian/Heptabase shape), not as a VC-scale enterprise play.

Three findings drive this:

1. **The market is real but indie-shaped.** The collaborative-whiteboard category is ~$3-4B in 2026, growing 10-15% CAGR. The creative-pro / prosumer slice — where Soleil sits — is roughly $1-2B SAM. But the realistic ceiling for an indie product in this niche is **$2-5M ARR over 3-5 years**: Milanote (10 yrs in) is at ~$3.5M ARR, Heptabase (4 yrs) at ~$2.4M, Are.na (14 yrs) at ~$1-2M. Above $5M means out-executing every comparable.

2. **The category is contested but not consolidated.** No single tool owns >$10M ARR in the creative/prosumer canvas niche. Milanote leads but is widely seen as stagnant on AI, weak on mobile, and broken on search. The aggregate paid user base across the top 5 indies is under 200K. Plenty of room for a better product.

3. **Macro is mixed-leaning-tailwind, but only for the right shape of product.** Subscription fatigue, the local-first movement, the AI image-gen explosion, and a 26% YoY creator-economy growth all favor an indie creative-canvas tool. But VC for "another visual collab tool" is closed; mid-tier freelance designers (a chunk of the ICP) are being squeezed by AI; and Apple Freeform + FigJam bracket the segment from above and below.

**The honest framing:** This is a credible bootstrap business, not a venture outcome. If your goal is a profitable lifestyle business / second-brand for Soleil Pictures, the answer is yes. If your goal is a $100M+ exit, the answer is probably no — at least not without a sharp wedge (creator-economy focus, AI-triage layer, or a Cosmos-style discovery+workspace combo).

---

## 1. Market Sizing

### TAM (Total Addressable Market)

Triangulating across three category framings:

| Framing | 2026 size | Growth | Reliability |
|---|---|---|---|
| Visual collab / whiteboard software (narrow) | **$3-4B** | 10-15% CAGR (realistic) | Med — public revenues from Miro/Mural/Lucid/FigJam alone sum to ~$1-1.5B |
| Project management (broader bound, includes overlap use) | $10-11B | 13-15% CAGR | High — public-company financials triangulate well |
| Creative software (broadest) | $25-30B realistic floor | 6-9% CAGR | High — Adobe Digital Media alone is $19.2B ARR |

Bottoms-up headcount: ~30-50M creative professionals globally + 100M+ prosumer-creative-adjacent users (Notion has 100M users alone).

### SAM (Serviceable Addressable Market)

The slice that wants a Milanote-style nested-board canvas at $7-15/mo:

- **~10-20M creative individuals globally** would consider this category
- × **~$80-100/year blended ARPU** (Milanote benchmark)
- = **$1-2B SAM**

This nests inside the $3-4B whiteboard category as the "creative-flavored, non-enterprise" portion (~30-50% of the whole, since Miro/Mural/FigJam Org skew enterprise).

### SOM (Serviceable Obtainable Market) — The Number That Matters

Comparable indie outcomes:

| Product | Years | Funding | Paid users | ARR |
|---|---|---|---|---|
| Milanote | 10 | $780K seed (2017), bootstrapped since | ~35K | ~$3.5M |
| Heptabase | 4 | $1.7M YC seed | ~12K | ~$2.4M |
| Are.na | 14 | $275K crowdfunded | ~18K | ~$1-2M |
| Mymind | ~5 | $0 (self-funded) | undisclosed (small) | <$2M est. |

**Realistic SOM for Soleil over 3-5 years: $1-5M ARR / 10-50K paid users.**

This represents 0.25-0.5% of SAM — i.e., matching the current best indies. To exceed $5M, you'd need to (a) crack agency/team usage at higher ARPU, (b) cross over into PM/Notion territory, or (c) ride an AI/creator-economy wedge.

---

## 2. Competitive Landscape

### Direct competitors (creative-niche)

| Product | Position | Pricing | Funding | Scale | Key weakness |
|---|---|---|---|---|---|
| **Milanote** | Moodboard for creatives — market leader | $9.99/mo | $780K seed, bootstrapped | 35K paid, ~$3.5M ARR | Stagnant on AI; mobile is weak; 100-card free trap; broken search |
| **Heptabase** | Visual PKM for researchers | $8.99/mo (no free) | $1.7M (YC) | 12K paid, ~$2.4M ARR | Perf at scale; rough mobile; no free tier |
| **Are.na** | Anti-algorithm prosumer collections | $7/mo | $275K crowdfunded | 18K paid, 37K MAU | No canvas; no real collab; minimal UI |
| **Mymind** | AI-organized visual second brain | $4.99-12.99/mo | $0 self-funded | 1-10 employees | No collab; bad search; no import |
| **Scrintal** | Visual networked notes | ~$9.99/mo | €1M seed | small | Late on collab; mobile via browser only |
| **Kosmik** | AI moodboard + in-app browser | $7.99-11.99/mo | $3.7M seed (Creandum) | small but growing | Unproven at scale |
| **Cosmos** | Pinterest alternative for pros | ~$8/mo | $21M total (Shine, Matrix, GV) | 10M images saved/mo, Apple App of 2025 | Discovery, not workspace |
| **Pinterest** | Mass-consumer visual reference | Free (ads) | Public | 619M MAU | AI slop, ads, not presentable to clients |
| **Eagle** | Desktop DAM / image organizer | $30 one-time | Bootstrapped | 400K+ users | Desktop-only; no native sync; no collab |

### Adjacent giants (saturation pressure)

| Company | ICP overlap with creatives | Threat | Gap they leave |
|---|---|---|---|
| **Miro** | Low (enterprise) | MED | Cluttered, "PM-shaped" UX; designers actively dislike it |
| **Mural** | Very low | LOW | In organizational decline (3-4 layoff rounds, multiple CEOs) |
| **FigJam** | High (designers in Figma) | **HIGH** | Whiteboard, not moodboard; sticky-note-shaped; weak nested/library |
| **Figma** | High via FigJam | MED | Design canvas, not visual-research canvas |
| **Notion** | High (creatives use for PM) | LOW-MED | **No native canvas** — biggest structural gap in the report |
| **Apple Freeform** | High (Apple prosumers) | **HIGH** | Apple-only; no nested boards; no commercial workflow; no web clipper |
| **Canva** | High (prosumer creators) | MED | Whiteboards is afterthought; template-shaped; pros find it constraining |
| **Adobe Firefly Boards** | High (CC creatives) | MED-HIGH | AI-generation-first, not research-collection; CC lock-in |
| **tldraw** | Indirect (powers competitors) | LOW direct, MED systemic | SDK, not opinionated product — lowers moat on "having a canvas" |

### Saturation verdict

**Contested but not saturated.** Two camps bracket the segment:

- **Enterprise whiteboards** (Miro, Mural, FigJam) optimized for live workshop facilitation — bad fit for "I curate a board over weeks."
- **Free/bundled prosumer canvas** (Apple Freeform, Canva Whiteboards) sufficient for casuals but capped — Freeform is Apple-only with no commercial workflow; Canva Whiteboards is a retention SKU.

The middle — "designer-creative-pro who wants a beautiful, organized, persistent, nested visual workspace for client work" — is owned by Milanote and contested by Heptabase/Kosmik/Scrintal/Cosmos. Nobody at >$10M ARR. Demand exceeds what the incumbent satisfies (the alternatives lists keep growing in 2026).

---

## 3. Soleil Boards' Position vs. The Field

### What Soleil already has that competitors lack or under-execute

- **Nested boards as primary navigation** (Milanote has it; most giants don't — structural gap)
- **Canvas + list views per board** (Milanote separates them, most don't have list view at all)
- **Real-time collab via Yjs** (better tech than Milanote's laggy implementation)
- **Cross-board links** (Milanote weak here; this is a differentiator)
- **Inbox capture-first flow** (rare — only Mymind has whole-app version)
- **Version history** (Milanote Pro-only; most indies skip)
- **Workspace sharing** (modern, magic-link based)
- **Color palettes as first-class card** (uncommon)

### What the field has that Soleil doesn't (yet)

- **AI auto-tagging / smart organization** (Mymind, Cosmos, Kosmik)
- **PDF reader + highlight + OCR workflow** (Heptabase's killer feature; also Kosmik)
- **Built-in web browser** (Kosmik)
- **AI chat / tutor over your content** (Heptabase, Kosmik, Scrintal)
- **Mobile parity** (Heptabase closest; everyone else weak)
- **Public discovery / community feed** (Are.na, Cosmos, Pinterest)
- **One-time license option** (Eagle's anti-subscription pitch)
- **Bidirectional [[wiki-links]] in card text** (Scrintal, Heptabase)
- **Templates marketplace** (Milanote, Heptabase)

---

## 4. Customer Voice (Aggregated)

### Top 5 things users LOVE about Milanote-style tools
1. Drag-and-drop freeform canvas with no rules
2. Beautiful, calm UI ("I pay for Milanote despite Miro being free because of the UI")
3. Web clipper for inspiration capture
4. Templates that nail creative workflows (mood boards, brand work, treatments)
5. Async commenting/reactions on visual elements

### Top 5 things users HATE
1. **Performance collapse beyond ~500 cards** — universal #1 complaint across Milanote AND Heptabase
2. **Pricing model perceived as unfair** — Milanote's 100-card free trap is most-cited
3. **Mobile is "the weakest link"** — clunky companion apps; killer for capture-on-the-go
4. **Search is broken** — Milanote's recently degraded; finding old boards is slow
5. **No tags, no version history, no organization beyond breadcrumbs** — users hit a wall as their library grows

These are unforced errors that Soleil can beat without needing an AI moat.

---

## 5. Trends & Macro Environment

### Tailwinds
- **AI image-gen explosion** creates more need for triage/curation layer (designers use 3-5 models, generate 10-100x more candidates per project)
- **Subscription fatigue / SaaSpocalypse** (Feb 2026 wiped ~$300B in software market cap) — opening for differentiated business models
- **Local-first / data-portability movement** (Affinity went free, Procreate model praised, Adobe under attack) — opening for "your data, your machine"
- **Creator economy +26% YoY** ($255B → $323B) — Substack/YouTube/TikTok creators need visual planning tools and currently use Notion (too databasey) or nothing
- **Pinterest exodus** — 619M MAU is a top-of-funnel that creative-pro tools can convert; Cosmos and Are.na already benefiting

### Headwinds
- **VC for "another visual collab tool" is closed** in 2026 — bootstrap or near-bootstrap only
- **Mid-tier freelance designer market is contracting** (-17% post-ChatGPT) — that's literally part of the target persona
- **Agency software budgets being cut, not expanded** (15% of agency jobs may vanish in 2026 per Forrester)
- **AI feature parity is table-stakes** but Big Tools spend billions; if AI becomes the only differentiator, indies lose
- **Apple Freeform + FigJam are HIGH threats** at the casual and pro ends respectively

### AI angle
- **Useful**: auto-tagging dropped images, semantic search, synthesis (board → brief), reference generation, layout suggestions
- **Gimmicky**: text-to-moodboard from a prompt (commodity), AI sticky-note summaries, AI agents on canvas (enterprise only)
- **Indie advantage**: taste-curated AI tuned for specific aesthetics (vs Big Tools' generic safe AI), local/privacy-first AI, AI as research assistant crawling Are.na/Pinterest with citations

---

## 6. Funding & Exit Climate

- **Figma IPO** (July 2025): priced at $33, popped to ~$68B day 1, settled near $57B, then **lost 81% of peak by Jan 2026**. Narrative: "AI is killing Figma's pricing power." Don't expect another visual-collab IPO at hot multiples.
- **Notion**: $11B at $600M ARR via secondary tender (Dec 2025), no new primary raise since 2021. Grew into the valuation.
- **Miro**: $665M ARR, profitable, building toward IPO.
- **Mural**: $125M ARR, only 9% YoY growth, multiple layoff rounds — walking dead.
- **Canva**: aggressive 2026 acquisition spree (Cavalry, MangoAI, Simtheory, Ortto) — buying AI capability with stock/cash.
- **Realistic exit paths for Soleil**:
  - (a) Stay bootstrapped à la Obsidian/Heptabase (most likely)
  - (b) Acqui-hire by Canva/Notion/Figma/Adobe for an AI angle
  - (c) Acquisition by adjacent creative-stack player (Frame.io, Pitch, etc.)

VC for "another visual collab tool" is essentially closed. Plan accordingly.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Apple Freeform absorbs prosumer demand** | High | Compete on cross-platform, web clipper, commercial workflow, nested organization |
| **FigJam absorbs designer "quick moodboard" use case** | High | Lean into nested-boards + persistent library + workflow that survives the project |
| **Adobe Firefly Boards captures CC subscribers** | Med-High | Position as the *triage* layer, not the *generation* layer; integrate with all models |
| **Mid-tier designer market shrinks (AI displacement)** | Med | Target up-market (creative directors, agencies) AND prosumer/creator economy |
| **Cosmos crosses from discovery to workspace** | Med | First-mover on workspace-for-Cosmos-users; integrate inbound, don't compete on discovery |
| **Performance / scale issues** (universal complaint) | High | Yjs is a strong base; invest early in perf testing at 1K+ cards |
| **Mobile gap** | Med | Even a great PWA capture flow beats most competitors |
| **Pricing model fatigue** | Med | Consider a generous free tier with per-feature limits, NOT a card cap; or one-time license option |

---

## 8. Recommendation: Conditional Go

### Conditions for "go"

1. **Bootstrap economic model.** No outside capital. Target $1-3M ARR over 3-5 years, profitable at <10 employees. This is the Heptabase/Obsidian playbook — the dead-Mural/struggling-Figma playbook isn't available to indies in 2026.

2. **ICP is creative pros + prosumer creators (not enterprise teams).** Don't try to take Miro on at the workshop-facilitation use case. Don't try to take Notion on as a general PM tool. Stay in the lane: people who think visually about projects.

3. **Differentiate on craft + workflow + data-portability, not on AI feature checklists.** Big Tools will always out-spend on AI. Compete on: (a) UX quality designers actually love, (b) nested-board / cross-board library workflow, (c) clean exports / no lock-in, (d) reasonable pricing without trap-door free tiers.

4. **Pick a sharp wedge.** "Another Milanote alternative" is too generic. Pick one of these:
   - **The triage layer for AI-generated content** — drag from any AI model, auto-cluster, surface the 5 you'll use
   - **The prosumer creator workspace** — Substack/YouTube/indie creator visual planning (between Notion and Milanote)
   - **The agency studio archive** — boards as institutional memory, version-controlled, client-shareable
   - **Are.na for paid client work** — same prosumer aesthetic, with collaboration/projects/presentation features Are.na refuses to ship

5. **Beat Milanote on its known weaknesses without waiting for AI.**
   - Performance at 1K+ cards (Yjs gives you the foundation)
   - A real mobile capture experience (PWA at minimum)
   - Working search with tags
   - Free tier that doesn't card-cap

### Conditions for "no-go"

- If goal is venture-scale exit ($100M+) — wrong category
- If goal is enterprise/team market — wrong product shape
- If can't differentiate beyond "Milanote but cleaner" — skip; the niche is contested enough that "another Milanote" won't break out
- If tied to ongoing Soleil Pictures internal use only — keep building, but reframe as "internal tool we open-source eventually," not a market product

### Suggested next-step research / experiments

- **Talk to 10-15 Milanote Pro users** specifically about the 5 hated things (perf, free tier, mobile, search, tags). Validate that any of those is enough to switch.
- **Talk to 5-10 Substack/YouTube creators** about their current visual planning workflow. Is the "Milanote for creators" wedge real?
- **Pricing/positioning experiment**: ship a landing page for one of the four wedges above, run $200 of ads, measure conversion.
- **Cosmos integration probe**: build a one-way "drag from Cosmos to Soleil board" import. If usage is high, that's the wedge.

---

## Appendix A — Comparable Company Financials

| Company | Founded | Funding | Valuation | Revenue/ARR | Users |
|---|---|---|---|---|---|
| Milanote | 2016 | $780K (one round) | ~$30-50M est. | $2.8M (2024), ~$3.5M est. (2026) | 35K paid |
| Are.na | 2011 | $275K crowdfunded | undisclosed | $343K (2021), ~$1-2M est. | 18K paid |
| Heptabase | 2021 | $1.7M (YC seed) | undisclosed | $2.4M ARR (Jan 2025) | 12K |
| Mymind | ~2020 | $0 | bootstrapped | undisclosed (small) | undisclosed |
| Scrintal | 2021 | €1M seed | undisclosed | undisclosed | small |
| Kosmik | 2018 | $3.7M (Creandum) | undisclosed | undisclosed | growing |
| Cosmos | 2021 | $21M total (Series A Jan 2026) | undisclosed | undisclosed | 10M images saved/mo |
| Eagle | n/a | Bootstrapped | n/a | undisclosed | 400K+ users |
| Mural | 2011 | ~$200M | last $2B (2021) | $125M ARR (2024, 9% growth) | enterprise |
| Miro | 2011 | $476M | $17.5B (Jan 2022) | $665M ARR (2024) | 90M+ users, 250K orgs |
| Notion | 2013 | $343M total | $11B (Dec 2025 tender) | $600M ARR | 100M users, 4M paid |
| Figma | 2012 | Public ($FIG, IPO July 2025) | ~$10-14B (Jan 2026, post -81%) | $1.06B FY25 | 13M MAU, 450K customers |
| Canva | 2013 | Multiple | $42B (Aug 2025) | $4B ARR EOY 2025 | 260M MAU, 21-29M paid |
| Adobe | public | Public | $190B+ | $19.2B Digital Media ARR | ~41M CC subs |
| Obsidian | 2020 | Self-funded | n/a | ~$25M ARR est. | 1.5M MAU |

---

## Appendix B — Pricing Reference

| Tool | Free | Paid entry | Mid | Top |
|---|---|---|---|---|
| Milanote | 100 cards lifetime | $9.99/mo (annual) | — | $49/mo flat for ~50 users |
| Are.na | 200 connections | $7/mo / $70/yr | — | Supporter (price not surfaced) |
| Heptabase | 7-day trial only | $8.99/mo (annual) | $17.99/mo Premium | $53.99/mo Premium+ |
| Mymind | 100-card trial | $4.99/mo Bookmarker | $7.99/mo Student | $12.99/mo Mastermind |
| Kosmik | Yes | $7.99/mo Mars | $11.99/mo Saturn | — |
| Cosmos | Yes | ~$8/mo Premium | — | team plan |
| Scrintal | Yes (limited) | ~$9.99/mo Pro | — | — |
| Eagle | 30-day trial | $30 one-time (lifetime) | — | — |
| Apple Freeform | Free, bundled | — | — | — |
| FigJam | 3 files free | $3/editor/mo Pro | $5/editor/mo Org | usually bundled $19 with Figma Pro |
| Miro | 3 boards free | $8/editor/mo Starter | $16/editor/mo Business | Enterprise custom |
| Notion | Yes | $10/user/mo Plus | $18/user/mo Business | Enterprise custom |
| Canva | Yes | ~$15/mo Pro | ~$10/user/mo Teams | Enterprise custom |

---

## Appendix C — Key Sources

**Market sizing**
- [Mordor Intelligence — Collaborative Whiteboard Software Market](https://www.mordorintelligence.com/industry-reports/collaborative-whiteboard-software-market)
- [Future Market Report — Visual Thinking Software](https://www.futuremarketreport.com/industry-report/visual-thinking-software-market/)
- [Sacra — Miro](https://sacra.com/c/miro/) · [Sacra — Mural](https://sacra.com/c/mural/) · [Sacra — Notion](https://sacra.com/c/notion/) · [Sacra — Canva](https://sacra.com/c/canva/)

**Comparable financials**
- [Milanote — Crunchbase](https://www.crunchbase.com/organization/milanote) · [GetLatka](https://getlatka.com/companies/milanote)
- [Heptabase — Starter Story](https://www.starterstory.com/heptabase-breakdown) · [Y Combinator](https://www.ycombinator.com/companies/heptabase)
- [Are.na — Republic crowdfunding](https://republic.com/arena) · [Wikipedia](https://en.wikipedia.org/wiki/Are.na)
- [Cosmos Series A](https://www.finsmes.com/2026/01/cosmos-raises-15m-in-series-a-funding.html)
- [Kosmik — TechCrunch](https://techcrunch.com/2023/12/21/meet-kosmik-a-visual-canvas-with-an-in-built-pdf-reader-and-a-web-browser/)
- [Notion — SaaStr at $11B](https://www.saastr.com/notion-and-growing-into-your-10b-valuation-a-masterclass-in-patience/)
- [Figma IPO — Fortune](https://fortune.com/2025/07/01/figma-ipo-s-1-after-20-billion-adobe-deal-abandoned-dylan-field/) · [Figma IPO — Yahoo Finance (post-decline)](https://finance.yahoo.com/news/adobe-failed-acquisition-figma-cost-151035766.html)

**Customer voice**
- [Capterra — Milanote reviews](https://www.capterra.com/p/165790/Milanote/reviews/)
- [Trustpilot — Milanote](https://www.trustpilot.com/review/milanote.com)
- [Kosmik — Milanote alternatives](https://www.kosmik.app/blog/milanote-alternatives)
- [Wonder Tools — Mymind review](https://wondertools.substack.com/p/mymind2)
- [Sollmannkann — Heptabase review](https://www.sollmannkann.com/project-management-and-notes/best-heptabase-review/)

**Trends / macro**
- [SaaStr — 2026 SaaS Crash](https://www.saastr.com/the-2026-saas-crash-its-not-what-you-think/)
- [Creative Bloq — Subscription fatigue 2026](https://www.creativebloq.com/art/digital-art/subscription-fatigue-is-real-and-2026-will-be-the-breaking-point-for-artists)
- [Brookings — Generative AI as job killer (freelance)](https://www.brookings.edu/articles/is-generative-ai-a-job-killer-evidence-from-the-freelance-market/)
- [Creative Pool — Forrester 2026 agency warning](https://creativepool.com/magazine/industry/the-end-of-the-agency-as-we-know-it-forresters-2026-warning-demands-a-creative-reboot.33560)
- [Fungies.io — Digital Creator Economy 2026](https://fungies.io/digital-creator-economy-market-analysis-2026-5/)
- [TechCrunch — Pinterest AI slop filter](https://techcrunch.com/2025/10/16/pinterest-adds-controls-to-let-you-limit-the-amount-of-ai-slop-in-your-feed/)
- [UX Collective — Miro vs FigJam AI](https://uxdesign.cc/miro-vs-figjam-how-their-ai-assistants-stack-up-a6ac0b9d5385)

**Reliability note:** Numbers from getlatka, fueler.io, "2026 statistics" aggregators are self-reported or recycled; treat as ±20-50%. Public-company filings (Adobe, Notion press, Figma IR), founder interviews (Heptabase via Starter Story, Are.na via Kernel), and analyst-grade sources (Sacra, Crunchbase) are the most defensible.
