// Self-authored SEO listicle pages — "N Best X Alternatives" roundups.
//
// PURE-DATA module (no imports), same anti-cloaking discipline as seoLanding.js:
// one source of truth imported by BOTH the React page (src/pages/
// SeoListiclePage.jsx) and the Cloudflare Worker (via lib/seoListicleHtml.js),
// so the crawlable server-rendered text can never drift from what React renders.
//
// WHY THIS FORMAT EXISTS (2026-08 SERP recon): every "X alternatives" / "best X"
// SERP is dominated by vendor-authored listicles — indie SaaS domains at or
// below our authority (storyflow.so, kosmik.app, refern.app) rank freely, while
// single-competitor /vs/ pages never crack these queries. Format is the gate,
// not authority. These pages are the listicle answer: few, deep, genuinely
// hand-written (thin programmatic clones are a site-wide penalty risk).
//
// Editorial rules (load-bearing — Google + reader trust):
//   • We rank ourselves #1 "for one job", with a visible disclosure box, real
//     cons on our own entry, and honest reviews of rivals (incl. direct ones).
//   • Every pricing line carries `asOf` — prices are re-verified, not guessed.
//   • `honestAccounting` says where the incumbent still wins. Keep it true.
//   • Year lives in the TITLE, never the path — annual refreshes keep URL
//     equity (competitors with `-2026` slugs pay for that every January).
//   • updated: bump ONLY on meaningful copy change (honest dates policy).
//
// Page spec shape:
//   {
//     path:            '/best/pureref-alternatives',
//     kind:            'listicle',
//     title:           '≤60 chars, "N Best … in <YEAR> (credibility marker)"',
//     metaDescription: '≤155 chars, unique',
//     h1, subhead,
//     answerHeading:   'What is the best …?'   // h2 question over the answer
//     answer:          '40–60 word extractable direct answer: us #1 for ONE
//                       job, runner-ups named honestly — the AI-liftable block',
//     disclosure:      'Full-disclosure box text (we make Clusters, we still
//                       rank it #1 only for the one job it wins)',
//     published:       'YYYY-MM-DD', updated: 'YYYY-MM-DD',
//     thesis:          { heading, paras: [] },   // the branded framework the
//                                                // whole article argues
//     methodology:     { heading, intro, criteria: [{ name, why }] },
//     itemsHeading:    'The N best …, ranked',
//     items: [{
//       rank, name,
//       anchor:        'kebab-id',   // TOC/jump target + tableCells key
//       isUs?:         true,         // exactly ONE per page
//       bestFor:       'Best for: … one-liner',
//       verdict:       'One-sentence verdict',
//       paras:         ['2–4 body paragraphs'],
//       features:      ['4–6 key features'],
//       pricing:       { summary, asOf },        // asOf REQUIRED
//       pros:          ['×3'], cons: ['×3'],     // our entry gets REAL cons
//       rating:        8.5,          // editorial /10 — table display ONLY,
//                                    // never emitted in JSON-LD (self-serving
//                                    // review markup = manual-action risk)
//     }],
//     tableIntro?,     columns: ['Best for', 'Price', …],   // after the Tool col
//     tableCells:      { [anchor]: ['…', …] },  // one row per item, col-aligned
//     personas:        [{ who, pick, why }],    // "which fits which person"
//     honorableMentions: [{ name, note }],
//     honestAccounting:  { heading, paras: [], points: [] },
//     faq:             [{ q, a }],
//     related:         ['/vs/…', '/tools/…'],   // internal-linking spokes
//     cta:             { label, sub },
//   }

const SIGNUP = (campaign) =>
  `/?utm_source=seo&utm_medium=listicle&utm_campaign=${campaign}`;

// Studio byline (user decision 2026-08: studio-level author, no individual).
// JSON-LD renders this as an Organization, not a Person.
const AUTHOR = {
  name: 'Soleil Pictures Editorial',
  role: 'The team behind Soleil Clusters',
  bio: 'Soleil Pictures is a working film studio. Clusters is the board tool we built for our own productions — every tool in these roundups was tested on real mood boards, look books, and pre-production work, not 30-second demos. We rank our own app first only for the one job we built it to win, and we say so out loud when a rival is the better pick.',
};

const PAGES = [
  {
    "path": "/best/pureref-alternatives",
    "kind": "listicle",
    "title": "10 Best PureRef Alternatives in 2026 (Tested by a Film Studio)",
    "metaDescription": "The 10 best PureRef alternatives in 2026, tested on real film pre-production. Online, collaborative, and open-source reference boards compared honestly.",
    "h1": "The 10 Best PureRef Alternatives in 2026",
    "subhead": "PureRef is alive, excellent, and still shipping. This list is for the day your reference wall has to leave one machine.",
    "answerHeading": "What is the best PureRef alternative in 2026?",
    "answer": "For shared, team reference boards, Soleil Clusters is the best PureRef alternative in 2026 — the same drop-and-arrange feel, in the browser, shared with one link and edited in real time, free to start. BeeRef is the best open-source desktop clone, Eagle the best one-time-purchase reference library, and Milanote the best for structured client presentations.",
    "disclosure": "Soleil Clusters is our app — we are Soleil Pictures, a working film studio, and we built it for our own productions. We rank it first for exactly one job: reference boards a whole team works on together. For a private, offline wall on one machine, PureRef itself is still the better tool, and we say so plainly at the bottom of this page.",
    "published": "2026-08-04",
    "updated": "2026-08-04",
    "thesis": {
      "heading": "The Reference Wall",
      "paras": [
        "PureRef gave every artist something that used to require a studio: a private reference wall. Weightless, always on top, instantly rearrangeable, yours. Drop a hundred images on it, scale them, group them, let it float over Photoshop or Blender while you work. It costs whatever you decide it costs. It never phones home. Nothing on this list does that specific thing better; we will not pretend otherwise.",
        "The wall breaks on a specific day, and anyone who has worked a production knows it. A second artist needs to pin something to it. A client asks to see it without installing anything. The director wants it on an iPad at a location scout. You need it on the studio workstation and the laptop, and now you are emailing yourself a .pur file with a version number in the name. The wall was built to be private and local; the day it must be shared, those become the problem.",
        "So this list is not ten 'better PureRefs.' Most of these tools would lose a head-to-head on PureRef's home turf — offline speed, overlay, zero friction. They are answers to the day the wall has to be shared: with a team (Soleil Clusters), with a search engine over ten years of scraps (Eagle, refern), with a client who needs structure (Milanote), with a hundred workshop participants (Miro, FigJam), or with a slower community of taste (Are.na). Pick by which day you are having, not by feature count.",
        "One more thing a 2026 roundup owes you: a check of who is actually alive. PureRef is — four 2.1.x releases in the first half of 2026 alone. Kosmik sunset on May 31, 2026, and listicles written before the shutdown still recommend it. refern's collaborative web app shut down in September 2025. InVision closed at the end of 2024. We re-verified every product on this page against its own changelog, pricing page, or repository in August 2026. A list that still recommends the dead was not tested."
      ]
    },
    "methodology": {
      "heading": "How we tested these PureRef alternatives",
      "intro": "We are a film studio, and these are the tools we actually ran our reference workflows through between 2024 and 2026 — mood boards for pitches, look books for directors, pull lists for production designers, shot references for DPs. Real projects with deadlines and clients, not demo boards built for screenshots. Where marketing and documentation disagreed, we checked the primary source in August 2026.",
      "criteria": [
        {
          "name": "The one-link test",
          "why": "Can a producer open the board with nothing installed and no account? It is the moment PureRef workflows break, so we test it first."
        },
        {
          "name": "Real project weight",
          "why": "A working board is hundreds of high-res stills plus video, PDFs, and notes. Tools that lag, cap, or compress at that load fail mid-project."
        },
        {
          "name": "On-set reach",
          "why": "References get consulted on iPads at scouts, phones on set, laptops in grading suites. Desktop-only is a real limitation and we say so."
        },
        {
          "name": "Pricing as printed",
          "why": "We quote what each vendor's own pricing page or store showed in August 2026 — several aggregator numbers we checked were stale or flat wrong."
        },
        {
          "name": "Alive in 2026",
          "why": "We checked changelogs, release notes, and commit histories. The category lost Kosmik in May 2026; maintenance status is a feature."
        },
        {
          "name": "Respect for the image",
          "why": "Reference work is looking at pictures properly: resolution held, color untouched, arrangement free. Whiteboards that treat images as decoration lose points here."
        }
      ]
    },
    "itemsHeading": "The 10 best PureRef alternatives in 2026, ranked",
    "items": [
      {
        "rank": 1,
        "name": "Soleil Clusters",
        "anchor": "soleil-clusters",
        "isUs": true,
        "bestFor": "Shared, team reference boards that grow into pre-production",
        "verdict": "The reference wall that follows the project — in the browser, shared with one link, edited live by the whole team.",
        "paras": [
          "Clusters exists because we kept hitting the day the wall breaks. Our references lived in .pur files on individual machines, and every production meant re-exporting and re-explaining which version was current. So we built the wall as a place instead of a file: a freeform canvas in the browser with the same drop-images-and-arrange feel, where the board is the single copy everyone sees. We use it daily on our own productions — that is both the pitch and the bias.",
          "The team mechanics are the point. Live cursors and presence show who is on the board; comments pin to the exact image they are about; a client or director opens a read-only view from one link, no account, nothing to install. Free editors can collaborate, so bringing on the production designer costs nothing. Auto-tagging files dropped references to the right board, and a relationship graph connects boards across a project — mood board, look book, and shot list stay one linked body of work.",
          "A production reference wall is rarely just images, so boards hold video, audio, PDFs, links, notes, docs with a screenplay mode, color palettes, image grids, schedules, and vote cards — that last one settles 'which of these five frames' arguments without a meeting. Photo adjustments are non-destructive. Boards nest inside boards with live thumbnails, so a project reads like a map rather than a pile.",
          "It runs in the browser on desktop and mobile, including touch and iPad. The free Demo tier has no credit card and no trial clock, with a card cap sized for real projects; Creator is a flat $25 a month — not per person — for unlimited boards, 100GB of storage, and any file type. The honest trade: there is no offline desktop app and no always-on-top overlay. If you never share your wall, keep PureRef."
        ],
        "features": [
          "Real-time multiplayer canvas: live cursors, presence, pinned comments",
          "One-link sharing — viewers need no account; free editors can collaborate",
          "Auto-tagging files dropped references; relationship graph connects boards across a project",
          "Boards hold images, video, audio, PDFs, links, notes, docs (with screenplay mode), palettes, grids, schedules, and vote cards",
          "Non-destructive photo adjustments; nested boards with live thumbnails",
          "Runs in the browser on desktop and mobile (touch and iPad); published template boards can be opened live"
        ],
        "pricing": {
          "summary": "Free (Demo) — no credit card, no trial clock; Creator $25/mo flat (not per person): unlimited boards, 100GB storage, any file type",
          "asOf": "August 2026"
        },
        "pros": [
          "The one-link test is the whole design: browser-based, no install, no account for viewers",
          "Flat $25/mo Creator pricing — a full crew does not multiply the bill",
          "Built and used daily by a working film studio on its own productions"
        ],
        "cons": [
          "Browser-only: no offline desktop app and no always-on-top overlay, which is PureRef's core trick",
          "Template library is smaller than Milanote's or Canva's, and there is no integrations marketplace",
          "A young product from a small studio — fewer years on the clock than most tools here"
        ],
        "rating": 9.2
      },
      {
        "rank": 2,
        "name": "BeeRef",
        "anchor": "beeref",
        "bestFor": "A free, open-source desktop reference wall — with eyes open about maintenance",
        "verdict": "The best open-source PureRef clone, and effectively unmaintained since mid-2024 — both things are true.",
        "paras": [
          "BeeRef is the closest thing to PureRef in spirit on this list: a minimal desktop app where you move, scale, rotate, crop, and flip images on an unbounded canvas, mass-arrange them, and keep the window always on top while you paint. It is GPL-3.0 open source with no account, no watermark, and no caps — boards are local .bee files and the only limit is your disk. For a solo artist on one machine who wants the wall free, it covers the core.",
          "The file format deserves its own paragraph. A .bee file is a SQLite database with the images embedded — you can pull your pictures out with the standard sqlite3 command line. PureRef's .pur format is closed; BeeRef's is inspectable and scriptable, which matters if you archive reference packs you want to open in fifteen years. Small touches are good too: a color sampler that copies hex values, per-image opacity and grayscale, export to a flat image or SVG.",
          "Now the part most roundups skip: the last release was v0.3.3 in May 2024, the last commit June 2024, and by 2026 contributors were calling the project abandoned in its own issue tracker, with pull requests — including a sketching feature — sitting unreviewed. On macOS the builds are unsigned, Gatekeeper 'can't be opened' failures are unresolved open issues, and a 2026 report says newer macOS tightening breaks the old workaround. Free and good, but no one is at the wheel — fine for a personal wall, risky as a studio standard."
        ],
        "features": [
          "PureRef-style core: move, scale, rotate, crop, flip, and mass-arrange images on an unbounded canvas",
          "Always-on-top mode with optional title bar removal",
          "Open .bee format — a SQLite database, extractable with standard tools",
          "Color sampler copies hex values to the clipboard; per-image opacity and grayscale",
          "Scene export to a flattened image or SVG; plain-text notes",
          "Prebuilt binaries for Windows, Linux, and macOS (macOS builds unsigned); installable anywhere via pip (Python + PyQt6)"
        ],
        "pricing": {
          "summary": "Free and open source (GPL-3.0); no paid tiers, no accounts — donations are not even solicited",
          "asOf": "August 2026"
        },
        "pros": [
          "Completely free with zero strings: no account, no caps, no watermark, fully offline",
          "Open, inspectable file format — your boards are never hostage to the app",
          "Covers the essential PureRef workflow, including always-on-top"
        ],
        "cons": [
          "Effectively unmaintained: no release since May 2024, no commits since June 2024, PRs unreviewed",
          "macOS builds are unsigned — Gatekeeper launch failures are open, unresolved issues on modern macOS",
          "No drawing or sketching on the canvas, and notes are plain text only"
        ],
        "rating": 7.4
      },
      {
        "rank": 3,
        "name": "Eagle",
        "anchor": "eagle",
        "bestFor": "A personal reference library — tagging, color search, and a best-in-class web clipper",
        "verdict": "Not a wall but a library: the best one-time-purchase home for a large personal reference collection.",
        "paras": [
          "Eagle solves a different problem than PureRef. PureRef is a wall: today's references, arranged for today's work. Eagle is a library: every reference you have ever saved, tagged, and findable. Assets live in a local Eagle Library on your own disk — images, video, audio, even fonts — and a big collection browses instantly with no upload step and full offline access. Auto Tag applies tags to anything dropped into a folder, Smart Folders organize by name, tag, color, or format, and you can search by dominant color — a quiet gift for building a color story.",
          "The browser extension is the best capture workflow we tested: drag-to-save, batch collection of a whole page, full-page screenshots, and an Alt+Right-Click grab that works on sites that disable right-click. If your reference gathering happens mostly in a browser at midnight, Eagle removes almost all of the friction between seeing a thing and keeping it. Many artists keep Eagle even after adopting a board tool.",
          "It is actively developed — 4.0 builds shipped through 2026, and Eagle 5.0's AI search and automation features have been announced as a free upgrade for license holders, though as of August 2026 the shipping stable version is still 4.0. Pricing is refreshingly last-decade: US$34.95 once, two devices, lifetime free updates. The commonly cited $29.95 is stale; the price rose in late 2024. The limits are structural: no mobile app, no web app, and no real collaboration — multi-machine or team use means parking the library in a cloud drive and hoping two people never edit at once."
        ],
        "features": [
          "Local-first library on your own disk — fast, offline, no account required",
          "Handles images, video, audio (MP3/WAV/AAC/FLAC/M4A), fonts, and bookmarks in one browser",
          "Auto Tag folders and Smart Folders that organize by name, tag, color, or format",
          "Search assets by dominant color",
          "Browser extension: drag-to-save, batch collection, full-page screenshots, right-click-bypass grabs",
          "Eagle 5.0 (AI search, batch auto-tagging, MCP) announced as a free upgrade for license owners"
        ],
        "pricing": {
          "summary": "US$34.95 one-time for 2 devices with lifetime free updates; extra device $17.47; 30-day free trial (once per device), no perpetual free tier",
          "asOf": "August 2026"
        },
        "pros": [
          "Genuine one-time purchase with lifetime updates — and the major 5.0 release is confirmed free for owners",
          "Local-first speed and privacy at large library sizes",
          "The strongest web-capture workflow in this roundup"
        ],
        "cons": [
          "Desktop-only: no phone, tablet, or web access at all",
          "No built-in sync or collaboration — team use rides on third-party cloud drives, with conflict risk",
          "License covers 2 devices; more machines cost $17.47 each, and the trial runs once per device"
        ],
        "rating": 8.6
      },
      {
        "rank": 4,
        "name": "refern",
        "anchor": "refern",
        "bestFor": "A PureRef-style desktop app from the artist community — with real search and video",
        "verdict": "PureRef with a search engine and a library, built by artists — as long as you never need to share.",
        "paras": [
          "refern v2 is what happens when the artist community rebuilds the reference wall with 2026 expectations. It is a local-first desktop app for Windows, macOS, and Linux — no account, no cloud, works offline — that pairs an infinite moodboard canvas with a genuine reference library: plain-language search with more than a dozen typed operators, color and hex search, image-to-image visual similarity, and AI auto-tagging that runs locally on your machine. Version 1.4 added native video references with frame-by-frame scrubbing, which PureRef itself does not do. It imports existing Eagle, PureRef, or Allusion libraries in one pass, so switching is not starting over.",
          "The history matters and we will not soften it. The refern the community knew was a collaborative web app; it shut down on September 13, 2025, taking hosted content with it, though legacy purchasers get the desktop version free. The relaunch is deliberately the opposite shape: everything local, nothing dependent on a server that can go away. That is honest engineering, and the development pace since is real — three releases in June and July 2026 alone. But it is also a small operation whose previous product disappeared, and you should hold both facts at once.",
          "Pricing is a one-time $30 — advertised as a launch price rising to $35 on August 8, 2026 — covering three devices, with a 30-day trial that needs no card. The hard boundary: there is no collaboration, no share links, no web or mobile version of any kind. A team edition is a waitlist, not a product. As a private swipe file for one artist, refern is arguably the most complete tool on this list; the moment a second person needs your wall, it has nothing for you."
        ],
        "features": [
          "Local-first desktop app (Windows, macOS, Linux) — no account, no cloud, fully offline",
          "Infinite canvas plus a searchable library: plain-language queries, 14+ operators, color/hex search, visual similarity",
          "AI auto-tagging that runs locally",
          "Native video references with frame-by-frame scrubbing and looping",
          "Browser clipper saves full-resolution images from Pinterest, Instagram, Reddit, and more",
          "One-click import of existing Eagle, PureRef, and Allusion libraries"
        ],
        "pricing": {
          "summary": "One-time $30 (launch price, rising to $35 on August 8, 2026), covers 3 devices, free updates; 30-day free trial, no card; no subscription",
          "asOf": "August 2026"
        },
        "pros": [
          "One-time purchase with every feature included — rare in 2026",
          "Search, tagging, and video that go well beyond PureRef, still fully offline and private",
          "Fast, visible development cadence through mid-2026"
        ],
        "cons": [
          "Zero sharing or collaboration — no links, no web, no mobile; the team version is a waitlist",
          "The brand's collaborative web app shut down abruptly in September 2025 — platform-continuity risk is not hypothetical",
          "Old freemium pricing for the dead web app still circulates on aggregator sites, making third-party research unreliable"
        ],
        "rating": 8.1
      },
      {
        "rank": 5,
        "name": "Milanote",
        "anchor": "milanote",
        "bestFor": "Reference boards that need structure and annotation for a client",
        "verdict": "The most presentable board in the category — best when references must be explained, not just arranged.",
        "paras": [
          "Milanote is where a reference wall goes to become a presentation. Boards mix images, notes, links, video, sketches, and files on a tidy freeform surface, and the template library is the best in this roundup for film specifically — real storyboard, shot list, mood board, and creative brief templates among 40+ categories. When the job is 'walk a client through why the film looks like this,' Milanote's structure beats a raw wall of images. Filmmakers are literally the first persona on its homepage, and it shows.",
          "Platform coverage is the broadest here: web, Mac, Windows, iPhone, iPad, and Android apps, plus web clippers — all first-party, all actively maintained through 2026. Sharing is genuinely free-tier friendly: shared boards are unlimited on the free plan, boards share with edit, comment, or view roles, and content someone shares with you does not count against your own cap. Nothing else here matches that spread.",
          "The caps are the catch, and for reference work they bite early. The free plan allows 100 total cards — every note, image, and link counts — and just 10 file uploads ever, with images capped at 10MB. A single dense mood board can exhaust that. Pro is $9.99 per person per month billed annually ($12.50 monthly), and the per-person part compounds on a crew. The other hard limit: no offline mode at all — Milanote's own help center says an internet connection is required to view and edit boards — ruling out set work anywhere connectivity is bad."
        ],
        "features": [
          "Freeform boards mixing notes, images, video, links, sketches, and files",
          "40+ template categories including storyboards, shot lists, and mood boards",
          "Per-board sharing with edit / comment / view roles; unlimited shared boards on free",
          "Web clipper (Chrome/Firefox) and iOS share extension for capture",
          "Full editing on mobile — web, Mac, Windows, iPhone, iPad, and Android apps",
          "Content shared to a free user does not consume their own card cap"
        ],
        "pricing": {
          "summary": "Free: 100 cards + 10 file uploads, no time limit; Pro $9.99/person/mo billed annually ($12.50 monthly); Teams $49/mo (10 people) or $99/mo (50 people) billed annually",
          "asOf": "August 2026"
        },
        "pros": [
          "Best film-specific template library in this roundup",
          "Broadest first-party platform coverage, including real iPad and Android apps",
          "Collaboration works on the free tier, with role-based sharing"
        ],
        "cons": [
          "Free tier is tight for visual work: 100 cards total, 10 file uploads ever, 10MB image cap",
          "No offline mode — the help center states an internet connection is required",
          "Per-person pricing: a crew of five costs five subscriptions"
        ],
        "rating": 8.3
      },
      {
        "rank": 6,
        "name": "Obsidian Canvas",
        "anchor": "obsidian-canvas",
        "bestFor": "A free, local-first canvas inside your research vault — including on Linux",
        "verdict": "The best free local canvas for artists who treat reference as research, not just pictures.",
        "paras": [
          "Obsidian Canvas is the sleeper pick. The Canvas plugin ships free with Obsidian — free for commercial work too, confirmed policy since early 2025 — and gives you an infinite canvas mixing images, video, PDFs, Markdown notes, live web embeds, and nested canvases. Boards save locally as .canvas files under the open, MIT-licensed JSON Canvas spec, which any app can implement. Between the open format and the plain-text vault, this is the most future-proof board data on this list. Nothing uploads anywhere unless you opt in, which matters when the board is full of frames from an unreleased script.",
          "The reason to pick it over BeeRef or PureRef is connection. Canvas cards are backed by your actual notes — a location image links to the scout notes, which link to the scene breakdown, with backlinks and full-text search across all of it. For directors and production designers who research their way into a look, a reference wall that is part of the research is a different tool than a wall of pictures. It also runs properly on Linux, with the app updated near-weekly through July 2026.",
          "The limits are the mirror image of the strengths. There is no real-time multiplayer and no free share-a-board web link — collaboration is file-sync-level at best, and cross-device sync is a paid add-on whose entry tier caps files at 5MB, hostile to image boards. There is no web version at all, and Canvas gets minor changelog attention compared to the note core. A brilliant private canvas; a non-starter as a shared one."
        ],
        "features": [
          "Infinite canvas with images, video, PDFs, Markdown notes, live web embeds, and nested canvases",
          "Open JSON Canvas format (.canvas files, MIT-licensed spec) — genuinely portable board data",
          "Fully local and offline; no account required, nothing uploads by default",
          "Cards link into a full notes vault with backlinks and full-text search",
          "Windows, macOS, Linux, iOS, and Android apps",
          "Extensible via a large community plugin ecosystem; optional end-to-end-encrypted Sync"
        ],
        "pricing": {
          "summary": "Free, including commercial use; optional Sync add-on $4/mo (Standard) or $8/mo (Plus) billed annually; optional commercial license $50/user/yr (voluntary since Feb 2025)",
          "asOf": "August 2026"
        },
        "pros": [
          "Free without limits for commercial work, in an open file format on your own disk",
          "Reference connects to actual research — notes, PDFs, links — with backlinks and search",
          "Local-first privacy by default, ideal for confidential material"
        ],
        "cons": [
          "No real-time collaboration and no free web share link — sync is file-level and paid",
          "Entry Sync tier caps files at 5MB and storage at 1GB — image boards outgrow it immediately",
          "Canvas is a side feature of a note app: no image adjustment or color tools, no browser version"
        ],
        "rating": 8.1
      },
      {
        "rank": 7,
        "name": "Miro",
        "anchor": "miro",
        "bestFor": "Big-team whiteboarding at scale — workshops, planning, and references in one room",
        "verdict": "The heavyweight collaboration canvas: superb for workshops, merely adequate as a reference wall.",
        "paras": [
          "Miro is what enterprises mean when they say 'whiteboard,' and in 2026 it ships faster than anything else here — near-weekly changelog entries, AI agents on the canvas, 7,000+ templates, 250+ integrations. Free-plan members are unlimited — the easiest way here to get forty people into one room. If your reference work happens inside workshops — pitch development, season planning, cross-department reviews — Miro is the room.",
          "As a reference wall it is workable but not built for the job. The free tier allows 3 editable boards total with low-resolution image export only, which is a genuine ceiling for ongoing visual work. More telling: Miro's own help center maintains an article on board performance issues, and community threads report lag at a few thousand objects with heavy images — precisely the shape of a dense reference board. It will hold your references; it will not love them.",
          "Pricing is honest but annual-flavored: the page displays annual-billed rates only ($8 per member per month for Starter, $20 for Business), with month-to-month costs roughly 20% higher and never displayed. AI features are credit-metered on every tier. None of that disqualifies it for production planning with a big team — just budget per member, and keep the look book somewhere that treats images as the point."
        ],
        "features": [
          "Infinite canvas with 7,000+ templates and 250+ integrations",
          "Unlimited team members even on the free plan",
          "AI layer: canvas agents (Sidekicks), multi-step AI workflows (Flows), MCP connections to coding agents",
          "Connectors pull live data from Slack, Jira, and other tools onto the board",
          "Talktracks — recorded board walkthroughs for async review",
          "Web, Windows, macOS, iOS/iPadOS, and Android apps"
        ],
        "pricing": {
          "summary": "Free: 3 editable boards, unlimited members; Starter $8/member/mo billed yearly; Business $20/member/mo billed yearly; Enterprise custom (monthly billing runs higher and is not displayed on the pricing page)",
          "asOf": "August 2026"
        },
        "pros": [
          "Unlimited free members — the lowest-friction way to get a large group on one canvas",
          "Deepest template and integration ecosystem in the category",
          "Very actively developed, with a genuinely differentiated 2026 AI layer"
        ],
        "cons": [
          "Free tier caps at 3 editable boards with low-res image export only",
          "Documented performance degradation on large, image-heavy boards — the exact shape of a reference wall",
          "Pricing page shows annual-billed rates only; true monthly cost is higher and never displayed"
        ],
        "rating": 8
      },
      {
        "rank": 8,
        "name": "FigJam",
        "anchor": "figjam",
        "bestFor": "Design teams already paying for Figma seats",
        "verdict": "If your studio lives in Figma, the whiteboard you already own is a perfectly good reference room.",
        "paras": [
          "FigJam's pitch in 2026 is arithmetic: it is no longer sold standalone, and every paid Figma seat — including the $3/mo Collab seat — includes full FigJam. If your team already runs on Figma, the marginal cost of a shared canvas is effectively zero. The free Starter plan includes 3 FigJam boards with unlimited collaborators, and external contributors can join open sessions for 24 hours with no login at all — the best guest story on this list.",
          "The live-session tooling is genuinely strong: cursors, audio, stamps, timers, voting, and a Spotlight mode for walking a room through a board. For a distributed art department reviewing references together in real time, FigJam runs a better meeting than almost anything here — that meeting layer is the draw. Release notes show it actively maintained through mid-2026, with AI features arriving in cross-product rollouts.",
          "But it is a brainstorming whiteboard, not an image tool. Images are secondary citizens — there is no reference-grade zoom, color handling, or high-res image workflow, and the free tier's 3-board cap (with drafts shareable view-only) confines free collaboration quickly. Figma's 2026 energy also visibly flows to its other products; FigJam is maintained rather than a focus. Use the seat you already own; do not buy into Figma for this."
        ],
        "features": [
          "Included with every paid Figma seat type — Collab seats start at $3/mo",
          "24-hour guest access: external contributors join with no account",
          "Live facilitation: audio, cursors, stamps, timers, voting, Spotlight mode",
          "FigJam AI: generate templates and diagrams, auto-sort stickies, summarize boards",
          "Deep interop with Figma Design; widgets for Jira, Asana, and GitHub",
          "Web, macOS and Windows desktop apps, and a dedicated iPad app"
        ],
        "pricing": {
          "summary": "Free Starter: 3 FigJam boards, unlimited collaborators; full FigJam included with any paid Figma seat — Collab seat $3/mo (Professional) or $5/mo (Org/Enterprise); Full seat $16/mo (Professional, annual billing)",
          "asOf": "August 2026"
        },
        "pros": [
          "Effectively free for teams already on Figma — every seat includes it",
          "Best no-login guest access in the roundup (24-hour open sessions)",
          "Excellent live meeting and facilitation tools"
        ],
        "cons": [
          "3-board cap on the free team, and free drafts share view-only",
          "Images are not the point: no high-res handling or reference-board ergonomics",
          "Pricing is entangled with Figma's seat model — confusing to buy standalone"
        ],
        "rating": 7.8
      },
      {
        "rank": 9,
        "name": "Are.na",
        "anchor": "are-na",
        "bestFor": "Slow, deliberate visual research with a community of taste",
        "verdict": "Not a wall but a practice: the best place on the internet to collect ideas slowly, in public or private.",
        "paras": [
          "Are.na is the anti-Pinterest: an ad-free, member-funded network where people connect images, text, and links into 'channels' — collections that other members can follow, connect to their own, and build on. There is no algorithm shoving content at you; discovery happens by following people whose taste you trust. For long-horizon visual research — the director's channel of doorways, the designer's two-year study of a color — it produces a depth of curation that faster tools never reach.",
          "It is also that rare 2026 thing: a company that tells you exactly how it survives. Are.na is self-funded, and its own about page publishes its staffing and revenue — roughly 20,500 paying members supporting a team of six. The free tier allows 200 blocks total, forever; Premium is $7 a month or $70 a year. You are the customer, not the product, and the platform-risk calculus reflects it.",
          "What it is not: a canvas. Channels are ordered collections, not spatial walls — no arranging, resizing, or annotating images the way board work requires. In our workflow Are.na is upstream: the slow reservoir where taste accumulates, feeding the fast wall where a project gets built. Web plus an iOS app; a 200-block free ceiling arrives quickly if you collect seriously."
        ],
        "features": [
          "Channels: connectable collections of image, text, and link blocks",
          "Cross-connection between members' channels — research compounds socially",
          "Ad-free and member-funded; no engagement algorithm",
          "Public, closed, or private channels",
          "Web app plus iOS app",
          "Self-published company financials — unusually transparent platform risk"
        ],
        "pricing": {
          "summary": "Free up to 200 total blocks; Premium $7/mo or $70/yr; Supporter $120/yr",
          "asOf": "August 2026"
        },
        "pros": [
          "The best slow-curation culture anywhere — following the right people is a research method",
          "Ad-free, self-funded, and transparent about its business",
          "Free tier is permanent, not a trial"
        ],
        "cons": [
          "No spatial canvas: channels are collections, not arrangeable walls",
          "200-block free cap is small for a working visual researcher",
          "A six-person operation — sustainable by its own numbers, but small"
        ],
        "rating": 7.9
      },
      {
        "rank": 10,
        "name": "Pinterest",
        "anchor": "pinterest",
        "bestFor": "Pure discovery — finding imagery you did not know to search for",
        "verdict": "The best discovery engine and the worst reference board; use it as a mine, never as the wall.",
        "paras": [
          "Every honest reference workflow admits Pinterest is in it somewhere. The recommendation engine remains the best in the world at surfacing imagery adjacent to what you saved — pin ten Brutalist lobbies and it will find you thirty more, plus the staircases you did not think to search for. Capture friction is near zero via the browser extension and mobile share sheet, it is free at any scale, and the company is large, public, and going nowhere. As a mine for raw visual material, nothing here touches it.",
          "As a reference board, almost everything is wrong. Boards are algorithm-ordered grid feeds — you cannot spatially arrange, resize, group, or annotate images, which is the entire craft of a reference wall. There is no native export of a board — no ZIP, PDF, or image — and the official data-download is an HTML account archive that can take up to about 30 days. Pins are Pinterest-hosted re-compressions with frequent link-rot back to originals, so provenance and resolution — both load-bearing for production reference — are unreliable.",
          "The feed is also changing under you: promoted pins interleave throughout, and AI-generated content increasingly salts discovery — dangerous for period or technical reference. Our rule on productions: mine Pinterest freely, then move anything that matters to a board you control, at original resolution, with a source noted before the link rots. Treat it as weather, not architecture — useful daily, never load-bearing."
        ],
        "features": [
          "Recommendation engine that actively discovers adjacent imagery",
          "Browser extension and mobile share-sheet capture from anywhere",
          "Boards with sections; free collaborators",
          "Visual search on pins",
          "Web, iOS, and Android",
          "Free at any scale — advertising-funded, no subscription tier exists"
        ],
        "pricing": {
          "summary": "Free, ad-supported; no consumer or business subscription tier exists",
          "asOf": "August 2026"
        },
        "pros": [
          "Best-in-class discovery of imagery you did not know to look for",
          "Lowest capture friction on the web, free at any scale",
          "Zero platform risk — large public company"
        ],
        "cons": [
          "No canvas: boards are algorithm-ordered feeds you cannot arrange or annotate",
          "No native board export — the official archive is HTML and can take up to ~30 days",
          "Re-compressed images, link-rot to originals, and ads plus AI-generated content in the feed"
        ],
        "rating": 7.2
      }
    ],
    "tableIntro": "The ten alternatives at a glance. Ratings are our editorial scores from production use; prices are what each vendor's page showed in August 2026.",
    "columns": [
      "Best for",
      "Price",
      "Free option",
      "Runs in browser",
      "Rating"
    ],
    "tableCells": {
      "soleil-clusters": [
        "Shared team reference boards",
        "Free; Creator $25/mo flat",
        "Yes — no trial clock",
        "Yes",
        "9.2/10"
      ],
      "beeref": [
        "Open-source desktop wall",
        "Free (GPL-3.0)",
        "Yes — everything",
        "No",
        "7.4/10"
      ],
      "eagle": [
        "Personal reference library",
        "$34.95 one-time (2 devices)",
        "30-day trial only",
        "No",
        "8.6/10"
      ],
      "refern": [
        "Private artist library + canvas",
        "$30 one-time ($35 from Aug 8, 2026)",
        "30-day trial only",
        "No",
        "8.1/10"
      ],
      "milanote": [
        "Structured client-facing boards",
        "Free; Pro $9.99/person/mo (annual)",
        "Yes — 100 cards, 10 uploads",
        "Yes",
        "8.3/10"
      ],
      "obsidian-canvas": [
        "Local-first research canvas",
        "Free (incl. commercial use)",
        "Yes — uncapped",
        "No",
        "8.1/10"
      ],
      "miro": [
        "Big-team workshops at scale",
        "Free; Starter $8/member/mo (annual)",
        "Yes — 3 boards",
        "Yes",
        "8.0/10"
      ],
      "figjam": [
        "Teams already in Figma",
        "Free; seats from $3/mo",
        "Yes — 3 boards",
        "Yes",
        "7.8/10"
      ],
      "are-na": [
        "Slow visual research",
        "Free; Premium $7/mo or $70/yr",
        "Yes — 200 blocks",
        "Yes",
        "7.9/10"
      ],
      "pinterest": [
        "Pure discovery",
        "Free (ad-supported)",
        "Yes — everything",
        "Yes",
        "7.2/10"
      ]
    },
    "personas": [
      {
        "who": "Concept artist whose wall now has to reach the whole art department",
        "pick": "Soleil Clusters",
        "why": "The same drop-and-arrange feel, but the board is one link the whole team edits live."
      },
      {
        "who": "Solo artist on one machine with zero budget who wants open source",
        "pick": "BeeRef",
        "why": "Free, offline, open .bee format — just know nobody is maintaining it."
      },
      {
        "who": "Illustrator sitting on ten years of unsorted reference scraps",
        "pick": "Eagle",
        "why": "One-time $34.95 for tagging, color search, and the best web clipper in the category."
      },
      {
        "who": "Artist who wants PureRef-with-search and refuses the cloud",
        "pick": "refern",
        "why": "Local-first library, visual similarity search, and video references — one-time purchase."
      },
      {
        "who": "Freelance designer presenting a look to a client",
        "pick": "Milanote",
        "why": "The most presentable boards here, with real storyboard and shot-list templates."
      },
      {
        "who": "Linux-based artist who researches their way into a look",
        "pick": "Obsidian Canvas",
        "why": "A free local canvas wired into your notes, on an open file format."
      },
      {
        "who": "Producer running remote development workshops with a big group",
        "pick": "Miro",
        "why": "Unlimited free members and the deepest template and integration ecosystem."
      },
      {
        "who": "Art student building taste for the long term",
        "pick": "Are.na",
        "why": "Slow, ad-free curation with a community whose channels teach you to see."
      }
    ],
    "honorableMentions": [
      {
        "name": "Kosmik",
        "note": "Sunset on May 31, 2026, announced that April — sign-ups closed, users pointed to export. Roundups written before the shutdown still recommend it, which tells you how often such lists get re-tested."
      },
      {
        "name": "AnimRef",
        "note": "An open-source PureRef remake that, per its GitHub, adds video, GIF, and YouTube reference support. Worth a look for animators."
      },
      {
        "name": "ShotDeck",
        "note": "A subscription library of tagged HD film stills ($12.95/mo or $99.95/yr) — searchable by lens, lighting, and color. A reference source, not a reference board — we use it to fill boards, not as one."
      },
      {
        "name": "PureRef 1.x",
        "note": "The older 1.x line remains licensed free for both commercial and non-commercial use per the official FAQ. If 2.0's per-seat commercial licensing changed your math, 1.x is still a legitimate free option."
      }
    ],
    "honestAccounting": {
      "heading": "Where PureRef still wins",
      "paras": [
        "Bluntly: if you work alone on one machine, keep PureRef. Nothing above matches it as a private wall. It is fully offline. It floats always-on-top, and since 2.0 can attach to a specific application, so your references ride over Photoshop or Blender exactly where you look. Boards are single portable .pur files. It opens instantly and stays out of the way as browser tabs never will.",
        "It is also conspicuously alive. The changelog shows four 2.1.x releases in the first half of 2026 — adding drawing shapes, a snapping background grid, image batch-processing, and new UI languages — on top of 2.0's full GIF support with a frame-stepping timeline. And the pricing remains one of the most honest in software: pay-what-you-want for personal use with $15 suggested, a $49 one-time small-business license, and per-seat business pricing only beyond that. The case for the tools above was never that PureRef stopped; it is that PureRef's wall, by design, does not leave your machine.",
        "So the honest decision rule is about the day, not the tool. The day your wall must be shared, reviewed, opened on an iPad at a scout, or edited by three people — that day, a local desktop window is the wrong shape, and you pick from the list above by the kind of sharing you need. Until that day, the original is still the best at being itself."
      ],
      "points": [
        "Fully offline, with boards as portable single .pur files",
        "Always-on-top overlay that can attach to a specific application (since 2.0)",
        "Pay-what-you-want personal pricing ($15 suggested); commercial from $49 one-time",
        "Featherweight and instant in a way browser apps are not",
        "Actively developed: four 2.1.x releases in 2026, including grids, shapes, and batch processing"
      ]
    },
    "faq": [
      {
        "q": "Is there a web version of PureRef?",
        "a": "No. PureRef is a desktop app for Windows, macOS, and Linux; its official pages list no web, iPad, or Android version. If you need a reference board that opens in a browser, Soleil Clusters is built for exactly that, and Milanote and Miro also run fully in the browser."
      },
      {
        "q": "Does PureRef work on iPad?",
        "a": "No — PureRef ships desktop builds only, with no iPad, iOS, or Android app. For tablet access, Soleil Clusters runs in the browser with touch and iPad support, Milanote has first-party iPad and Android apps, and FigJam has a dedicated iPad app."
      },
      {
        "q": "Is PureRef free? How does pay-what-you-want work?",
        "a": "For personal, non-commercial use PureRef is pay-what-you-want — the checkout suggests $15 with a custom-amount field. Commercial use requires a paid license since version 2.0: Small Business is $49 one-time for up to 3 users, and Business is $10 per seat monthly ($8 billed annually). The older 1.x line remains free even commercially."
      },
      {
        "q": "Is PureRef safe?",
        "a": "Yes. It is an established desktop app distributed through its official site, actively maintained — four 2.1.x releases in the first half of 2026 — with an honest pay-what-you-want model, no account requirement, and boards stored as local files on your machine. Download it from pureref.com rather than third-party mirrors."
      },
      {
        "q": "PureRef vs Eagle — which should I get?",
        "a": "Different jobs. PureRef is a wall: today's references arranged in a floating window while you work. Eagle ($34.95 one-time) is a library: everything you have ever saved, tagged, color-searchable, captured via its excellent browser extension. Many artists run both — Eagle to store, PureRef to arrange. Neither shares or syncs to a team."
      },
      {
        "q": "PureRef vs BeeRef — is the open-source clone good enough?",
        "a": "BeeRef covers the core wall workflow — always-on-top, crop, arrange, grayscale — free under GPL-3.0, with an open SQLite-based file format. But its last release was May 2024, contributors call it abandoned, and unsigned macOS builds hit unresolved Gatekeeper failures. If open source is the requirement, yes; otherwise PureRef is the better-maintained tool."
      },
      {
        "q": "Milanote vs PureRef — which is better for mood boards?",
        "a": "PureRef is the better private wall: offline, always-on-top, instant. Milanote is the better client deliverable: structured boards with templates, annotation, and role-based sharing in the browser. Its free plan caps at 100 cards and 10 file uploads, and there is no offline mode, so it complements PureRef more than it replaces it."
      },
      {
        "q": "What is the best free PureRef alternative with no install?",
        "a": "Soleil Clusters — it runs entirely in the browser, the free Demo tier needs no credit card and has no trial clock, and a board shares with one link that viewers open without an account. BeeRef is also completely free, but it is a desktop install and effectively unmaintained since 2024."
      },
      {
        "q": "Does PureRef run on Linux?",
        "a": "Yes — PureRef ships official Linux builds (.deb, .rpm, and portable) for Ubuntu 20.04 and later, rare in this category. Among alternatives, BeeRef and refern ship Linux builds, Obsidian Canvas runs well on Linux, and browser-based tools like Soleil Clusters run in any Linux browser."
      },
      {
        "q": "What happened to Kosmik?",
        "a": "Kosmik shut down. The official site announced on April 24, 2026 that the service would sunset on May 31, 2026; sign-ups were disabled and users were pointed to data export, with subscriptions cancelled. Be wary of roundups still recommending it — they were not recently tested."
      },
      {
        "q": "What happened to refern's web app?",
        "a": "refern's collaborative web app shut down on September 13, 2025, and content hosted on it did not carry over. The product relaunched as refern v2, a local-first desktop app sold as a one-time purchase ($30, rising to $35 on August 8, 2026) with no collaboration or web version; legacy web purchasers get v2 free."
      },
      {
        "q": "What is the best PureRef alternative for teams?",
        "a": "Soleil Clusters — the only tool on this list designed as a team reference wall: real-time editing with live cursors and pinned comments, one-link sharing with no account needed for viewers, and free editors, so the crew is not a per-seat invoice. Miro and FigJam are strong for workshops, less so for image-first reference work."
      }
    ],
    "related": [
      "/vs/pureref",
      "/tools/reference-board-maker",
      "/tools/mood-board-maker",
      "/use-cases"
    ],
    "cta": {
      "label": "Try Clusters free",
      "sub": "Free to start. No credit card."
    }
  },
  {
    "path": "/best/milanote-alternatives",
    "kind": "listicle",
    "title": "12 Best Milanote Alternatives in 2026 (Ranked by a Film Studio)",
    "metaDescription": "The 12 best Milanote alternatives in 2026, ranked on real production work. Free tiers, item caps, and collaboration compared honestly — including our own app.",
    "h1": "The 12 Best Milanote Alternatives in 2026",
    "subhead": "Twelve tools, ranked by the only question that matters: what does your board have to become next?",
    "answerHeading": "What is the best Milanote alternative in 2026?",
    "answer": "Soleil Clusters is the best Milanote alternative for production teams in 2026: a free tier without the 100-card wall, flat $25/mo pricing instead of per-person seats, and real-time boards that carry a project from mood board to shot list. Miro is the runner-up for team whiteboarding, Obsidian Canvas for free offline work, Canva for polished deliverables.",
    "disclosure": "Soleil Clusters is our app. We are Soleil Pictures, a working film studio, and we built Clusters because our own pre-production kept outgrowing tools like Milanote. We rank it first for one job only — taking a production team from mood board to call sheet — and we say plainly where rivals beat us: Milanote's templates and mobile apps are better than ours, Miro's ecosystem is deeper, and Obsidian and PureRef work offline where we do not.",
    "published": "2026-08-04",
    "updated": "2026-08-04",
    "thesis": {
      "heading": "From mood board to call sheet",
      "paras": [
        "Milanote is a genuinely lovely place to collect ideas — calm, structured, pleasant to think in. But on a real project the board does not get to stay a collection. The mood board has to become a look book, the look book a shot list, the shot list a schedule, and the schedule has to survive contact with a crew, a client, and a calendar. Every tool here is judged by that arc — how far down the pipeline the board travels before you must export it and start over somewhere else.",
        "Milanote's limits show up exactly at that handoff. The free plan is a hard wall: 100 notes, images, and links in total, plus 10 file uploads, ever — a budget one scene's reference pull can spend in an afternoon. It is not a monthly allowance; it does not reset. And paid is per person, so bringing in your DP, production designer, and editor multiplies the bill. A tool for ideas that gets more expensive the moment other people show up has the economics backwards for production work.",
        "So choose by naming what your board must become. A live team workspace: a real-time canvas without item walls. A polished client deliverable: templates and export. A private research archive that works on a plane: local files and no account. And if it only ever needs to be a beautiful collection under 100 cards, you may not need an alternative at all — we say so below.",
        "One more thing most listicles on this SERP skip: we checked whether the tools still exist. Kosmik, still recommended by several rival roundups, shut down May 31, 2026. InVision shut down at the end of 2024. Products die, and a roundup that still recommends them was not tested. Everything here was verified against primary sources in August 2026."
      ]
    },
    "methodology": {
      "heading": "How we tested these Milanote alternatives",
      "intro": "We are a film studio, and this list comes from tools we have run real productions through between 2024 and 2026 — mood boards, look books, shot lists, and pre-production for actual film and photo projects, not demo boards built for screenshots. Where we have not used a tool in anger, its review says so. Every price, cap, and platform claim was verified against the vendor's own pages in August 2026, because the aggregator data in this category is reliably wrong.",
      "criteria": [
        {
          "name": "How far the board travels",
          "why": "A board that cannot become a shot list, a schedule, or a deliverable forces an export-and-rebuild at the worst moment. We rank by how much of the pipeline a tool covers."
        },
        {
          "name": "Where the wall is",
          "why": "Milanote's 100-card, 10-upload wall is why most people search this query. We report every tool's real caps from primary sources, and how hitting them mid-project feels."
        },
        {
          "name": "Team math",
          "why": "Per-person pricing punishes exactly what creative work needs: pulling more people in. We look at what a five-person production actually pays, and whether viewers need paid seats."
        },
        {
          "name": "Media handling",
          "why": "Production boards are heavy: stills, video, PDFs, audio, scripts. Tools built for sticky notes choke on them. We test with real reference volume."
        },
        {
          "name": "Will it exist next year",
          "why": "Kosmik died in May 2026, InVision at the end of 2024, refern's collaborative app in September 2025. A dead tool's boards are homework, so vendor health is a criterion."
        }
      ]
    },
    "itemsHeading": "The 12 best Milanote alternatives in 2026, ranked",
    "items": [
      {
        "rank": 1,
        "name": "Soleil Clusters",
        "anchor": "soleil-clusters",
        "isUs": true,
        "bestFor": "Production teams that need the mood board to become the shot list, the schedule, and the deliverable",
        "verdict": "The one tool on this list built so the board never has to be exported to become the next thing.",
        "paras": [
          "Clusters is what we built when our own pre-production kept splintering across four apps: a real-time multiplayer canvas in the browser whose boards hold images, video, audio, PDFs, links, notes, docs, color palettes, image grids, schedules, and vote cards, with non-destructive photo adjustments built in. The point is not the format list — it is that the mood board, storyboard, shot list, and schedule live as connected boards in one project, tied together by a relationship graph. The board becomes the next thing instead of being rebuilt as it.",
          "Against Milanote, two structural differences. First, the wall: the free Demo tier has no trial clock and a generous card cap sized for real projects, not a hard budget of 100 items that one reference pull exhausts. Second, the team math: Creator is a flat $25/mo — not per person — for unlimited boards, 100GB of storage, any file type, and Edit Mode. On Milanote, adding your DP and production designer multiplies the bill. On Clusters it does not, and free editors can collaborate.",
          "Sharing is one link. Viewers need no account — a producer opens the live board in a browser, sees cursors and presence, and comments land on the exact image they are about. Drop a folder of references and auto-tagging files them to the right board — at hour three of a pull, nobody hand-sorts. Screenplay mode lives in docs, so the script draft sits beside the imagery it describes. We use all of this daily; the features exist because a shoot demanded them.",
          "The honest limits: Clusters is browser-only — no offline mode, no always-on-top overlay over your paint tool; PureRef keeps that crown. The template library is smaller than Milanote's or Canva's, there is no integrations marketplace, and it is a young product from a small studio. If your work is solo, offline, and image-only, tools further down this list fit better. If your board has to reach a call sheet with other people involved, this is the one built for that."
        ],
        "features": [
          "Real-time multiplayer canvas with live cursors, presence, and pinned comments",
          "Boards hold images, video, audio, PDFs, links, notes, docs, palettes, grids, schedules, and vote cards",
          "Auto-tagging files dropped references; a relationship graph connects the project",
          "Screenplay mode in docs; non-destructive photo adjustments",
          "One-link sharing — viewers need no account; free editors can collaborate",
          "Nested boards with live thumbnails; published template boards open live"
        ],
        "pricing": {
          "summary": "Free (Demo); Creator $25/mo flat",
          "asOf": "August 2026"
        },
        "pros": [
          "Free tier has no trial clock and no hard 100-item wall",
          "Flat $25/mo Creator — the price does not multiply per teammate",
          "Covers the whole arc: mood board, storyboard, shot list, schedule, script"
        ],
        "cons": [
          "Browser-only — no offline mode or always-on-top overlay",
          "Template library is smaller than Milanote's or Canva's",
          "No integrations marketplace — no Jira, Slack, or Figma plugins"
        ],
        "rating": 9.2
      },
      {
        "rank": 2,
        "name": "Miro",
        "anchor": "miro",
        "bestFor": "Large-team whiteboarding, workshops, and planning at organizational scale",
        "verdict": "The deepest ecosystem in the category, and the strongest pick when the board is a meeting rather than a mood board.",
        "paras": [
          "Miro is the category heavyweight, and conspicuously alive in 2026: near-weekly changelog entries through June, MCP integrations that let coding agents push work onto the canvas, AI Sidekicks, multi-step Flows. It brings 7,000+ templates and 250+ integrations, and free allows unlimited members — the inverse of Milanote's economics, where people are what you pay for. For workshops, sprint planning, and cross-department alignment, nothing else here matches it.",
          "The catches are the free tier and the media handling. Free is three editable boards total with low-res image export only — a tighter budget than it sounds once each project wants its own canvas. Paid starts at $8/member/mo billed yearly, and the pricing page shows only annual rates; month-to-month costs more and is never displayed. AI features are credit-metered on every tier, so the headline intelligence is effectively rationed.",
          "For film work we treat Miro as the planning layer, not the visual-reference workhorse. Its own help center has a board-performance article, and community threads report lag once boards carry a few thousand objects or heavy images — exactly what a dense reference board is. Great for the production meeting; adequate for the mood board; not where we would build a look book."
        ],
        "features": [
          "Infinite canvas with 7,000+ templates and 250+ integrations",
          "Unlimited members on every plan, including free",
          "AI Sidekicks, Flows, and MCP connections for coding agents (2026)",
          "Live data connectors: Slack, Jira, Granola and others",
          "Talktracks — recorded walkthroughs of a board",
          "Web, Windows, macOS, iOS/iPadOS, and Android apps"
        ],
        "pricing": {
          "summary": "Free (3 boards); Starter $8/member/mo billed yearly; Business $20/member/mo billed yearly; Enterprise custom",
          "asOf": "August 2026"
        },
        "pros": [
          "Unlimited free members — nobody needs a seat just to participate",
          "Fast-shipping vendor with a genuinely differentiated 2026 AI layer",
          "Templates and integrations no rival matches"
        ],
        "cons": [
          "Free plan is 3 editable boards with low-res export only",
          "Documented performance degradation on large, image-heavy boards",
          "Only annual-billed rates shown; monthly costs more and is never displayed"
        ],
        "rating": 8.8
      },
      {
        "rank": 3,
        "name": "Notion",
        "anchor": "notion",
        "bestFor": "Creative work that is documents-and-databases shaped: shot lists, breakdowns, wikis, trackers",
        "verdict": "The production binder, not the mood board — and the best binder in the business.",
        "paras": [
          "Notion is here because half of what people do in Milanote — planning docs, checklists, project notes — is documents-and-databases work, and Notion does that better than any board app ever will. One data source renders as a table, kanban, timeline, calendar, or gallery — precisely the shape of a shot list that must also be a schedule. It shipped weekly through late July 2026, its agents now run background automations, and the template ecosystem includes real film templates: shot lists, production trackers, script breakdowns.",
          "What Notion is not, is a canvas. There is no freeform spatial arrangement; images sit in structured galleries and cards, and Notion itself points whiteboard needs at third-party integrations. The free tier is generous solo — unlimited blocks for one member — but collapses for teams: the moment a second member joins, a hard 1,000-block lifetime cap kicks in, and deleting blocks does not reclaim quota. Add the 5MB per-file upload limit and free is unusable for image-heavy reference work. We run breakdowns and crew wikis in Notion happily; the mood board never lived there and never will."
        ],
        "features": [
          "Docs, wikis, and databases built from the same blocks, nesting infinitely",
          "Database views: table, kanban, timeline, calendar, gallery over one data source",
          "Notion AI agents and background Workers (full AI bundled at Business tier)",
          "Notion Sites publishing, plus bundled Calendar and Mail apps",
          "Unlimited free guests on paid plans",
          "Web, macOS, Windows, iOS, and Android"
        ],
        "pricing": {
          "summary": "Free; Plus $10/member/mo billed yearly; Business $20/member/mo billed yearly (includes full Notion AI); Enterprise custom",
          "asOf": "August 2026"
        },
        "pros": [
          "Unmatched for structured production paperwork: lists, trackers, breakdowns",
          "Very generous solo free tier — unlimited blocks for one member",
          "Actively developed, with weekly releases through July 2026"
        ],
        "cons": [
          "No freeform or infinite canvas — spatial mood-board work is not possible",
          "Free workspace hard-caps at 1,000 lifetime blocks once a second member joins",
          "5MB per-file upload cap on free rules out high-res stills"
        ],
        "rating": 8.5
      },
      {
        "rank": 4,
        "name": "FigJam",
        "anchor": "figjam",
        "bestFor": "Design teams already inside Figma who want a shared thinking canvas at near-zero added cost",
        "verdict": "If your team already pays for Figma, FigJam is the free-with-everything answer; if not, it is a brainstorming board, not a reference tool.",
        "paras": [
          "FigJam's pitch in 2026 is economic: it is no longer sold standalone, and every Figma seat type includes full FigJam access — including the $3/mo Collab seat on the Professional plan ($5 on Organization and Enterprise). A studio whose designers already live in Figma gets a live whiteboard for pocket change. The multiplayer layer is best in class: live cursors, audio, stamps, Spotlight for facilitation, and 24-hour guest access so an outside contributor can join with no account at all.",
          "The free Starter plan gives a team 3 FigJam boards, with unlimited personal drafts — but drafts share view-only, so real free collaboration is confined to those three boards. And FigJam is a brainstorming whiteboard at heart: images are secondary citizens, with no reference-grade handling or color tooling. Figma's 2026 release notes show FigJam mostly riding along in cross-product AI rollouts — maintained, not a focus. We use it as intended — beat-mapping with sticky notes, diagramming shot flow, voting with a distributed crew — then the images move somewhere built for them."
        ],
        "features": [
          "Included with every Figma seat — Collab seat from $3/mo",
          "Best-in-class live collaboration: cursors, audio, chat, stamps, Spotlight",
          "24-hour guest access with no login for external contributors",
          "FigJam AI: generate templates and diagrams, auto-sort stickies, summarize",
          "Deep Figma Design interop; widgets for Jira, Asana, GitHub, voting, timers",
          "Web, macOS and Windows desktop apps, dedicated iPad app"
        ],
        "pricing": {
          "summary": "Free Starter (3 boards); bundled with Figma seats — Collab seat $3/mo (Professional) or $5/mo (Org/Enterprise); Full seat $16/mo Professional billed annually",
          "asOf": "August 2026"
        },
        "pros": [
          "Effectively free inside any org already on Figma",
          "The strongest live-meeting and facilitation feel of any canvas here",
          "Genuinely usable free tier for small collaborative work"
        ],
        "cons": [
          "3-board cap on the free team; free drafts share view-only",
          "Images are second-class — no reference-grade handling or color tools",
          "Seat-model pricing is confusing to buy outside an existing Figma org"
        ],
        "rating": 8.4
      },
      {
        "rank": 5,
        "name": "Canva Whiteboards",
        "anchor": "canva-whiteboards",
        "bestFor": "Boards that must end life as a polished, client-facing deliverable",
        "verdict": "The strongest free canvas here by raw allowance, and the best bridge from board to finished design — with a paywall exactly where production teams feel it.",
        "paras": [
          "Canva's free tier is structurally the most generous of the big platforms: unlimited designs and unlimited whiteboards with real-time collaboration and 5GB of storage, no card required. The whiteboard really is an expanding canvas per the official product page — unlike Canva's normal fixed-size pages — and the template gravity is enormous: 1.6M+ free templates and a dedicated mood-board gallery that gets a non-designer to a presentable board in minutes. When the board's final form is a pitch page or a look-book PDF, Canva closes that last mile best.",
          "Two honest cautions. First, the mood-board templates everyone loves are fixed-dimension collage pages, not the infinite whiteboard — you choose between template polish and unbounded layout. Second, the paywall sits precisely on production needs: Background Remover, premium stock (watermarked on free), brand kits beyond three colors, and Magic Resize all require Pro, whose price has climbed three times in about two years and hides behind region-loaded scripts until signup. Canva thinks in outputs, not ideas: arrange loosely and it fights you; drive toward a finished artifact and it carries you. We use it for exactly that final step."
        ],
        "features": [
          "Unlimited whiteboards with real-time collaboration on the free plan",
          "1.6M+ free templates, including a large dedicated mood-board gallery",
          "Magic Studio AI suite with a pooled monthly allowance on every tier",
          "Full pipeline to output: presentations, docs, video, print, social scheduling",
          "141M+ premium stock assets on paid tiers; Affinity bundled on every plan",
          "Web, iOS, Android, Windows and macOS apps; offline desktop mode (2026)"
        ],
        "pricing": {
          "summary": "Free; Pro $18/mo or $143.99/yr; Business $25/user/mo; Enterprise custom",
          "asOf": "August 2026"
        },
        "pros": [
          "Free plan has no board cap at all — unlimited designs and whiteboards",
          "Fastest route from mood board to client-presentable deliverable",
          "Huge, actively shipping platform (Canva AI 2.0 and offline mode in 2026)"
        ],
        "cons": [
          "Mood-board templates are fixed-size collage pages, not the infinite canvas",
          "Pro pricing has risen three times in about two years, to $18/mo",
          "Background removal, premium stock, and brand tools sit behind the paywall"
        ],
        "rating": 8.6
      },
      {
        "rank": 6,
        "name": "Obsidian Canvas",
        "anchor": "obsidian-canvas",
        "bestFor": "The open-source-format, Linux, and offline answer — private boards on your own disk",
        "verdict": "The honest pick for everyone searching 'Milanote open source', 'Milanote Linux', or 'Milanote offline' — free for commercial work, local-first, and yours forever.",
        "paras": [
          "Three of the most common Milanote escape queries — open source, Linux, offline — resolve to the same place. Obsidian's Canvas ships free with the app: an infinite canvas mixing text cards, Markdown notes, images, video, PDFs, and nested canvases, saved locally as .canvas files under the MIT-licensed JSON Canvas spec any app can implement. The app is free for personal and commercial use (the commercial license became voluntary in February 2025), runs on Windows, macOS, Linux, iOS, and Android, needs no account, and works entirely offline. For confidential material — scripts, casting, locations — nothing uploads unless you opt into paid Sync.",
          "The tradeoff is collaboration, or rather its absence. There is no real-time multiplayer editing and no free share-a-board web link; collaboration happens at file-sync level, and the entry Sync tier ($4/mo billed annually) caps at 1GB with 5MB max files — numbers that push image-heavy users to the $8/mo Plus tier. Canvas is also a side feature of a note-taking app: no image adjustments, no color tools. As a solo research binder it is superb, cross-linked to a whole vault in a format that will outlive every company on this page. As a shared production board it is the wrong tool, and does not pretend otherwise."
        ],
        "features": [
          "Infinite canvas with text, Markdown notes, images, video, PDFs, nested canvases",
          "Open JSON Canvas format (MIT spec) — board data is never hostage to the app",
          "Fully local-first and offline; no account, no tracking",
          "Boards interlink with a full note vault: backlinks and full-text search",
          "Large community-plugin ecosystem",
          "Windows, macOS, Linux, iOS, Android; optional end-to-end-encrypted Sync"
        ],
        "pricing": {
          "summary": "Free for personal and commercial use; optional commercial license $50/user/yr; Sync add-on $4-8/mo billed annually",
          "asOf": "August 2026"
        },
        "pros": [
          "Genuinely free with no caps, no account, and an open file format",
          "First-class Linux support and full offline operation",
          "Healthy vendor: frequent releases through July 2026"
        ],
        "cons": [
          "No real-time collaboration and no shareable web link for a board",
          "Entry Sync tier's 1GB / 5MB-per-file caps punish image-heavy boards",
          "Canvas is a side feature — no image adjustment or color tooling"
        ],
        "rating": 8.7
      },
      {
        "rank": 7,
        "name": "Storyflow",
        "anchor": "storyflow",
        "bestFor": "Solo creators and small teams who want an AI that actually reads the whole board",
        "verdict": "The most interesting new idea on this list, from the smallest and riskiest vendor on it — both facts matter.",
        "paras": [
          "Storyflow's thesis is that the canvas is the AI's context. The assistant reads everything on the active board, remembers the project across sessions on paid plans, and can be pointed at any element with an @-mention. One prompt can stage a complete working board — a storyboard, shot list, kanban, or mood board — as a proposal you accept or discard, and a library of 200+ 'Tactics' frameworks drops half-built structures onto the canvas. It courts filmmakers directly with AI storyboard and shot-list generators and script breakdowns, and the changelog shows near-daily shipping through late July 2026. A real product, moving fast.",
          "Now the other side. The free tier's wall is harder than Milanote's in the dimension that matters: 20 file uploads, lifetime — boards freeze at the cap. The AI allowance on Free and even on Plus ($7.99/mo annual) is an unquantified 'trial'; meaningful AI use effectively starts at Pro, $14/mo annual. And the vendor is a 2-to-10-person operation, web-only, in a category that has buried several small tools in the last two years. We would happily sketch a pitch in it; we would not make it the system of record for a production's assets. Buy the vision, budget for the risk."
        ],
        "features": [
          "Whole-board AI context with cross-session project memory on paid plans",
          "Prompt-to-board generation: storyboards, shot lists, moodboards, trackers",
          "200+ 'Tactics' creative frameworks (3 available on the free plan)",
          "AI image generation on Pro and Max, with background removal and upscaling",
          "Unlimited boards, objects, and collaborators even on free; comment-enabled share links",
          "Web only — no desktop or mobile apps"
        ],
        "pricing": {
          "summary": "Free (20 uploads total); Plus $9.99/mo ($7.99 annual); Pro $19/mo ($14 annual); Max $49/mo ($39 annual)",
          "asOf": "August 2026"
        },
        "pros": [
          "AI-reads-the-board is a genuine differentiator, not a bolted-on chat sidebar",
          "Unlimited boards and collaborators on free, with no time limit",
          "Visibly fast development: near-daily changelog entries through July 2026"
        ],
        "cons": [
          "Free plan allows only 20 file uploads, ever — boards freeze at the cap",
          "AI allowances on Free and Plus are never quantified; real AI use starts at Pro",
          "Tiny vendor (2-10 people), web-only — real longevity risk for a system of record"
        ],
        "rating": 7.8
      },
      {
        "rank": 8,
        "name": "Mural",
        "anchor": "mural",
        "bestFor": "Facilitated workshops — timers, anonymous voting, and keeping a room on task",
        "verdict": "The best meeting-runner's canvas in the category, and the least mood-board-shaped tool on this list.",
        "paras": [
          "Mural's edge is facilitation. Timer, anonymous voting, Private Mode that hides collaborators' contributions to prevent groupthink, summon, laser pointer, facilitator lock — purpose-built machinery for running a structured session, and stronger at it than Miro or FigJam. Seat economics are friendly: unlimited members on free, unlimited external guests on Business, and deep Microsoft ties for Teams-centric organizations. It ships weekly, with a redesigned Mural AI landing in July 2026.",
          "As a Milanote alternative for visual work, though, it is a stretch. The free plan caps at 3 editable murals at a time — older ones drop to view-only — and Mural AI is excluded from free entirely. The canvas is sticky-note and diagram-centric with no mood-board-grade image handling, and the connectivity that makes it sing (SSO, Jira and Azure DevOps cards, unlimited guests) is gated behind Business at $17.99/user/mo. We bring productions into Mural for kickoff workshops and retros. The reference boards live elsewhere, and Mural seems comfortable with that."
        ],
        "features": [
          "Facilitation suite: timer, anonymous voting, Private Mode, summon, facilitator lock",
          "Unlimited members on free; unlimited free external guests on Business",
          "Mural AI on paid tiers: clustering, summarizing, idea generation",
          "Deep Microsoft integration: Teams, Microsoft 365 Copilot, Azure OpenAI",
          "Interactive Jira and Azure DevOps cards on Business and Enterprise",
          "Web, Windows, macOS, iOS, and Android"
        ],
        "pricing": {
          "summary": "Free (3 murals); Team+ $9.99/user/mo billed annually ($12 monthly); Business $17.99/user/mo billed annually; Enterprise custom",
          "asOf": "August 2026"
        },
        "pros": [
          "Best-in-class workshop facilitation tools, genuinely differentiated",
          "Unlimited members on free — caps boards, not people",
          "Actively developed, with a public weekly release cadence"
        ],
        "cons": [
          "Free tier is 3 editable murals; older boards become view-only",
          "No AI on the free plan; paid 'unlimited' AI has a usage-throttle clause",
          "Sticky-note-centric canvas with no image-first features"
        ],
        "rating": 8.1
      },
      {
        "rank": 9,
        "name": "Padlet",
        "anchor": "padlet",
        "bestFor": "Lightweight collaborative boards where contributors should not need accounts",
        "verdict": "The easiest tool here for collecting input from a group, and the tightest free plan for doing anything ambitious with it.",
        "paras": [
          "Padlet's superpower is frictionlessness: anyone can post to a shared board without an account, on any plan, with no limit on contributors. Nine board formats — including a Freeform canvas for scatter-and-group arrangement — plus a bundled whiteboard called Sandbox make it a surprisingly capable quick-collect tool. It is very much alive, with multiple substantial releases in 2026, and its education stack is the deepest anywhere. For a classroom, a workshop intake, or a cast-and-crew photo drop, it just works.",
          "The free plan is among the tightest in this roundup: 3 padlets total and 20MB per upload, which chokes any high-resolution reference use. The individual paid tier has quietly climbed — the old $6.99 Gold plan is gone and Platinum now runs $15/mo — so the cheap prices in older listicles are stale. Everything about the roadmap says classrooms, not productions. Use it for what it is — the fastest way to collect contributions from people who will never make an account — and keep the look book somewhere with more headroom."
        ],
        "features": [
          "Unlimited anonymous contributors on every plan, no accounts needed",
          "Nine board formats: Freeform canvas, Wall, Grid, Timeline, Map, and more",
          "Padlet Sandbox collaborative whiteboard included on all tiers",
          "Built-in video and audio recording on posts, tier-gated by duration",
          "Deep education stack: student accounts, content safety, LMS, rostering",
          "Web, iOS, and Android"
        ],
        "pricing": {
          "summary": "Free (3 padlets); Platinum $15/mo or $120/yr; Team $19.99/mo per Maker; education plans from $160/yr",
          "asOf": "August 2026"
        },
        "pros": [
          "Zero-friction sharing — contributors post with no account at all",
          "Broad format range plus a real whiteboard under one roof",
          "Actively shipping through 2026"
        ],
        "cons": [
          "Free plan is 3 boards with 20MB uploads — hostile to hi-res images",
          "Cheaper Gold tier dropped; the jump from free to $15/mo Platinum is steep",
          "Education-first roadmap; no professional visual-reference tooling"
        ],
        "rating": 7.6
      },
      {
        "rank": 10,
        "name": "PureRef",
        "anchor": "pureref",
        "bestFor": "An offline desktop reference wall floating over your actual work",
        "verdict": "The anti-cloud pick: one thing, done perfectly, on your own machine, for whatever you choose to pay.",
        "paras": [
          "PureRef is the tool half this category is secretly imitating. It is a borderless, always-on-top overlay canvas — since 2.0 it can pin itself on top of a specific application — where you drop reference images, arrange them on an infinite zoomable surface, and keep working in your paint or edit tool underneath. Personal use is pay-what-you-want with $15 suggested; commercial use is $49 one-time for a studio of up to three, or $10/seat/mo beyond. It runs on Windows, macOS, and Linux, and shipped four releases in the first half of 2026 alone.",
          "It is also the purest expression of the tradeoff this page is about. A .pur file is fast, private, and entirely yours — and it lives on one machine. No cloud sync, no share link, no comments, no tablet or phone access; sharing means passing files or exported images around by hand. It is image-and-GIF-centric, so scripts, video clips, and PDFs need a different home. In pipeline terms, PureRef is a brilliant first station that connects to nothing downstream. Every concept artist we work with has it open anyway, and they are right to."
        ],
        "features": [
          "Always-on-top overlay, attachable to a specific application since 2.0",
          "Infinite zoomable canvas; boards save as a single portable .pur file",
          "Full GIF support with playback, timeline, and frame stepping",
          "Drawing tools, snapping grid, and image batch processing (2.1)",
          "Grouping with a hierarchy panel; exports can include notes and drawings",
          "Native Windows, macOS, and Linux builds — no web, iPad, or Android version"
        ],
        "pricing": {
          "summary": "Personal: pay-what-you-want ($15 suggested); Small Business $49 one-time (max 3 users); Business $10/seat/mo ($8/seat/mo annual)",
          "asOf": "August 2026"
        },
        "pros": [
          "Effectively free for personal use, with honest pay-what-you-want pricing",
          "Actively developed — four releases in the first half of 2026",
          "First-class Linux support, rare in this category"
        ],
        "cons": [
          "No cloud sync, share links, comments, or collaboration of any kind",
          "Desktop-only — no way to open a board on a tablet or phone on set",
          "Images and GIFs only; not a home for video, scripts, or documents"
        ],
        "rating": 8.6
      },
      {
        "rank": 11,
        "name": "Pinterest",
        "anchor": "pinterest",
        "bestFor": "Free discovery — finding reference you did not know to search for",
        "verdict": "The best image-finding engine on earth, and not a mood-board tool at all once the finding is done.",
        "paras": [
          "Pinterest belongs on this list for one reason: no dedicated tool comes close to its discovery. The recommendation engine and visual search surface reference imagery from a billions-scale corpus, actively finding frames you did not know to look for. It is completely free at any scale — ad-supported, with no paid consumer tier — with secret boards, free collaborators, and the lowest-friction capture on the web via the extension and mobile share sheet. As the top of the reference funnel it is unbeatable, and the company is public and going nowhere.",
          "As the board itself, it fails the becoming test completely. Boards are algorithm-ordered grid feeds — no spatial arrangement, no resizing, no annotation. There is no native export; the official data download is an HTML account archive that can take up to about 30 days — hence the third-party scraper ecosystem. Pins are re-compressions with frequent link-rot back to originals, so provenance for high-res sourcing is poor, and the feed increasingly interleaves promoted and AI-generated content. Harvest from Pinterest. Build somewhere else. Every crew we know already works this way."
        ],
        "features": [
          "Visual discovery engine and Lens search over a billions-scale image corpus",
          "Boards with sections; secret boards; free invited collaborators",
          "One-tap capture via browser extension and mobile share sheet",
          "Completely free at effectively unlimited scale, no watermarks",
          "Web, iOS, and Android"
        ],
        "pricing": {
          "summary": "Free, ad-supported; no consumer or business subscription tier exists",
          "asOf": "August 2026"
        },
        "pros": [
          "Unmatched discovery — it finds reference you would never have searched for",
          "Free at any scale, from a stable public company",
          "Lowest-friction capture anywhere on the web"
        ],
        "cons": [
          "No canvas: boards are grid feeds you cannot arrange, resize, or annotate",
          "No native export — getting a board out requires third-party scrapers",
          "Pins are re-compressed with frequent link-rot; ads and AI content in the feed"
        ],
        "rating": 7.4
      },
      {
        "rank": 12,
        "name": "Eagle",
        "anchor": "eagle",
        "bestFor": "A local asset library for collectors with serious reference volume",
        "verdict": "The librarian of this list: a one-time-purchase local database that swallows everything and shares nothing.",
        "paras": [
          "Eagle is not a canvas; it is a digital asset manager, and for personal reference volume it is the strongest one here. A one-time $34.95 license covers two devices with lifetime free updates — the teased 5.0 release, with AI search and batch auto-tagging, is confirmed free for existing owners. The library lives on your own disk, so tens of thousands of stills, clips, audio files, and fonts browse instantly, offline, with no account. Auto-tag rules, smart folders, and search by dominant color do the organizing, and the browser extension's batch capture is the fastest web-harvesting we have used.",
          "The limits are the mirror image of the strengths. Desktop-only: no mobile app, no web viewer, so nothing can be checked from a phone on set. No cloud sync or collaboration — the official answer for teams is parking the library in a shared drive, which risks conflicts with simultaneous editors. And as of August 2026 the shipping version is still 4.0; the 5.0 AI features remain a teaser. Treat Eagle as the deep archive feeding your boards — the vault behind the wall, not the wall itself — and it earns its price several times over."
        ],
        "features": [
          "Local-first library: assets on your own disk, instant browsing, fully offline",
          "Handles images, video, audio, fonts, and bookmarks in one browser",
          "Auto Tag rules, Smart Folders, and search by dominant color",
          "Browser extension with batch collection and full-page screenshot capture",
          "Eagle 5.0 (AI search, AI actions, MCP) a free upgrade for license holders",
          "Windows and macOS only — no mobile or web version"
        ],
        "pricing": {
          "summary": "$34.95 one-time (2 devices, lifetime updates); additional device $17.47; 30-day free trial, no perpetual free tier",
          "asOf": "August 2026"
        },
        "pros": [
          "Genuine one-time pricing with lifetime updates, including the 5.0 upgrade",
          "Fast, private, offline handling of very large reference libraries",
          "Best-in-class web capture via the browser extension"
        ],
        "cons": [
          "Desktop-only — no mobile, no web viewer, no on-set access",
          "No built-in sync or collaboration; team use means shared-drive workarounds",
          "The headline 5.0 AI features had not shipped in stable as of August 2026"
        ],
        "rating": 8.2
      }
    ],
    "tableIntro": "The full field at a glance. Prices are the vendors' own figures as of August 2026; item caps are the walls you will actually hit.",
    "columns": [
      "Best for",
      "Price",
      "Free plan",
      "Item caps",
      "Rating"
    ],
    "tableCells": {
      "soleil-clusters": [
        "Production teams, mood board to call sheet",
        "Free; Creator $25/mo flat",
        "Yes — no trial clock",
        "Generous card cap; no 100-item wall",
        "9.2/10"
      ],
      "miro": [
        "Team whiteboarding at scale",
        "From $8/member/mo (annual)",
        "Yes — 3 boards",
        "3 editable boards free; low-res export",
        "8.8/10"
      ],
      "notion": [
        "Docs-and-databases production paperwork",
        "From $10/member/mo (annual)",
        "Yes — generous solo",
        "1,000 lifetime blocks once 2+ members join",
        "8.5/10"
      ],
      "figjam": [
        "Design teams already on Figma",
        "Collab seat $3-5/mo; Full seat from $16/mo",
        "Yes — 3 boards",
        "3 team boards free; drafts share view-only",
        "8.4/10"
      ],
      "canva-whiteboards": [
        "Boards that become polished deliverables",
        "Free; Pro $18/mo",
        "Yes — unlimited whiteboards, 5GB",
        "No board cap; premium assets paywalled",
        "8.6/10"
      ],
      "obsidian-canvas": [
        "Open-format, Linux, offline boards",
        "Free (incl. commercial); Sync $4-8/mo",
        "Yes — effectively uncapped",
        "None — local files on your disk",
        "8.7/10"
      ],
      "storyflow": [
        "AI-native canvas for solo creators",
        "Free; Plus from $7.99/mo (annual)",
        "Yes — 20 uploads total",
        "20 lifetime file uploads on free",
        "7.8/10"
      ],
      "mural": [
        "Facilitated workshops",
        "From $9.99/user/mo (annual)",
        "Yes — 3 murals",
        "3 editable murals; older go view-only",
        "8.1/10"
      ],
      "padlet": [
        "No-account group collecting",
        "Free; Platinum $15/mo",
        "Yes — 3 padlets",
        "3 padlets; 20MB per upload",
        "7.6/10"
      ],
      "pureref": [
        "Offline desktop reference overlay",
        "Pay-what-you-want personal; $49 small business",
        "Personal use effectively free",
        "None — local .pur files",
        "8.6/10"
      ],
      "pinterest": [
        "Free visual discovery",
        "Free, ad-supported",
        "The whole product is free",
        "None that matter in practice",
        "7.4/10"
      ],
      "eagle": [
        "Local asset libraries at volume",
        "$34.95 one-time (2 devices)",
        "No — 30-day trial",
        "None — local library on your disk",
        "8.2/10"
      ]
    },
    "personas": [
      {
        "who": "A filmmaker or producer whose mood board has to become the shot list and the schedule",
        "pick": "Soleil Clusters",
        "why": "The whole pipeline lives as connected boards, edited live, shared with one link."
      },
      {
        "who": "A solo writer or planner comfortably under 100 cards",
        "pick": "Milanote",
        "why": "Honestly, stay — the calm solo flow and templates are still the best at this size."
      },
      {
        "who": "A design team already paying for Figma seats",
        "pick": "FigJam",
        "why": "Full whiteboard access is bundled into every seat, down to the $3 Collab seat."
      },
      {
        "who": "A facilitator running structured workshops and reviews",
        "pick": "Mural",
        "why": "Timers, anonymous voting, and Private Mode are built for keeping a room honest."
      },
      {
        "who": "A Linux user, open-source advocate, or anyone who needs boards on a plane",
        "pick": "Obsidian Canvas",
        "why": "Free for commercial work, local-first, offline, in an open MIT-spec format."
      },
      {
        "who": "A concept artist who wants reference floating over the paint app",
        "pick": "PureRef",
        "why": "The always-on-top overlay is unmatched, and personal use is pay-what-you-want."
      },
      {
        "who": "A marketer or brand team whose board must ship as a polished deliverable",
        "pick": "Canva Whiteboards",
        "why": "Unlimited free whiteboards plus the shortest path to a finished design."
      },
      {
        "who": "A collector with tens of thousands of reference files on disk",
        "pick": "Eagle",
        "why": "A $34.95 one-time local library with color search and auto-tagging at volume."
      }
    ],
    "honorableMentions": [
      {
        "name": "Kosmik",
        "note": "Shut down May 31, 2026, announced that April — sign-ups closed, subscribers refunded. Most rival roundups on this search page still recommend it, which tells you how recently they were tested."
      },
      {
        "name": "Trello",
        "note": "A kanban tool, not a canvas — cards in columns, no spatial arrangement, 10MB uploads on free. Fine for tracking production tasks; the wrong shape for a mood board."
      },
      {
        "name": "Scrivener",
        "note": "If what you actually use Milanote for is organizing long-form writing, Scrivener's corkboard and research binder go deeper, for a one-time $59.99 desktop license from a stable indie developer."
      },
      {
        "name": "InVision",
        "note": "The cautionary tale. A design-collaboration unicorn shut down all services at the end of 2024; its Freehand whiteboard was absorbed into Miro. Any roundup still listing it was written from memory."
      }
    ],
    "honestAccounting": {
      "heading": "Where Milanote still wins",
      "paras": [
        "This page exists because we outgrew Milanote, not because Milanote is bad, and pretending otherwise would make this the kind of vendor listicle we are trying to outrank. Milanote remains one of the most pleasant thinking surfaces ever made. The calm is real. The template library — 40+ categories, including genuinely good storyboard, shot-list, and mood-board templates — is bigger and more polished than ours. Platform coverage is the broadest here: first-party web, Mac, Windows, iPhone, iPad, and Android apps, with real editing on mobile. And it has a decade of track record in a category that just watched Kosmik, InVision, and refern's web app die inside two years.",
        "Its free-tier collaboration deserves credit too: shared boards are unlimited on free, and content shared to a free user does not count against that user's own 100-card cap — only cards they add do. For a Pro owner working with free clients, that is thoughtful design.",
        "So here is the honest boundary. If you work alone, plan in text more than media, and live comfortably under 100 cards, stay with Milanote — nothing here will feel as good for that job. The case for leaving starts when the board must become something: when the reference pull passes the card wall, when the tenth upload is spent, when the crew shows up and every seat multiplies the bill, or when the board needs to reach a shot list and a schedule without being rebuilt. That is the job we built Clusters for, and the job this ranking is organized around."
      ],
      "points": [
        "Best-in-class polish and a calm, distraction-free solo planning flow",
        "A large, well-crafted template library, including real film pre-production templates",
        "First-party apps on web, Mac, Windows, iPhone, iPad, and Android — with full mobile editing",
        "Generous free-tier sharing: unlimited shared boards, and shared content does not consume a free collaborator's card cap",
        "A decade of stability in a category that killed three well-known tools in two years"
      ]
    },
    "faq": [
      {
        "q": "Is there a free Milanote alternative without item caps?",
        "a": "Yes. Soleil Clusters' free tier has no trial clock and a generous card cap sized for real projects rather than a hard 100-item wall, and Obsidian Canvas is entirely free with no caps at all — boards are local files on your own disk. Canva's free plan also allows unlimited whiteboards, though premium assets are paywalled."
      },
      {
        "q": "What are Milanote's free plan limits?",
        "a": "Per Milanote's own plans page and help center: 100 total notes, images, and links, plus 10 file uploads — lifetime totals, not monthly. Images are capped at 10MB each on free. Shared boards are unlimited, and content shared to you by others does not count against your cap. Referrals can add up to 100 bonus cards."
      },
      {
        "q": "Does Milanote work offline?",
        "a": "No. Milanote's help center states you need an internet connection to view and edit boards — there is no offline mode on any platform, desktop apps included. If offline work matters, Obsidian Canvas and PureRef are fully local and offline, and Eagle's asset library also lives entirely on your own disk."
      },
      {
        "q": "Canva or Milanote — which is better?",
        "a": "Different jobs. Milanote is a thinking surface: collecting, arranging, planning. Canva is an output machine: its free plan allows unlimited whiteboards and its templates turn a board into a polished deliverable fast, but its mood-board templates are fixed-size collage pages. Plan in a board tool; finish the client-facing artifact in Canva."
      },
      {
        "q": "Milanote vs PureRef — which should I use?",
        "a": "They barely overlap. PureRef is an offline desktop overlay for pinning reference images above your paint or edit tool — fast, private, pay-what-you-want for personal use, with no sharing or collaboration. Milanote is a cloud board app for organizing ideas across devices. Many artists run both: PureRef while working, a board tool for everything shared."
      },
      {
        "q": "What is the best open-source Milanote alternative?",
        "a": "Obsidian Canvas is the practical answer. The app is free for personal and commercial use, and boards are saved as .canvas files under the MIT-licensed JSON Canvas spec — an open format any app can implement — on your own disk. The app itself is not open source, but your data is fully portable, offline, and never locked in."
      },
      {
        "q": "Does Milanote work on Linux?",
        "a": "Milanote ships no Linux desktop app — its first-party apps cover Mac, Windows, iPhone, iPad, and Android, plus the web app, which is how Linux users reach it. For native Linux support, Obsidian Canvas ships native Linux builds (AppImage, Snap, and Deb), and PureRef offers deb, rpm, and portable Linux packages."
      },
      {
        "q": "What do filmmakers use instead of Milanote?",
        "a": "A stack, usually: Pinterest for discovery, PureRef or Eagle for personal reference libraries, and a collaborative canvas as the production hub. We built Soleil Clusters to be that hub — mood board, storyboard, shot list, and schedule as connected boards with screenplay mode, edited live by the crew and shared with one link, no account needed."
      },
      {
        "q": "Is Milanote worth it for teams?",
        "a": "Do the math for your headcount. Milanote Pro is $9.99 per person per month billed annually ($12.50 monthly); team plans run $49/mo for up to 10 people or $99/mo for up to 50, billed annually. A five-person crew on Pro is about $50/mo. Flat-priced alternatives change that shape — Clusters' Creator is $25/mo total, and viewers never need seats."
      },
      {
        "q": "Milanote vs Notion for creative work?",
        "a": "Milanote wins the visual, spatial side: freeform boards for collecting and arranging. Notion wins the structured side: shot lists, breakdowns, and trackers as databases with table, kanban, timeline, and calendar views. Notion has no freeform canvas at all, and its free tier hard-caps at 1,000 lifetime blocks once a second member joins. Many productions run one of each."
      },
      {
        "q": "What happened to Kosmik?",
        "a": "Kosmik shut down. The founder announced the wind-down on April 24, 2026, and the service sunset on May 31, 2026 — sign-ups were disabled and subscribers were promised refunds. The homepage still hosts the farewell letter. Roundups that continue to recommend it were published without checking, which is worth remembering when reading tool listicles."
      }
    ],
    "related": [
      "/vs/milanote",
      "/tools/mood-board-maker",
      "/tools/storyboard-maker",
      "/use-cases"
    ],
    "cta": {
      "label": "Try Clusters free",
      "sub": "Free to start. No credit card."
    }
  },
  {
    "path": "/best/mood-board-apps",
    "kind": "listicle",
    "title": "12 Best Mood Board Apps in 2026 (Free & Paid, Tested)",
    "metaDescription": "The 12 best mood board apps in 2026, tested on real film and design work. Free and paid options compared: canvases, collages, and collaboration.",
    "h1": "The 12 Best Mood Board Apps in 2026",
    "subhead": "Ranked by a working film studio, tested on real productions — with the dead apps other roundups still recommend culled from the list.",
    "answerHeading": "What is the best mood board app in 2026?",
    "answer": "Soleil Clusters is the best mood board app for film and photo production in 2026: a free real-time canvas where the board is argued over live, approved with one link, and carried into look books and shot lists. Milanote is best for structured solo boards, Canva when the board itself is the deliverable, and Pinterest for pure discovery.",
    "disclosure": "Soleil Clusters is our app — we are Soleil Pictures, the film studio that builds it and uses it on our own productions. We rank it first for exactly one job: production mood boards a crew and a client must act on. For solo planning, polished deliverables, and offline reference walls, other tools here beat us, and we say so in each review.",
    "published": "2026-08-04",
    "updated": "2026-08-04",
    "thesis": {
      "heading": "A mood board is a decision document",
      "paras": [
        "Anyone can make a collage. Drag thirty images onto a canvas, nudge them around, export a JPEG — every app here can do that, and so can a corkboard. A working mood board is something else: a decision document. It exists to get a director, a client, a department head, and a budget to agree on what something should look like before money is spent making it look that way.",
        "So the real test of a mood board app is everything that happens after the board looks good. Can two people argue over it live, moving images while they talk, instead of trading screenshots? Can the client open it from one link, on a phone, without creating an account? And when the look is approved, does the board carry into the look book, the shot list, the schedule — or die as a pretty export while the production starts over elsewhere?",
        "Most mood board apps fail this test in one of three ways. They cap the free tier so low the board hits a wall mid-project. They treat sharing as an export — a static file, stale the moment the conversation continues. Or they simply stop existing: since late 2023, SampleBoard, GoMoodboard, InVision, and Kosmik have all shut down, and most competing roundups still recommend at least one of them.",
        "This list, written in August 2026, judges twelve living apps on what the board does after it looks good: who can argue over it, who can approve it, and what it becomes next. We build one of these tools, and we use all of them. The rankings reflect the work, not the marketing."
      ]
    },
    "methodology": {
      "heading": "How we tested 12 mood board apps",
      "intro": "We are a working film studio, and these are tools we have used, evaluated, or been pitched on our own productions from 2024 through 2026 — real mood boards for real shoots, look books that went to clients, shot lists that went to set. For this update we re-verified every price, cap, and platform claim against each vendor's own pages, and cut every product that no longer exists.",
      "criteria": [
        {
          "name": "Survives an argument",
          "why": "A board only one person can edit is a presentation, not a decision. We tested live co-editing and comments with a real crew disagreeing in real time."
        },
        {
          "name": "One-link approval",
          "why": "Clients do not make accounts. If sign-off cannot happen from a single link, the tool adds friction exactly where it is most expensive."
        },
        {
          "name": "What the board becomes",
          "why": "An approved board should flow into look books, shot lists, and schedules. We scored how far each tool carries the work before you start over elsewhere."
        },
        {
          "name": "The free tier tells the truth",
          "why": "A free plan that dies at 20 uploads or 100 items is a trial with better marketing. We measured whether each survives one real project."
        },
        {
          "name": "Handles real media",
          "why": "Production reference is not just JPEGs. Video, PDFs, palettes, and big files either belong on the board or the board is incomplete."
        },
        {
          "name": "Alive in August 2026",
          "why": "Four well-known mood board tools have shut down since December 2023. Every app here has verifiable 2026 activity, checked against its own changelog or store listing."
        }
      ]
    },
    "itemsHeading": "The 12 best mood board apps, ranked",
    "items": [
      {
        "rank": 1,
        "name": "Soleil Clusters",
        "anchor": "soleil-clusters",
        "isUs": true,
        "bestFor": "Film and photo production mood boards a crew and a client act on",
        "verdict": "The only app on this list where the mood board is argued over live, approved in one link, and then becomes the look book and the shot list.",
        "paras": [
          "Clusters is the tool we built because nothing else survived our own pre-production. It is an infinite canvas in the browser where a board holds what production reference actually is: images with non-destructive adjustments, video, audio, PDFs, links, notes, color palettes, image grids, and docs with a screenplay mode — not just stills. Drop a folder of references and auto-tagging files each one as it lands, so the board organizes itself while you argue about the layout.",
          "The arguing is the point. Boards are real-time multiplayer — live cursors, presence, comments pinned to the image they are about — so the director and the production designer move frames while they talk instead of trading screenshots. When the look settles, you send one link; the client opens the current board in any browser, on a laptop or a phone — no account, no install — not last Tuesday's export.",
          "Then the board keeps working. Boards nest with live thumbnails and connect through a relationship graph, so the approved mood board sits beside the look book, the shot list, and the schedule as one project instead of four files in three apps. That is the after-the-board-looks-good test the rest of this list keeps failing, and the one job we rank ourselves first for.",
          "The honest limits: Clusters runs in the browser only — no offline desktop app, no always-on-top overlay, so PureRef keeps that lane. Our template library is smaller than Milanote's or Canva's, and we are a young product from a small studio; in exchange you get a tool shaped by people who use it on their own productions every week. The free Demo tier needs no credit card and has no trial clock. Creator is a flat $25 a month — not per person — for unlimited boards, 100GB, and any file type."
        ],
        "features": [
          "Real-time multiplayer canvas: live cursors, presence, pinned comments",
          "One-link sharing — viewers need no account; free editors can collaborate",
          "Auto-tagging files dropped references; a relationship graph connects the project",
          "Boards hold images, video, audio, PDFs, notes, palettes, grids, schedules, and docs with screenplay mode",
          "Nested boards with live thumbnails; non-destructive photo adjustments; runs in any browser, including iPad"
        ],
        "pricing": {
          "summary": "Free (Demo tier, no credit card, no trial clock); Creator $25/mo flat — unlimited boards, 100GB storage, any file type",
          "asOf": "August 2026"
        },
        "pros": [
          "Flat $25/mo — the price does not multiply with every collaborator",
          "Clients review from one link with no account; the board is always current",
          "The approved board carries into look books, shot lists, and schedules"
        ],
        "cons": [
          "Browser-only — no offline desktop app or always-on-top overlay",
          "Template library smaller than Milanote's or Canva's",
          "A young product from a small studio, with no integrations marketplace"
        ],
        "rating": 9.3
      },
      {
        "rank": 2,
        "name": "Milanote",
        "anchor": "milanote",
        "bestFor": "Structured solo mood boards and creative planning",
        "verdict": "The most pleasant place on this list to think alone — until the 100-card free cap lands mid-project.",
        "paras": [
          "Milanote is the polished incumbent, and it earns the reputation. Boards mix notes, images, links, sketches, and files on a calm freeform surface, and the template library is genuinely useful — over 40 categories, including filmmaking-specific storyboards, shot lists, and mood boards. It is actively maintained (the iOS app updated July 22, 2026) and platform coverage is the broadest here: web, Mac, Windows, iPhone, iPad, and Android.",
          "Its sharing model is smarter than most, too. Boards share with edit, comment, or view roles, and content shared to a free collaborator does not count against that person's card cap — a genuinely gracious detail. For a solo writer, designer, or director assembling ideas before the crew shows up, Milanote is a fine answer, and we recommend it for exactly that.",
          "The decision-document test is where it thins out. The free plan caps you at 100 total cards and 10 file uploads ever — a ceiling a real reference board hits in an afternoon. Paid is per person at $9.99 a month billed annually, so cost scales with headcount. And there is no offline mode; Milanote's own help center says an internet connection is required to view and edit boards. A lovely place to think. A harder place to run a production."
        ],
        "features": [
          "Freeform boards mixing notes, images, video, links, sketches, and files",
          "40+ template categories, including storyboards, shot lists, and mood boards for film",
          "Per-board sharing with edit, comment, and view roles",
          "Shared content does not consume a free collaborator's card cap",
          "First-party apps on web, Mac, Windows, iPhone, iPad, and Android, plus web clippers"
        ],
        "pricing": {
          "summary": "Free (100 cards + 10 file uploads); Pro $9.99/person/mo billed annually ($12.50 monthly); Team $49/mo for up to 10 people or $99/mo for up to 50, billed annually",
          "asOf": "August 2026"
        },
        "pros": [
          "Best structured solo boarding experience here, with a deep template library",
          "Broadest first-party platform coverage in the category",
          "Flexible sharing roles; shared content is free for the recipient"
        ],
        "cons": [
          "Free plan caps at 100 total cards and 10 file uploads — tight for a visual tool",
          "No offline mode — the help center states an internet connection is required",
          "Per-person pricing; mobile apps lack table editing and trash access"
        ],
        "rating": 8.8
      },
      {
        "rank": 3,
        "name": "Canva",
        "anchor": "canva",
        "bestFor": "Mood boards that must become a polished, presentable deliverable",
        "verdict": "When the client is buying the board itself — not the decision behind it — Canva's template machine is unbeatable.",
        "paras": [
          "Sometimes the mood board is the product: a pitch page, a brand one-sheet, something that has to look designed. That is Canva's home turf. The mood board gallery is full of designer-made templates — interior design, fashion, color collages — and the ecosystem is enormous: 1.6 million-plus free templates, 141 million-plus stock assets on paid tiers. The free tier is generous — unlimited designs and whiteboards, real-time collaboration, 5GB, no card — and the company is conspicuously alive, shipping Canva AI 2.0 and an offline desktop mode in April 2026.",
          "The catch sits in the product's split personality. Canva's mood board templates are fixed-size collage pages, not an infinite canvas; the infinite space lives in Whiteboards, a separate design type without the template polish. So you choose template beauty or unbounded layout, not both. Reference also lives per-design rather than in a project-wide library — backwards for production, where the same forty frames feed the board, the deck, and the look book.",
          "Price is the other watch item. Pro has climbed from $12.99 to $15 to $18 a month within about two years, and the tools productions actually want — background remover, unwatermarked premium stock, brand kits beyond three colors — all sit behind that paywall. The verdict writes itself: use Canva when the deliverable is the point, and make the decision somewhere else."
        ],
        "features": [
          "Large gallery of designer-made mood board templates",
          "Whiteboards on every plan: infinite canvas, unlimited boards, real-time collaboration",
          "1.6M+ free templates; 141M+ premium stock assets on paid tiers",
          "Magic Studio AI suite with a pooled monthly allowance (about 200 standard uses on free)",
          "Web, iOS, Android, Windows, macOS, plus a new offline desktop mode"
        ],
        "pricing": {
          "summary": "Free (5GB, unlimited designs and whiteboards); Pro $18/mo or $143.99/yr (~$12/mo effective); Business $25/user/mo",
          "asOf": "August 2026"
        },
        "pros": [
          "Fastest route on this list from nothing to a client-presentable page",
          "Free tier includes unlimited whiteboards and real-time collaboration",
          "Massive, actively developed ecosystem — templates, stock, AI, print"
        ],
        "cons": [
          "Mood board templates are fixed-size pages; the infinite canvas is a separate, plainer Whiteboard",
          "Pro pricing rose from $12.99 to $18/mo in about two years, with key tools paywalled",
          "Premium stock stays watermarked on free until licensed; assets live per-design, not per-project"
        ],
        "rating": 8.6
      },
      {
        "rank": 4,
        "name": "Pinterest",
        "anchor": "pinterest",
        "bestFor": "Discovering imagery you did not know to search for",
        "verdict": "The best discovery engine in the world and a poor place to make a decision — harvest here, board elsewhere.",
        "paras": [
          "Every mood board starts with a hunt, and nothing hunts like Pinterest. The recommendation engine surfaces reference you did not know how to ask for, the browser extension and mobile share sheet capture any image in one tap, and the entire product is free at effectively unlimited scale — no watermarks, no storage meter, free collaborators on secret group boards. As the discovery funnel feeding a production's visual research, it has no equal here.",
          "But a Pinterest board is a feed, not a canvas. Pins sit in an algorithm-ordered grid; you cannot spatially arrange, resize, group, or annotate them the way look development requires. There is no native export of a board — the official download-your-data option is an HTML archive that can take up to about 30 days — and pins are re-compressions with frequent link-rot back to the originals. So the working pattern every crew lands on: spend the Pinterest hour, then harvest the keepers into a real board tool. A mandatory stop, a poor destination — treated that way, it deserves its rank."
        ],
        "features": [
          "Recommendation engine and Lens visual search over a billions-scale image corpus",
          "One-tap capture anywhere via browser extension and mobile share sheet",
          "Secret boards and group boards with free invited collaborators",
          "Completely free — ad-supported, with no paid consumer tier at all",
          "Web, iOS, and Android"
        ],
        "pricing": {
          "summary": "Free, ad-supported; no consumer or business subscription tier exists",
          "asOf": "August 2026"
        },
        "pros": [
          "Best-in-class discovery — it finds reference you did not know to search for",
          "Free at any practical scale, from a public company with zero platform risk",
          "Lowest-friction capture of anything on this list"
        ],
        "cons": [
          "No canvas: boards are algorithm-ordered grid feeds you cannot arrange or annotate",
          "No native board export — getting images out means third-party scrapers",
          "Pins re-compress and link-rot; ads and AI-generated content increasingly salt the feed"
        ],
        "rating": 8.3
      },
      {
        "rank": 5,
        "name": "Miro",
        "anchor": "miro",
        "bestFor": "Big-team workshops where the mood board is one exercise among many",
        "verdict": "A serious collaboration platform that treats images as passengers — fine for the workshop, wrong for the wall of stills.",
        "paras": [
          "If your mood board happens inside a 20-person workshop — agency kickoffs, brand sprints, cross-functional discovery — Miro is the credible pick. Unlimited members even on the free plan means nobody is blocked at the door, the ecosystem is the deepest in the category (7,000-plus templates, 250-plus integrations), and the product ships near-weekly through mid-2026, including AI agents on the canvas.",
          "As a mood board tool specifically, it strains. The free tier allows 3 editable boards with low-res image export only — a real ceiling for ongoing visual work. More telling: Miro's own help center maintains an article on board performance issues, and community threads report lag at roughly 2,500 to 3,500 objects and under heavy image loads — precisely what a dense reference board is. AI is credit-metered on every tier, and the pricing page shows annual-billed rates only, the higher month-to-month cost never displayed. Use Miro as the collaboration and planning layer it is; do not ask it to be the visual-reference workhorse."
        ],
        "features": [
          "Infinite shared canvas with best-in-class multiplayer for large groups",
          "Unlimited members on every plan, including free",
          "7,000+ templates and 250+ integrations",
          "AI Sidekicks and Flows — agents and multi-step AI workflows on the canvas",
          "Web, Windows, macOS, iOS/iPadOS, and Android"
        ],
        "pricing": {
          "summary": "Free (3 editable boards, low-res export); Starter $8/member/mo billed yearly; Business $20/member/mo billed yearly; Enterprise custom",
          "asOf": "August 2026"
        },
        "pros": [
          "Unlimited free members — frictionless for large workshop groups",
          "Deepest template and integration ecosystem in the category",
          "Fast, verifiable development pace through 2026"
        ],
        "cons": [
          "Free plan caps at 3 editable boards with low-res image export only",
          "Documented performance degradation on image-heavy boards — the exact mood board use case",
          "Annual-billed prices are the only ones displayed; monthly costs about 20% more"
        ],
        "rating": 8.1
      },
      {
        "rank": 6,
        "name": "FigJam",
        "anchor": "figjam",
        "bestFor": "Mood boarding inside organizations already paying for Figma",
        "verdict": "If your company runs on Figma, FigJam is effectively free and already installed — accept its image handling and move on.",
        "paras": [
          "FigJam's argument is economic. Since Figma's seat repricing, every seat type on every paid plan includes full FigJam — even the $3-a-month Collab seat — so inside a design org the whiteboard is already bought. The multiplayer is excellent (live cursors, audio, spotlight facilitation), and the 24-hour guest access is one of the best client-review mechanics on this list: an outside stakeholder joins a session with no login at all.",
          "The free Starter plan is honest but small: 3 FigJam boards per team, with unlimited personal drafts that collaborators can only view, not edit. And FigJam remains a brainstorming whiteboard at heart — images are secondary citizens, without the resolution fidelity, zoom ergonomics, or color tools reference work wants. Figma's 2026 release energy visibly flows elsewhere; FigJam mostly appears in cross-product rollouts, maintained rather than prioritized. For beat-mapping and creative sessions with a distributed crew, it is good and cheap. As the wall where a film's look gets decided, it is the wrong instrument."
        ],
        "features": [
          "Included with every paid Figma seat, down to the $3/mo Collab seat",
          "24-hour guest access — external contributors join with no login",
          "Live multiplayer with audio, stamps, timers, voting, and Spotlight facilitation",
          "FigJam AI: generate templates and diagrams, auto-sort stickies, summarize boards",
          "Web, macOS and Windows apps, and a dedicated iPad app"
        ],
        "pricing": {
          "summary": "Free Starter (3 FigJam boards per team); bundled with Figma seats — Collab seat $3/mo (Professional) or $5/mo (Org/Enterprise); Full seat from $16/mo billed annually",
          "asOf": "August 2026"
        },
        "pros": [
          "Near-zero adoption cost inside any org already on Figma",
          "No-login 24-hour guest access is excellent for client sessions",
          "Strong live facilitation — audio, spotlight, voting, timers"
        ],
        "cons": [
          "Images are secondary citizens — no reference-grade resolution or color handling",
          "Free team capped at 3 boards; free drafts are view-only for collaborators",
          "Seat-model pricing is confusing standalone, and FigJam is no longer Figma's focus"
        ],
        "rating": 8
      },
      {
        "rank": 7,
        "name": "Morpholio Board",
        "anchor": "morpholio-board",
        "bestFor": "Interior designers building client boards on iPad",
        "verdict": "The one genuinely trade-specific tool here — a mood board that turns itself into a shopping list, if you live inside Apple hardware.",
        "paras": [
          "Morpholio Board is what happens when a mood board app picks one profession and commits. Its standout feature, Ava, turns a board of furniture and finishes into auto shopping lists, cut sheets, and furniture books — the paperwork of interior design generated from the pretty picture. Add the Pinterest Portal, AR furniture placement, Magic Lift background removal, and a gallery of real products from partner brands, and it is less a collage tool than a junior designer on the iPad.",
          "It is on solid footing, too: Vectorworks (Nemetschek Group) acquired Morpholio in February 2026, and development has continued — version 5.8 shipped July 17, 2026. The free tier allows 5 projects, and paid tiers run $4.99, $7.99, and $11.99 through Apple in-app purchase — cheap against pro design SaaS, though the App Store listing does not label billing periods and there is no public pricing page at all.",
          "The walls are hard, though. Apple-only — no web, Windows, or Android — so client review means exported PDFs or images rather than a live link, and there is no real-time collaboration; it is a single Apple-ID app. Even PDF export is paywalled at Premium. A plausible niche pick for a set decorator sourcing interiors on an iPad; for a production team, the platform walls decide it."
        ],
        "features": [
          "Ava auto-sourcing: boards generate shopping lists, cut sheets, and furniture books",
          "Pinterest Portal and web clipper for pulling inspiration onto boards",
          "AR furniture placement and AR color capture into palettes",
          "Magic Lift AI background removal, masks, and Shadow Maker compositing",
          "One subscription covers iPhone, iPad, and Mac"
        ],
        "pricing": {
          "summary": "Free (5 projects); Apple in-app tiers at $4.99, $7.99, and $11.99 (billing periods unlabeled on the App Store listing, presumed monthly)",
          "asOf": "August 2026"
        },
        "pros": [
          "The board-to-shopping-list pipeline is automated, not bolted on — unique on this list",
          "Excellent iPad-native touch and Pencil experience (4.6/5 across 3.8K App Store ratings)",
          "Actively developed with corporate backing since the February 2026 acquisition"
        ],
        "cons": [
          "Apple-only: no web, Windows, or Android — clients get exported PDFs, not a live link",
          "No real-time multi-user collaboration — a single Apple-ID account model",
          "Hard project caps below the top tier, and even PDF export is paywalled"
        ],
        "rating": 8.2
      },
      {
        "rank": 8,
        "name": "Adobe Express",
        "anchor": "adobe-express",
        "bestFor": "Quick, polished collage pages inside the Adobe ecosystem",
        "verdict": "A fast free way to make a handsome mood page — as long as you want a page, not a canvas.",
        "paras": [
          "Adobe Express offers 893 ready-made mood board templates and a genuinely usable free tier: real editing tools, 5GB of storage, real-time co-editing, review flows outsiders can join without an Adobe account, and daily Firefly AI generations — no credit card. If the production already lives in the Adobe world, the gravity is real: Adobe Stock, Adobe Fonts, PSD and Illustrator interop, and, as of the May 2026 release, Figma import and export.",
          "But the mood boards are fixed-page collage templates, not a freeform canvas — and Adobe knows it. The company's own mood board maker page now routes to Firefly Boards, a separate AI-first infinite-canvas product that free Express users do not get. Meanwhile the packaging churns: the standalone Premium plan is gone, replaced by Acrobat Express at $10.99 a month, bundling PDF features many designers never asked for. Free-tier ceilings bite too: 5GB, 10-day history, premium assets behind crown icons in the search results. For a pitch-deck mood page on a deadline, Express is quick and handsome. As the place a look gets developed, it is a brochure, not a workbench."
        ],
        "features": [
          "893 mood board templates, static and animated, free and premium",
          "Firefly generative AI included on free with daily generations",
          "Real-time co-editing, commenting, and no-account review and approval flows",
          "Adobe Stock, Adobe Fonts, and PSD/AI import with Photoshop and Illustrator sync (paid)",
          "Web, desktop PWA, iPhone, iPad, and Android; Figma import and export (May 2026)"
        ],
        "pricing": {
          "summary": "Free (5GB, no credit card); paid individual plan is now Acrobat Express at $10.99/mo billed monthly, with a 7-day trial",
          "asOf": "August 2026"
        },
        "pros": [
          "Genuinely usable free tier with co-editing and no-account client review",
          "Unmatched asset-library gravity if you already work in Adobe tools",
          "Heavily developed through 2026, with AI features shipping monthly"
        ],
        "cons": [
          "Mood boards are fixed-size collage pages; Adobe steers real mood boarding to a separate paid-gated product",
          "Pricing and packaging churn — the plan identity has changed twice in two years",
          "Upsell-heavy: premium assets salt free search results, and free history is 10 days"
        ],
        "rating": 7.8
      },
      {
        "rank": 9,
        "name": "Are.na",
        "anchor": "are-na",
        "bestFor": "Slow, deliberate visual research built over years",
        "verdict": "Not a mood board app so much as a place taste accumulates — the research layer under every good board.",
        "paras": [
          "Are.na is where visual research goes when it stops being a deadline and becomes a practice. Blocks — images, links, text — connect into channels, channels connect into other channels, and the whole network is ad-free, algorithm-free, and member-funded. The community is the feature: following the right channels surfaces reference with a coherence no recommendation engine matches, because a person with taste did the filtering.",
          "It is also that rarest thing in this graveyard-strewn category: a tiny company that is transparently healthy. Are.na's own about page publishes its numbers — four full-time staff and two part-timers, around 20,516 paying members, $125,085 in monthly recurring revenue. After watching venture-backed tools like Kosmik and InVision vanish, a profitable indie that shows you its books is a real durability argument.",
          "As a working mood board tool it is deliberately spare: channels are grids, not freeform canvases, and the free tier caps at 200 total blocks — fine for a season of careful curation, small for a production's appetite. Premium is $7 a month or $70 a year. Use it as the long-memory research layer that feeds the board, and it quietly becomes indispensable."
        ],
        "features": [
          "Blocks (images, links, text) connected into channels, and channels into each other",
          "Ad-free, algorithm-free network — human curation instead of a feed",
          "Free tier: up to 200 blocks, free forever",
          "Premium $7/mo or $70/yr; Supporter $120/yr",
          "Public-by-default culture that makes others' research browsable; web and iOS"
        ],
        "pricing": {
          "summary": "Free (200 blocks); Premium $7/mo or $70/yr; Supporter $120/yr",
          "asOf": "August 2026"
        },
        "pros": [
          "The highest signal-to-noise visual research anywhere — human-curated, ad-free",
          "Transparently sustainable indie that publishes its own revenue figures",
          "Cheap, honest pricing with a genuinely free forever tier"
        ],
        "cons": [
          "Channels are grids — no freeform canvas, arrangement, or annotation",
          "200-block free cap is small for production-volume reference gathering",
          "No client-presentation story; it is a research tool, not a deliverable"
        ],
        "rating": 8
      },
      {
        "rank": 10,
        "name": "PureRef",
        "anchor": "pureref",
        "bestFor": "An offline desktop reference wall floating over your work",
        "verdict": "The best pure reference overlay ever made — a private instrument, not a shared document.",
        "paras": [
          "PureRef does one thing with total conviction: a borderless, always-on-top canvas of reference images floating over Photoshop, Blender, or an edit suite — since 2.0 it can pin itself on top of a specific application. It is fast, minimal, fully offline, and pay-what-you-want for personal use with $15 suggested — about as honest as software pricing gets. It is genuinely alive (version 2.1.3 shipped June 3, 2026, its fourth release of the year) and properly cross-platform: Windows, macOS, and first-class Linux builds, with boards saved as single portable .pur files. For a concept artist, DP, or previz artist working alone, this is the reference tool, and we will not pretend otherwise.",
          "Judged as a mood board app, though, it fails the decision-document test on purpose. No cloud, no link, no comments, no web or tablet version; sharing means emailing files or exports around manually. It is image-and-GIF-centric, so video clips, scripts, and PDFs live elsewhere. And note the licensing change: commercial use now requires a paid per-seat license as of 2.0 — Small Business is $49 one-time for up to three users — which teams upgrading from the free-for-commercial 1.x may not expect."
        ],
        "features": [
          "Always-on-top borderless overlay; can attach on top of a specific application",
          "Infinite zoomable canvas with drag-and-drop from files, browser, or clipboard",
          "Boards save as single portable .pur files",
          "Drawing tools, snap-to-grid, batch processing, and rich-text notes (2.1)",
          "Windows, macOS, and Linux — no web, iPad, or Android version"
        ],
        "pricing": {
          "summary": "Personal: pay-what-you-want ($15 suggested); Small Business $49 one-time (max 3 users); Business $10/seat/mo, or $8/seat/mo billed annually",
          "asOf": "August 2026"
        },
        "pros": [
          "Purpose-built overlay workflow no cloud tool replicates",
          "Effectively free for personal use, with four releases in the first half of 2026",
          "Genuinely cross-platform, including first-class Linux builds"
        ],
        "cons": [
          "No cloud, links, comments, or collaboration — sharing means passing files around",
          "Desktop-only, so no board access from a tablet on set or a client's phone",
          "Commercial use requires a paid per-seat license as of 2.0 — a change from the free 1.x era"
        ],
        "rating": 8.5
      },
      {
        "rank": 11,
        "name": "Eagle",
        "anchor": "eagle",
        "bestFor": "A local reference library that feeds every board you make",
        "verdict": "Not where the mood board lives — where the ten thousand images behind it live.",
        "paras": [
          "Eagle is the librarian of this list: a local-first desktop app that swallows entire reference collections — images, video, audio, fonts, bookmarks — into one fast library on your own disk, browsable offline with no account. The organizational tools are the draw: auto-tagging folders, smart folders that sort by name, tag, color, or format, and search by dominant color — one of the most production-useful features here when you need every frame in a certain teal.",
          "Capture is best-in-class: the browser extension does drag-to-save, batch collection, and an Alt+Right-Click grab that works on right-click-disabled sites. Pricing is a plain one-time $34.95 covering two devices with lifetime free updates — and the teased Eagle 5.0, with AI search and batch tagging, is confirmed free for existing license holders, though as of August 2026 the shipping version is still 4.0.",
          "The trade-off mirrors PureRef's: desktop-only (Windows and macOS), no mobile app or web viewer, and no built-in sync or collaboration — team use means parking the library in a cloud drive, which official docs endorse but which risks conflicts with simultaneous editors. Eagle does not replace a board tool. It makes whichever one you pick faster, because the right reference is always findable."
        ],
        "features": [
          "Local-first library on your own disk — fast, offline, no account",
          "Images, video, audio, fonts, and bookmarks in one browsable collection",
          "Auto-tag folders and smart folders organized by name, tag, color, or format",
          "Search assets by dominant color",
          "Browser extension with batch capture, even from right-click-disabled sites"
        ],
        "pricing": {
          "summary": "$34.95 one-time (2 devices, lifetime free updates; extra devices $17.47 each); 30-day free trial, no perpetual free tier",
          "asOf": "August 2026"
        },
        "pros": [
          "Genuine one-time pricing, with the 5.0 AI release confirmed free for owners",
          "Color search and smart folders make huge reference libraries instantly navigable",
          "Best web-capture workflow of anything on this list"
        ],
        "cons": [
          "Desktop-only — no mobile app or web viewer for on-set access",
          "No built-in sync or collaboration; team use relies on third-party cloud drives",
          "No free tier — a once-per-device 30-day trial, then the license"
        ],
        "rating": 8.1
      },
      {
        "rank": 12,
        "name": "Storyflow",
        "anchor": "storyflow",
        "bestFor": "AI-assisted mood boards where the AI reads the whole canvas",
        "verdict": "The most interesting AI thesis in the category, from the smallest and riskiest vendor on the list.",
        "paras": [
          "Storyflow's idea is real: the AI has the whole board as context. It reads everything on the canvas, remembers the project across sessions on paid tiers, lets you @-mention any canvas element, and generates working boards — moodboards, storyboards, shot lists, script breakdowns — from a prompt, staged as a proposal you accept or discard. For filmmakers who want a first pass generated rather than gathered, nothing else here attempts as much.",
          "Development is visibly rapid — real-time cursors shipped July 27, 2026, atop a near-daily changelog — and free-tier collaboration is structurally generous: unlimited boards, objects, shared boards, and collaborators, no time limit, no card. But the free plan's 20-file lifetime upload cap dies in the first hour of real reference work, and the AI allowance on Free and Plus is an unquantified trial — meaningful AI use effectively starts at Pro, $14 a month billed annually.",
          "Then there is the vendor itself: a 2-to-10-person operation, web-only, in a category that buried four tools in three years. For a decision document a production depends on, that scale is a real risk. Promising, worth watching, not yet a system of record."
        ],
        "features": [
          "Whole-canvas AI context: the AI reads the board and remembers the project (paid)",
          "Prompt-to-board generation of moodboards, storyboards, shot lists, and breakdowns",
          "200+ 'Tactics' creative frameworks that drop onto the canvas half-built",
          "AI image generation with background removal and upscaling (Pro and up)",
          "Real-time cursors; read-only share links with comments — web-only, no apps"
        ],
        "pricing": {
          "summary": "Free (20 uploads total); Plus $9.99/mo ($7.99/mo billed annually); Pro $19/mo ($14 annually); Max $49/mo ($39 annually)",
          "asOf": "August 2026"
        },
        "pros": [
          "Deepest AI-on-the-canvas integration in the category, aimed at filmmakers",
          "Unlimited boards, collaborators, and shared boards even on free",
          "Shipping near-daily through late July 2026"
        ],
        "cons": [
          "20-upload lifetime cap makes the free tier a demo for image-heavy work",
          "AI allowances on Free and Plus are unquantified 'trial' amounts — real usage starts at Pro",
          "Tiny vendor (2-10 people), web-only — longevity risk in a category with a body count"
        ],
        "rating": 7.6
      }
    ],
    "tableIntro": "All twelve at a glance. Prices verified against each vendor's own pages, August 2026.",
    "columns": [
      "Best for",
      "Price",
      "Free plan",
      "Client sharing",
      "Rating"
    ],
    "tableCells": {
      "soleil-clusters": [
        "Film/photo production boards",
        "Free; Creator $25/mo flat",
        "No card, no trial clock",
        "One link, no account needed",
        "9.3/10"
      ],
      "milanote": [
        "Structured solo boards",
        "Pro $9.99/person/mo (annual)",
        "100 cards, 10 file uploads",
        "View/comment/edit links",
        "8.8/10"
      ],
      "canva": [
        "Polished deliverable boards",
        "Pro $18/mo or $143.99/yr",
        "Unlimited designs, 5GB",
        "Share links and exports",
        "8.6/10"
      ],
      "pinterest": [
        "Discovery",
        "Free, ad-supported",
        "The whole product",
        "Public or secret board links",
        "8.3/10"
      ],
      "miro": [
        "Big-team workshops",
        "Starter $8/member/mo (annual)",
        "3 boards, low-res export",
        "Links; guests on paid plans",
        "8.1/10"
      ],
      "figjam": [
        "Design orgs on Figma",
        "Collab seat from $3/mo",
        "3 team boards",
        "24-hour guest access, no login",
        "8.0/10"
      ],
      "morpholio-board": [
        "Interior designers (iPad)",
        "IAP $4.99-$11.99",
        "5 projects",
        "Exported PDFs and images only",
        "8.2/10"
      ],
      "adobe-express": [
        "Quick Adobe-world collages",
        "Acrobat Express $10.99/mo",
        "5GB, real editing tools",
        "Review links, no account needed",
        "7.8/10"
      ],
      "are-na": [
        "Slow visual research",
        "Premium $7/mo or $70/yr",
        "200 blocks, free forever",
        "Public channels by default",
        "8.0/10"
      ],
      "pureref": [
        "Offline reference overlay",
        "Pay-what-you-want ($15 suggested)",
        "Personal use is PWYW",
        "Send the .pur file or an export",
        "8.5/10"
      ],
      "eagle": [
        "Local reference library",
        "$34.95 one-time",
        "30-day trial only",
        "None built in — local files",
        "8.1/10"
      ],
      "storyflow": [
        "AI-assisted boards",
        "Free; Plus from $7.99/mo (annual)",
        "20 uploads, unlimited boards",
        "Read-only links with comments",
        "7.6/10"
      ]
    },
    "personas": [
      {
        "who": "A director or DP building a film's look with a crew and a client",
        "pick": "Soleil Clusters",
        "why": "The board is argued over live, approved from one link, and carries into the look book and shot list."
      },
      {
        "who": "A solo writer or designer organizing ideas before anyone else is involved",
        "pick": "Milanote",
        "why": "The most pleasant structured thinking space here, with real film templates."
      },
      {
        "who": "A brand or social designer whose client is buying the board itself",
        "pick": "Canva",
        "why": "Template polish and a full output pipeline — the deliverable is the point."
      },
      {
        "who": "An interior designer presenting boards and sourcing product on an iPad",
        "pick": "Morpholio Board",
        "why": "The board generates its own shopping lists and cut sheets."
      },
      {
        "who": "A concept artist who wants references floating over the painting app",
        "pick": "PureRef",
        "why": "The always-on-top overlay is purpose-built and pay-what-you-want."
      },
      {
        "who": "A visual researcher building taste over years, not deadlines",
        "pick": "Are.na",
        "why": "Human-curated, ad-free, and run by a small profitable team."
      },
      {
        "who": "A product or agency team where the board is one workshop exercise among many",
        "pick": "Miro",
        "why": "Unlimited free members and the deepest integration ecosystem."
      },
      {
        "who": "A filmmaker who wants AI to draft the first pass of boards and shot lists",
        "pick": "Storyflow",
        "why": "Whole-canvas AI and prompt-to-board generation — accept the small-vendor risk knowingly."
      }
    ],
    "honorableMentions": [
      {
        "name": "SampleBoard",
        "note": "Cut because the tool no longer exists: SampleBoard's own site states the mood board editor was discontinued in December 2023 after 13 years, and the company now sells interior-design Canva templates. Several 2026 roundups still recommend and price the dead product."
      },
      {
        "name": "GoMoodboard",
        "note": "Cut because it is gone: the product effectively shut down around November 2024, when its domain began redirecting to Dribbble, and the lapsed domain now displays a law-enforcement seizure banner — which is where anyone following an old listicle's link lands today."
      },
      {
        "name": "InVision (Freehand)",
        "note": "Cut because the once-dominant design-collaboration platform shut down all services at the end of 2024; Freehand went to Miro, and invisionapp.com now redirects there. A useful caution about betting pre-production on venture-backed tools."
      },
      {
        "name": "Kosmik",
        "note": "Cut because it sunset on May 31, 2026 — announced April 24, sign-ups disabled, users pointed to data export. Its built-in-browser capture workflow was genuinely original, and most competing listicles still recommend it months after its homepage announced the end."
      },
      {
        "name": "Obsidian Canvas",
        "note": "Cut for shape, not health — Obsidian is thriving and free for commercial work, and Canvas is a capable local-first infinite canvas in an open format. But there is no live co-editing and no share-a-board web link, which is the whole job here. As a private offline research binder, excellent."
      }
    ],
    "honestAccounting": {
      "heading": "Where the old ways still win",
      "paras": [
        "A wall of printed stills is still a formidable mood board. It is always on, visible to the whole room, and impossible to ignore the way a browser tab is easy to ignore. Plenty of production offices we respect still print the approved board and pin it up — usually after making it in software, which tells you the two are not rivals.",
        "The same honesty applies within this list. The Pinterest hour at the start of research is close to irreplaceable, and no canvas tool should pretend to be a discovery engine. PureRef offline remains the best pure reference experience a solo artist can have. And when the client is paying for a beautiful page rather than a production decision, Canva finishes the job faster than we do.",
        "The tool matters less than the decision the board records. A board that got the director, the client, and the money to agree did its job — in our app, in Milanote, or on a wall with pushpins. Pick the tool whose failure points you can live with, and spend the saved attention on the work."
      ],
      "points": [
        "A printed wall beats every app for always-on visibility in a production office",
        "Pinterest remains the best first hour of any visual research, whatever you board in afterward",
        "PureRef offline is still the best solo reference experience — no cloud tool replicates the overlay",
        "Canva wins outright when the deliverable is the board itself",
        "No app rescues a board that never forced a decision"
      ]
    },
    "faq": [
      {
        "q": "What is the best free mood board app?",
        "a": "For production work, Soleil Clusters — the free Demo tier has no credit card and no trial clock, with a card cap sized for a real project. Canva's free tier is generous too (unlimited whiteboards, 5GB), and Pinterest is entirely free for discovery. Milanote's free plan caps at 100 total cards, which real boards exhaust quickly."
      },
      {
        "q": "Which mood board apps do not add watermarks?",
        "a": "Watermarks are mostly a stock-asset trap, not a board trap. Milanote, Miro, FigJam, and Pinterest do not watermark boards, and Canva does not watermark your own or free content — but premium stock in Canva stays watermarked until you license it or upgrade. Check the asset, not just the app."
      },
      {
        "q": "What is the best mood board app for interior design?",
        "a": "Morpholio Board. It is built for the trade: boards generate auto shopping lists, cut sheets, and furniture books, with AR furniture placement and a curated gallery of real products. Acquired by Vectorworks in February 2026, it remains actively developed. The catch: Apple-only, with no web version and no live collaboration."
      },
      {
        "q": "What is the best mood board app for fashion?",
        "a": "It depends on the output. Canva has designer-made fashion mood board templates for a polished page fast, and Pinterest is the discovery engine for pulling looks. For a shoot — where the board is argued over by a team and approved by a client — a real-time canvas like Soleil Clusters or Milanote holds up better than a collage template."
      },
      {
        "q": "What is the best mood board app for iPad?",
        "a": "Morpholio Board is the most iPad-native, built around touch and Pencil. Milanote ships a dedicated iPad app, and FigJam has one for whiteboarding. Soleil Clusters runs in the iPad browser with touch support, so shared boards open on set without an install. PureRef has no iPad version at all — it is desktop-only."
      },
      {
        "q": "How do I share a mood board with a client who will not make an account?",
        "a": "Pick a tool where the link needs nothing on the client's end. Soleil Clusters shares a live board with one link that opens in any browser — no account, no install. FigJam's 24-hour guest access lets outsiders join without logging in, and Adobe Express review flows work without an Adobe account. Avoid tools that only export static files."
      },
      {
        "q": "What is the best mood board software for teams?",
        "a": "For a production team, Soleil Clusters: real-time multiplayer editing, free editors, and a flat $25/mo Creator plan that does not multiply per person. For big workshop groups, Miro allows unlimited members even on its free plan. Milanote is strong but per-person at $9.99/mo billed annually, so team cost scales with headcount."
      },
      {
        "q": "Canva or Milanote for mood boards?",
        "a": "Canva if the board is the deliverable — its templates produce a polished, client-ready page faster. Milanote if the board is for thinking — a calmer freeform surface with better planning structure, though its free plan caps at 100 cards. Neither is built for a crew acting on the board afterward — that is the gap we built Clusters for."
      },
      {
        "q": "What is the difference between a mood board and a look book in film?",
        "a": "A mood board is exploratory — a working surface where tone, palette, and reference get argued into agreement. A look book is declarative — the curated, sequenced presentation of the decided look, made for pitching and department alignment. The board is where you decide; the look book is how you announce it. Good tools let the first become the second without starting over."
      },
      {
        "q": "What happened to GoMoodboard?",
        "a": "It shut down around November 2024, when gomoodboard.com began redirecting to Dribbble — it had been a free side project of the Crew marketplace. The lapsed domain now displays a law-enforcement seizure banner. Roundups that still list GoMoodboard as a live free option have not checked their own links."
      },
      {
        "q": "What happened to InVision? Can I still use Freehand for mood boards?",
        "a": "No. InVision shut down its design-collaboration services at the end of 2024. Freehand, its whiteboard, was acquired by Miro in fall 2023 and discontinued on the same timeline — invisionapp.com now redirects to miro.com. If a roundup still recommends Freehand for mood boards, it was written before 2025 and never re-checked."
      },
      {
        "q": "Is Kosmik still available?",
        "a": "No. Kosmik announced its wind-down on April 24, 2026 and sunset the service on May 31, 2026; sign-ups were disabled and users were pointed to data export. Its pricing page is still live, which keeps fooling listicles into recommending it. The built-in-browser capture idea was genuinely good — but you cannot sign up."
      }
    ],
    "related": [
      "/tools/mood-board-maker",
      "/tools/free-mood-board-maker",
      "/vs/milanote",
      "/use-cases"
    ],
    "cta": {
      "label": "Start a mood board — free",
      "sub": "No credit card. Your first board in seconds."
    }
  },
];

// Curated example boards per page — the "steal these boards" template strip.
// Slugs of published /c/<slug> boards (first = hero shot on our item card).
const EXAMPLES_BY_PATH = {
  '/best/pureref-alternatives': ['film-noir-look-book', 'neon-noir-look-book', 'japandi-living-room'],
  '/best/milanote-alternatives': ['japandi-living-room', 'screenplay-beat-sheet', 'neon-noir-look-book'],
  '/best/mood-board-apps': ['japandi-living-room', 'sage-terracotta-wedding', 'world-cup-2026-moodboard'],
};

// Attach derived fields (mirrors seoLanding.js's attach loop).
for (const p of PAGES) {
  const campaign = p.path.replace(/^\//, '').replace(/\//g, '_');
  p.cta = { ...p.cta, href: SIGNUP(campaign) };
  p.exampleSlugs = EXAMPLES_BY_PATH[p.path] || [];
  p.eyebrow = 'Tested & ranked';
  p.author = AUTHOR;
}

const BY_PATH = new Map(PAGES.map((p) => [p.path, p]));

export const SEO_LISTICLE_PAGES = PAGES;
export const SEO_LISTICLE_PATHS = PAGES.map((p) => p.path);

// Normalize a request pathname (lowercase, strip trailing slash) and return the
// matching spec, or null. Same contract as getLandingSpec.
export function getListicleSpec(pathname) {
  if (!pathname) return null;
  let p = pathname.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return BY_PATH.get(p) || null;
}

// The table of contents is DERIVED, never authored — both renderers call this,
// so the TOC cannot drift between the crawlable HTML and the React page.
// Section ids here are also the DOM ids the renderers must emit.
export function listicleToc(spec) {
  return [
    { id: 'answer', label: spec.answerHeading },
    { id: 'table', label: 'Comparison table' },
    { id: 'thesis', label: spec.thesis.heading },
    { id: 'method', label: spec.methodology.heading },
    { id: 'picks', label: spec.itemsHeading },
    { id: 'personas', label: 'Which one fits you?' },
    { id: 'mentions', label: 'Honorable mentions' },
    { id: 'honest', label: spec.honestAccounting.heading },
    { id: 'faq', label: 'Frequently asked questions' },
  ];
}
