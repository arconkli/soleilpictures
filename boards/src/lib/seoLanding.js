// Self-authored SEO landing pages — the data registry.
//
// This is a PURE-DATA module (no imports, no JSX) so it can be imported by BOTH
// the React component (src/pages/SeoLandingPage.jsx) and the Cloudflare Worker
// (src/worker.js) — the Worker can't import JSX, and duplicating the copy would
// let the crawlable server-rendered text drift from what React renders
// (anti-cloaking). One source of truth for both.
//
// Each page targets a high-intent search term that describes what Clusters DOES,
// so these rank WITHOUT needing user-uploaded boards. Every page must carry
// genuinely unique, substantive copy — Google demotes thin/duplicate "doorway"
// pages, so no page here is a template clone of another.
//
// Page spec shape:
//   {
//     path:            '/tools/mood-board-maker',   // canonical pathname (no trailing slash)
//     kind:            'tool' | 'compare' | 'hub',
//     title:           '<title> — ≤60 chars, keyword-first',
//     metaDescription: '≤155 chars, unique',
//     h1:              'On-page headline',
//     subhead:         'One-line value prop under the H1',
//     answer:          '40–60 word direct answer to the page's head query — the
//                       first content block. AI answer engines quote extractable,
//                       self-contained answers; this is the block they lift.',
//     updated:         'YYYY-MM-DD — bump ONLY when the page copy meaningfully
//                       changes (rendered visibly, JSON-LD dateModified, sitemap
//                       lastmod). Honest dates only: fake freshness trains
//                       Google to ignore the field.',
//     steps?:          [{ t, d }] + stepsHeading,   // how-to block (tool pages)
//     sections:        [{ heading, body, bullets?: string[] }],   // 3–4 unique sections
//     faq:             [{ q, a }],   // FAQPage JSON-LD — SERP rich results are dead
//                                    // (May 2026); kept for AI-answer citation.
//     compare?:        { competitor, intro, rows: [{ feature, us, them }] }, // alt-to pages
//     related:         ['/other/path', ...],       // internal-linking spokes
//     cta:             { label, sub? },             // hero call-to-action
//   }

const SIGNUP = (campaign) =>
  `/?utm_source=seo&utm_medium=landing&utm_campaign=${campaign}`;

const PAGES = [
  // ────────────────────────────────────────────────────────────────────────
  // TOOL PAGES — highest commercial intent (people searching to DO the thing)
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/tools/mood-board-maker',
    kind: 'tool',
    title: 'Mood Board Maker — Free Online Canvas for Creative Teams',
    metaDescription:
      'Make a mood board online, free. Drag images, notes, and palettes onto an infinite canvas, build it live with your team, and share it with one link.',
    h1: 'Mood Board Maker',
    subhead:
      'Pull your references, colors, and notes onto one infinite canvas — then share the whole board with a single link.',
    answer:
      'Soleil Clusters is a free online mood board maker: drag images, links, video, and color palettes onto an infinite canvas, arrange them freely, and share the finished board with one link. It runs in the browser with no download, supports real-time collaboration, and is built for film, photo, and design teams.',
    updated: '2026-07-07',
    cta: { label: 'Start a mood board — free', sub: 'No credit card. Your first board in seconds.' },
    stepsHeading: 'How to make a mood board',
    steps: [
      { t: 'Start a board', d: 'Open Clusters and create a blank board — an infinite canvas you can pan and zoom.' },
      { t: 'Drop in your references', d: 'Drag images, screenshots, links, and files straight onto the canvas; Clusters tags and files each one for you.' },
      { t: 'Add color and notes', d: 'Pull a color palette and add rich-text notes or a brief right beside the imagery.' },
      { t: 'Arrange and connect', d: 'Move cards freely, group related references, and draw arrows to show how ideas relate.' },
      { t: 'Share it', d: 'Send one link for a clean, interactive preview — or invite your team to build the board live with you.' },
    ],
    sections: [
      {
        heading: 'Everything in one place, not fifteen tabs',
        body: 'A mood board is only useful when everything lives together. Clusters lets you drop images, screenshots, links, PDFs, video, and color palettes onto the same canvas, arrange them freely, and pull relationships between them with arrows. Drop a file and Clusters reads it, tags it, and files it to the right board automatically — so the board organizes itself as it grows.',
        bullets: [
          'Drag in images, links, video, PDFs, and any file type',
          'Auto-tagging files each reference to the right board',
          'Color palettes and notes sit right beside the imagery',
        ],
      },
      {
        heading: 'Build it together, in real time',
        body: 'Most mood boards are a team decision. Clusters is a live canvas — your director, designer, and client can be on the same board at once, with live cursors, comments, and presence. No more emailing a static PDF back and forth and losing the thread. When someone drops a new reference, everyone sees it appear.',
      },
      {
        heading: 'Share it, or keep it locked',
        body: 'Send a board to a client or collaborator with one link — they see a clean, interactive preview with no account required. Or keep it private. You own your references, and you control exactly who sees them and whether search engines can find them.',
      },
    ],
    faq: [
      { q: 'Is the mood board maker free?', a: 'Yes. You can start building and sharing mood boards for free with the Demo tier. Creator ($25/mo) unlocks unlimited boards, 100GB storage, any file type, and Edit Mode for collaborators.' },
      { q: 'Can I make a mood board with my team?', a: 'Yes — Clusters is a real-time collaborative canvas. Multiple people can edit the same board at once with live cursors, comments, and presence, so your whole team can build the board together.' },
      { q: 'What can I put on a mood board?', a: 'Images, screenshots, links, video, audio, PDFs, rich-text notes, color palettes, and any other file type. Everything lives on one infinite canvas you can pan and zoom.' },
      { q: 'Can I share a mood board without making people sign up?', a: 'Yes. Every board can be shared with a single public link that opens a clean, interactive read-only preview — no account required for viewers.' },
      { q: 'Do I need to install anything?', a: 'No. Clusters runs in your browser, with native iOS and Android apps if you want them. There is nothing to download to get started.' },
    ],
    related: ['/tools/storyboard-maker', '/tools/look-book-maker', '/vs/milanote', '/vs/pureref', '/use-cases'],
  },
  {
    path: '/tools/storyboard-maker',
    kind: 'tool',
    title: 'Storyboard Maker — Free Online Tool for Film Teams',
    metaDescription:
      'Make a storyboard online: drop frames in a grid, caption and re-order shots, keep the shot list beside the frames, and share one link with your crew.',
    h1: 'Storyboard Maker',
    subhead:
      'Lay your shots out in a grid, drop in frames and reference, and keep the shot list right beside them.',
    answer:
      'Soleil Clusters is an online storyboard maker: split a grid card into panels, drop a still or sketch into each frame, caption and re-order shots by dragging, and keep the shot list beside the boards. Your director, DP, and AD can edit the same storyboard live, and one link shares it with the whole crew.',
    updated: '2026-07-07',
    cta: { label: 'Start a storyboard — free', sub: 'No credit card. Free to start.' },
    stepsHeading: 'How to make a storyboard',
    steps: [
      { t: 'Add a grid card', d: 'Drop a grid onto the board and split it into the number of panels your sequence needs.' },
      { t: 'Fill each frame', d: 'Drop a reference still or a sketch into each cell, and caption it with the action.' },
      { t: 'Order your shots', d: 'Drag panels to re-sequence the scene, and number them automatically.' },
      { t: 'Add the shot list', d: 'Put a doc or schedule card beside the frames for lens, camera movement, and shoot day.' },
      { t: 'Share with the crew', d: 'Send one link, or invite your DP and AD to edit and comment on the frames in real time.' },
    ],
    sections: [
      {
        heading: 'A grid built for sequences',
        body: "Clusters' grid cards give you a clean, modular storyboard layout: split any cell, drop an image or sketch into each frame, and re-order shots by dragging. Number the panels automatically, add a caption under each, and the whole sequence reads top to bottom the way your crew will shoot it.",
        bullets: [
          'Modular grid cells you can split and re-arrange',
          'Auto-numbered panels with captions',
          'Sketch directly on frames or drop in reference stills',
        ],
      },
      {
        heading: 'Shot list and storyboard, side by side',
        body: 'A storyboard without a shot list is half the picture. Put a rich-text doc or schedule card right next to your frames — lens, movement, location, day — so the visual and the logistics never drift apart. Screenplay mode is built in if you want to write the scene beside the board.',
      },
      {
        heading: 'Get the crew on the same page',
        body: 'Share the storyboard with a link, or invite your DP and 1st AD to edit alongside you in real time. Comments land right on the frame in question, so feedback is specific instead of a paragraph in an email.',
      },
    ],
    faq: [
      { q: 'How do I make a storyboard in Clusters?', a: 'Add a grid card, split it into the number of panels you need, then drop a reference still or sketch into each cell and caption it. You can re-order panels by dragging and number them automatically.' },
      { q: 'Can I draw my own frames?', a: 'Yes. You can sketch directly on the canvas with the draw tools, or drop in reference photos, screenshots, or AI-generated frames — whatever your process uses.' },
      { q: 'Can I keep a shot list with the storyboard?', a: 'Yes. Put a doc or schedule card beside your frames to track lens, camera movement, location, and shoot day, so the visual board and the logistics stay together.' },
      { q: 'Can my crew collaborate on the storyboard?', a: 'Yes — Clusters is real-time. Your director, DP, and AD can edit and comment on the same storyboard at once with live cursors and presence.' },
      { q: 'Is it free?', a: 'You can build and share storyboards for free on the Demo tier. Creator ($25/mo) adds unlimited boards, 100GB storage, and Edit Mode for collaborators.' },
    ],
    related: ['/tools/shot-list-maker', '/tools/mood-board-maker', '/vs/storyboarder', '/vs/boords', '/use-cases'],
  },
  {
    path: '/tools/shot-list-maker',
    kind: 'tool',
    title: 'Shot List Maker — Visual Shot Lists Your Crew Can Use',
    metaDescription:
      'Build a shot list your crew will actually use: every shot carries its reference frame, lens, and notes. Toggle canvas or list view. Share one live link.',
    h1: 'Shot List Maker',
    subhead:
      'Keep your shots, reference frames, and schedule on one board — visual and organized, not buried in a spreadsheet.',
    answer:
      'Soleil Clusters is a visual shot list maker: every shot gets its own card with a reference frame, lens, and movement notes, and the board toggles between a freeform canvas and a clean list view. Link it to your storyboard and mood board, map shots to shoot days with a schedule card, and share one live link with the crew.',
    updated: '2026-07-22',
    cta: { label: 'Build a shot list — free', sub: 'Free to start. No install.' },
    stepsHeading: 'How to make a shot list',
    steps: [
      { t: 'Start a board for the scene', d: 'One board per scene or setup keeps the day organized.' },
      { t: 'Add a card per shot', d: 'Give each shot its own card with a reference frame plus lens and movement notes.' },
      { t: 'Switch views as needed', d: 'Toggle to list view for a clean table; back to canvas to see the frames.' },
      { t: 'Map shots to days', d: 'Add a schedule card to tie each shot to its shoot day and location.' },
      { t: 'Share live', d: 'Invite the crew so everyone works from one source of truth that updates in real time.' },
    ],
    sections: [
      {
        heading: 'A shot list with pictures, not just rows',
        body: 'A spreadsheet tells you what to shoot; it never shows you. In Clusters your shot list lives on a visual board, so each shot can carry its own reference frame, lens note, and movement right beside the description. Switch a board to list view when you want the clean table, and back to canvas when you want to see it.',
        bullets: [
          'Every shot carries its reference frame and notes',
          'Toggle between visual canvas and a clean list view',
          'Add a schedule card to map shots to shoot days',
        ],
      },
      {
        heading: 'Tie it to your storyboard and mood board',
        body: 'Your shot list should not live in a different app than your storyboard. Link boards together — the relationship graph shows how your shot list connects to the storyboard, the location scout, and the mood board, and you can jump between them in a click.',
        bullets: [
          'Link the shot list to its storyboard and mood board',
          'The relationship graph shows the whole project',
          'Jump between connected boards in one click',
        ],
      },
      {
        heading: 'From shot list to shoot day',
        body: 'A shot list earns its keep on the day. Add a schedule card to map every shot to its shoot day and location, and when the plan changes — a company move runs long, a setup gets dropped — update the board once and the whole crew sees it live. If someone insists on paper, export to PDF and hand it to them.',
        bullets: [
          'Schedule card maps shots to days and locations',
          'Changes propagate live to everyone on the link',
          'PDF export for the paper people',
        ],
      },
      {
        heading: 'One source of truth for the whole crew',
        body: 'Share the shot list with a link or invite the team to edit live. When something changes on set, it changes for everyone at once — no more three conflicting versions of the same PDF floating around the unit.',
      },
    ],
    faq: [
      { q: 'How is this better than a shot list spreadsheet?', a: 'Each shot can carry its own reference frame, lens, and movement notes on a visual board, and you can still toggle to a clean list view. It connects directly to your storyboard, mood board, and schedule instead of living in a separate file.' },
      { q: 'Can I organize shots by scene or day?', a: 'Yes. Group shots on the canvas, use nested boards per scene, and add a schedule card to map each shot to its shoot day and location.' },
      { q: 'Can the crew see updates in real time?', a: 'Yes. Clusters is a live board, so when you change a shot everyone viewing or editing sees the update immediately.' },
      { q: 'Can I export or share the shot list?', a: 'Yes. Share a live link with your crew, or export boards and docs to PDF.' },
      { q: 'Is it free to start?', a: 'Yes, the Demo tier is free. Creator ($25/mo) unlocks unlimited boards, 100GB storage, and Edit Mode.' },
      { q: 'How do I make a shot list for a short film?', a: 'Make a board per scene, add a card per shot with its reference frame, lens, and movement, then add a schedule card to map shots to days. Open the short-film shot list example board below to see a finished one.' },
      { q: 'Does Clusters have a shot list template?', a: 'The fastest start is the public short-film shot list example board — open it, see how the shot cards and schedule are structured, and rebuild that structure in your own board in a few minutes.' },
      { q: 'Is this a shot planner?', a: 'Yes — planning the shots is the whole point. Each shot card carries its reference frame, lens, and movement, the schedule card maps shots to shoot days and locations, and the crew works from one live board. If what you searched for was a shot planner, this is that tool with the pictures kept in.' },
    ],
    related: ['/tools/storyboard-maker', '/tools/mood-board-maker', '/vs/studiobinder', '/use-cases'],
  },
  {
    path: '/tools/look-book-maker',
    kind: 'tool',
    title: 'Look Book Maker — Client-Ready Lookbooks in Minutes',
    metaDescription:
      'Make a look book online. Arrange looks in clean grid spreads, unify them with photo adjustments, and send clients one polished, interactive link.',
    h1: 'Look Book Maker',
    subhead:
      'Arrange looks, references, and color stories on one canvas — then send a polished, interactive link.',
    answer:
      'Soleil Clusters is an online look book maker: arrange imagery in clean grid spreads, unify the set with non-destructive photo adjustments, add color palettes for the season’s story, and send clients one link to a polished, interactive presentation — no account or download required to view it.',
    updated: '2026-07-07',
    cta: { label: 'Make a look book — free', sub: 'Free to start. Share with one link.' },
    stepsHeading: 'How to make a look book',
    steps: [
      { t: 'Start a board and set the mood', d: 'Begin with a blank canvas — or a nested board per season, campaign, or client.' },
      { t: 'Drop in your looks', d: 'Add your imagery and references, then crop and adjust them non-destructively to unify the set.' },
      { t: 'Arrange the spreads', d: 'Use grid layouts for tidy, editorial spreads that read intentionally.' },
      { t: 'Pull a color story', d: 'Add a palette card so the color direction sits right in the presentation.' },
      { t: 'Send a link', d: 'Share a single link for a polished, interactive look book — no account needed to view.' },
    ],
    sections: [
      {
        heading: 'Composed, not cluttered',
        body: 'A look book is a presentation. Clusters gives you a clean canvas with grids, palettes, and image cards you can crop, adjust, and arrange until each spread reads exactly the way you want. Non-destructive photo adjustments — brightness, contrast, warmth, black and white — let you unify a set of references without leaving the board.',
        bullets: [
          'Grid layouts for tidy, editorial spreads',
          'Non-destructive image adjustments to unify a look',
          'Color palettes pulled right into the story',
        ],
      },
      {
        heading: 'Built for showing clients',
        body: 'Share a look book with a single link and the recipient sees a clean, interactive preview — pan, zoom, and open images full screen — with no account and no app to install. It always looks intentional, because it is the real board, not a flattened export.',
      },
      {
        heading: 'Keep every project’s looks together',
        body: 'Nest boards inside boards so a season, a campaign, or a client each has its own space, and use the relationship graph to move between them. Everything you reference stays yours, at up to 100GB with any file type on Creator.',
      },
    ],
    faq: [
      { q: 'What is a look book maker?', a: 'A tool for arranging fashion, photography, or brand "looks" — imagery, references, and color palettes — into a polished, shareable presentation. Clusters does this on an infinite, collaborative canvas.' },
      { q: 'Can I adjust images inside the look book?', a: 'Yes. Clusters has non-destructive photo adjustments — brightness, contrast, saturation, warmth, black and white — so you can unify a set of references without a separate editor.' },
      { q: 'How do I share a look book with a client?', a: 'Send one link. The client sees a clean, interactive read-only preview with no account required, and you control whether it can be indexed by search engines.' },
      { q: 'Can I keep multiple look books organized?', a: 'Yes. Nest boards inside boards so each season, campaign, or client has its own space, and navigate between them with the relationship graph.' },
      { q: 'Is it free?', a: 'You can start free on the Demo tier. Creator ($25/mo) adds unlimited boards, 100GB storage, and any file type.' },
    ],
    related: ['/tools/mood-board-maker', '/vs/milanote', '/use-cases'],
  },
  {
    path: '/tools/free-mood-board-maker',
    kind: 'tool',
    title: 'Free Mood Board Maker — No Credit Card, No Download',
    metaDescription:
      'A genuinely free mood board maker — no credit card, no download, no trial clock. Drop images, notes, and palettes on an infinite canvas; share a link.',
    h1: 'Free Online Mood Board Maker',
    subhead:
      'Runs in your browser. Drop images, notes, and palettes on an infinite canvas and share with a link — no download.',
    answer:
      'Yes — you can make a mood board online free with Soleil Clusters. The Demo tier needs no credit card: open the browser app, drop in images, links, notes, and color palettes on an infinite canvas, and share the board with a public link. Upgrading only matters when you want unlimited boards and 100GB storage.',
    updated: '2026-07-07',
    cta: { label: 'Make one free', sub: 'No credit card. No install.' },
    stepsHeading: 'How to make a mood board online, free',
    steps: [
      { t: 'Open Clusters in your browser', d: 'There is nothing to download — just open it and start.' },
      { t: 'Create a board', d: 'Make a blank board and drag in images, links, and notes.' },
      { t: 'Add a color palette', d: 'Drop a palette card to set the tone of the board.' },
      { t: 'Arrange it', d: 'Move everything around on the infinite canvas until it reads the way you want.' },
      { t: 'Share it free', d: 'Send your board with a link — viewers need no sign-up to see it.' },
    ],
    sections: [
      {
        heading: 'Free, and actually usable',
        body: 'A lot of "free" tools are a demo with a wall. Clusters’ Demo tier lets you build a real mood board — images, notes, links, and color palettes on an infinite canvas — and share it, without paying and without installing anything. When you outgrow it, Creator is $25/mo for unlimited boards and 100GB.',
        bullets: [
          'Works in any modern browser — nothing to download',
          'Drop in images, links, video, notes, and palettes',
          'Share the finished board with a single link',
        ],
      },
      {
        heading: 'From a quick pin to a real project',
        body: 'Start with a scratch board of references, then grow it into a structured project as the idea firms up: nest boards, connect them, and let auto-tagging keep things filed. You never have to migrate to a "real" tool later — this is the real tool.',
      },
      {
        heading: 'Made for creative work',
        body: 'This is not a generic whiteboard. Clusters is built for film, photo, design, and brand teams — with color palettes, image adjustments, docs, and a relationship graph that ties a whole project together. The free tier is a genuine on-ramp to all of it.',
      },
    ],
    faq: [
      { q: 'Is it really free?', a: 'Yes. The Demo tier lets you build and share mood boards for free, with no credit card. Creator ($25/mo) unlocks unlimited boards, 100GB storage, any file type, and Edit Mode.' },
      { q: 'Do I have to download anything?', a: 'No. It runs in your browser. Native iOS and Android apps are available if you prefer, but nothing is required to start.' },
      { q: 'What is the catch with the free tier?', a: 'The Demo tier is a generous sandbox capped at a set number of cards; collaborators view in read-only mode. Upgrading to Creator removes the cap and adds Edit Mode and 100GB storage.' },
      { q: 'Can I share my free mood board?', a: 'Yes. Every board can be shared with a public link that opens a clean, interactive preview with no sign-up needed.' },
      { q: 'Will my boards stay mine?', a: 'Yes. You own your references and control who can see each board and whether it is discoverable by search engines.' },
    ],
    related: ['/tools/mood-board-maker', '/vs/pureref', '/vs/milanote', '/use-cases'],
  },
  {
    path: '/tools/reference-board-maker',
    kind: 'tool',
    title: 'Reference Board Maker — Free Online Reference Boards',
    metaDescription:
      'Make a reference board online: drag images onto an infinite canvas, check values in B&W, and open the same board on any device. Free, nothing to install.',
    h1: 'An Online Reference Board Maker for Working Artists',
    subhead:
      'Drop reference onto an infinite canvas in your browser. The same board follows you to every machine, and one link shows your art director exactly what you’re looking at.',
    answer:
      'Soleil Clusters is a free online reference board maker: drop images onto an infinite canvas, arrange and zoom them while you work, and open the same board from any device’s browser with nothing to install. One link shares it read-only. The tradeoff: it lives online — for offline reference, desktop PureRef still earns its place.',
    updated: '2026-07-22',
    cta: { label: 'Make a reference board', sub: 'Free Demo tier — no credit card, no trial clock.' },
    stepsHeading: 'How to make a reference board',
    steps: [
      { t: 'Gather everything in one place', d: 'Drag images, screenshots, and stills straight onto a new board. Paste links to pieces you found online, and drop in video clips or PDFs when your reference isn’t a still image.' },
      { t: 'Arrange by what you’re studying', d: 'Cluster the board around the problem — one area for lighting, one for anatomy, one for materials. The infinite canvas never runs out of room, and you can zoom from the whole board down to a single edge.' },
      { t: 'Tune the reference, not the file', d: 'Flip an image to black and white to read its values, nudge brightness or warmth to match your scene, and pull a color palette from any image. Adjustments are non-destructive, so the original stays intact.' },
      { t: 'Open it wherever you work', d: 'The board lives at a URL, so the same reference is on your workstation, your laptop, and your tablet — no files to move, nothing to install.' },
      { t: 'Show it when you’re ready', d: 'Send one link and your art director sees a clean, read-only version of the board in their browser — no account required.' },
    ],
    sections: [
      {
        heading: 'Reference boards and mood boards are different tools',
        body: 'A mood board is made to be shown — it argues for a direction in a pitch or a client deck. A reference board is made to be used: it’s the sheet of images an artist keeps open beside the canvas while actually painting, modeling, lighting, or grading. Concept artists collect anatomy and costume studies. Illustrators pin lighting setups and hand poses. 3D artists gather material close-ups. Film crews pull frames from other movies to hold a look steady across a shoot. The job is fast visual recall at working speed — glance, zoom into a detail, glance back — and a reference board maker is judged on how little it interrupts that loop.',
      },
      {
        heading: 'Why artists reached for desktop apps first',
        body: 'For years the answer to this job was a desktop program — most famously PureRef, a lightweight stand-alone app for Windows, Mac, and Linux that’s free for personal use. It earned its reputation honestly: it opens fast and stays out of the way. The limits only appear at the edges of a solo workflow. The app installs anywhere, but the board itself is a local file — it only travels between the studio workstation and the laptop if you move it yourself, and getting it in front of an art director means sending files around instead of sending a link. That isn’t a flaw in the software — it’s simply the shape of desktop software.',
      },
      {
        heading: 'What a browser-based reference board changes',
        body: 'Moving the board into a browser tab removes those walls without changing the job.',
        bullets: [
          'One board, every machine — open the same URL at the studio, at home, or on an iPad and pick up exactly where you left off.',
          'Nothing to install — handy on locked-down studio workstations and borrowed machines alike.',
          'Share by link — a clean read-only view opens in anyone’s browser, no account required, so feedback doesn’t wait for an export.',
          'Comments land on the image — a note from your art director pins to the exact card it’s about, not to a chat thread somewhere else.',
          'Real-time collaboration — on a shared board you see teammates’ live cursors as they move through the reference.',
        ],
      },
      {
        heading: 'Tools that match how reference actually gets used',
        body: 'Clusters treats a reference board as a working surface, not a gallery.',
        bullets: [
          'Check your values — flip any image to black and white, or nudge brightness, contrast, saturation, and warmth. Every adjustment is non-destructive.',
          'Steal the palette — extract a color palette from any image and keep it on the board beside the work it came from.',
          'Reference beyond stills — boards hold video, audio, PDFs, links, and rich-text notes alongside images; Creator accepts any file type.',
          'Sketch over it — draw directly on the canvas to mark a gesture line or call out a detail.',
          'One board per problem — nest boards inside boards so a project’s costume, lighting, and environment reference each stay findable, and auto-tagging files a dropped image to the right board for you.',
        ],
      },
      {
        heading: 'Free to start, flat when you grow',
        body: 'The Demo tier is genuinely free: no credit card, no trial countdown, and a generous card cap. Collaborators can view Demo boards read-only. When a team needs shared editing, any file type, or serious storage, Creator is a flat $25 a month — not per seat — with unlimited boards, 100GB of storage, and Edit Mode for collaborators.',
      },
      {
        heading: 'The case for staying on desktop',
        body: 'A browser tool isn’t the answer for everyone, and it’s worth being plain about it. Clusters needs a connection — it can’t ride along on a flight or an air-gapped workstation. If your reference never needs to leave your own machine, a local app like PureRef is hard to argue with: pay-what-you-want for personal use, and it does one thing very well. The honest split is this — work alone and offline, and the desktop standard fits; work across devices or with other people, and the browser wins. If you’re weighing the two directly, our full PureRef comparison includes the rows PureRef wins.',
      },
    ],
    faq: [
      { q: 'What is a reference board?', a: 'A reference board is a collection of images an artist keeps in view while working — anatomy studies, lighting setups, material close-ups, frames from films. Unlike a presentation deck, it’s built for the artist’s own eyes: the point is fast glancing and zooming while you paint, model, or shoot.' },
      { q: 'What’s the difference between a reference board and a mood board?', a: 'A mood board communicates a direction to other people; a reference board supports the work itself. Mood boards get presented once, while reference boards stay open for the whole life of the piece. Clusters handles both, but this page is about the working kind.' },
      { q: 'Is there a free online reference board maker?', a: 'Yes — Soleil Clusters’ Demo tier is free with no credit card and no trial clock, and comes with a generous card cap. It runs in the browser with nothing to install.' },
      { q: 'Do I need to install anything to make a reference board?', a: 'No. Clusters runs entirely in the browser on any machine, which matters on studio workstations where you can’t install software. Native iOS and Android apps are also available if you prefer one on mobile.' },
      { q: 'Can I use a reference board on an iPad?', a: 'Yes. Boards open in the tablet’s browser, and there’s a native iOS app as well — the same board you arranged on your workstation is waiting when you pick up the iPad.' },
      { q: 'Can my team or art director see my reference board?', a: 'Yes — one public link opens a clean, read-only view in any browser, with no account required. On the Creator plan, collaborators can also edit the board live, with real-time cursors and comments pinned to specific images.' },
      { q: 'Can a reference board include video or other files?', a: 'Yes. Cards can be images, screenshots, links, video, audio, PDFs, notes, and color palettes — and on Creator, any file type. Motion reference sits on the board right next to your stills.' },
      { q: 'How does an online reference board compare to PureRef?', a: 'PureRef is a beloved offline desktop app — free to use personally, and excellent when the board never leaves your machine. Clusters trades offline for a board that follows you across devices and shares with a link. Our full PureRef comparison breaks it down feature by feature.' },
    ],
    related: ['/vs/pureref', '/tools/mood-board-maker', '/tools/free-mood-board-maker', '/use-cases'],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ALTERNATIVE-TO PAGES — capture people already shopping for a tool
  // Positioning is honest: competitors' genuine strengths are acknowledged.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/vs/milanote',
    kind: 'compare',
    title: 'Free Milanote Alternative — No Item Caps, Real-Time Teams',
    metaDescription:
      'The free Milanote alternative without item caps — a real-time multiplayer canvas with auto-tagging, 100GB storage, and sharing, built for production teams.',
    h1: 'A Milanote Alternative Built for Production Teams',
    subhead:
      'Milanote is a lovely place to think. Clusters is where a team pulls a whole production together — live, on one canvas.',
    answer:
      'Soleil Clusters is a free Milanote alternative built for team production work: a real-time multiplayer canvas with live cursors, auto-tagging that files dropped references for you, a relationship graph connecting whole projects, and no hard item cap on the free tier — Creator is a flat $25/mo with 100GB storage. Milanote remains strong for solo planning; Clusters is for visual, media-heavy, collaborative work.',
    updated: '2026-07-22',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    sections: [
      {
        heading: 'Where Clusters is different',
        body: 'Both tools are beautiful, board-based, and made for creative work. Clusters leans harder into real-time team production: a live multiplayer canvas with cursors and presence, auto-tagging that files your references for you, a relationship graph that connects a whole project, and 100GB of storage for any file type on Creator. If you are organizing a shoot or a campaign with a team, that is the difference.',
        bullets: [
          'Live multiplayer canvas with cursors and presence',
          'Auto-tagging files dropped references for you',
          'A relationship graph connects the whole project',
        ],
      },
      {
        heading: 'A free Milanote alternative without the item wall',
        body: 'Milanote’s free plan caps the total number of items you can add — around a hundred notes, images, and links across everything — which tends to run out right in the middle of a real project. And its paid plans are priced per person. Clusters’ free Demo tier is a generous sandbox with no time limit, and Creator is a flat $25/mo for unlimited boards, 100GB of storage, and any file type — not a price that multiplies with every teammate you bring in.',
        bullets: [
          'No trial clock on the free Demo tier',
          'Flat $25/mo Creator — not per-person pricing',
          'Unlimited boards and 100GB on Creator',
        ],
      },
      {
        heading: 'For filmmakers: from mood board to shot list',
        body: 'Milanote markets itself to filmmakers, and its planning templates are genuinely pleasant. Where Clusters pulls ahead is when pre-production gets real: the mood board, the storyboard grid, the visual shot list, and the schedule are linked boards in one project, with screenplay mode built in for writing beside the imagery. Your DP and AD edit the same boards live, and the whole pre-pro package shares with one link the producer can open without an account.',
        bullets: [
          'Mood board, storyboard, and shot list as connected boards',
          'Screenplay mode and docs beside the imagery',
          'The whole crew on the same boards, live',
        ],
      },
      {
        heading: 'Honest about what Milanote does well',
        body: 'Milanote has a polished template library and a long track record, and its writing-and-planning flow is genuinely nice for solo ideation. If you mostly work alone on lightweight planning boards, it is a strong tool. Clusters earns its place when the work is visual, media-heavy, and collaborative — and when you do not want per-board or per-item caps getting in the way.',
      },
      {
        heading: 'Switching is painless',
        body: 'Start a board, drag your references in, and share a link — there is nothing to install and nothing to migrate up front. Your Demo boards are free, and you only move to Creator when you want unlimited boards and 100GB.',
      },
    ],
    compare: {
      competitor: 'Milanote',
      intro: 'How the two compare on the things production teams care about:',
      rows: [
        { feature: 'Real-time multiplayer canvas (live cursors)', us: 'Yes', them: 'Limited' },
        { feature: 'Auto-tagging of dropped files', us: 'Yes', them: 'No' },
        { feature: 'Relationship graph across boards', us: 'Yes', them: 'No' },
        { feature: 'Any file type, up to 100GB', us: 'Yes (Creator)', them: 'Limited' },
        { feature: 'Video & audio on the board', us: 'Yes', them: 'Limited' },
        { feature: 'Built-in docs & screenplay mode', us: 'Yes', them: 'Notes' },
        { feature: 'Share a live, interactive link', us: 'Yes', them: 'Yes' },
        { feature: 'Free tier', us: 'Yes', them: 'Yes (capped)' },
        { feature: 'Free-plan item cap', us: 'Generous card cap', them: 'Caps total items' },
        { feature: 'Template library', us: 'Growing', them: 'Extensive' },
      ],
    },
    faq: [
      { q: 'Is Soleil Clusters a good Milanote alternative?', a: 'Yes, especially for teams doing visual, media-heavy, collaborative work. Clusters adds a real-time multiplayer canvas, auto-tagging, a relationship graph, and 100GB storage for any file type on Creator.' },
      { q: 'How is Clusters different from Milanote?', a: 'Clusters focuses on live team production — multiplayer editing with cursors and presence, automatic organization of dropped files, and connecting a whole project through a relationship graph — rather than solo planning boards.' },
      { q: 'Does Clusters have a free tier like Milanote?', a: 'Yes. The Demo tier is free with no credit card. Creator is $25/mo for unlimited boards, 100GB storage, any file type, and Edit Mode.' },
      { q: 'Can I move my Milanote boards over?', a: 'You can drag your images, links, and files straight into a new Clusters board and share it — there is no complex migration to do first.' },
      { q: 'Does Milanote limit how many items I can add?', a: 'Milanote’s free plan caps the total number of items across your boards. Clusters’ free Demo tier is a sandbox with a generous card cap and no time limit, and Creator ($25/mo) removes the cap with unlimited boards and 100GB of storage.' },
      { q: 'Is Clusters cheaper than Milanote for a team?', a: 'Usually, because Clusters is flat-priced: Creator is $25/mo rather than a per-person subscription, and anyone you share a board with can view it free with one link.' },
      { q: 'Is there a free Milanote alternative without item caps?', a: 'Yes — Soleil Clusters. The free Demo tier has no trial clock and a generous card cap sized for real projects, instead of a hard limit of around a hundred total items. Creator ($25/mo, flat) removes the cap entirely.' },
      { q: 'What do filmmakers use instead of Milanote?', a: 'Many use Clusters, because pre-production is connected there: the mood board links to the storyboard, the shot list, and the schedule as one project, with screenplay mode built in — and the whole crew edits the same boards in real time.' },
      { q: 'Milanote vs Canva — and where does Clusters fit?', a: 'Canva is a template-driven graphics editor, strongest when the goal is a finished design. Milanote is a board app for planning and collecting ideas. Clusters covers that planning ground for production teams — a real-time multiplayer canvas with no hard item cap, where the finished board shares with one link a client can open without an account.' },
    ],
    related: ['/tools/mood-board-maker', '/tools/storyboard-maker', '/tools/shot-list-maker', '/vs/pureref', '/vs/miro', '/use-cases'],
  },
  {
    path: '/vs/pureref',
    kind: 'compare',
    title: 'Free PureRef Alternative — Online, Shareable, No Install',
    metaDescription:
      'The free PureRef alternative that runs online: the fast reference-board feel plus real-time collaboration, link sharing, and cloud sync. No install.',
    h1: 'A PureRef Alternative for Teams and the Cloud',
    subhead:
      'PureRef is a fast, offline reference window. Clusters is a collaborative reference workspace you can share and grow.',
    answer:
      'Soleil Clusters is a PureRef alternative that runs free in your browser: reference boards sync across devices, share with one link, and support real-time team editing. Boards hold notes, docs, video, and color palettes alongside images. PureRef still wins for a tiny offline desktop overlay; Clusters wins when reference needs to be shared.',
    updated: '2026-07-22',
    cta: { label: 'Try Clusters free', sub: 'Runs in your browser. Free to start.' },
    stepsHeading: 'How to move a PureRef board to Clusters',
    steps: [
      { t: 'Collect your images', d: 'Export the images from PureRef, or gather the original files you pinned.' },
      { t: 'Drag them onto a new board', d: 'Drop the whole set at once — auto-tagging files each reference as it lands.' },
      { t: 'Add what PureRef couldn’t hold', d: 'Put notes, links, video, and color palettes right beside the imagery.' },
      { t: 'Share one link', d: 'Send the board to your team or client — it opens in the browser, nothing to install.' },
    ],
    sections: [
      {
        heading: 'From a local window to a shared workspace',
        body: 'PureRef is a brilliant lightweight desktop app for pinning reference images while you work. Clusters takes reference boards to the cloud: they live in your browser, sync across devices, and can be shared with a link or edited by your whole team in real time. Your references are backed up and reachable from anywhere, not trapped in a file on one machine.',
        bullets: [
          'Opens in any browser — nothing to install or update',
          'Boards sync across devices and back up automatically',
          'Share a read-only link no one has to download',
        ],
      },
      {
        heading: 'Looking for PureRef online? This is that',
        body: 'There is no web version of PureRef — it is a desktop app, and artists have been asking its forum for an online, shareable version for years. Clusters is that tool: the same fast drop-images-and-arrange feel, running in the browser. Open your reference board on any machine and it is the same board — on your workstation, on a laptop at a review, or on an iPad on set. Nothing to install, nothing to sync by hand.',
        bullets: [
          'A reference board that opens with a URL, not a file',
          'Same board on desktop, laptop, and iPad',
          'Share it like a Google Doc — one link, live for everyone',
        ],
      },
      {
        heading: 'More than images',
        body: 'A reference board is rarely just pictures. Clusters cards can be images, notes, links, video, PDFs, color palettes, and docs — with non-destructive image adjustments built in — so your reference, your annotations, and your color story sit together instead of in three tools.',
        bullets: [
          'Notes, docs, video, PDFs, and palettes on one canvas',
          'Non-destructive image adjustments built in',
          'Pull a color palette straight from a reference image',
        ],
      },
      {
        heading: 'Switching from PureRef takes an afternoon',
        body: 'Bring your references over in one pass: export the images from PureRef (or gather the original files you pinned) and drag the whole set onto a new Clusters board. Auto-tagging reads and files each image as it lands, so the board organizes itself while you rebuild the layout you had — and stays organized as the project grows.',
        bullets: [
          'Drag a whole folder of references in at once',
          'Auto-tagging organizes images as they land',
          'One board per project — or nest boards inside it',
        ],
      },
      {
        heading: 'Reference boards your whole team can stand around',
        body: 'A PureRef file lives on one artist’s machine. In Clusters the whole team works from the same board: live cursors and presence show who is looking at what, comments pin to the exact image they are about, and a client or supervisor opens a clean read-only view with no account and nothing to install.',
        bullets: [
          'Live cursors and presence for the whole team',
          'Comments land on the exact reference they are about',
          'Clients view with a link — no account, no install',
        ],
      },
      {
        heading: 'When PureRef is still the right call',
        body: 'If you want a tiny, free, fully-offline window that floats over your art app and does one thing perfectly, PureRef is excellent and we will not pretend otherwise. Clusters is for when reference needs to be shared, collaborative, multi-media, and organized into a larger project.',
      },
    ],
    compare: {
      competitor: 'PureRef',
      intro: 'Two different philosophies for reference boards:',
      rows: [
        { feature: 'Runs in the browser (no install)', us: 'Yes', them: 'Desktop app' },
        { feature: 'Real-time collaboration', us: 'Yes', them: 'No' },
        { feature: 'Share with a link', us: 'Yes', them: 'No' },
        { feature: 'Notes, docs, palettes, video', us: 'Yes', them: 'Images only' },
        { feature: 'Cloud sync & backup', us: 'Yes', them: 'Local files' },
        { feature: 'Works on phones & tablets', us: 'Yes', them: 'Desktop only' },
        { feature: 'Comments & feedback on the board', us: 'Yes', them: 'No' },
        { feature: 'Color palette extraction', us: 'Yes', them: 'No' },
        { feature: 'Organize boards into projects', us: 'Yes — nested boards + graph', them: 'One file per board' },
        { feature: 'Fully offline', us: 'No', them: 'Yes' },
        { feature: 'Free to start', us: 'Yes', them: 'Pay what you want' },
      ],
    },
    faq: [
      { q: 'What is a good PureRef alternative with collaboration?', a: 'Among apps like PureRef, Soleil Clusters is the one built for collaboration: it keeps the fast, freeform reference-board feel but adds real-time editing, link sharing, cloud sync, and support for notes, docs, palettes, and video — not just images.' },
      { q: 'Is there an online version of PureRef?', a: 'No — PureRef is a desktop app with no official web version, and the community request for one has been open on its forum for years. Clusters fills that gap: a reference board that runs in the browser, syncs across devices, and shares with one link.' },
      { q: 'Milanote vs PureRef — which should I use?', a: 'They solve different problems: PureRef is an offline desktop window for pinning reference images while you work, and Milanote is a board app for planning and organizing ideas. Clusters sits between the two — the reference-board workflow, in the browser, with sharing and real-time collaboration. Our Milanote comparison covers that side in detail.' },
      { q: 'Is there an open-source PureRef alternative?', a: 'BeeRef is the best-known one — a free, open-source desktop reference board for Windows, Mac, and Linux. Like PureRef it is desktop-only, with no web version or collaboration. Clusters is not open source; it is the option to pick when you want reference boards in the browser, shared with a link.' },
      { q: 'Can I use PureRef on an iPad?', a: 'PureRef does not ship an iPad or Android app. Clusters runs in the browser, so the same reference board opens on your desktop, laptop, or iPad — useful when you want your reference with you on set or away from your workstation.' },
      { q: 'Does PureRef have a collaboration mode?', a: 'No. A PureRef board is a local file on one machine; sharing it means sending the file or an exported image. Clusters boards are collaborative by default — live cursors, comments pinned to images, and one link that always shows the current board.' },
      { q: 'Can Clusters open .pur files?', a: 'Not directly — .pur is PureRef’s own local format. Export your images from PureRef (or gather the originals) and drag the whole set onto a Clusters board; auto-tagging files each reference as it lands, and the layout takes minutes to rebuild.' },
      { q: 'Is there a free PureRef alternative?', a: 'Yes — Soleil Clusters is free to start on the Demo tier, with no credit card and nothing to install. To be fair, PureRef itself is pay-what-you-want; the difference is that Clusters adds sharing, real-time collaboration, and cloud sync.' },
      { q: 'Is there a PureRef alternative that works online, with no download?', a: 'Yes. Clusters runs entirely in the browser — open a board on any machine and it is the same board, synced and backed up. Nothing to install for you or for anyone you share it with.' },
      { q: 'What is the best PureRef alternative for teams?', a: 'Clusters is built for exactly that: live cursors and presence, comments pinned to the image they are about, and one shared board as the team’s source of truth instead of a file on one artist’s machine.' },
      { q: 'How do I move my PureRef boards into Clusters?', a: 'Export the images from PureRef (or gather the originals), then drag the whole set onto a new Clusters board. Auto-tagging files each reference as it lands, and you can rebuild your layout in minutes.' },
      { q: 'Does Clusters work offline like PureRef?', a: 'Clusters is a cloud, browser-based workspace, so it is not a fully-offline desktop window the way PureRef is. In exchange you get sharing, collaboration, and cross-device sync.' },
      { q: 'Can I put more than images on a Clusters board?', a: 'Yes — images, notes, links, video, PDFs, docs, and color palettes all live on the same canvas, with non-destructive image adjustments built in.' },
      { q: 'Is Clusters free?', a: 'Yes, the Demo tier is free with no credit card. Creator ($25/mo) adds unlimited boards, 100GB storage, and Edit Mode.' },
    ],
    related: ['/tools/reference-board-maker', '/tools/mood-board-maker', '/tools/free-mood-board-maker', '/vs/milanote', '/use-cases'],
  },
  {
    path: '/vs/miro',
    kind: 'compare',
    title: 'Miro Alternative for Creative Teams — Simpler & Free',
    metaDescription:
      'A Miro alternative for creative work, not diagramming: image-first boards, palettes, storyboards, and client-ready sharing. Free to start.',
    h1: 'A Miro Alternative for Filmmakers and Creative Teams',
    subhead:
      'Miro is a whiteboard for everything. Clusters is a canvas built specifically for visual, reference-driven creative work.',
    answer:
      'Soleil Clusters is a Miro alternative purpose-built for creative reference work: image-first cards with photo adjustments, color palettes, docs and screenplay mode, auto-tagging, and a relationship graph that ties a mood board to a storyboard to a shot list. Choose Miro for enterprise diagramming and workshops; choose Clusters for film, photo, and design pre-production.',
    updated: '2026-07-12',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    sections: [
      {
        heading: 'Purpose-built beats general-purpose',
        body: 'Miro is a powerful general whiteboard for diagrams, workshops, and sticky-note sessions. Clusters is tuned for creative reference work: image-first cards with photo adjustments, color palettes, docs and screenplay mode, auto-tagging, and a relationship graph that connects a mood board to a storyboard to a shot list. For film, photo, and design teams, the whole tool is pointed at your workflow instead of everyone’s.',
        bullets: [
          'Image-first cards with photo adjustments and palettes',
          'Docs and screenplay mode built in',
          'Auto-tagging and a relationship graph across boards',
        ],
      },
      {
        heading: 'Lighter, and made for showing work',
        body: 'Clusters shares as a clean, interactive preview a client can open with one link — no workspace invite, no learning curve, no diagramming clutter. It is designed for the moment you present references, not just the moment you brainstorm them.',
      },
      {
        heading: 'Your client should not need a Miro account',
        body: 'The moment of truth for a creative board is showing it. With Miro, that usually means inviting someone into a workspace and hoping they find their way around. A Clusters board is one link: the client opens a clean, read-only presentation view in the browser — no account, no seat, no toolbar to explain.',
        bullets: [
          'One link — no workspace invite or account',
          'A clean read-only view made for presenting',
          'You control visibility and search indexing per board',
        ],
      },
      {
        heading: 'Where Miro still wins',
        body: 'If your core need is enterprise diagramming, agile ceremonies, or a huge integrations marketplace, Miro is built for that and Clusters is not trying to be. Choose Clusters when the work is visual reference, mood, and pre-production for a creative team.',
      },
    ],
    compare: {
      competitor: 'Miro',
      intro: 'Different tools for different jobs:',
      rows: [
        { feature: 'Built for creative reference & mood', us: 'Yes', them: 'General whiteboard' },
        { feature: 'Image adjustments & color palettes', us: 'Yes', them: 'Basic' },
        { feature: 'Auto-tagging of dropped files', us: 'Yes', them: 'No' },
        { feature: 'Relationship graph across boards', us: 'Yes', them: 'No' },
        { feature: 'Docs & screenplay mode', us: 'Yes', them: 'No' },
        { feature: 'Real-time collaboration', us: 'Yes', them: 'Yes' },
        { feature: 'Client view without a workspace invite', us: 'Yes', them: 'Account for editing' },
        { feature: 'Flat pricing, not per-seat', us: 'Yes ($25/mo Creator)', them: 'Per-member' },
        { feature: 'Diagramming & integrations marketplace', us: 'Focused', them: 'Extensive' },
        { feature: 'Free tier', us: 'Yes', them: 'Yes' },
      ],
    },
    faq: [
      { q: 'Why choose Clusters over Miro?', a: 'Clusters is purpose-built for visual creative work — mood boards, look books, storyboards, and film pre-production — with image adjustments, palettes, auto-tagging, and a relationship graph. Miro is a general whiteboard; Clusters is pointed at creative reference workflows.' },
      { q: 'Is Miro overkill for mood boards?', a: 'For many creative teams, yes. Miro is powerful for diagramming and workshops, but a reference-first tool like Clusters is lighter and better tuned for mood boards, look books, and storyboards.' },
      { q: 'Can clients view a Clusters board without an account?', a: 'Yes. Share a link and they see a clean, interactive read-only preview — no workspace invite required.' },
      { q: 'Does Clusters have a free tier?', a: 'Yes. The Demo tier is free; Creator is $25/mo for unlimited boards, 100GB storage, and Edit Mode.' },
      { q: 'Is there a simpler Miro alternative for mood boards?', a: 'Yes — Clusters. It keeps the infinite collaborative canvas but strips the diagramming clutter, and adds the creative pieces Miro lacks: photo adjustments, color palettes, docs, and screenplay mode.' },
      { q: 'Can my team use Clusters without per-seat pricing?', a: 'Yes. Creator is a flat $25/mo — not a per-member subscription — and anyone you share with can open a board free with one link.' },
    ],
    related: ['/tools/storyboard-maker', '/tools/mood-board-maker', '/vs/milanote', '/use-cases'],
  },
  {
    path: '/vs/storyboarder',
    kind: 'compare',
    title: 'Wonder Unit Storyboarder Alternative — Free & Online',
    metaDescription:
      'Storyboarder’s last stable release was 2020. Clusters moves your board to the browser — numbered panels, shot lists, real-time crew edits, one shared link.',
    h1: 'An Online Alternative to Wonder Unit’s Storyboarder',
    subhead:
      'Storyboarder is a much-loved free sketching app whose development has gone quiet. Clusters is a browser-based board the whole crew works in — panels, shot lists, and schedules side by side.',
    answer:
      'Soleil Clusters is a Wonder Unit Storyboarder alternative that runs in the browser: grid cards hold auto-numbered panels, shot lists and schedules sit beside the frames, and the crew edits together in real time with one shareable link. Storyboarder still wins for hand-sketching every frame in a free desktop app; Clusters wins when the board has to travel.',
    updated: '2026-07-22',
    cta: { label: 'Start a board free', sub: 'No install, no credit card — it opens in your browser.' },
    stepsHeading: 'How to move from Storyboarder to Clusters',
    steps: [
      { t: 'Get your frames out', d: 'Storyboarder keeps each board as an image in your project folder, and its exports produce flattened PNGs and PDFs. Gather those frames — or screenshot finished boards — and they drop straight into Clusters.' },
      { t: 'Drop them into a grid card', d: 'Split a grid card into panels and drag one frame into each. Panels number themselves automatically, and captions hold your action and dialogue notes.' },
      { t: 'Put the plan next to the pictures', d: 'Flip the board to list view for a working shot list, add a schedule card to map shots to shoot days and locations, and keep the script in a doc on the same board — screenplay mode is built in.' },
      { t: 'Hand the crew one link', d: 'A public link opens a clean, read-only preview — no download, no account needed. Collaborators with Edit Mode rearrange panels with you live, cursors and all.' },
    ],
    sections: [
      {
        heading: 'The real gap: your board is a file on one machine',
        body: 'Wonder Unit Storyboarder is a desktop application for Windows, Mac, and Linux. There is no web version, and no live collaboration on the boards themselves — v2.0 added a multiuser VR mode for its 3D Shot Generator, but getting a board to your DP or producer still means exporting it or passing project files around. Clusters starts from the opposite premise: the board is a URL. Open it from the laptop at the production office, the phone on a location scout, or the iPad at the table read, and everyone is looking at the same, current version.',
        bullets: [
          'Storyboarder: install on a desktop, share by exporting or sending files',
          'Clusters: open a link — same board on every device, always current',
          'Native iOS and Android apps when you want them; nothing to install when you don’t',
        ],
      },
      {
        heading: 'Development has gone quiet — plan accordingly',
        body: 'Storyboarder is free, open source, and genuinely loved, and it earned that following. But its last stable release, v2.1.0, shipped in September 2020 — a v3.0.0 pre-release followed in early 2021 and never became final — and a community GitHub issue asking whether the project is still alive has sat unanswered since 2025. The downloads are still there and nothing stops you from keeping it installed; the question is whether a tool at the center of your production process will keep pace with new operating systems and formats. Clusters is a maintained commercial product — that cuts both ways, since it isn’t open source, but it means someone’s job is to keep the thing working.',
      },
      {
        heading: 'Storyboards built by arranging, not only by drawing',
        body: 'Storyboarder assumes you’ll draw every frame. Clusters assumes your frames come from everywhere — quick sketches, location stills, blocking photos, pulls from the lookbook — and gives you a fast way to sequence them. A grid card splits into as many frames as the scene needs, and the storyboard takes shape by dragging, not just drawing.',
        bullets: [
          'Split a grid card into frames and drop a still or a sketch into each — panels auto-number as you go',
          'Captions under every panel carry action, dialogue, and camera notes',
          'Drag panels to re-order a sequence; the numbering follows',
          'Sketch directly on the canvas when a quick drawing says it faster',
          'Non-destructive photo adjustments and palette extraction keep pulled stills on-look',
        ],
      },
      {
        heading: 'One board, the whole crew in it',
        body: 'A storyboard is a conversation — between director and DP, between the agency and the client. Clusters is built for that conversation to happen in the board itself rather than in an email thread about an exported PDF. And the pricing fits how crews actually assemble: the free Demo tier has no credit card and no trial clock, and Creator is a flat rate for the board owner, not a per-seat meter that punishes you for inviting the gaffer.',
        bullets: [
          'Live cursors and presence — see who’s in the board and where they’re working',
          'Comments pin to the exact card they’re about, not a general thread',
          'One public link opens a read-only preview; viewers never need an account',
          'Creator is $25/mo flat for unlimited boards, 100GB, and Edit Mode for collaborators',
        ],
      },
      {
        heading: 'Honest about what Storyboarder does well',
        body: 'If your process is penciling every frame by hand, Storyboarder is still a terrific place to do it — and it’s free. Its six drawing tools are built for fast frame sketching, the Shot Generator mocks up a shot — type a description or block the scene in 3D — boards round-trip through Photoshop, and finished sequences export to Premiere, Final Cut, Avid, PDF, and animated GIF. Clusters has canvas sketch tools, but it is not a dedicated drawing app, and it won’t cut animatics or export into an NLE. Since Storyboarder costs nothing, plenty of teams simply keep both: draw the frames there, then plan, arrange, and share in Clusters.',
      },
    ],
    compare: {
      competitor: 'Wonder Unit Storyboarder',
      intro: 'How the two compare for a production team as of July 2026 — including the rows Storyboarder clearly wins.',
      rows: [
        { feature: 'Price', us: 'Free tier; Creator $25/mo flat', them: 'Free, open source' },
        { feature: 'Platform', us: 'Browser — nothing to install; iOS + Android apps', them: 'Desktop only: Windows, Mac, Linux' },
        { feature: 'Real-time co-editing on boards', us: 'Yes — live cursors, presence', them: 'No' },
        { feature: 'Share with a link, no viewer account', us: 'Yes', them: 'No — export or send files' },
        { feature: 'Comments pinned to a specific card', us: 'Yes', them: 'No' },
        { feature: 'Dedicated drawing tools', us: 'Basic canvas sketching', them: 'Yes — six pens and brushes' },
        { feature: '3D Shot Generator', us: 'No', them: 'Yes' },
        { feature: 'Animatic export (Premiere, Final Cut, Avid, GIF)', us: 'No — PDF only', them: 'Yes' },
        { feature: 'Photoshop round-trip', us: 'No', them: 'Yes' },
        { feature: 'Shot list and shoot-day schedule with the board', us: 'Yes', them: 'No' },
        { feature: 'Video, audio, PDFs, and links on the board', us: 'Yes', them: 'Images, sketches, and one audio clip per board' },
        { feature: 'Most recent stable release', us: 'Continuously updated', them: 'v2.1.0, September 2020' },
      ],
    },
    faq: [
      { q: 'Is Wonder Unit Storyboarder still maintained?', a: 'Its last stable release, v2.1.0, shipped in September 2020 — a v3.0.0 pre-release followed in 2021 but never went final — and a community GitHub issue asking whether the project is still alive has been open since 2025 without a maintainer reply. The downloads are still available, but by every public signal, development has gone quiet.' },
      { q: 'Is there an online or browser version of Storyboarder?', a: 'No — Wonder Unit Storyboarder is a desktop app for Windows, Mac, and Linux with no web version. Soleil Clusters covers the same storyboard-panel workflow entirely in the browser, which makes it the closest thing to “Storyboarder online.”' },
      { q: 'Is this the same app as Toon Boom Storyboard Pro or StoryboardThat?', a: 'No. This page compares Soleil Clusters with Wonder Unit’s Storyboarder, the free, open-source desktop app from wonderunit.com — a different product from both Toon Boom Storyboard Pro and StoryboardThat.' },
      { q: 'Can Soleil Clusters make animatics or export to Premiere?', a: 'No. Clusters exports boards and docs as PDF, but it does not render animatics or export to editing software — Storyboarder’s Premiere, Final Cut, Avid, and animated GIF exports remain a genuine advantage.' },
      { q: 'How do I move my existing Storyboarder boards into Clusters?', a: 'Every Storyboarder board is already an image in your project folder, and its exports produce flattened PNGs and PDFs. Drag those frames into a grid card in Clusters — each lands in its own auto-numbered panel with a caption for your notes.' },
      { q: 'Does Clusters have drawing tools, or do I need finished images?', a: 'Clusters has sketch and draw tools on the canvas, so quick thumbnails are easy — but it is arrangement-first, not a dedicated drawing app. If you pencil every frame by hand, Storyboarder’s brushes are still the better sketching surface.' },
      { q: 'What does a Storyboarder alternative like Clusters cost?', a: 'The Demo tier is free, with no credit card, no trial clock, and a generous card cap; collaborators can view boards read-only. Creator is a flat $25 per month — not per seat — with unlimited boards, 100GB of storage, any file type, and Edit Mode for collaborators.' },
      { q: 'Can my crew see the storyboard without installing anything?', a: 'Yes. One public link opens a clean, interactive read-only preview in any browser — viewers don’t need an account, and you control each board’s visibility and search indexing.' },
    ],
    related: ['/tools/storyboard-maker', '/vs/boords', '/vs/pureref', '/use-cases'],
  },
  {
    path: '/vs/boords',
    kind: 'compare',
    title: 'Boords Alternative — Free Collaborative Storyboarding',
    metaDescription:
      'Boords prices by team size — Soleil Clusters is a flat $25 canvas where storyboards live beside shot lists and schedules. Free tier, no credit card.',
    h1: 'A Boords Alternative for the Whole Production, Not Just the Frames',
    subhead:
      'Boords is a dedicated storyboarding app with animatics and script tools. Soleil Clusters is a real-time infinite canvas where the storyboard sits beside the mood board, shot list, and schedule — at one flat price.',
    answer:
      'Soleil Clusters is a Boords alternative for production teams: a free browser-based infinite canvas where storyboard grids sit beside mood boards, shot lists, and schedules, with real-time collaboration at a flat $25/month — never per seat. Boords remains stronger for animatics, script import, and client-approval workflows; Clusters wins when the storyboard is part of a larger production.',
    updated: '2026-07-22',
    cta: { label: 'Start a board free', sub: 'No credit card, no trial clock — the Demo tier stays free.' },
    stepsHeading: 'Moving a storyboard from Boords to Clusters',
    steps: [
      { t: 'Export from Boords', d: 'Download your storyboard from Boords — exports, including PDF, are included on its plans, so your frames come with you.' },
      { t: 'Drop it onto a board', d: 'Drag the files onto a Clusters board. PDFs land as cards; stills go straight into a grid card’s panels, where captions and auto-numbering pick up where Boords left off.' },
      { t: 'Add what the storyboard was missing', d: 'Put the mood board next to the frames, flip the board to list view for the shot list, and let a Schedule card map shots to shoot days and locations.' },
      { t: 'Send one link', d: 'Share a clean, interactive read-only preview that nobody needs an account to open — the same link always shows the current board.' },
    ],
    sections: [
      {
        heading: 'Seat bands vs. one flat rate',
        body: 'As of July 2026, Boords advertises a single-user “free forever” plan with no credit card, but its paid ladder starts at $39/month for one user (Solo — $26/mo on annual billing), and collaborating starts at $75/month for up to five people, stepping to $125 for ten and $250 for thirty on monthly billing. Soleil Clusters charges $25/month flat on Creator — the price doesn’t move when the crew grows — and below that sits a free Demo tier with no trial clock and no credit card, where anyone you share with can view through a link.',
        bullets: [
          'Boords Solo: $39/mo for one user ($26/mo annual)',
          'Boords Pro, Team, and Agency: $75–$250/mo for teams of 5 to 30',
          'Clusters Creator: $25/mo total, regardless of team size',
          'Clusters Demo: free, generous card cap, collaborators view read-only',
        ],
      },
      {
        heading: 'The storyboard is one card, not the whole app',
        body: 'In Clusters a storyboard is a grid card on an infinite canvas: split cells into panels, drop a still or a sketch into each frame, caption it, and the panels number themselves and re-order by drag. Around that card goes everything else the shoot needs, because the canvas doesn’t care what you put on it.',
        bullets: [
          'Mood boards and pulled references beside the frames — with non-destructive photo adjustments and color-palette extraction',
          'Flip the board to a clean list view for the shot list; a Schedule card maps shots to shoot days and locations',
          'Docs and a built-in screenplay mode for the script; PDF export of boards and docs when it’s time to send',
          'Nested boards keep each scene inside the project, and auto-tagging reads dropped files and files them to the right board',
        ],
      },
      {
        heading: 'Deliberately not an AI storyboard generator',
        body: 'Search for a Boords alternative and most of what you’ll find pitches AI frame generation. Clusters doesn’t generate frames. It’s the shared workspace for the frames your artist draws, the stills your scout shoots, and the screengrabs your director hoards — with draw and sketch tools on the canvas for when a rough gesture is all a panel needs. If machine-generated boards are the requirement, this isn’t the tool, and we’d rather say so here than after you’ve signed up.',
      },
      {
        heading: 'Built for people who never make an account',
        body: 'Every board shares as a single public link that opens a clean, interactive read-only preview — no signup for the client, the DP, or the exec who will never install anything, and per-board control over visibility and search indexing. Inside the team, work is genuinely live: cursors and presence show who’s where, and comments pin to the exact card they’re about instead of piling up in a sidebar. On the free Demo tier collaborators view read-only; Creator turns on Edit Mode so they work on the board with you.',
      },
      {
        heading: 'Where Boords genuinely earns its price',
        body: 'Boords is purpose-built for storyboarding, and it shows. If the storyboard itself is the deliverable — timed, versioned, and formally signed off — Boords is the stronger tool, and no canvas app should pretend otherwise.',
        bullets: [
          'An animatic editor turns boards into timed video; Clusters has no animatics',
          'Intelligent script import connects the script to frames; Clusters’ screenplay editor doesn’t sync to panels',
          'Version control on storyboards; Clusters doesn’t keep frame versions',
          'No-signup client reviews with a structured approval flow; Clusters shares read-only links but has no approval workflow',
          'AI image generation with monthly credits, if that’s part of your process',
        ],
      },
    ],
    compare: {
      competitor: 'Boords',
      intro: 'Pricing and features checked on boords.com in July 2026; monthly-billing prices shown (annual is lower). The rows Boords wins are left standing — that’s the point of an honest table.',
      rows: [
        { feature: 'Free plan', us: 'Yes — generous card cap', them: '“Free forever” — limits unpublished' },
        { feature: 'Monthly cost for a team of five', us: '$25 flat', them: '$75 (Pro)' },
        { feature: 'Price rises with headcount', us: 'No', them: 'Yes — up to $250/mo' },
        { feature: 'Real-time co-editing', us: 'Yes — live cursors', them: 'Yes' },
        { feature: 'Infinite canvas', us: 'Yes', them: 'No — frame sequence' },
        { feature: 'Panels, captions, auto-numbering', us: 'Yes — grid cards', them: 'Yes' },
        { feature: 'Animatics', us: 'No', them: 'Yes' },
        { feature: 'Script import', us: 'No', them: 'Yes' },
        { feature: 'Storyboard version control', us: 'No', them: 'Yes' },
        { feature: 'Client approval workflow', us: 'No — read-only links', them: 'Yes' },
        { feature: 'AI frame generation', us: 'No — by design', them: 'Yes — credit-metered' },
        { feature: 'Shot lists', us: 'Yes — list view', them: 'Yes — generated from boards' },
        { feature: 'Shoot-day schedule mapping shots to days', us: 'Yes — Schedule card', them: 'No' },
      ],
    },
    faq: [
      { q: 'Is there a free alternative to Boords?', a: 'Yes — Soleil Clusters has a free Demo tier with no credit card, no trial clock, and a generous card cap, and anyone can view your boards through a share link without creating an account. Boords advertises a “free forever” plan as well, though its limits aren’t published on its pricing page; paid plans start at $39/month for a single user (as of July 2026).' },
      { q: 'How much does Boords cost for a team compared to Soleil Clusters?', a: 'As of July 2026, Boords’ team plans run $75 to $250 per month on monthly billing, tiered by team size from five to thirty users. Soleil Clusters’ Creator plan is a flat $25 per month for the whole team — it isn’t priced by seat.' },
      { q: 'Can Soleil Clusters turn a storyboard into an animatic?', a: 'No. Clusters has no animatic editor and won’t render your boards into timed video — if the deliverable is an animatic, Boords is built for exactly that. Clusters exports boards and docs as PDFs instead.' },
      { q: 'How do you make a storyboard in Soleil Clusters?', a: 'Add a grid card, split its cells into panels, and drop a still or a sketch into each frame. Panels take captions, number themselves automatically, and re-order by drag — and the canvas has draw tools for roughing frames in place.' },
      { q: 'Does Boords charge per seat?', a: 'Not per individual seat — as of July 2026 Boords prices by band: Solo at $39/month for one user, then team plans at $75, $125, and $250 per month for up to 5, 10, and 30 users on monthly billing. Clusters skips the ladder with one flat $25/month plan.' },
      { q: 'Can clients review a storyboard without creating an account?', a: 'Yes. A Clusters board shares as one public link that opens a clean, interactive read-only preview — no signup, nothing to install — with per-board control of visibility and search indexing. There’s no formal approval workflow, though; sign-off happens in comments or wherever your production already handles it.' },
      { q: 'Is Soleil Clusters an AI storyboard generator?', a: 'No, and that’s deliberate. Clusters is the shared canvas for frames your team draws, shoots, or pulls — it doesn’t generate imagery. If AI-generated boards are what you need, Boords’ AI features or a dedicated generator is the better fit.' },
      { q: 'Can I move my Boords storyboards into Soleil Clusters?', a: 'Yes — export your work from Boords, then drag the files onto a Clusters board. Stills drop into a grid card’s panels and a PDF lands on the canvas as a card, so the frames end up beside your references, shot list, and schedule.' },
    ],
    related: ['/tools/storyboard-maker', '/vs/storyboarder', '/vs/studiobinder', '/use-cases'],
  },
  {
    path: '/vs/studiobinder',
    kind: 'compare',
    title: 'StudioBinder Alternative — Free to Start, Flat $25/mo',
    metaDescription:
      'StudioBinder runs $29–99/mo; extra seats $25. Need only the visual half — storyboards, shot lists, lookbooks? Clusters is free to start, then $25 flat.',
    h1: 'A StudioBinder Alternative for the Visual Half of Pre-Production',
    subhead:
      'StudioBinder manages the paperwork of a shoot. Soleil Clusters is where the look gets decided — storyboards, shot lists, and reference boards on one shared canvas, at one flat price.',
    answer:
      'Soleil Clusters is a StudioBinder alternative for visual pre-production: mood boards, storyboards, shot lists with reference frames, and lookbooks on a shared infinite canvas — free to start, then a flat $25/month for the whole team. StudioBinder still owns call sheets, stripboards, and script breakdowns; Clusters replaces the visual planning you were paying suite prices for.',
    updated: '2026-07-22',
    cta: { label: 'Start a board free', sub: 'No credit card, no trial clock. Runs in your browser.' },
    stepsHeading: 'How a small crew moves the visual half to Clusters',
    steps: [
      { t: 'Pile the references onto one board', d: 'Drag in stills, screenshots, links, video, PDFs — auto-tagging reads what you drop and files it to the right board, so the wall organizes itself while you collect.' },
      { t: 'Frame the storyboard', d: 'Add a grid card, split it into panels, and drop a still or sketch into each frame. Captions and auto-numbering come along, and panels renumber themselves when you drag to reorder.' },
      { t: 'Flip it into a shot list', d: 'Toggle the board from freeform canvas to a clean list view — the reference wall and the shot list are the same data. A Schedule card maps shots to shoot days and locations.' },
      { t: 'Hand the crew one link', d: 'A public link opens a clean, interactive read-only preview. The director, the client, and the DP see the wall without creating an account.' },
    ],
    sections: [
      {
        heading: 'Two different jobs on the same budget line',
        body: 'StudioBinder is production-management software — call sheets, stripboard schedules, script breakdowns, crew contacts — and it’s priced for that scope. As of July 2026, its listed plans run $29, $49, and $99 per month with one to four seats included, and every extra user adds $25 per month. Soleil Clusters does one narrower job: the boards, storyboards, shot lists, and lookbooks where a project’s look takes shape. That job costs a flat $25 a month — never per seat — and starts free. If the tabs you actually open are the visual ones, you’re paying suite prices for the suite’s visual corner.',
      },
      {
        heading: 'If you run call sheets, stay in the suite',
        body: 'Scope first, because this comparison only works if it’s honest. Clusters will not generate a call sheet, track an RSVP, tag a breakdown element, or lay out a stripboard schedule. If those deliverables are what your production runs on, StudioBinder — or a set-logistics specialist like SetHero — is the right category, full stop. Where Clusters earns its place is the other half: deciding and communicating what the film should look like. Some crews run both, logistics in a suite and the look on a canvas; others discover the visual half was the only part they were using.',
      },
      {
        heading: 'The visual half, on a canvas instead of a form',
        body: 'Production suites treat images as attachments to records. Clusters treats them as the work itself: an infinite browser canvas where references, frames, and notes sit next to each other and get compared, marked up, and decided.',
        bullets: [
          'Storyboards as grid cards — split cells into panels, drop a still or sketch into each frame, caption it, and let panels renumber themselves as you drag to reorder.',
          'One board, two shapes — flip the freeform canvas to a clean list view for the shot list, and use a Schedule card to map shots to shoot days and locations.',
          'Reference tools built in — non-destructive brightness, contrast, saturation, warmth, and B&W adjustments, plus color palettes extracted straight from an image.',
          'Words next to pictures — docs and a screenplay mode live alongside the boards, and both boards and docs export to PDF.',
          'Structure that scales — nest boards inside boards, connect them in a relationship graph, and let auto-tagging file dropped files where they belong.',
        ],
      },
      {
        heading: 'Built for the whole crew to look at, together',
        body: 'A look isn’t decided by one coordinator filling in fields — it’s argued into existence. Clusters is built for that to happen live.',
        bullets: [
          'Real-time multiplayer with live cursors and presence, so everyone is looking at the same wall at the same moment.',
          'Comments pin to the exact card they’re about — “the third frame feels wrong” literally points at the third frame.',
          'One public link opens an interactive read-only preview; directors, producers, and clients never need an account.',
          'Per-board control of visibility and search indexing, so a pitch lookbook can be public while the working wall stays private.',
          'Nothing to install — it runs in the browser on laptops, phones, and tablets, with native iOS and Android apps.',
        ],
      },
      {
        heading: 'The seat math for a crew of six',
        body: 'Per-seat pricing is where suite costs quietly compound. At StudioBinder’s listed July 2026 rates, six people cost about $149 a month — Professional at $99 covers four seats plus $25 for each of the other two, and Indie lands on the same number from the other direction. The same six people on Clusters Creator cost $25 total: one flat subscription with unlimited boards, 100GB of storage, any file type, and Edit Mode for every collaborator. And before any money moves, the Demo tier is genuinely free — no credit card, no trial countdown, a generous card cap, with collaborators viewing read-only.',
      },
    ],
    compare: {
      competitor: 'StudioBinder',
      intro: 'Prices and plan details below were checked against StudioBinder’s published plan documentation in July 2026. The two products only partly overlap — the rows say so plainly.',
      rows: [
        { feature: 'Freeform infinite canvas', us: 'Yes', them: 'No' },
        { feature: 'Storyboards with numbered panels', us: 'Yes', them: 'Yes' },
        { feature: 'Shot lists', us: 'Yes', them: 'Yes' },
        { feature: 'Screenplay editor', us: 'Yes', them: 'Yes' },
        { feature: 'Call sheets with RSVP tracking', us: 'No', them: 'Yes' },
        { feature: 'Stripboard shooting schedules', us: 'No', them: 'Yes' },
        { feature: 'Script breakdowns', us: 'No', them: 'Yes' },
        { feature: 'Crew contacts & messaging', us: 'No', them: 'Yes' },
        { feature: 'Live cursors on a shared board', us: 'Yes', them: 'No' },
        { feature: 'No-account share links on the free plan', us: 'Yes', them: 'Paid plans only' },
        { feature: 'Free plan', us: 'Yes — no trial clock', them: 'Yes — 1 project' },
        { feature: 'Cost for a team of six', us: '$25/mo flat', them: '~$149/mo' },
      ],
    },
    faq: [
      { q: 'Is there a free StudioBinder alternative for storyboards and shot lists?', a: 'Soleil Clusters has a free Demo tier with no credit card and no trial countdown — a generous card cap covers storyboards, shot lists, and reference boards. StudioBinder offers a free plan too, but it’s capped at a single project.' },
      { q: 'Can Soleil Clusters fully replace StudioBinder?', a: 'No — Clusters covers only visual planning: mood boards, storyboards, shot lists, lookbooks, docs, and screenplays. Call sheets, script breakdowns, and stripboard schedules remain StudioBinder’s category, and Clusters doesn’t attempt them.' },
      { q: 'Does Soleil Clusters make call sheets?', a: 'No. There is no call-sheet, RSVP, or crew-contact feature in Clusters. For set logistics, a production-management tool like StudioBinder or SetHero is the right choice.' },
      { q: 'How much does StudioBinder cost per user compared to Clusters?', a: 'As of July 2026, StudioBinder’s listed plans run $29 to $99 per month with one to four seats included, and each additional user costs $25 per month. Clusters Creator is a flat $25 per month for the whole team — collaborators are never charged per seat.' },
      { q: 'Can I make a storyboard in Soleil Clusters?', a: 'Yes — grid cards split into panels you fill with stills or sketches, with captions, auto-numbered panels, and drag-to-reorder. Boards export to PDF when you need pages to hand out.' },
      { q: 'How do shot lists work in Clusters?', a: 'Any board flips from freeform canvas to a clean list view, so the reference wall and the shot list are the same data. A Schedule card then maps shots to shoot days and locations.' },
      { q: 'Can a producer or client view my board without signing up?', a: 'Yes — one public link opens a clean, interactive read-only preview with no account required. Visibility and search indexing are controlled per board.' },
      { q: 'Do my collaborators need a paid seat to edit?', a: 'On the free Demo tier collaborators view read-only. The $25/month Creator plan turns on Edit Mode for your collaborators with no per-seat charges — one subscription covers the team.' },
    ],
    related: ['/tools/shot-list-maker', '/tools/storyboard-maker', '/vs/boords', '/use-cases'],
  },

  // ────────────────────────────────────────────────────────────────────────
  // HUB — internal-linking spine that strengthens every page above
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/use-cases',
    kind: 'hub',
    title: 'What You Can Make with Clusters — Mood Boards to Shot Lists',
    metaDescription:
      'Mood boards, look books, storyboards, shot lists — see what creative teams make with Soleil Clusters, browse example boards, and start yours free.',
    h1: 'What You Can Make with Clusters',
    subhead:
      'One canvas for the whole creative process — from first reference to final shot list. Here is where to start.',
    answer:
      'Soleil Clusters is a visual workspace where creative teams make mood boards, look books, storyboards, shot lists, and brand boards — all on one infinite, collaborative canvas. Drop in references, connect boards into a project, and share any of it with a single link. Start free in the browser; no download.',
    updated: '2026-07-21',
    cta: { label: 'Start free', sub: 'No credit card. Your first board in seconds.' },
    sections: [
      {
        heading: 'Tools for every stage',
        body: 'Clusters is a single visual workspace, but people reach for it at different moments. Whatever you are making, it starts the same way: drop your references on a canvas and pull them together.',
        bullets: [
          'Mood board maker — pull references, colors, and notes together',
          'Reference board maker — working reference beside you as you create',
          'Look book maker — polished, client-ready visual presentations',
          'Storyboard maker — lay shots out in a grid, sequence to sequence',
          'Shot list maker — a visual shot list your whole crew can use',
        ],
      },
      {
        heading: 'See real boards',
        body: 'The best way to understand Clusters is to look at boards people have actually built. Browse the Explore gallery for curated example boards — mood boards, palettes, and reference collections — you can open and learn from.',
      },
      {
        heading: 'Switching from another tool?',
        body: 'If you are coming from Milanote, PureRef, Miro, Wonder Unit Storyboarder, Boords, or StudioBinder, here is how Clusters compares and where it fits your workflow — with an honest look at what each tool does best.',
      },
    ],
    faq: [
      { q: 'What can I make with Soleil Clusters?', a: 'Mood boards, look books, storyboards, shot lists, brand boards, location scouts, and more — anything that benefits from organizing visual references on a collaborative canvas.' },
      { q: 'Who is Clusters for?', a: 'Film, photo, design, and brand teams — anyone doing visual, reference-driven creative work who wants it organized, collaborative, and shareable.' },
      { q: 'Where can I see example boards?', a: 'Visit the Explore gallery to browse curated public boards made with Clusters, then start your own free.' },
    ],
    related: [
      '/tools/mood-board-maker',
      '/tools/reference-board-maker',
      '/tools/look-book-maker',
      '/tools/storyboard-maker',
      '/tools/shot-list-maker',
      '/tools/free-mood-board-maker',
      '/vs/milanote',
      '/vs/pureref',
      '/vs/miro',
      '/vs/storyboarder',
      '/vs/boords',
      '/vs/studiobinder',
    ],
  },
];

// Curated example boards per landing page — the visual proof strip ("Made with
// Clusters") and the hero example card. Slugs of published /c/<slug> boards;
// the first slug is the hero card. Shared by the React page AND the worker's
// crawlable HTML (landing→board internal links: hub-and-spoke both directions).
const EXAMPLES_BY_PATH = {
  '/tools/mood-board-maker':      ['japandi-living-room', 'sage-terracotta-wedding', 'world-cup-2026-moodboard'],
  '/tools/free-mood-board-maker': ['sage-terracotta-wedding', 'japandi-living-room', 'neon-noir-look-book'],
  '/tools/reference-board-maker': ['film-noir-look-book', 'japandi-living-room', 'world-cup-2026-moodboard'],
  '/tools/storyboard-maker':      ['screenplay-beat-sheet', 'short-film-shot-list'],
  '/tools/shot-list-maker':       ['short-film-shot-list', 'screenplay-beat-sheet'],
  '/tools/look-book-maker':       ['neon-noir-look-book', 'film-noir-look-book'],
  '/vs/milanote':                 ['japandi-living-room', 'neon-noir-look-book', 'screenplay-beat-sheet'],
  '/vs/pureref':                  ['film-noir-look-book', 'neon-noir-look-book', 'japandi-living-room'],
  '/vs/miro':                     ['screenplay-beat-sheet', 'short-film-shot-list', 'world-cup-2026-moodboard'],
  '/vs/storyboarder':             ['screenplay-beat-sheet', 'short-film-shot-list'],
  '/vs/boords':                   ['short-film-shot-list', 'screenplay-beat-sheet'],
  '/vs/studiobinder':             ['short-film-shot-list', 'screenplay-beat-sheet', 'film-noir-look-book'],
  '/use-cases':                   ['world-cup-2026-moodboard', 'neon-noir-look-book', 'sage-terracotta-wedding'],
};

// Hero eyebrow — the category kicker above the h1 (brand display face, gold).
const EYEBROW_BY_PATH = {
  '/tools/mood-board-maker':      'Free online tool',
  '/tools/storyboard-maker':      'Free online tool',
  '/tools/shot-list-maker':       'Free online tool',
  '/tools/look-book-maker':       'Free online tool',
  '/tools/free-mood-board-maker': 'Free — no trial clock',
  '/tools/reference-board-maker': 'Free online tool',
  '/vs/milanote':                 'Milanote alternative',
  '/vs/pureref':                  'PureRef alternative',
  '/vs/miro':                     'Miro alternative',
  '/vs/storyboarder':             'Storyboarder alternative',
  '/vs/boords':                   'Boords alternative',
  '/vs/studiobinder':             'StudioBinder alternative',
  '/use-cases':                   'What you can make',
};

// Attach the signup CTA href to each page (campaign = last path segment).
for (const p of PAGES) {
  const campaign = p.path.replace(/^\//, '').replace(/\//g, '_');
  p.cta = { ...p.cta, href: SIGNUP(campaign) };
  p.exampleSlugs = EXAMPLES_BY_PATH[p.path] || [];
  p.eyebrow = EYEBROW_BY_PATH[p.path] || (p.kind === 'compare' ? 'Honest comparison' : 'Free online tool');
}

// Fast lookups. Paths are matched with an optional trailing slash by callers.
const BY_PATH = new Map(PAGES.map((p) => [p.path, p]));

export const SEO_LANDING_PAGES = PAGES;
export const SEO_LANDING_PATHS = PAGES.map((p) => p.path);

// Normalize a request pathname (lowercase, strip trailing slash) and return the
// matching spec, or null. Shared by the Worker (edge meta) and React (routing).
export function getLandingSpec(pathname) {
  if (!pathname) return null;
  let p = pathname.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return BY_PATH.get(p) || null;
}

// Static 1200×630 OG card for a landing page (generated by
// scripts/generate-og.mjs into public/og/). Naming is derived from the path so
// there's no per-spec field to drift: /tools/mood-board-maker → /og/tools-mood-board-maker.png
export function landingOgPath(spec) {
  return `/og/${spec.path.slice(1).replace(/\//g, '-')}.png`;
}

// ── Hub-and-spoke helpers (shared by the Worker's server-rendered HTML and the
// React pages so both surfaces stay in lockstep — anti-cloaking parity) ──────

// /explore intro: evergreen copy so the hub isn't thin at low board counts.
export const EXPLORE_INTRO =
  'Curated public boards made with Soleil Clusters — real mood boards, look books, and reference collections you can open and explore. Every board here was built with the same tools you get for free: an infinite canvas, image grids, color palettes, notes, and connections. Browse for inspiration, then make your own.';

// Map a board's target keyword / title to the most relevant tool page, so
// example boards link back into the landing pages ("make your own").
export function matchToolPath(text) {
  const t = String(text || '').toLowerCase();
  if (/storyboard/.test(t)) return '/tools/storyboard-maker';
  if (/shot ?list/.test(t)) return '/tools/shot-list-maker';
  if (/look ?book|lookbook/.test(t)) return '/tools/look-book-maker';
  if (/reference/.test(t)) return '/tools/reference-board-maker';
  if (/mood ?board|moodboard|aesthetic|palette/.test(t)) return '/tools/mood-board-maker';
  return null;
}
