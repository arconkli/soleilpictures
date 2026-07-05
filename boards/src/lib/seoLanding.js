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
//     sections:        [{ heading, body, bullets?: string[] }],   // 3–4 unique sections
//     faq:             [{ q, a }],                                 // 4–6 → FAQPage rich result
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
    title: 'Mood Board Maker — Soleil Clusters',
    metaDescription:
      'Make a mood board online, free. Drop images, notes, and color palettes onto an infinite canvas, then share it with one link. Built for film, photo, and design teams.',
    h1: 'Mood Board Maker',
    subhead:
      'Pull your references, colors, and notes onto one infinite canvas — then share the whole board with a single link.',
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
    title: 'Storyboard Maker — Soleil Clusters',
    metaDescription:
      'Make a storyboard online. Lay out shots in a grid, drop in frames and reference, add notes and a shot list, and share the sequence with your crew — free to start.',
    h1: 'Storyboard Maker',
    subhead:
      'Lay your shots out in a grid, drop in frames and reference, and keep the shot list right beside them.',
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
    related: ['/tools/shot-list-maker', '/tools/mood-board-maker', '/vs/milanote', '/use-cases'],
  },
  {
    path: '/tools/shot-list-maker',
    kind: 'tool',
    title: 'Shot List Maker — Soleil Clusters',
    metaDescription:
      'Build a shot list your crew can actually use. Keep shots, reference frames, lenses, and schedule on one board — and share it live with the whole production.',
    h1: 'Shot List Maker',
    subhead:
      'Keep your shots, reference frames, and schedule on one board — visual and organized, not buried in a spreadsheet.',
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
    ],
    related: ['/tools/storyboard-maker', '/tools/mood-board-maker', '/use-cases'],
  },
  {
    path: '/tools/look-book-maker',
    kind: 'tool',
    title: 'Look Book Maker — Soleil Clusters',
    metaDescription:
      'Make a look book online. Arrange looks, references, and palettes on a clean canvas, then send a polished, interactive link to clients and collaborators.',
    h1: 'Look Book Maker',
    subhead:
      'Arrange looks, references, and color stories on one canvas — then send a polished, interactive link.',
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
    title: 'Free Online Mood Board Maker — Soleil Clusters',
    metaDescription:
      'A free online mood board maker that runs in your browser. Drop images, notes, and palettes on an infinite canvas and share with a link — no download, no credit card.',
    h1: 'Free Online Mood Board Maker',
    subhead:
      'Runs in your browser. Drop images, notes, and palettes on an infinite canvas and share with a link — no download.',
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

  // ────────────────────────────────────────────────────────────────────────
  // ALTERNATIVE-TO PAGES — capture people already shopping for a tool
  // Positioning is honest: competitors' genuine strengths are acknowledged.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/vs/milanote',
    kind: 'compare',
    title: 'Milanote Alternative — Soleil Clusters',
    metaDescription:
      'A Milanote alternative for production teams: Soleil Clusters is a real-time visual workspace for film, photo, and design — with live collaboration built in.',
    h1: 'A Milanote Alternative Built for Production Teams',
    subhead:
      'Milanote is a lovely place to think. Clusters is where a team pulls a whole production together — live, on one canvas.',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    sections: [
      {
        heading: 'Where Clusters is different',
        body: 'Both tools are beautiful, board-based, and made for creative work. Clusters leans harder into real-time team production: a live multiplayer canvas with cursors and presence, auto-tagging that files your references for you, a relationship graph that connects a whole project, and 100GB of storage for any file type on Creator. If you are organizing a shoot or a campaign with a team, that is the difference.',
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
        { feature: 'Built-in docs & screenplay mode', us: 'Yes', them: 'Notes' },
        { feature: 'Share a live, interactive link', us: 'Yes', them: 'Yes' },
        { feature: 'Free tier', us: 'Yes', them: 'Yes (capped)' },
        { feature: 'Template library', us: 'Growing', them: 'Extensive' },
      ],
    },
    faq: [
      { q: 'Is Soleil Clusters a good Milanote alternative?', a: 'Yes, especially for teams doing visual, media-heavy, collaborative work. Clusters adds a real-time multiplayer canvas, auto-tagging, a relationship graph, and 100GB storage for any file type on Creator.' },
      { q: 'How is Clusters different from Milanote?', a: 'Clusters focuses on live team production — multiplayer editing with cursors and presence, automatic organization of dropped files, and connecting a whole project through a relationship graph — rather than solo planning boards.' },
      { q: 'Does Clusters have a free tier like Milanote?', a: 'Yes. The Demo tier is free with no credit card. Creator is $25/mo for unlimited boards, 100GB storage, any file type, and Edit Mode.' },
      { q: 'Can I move my Milanote boards over?', a: 'You can drag your images, links, and files straight into a new Clusters board and share it — there is no complex migration to do first.' },
    ],
    related: ['/tools/mood-board-maker', '/vs/pureref', '/vs/miro', '/use-cases'],
  },
  {
    path: '/vs/pureref',
    kind: 'compare',
    title: 'PureRef Alternative — Soleil Clusters',
    metaDescription:
      'A PureRef alternative that lives in the cloud. Soleil Clusters keeps your reference boards collaborative, shareable, and multi-media — not locked to one desktop.',
    h1: 'A PureRef Alternative for Teams and the Cloud',
    subhead:
      'PureRef is a fast, offline reference window. Clusters is a collaborative reference workspace you can share and grow.',
    cta: { label: 'Try Clusters free', sub: 'Runs in your browser. Free to start.' },
    sections: [
      {
        heading: 'From a local window to a shared workspace',
        body: 'PureRef is a brilliant lightweight desktop app for pinning reference images while you work. Clusters takes reference boards to the cloud: they live in your browser, sync across devices, and can be shared with a link or edited by your whole team in real time. Your references are backed up and reachable from anywhere, not trapped in a file on one machine.',
      },
      {
        heading: 'More than images',
        body: 'A reference board is rarely just pictures. Clusters cards can be images, notes, links, video, PDFs, color palettes, and docs — with non-destructive image adjustments built in — so your reference, your annotations, and your color story sit together instead of in three tools.',
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
        { feature: 'Fully offline', us: 'No', them: 'Yes' },
        { feature: 'Free to start', us: 'Yes', them: 'Pay what you want' },
      ],
    },
    faq: [
      { q: 'What is a good PureRef alternative with collaboration?', a: 'Soleil Clusters. It keeps the fast, freeform reference-board feel but adds real-time collaboration, link sharing, cloud sync, and support for notes, docs, palettes, and video — not just images.' },
      { q: 'Does Clusters work offline like PureRef?', a: 'Clusters is a cloud, browser-based workspace, so it is not a fully-offline desktop window the way PureRef is. In exchange you get sharing, collaboration, and cross-device sync.' },
      { q: 'Can I put more than images on a Clusters board?', a: 'Yes — images, notes, links, video, PDFs, docs, and color palettes all live on the same canvas, with non-destructive image adjustments built in.' },
      { q: 'Is Clusters free?', a: 'Yes, the Demo tier is free with no credit card. Creator ($25/mo) adds unlimited boards, 100GB storage, and Edit Mode.' },
    ],
    related: ['/tools/mood-board-maker', '/tools/free-mood-board-maker', '/vs/milanote', '/use-cases'],
  },
  {
    path: '/vs/miro',
    kind: 'compare',
    title: 'Miro Alternative for Creative Teams — Soleil Clusters',
    metaDescription:
      'A Miro alternative built for visual creative work, not diagramming — a reference-first canvas for film, photo, and design teams, with real-time collaboration.',
    h1: 'A Miro Alternative for Filmmakers and Creative Teams',
    subhead:
      'Miro is a whiteboard for everything. Clusters is a canvas built specifically for visual, reference-driven creative work.',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    sections: [
      {
        heading: 'Purpose-built beats general-purpose',
        body: 'Miro is a powerful general whiteboard for diagrams, workshops, and sticky-note sessions. Clusters is tuned for creative reference work: image-first cards with photo adjustments, color palettes, docs and screenplay mode, auto-tagging, and a relationship graph that connects a mood board to a storyboard to a shot list. For film, photo, and design teams, the whole tool is pointed at your workflow instead of everyone’s.',
      },
      {
        heading: 'Lighter, and made for showing work',
        body: 'Clusters shares as a clean, interactive preview a client can open with one link — no workspace invite, no learning curve, no diagramming clutter. It is designed for the moment you present references, not just the moment you brainstorm them.',
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
        { feature: 'Diagramming & integrations marketplace', us: 'Focused', them: 'Extensive' },
        { feature: 'Free tier', us: 'Yes', them: 'Yes' },
      ],
    },
    faq: [
      { q: 'Why choose Clusters over Miro?', a: 'Clusters is purpose-built for visual creative work — mood boards, look books, storyboards, and film pre-production — with image adjustments, palettes, auto-tagging, and a relationship graph. Miro is a general whiteboard; Clusters is pointed at creative reference workflows.' },
      { q: 'Is Miro overkill for mood boards?', a: 'For many creative teams, yes. Miro is powerful for diagramming and workshops, but a reference-first tool like Clusters is lighter and better tuned for mood boards, look books, and storyboards.' },
      { q: 'Can clients view a Clusters board without an account?', a: 'Yes. Share a link and they see a clean, interactive read-only preview — no workspace invite required.' },
      { q: 'Does Clusters have a free tier?', a: 'Yes. The Demo tier is free; Creator is $25/mo for unlimited boards, 100GB storage, and Edit Mode.' },
    ],
    related: ['/tools/storyboard-maker', '/tools/mood-board-maker', '/vs/milanote', '/use-cases'],
  },

  // ────────────────────────────────────────────────────────────────────────
  // HUB — internal-linking spine that strengthens every page above
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/use-cases',
    kind: 'hub',
    title: 'What You Can Make with Soleil Clusters',
    metaDescription:
      'Mood boards, look books, storyboards, shot lists, and more — see what creative teams build with Soleil Clusters, and browse real example boards.',
    h1: 'What You Can Make with Clusters',
    subhead:
      'One canvas for the whole creative process — from first reference to final shot list. Here is where to start.',
    cta: { label: 'Start free', sub: 'No credit card. Your first board in seconds.' },
    sections: [
      {
        heading: 'Tools for every stage',
        body: 'Clusters is a single visual workspace, but people reach for it at different moments. Whatever you are making, it starts the same way: drop your references on a canvas and pull them together.',
        bullets: [
          'Mood board maker — pull references, colors, and notes together',
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
        body: 'If you are coming from Milanote, PureRef, or Miro, here is how Clusters compares and where it fits your workflow — with an honest look at what each tool does best.',
      },
    ],
    faq: [
      { q: 'What can I make with Soleil Clusters?', a: 'Mood boards, look books, storyboards, shot lists, brand boards, location scouts, and more — anything that benefits from organizing visual references on a collaborative canvas.' },
      { q: 'Who is Clusters for?', a: 'Film, photo, design, and brand teams — anyone doing visual, reference-driven creative work who wants it organized, collaborative, and shareable.' },
      { q: 'Where can I see example boards?', a: 'Visit the Explore gallery to browse curated public boards made with Clusters, then start your own free.' },
    ],
    related: [
      '/tools/mood-board-maker',
      '/tools/look-book-maker',
      '/tools/storyboard-maker',
      '/tools/shot-list-maker',
      '/tools/free-mood-board-maker',
      '/vs/milanote',
      '/vs/pureref',
      '/vs/miro',
    ],
  },
];

// Attach the signup CTA href to each page (campaign = last path segment).
for (const p of PAGES) {
  const campaign = p.path.replace(/^\//, '').replace(/\//g, '_');
  p.cta = { ...p.cta, href: SIGNUP(campaign) };
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
