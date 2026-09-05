// Self-authored SEO landing pages — the data registry.
//
// This is a PURE-DATA module (no JSX) so it can be imported by BOTH the React
// component (src/pages/SeoLandingPage.jsx) and the Cloudflare Worker
// (src/worker.js) — the Worker can't import JSX, and duplicating the copy would
// let the crawlable server-rendered text drift from what React renders
// (anti-cloaking). One source of truth for both.
//
// The ONE permitted import is the enforced card cap. Every free-tier claim on
// this page must be the number the server actually enforces: these strings sat
// at a hand-typed "100 cards" through migration 0229 and would have become a
// public falsehood the moment the cap moved. demoCardCap.js is pure ESM with no
// dependencies, so both the Worker and React bundles still resolve it.
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

import { DEMO_CARD_LIMIT } from './demoCardCap.js';

const SIGNUP = (campaign) =>
  `/?utm_source=seo&utm_medium=landing&utm_campaign=${campaign}`;

const PAGES = [
  // ────────────────────────────────────────────────────────────────────────
  // SOLEIL SCOUT — the zero-UI wedge. Its own top-level path (not under
  // /tools/) because it's a distinct product surface, not another
  // "X maker" page, and because the whole pitch is that there's nothing
  // to open.
  //
  // This is the ONE spec rendered by something other than SeoLandingPage:
  // pages/ScoutPage.jsx lays it out as a text thread, because the product is
  // a text thread. The spec shape is unchanged, so the Worker's meta,
  // crawlable HTML, JSON-LD and the sitemap all keep working from this same
  // data — which is what keeps server and client in parity. Edit the copy
  // here and both surfaces move together, as with every other page.
  //
  // COPY HONESTY: iMessage is the only confirmed transport. Photon lists
  // SMS/RCS as included but ships no provider doc for it, and their own
  // FAQ asks when it's coming. Nothing here promises Android until that's
  // answered — see the FAQ entry, which says so plainly.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/scout',
    kind: 'tool',
    title: 'Soleil Scout — Text Your Location Photos Onto a Board',
    metaDescription:
      'Text photos, links and notes from set. They land arranged on an infinite canvas, grouped by scene. No app to install, no login, no forms.',
    h1: 'Text your scout photos. Get a board.',
    // One line, and deliberately NOT about location scouting. The product is
    // named Scout and the page ranks for scouting terms, but a location manager
    // is one of the people on a set who shoots reference all day — an AD, a
    // gaffer, a production designer all have the same camera-roll problem, and
    // a subhead that says "shoot the location" tells four of them this isn't
    // for them. "What you're looking at" covers every one of them.
    subhead: 'Text what you’re looking at. It lands on a canvas your whole team can open.',
    // Sentences kept SHORT on purpose. ScoutPage.jsx renders this spec as a
    // text thread, one sentence per bubble, so a 33-word sentence is a bubble
    // nobody reads. Anything over ~22 words has to be split at the source.
    answer:
      'Soleil Scout is a text-message ingest bot for film crews. Send photos, links or notes from your phone. They land on an infinite Soleil Clusters canvas, grouped by what you said. No app to install and no signup — your board and account are created the first time you text.',
    updated: '2026-08-07',
    cta: { label: 'Start scouting — free', sub: 'No app. No signup. Text and it exists.' },
    stepsHeading: 'How Soleil Scout works',
    steps: [
      { t: 'Text the number', d: 'Send your first photo. A board and an account are created behind you — no form, no password.' },
      { t: 'Say what it is', d: 'Add "Scene 4 diner" or "power drops look sketchy". Scout reads it and titles the group.' },
      { t: 'Keep shooting', d: 'Send twelve more. They batch into one tidy grid instead of twelve replies and twelve piles.' },
      { t: 'Tap the link', d: 'Land on your canvas, signed in, with exactly the photos you just sent already selected.' },
      { t: 'File it later', d: 'Everything collects in your Scout Bin. Say "put these in Diner Recce" and Scout confirms what moves before it moves anything.' },
    ],
    // SHORT ON PURPOSE. These render as notes that stream past a pinned signup
    // box (pages/ScoutPage.jsx), the way the primary landing page's notes do —
    // a 90-word paragraph floating beside the box is unreadable there. Cutting
    // them here rather than in the renderer is what keeps the crawler and the
    // reader seeing the same page; trimming only the visible copy would be
    // cloaking.
    sections: [
      {
        heading: 'The camera roll is where reference photos go to die',
        body: 'Two hundred photos in an afternoon, all landing in one undifferentiated roll. Say what a thing is while you are standing in front of it, and the board organizes itself.',
        bullets: [
          'Photos group under what you called them, not the order you shot them',
          'A note lands beside the photos it refers to, not at the bottom of a list',
          'Links to listings or reference videos become real cards, not blue text',
        ],
      },
      {
        heading: 'Nothing to install, on purpose',
        body: 'Nobody installs an app in a parking lot on one bar of signal. Scout lives in the messages app already open on their phone — the first photo is the onboarding.',
      },
      {
        heading: 'It batches like a person would',
        body: 'Twelve photos means twelve messages seconds apart. Scout waits until you have finished, lays them out once, and sends a single confirmation.',
      },
      {
        heading: 'Your photos, at full resolution, on a real canvas',
        body: 'What arrives is not a chat log. It is an infinite canvas you can rearrange, draw on and share with one link. The same board your director opens on a laptop.',
        bullets: [
          'Real cards you can move, group, and connect with arrows',
          'Share the whole board with one link, no account needed to view',
          `Free to start — ${DEMO_CARD_LIMIT} cards, unlimited boards, collaborators and photo uploads`,
        ],
      },
    ],
    faq: [
      { q: 'Do I need to install anything?', a: 'No. You text a number from the messages app already on your phone. No download, no account, no password. Your board exists from the first photo you send.' },
      // Deliberately does NOT rule Android out. Whether SMS/RCS is live is
      // Photon's open question 3 (scout/README.md) — their pricing lists it as
      // included, their own FAQ asks when it ships. Nobody is signing up for a
      // line that exists yet either way, so the honest answer is "we text you
      // when yours is ready" rather than a platform promise in either
      // direction. Firm this up once Photon answers.
      { q: 'Does it work on Android?', a: 'Scout is invite-only right now — leave your number and it texts you when your line is ready. iPhone works over iMessage; Android follows as soon as SMS delivery is confirmed.' },
      { q: 'What happens to my photos?', a: 'They upload at full resolution to your own private board. Nobody else sees them unless you share it.' },
      { q: 'How does it know where to put things?', a: 'It reads what you wrote. Text "Scene 4 diner" with five photos and it titles the group. Everything collects in your Scout Bin until you file it — and Scout shows you exactly what will move first.' },
      { q: 'Is it free?', a: `Yes, to start. The free tier covers ${DEMO_CARD_LIMIT} cards across unlimited boards, with unlimited photo uploads and collaborators included. Creator ($25/mo) lifts the cap and adds 100GB and any file type.` },
      // Honest about what is actually live: linking Scout to an account you
      // already have needs the Settings → Scout tab, which is deliberately not
      // shipped yet (the bot has no line to answer on). Restore the "connect
      // from Settings" wording in the same change that promotes that tab.
      { q: 'Can I use it with a board I already have?', a: 'Say "put these in <board name>" any time and Scout files into that board. Linking Scout to an account you already have is coming. For now, your first text creates a board of its own.' },
    ],
    related: ['/tools/mood-board-maker', '/tools/shot-list-maker', '/tools/look-book-maker', '/use-cases'],
  },
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
    updated: '2026-08-10',
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
          'Drag in images, links, video, PDFs — and any file type on Creator',
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
      { q: 'Is the mood board maker free?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards across unlimited boards, with unlimited photo uploads and collaborators included. Creator ($25/mo) removes the card cap and adds 100GB storage and any file type — collaboration is free for everyone.` },
      { q: 'Can I make a mood board with my team?', a: 'Yes — Clusters is a real-time collaborative canvas. Multiple people can edit the same board at once with live cursors, comments, and presence, so your whole team can build the board together.' },
      { q: 'What can I put on a mood board?', a: 'Images, screenshots, links, video, audio, PDFs, rich-text notes, color palettes, and any other file type on Creator. Everything lives on one infinite canvas you can pan and zoom.' },
      { q: 'Can I share a mood board without making people sign up?', a: 'Yes. Every board can be shared with a single public link that opens a clean, interactive read-only preview — no account required for viewers.' },
      { q: 'Do I need to install anything?', a: 'No. Clusters runs in your browser, with native iOS and Android apps if you want them. There is nothing to download to get started.' },
          { q: 'Can an AI assistant make the board for me?', a: 'Yes. Connect Claude or any MCP client with one URL and ask. It creates the cluster, brings in references from links you give it, and arranges them as justified rows or masonry. It works with your own images rather than generating them — see the AI mood board maker page.' },
],
    related: ['/tools/storyboard-maker', '/tools/look-book-maker', '/best/mood-board-apps', '/vs/milanote', '/vs/pureref', '/use-cases', '/tools/ai-mood-board-maker'],
  },

  // ────────────────────────────────────────────────────────────────────────
  // The assistant angle. Every other page here sells the canvas; this one
  // sells the thing none of the tools we compare against can do, which only
  // became true the day the OAuth flow shipped: you point Claude at a URL and
  // it builds the board.
  //
  // COPY HONESTY — the whole page turns on it. "AI mood board" searches are
  // dominated by image GENERATORS, and we are not one. Saying so in the first
  // paragraph loses the visitor who wanted a generator, and that is correct:
  // they were never going to stay, and a reference board made of invented
  // pictures is not reference. What is left is the person who has the images
  // already, which is who the product is for.
  //
  // Nothing here claims a competitor cannot be reached by an assistant.
  // Checked before writing: Miro HAS MCP servers in the official registry, so
  // a blanket "only we can do this" would have been false. Milanote, PureRef,
  // Boords and StudioBinder return nothing there, and those are named.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/tools/ai-mood-board-maker',
    kind: 'tool',
    title: 'AI Mood Board Maker — Build Boards with Claude',
    metaDescription:
      'Connect Claude or any MCP client to Soleil Clusters and ask for a mood board. It gathers and arranges your own references — it does not invent pictures.',
    h1: 'AI Mood Board Maker',
    subhead:
      'Point Claude at your clusters and ask. It builds the board, brings in the references, and lays them out.',
    answer:
      'Soleil Clusters connects to Claude and any other MCP client, so you can ask an assistant to build a mood board for you. It creates the board, pulls in images from links you give it, and lays them out as justified rows or masonry. It arranges your own references rather than generating pictures, and reaches only what your account reaches.',
    updated: '2026-08-10',
    cta: { label: 'Connect your assistant — free', sub: 'One URL. Approve it in the browser. No token to paste.' },
    stepsHeading: 'How to build a mood board with your assistant',
    steps: [
      { t: 'Add the URL to your client', d: 'In Claude, or any MCP client, add https://clusters.soleilpictures.com/api/v1/mcp as a connector. There is nothing to install.' },
      { t: 'Approve it once', d: 'A browser opens, you sign in with your email, and you press Allow. If you do not have an account yet, that screen makes one.' },
      { t: 'Ask for what you want', d: 'Describe the board in plain language — the project, the references you have, how you want them grouped.' },
      { t: 'Open it and take over', d: 'The board is a normal cluster. Drag things, add notes, share the link. The assistant started it; it is yours.' },
    ],
    sections: [
      {
        heading: 'It arranges your references. It does not invent them.',
        body: 'Most tools that answer to "AI mood board" generate the images. This one does not, and that is the point. A reference board is an argument about a real look — a lens, a film stock, a colourist’s hand, a frame somebody actually shot. Fill it with pictures that never existed and you have a board nobody can match on the day. Bring your own references and the assistant does the tedious half: collecting, arranging, labelling, keeping it tidy as it grows.',
        bullets: [
          'Works with the images and links you already have',
          'Pulls references from URLs you give it, in one pass',
          'Lays them out as justified rows or balanced masonry columns',
        ],
      },
      {
        heading: 'What "ask for a mood board" actually does',
        body: 'The assistant gets a set of tools, not a text box. It can make a cluster, add image, note, link, video and PDF cards, import a list of URLs in one go, group cards that belong together, put section headings over them, and re-arrange the whole board on request. Ask it to tidy up and it re-flows the layout; ask it to pull twelve references and it fetches them and files them.',
        bullets: [
          'Creates clusters and cards, in bulk',
          'Imports from a list of links — safe to run twice, nothing duplicates',
          'Re-arranges an existing board without touching what you positioned by hand',
        ],
      },
      {
        heading: 'Connecting is a URL and one button',
        body: 'Soleil Clusters is its own OAuth 2.1 authorization server, listed in the official Model Context Protocol registry as com.soleilpictures/clusters. Your client discovers the sign-in flow by itself, opens a browser, and you approve once. No key to generate, nothing to paste into a configuration file, and no separate account — signing in is a single email box that makes the account if you do not have one.',
        bullets: [
          'Nothing to install for the hosted server',
          'An npm package for local files, if you want to upload video from your own disk',
          'Disconnect any time under Settings → API',
        ],
      },
      {
        heading: 'It reaches exactly what you reach',
        body: 'A connected assistant runs as you, under the same permissions as your browser session — so it can see the clusters you can see, and nothing else. Deleting is a separate permission from writing, deliberately, so an assistant can be allowed to build without being allowed to throw anything away. Every call it makes is recorded, with the name of the tool it used, in an audit log you can read.',
        bullets: [
          'Same permissions as your own account, enforced by the database',
          'Deleting is opt-in and off by default',
          'An audit log of every action, naming the tool',
        ],
      },
    ],
    faq: [
      { q: 'Does it generate images with AI?', a: 'No. It works with references you already have, or that you point it at with a link. It builds and arranges the board; it does not invent pictures. For reference work that is the right way round — a board full of images nobody can actually shoot is not much use on the day.' },
      { q: 'Which assistants work with it?', a: 'Claude, and any other client that speaks the Model Context Protocol. The hosted server is a URL, so anything that can add a remote MCP connector can use it. There is also an npm package, soleil-clusters-mcp, for clients that need to read files off your own machine.' },
      { q: 'Do I need to be a developer?', a: 'No. You add one URL to your assistant and press Allow in the browser. There is no key to generate and nothing to paste into a configuration file.' },
      { q: 'Can the assistant delete my work?', a: 'Only if you let it. Deleting is a separate permission from writing and is not granted by default, so an assistant can build boards without being able to remove anything. You can disconnect it at any time under Settings → API, which stops it working immediately.' },
      { q: 'Can it see all of my boards?', a: 'It sees exactly what your account sees — no more. It runs as you, under the same database permissions as your browser session, so a cluster you cannot open is one it cannot open either.' },
      { q: 'Is it free?', a: `Yes. Connecting an assistant costs nothing and works on the free plan. The usual plan limits apply to what it creates, exactly as they would if you made those cards yourself — the free Demo tier covers ${DEMO_CARD_LIMIT} cards across unlimited boards.` },
    ],
    related: ['/tools/mood-board-maker', '/tools/shot-list-maker', '/tools/reference-board-maker', '/best/mood-board-apps', '/vs/pureref', '/use-cases'],
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
      { q: 'Is it free?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards across unlimited boards, with unlimited photo uploads. Creator ($25/mo) removes the card cap and adds 100GB storage and any file type — collaborators edit free.` },
    ],
    siblingListicle: { path: '/best/storyboard-software', label: 'See all 10 storyboard tools, ranked by a film studio.' },
    related: ['/tools/shot-list-maker', '/tools/mood-board-maker', '/best/storyboard-software', '/use-cases'],
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
      { q: 'Is it free to start?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards across unlimited boards, with no credit card and no trial clock. Creator ($25/mo) removes the card cap and adds 100GB storage and any file type.` },
      { q: 'How do I make a shot list for a short film?', a: 'Make a board per scene, add a card per shot with its reference frame, lens, and movement, then add a schedule card to map shots to days. Open the short-film shot list example board below to see a finished one.' },
      { q: 'Does Clusters have a shot list template?', a: 'The fastest start is the public short-film shot list example board — open it, see how the shot cards and schedule are structured, and rebuild that structure in your own board in a few minutes.' },
      { q: 'Is this a shot planner?', a: 'Yes — planning the shots is the whole point. Each shot card carries its reference frame, lens, and movement, the schedule card maps shots to shoot days and locations, and the crew works from one live board. If what you searched for was a shot planner, this is that tool with the pictures kept in.' },
    ],
    related: ['/tools/storyboard-maker', '/tools/mood-board-maker', '/best/storyboard-software', '/use-cases', '/tools/ai-mood-board-maker'],
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
      { q: 'Is it free?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards across unlimited boards, with unlimited photo uploads. Creator ($25/mo) adds unlimited cards, 100GB storage, and any file type.` },
    ],
    related: ['/tools/mood-board-maker', '/vs/milanote', '/use-cases', '/tools/ai-mood-board-maker'],
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
      'Yes — you can make a mood board online free with Soleil Clusters. The Demo tier needs no credit card: open the browser app, drop in images, links, notes, and color palettes on an infinite canvas, and share the board with a public link. Upgrading only matters when you want unlimited cards and 100GB storage.',
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
        body: 'A lot of "free" tools are a demo with a wall. Clusters’ Demo tier lets you build a real mood board — images, notes, links, and color palettes on an infinite canvas — and share it, without paying and without installing anything. When you outgrow it, Creator is $25/mo for unlimited cards and 100GB.',
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
      { q: 'Is it really free?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards across unlimited boards, with no credit card and no trial clock. Creator ($25/mo) removes the card cap and adds 100GB storage and any file type.` },
      { q: 'Do I have to download anything?', a: 'No. It runs in your browser. Native iOS and Android apps are available if you prefer, but nothing is required to start.' },
      { q: 'What is the catch with the free tier?', a: 'The Demo tier is a generous sandbox capped at a set number of cards — collaboration is free, and invited editors edit on any tier. Upgrading to Creator removes the cap and adds any file type and 100GB storage.' },
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
        body: `The Demo tier is genuinely free: no credit card, no trial countdown, and ${DEMO_CARD_LIMIT} cards across unlimited boards. Invited collaborators edit free on every tier. When a team needs any file type or serious storage, Creator is a flat $25 a month — not per seat — with unlimited cards and 100GB of storage.`,
      },
      {
        heading: 'The case for staying on desktop',
        body: 'A browser tool isn’t the answer for everyone, and it’s worth being plain about it. Clusters needs a connection — it can’t ride along on a flight or an air-gapped workstation. If your reference never needs to leave your own machine, a local app like PureRef is hard to argue with: pay-what-you-want for personal use, and it does one thing very well. The honest split is this — work alone and offline, and the desktop standard fits; work across devices or with other people, and the browser wins. If you’re weighing the two directly, our full PureRef comparison includes the rows PureRef wins.',
      },
    ],
    faq: [
      { q: 'What is a reference board?', a: 'A reference board is a collection of images an artist keeps in view while working — anatomy studies, lighting setups, material close-ups, frames from films. Unlike a presentation deck, it’s built for the artist’s own eyes: the point is fast glancing and zooming while you paint, model, or shoot.' },
      { q: 'What’s the difference between a reference board and a mood board?', a: 'A mood board communicates a direction to other people; a reference board supports the work itself. Mood boards get presented once, while reference boards stay open for the whole life of the piece. Clusters handles both, but this page is about the working kind.' },
      { q: 'Is there a free online reference board maker?', a: `Yes — Soleil Clusters’ Demo tier is free with no credit card and no trial clock, and covers ${DEMO_CARD_LIMIT} cards across unlimited boards. It runs in the browser with nothing to install.` },
      { q: 'Do I need to install anything to make a reference board?', a: 'No. Clusters runs entirely in the browser on any machine, which matters on studio workstations where you can’t install software. Native iOS and Android apps are also available if you prefer one on mobile.' },
      { q: 'Can I use a reference board on an iPad?', a: 'Yes. Boards open in the tablet’s browser, and there’s a native iOS app as well — the same board you arranged on your workstation is waiting when you pick up the iPad.' },
      { q: 'Can my team or art director see my reference board?', a: 'Yes — one public link opens a clean, read-only view in any browser, with no account required. Invited collaborators can also edit the board live on any plan, with real-time cursors and comments pinned to specific images.' },
      { q: 'Can a reference board include video or other files?', a: 'Yes. Cards can be images, screenshots, links, video, audio, PDFs, notes, and color palettes — and on Creator, any file type. Motion reference sits on the board right next to your stills.' },
      { q: 'How does an online reference board compare to PureRef?', a: 'PureRef is a beloved offline desktop app — free to use personally, and excellent when the board never leaves your machine. Clusters trades offline for a board that follows you across devices and shares with a link. Our full PureRef comparison breaks it down feature by feature.' },
    ],
    related: ['/vs/pureref', '/tools/mood-board-maker', '/tools/free-mood-board-maker', '/use-cases', '/tools/ai-mood-board-maker'],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ALTERNATIVE-TO PAGES — capture people already shopping for a tool
  // Positioning is honest: competitors' genuine strengths are acknowledged.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/vs/milanote',
    kind: 'compare',
    title: 'Free Milanote Alternative — Flat Price, Real-Time Teams',
    metaDescription:
      'The free Milanote alternative without per-person pricing — a real-time multiplayer canvas with auto-tagging, 100GB storage and sharing.',
    h1: 'A Milanote Alternative Built for Production Teams',
    subhead:
      'Milanote is a lovely place to think. Clusters is where a team pulls a whole production together — live, on one canvas.',
    answer:
      'Soleil Clusters is a free Milanote alternative built for team production work: a real-time multiplayer canvas with live cursors, auto-tagging that files dropped references, a relationship graph across projects, and a free tier that never meters uploads — Creator is a flat $25/mo with 100GB storage. Milanote is strong for solo planning; Clusters is for visual, media-heavy, collaborative work.',
    updated: '2026-08-10',
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
        heading: 'A free Milanote alternative without the per-person bill',
        body: 'Milanote’s free plan caps the total number of items you can add — around a hundred notes, images, and links across everything — which tends to run out right in the middle of a real project. And its paid plans are priced per person. Clusters’ free Demo tier is a generous sandbox with no time limit, and Creator is a flat $25/mo for unlimited cards, 100GB of storage, and any file type — not a price that multiplies with every teammate you bring in.',
        bullets: [
          'No trial clock on the free Demo tier',
          'Flat $25/mo Creator — not per-person pricing',
          'Unlimited cards and 100GB on Creator',
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
        body: 'Milanote has a polished template library and a long track record, and its writing-and-planning flow is genuinely nice for solo ideation. If you mostly work alone on lightweight planning boards, it is a strong tool. Clusters earns its place when the work is visual, media-heavy, and collaborative — and when you do not want per-person pricing getting in the way.',
      },
      {
        heading: 'Switching is painless',
        body: 'Start a board, drag your references in, and share a link — there is nothing to install and nothing to migrate up front. Your Demo boards are free, and you only move to Creator when you want unlimited cards and 100GB.',
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
        // Our own number, stated plainly. "Generous card cap" was spin in a row
        // whose whole job is the comparison, and it is unquotable besides — an
        // assistant asked "what is the free cap" can do nothing with it. The
        // upload clause is the true difference and already carried by the FAQ
        // below; naming both is honest even though our raw cap is the smaller.
        { feature: 'Free-plan item cap', us: `${DEMO_CARD_LIMIT} cards, uploads never metered`, them: 'Caps items, plus 10 uploads ever' },
        { feature: 'Template library', us: 'Growing', them: 'Extensive' },
      ],
    },
    faq: [
      { q: 'Is Soleil Clusters a good Milanote alternative?', a: 'Yes, especially for teams doing visual, media-heavy, collaborative work. Clusters adds a real-time multiplayer canvas, auto-tagging, a relationship graph, and 100GB storage for any file type on Creator.' },
      { q: 'How is Clusters different from Milanote?', a: 'Clusters focuses on live team production — multiplayer editing with cursors and presence, automatic organization of dropped files, and connecting a whole project through a relationship graph — rather than solo planning boards.' },
      { q: 'Does Clusters have a free tier like Milanote?', a: `Yes. The Demo tier is free with no credit card and covers ${DEMO_CARD_LIMIT} cards across unlimited boards, with uploads never metered. Creator is $25/mo for unlimited cards, 100GB storage, and any file type.` },
      { q: 'Can I move my Milanote boards over?', a: 'You can drag your images, links, and files straight into a new Clusters board and share it — there is no complex migration to do first.' },
      { q: 'Does Milanote limit how many items I can add?', a: 'Yes — Milanote’s free plan caps the total number of items across your boards, and separately allows 10 file uploads, ever. Clusters’ free Demo tier also caps cards, but never meters uploads and has no time limit; Creator ($25/mo) removes the card cap and adds 100GB of storage.' },
      { q: 'Is Clusters cheaper than Milanote for a team?', a: 'Usually, because Clusters is flat-priced: Creator is $25/mo rather than a per-person subscription, and anyone you share a board with can view it free with one link.' },
      { q: 'Is there a free Milanote alternative without item caps?', a: 'Both free tiers cap items, so the honest answer is what the cap is made of. Milanote’s free plan also spends a budget of 10 file uploads that never resets; Soleil Clusters has no separate upload budget, has no trial clock, and Creator ($25/mo, flat) removes the card cap entirely. If you need genuinely uncapped, Obsidian Canvas keeps boards as local files.' },
      { q: 'What do filmmakers use instead of Milanote?', a: 'Many use Clusters, because pre-production is connected there: the mood board links to the storyboard, the shot list, and the schedule as one project, with screenplay mode built in — and the whole crew edits the same boards in real time.' },
      { q: 'Milanote vs Canva — and where does Clusters fit?', a: 'Canva is a template-driven graphics editor, strongest when the goal is a finished design. Milanote is a board app for planning and collecting ideas. Clusters covers that planning ground for production teams — a real-time multiplayer canvas that never meters uploads, where the finished board shares with one link a client can open without an account.' },
          { q: 'Can I drive it from an AI assistant?', a: 'Clusters connects to Claude and any other MCP client with a single URL, so you can ask an assistant to build a board, import references and arrange them. No Milanote server is listed in the official Model Context Protocol registry at the time of writing. Clusters works with the images you already have — it does not generate them.' },
],
    siblingListicle: { path: '/best/milanote-alternatives', label: 'See all 12 Milanote alternatives, ranked by a film studio.' },
    related: ['/best/milanote-alternatives', '/tools/mood-board-maker', '/tools/storyboard-maker', '/tools/shot-list-maker', '/vs/pureref', '/vs/miro', '/use-cases', '/tools/ai-mood-board-maker'],
  },
  {
    path: '/vs/pureref',
    kind: 'compare',
    // 2026-08-23 INTENT SPLIT. The 2026-08-04 experiment (lead with the
    // film-studio credential) worked: 0 clicks → 10 and position 11.3 → 8.9
    // across the pivot, on real per-day data (seo_page_daily, 0254). This is
    // the next move, and it is about which of two pages answers which query.
    //
    // /best/pureref-alternatives now OUTRANKS this page on 5 of the 6 shared
    // "alternative" queries (7.1 v 8.2, 5.0 v 9.0, 7.6 v 8.6, 7.0 v 7.3,
    // 9.4 v 9.8). Fighting it costs both. But this page UNIQUELY owns the
    // web-version intent — "pureref online" 6.3, "pure ref online" 5.9,
    // "pureref web" 5.5 — and earned ZERO clicks there, because the title led
    // with "Alternative" while the searcher typed "online". Top-six placement
    // converting at nothing is a snippet problem, not a ranking one.
    //
    // So: hand "alternative(s)" to the listicle, point this page at "online".
    // "PureRef Alternative" stays in the title as a hedge (and because
    // seo_health_expectations guards that substring), but it no longer leads.
    // The Milanote pair is INVERTED — /vs/milanote beats its listicle by ~30
    // positions — so do NOT mirror this there.
    title: 'PureRef Online — A Free PureRef Alternative in Your Browser',
    metaDescription:
      'There is no PureRef web version. Clusters is the closest thing online: the same drop-and-arrange reference wall, in your browser, shared with one link.',
    h1: 'PureRef Online: The Closest Thing, in Your Browser',
    subhead:
      'PureRef is a fast, offline reference window. Clusters is a collaborative reference workspace you can share and grow.',
    answer:
      'PureRef has no web version — it is a desktop app and always has been. Soleil Clusters is the closest thing online: the same drop-images-and-arrange reference wall, free in any browser, synced across devices and shareable with one link. PureRef still wins for a small always-on-top offline overlay.',
    updated: '2026-08-23',
    cta: { label: 'Try Clusters free', sub: 'Runs in your browser. Free to start.' },
    stepsHeading: 'How to move a PureRef board to Clusters',
    steps: [
      { t: 'Collect your images', d: 'Export the images from PureRef, or gather the original files you pinned.' },
      { t: 'Drag them onto a new board', d: 'Drop the whole set at once — auto-tagging files each reference as it lands.' },
      { t: 'Add what PureRef couldn’t hold', d: 'Put notes, links, video, and color palettes right beside the imagery.' },
      { t: 'Share one link', d: 'Send the board to your team or client — it opens in the browser, nothing to install.' },
    ],
    sections: [
      // LEAD SECTION, deliberately (2026-08-23). This page is now aimed at
      // "pureref online" / "pureref web", so the first thing on it has to
      // answer that question — including the part where the honest answer is
      // "no, and it never existed". A visitor who wanted literal PureRef in a
      // tab should be able to tell within one paragraph that this is not it.
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
        heading: 'From a local window to a shared workspace',
        body: 'PureRef is a brilliant lightweight desktop app for pinning reference images while you work. Clusters takes reference boards to the cloud: they live in your browser, sync across devices, and can be shared with a link or edited by your whole team in real time. Your references are backed up and reachable from anywhere, not trapped in a file on one machine.',
        bullets: [
          'Opens in any browser — nothing to install or update',
          'Boards sync across devices and back up automatically',
          'Share a read-only link no one has to download',
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
        heading: 'Something PureRef cannot do at all',
        body: 'PureRef is a local window on one machine. There is no API and nothing for an assistant to talk to, so a reference board built there is a board only you can touch. Clusters connects to Claude and other MCP clients: you can ask an assistant to pull a set of references, build the board and arrange it, then open the result and take over by hand. The images are still yours — it collects and arranges, it does not invent pictures.',
        bullets: [
          'Ask an assistant to gather and lay out a reference board',
          'Connect with a URL — nothing to install, no key to paste',
          'It reaches only what your account reaches, and deleting is off by default',
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
      { q: 'Is Clusters free?', a: 'Yes, the Demo tier is free with no credit card. Creator ($25/mo) adds unlimited cards, 100GB storage, and any file type.' },
          { q: 'Can an AI assistant work with my reference board?', a: 'In Clusters, yes — connect Claude or any MCP client with one URL and ask it to build or tidy a board. PureRef is an offline desktop app with no API, so there is nothing for an assistant to connect to. Clusters arranges the references you already have rather than generating images.' },
],
    siblingListicle: { path: '/best/pureref-alternatives', label: 'See all 10 PureRef alternatives, ranked by a film studio.' },
    related: ['/best/pureref-alternatives', '/tools/reference-board-maker', '/tools/mood-board-maker', '/tools/free-mood-board-maker', '/vs/milanote', '/use-cases', '/tools/ai-mood-board-maker'],
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
      { q: 'Does Clusters have a free tier?', a: 'Yes. The Demo tier is free; Creator is $25/mo for unlimited cards, 100GB storage, and any file type.' },
      { q: 'Is there a simpler Miro alternative for mood boards?', a: 'Yes — Clusters. It keeps the infinite collaborative canvas but strips the diagramming clutter, and adds the creative pieces Miro lacks: photo adjustments, color palettes, docs, and screenplay mode.' },
      { q: 'Can my team use Clusters without per-seat pricing?', a: 'Yes. Creator is a flat $25/mo — not a per-member subscription — and anyone you share with can open a board free with one link.' },
    ],
    related: ['/tools/storyboard-maker', '/tools/mood-board-maker', '/vs/milanote', '/use-cases', '/tools/ai-mood-board-maker'],
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
      '/best/pureref-alternatives',
      '/best/milanote-alternatives',
      '/best/mood-board-apps',
      '/best/storyboard-software',
      '/vs/milanote',
      '/vs/pureref',
      '/vs/miro',
      '/tools/ai-mood-board-maker',
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
