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
import { treatmentPageSteps } from './starterSections.js';
// The template store hold: data-free, so it costs neither bundle anything.
import { TEMPLATE_STORE_HELD, isTemplateStorePath } from './templatePaths.js';

// "Start from the storyboard template" is true only where the template store
// is. While it is held there is no storyboard template on production to start
// from, so the storyboard maker offers the grid alone — and the offer comes
// back by itself when the hold lifts.
const STORYBOARD_TEMPLATE_OFFERED = !TEMPLATE_STORE_HELD;

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
  //
  // INVITE-ONLY, EVERYWHERE (2026-10-02). The bot is not running: /scout
  // collects numbers for a waitlist. Until then every surface on this page says
  // so — the meta, the answer, the CTA and the steps heading — rather than the
  // answer's last sentence contradicting the four above it.
  //
  // PRE-REGISTRATION (metaDescription, 2026-10-02). Target predicate: queries
  // on this path matching '%scout%' or '%text%photo%', search_type 'web',
  // query='' rows for the page total. Window: ±14 days around the production
  // promotion, impression-weighted position. Floor: 200 post-change
  // impressions. This page has never come within an order of magnitude of
  // that floor, so the change is UNGRADABLE by design: it ships for truth (the
  // old meta described a live product), not for traffic. Do not read a result
  // off it.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/scout',
    kind: 'tool',
    title: 'Soleil Scout — Text Your Location Photos Onto a Board',
    metaDescription:
      'Soleil Scout turns texted photos, links and notes into a board, grouped by scene. Invite-only for now: leave your number and we text you when you are in.',
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
      'Soleil Scout is a text-message ingest bot for film crews. You text photos, links or notes from your phone. They land on an infinite Soleil Clusters canvas, grouped by what you said. Scout is not running yet. Leave your number and we text you when your line is ready.',
    updated: '2026-10-02',
    cta: { label: 'Join the Scout list — free', sub: 'Invite-only for now. Leave your number and we text you when your line is ready.' },
    stepsHeading: 'How Soleil Scout works once you are in',
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
          `Free to start — ${DEMO_CARD_LIMIT} cards, free collaborators, uploads never metered`,
        ],
      },
    ],
    faq: [
      { q: 'Do I need to install anything?', a: 'No. Once you are in, you text a number from the messages app already on your phone. No download, no account, no password. Your board exists from the first photo you send.' },
      // Deliberately does NOT rule Android out. Whether SMS/RCS is live is
      // Photon's open question 3 (scout/README.md) — their pricing lists it as
      // included, their own FAQ asks when it ships. Nobody is signing up for a
      // line that exists yet either way, so the honest answer is "we text you
      // when yours is ready" rather than a platform promise in either
      // direction. Firm this up once Photon answers.
      { q: 'Does it work on Android?', a: 'Scout is invite-only right now — leave your number and it texts you when your line is ready. iPhone works over iMessage; Android follows as soon as SMS delivery is confirmed.' },
      { q: 'What happens to my photos?', a: 'They upload at full resolution to your own private board. Nobody else sees them unless you share it.' },
      { q: 'How does it know where to put things?', a: 'It reads what you wrote. Text "Scene 4 diner" with five photos and it titles the group. Everything collects in your Scout Bin until you file it — and Scout shows you exactly what will move first.' },
      { q: 'Is it free?', a: `Yes, to start. The free tier covers ${DEMO_CARD_LIMIT} cards — each cluster is one — with free collaborators and uploads never metered. Creator ($25/mo) lifts the cap and adds 100GB and no size limits.` },
      // Settings → Connections carries the connect code on main, but
      // PRODUCTION's ConnectionsTab holds the Scout section ("SCOUT IS HELD ON
      // PRODUCTION") because connecting a phone there ends in silence. So this
      // names no Settings screen until the bot is running and that hold lifts.
      { q: 'Can I use it with a board I already have?', a: 'Yes, once you are in. Linking the account you already have comes with your invite. After that, say "put these in <board name>" and Scout files into that board.' },
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
    updated: '2026-10-02',
    cta: { label: 'Start a mood board — free', sub: 'No credit card. Your first board in seconds.' },
    stepsHeading: 'How to make a mood board',
    steps: [
      { t: 'Start a board', d: 'Open Clusters and create a blank board — an infinite canvas you can pan and zoom.' },
      { t: 'Drop in your references', d: 'Drag images, screenshots, links, and files straight onto the canvas — select everything in a folder and it all lands in one drop.' },
      { t: 'Add color and notes', d: 'Add a color palette and rich-text notes or a brief right beside the imagery.' },
      { t: 'Arrange and connect', d: 'Move cards freely, group related references, and draw arrows to show how ideas relate.' },
      { t: 'Share it', d: 'Send one link for a clean, interactive preview — or invite your team to build the board live with you.' },
    ],
    sections: [
      {
        heading: 'Everything in one place, not fifteen tabs',
        body: 'A mood board is only useful when everything lives together. Clusters lets you drop images, screenshots, links, PDFs, video, and color palettes onto the same canvas, arrange them freely, and pull relationships between them with arrows. Tag anything — a card, a group, a whole board — and the tag gathers it from every board in the workspace, so a growing project stays findable.',
        bullets: [
          'Drag in images, links, video, PDFs — any file, with no size limits on Creator',
          'Tags gather references from every board into one view',
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
      { q: 'Is the mood board maker free?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards — every cluster you make is one of them — with collaborators included and uploads never metered. Creator ($25/mo) removes the card cap and adds 100GB storage with no size limits — collaboration is free for everyone.` },
      { q: 'Can I make a mood board with my team?', a: 'Yes — Clusters is a real-time collaborative canvas. Multiple people can edit the same board at once with live cursors, comments, and presence, so your whole team can build the board together.' },
      { q: 'What can I put on a mood board?', a: 'Images, screenshots, links, video, audio, PDFs, rich-text notes, color palettes, and any other file — with no size limits on Creator. Everything lives on one infinite canvas you can pan and zoom.' },
      { q: 'Can I share a mood board without making people sign up?', a: 'Yes. Every board can be shared with a single public link that opens a clean, interactive read-only preview — no account required for viewers.' },
      { q: 'Do I need to install anything?', a: 'No. Clusters runs in your browser; on a phone or tablet it can be added to the home screen as a web app. There is nothing to download to get started, and no store app yet.' },
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
      { q: 'Is it free?', a: `Yes. Connecting an assistant costs nothing and works on the free plan. The usual plan limits apply to what it creates, exactly as they would if you made those cards yourself — the free Demo tier covers ${DEMO_CARD_LIMIT} cards, and every cluster counts as one.` },
    ],
    related: ['/tools/mood-board-maker', '/tools/shot-list-maker', '/tools/reference-board-maker', '/best/mood-board-apps', '/vs/pureref', '/use-cases', '/vs/storyflow'],
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
      'Soleil Clusters is an online storyboard maker: lay each shot out as a grid card, drop a still or sketch into the frame, write the action on the line beneath, and let each shot number itself by where it sits. Your director, DP, and AD edit the same storyboard live, and one link shares it.',
    updated: '2026-10-02',
    cta: { label: 'Start a storyboard — free', sub: 'No credit card. Free to start.' },
    stepsHeading: 'How to make a storyboard',
    steps: [
      { t: 'Add a grid card', d: `Drop a grid onto the board and cut it into a frame with an action line beneath${STORYBOARD_TEMPLATE_OFFERED ? ' — or start from the storyboard template' : ''}.` },
      { t: 'Fill each frame', d: 'Drop a reference still or a sketch into the frame, and write the action on the line beneath it.' },
      { t: 'Number your shots', d: 'Type SHOT [#] in a box, then stamp the next shot from the + on the grid’s edge. Each new shot carries the box and numbers itself by where it sits.' },
      { t: 'Add the shot list', d: 'Put a doc beside the frames — a table works — for lens, camera movement, and shoot day.' },
      { t: 'Share with the crew', d: 'Send one link, or invite your DP and AD to edit and comment on the frames in real time.' },
    ],
    sections: [
      {
        heading: 'A grid built for sequences',
        body: "Clusters' grid cards give you a clean, modular storyboard layout: split any cell, drop an image or sketch into each frame, and write the action in the box beneath it. Stamp the next shot from the + on the grid's edge and every shot shares the layout; a SHOT [#] box numbers each one by where it sits, so the storyboard reads top to bottom the way your crew will shoot it.",
        bullets: [
          'Modular grid cells you can split, merge and resize',
          'Shots that number themselves as you stamp them',
          'Sketch on the canvas or drop in reference stills',
        ],
      },
      {
        heading: 'Shot list and storyboard, side by side',
        body: 'A storyboard without a shot list is half the picture. Put a rich-text doc right next to your frames — a table of lens, movement, location and day — so the visual and the logistics never drift apart. Screenplay mode is built in if you want to write the scene beside the board.',
      },
      {
        heading: 'Get the crew on the same page',
        body: 'Share the storyboard with a link, or invite your DP and 1st AD to edit alongside you in real time. Comments pin right onto the storyboard beside the frames in question, so feedback is specific instead of a paragraph in an email.',
      },
    ],
    faq: [
      { q: 'How do I make a storyboard in Clusters?', a: `Add a grid card and cut it into a frame with an action line beneath${STORYBOARD_TEMPLATE_OFFERED ? ', or start from the storyboard template' : ''}. Drop a still or sketch into each frame and write the action underneath. Type SHOT [#] in a box and stamp the next shot from the + on the grid’s edge: each new shot numbers itself by where it sits.` },
      { q: 'Can I draw my own frames?', a: 'Yes. You can sketch directly on the canvas with the draw tools, or drop in reference photos, screenshots, or AI-generated frames — whatever your process uses.' },
      { q: 'Can I keep a shot list with the storyboard?', a: 'Yes. Put a doc beside your frames — tables work — to track lens, camera movement, location, and shoot day, so the visual board and the logistics stay together.' },
      { q: 'Can my crew collaborate on the storyboard?', a: 'Yes — Clusters is real-time. Your director, DP, and AD can edit and comment on the same storyboard at once with live cursors and presence.' },
      { q: 'Is it free?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards — every cluster you make is one of them — with uploads never metered. Creator ($25/mo) removes the card cap and adds 100GB storage with no size limits — collaborators edit free.` },
    ],
    siblingListicle: { path: '/best/storyboard-software', label: 'See all 10 storyboard tools, ranked by a film studio.' },
    related: ['/tools/shot-list-maker', '/tools/directors-treatment', '/tools/cinematography-lookbook', '/tools/mood-board-maker', '/best/storyboard-software', '/use-cases'],
  },
  {
    path: '/tools/shot-list-maker',
    kind: 'tool',
    title: 'Shot List Maker — Visual Shot Lists Your Crew Can Use',
    metaDescription:
      'Build a shot list your crew will actually use: every shot carries its reference frame, lens, and notes. Toggle canvas or list view. Share one live link.',
    h1: 'Shot List Maker',
    subhead:
      'Keep your shots, reference frames, and notes on one board — visual and organized, not buried in a spreadsheet.',
    answer:
      'Soleil Clusters is a visual shot list maker: every shot gets its own card with a reference frame, lens, and movement notes, and the board toggles between a freeform canvas and a clean list view. Link it to your storyboard and mood board, group shots into a cluster per shoot day, and share one live link with the crew.',
    updated: '2026-10-01',
    cta: { label: 'Build a shot list — free', sub: 'Free to start. No install.' },
    stepsHeading: 'How to make a shot list',
    steps: [
      { t: 'Start a board for the scene', d: 'One board per scene or setup keeps the day organized.' },
      { t: 'Add a card per shot', d: 'Give each shot its own card with a reference frame plus lens and movement notes.' },
      { t: 'Switch views as needed', d: 'Toggle to list view for a clean table; back to canvas to see the frames.' },
      { t: 'Group shots by day', d: 'Make a cluster per shoot day or location and drag each shot card into it.' },
      { t: 'Share live', d: 'Invite the crew so everyone works from one source of truth that updates in real time.' },
    ],
    sections: [
      {
        heading: 'A shot list with pictures, not just rows',
        body: 'A spreadsheet tells you what to shoot; it never shows you. In Clusters your shot list lives on a visual board, so each shot can carry its own reference frame, lens note, and movement right beside the description. Switch a board to list view when you want the clean table, and back to canvas when you want to see it.',
        bullets: [
          'Every shot carries its reference frame and notes',
          'Toggle between visual canvas and a clean list view',
          'Group shots into a cluster per scene or shoot day',
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
        body: 'A shot list earns its keep on the day. File every shot into a cluster for its shoot day or location, and when the plan changes — a company move runs long, a setup gets dropped — move the card once and the whole crew sees it live. If someone insists on paper, print the board or a doc to PDF and hand it to them.',
        bullets: [
          'A cluster per day or location keeps the order of play visible',
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
      { q: 'How is this better than a shot list spreadsheet?', a: 'Each shot can carry its own reference frame, lens, and movement notes on a visual board, and you can still toggle to a clean list view. It connects directly to your storyboard and mood board instead of living in a separate file.' },
      { q: 'Can I organize shots by scene or day?', a: 'Yes. Group shots on the canvas, and make a nested board per scene or per shoot day — drag a shot card into it to file it there.' },
      { q: 'Can the crew see updates in real time?', a: 'Yes. Clusters is a live board, so when you change a shot everyone viewing or editing sees the update immediately.' },
      { q: 'Can I export or share the shot list?', a: 'Yes. Share a live link with your crew, or export boards and docs to PDF.' },
      { q: 'Is it free to start?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards — every cluster you make is one of them — with no credit card and no trial clock. Creator ($25/mo) removes the card cap and adds 100GB storage with no size limits.` },
      { q: 'How do I make a shot list for a short film?', a: 'Make a board per scene, add a card per shot with its reference frame, lens, and movement, then group the shots into a cluster per shoot day. Open the short-film shot list example board below to see a finished one.' },
      { q: 'Does Clusters have a shot list template?', a: 'The fastest start is the public short-film shot list example board — open it, see how the shot cards are structured, and rebuild that structure in your own board in a few minutes.' },
      { q: 'Is this a shot planner?', a: 'Yes — planning the shots is the whole point. Each shot card carries its reference frame, lens, and movement, nested clusters group the shots by shoot day and location, and the crew works from one live board. If what you searched for was a shot planner, this is that tool with the pictures kept in.' },
    ],
    related: ['/tools/storyboard-maker', '/tools/cinematography-lookbook', '/tools/mood-board-maker', '/best/storyboard-software', '/use-cases', '/tools/ai-mood-board-maker'],
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
      'Soleil Clusters is an online look book maker: arrange imagery in clean grid spreads, unify the set with non-destructive photo adjustments, add color palettes for the season’s story, and send clients one link to the polished, interactive board itself — no account or download required to view it.',
    updated: '2026-10-02',
    cta: { label: 'Make a look book — free', sub: 'Free to start. Share with one link.' },
    stepsHeading: 'How to make a look book',
    steps: [
      { t: 'Start a board and set the mood', d: 'Begin with a blank canvas — or a nested board per season, campaign, or client.' },
      { t: 'Drop in your looks', d: 'Add your imagery and references, then adjust them non-destructively to unify the set.' },
      { t: 'Arrange the spreads', d: 'Use grid layouts for tidy, editorial spreads that read intentionally.' },
      { t: 'Pull a color story', d: 'Add a palette card so the color direction sits right in the presentation.' },
      { t: 'Send a link', d: 'Share a single link for a polished, interactive look book — no account needed to view.' },
    ],
    sections: [
      {
        heading: 'Composed, not cluttered',
        body: 'A look book is a presentation. Clusters gives you a clean canvas with grids, palettes, and image cards you can resize, adjust, and arrange until each spread reads exactly the way you want. Non-destructive photo adjustments — brightness, contrast, warmth, black and white — let you unify a set of references without leaving the board.',
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
        body: 'Nest boards inside boards so a season, a campaign, or a client each has its own space, and use the relationship graph to move between them. Everything you reference stays yours, at up to 100GB with no size limits on Creator.',
      },
    ],
    faq: [
      { q: 'What is a look book maker?', a: 'A tool for arranging fashion, photography, or brand "looks" — imagery, references, and color palettes — into a polished, shareable presentation. Clusters does this on an infinite, collaborative canvas.' },
      { q: 'Can I adjust images inside the look book?', a: 'Yes. Clusters has non-destructive photo adjustments — brightness, contrast, saturation, warmth, black and white — so you can unify a set of references without a separate editor.' },
      { q: 'How do I share a look book with a client?', a: 'Send one link. The client sees a clean, interactive read-only preview with no account required, and you control whether it can be indexed by search engines.' },
      { q: 'Can I keep multiple look books organized?', a: 'Yes. Nest boards inside boards so each season, campaign, or client has its own space, and navigate between them with the relationship graph.' },
      { q: 'Is it free?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards — every cluster you make is one of them — with uploads never metered. Creator ($25/mo) adds unlimited cards, 100GB storage, and no size limits.` },
    ],
    related: ['/tools/mood-board-maker', '/tools/directors-treatment', '/tools/costume-design-mood-board', '/vs/milanote', '/use-cases', '/tools/ai-mood-board-maker'],
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
    updated: '2026-10-02',
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
        body: 'Start with a scratch board of references, then grow it into a structured project as the idea firms up: nest boards, connect them, and tag what matters so it stays findable. You never have to migrate to a "real" tool later — this is the real tool.',
      },
      {
        heading: 'Made for creative work',
        body: 'This is not a generic whiteboard. Clusters is built for film, photo, design, and brand teams — with color palettes, image adjustments, docs, and a relationship graph that ties a whole project together. The free tier is a genuine on-ramp to all of it.',
      },
    ],
    faq: [
      { q: 'Is it really free?', a: `Yes. The free Demo tier covers ${DEMO_CARD_LIMIT} cards — every cluster you make is one of them — with no credit card and no trial clock. Creator ($25/mo) removes the card cap and adds 100GB storage with no size limits.` },
      { q: 'Do I have to download anything?', a: 'No. It runs in your browser, and on a phone or tablet it can be added to the home screen as a web app. There is no store app to install, and nothing is required to start.' },
      { q: 'What is the catch with the free tier?', a: 'The Demo tier is a generous sandbox capped at a set number of cards — collaboration is free, and invited editors edit on any tier. Upgrading to Creator removes the cap and adds 100GB storage with no size limits.' },
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
    updated: '2026-10-05',
    cta: { label: 'Make a reference board', sub: 'Free Demo tier — no credit card, no trial clock.' },
    stepsHeading: 'How to make a reference board',
    steps: [
      { t: 'Gather everything in one place', d: 'Drag images, screenshots, and stills straight onto a new board. Paste links to pieces you found online, and drop in video clips or PDFs when your reference isn’t a still image.' },
      { t: 'Arrange by what you’re studying', d: 'Cluster the board around the problem — one area for lighting, one for anatomy, one for materials. The infinite canvas never runs out of room, and you can zoom from the whole board down to a single edge.' },
      { t: 'Tune the reference, not the file', d: 'Flip an image to black and white to read its values, nudge brightness or warmth to match your scene, and sample its colors into a palette with the eyedropper. Adjustments are non-destructive, so the original stays intact.' },
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
          'Steal the palette — sample swatches off any image with the eyedropper and keep them on the board beside the work they came from.',
          'Reference beyond stills — boards hold video, audio, PDFs, links, and rich-text notes alongside images; any other file lands as a card too, and Creator lifts the size caps.',
          'Sketch over it — draw directly on the canvas to mark a gesture line or call out a detail.',
          'One board per problem — nest boards inside boards so a project’s costume, lighting, and environment reference each stay findable, and tag an image once to find it from any board.',
        ],
      },
      {
        heading: 'Free to start, flat when you grow',
        body: `The Demo tier is genuinely free: no credit card, no trial countdown, and ${DEMO_CARD_LIMIT} cards, with each cluster you make counting as one. Invited collaborators edit free on every tier. When a team needs big files or serious storage, Creator is a flat $25 a month — not per seat — with unlimited cards and 100GB of storage.`,
      },
      {
        heading: 'The case for staying on desktop',
        body: 'A browser tool isn’t the answer for everyone, and it’s worth being plain about it. Clusters needs a connection — it can’t ride along on a flight or an air-gapped workstation. If your reference never needs to leave your own machine, a local app like PureRef is hard to argue with: pay-what-you-want for personal use, and it does one thing very well. The honest split is this — work alone and offline, and the desktop standard fits; work across devices or with other people, and the browser wins. If you’re weighing the two directly, our full PureRef comparison includes the rows PureRef wins.',
      },
    ],
    faq: [
      { q: 'What is a reference board?', a: 'A reference board is a collection of images an artist keeps in view while working — anatomy studies, lighting setups, material close-ups, frames from films. Unlike a presentation deck, it’s built for the artist’s own eyes: the point is fast glancing and zooming while you paint, model, or shoot.' },
      { q: 'What’s the difference between a reference board and a mood board?', a: 'A mood board communicates a direction to other people; a reference board supports the work itself. Mood boards get presented once, while reference boards stay open for the whole life of the piece. Clusters handles both, but this page is about the working kind.' },
      { q: 'Is there a free online reference board maker?', a: `Yes — Soleil Clusters’ Demo tier is free with no credit card and no trial clock, and covers ${DEMO_CARD_LIMIT} cards, with each cluster you make counting as one. It runs in the browser with nothing to install.` },
      { q: 'Do I need to install anything to make a reference board?', a: 'No. Clusters runs entirely in the browser on any machine, which matters on studio workstations where you can’t install software. On a phone or tablet it can be added to the home screen as a web app; there is no store app yet.' },
      { q: 'Can I use a reference board on an iPad?', a: 'Yes. Boards open in the tablet’s browser, and it can be added to the home screen as a web app — the same board you arranged on your workstation is waiting when you pick up the iPad.' },
      { q: 'Can my team or art director see my reference board?', a: 'Yes — one public link opens a clean, read-only view in any browser, with no account required. Invited collaborators can also edit the board live on any plan, with real-time cursors and comments pinned to specific images.' },
      { q: 'Can a reference board include video or other files?', a: 'Yes. Cards can be images, screenshots, links, video, audio, PDFs, notes, and color palettes — and any other file, at any size on Creator. Motion reference sits on the board right next to your stills.' },
      // The query /vs/pureref answers alone ("pureref online", "pureref web"),
      // answered on a second page in the same honest terms: in 2026-09 Google
      // dropped /vs/pureref for eight days and nothing else carried the intent.
      { q: 'Is there an online version of PureRef?', a: 'No. PureRef is a desktop app for Windows, macOS and Linux, and its boards are files on your machine. If you want the same drop-and-arrange reference board in a browser — opened on any device and shared with one link — Clusters is built for that. The trade is the connection: PureRef works offline, Clusters needs one.' },
      { q: 'How does an online reference board compare to PureRef?', a: 'PureRef is a beloved offline desktop app — free to use personally, and excellent when the board never leaves your machine. Clusters trades offline for a board that follows you across devices and shares with a link. Our full PureRef comparison breaks it down feature by feature.' },
    ],
    related: ['/vs/pureref', '/tools/shared-reference-board', '/tools/mood-board-maker', '/tools/free-mood-board-maker', '/use-cases', '/tools/ai-mood-board-maker'],
  },

  // ────────────────────────────────────────────────────────────────────────
  // PROFESSIONAL PAGES (2026-10-01). Owner: "pages that will target more PAID
  // industry professionals". Five pages, one per buyer the research found:
  // studio art teams (the people PureRef sells per-seat commercial licences
  // to, and the persona our deepest users already look like), directors
  // building a treatment (the highest willingness to pay found), and three
  // film departments.
  //
  // Written for assistants first. Search Console shows almost no professional
  // phrasing for this site (the long tail is anonymised), while ChatGPT's
  // crawler indexes new pages within days and ChatGPT already sends the
  // deepest users. Every claim below is live on PRODUCTION: no schedules (held
  // since 2026-09-01), no presentation mode, no approval or password links, no
  // auto-filing. Each page says plainly what Clusters does NOT do for that job.
  // Each carries "What it costs" (planBlock): these are written for crews, the
  // case where one owner-paid plan covering every editor is true and is
  // cheaper than per-seat tools from about three people up. Prices live only
  // in that block — none are typed here.
  //
  // PRE-REGISTERED READ, all five, from the production deploy:
  //   AEO: the probe questions added in 0351 cite clusters.soleilpictures.com
  //     within 8 weekly runs of the probe working (out of quota since 09-06).
  //   First-party: first lp_view on these paths, ship +3d to +45d. Success =
  //     >=10 AI-referred sessions and >=3 same-device signups across the five,
  //     with >=1 of those reaching 13 cards. Below that at day 45, stop adding
  //     department pages.
  //   Google: page-level web impressions, query=''; no title or meta edit on
  //     any of these before 200 post-ship impressions.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/tools/shared-reference-board',
    kind: 'tool',
    planBlock: true,
    title: 'Shared Reference Boards for Art Teams — Live, in the Browser',
    metaDescription:
      'One reference board for a whole art team: artists add to it live, the art director comments on the image itself, and nobody installs anything.',
    h1: 'Shared Reference Boards for Studio Art Teams',
    subhead:
      'One live wall of reference for a concept, VFX, game or 3D team — added to by everyone, opened from one link, with notes pinned to the image they are about.',
    answer:
      'Soleil Clusters is a shared reference board for studio art teams: an infinite canvas in the browser where every artist drops reference into the same board live, the art director comments directly on the image, and one link opens a read-only view. One plan covers the whole workspace, so there are no per-seat licences.',
    updated: '2026-10-02',
    cta: { label: 'Start a team board — free', sub: 'Free to start. Editors join free.' },
    stepsHeading: 'How a studio sets one up',
    steps: [
      { t: 'Make the project’s board', d: 'Create one cluster for the project and nest a cluster inside it per discipline or asset — characters, environments, props, FX.' },
      { t: 'Invite the team', d: 'Invite artists as editors by email or with an invite link. Editors are free on every plan, and everyone lands in the same live board.' },
      { t: 'Pull reference in bulk', d: 'Select everything in a folder and drag it in at once, paste image links, or bring in video and PDFs. Everything lands as cards you can arrange.' },
      { t: 'Mark what matters', d: 'Comment on a card or a group, tag references by character or setting, and put a vote card beside each option when the team has to pick one.' },
      { t: 'Show the supervisor', d: 'Send a view-only link — no account needed, set to expire after 7 or 30 days if you like — or invite them to comment.' },
    ],
    sections: [
      {
        heading: 'Why a reference wall stops working at team size',
        body: 'A desktop reference app is built for one artist on one machine. The board is a file; whoever made it has the latest version; everyone else has a screenshot of it from Tuesday. That is fine for a personal study sheet and wrong for a production, where the same reference has to steer six artists, survive a supervisor’s notes, and still be findable when the sequence comes back for revisions. A shared board moves the wall to a URL: one source, edited live, open on any workstation without installing anything — locked-down studio machines included.',
        bullets: [
          'One board at a URL, not a file on one machine',
          'Live cursors and presence show who is in the board',
          'Nothing to install on studio workstations',
        ],
      },
      {
        heading: 'Notes that stay on the image',
        body: 'Feedback in a chat thread drifts away from the picture it is about. In Clusters a comment pins to the card it is about and moves with it, so “push the rim light” sits beside the exact frame — with a thread, @mentions, and a resolve once it is handled. When the team has to choose, put a vote card beside each option and read the room without a meeting. Reviewers you invite comment and vote free.',
        bullets: [
          'Comments pinned to a card, a group, or a spot on the canvas',
          'Threads, @mentions and resolve',
          'Vote cards for “which of these” decisions',
        ],
      },
      {
        heading: 'Organised the way a studio thinks',
        body: 'Nest a cluster per character, environment or shot and the project stays navigable at hundreds of references. Tags cut across the nesting: type a tag as a character, a setting or a thing, and its view gathers every reference carrying it from anywhere in the workspace. Non-destructive adjustments — black and white for reading values, warmth, contrast — and swatches sampled off any image keep the reference working as reference, not just a gallery.',
        bullets: [
          'Nested clusters per character, environment or shot',
          'Typed tags gather a character’s references across boards',
          'Black-and-white value checks, and swatches sampled off any image',
        ],
      },
      {
        heading: 'One plan for the team, not a licence per seat',
        body: `Clusters has no per-seat charges at all. Editors are free on every plan, and every limit is charged to the workspace owner: the free plan gives the workspace ${DEMO_CARD_LIMIT} cards, with each cluster counting as one, shared by everyone working in it. Creator lifts that ceiling for the whole workspace at once and removes the per-file size limits — so a team of six pays for one plan, not six.`,
      },
      {
        heading: 'Where a desktop app is still the right call',
        body: 'If an artist needs reference floating always-on-top over their paint app on a flight, a local desktop app like PureRef does that and Clusters does not — it needs a connection and lives in a browser tab. Plenty of studios keep both: PureRef for the personal study sheet beside the canvas, and a shared Clusters board for the reference the team has to agree on.',
      },
    ],
    faq: [
      { q: 'What is the best way for an art team to share reference boards?', a: 'Put the reference in one board everyone can open and edit at once, instead of passing files around. Clusters does this in the browser: artists add reference live, comments pin to the image they are about, and a view-only link shows the board to anyone without an account.' },
      { q: 'Do the artists I invite need to pay?', a: 'No. Editors are free on every plan. Limits are charged to the workspace owner, so one Creator plan lifts the ceiling for everyone working in that workspace — there are no per-seat charges.' },
      { q: 'Can a client or supervisor see the board without an account?', a: 'Yes. A view-only link opens the board in any browser with no account, can include its nested clusters, and can expire after 7 or 30 days. To comment or vote, invite them instead — that is free too.' },
      { q: 'Can we bring our PureRef boards over?', a: 'Not as .pur files — that is PureRef’s own local format. Export the images, or gather the originals, select them all and drag them onto a board in one go, then rebuild the layout. On Creator you can also attach the .pur file itself to the board.' },
      { q: 'Does it work offline?', a: 'No. Clusters is a browser workspace and needs a connection. In exchange the board is backed up and identical on every machine and for every artist.' },
      { q: 'Is it free?', a: `Free for ${DEMO_CARD_LIMIT} cards across the workspace — each cluster counts as one — with free editors. Creator removes the card cap and the file size limits; see “What it costs” on this page.` },
    ],
    related: ['/tools/reference-board-maker', '/vs/pureref', '/best/pureref-alternatives', '/tools/production-design-mood-board', '/tools/cinematography-lookbook'],
  },
  {
    path: '/tools/directors-treatment',
    kind: 'tool',
    planBlock: true,
    title: 'Director’s Treatment Template — Build It Live, Export a PDF',
    metaDescription:
      'A director’s treatment structure you can use today: develop the look with your team on a live board, write it as a document with images, export a PDF.',
    h1: 'Director’s Treatment Template',
    subhead:
      'Develop the look with your team on a live board, write the treatment as a document with the images inline, and send it as a PDF.',
    answer:
      'A director’s treatment is the visual pitch for a commercial, music video or film: concept, tone, look, casting, wardrobe and locations. In Soleil Clusters you develop it on a live board with your team, write it as a document with images inline, and export a PDF to send. It is a document, not a designed slide deck.',
    updated: '2026-10-02',
    cta: { label: 'Start a treatment — free', sub: 'Free to start. Nothing to install.' },
    stepsHeading: 'The treatment template, section by section',
    // The same sections the starter document is written from (starterDocs.js),
    // so the page and the document it hands over cannot disagree.
    steps: treatmentPageSteps(),
    // Its buttons ask for that document (starterIntent.js).
    starter: 'treatment',
    sections: [
      {
        heading: 'What a treatment has to do',
        body: 'A treatment wins or loses the job before anything is shot. For a commercial it answers a brief the agency already holds; for a music video it sells a world to an artist; for a short or a feature it shows financiers and heads of department the film you can see. Whatever the format, the reader should finish knowing what it will look and feel like — which is why the strongest treatments are mostly images, held together by a few confident paragraphs.',
      },
      {
        heading: 'Build it on a board, with the people who will make it',
        body: 'The slow part of a treatment is not the layout; it is agreeing the look. Clusters is an infinite canvas your producer, DP and designer can work in at the same time: select a folder’s references and drag them in together, sort them into clusters for tone, casting, wardrobe and locations, comment on the exact frame, and put a vote card on each option when it comes down to two. Nobody waits for a version to be emailed round.',
        bullets: [
          'Live co-editing with cursors and presence',
          'Comments pinned to the frame they are about',
          'Vote cards for when it comes down to two',
        ],
      },
      {
        heading: 'Write it as a document, images inline',
        body: 'When the look is settled, write the treatment as a Clusters document beside the board. Documents take headings, tables and images inline, and run to as many pages as you need; give each section its own page and the export breaks the PDF there. Export to PDF from the browser’s print dialog, or to HTML or Markdown. The images are embedded in the export, so the file stands on its own.',
        bullets: [
          'Headings, tables and inline images',
          'Multi-page documents, a page per section',
          'PDF, HTML and Markdown export',
        ],
      },
      {
        heading: 'Share it before it is a PDF',
        body: 'Most treatments go through rounds. Send the board itself as a view-only link — no account needed, set to expire after 7 or 30 days — so a producer or an agency can see where it is heading before the document is final. Invite them instead and they can comment on the frames, free.',
      },
      {
        heading: 'What Clusters is not',
        body: 'It is not a deck designer. There are no slide templates, no presentation mode, and no branded or password-protected links, and the PDF is a well-set document rather than a magazine spread. If the treatment has to be art-directed page by page, finish the layout in InDesign or Keynote — plenty of directors do the thinking in Clusters and the final pass there.',
      },
    ],
    faq: [
      { q: 'What should a director’s treatment include?', a: 'Concept; tone and references; look and lighting; casting; wardrobe and art direction; locations; and edit, music and pace — usually in that order, mostly images, with a short paragraph per section. The outline above works as a template.' },
      { q: 'How long should a treatment be?', a: 'As long as it takes to make the look unmistakable, and no longer — the reader is deciding quickly. Most of the length should be images, with the writing kept to what the pictures cannot say.' },
      { q: 'Can I export a treatment as a PDF?', a: 'Yes. Write it as a Clusters document with the images inline and export to PDF from the browser’s print dialog; the images are embedded, so the file stands alone. HTML and Markdown exports are there too.' },
      { q: 'Can my producer and DP work on it with me?', a: 'Yes. Invite them as editors — free on every plan — and you work in the same board at once. A view-only link shows it to anyone else without an account.' },
      { q: 'Is there a music video treatment template?', a: 'The same structure works: concept, world and look, performance and casting, wardrobe, locations, and edit and music. Music video treatments lean harder on reference clips, and Clusters boards hold video and audio cards beside the stills.' },
      { q: 'Is it free?', a: `Free for ${DEMO_CARD_LIMIT} cards — each cluster counts as one — with free editors. Image-heavy treatments can outgrow that; Creator removes the cap for the whole workspace. See “What it costs” on this page.` },
    ],
    related: ['/tools/look-book-maker', '/tools/cinematography-lookbook', '/tools/production-design-mood-board', '/tools/costume-design-mood-board', '/tools/mood-board-maker'],
  },
  {
    path: '/tools/production-design-mood-board',
    kind: 'tool',
    planBlock: true,
    title: 'Production Design Mood Boards — For the Art Department',
    metaDescription:
      'Mood boards for production designers: a cluster per set, with references, palettes and plans together, built live by set dec, props and the director.',
    h1: 'Production Design Mood Boards',
    subhead:
      'A cluster per set, with references, palettes, plans and notes in one place — built by the whole art department, live.',
    answer:
      'Soleil Clusters gives production designers a mood board per set: references, palettes, PDFs of plans and notes in one cluster, nested inside the project. Set decorators, props and the art director build it live, the director comments on the image itself, and one link shows it to anyone. Editors are free, so the department is not billed per seat.',
    updated: '2026-10-02',
    cta: { label: 'Start a set board — free', sub: 'Free to start. The department joins free.' },
    stepsHeading: 'How an art department uses it',
    steps: [
      { t: 'A cluster per set', d: 'Nest one cluster per set or location inside the project — the diner, the motel room, the night exterior.' },
      { t: 'Pull the references', d: 'Select everything in your folders of period photography, film frames and scout photos and drag it in; attach plans and drawings as PDFs.' },
      { t: 'Set the palette', d: 'Sample swatches off any reference with the eyedropper and keep the hex values beside the set they belong to.' },
      { t: 'Split the work', d: 'Set decoration, props and graphics each work in their own nested clusters, inside the set.' },
      { t: 'Get the director’s notes', d: 'The director comments on the exact image; when it comes down to two options, a vote card on each shows where the room leans.' },
    ],
    sections: [
      {
        heading: 'A board per set, not one wall for the whole film',
        body: 'Production design is many decisions per set, made by several people at once. One giant wall turns into a scroll, and a deck is out of date by Thursday. In Clusters the project is a cluster and each set is a cluster inside it, so the diner’s references, palette and notes live together and the motel room’s never get in the way. Live thumbnails show what is inside each one at a glance.',
        bullets: [
          'Nested clusters per set, location or department',
          'Live thumbnails of every nested board',
          'A relationship graph connects the project',
        ],
      },
      {
        heading: 'References, palettes and plans together',
        body: 'A set board is not only pictures. Drop period photography and film frames beside the floor plan as a PDF, a fabric photo beside the paint chip, and a note on what the set has to do for the scene. Sample a palette off any reference with the eyedropper, a swatch at a time. A .psd, a .zip of drawings, a model file ride along as attachments — at any size on Creator.',
        bullets: [
          'PDF plans and drawings beside the references',
          'Palettes sampled off any image, with hex values',
          'Any file as an attachment — any size on Creator',
        ],
      },
      {
        heading: 'The whole department, live',
        body: 'Set decoration, props and graphics can work in the same project at once, each in their own nested cluster, with live cursors showing who is where. The director and producer comment on the exact image — pinned to the reference, not a paragraph in an email — and a vote card beside each chair settles “which of these three” without a meeting.',
      },
      {
        heading: 'Tag by setting and character',
        body: 'Tags cut across the nesting. Type a tag as a setting — the diner — and its view gathers every reference for that place from anywhere in the workspace, including the costume and camera boards. Tag a character, and their room, their props and their wardrobe come back in one view.',
      },
      {
        heading: 'What it does not do',
        body: 'Clusters is a reference and decision tool, not a drafting or budgeting one. Draw the plans in Vectorworks or SketchUp and attach them; keep the budget and the breakdown where they already live. What Clusters holds is the look of each set and the record of how it was agreed.',
      },
    ],
    faq: [
      { q: 'What should a production design mood board include?', a: 'For each set: period and genre references, film frames with the feel you want, a palette, textures and materials, key props, and any plans or drawings — plus a note on what the set has to do for the story. One board per set keeps each one readable.' },
      { q: 'Can the whole art department work on the same boards?', a: 'Yes. Invite set decorators, prop masters and graphics as editors — free on every plan — and everyone works in the same project live, each in their own nested cluster.' },
      { q: 'Can I attach floor plans and drawings?', a: 'Yes. PDFs of plans and drawings sit on the board as cards beside the references. Other formats — a .psd, a .zip, a model file — attach on any plan; Creator lifts the size caps.' },
      { q: 'How do I share the boards with the director and producer?', a: 'Invite them to comment and vote, free — or send a view-only link that opens without an account, includes the nested sets, and can expire after 7 or 30 days.' },
      { q: 'Is it free?', a: `Free for ${DEMO_CARD_LIMIT} cards across the workspace — each cluster counts as one — with free editors. A full art department will outgrow that; Creator removes the cap for the whole workspace at once. See “What it costs” on this page.` },
    ],
    related: ['/tools/costume-design-mood-board', '/tools/cinematography-lookbook', '/tools/directors-treatment', '/tools/shared-reference-board', '/vs/milanote'],
  },
  {
    path: '/tools/costume-design-mood-board',
    kind: 'tool',
    planBlock: true,
    title: 'Costume Design Mood Boards — A Board per Character',
    metaDescription:
      'Mood boards for costume designers: a board per character, looks laid out scene by scene, swatches and fittings together, shared live with the director.',
    h1: 'Costume Design Mood Boards',
    subhead:
      'A board per character, the looks laid out scene by scene, and the fabric, colour and fitting photos beside them — shared live with the director.',
    answer:
      'Soleil Clusters gives costume designers a mood board per character: research and inspiration, a grid of looks scene by scene, fabric and colour swatches, and fitting photos together. Assistants and buyers add to it live, the director comments on the image itself, and a typed character tag gathers every reference for that character across the project.',
    updated: '2026-10-02',
    cta: { label: 'Start a costume board — free', sub: 'Free to start. Your team joins free.' },
    stepsHeading: 'How a costume department uses it',
    steps: [
      { t: 'A cluster per character', d: 'Nest one cluster per principal inside the project, and one for background.' },
      { t: 'Research and inspiration', d: 'Period photography, paintings, runway and street references — select a folder’s worth and drag them in together.' },
      { t: 'Lay out the looks', d: 'A grid per character, a frame per scene or change, with the scene and what changes written in the box beneath each look.' },
      { t: 'Swatches and colour', d: 'Photograph fabrics and trims, sample their colours with the eyedropper, and keep the hex values beside the look.' },
      { t: 'Fittings and sign-off', d: 'Drop fitting photos into the character’s board; the director comments on the exact image, and a vote card beside each option shows where the room leans.' },
    ],
    sections: [
      {
        heading: 'A board per character, a look per scene',
        body: 'Costume is a story told across scenes, so one mood board for the whole film flattens it. In Clusters each character gets a cluster, and inside it a grid lays the changes out in order — a frame per scene or change for the look, with the scene and what changes in the box beneath it, and the fabric swatches beside the grid. When scenes move, the grid is still the order of the story, and everyone is looking at the same one.',
        bullets: [
          'A cluster per character',
          'A grid of looks, a cell per scene or change',
          'Scene notes under each look, swatches beside it',
        ],
      },
      {
        heading: 'Swatches, colour and fittings together',
        body: 'Photograph fabrics and trims as you buy them and drop them beside the look they belong to. Sample colours off a swatch photo or a reference with the eyedropper and keep the hex values on the board. After a fitting, the photos go straight into the character’s cluster, so the next decision is made looking at the real garment rather than a description of it.',
      },
      {
        heading: 'One character tag, every reference',
        body: 'Tags in Clusters can be typed as characters. Tag a reference with the character once, and the tag’s view gathers every image of them from wherever it lives in the workspace — your boards, the production designer’s, the camera team’s. Nothing moves; the tag just finds it.',
      },
      {
        heading: 'Assistants, buyers and the director, live',
        body: 'Invite assistant designers, buyers and the supervisor as editors — free on every plan — and the department works in the same boards at once. The director comments on the exact image and votes on each option, so sign-off is a thread on the look rather than an email chain.',
      },
      {
        heading: 'What it does not do',
        body: 'Clusters holds the look and the decision, not the paperwork. It does not track a costume budget, measurements or a rental inventory, and it is not a sketching or pattern tool — draw in Procreate or on paper and drop the sketch on the board.',
      },
    ],
    faq: [
      { q: 'What should a costume mood board include?', a: 'Per character: research and inspiration, the silhouette and colour story, a look for each scene or change, fabric and trim swatches, and fitting photos as they happen. A board per character keeps the arc readable.' },
      { q: 'How do I lay out costume changes by scene?', a: 'Put a grid inside the character’s board with a frame per scene or change and a box beneath each for the scene and what changes. The grid reads in story order, and everyone with access sees the same one.' },
      { q: 'Can I share it with the director without an account?', a: 'Yes. A view-only link opens in any browser with no account and can expire after 7 or 30 days. To comment or vote, invite them — free on every plan.' },
      { q: 'Does it handle continuity?', a: 'For the looks, yes: fitting and continuity photos live in the character’s grid beside the intended look. It is not a dedicated continuity database — there is no per-take logging.' },
      { q: 'Is it free?', a: `Free for ${DEMO_CARD_LIMIT} cards across the workspace — each cluster counts as one — with free editors. A full principal cast will outgrow that; Creator removes the cap for the whole workspace. See “What it costs” on this page.` },
    ],
    related: ['/tools/production-design-mood-board', '/tools/look-book-maker', '/tools/cinematography-lookbook', '/tools/directors-treatment', '/tools/shared-reference-board'],
  },
  {
    path: '/tools/cinematography-lookbook',
    kind: 'tool',
    planBlock: true,
    title: 'Cinematography Lookbook — Light, Lens and Frame References',
    metaDescription:
      'A lookbook for cinematographers: frames, lighting references and lens notes on a shared board, B&W value checks, and one link for the whole camera team.',
    h1: 'Cinematography Lookbook',
    subhead:
      'Collect the frames, light and lensing you are after, check them in black and white, and keep the director, gaffer and colourist on the same board.',
    answer:
      'Soleil Clusters is a cinematography lookbook on a shared canvas: collect film frames and lighting references by scene, note lens and light beside each, check values in black and white, and sample palettes. The director, gaffer and colourist work in the same board live, and a view-only link shows it to anyone without an account.',
    updated: '2026-10-02',
    cta: { label: 'Start a lookbook — free', sub: 'Free to start. Nothing to install.' },
    stepsHeading: 'How a DP builds one',
    steps: [
      { t: 'A cluster per scene or look', d: 'Night exteriors, the apartment, the flashback — each look gets its own cluster.' },
      { t: 'Collect the frames', d: 'Film stills, photographs and your own tests — select them all in the folder and drag them in together; reference clips as video cards.' },
      { t: 'Read the light', d: 'Flip any frame to black and white to read its values; nudge warmth and contrast to compare against your tests.' },
      { t: 'Note lens and setup', d: 'A note or caption beside each frame: focal length, stop, height, source, diffusion.' },
      { t: 'Bring in the team', d: 'The gaffer and the colourist edit free; the director comments on the exact frame.' },
    ],
    sections: [
      {
        heading: 'Frames, light and lens on one board',
        body: 'A lookbook is an argument about how the film will look, made with other people’s pictures. In Clusters each look gets a cluster, and inside it the frames that define it sit beside the notes that make it repeatable — lens, height, source, diffusion. Reference clips play on the board as video cards, so movement and camera behaviour live in the same place as the stills.',
        bullets: [
          'A cluster per scene or look',
          'Lens and lighting notes beside each frame',
          'Reference clips as playable video cards',
        ],
      },
      {
        heading: 'Check values, not just vibes',
        body: 'Flip any reference to black and white to read where its values actually sit, and nudge warmth, contrast and saturation to compare it with your tests. The adjustments are non-destructive, so the original frame is always one click away. Sample swatches off any frame with the eyedropper to hand the colourist a concrete starting point.',
        bullets: [
          'Black and white for reading values',
          'Warmth, contrast and saturation, non-destructively',
          'Swatches sampled off any frame',
        ],
      },
      {
        heading: 'Director, gaffer and colourist on the same page',
        body: 'A lookbook only helps if the people executing it see the same thing. Invite the gaffer, the key grip and the colourist as editors — free on every plan — and they work in the board live. The director comments on the exact frame, and a vote card beside each settles “this one or that one” before the tech scout instead of during it.',
      },
      {
        heading: 'From lookbook to shot list',
        body: 'Keep the shot list in a document beside the frames — a table of shot, lens and movement — and the storyboard sequences in a grid in the same project. The look, the frames and the plan stay linked instead of living in three apps.',
      },
      {
        heading: 'What it does not do',
        body: 'Clusters is not a shot-design or previs tool — there is no 3D camera simulation or lens calculator — and it does not manage camera reports. Use it for the look and the agreement on it; use your previs and reporting tools for the rest.',
      },
    ],
    faq: [
      { q: 'What is a cinematography lookbook?', a: 'A collection of reference images — film frames, photographs, tests — that defines how a film will look: light, contrast, colour, lensing and movement, organised by scene or look, with notes on how to achieve each.' },
      { q: 'How do I make a DP lookbook?', a: 'Make a cluster per scene or look, drop in the defining frames, note lens and lighting beside each, check values in black and white, and share it with the director and the team. The steps above walk through it.' },
      { q: 'Can I put reference clips in it?', a: 'Yes. Video cards play on the board beside the stills. The free plan caps each clip’s size and length; Creator lifts that.' },
      { q: 'Can the colourist see it without an account?', a: 'Yes, through a view-only link that opens in any browser and can expire after 7 or 30 days. To comment, invite them — free on every plan.' },
      { q: 'Is it free?', a: `Free for ${DEMO_CARD_LIMIT} cards — each cluster counts as one — with free editors. A full lookbook can outgrow that; Creator removes the cap for the whole workspace. See “What it costs” on this page.` },
    ],
    related: ['/tools/storyboard-maker', '/tools/shot-list-maker', '/tools/directors-treatment', '/tools/production-design-mood-board', '/tools/look-book-maker'],
  },

  // ────────────────────────────────────────────────────────────────────────
  // ALTERNATIVE-TO PAGES — capture people already shopping for a tool
  // Positioning is honest: competitors' genuine strengths are acknowledged.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/vs/milanote',
    kind: 'compare',
    title: 'Free Milanote Alternative — Flat Price, Real-Time Teams',
    // META PRE-REGISTERED 2026-10-01 (CLAUDE.md ritual). The description sold
    // "auto-tagging" that files dropped work, and tagging moves nothing (and
    // reads text, never pictures). Swapped for screenplay mode, a live and
    // differentiating feature. One surface, that commit only.
    //   Predicate: path = '/vs/milanote', query = '' (page level),
    //     search_type = 'web'; CTR and impression-weighted position.
    //   Window: ±7 and ±14 days around the PRODUCTION deploy, never inside 3
    //     days of it. Floor: 200 post-change web impressions before reading.
    //   Expectation: no material change — no query on this page has carried
    //     "tag", "auto" or "organize".
    //   READ IS CONFOUNDED (2026-10-02). The same release rewrites this page's
    //     pricing body (Milanote's team plan is flat, not per person) and adds
    //     the "What it costs" block, so a before/after cannot be pinned on the
    //     description. It shipped for truth; read any movement as the release.
    //     The baseline lives in the project notes, not in this public file.
    metaDescription:
      'The free Milanote alternative without per-person pricing — a real-time multiplayer canvas with screenplay mode, 100GB storage and link sharing.',
    h1: 'A Milanote Alternative Built for Production Teams',
    subhead:
      'Milanote is a lovely place to think. Clusters is where a team pulls a whole production together — live, on one canvas.',
    answer:
      'Soleil Clusters is a free Milanote alternative built for team production work: a real-time multiplayer canvas with live cursors, pinned comments, a relationship graph across projects, and a free tier that never meters uploads — Creator is a flat $25/mo with 100GB storage. Milanote is strong for solo planning; Clusters is for visual, media-heavy, collaborative work.',
    updated: '2026-10-02',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    sections: [
      {
        heading: 'Where Clusters is different',
        body: 'Both tools are beautiful, board-based, and made for creative work. Clusters leans harder into real-time team production: a live multiplayer canvas with cursors and presence, comments pinned to the exact card they are about, a relationship graph that connects a whole project, and 100GB of storage with no size limits on Creator. If you are organizing a shoot or a campaign with a team, that is the difference.',
        bullets: [
          'Live multiplayer canvas with cursors and presence',
          'Comments pinned to the exact card they are about',
          'A relationship graph connects the whole project',
        ],
      },
      {
        heading: 'A free Milanote alternative without the per-person bill',
        body: 'Milanote’s free plan caps the total number of items you can add — around a hundred notes, images, and links across everything — which tends to run out right in the middle of a real project. Its individual plans are priced per person, and its team plan is a flat $49/mo, billed annually, for up to ten people. Clusters’ free Demo tier is a generous sandbox with no time limit, and Creator is a flat $25/mo for unlimited cards, 100GB of storage, and no size limits — not a price that multiplies with every teammate you bring in.',
        bullets: [
          'No trial clock on the free Demo tier',
          'Flat $25/mo Creator — not per-person pricing',
          'Unlimited cards and 100GB on Creator',
        ],
      },
      {
        heading: 'For filmmakers: from mood board to shot list',
        body: 'Milanote markets itself to filmmakers, and its planning templates are genuinely pleasant. Where Clusters pulls ahead is when pre-production gets real: the mood board, the storyboard grid, and the visual shot list are linked boards in one project, with screenplay mode built in for writing beside the imagery. Your DP and AD edit the same boards live, and the whole pre-pro package shares with one link the producer can open without an account.',
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
        { feature: 'Relationship graph across boards', us: 'Yes', them: 'No' },
        { feature: 'Files of any type, up to 100GB', us: 'Yes — any size on Creator', them: 'Limited' },
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
      { q: 'Is Soleil Clusters a good Milanote alternative?', a: 'Yes, especially for teams doing visual, media-heavy, collaborative work. Clusters adds a real-time multiplayer canvas, screenplay mode, a relationship graph, and 100GB storage with no size limits on Creator.' },
      { q: 'How is Clusters different from Milanote?', a: 'Clusters focuses on live team production — multiplayer editing with cursors and presence, screenplay mode and docs beside the imagery, and connecting a whole project through a relationship graph — rather than solo planning boards.' },
      { q: 'Does Clusters have a free tier like Milanote?', a: `Yes. The Demo tier is free with no credit card and covers ${DEMO_CARD_LIMIT} cards — every cluster you make is one of them — with uploads never metered. Creator is $25/mo for unlimited cards, 100GB storage, and no size limits.` },
      { q: 'Can I move my Milanote boards over?', a: 'You can drag your images, links, and files straight into a new Clusters board and share it — there is no complex migration to do first.' },
      { q: 'Does Milanote limit how many items I can add?', a: 'Yes — Milanote’s free plan caps the total number of items across your boards, and separately allows 10 file uploads, ever. Clusters’ free Demo tier also caps cards, but never meters uploads and has no time limit; Creator ($25/mo) removes the card cap and adds 100GB of storage.' },
      { q: 'Is Clusters cheaper than Milanote for a team?', a: 'Usually. Milanote’s individual plans are priced per person and its team plan is $49/mo, billed annually, for up to ten people; Clusters Creator is a flat $25/mo for the whole workspace, editors are free, and anyone you share a board with can view it free with one link.' },
      { q: 'Is there a free Milanote alternative without item caps?', a: 'Both free tiers cap items, so the honest answer is what the cap is made of. Milanote’s free plan also spends a budget of 10 file uploads that never resets; Soleil Clusters has no separate upload budget, has no trial clock, and Creator ($25/mo, flat) removes the card cap entirely. If you need genuinely uncapped, Obsidian Canvas keeps boards as local files.' },
      { q: 'What do filmmakers use instead of Milanote?', a: 'Many use Clusters, because pre-production is connected there: the mood board links to the storyboard and the shot list as one project, with screenplay mode built in — and the whole crew edits the same boards in real time.' },
      { q: 'Milanote vs Canva — and where does Clusters fit?', a: 'Canva is a template-driven graphics editor, strongest when the goal is a finished design. Milanote is a board app for planning and collecting ideas. Clusters covers that planning ground for production teams — a real-time multiplayer canvas that never meters uploads, where the finished board shares with one link a client can open without an account.' },
          { q: 'Can I drive it from an AI assistant?', a: 'Clusters connects to Claude and any other MCP client with a single URL, so you can ask an assistant to build a board, import references and arrange them. No Milanote server is listed in the official Model Context Protocol registry at the time of writing. Clusters works with the images you already have — it does not generate them.' },
],
    siblingListicle: { path: '/best/milanote-alternatives', label: 'See all 12 Milanote alternatives, ranked by a film studio.' },
    related: ['/best/milanote-alternatives', '/tools/mood-board-maker', '/tools/storyboard-maker', '/tools/shot-list-maker', '/tools/production-design-mood-board', '/vs/pureref', '/vs/miro', '/use-cases', '/tools/ai-mood-board-maker', '/vs/storyflow'],
  },

  // ────────────────────────────────────────────────────────────────────────
  // /vs/storyflow — PRE-REGISTERED 2026-09-19 (the CLAUDE.md ritual).
  //
  // Storyflow (storyflow.so) is the competitor whose roundups assistants READ
  // — a twelve-tool listicle for every query we care about, none of which name
  // us — not a brand people search alternatives for: Search Console shows one
  // query on this whole site that mentions it. This page is an AEO flank on an
  // uncontested SERP. Do not grade it as a Google failure.
  //   Google predicate: query ~* 'storyflow', search_type = 'web', 60 days
  //     from promotion, floor 200 impressions before any title/meta edit.
  //   AEO predicate: the probe questions "best Storyflow alternative for
  //     filmmakers" and "Storyflow vs Soleil Clusters" (aeo_probe_questions)
  //     cite this domain within 8 weekly runs of promotion.
  //   Fold rule: under 50 impressions at day 60 → 301 into /best/mood-board-apps
  //     via RETIRED_PAGES (worker.js), retiring the health expectations by url
  //     AND by expected (0262 / 0263).
  // Facts re-verified on storyflow.so/pricing, 2026-09-19, verbatim: "Not yet.
  // Storyflow is currently in paid early access, and the Free plan launches
  // before the end of 2026." Invitees of a paid member can join free today.
  // Plus $9.99/mo ($7.99 annual) · Pro $19 ($14) · Max $49 ($39); AI usage is
  // metered per tier; the coming free plan caps uploads at 20 and AI at a
  // one-time allowance. Live cursors shipped 2026-07-27, so real-time is NOT a
  // wedge here and this page never claims it. The MCP registry was queried the
  // same day (registry.modelcontextprotocol.io) and lists no Storyflow server;
  // the claim below is scoped to that, never a world-wide negative. The two
  // compare rows on nesting/graph and screenplay mode are scoped the same way, to
  // the pricing page's feature list, which mentions neither. (2026-10-01: the
  // auto-tagging row is gone — our tagger only suggests and files nothing — and
  // the schedule half of the screenplay row went with the schedule hold.)
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/vs/storyflow',
    kind: 'compare',
    title: 'Storyflow Alternative — Free Today, Flat Price, No AI Meter',
    metaDescription:
      'A Storyflow alternative you can use free today: a live production canvas at a flat price, with no AI meter. Honest about where Storyflow still wins.',
    h1: 'A Storyflow Alternative for Crews That Work Live',
    subhead:
      'Storyflow drafts the board for you. Clusters is where a crew builds the real one together — free to start, flat-priced, on one canvas.',
    answer:
      'Soleil Clusters is a Storyflow alternative for production teams: a free real-time canvas where mood boards, storyboards, shot lists and the screenplay live in one nested project, at a flat $25/mo with no AI allowance to run out. Storyflow is in paid early access and drafts boards from a prompt; Clusters is for building them with your crew.',
    updated: '2026-10-01',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    stepsHeading: 'How to move a Storyflow project to Clusters',
    steps: [
      { t: 'Export what you made', d: 'Storyflow exports boards as PNG, SVG or PDF and documents as files. Keep the original images you gathered as well — those are the references, and they are yours.' },
      { t: 'Drop them on a new board', d: 'Drag the whole set onto a fresh cluster in one drop, then group and tag the references as you rebuild.' },
      { t: 'Rebuild the structure as nested boards', d: 'A mood board, a storyboard grid and a shot list become linked boards in one project rather than one long canvas.' },
      { t: 'Share one link', d: 'Send it to the crew or the client. It opens in the browser, no account is needed to view, and everyone you invite edits free.' },
    ],
    sections: [
      {
        heading: 'What Storyflow is, and what it is not',
        body: 'Storyflow is an AI visual workspace. You describe a board and its assistant drafts it — a storyboard laid out frame by frame, a shot list, a mood board of collected references — staged as a proposal you accept or discard, with two hundred-odd “Tactics” frameworks to drop in half-built. That is a real idea, done well. It is also the whole product: the AI is what you pay for, metered per plan, and during early access every plan is paid. Clusters starts from the other end. The board is something a crew builds and argues over, live. Nothing is generated for you, and nothing on the canvas sits behind an allowance.',
        bullets: [
          'Storyflow: an assistant drafts the board; AI usage is metered per plan',
          'Clusters: the crew builds the board live; no in-app AI allowance',
          'Both run in the browser and both are small vendors — weigh that either way',
        ],
      },
      {
        heading: 'Where Clusters is different',
        body: 'A production is not one board. In Clusters the mood board, the storyboard grid, the visual shot list and the screenplay are nested boards in one project, connected by a relationship graph, with docs beside the imagery. Any file, at any size up to 100GB, rides on Creator. And the assistant question is answered the open way: connect Claude or any MCP client with one URL and ask it to build or tidy a board — your assistant and your plan, not a meter inside ours.',
        bullets: [
          'Mood board, storyboard, shot list and screenplay as nested boards',
          'Tags and a relationship graph across the whole project',
          'Connect Claude or any MCP client with one URL — no in-app allowance',
        ],
      },
      {
        heading: 'A free plan you can use today, and a flat price after it',
        body: `Storyflow’s pricing page says it plainly: it is paid-only during early access, and its Free plan launches before the end of 2026 — unless a paid member invites you, in which case you can join their boards free now. Its paid tiers run from $7.99 to $39 a month billed annually, each with its own AI allowance, and the coming free plan will cap file uploads at 20. Clusters’ Demo tier is free today with no credit card, covers ${DEMO_CARD_LIMIT} cards — each cluster you make is one of them — and never meters uploads. Creator is a flat $25 a month for unlimited cards, 100GB with no size limits, and everyone you invite edits free.`,
        bullets: [
          `Free today: ${DEMO_CARD_LIMIT} cards (each cluster is one), uploads never metered`,
          'Creator is $25/mo flat — not per seat, not per AI call',
          'Storyflow: paid early access; its Free plan is due before the end of 2026',
        ],
      },
      {
        heading: 'Where Storyflow is still the right call',
        body: 'If what you want is a first pass you did not have to make — type the premise, get a storyboard, a shot list and a board of references staged for you — Storyflow does that and Clusters does not. Its frameworks are a genuine head start on a pitch, and an assistant that reads the whole canvas is the most interesting idea in this category. A solo writer or director sketching a pitch, happy to pay for the drafting, should look at it seriously. Clusters earns its place once the board has to be built by a crew, shared with a client, and carried into the shoot.',
      },
      {
        heading: 'Two small vendors, one honest comparison',
        body: 'Both of these tools come from small teams, and you should weigh that either way. What stands behind Clusters is a working film studio: it is built by Soleil Pictures and used on our own productions, which is why the screenplay mode and the shot list exist at all. It runs in the browser on any machine; on a phone or tablet it can be added to the home screen as a web app. There is no store app yet, and we say so.',
      },
    ],
    compare: {
      competitor: 'Storyflow',
      intro: 'How the two compare on the things production teams care about. Storyflow figures are from its own pricing page, September 2026:',
      rows: [
        { feature: 'Free plan available today', us: 'Yes — no credit card', them: 'Not yet; announced for before the end of 2026' },
        { feature: 'Pricing model', us: 'Flat $25/mo Creator', them: '$7.99–$39/mo billed annually, AI metered per tier' },
        { feature: 'AI usage allowance', us: 'None — connect your own assistant', them: 'Per plan; a one-time allowance on the coming free plan' },
        { feature: 'Drafts a board from a prompt', us: 'No', them: 'Yes' },
        { feature: 'Real-time multiplayer canvas', us: 'Yes', them: 'Yes' },
        { feature: 'Nested boards with a relationship graph', us: 'Yes', them: 'Not on its pricing page (September 2026)' },
        { feature: 'Screenplay mode (Final Draft and Fountain)', us: 'Yes', them: 'Not on its pricing page (September 2026)' },
        { feature: 'Files of any type, up to 100GB', us: 'Yes — any size on Creator', them: 'Unlimited uploads on paid plans; 20 on the coming free plan' },
        // Our own number, stated plainly, the same way /vs/milanote states it.
        { feature: 'Free-plan card cap', us: `${DEMO_CARD_LIMIT} cards, uploads never metered`, them: 'No object or board limit on any plan; uploads and AI are capped' },
        { feature: 'Template library', us: 'Growing (grid templates)', them: '200+ frameworks on paid plans' },
        { feature: 'Works with Claude and other MCP clients', us: 'Yes, one URL', them: 'No server listed in the MCP registry' },
      ],
    },
    faq: [
      { q: 'Is Storyflow free?', a: 'Not yet. Storyflow’s own pricing page says it is paid-only during early access and that its Free plan launches before the end of 2026; collaborators invited by a paid member can join free in the meantime. Soleil Clusters is free to start today, with no credit card.' },
      { q: 'Is Soleil Clusters a good Storyflow alternative?', a: 'For a crew, yes: a free real-time canvas where mood boards, storyboards, shot lists and the screenplay are nested boards in one project, at a flat price with no AI allowance. If you want boards drafted from a prompt, Storyflow is the tool that does that.' },
      { q: 'Storyflow vs Soleil Clusters — which is better for a film crew?', a: 'Storyflow drafts a first pass for one person; Clusters is where the crew builds the real one. Choose Storyflow for a solo pitch you want generated. Choose Clusters when the DP, the AD and the producer need to edit the same boards live and carry them into the shoot.' },
      { q: 'Does Clusters generate boards with AI like Storyflow does?', a: 'No. Clusters does not generate boards or images. It connects to Claude and any other MCP client with one URL, so your own assistant can create a board, bring in references from links and arrange them — working with images you already have. No Storyflow server is listed in the official Model Context Protocol registry at the time of writing.' },
      { q: 'How much does Storyflow cost?', a: 'As of September 2026: Plus is $9.99/mo, or $7.99/mo billed annually ($95.88 once a year); Pro $19/mo, or $14/mo annually ($168); Max $49/mo, or $39/mo annually ($468). Each tier carries a different AI usage allowance. Clusters’ Creator plan is a flat $25 a month.' },
      { q: 'Can I move my Storyflow boards to Clusters?', a: 'Storyflow exports boards as PNG, SVG or PDF. Bring the original images and files you gathered, drop them onto a new cluster, and rebuild the structure as nested boards. There is no importer and no migration to run first.' },
      { q: 'Does Clusters have a limit like Storyflow’s upload cap?', a: `Clusters’ free Demo tier caps cards at ${DEMO_CARD_LIMIT} — each cluster you make is one — and never meters uploads; Creator ($25/mo) removes the cap. Storyflow’s coming free plan caps file uploads at 20 and AI at a one-time allowance, with no object limit.` },
      { q: 'Can I use Clusters on an iPad or a phone?', a: 'Yes. Clusters runs in the mobile browser and can be added to the home screen as a web app, where it opens without browser chrome. There is no App Store or Play Store listing yet.' },
    ],
    siblingListicle: { path: '/best/mood-board-apps', label: 'See all 12 mood board apps, ranked by a film studio.' },
    related: ['/vs/milanote', '/best/mood-board-apps', '/best/milanote-alternatives', '/tools/ai-mood-board-maker', '/tools/storyboard-maker', '/tools/shot-list-maker', '/use-cases'],
  },
  // /vs/eagle — PRE-REGISTERED 2026-10-02 (the CLAUDE.md ritual).
  //
  // Eagle (eagle.cool) is the artist's asset LIBRARY, and the category the owner
  // wants Clusters seen in ("the artist's Google Drive"). The honest frame is a
  // division of labour, not a replacement: Eagle is one person's private library,
  // Clusters is the room a team builds in. "pureref vs eagle" already reaches
  // this site, and /best/pureref-alternatives ranks Eagle third.
  //   Google predicate: query ~* 'eagle' on this path, search_type = 'web',
  //     query = '' rows for the page total; 60 days from the production
  //     promotion, never inside 3 days of it; floor 200 impressions before any
  //     title or meta edit.
  //   AEO predicate: the probe questions "best Eagle app alternative for a team"
  //     and "Eagle vs Soleil Clusters" (aeo_probe_questions) cite this domain
  //     within 8 weekly runs of promotion — readable only once the probe's
  //     OpenAI credits are restored (it has failed every run since 2026-09-06).
  //   Fold rule: under 50 impressions at day 60 → 301 into
  //     /best/pureref-alternatives via RETIRED_PAGES (worker.js), retiring the
  //     health expectations by url AND by expected (0262 / 0263).
  // Facts re-verified 2026-10-02 on Eagle's own pages: the store lists US$34.95
  // as a one-time purchase with free lifetime updates, two devices per licence,
  // macOS and Windows. Its blog: AI Search (find by image or description, fully
  // offline) shipped as an official plugin 2026-03-17 and AI Action (your own
  // organising rules as AI workflows) 2026-03-30; 5.0 is being rebuilt with no
  // date (2026-08-11). Its support: no official iPad or mobile app; teams share
  // a library through a NAS or a synced folder, with a warning about two people
  // writing at once. The extra-device price and the trial length were NOT on
  // the store page that day, so this page states neither.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/vs/eagle',
    kind: 'compare',
    title: 'Eagle Alternative for Teams — A Shared Reference Canvas',
    metaDescription:
      'An Eagle alternative for teams: a shared reference canvas in the browser, built live with your crew. Honest about where Eagle’s private library wins.',
    h1: 'An Eagle Alternative for Teams That Build Boards Together',
    subhead:
      'Eagle is the best private library for one person’s references. Clusters is the shared room a team builds in — live, in the browser, on any machine.',
    answer:
      'Soleil Clusters is an Eagle alternative for teams: a browser canvas where a crew builds reference boards together, live, and shares them with one link. Eagle is a one-time-purchase desktop library built around one person’s collection, strongest offline and at scale. Keep Eagle as the archive; use Clusters when a team needs the same board.',
    updated: '2026-10-02',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    stepsHeading: 'How to bring an Eagle project into Clusters',
    steps: [
      { t: 'Pick the project, not the archive', d: 'Leave the library in Eagle. Gather the references one project needs — a tag or a smart folder in Eagle is a quick way to collect them.' },
      { t: 'Bring the originals over', d: 'Eagle keeps every original as a real file on your disk. Select the ones the project needs and drag them onto a new cluster; they upload in parallel and lay themselves out.' },
      { t: 'Rebuild the structure as nested boards', d: 'A cluster per scene, character or location, nested inside the project, with notes and docs beside the images.' },
      { t: 'Invite the team', d: 'Everyone you invite edits free, and one link shows the board to anyone, with no account needed to view it.' },
    ],
    sections: [
      {
        heading: 'Eagle is a library. Clusters is a room.',
        body: 'Eagle is a digital asset manager: a fast library on your own disk of everything you have ever saved, organised by tags, smart folders and colour, and searchable by an image or a description with its AI Search plugin, offline. For one person’s collection it is excellent, and a one-time price makes it easy to own. Clusters starts where a collection becomes a project other people work on: a canvas in the browser where a team arranges the references for this production, writes beside them and decides — together, at the same time.',
        bullets: [
          'Eagle: a private, local library — organised, searchable, offline',
          'Clusters: a shared canvas — arranged, discussed, decided',
          'They do different jobs, and plenty of artists keep both',
        ],
      },
      {
        heading: 'What a team gets that a library cannot give it',
        body: 'Eagle has no shared, live workspace. Teams share an Eagle library by keeping it on a NAS or in a synced folder, and Eagle’s own support warns about two people writing to it at once. In Clusters the board is the shared thing: live cursors and presence, comments pinned to the card they are about, a vote card beside each option, and a nested cluster per scene or set. A director opens it from a link in any browser, with no install and no account needed to view, and everyone you invite edits free.',
        bullets: [
          'Live cursors, and comments pinned to the card in question',
          'One link opens a read-only view; invited editors are free',
          'Runs in any browser; on a phone it adds to the home screen',
        ],
      },
      {
        heading: 'Where Eagle is still the better choice',
        body: 'If the job is keeping tens of thousands of references findable — offline, on your own disk, with AI search by image or description and AI Action sorting them by rules you write — Eagle does that and Clusters does not. It also costs US$34.95 once for two devices, against $25 a month for Clusters’ Creator plan. A solo artist building a lifetime library should buy Eagle. Clusters earns its place when a team has to work from the same board.',
      },
    ],
    compare: {
      competitor: 'Eagle',
      intro: 'How the two compare. Eagle figures are from its own store, blog and support pages, October 2026:',
      rows: [
        { feature: 'Where it runs', us: 'Any browser; phones via the home-screen web app', them: 'macOS and Windows desktop apps' },
        { feature: 'Real-time collaboration', us: 'Yes — live cursors and presence', them: 'No; teams share a library on a NAS or a synced folder' },
        { feature: 'Works offline, on your own disk', us: 'No — it lives in the cloud', them: 'Yes' },
        { feature: 'AI search by image or description', us: 'No', them: 'Yes — the AI Search plugin, offline' },
        { feature: 'Organising', us: 'Tags and nested clusters', them: 'Tags, smart folders and colour search' },
        { feature: 'Notes, docs and a screenplay beside the images', us: 'Yes', them: 'Notes on each asset' },
        { feature: 'Comments and votes from a team', us: 'Yes', them: 'No' },
        { feature: 'Price', us: `Free to start (${DEMO_CARD_LIMIT} cards); Creator $25/mo`, them: 'US$34.95 once, two devices' },
      ],
    },
    faq: [
      { q: 'Is Soleil Clusters a good Eagle alternative?', a: 'For a team, yes: a shared canvas in the browser where a crew builds reference boards together, live, and shares them with one link. For one person’s offline library of every reference they have ever saved, Eagle is the better tool, and plenty of artists keep both.' },
      { q: 'Eagle vs Soleil Clusters — what is the difference?', a: 'Eagle is a desktop library on your own disk: tags, smart folders, colour search and AI search by image or description, offline, for US$34.95 once. Clusters is a shared canvas in the browser: live editing, comments, votes, nested boards and docs, free to start and $25/mo for Creator.' },
      { q: 'Can I use Eagle and Clusters together?', a: 'Yes, and it is the natural split. Keep the archive in Eagle. When a project starts, bring the references it needs onto a cluster — Eagle keeps every original as a real file on your disk — and build the board with your team there.' },
      { q: 'Does Clusters work offline like Eagle?', a: 'No. Clusters lives in the cloud and needs a connection, and anything on a board can be downloaded again. If offline access to a large personal library matters most, Eagle is built for exactly that.' },
      { q: 'Is there a Clusters app for iPhone or iPad?', a: 'Clusters runs in the mobile browser and can be added to the home screen as a web app, where it opens without browser chrome. There is no App Store or Play Store listing yet. Eagle has no official mobile app either.' },
      { q: 'How much does Eagle cost?', a: 'As of October 2026, Eagle’s store lists US$34.95 as a one-time purchase with free lifetime updates, and each licence covers two devices. Clusters is free to start; Creator is $25 a month for unlimited cards, 100GB of storage with no size limits.' },
    ],
    siblingListicle: { path: '/best/pureref-alternatives', label: 'See every PureRef alternative, Eagle included, ranked by a film studio.' },
    related: ['/vs/pureref', '/best/pureref-alternatives', '/tools/reference-board-maker', '/tools/shared-reference-board', '/vs/milanote', '/use-cases'],
  },
  // /vs/google-drive — PRE-REGISTERED 2026-10-02 (the CLAUDE.md ritual).
  //
  // The owner's frame: "the artist's Google Drive — store, access and ORGANIZE
  // your creative assets, and create new ones." The page competes on organising
  // and making, NEVER on storing: no price per GB, no "replace Drive", nothing
  // about sync, offline, backup or apps, and no storage add-ons (a later
  // project). It ships with what makes it true — kept file names (de3f6550…
  // 53db6e40) and folder drop (9c5f70aa) — and claims nothing beyond them: no
  // saved web images and no search inside documents until those exist.
  //   Google predicate: query ~* 'drive' on this path, search_type = 'web',
  //     query = '' rows for the page total; 60 days from the production
  //     promotion, never inside 3 days of it; floor 200 impressions before any
  //     title or meta edit.
  //   AEO predicate: the probe questions "Google Drive alternative for creative
  //     teams" and "can I use Soleil Clusters like Google Drive" cite this domain
  //     within 8 weekly runs of promotion — readable only once the probe's
  //     OpenAI credits are restored.
  //   Fold rule: under 50 impressions at day 60 → 301 into
  //     /tools/shared-reference-board via RETIRED_PAGES (worker.js), retiring
  //     the health expectations by url AND by expected (0262 / 0263).
  // Drive facts, 2026-10-02: a folder downloads as zip files of up to 2GB each
  // (Google Workspace Updates); Drive search finds words inside some images and
  // PDFs by OCR; sync, offline, version history and single-file links are
  // standard. None of them is something Clusters does, and the page says so.
  // ────────────────────────────────────────────────────────────────────────
  {
    path: '/vs/google-drive',
    kind: 'compare',
    title: 'Google Drive Alternative for Creative Teams — Clusters',
    metaDescription:
      'Keep Drive for backup and sync. Clusters is where a creative team sees its files: drop a folder, get nested boards, every file kept under its own name.',
    h1: 'A Google Drive Alternative for Creative Work',
    subhead:
      'Drive stores your files. Clusters shows them — every reference on one canvas your team builds on together, organised the way your folders were.',
    answer:
      'Soleil Clusters is a Google Drive alternative for a creative team’s working files: drop a folder and it becomes nested boards, every file kept under its own name and laid out where the whole team can see it, comment and decide. Keep Drive for backup, sync and offline copies; use Clusters for the work.',
    updated: '2026-10-02',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    stepsHeading: 'How to bring a Drive folder into Clusters',
    steps: [
      { t: 'Download the folder from Drive', d: 'Right-click it in Drive and choose Download. Drive hands you a zip — several for a big folder — so unzip them into one folder.' },
      { t: 'Drop it on a canvas', d: 'It becomes a cluster named after the folder, with a nested cluster for each folder inside, and every file a card under its own name.' },
      { t: 'Lay it out and decide', d: 'Arrange the references, write the brief beside them, and pin comments to the frames that need them.' },
      { t: 'Share one link', d: 'Everyone you invite edits free, and one link shows the board to anyone, with no account needed to view it.' },
    ],
    sections: [
      {
        heading: 'Drive stores files. Clusters shows them.',
        body: 'A Drive folder of references is a list of names until you open them one at a time. In Clusters the same folder is a canvas: every image on screen at once, in rows you can rearrange, beside the notes, the script pages and the decisions about it. Nothing is lost on the way in — each file keeps the name it had, and list view still sorts and filters a cluster like a folder when that is what you want.',
        bullets: [
          'Drop a folder and its folders become nested clusters',
          'Every file keeps its name — in list view, in search, in downloads',
          'List view browses a cluster like a folder: sort, filter, download',
        ],
      },
      {
        heading: 'Where a team actually works',
        body: 'Drive shares files; it does not give a team a place to work on them together. In Clusters the board is shared and live: cursors, comments pinned to the card they are about, a vote card beside each option, and a doc with the brief or the screenplay right next to the images. A link opens it read-only in any browser, and everyone you invite edits free.',
        bullets: [
          'Live cursors, and comments pinned to the card in question',
          'Docs and a screenplay mode beside the imagery',
          'One link to show it; editors are free',
        ],
      },
      {
        heading: 'What to keep Drive for',
        body: 'Backup, sync and offline. Drive keeps a copy on your computer, works without a connection, keeps earlier versions of a file, finds words inside some scanned images and PDFs, and shares a single file with its own link. Clusters does none of those, and is not trying to. Keep the archive in Drive and work from Clusters: drop the folder this project needs, and leave the rest where it is.',
      },
    ],
    compare: {
      competitor: 'Google Drive',
      intro: 'How the two compare for a creative team’s working files. Drive features as of October 2026:',
      rows: [
        { feature: 'A folder of images, all on screen', us: 'Yes — a canvas, laid out', them: 'A thumbnail grid' },
        { feature: 'Folders keep their structure', us: 'Yes — as nested clusters', them: 'Yes — as folders' },
        { feature: 'File names kept', us: 'Yes', them: 'Yes' },
        { feature: 'Notes, docs and comments beside the files', us: 'Yes, on the same canvas', them: 'Comments on a file; Docs separately' },
        { feature: 'A live board a team works on together', us: 'Yes', them: 'No' },
        { feature: 'Sync to your computer, and offline', us: 'No', them: 'Yes' },
        { feature: 'Earlier versions of a file', us: 'No', them: 'Yes' },
        { feature: 'Share one file by its own link', us: 'No — a whole cluster', them: 'Yes' },
        { feature: 'Search words inside images and PDFs', us: 'No — file names and card text', them: 'Yes, for some files' },
      ],
    },
    faq: [
      { q: 'Is Soleil Clusters a Google Drive alternative?', a: 'For a creative team’s working files, yes: drop a folder and it becomes nested boards where every file is on screen, kept under its own name, and worked on together. For backup, sync to your computer and offline copies, keep Drive — Clusters does not do those.' },
      { q: 'Can I bring a whole folder over from Google Drive?', a: 'Yes. Download it from Drive, which gives you a zip, unzip it, and drop the folder onto a Clusters canvas. It becomes a cluster with a nested cluster for each folder inside, and every file a card under its own name. A very large folder can go in over a few drops.' },
      { q: 'Does Clusters sync with Google Drive?', a: 'No. Nothing syncs in either direction: Clusters keeps its own copy of what you drop in, and Drive keeps its own. That is why the honest split is Drive for the archive and Clusters for the project you are working on.' },
      { q: 'Can I find a file by its name in Clusters?', a: 'Yes. Search finds photos and videos by the name their file had, along with cluster names, card text and tags, and list view sorts and filters a cluster like a folder.' },
      { q: 'Is there a Clusters app for my phone?', a: 'Clusters runs in the mobile browser and can be added to the home screen as a web app. There is no App Store or Play Store listing yet, and a phone cannot drop a whole folder.' },
    ],
    docsLinks: [
      { path: '/docs/clusters/list-view', label: 'Using a cluster like a drive' },
      { path: '/docs/clusters', label: 'Dropping a folder' },
    ],
    related: ['/vs/eagle', '/tools/shared-reference-board', '/tools/reference-board-maker', '/vs/milanote', '/vs/pureref', '/use-cases'],
  },
  {
    path: '/vs/pureref',
    kind: 'compare',
    // HELD without the "What it costs" block (owner, 2026-10-01). This page
    // carries most of the comparison traffic and converts best of them, and its
    // copy was corrected 2026-10-02. Turn the block on — delete this line — two
    // weeks after that corrected copy is live on production, not before: one
    // change at a time on the page that pays.
    planBlock: false,
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
    updated: '2026-10-02',
    cta: { label: 'Try Clusters free', sub: 'Runs in your browser. Free to start.' },
    stepsHeading: 'How to move a PureRef board to Clusters',
    steps: [
      { t: 'Collect your images', d: 'Export the images from PureRef, or gather the original files you pinned.' },
      { t: 'Drag them onto a new board', d: 'Select everything in the folder and drag it in — the whole set lands in one go.' },
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
          'Sample colors straight off a reference image into a palette',
        ],
      },
      {
        heading: 'Switching from PureRef takes an afternoon',
        body: 'Bring your references over in one pass: export the images from PureRef (or gather the original files you pinned) and drag the whole set onto a new Clusters board. The images land in one drop, ready to arrange, so the afternoon goes into rebuilding the layout you had — and tags and nested boards keep it organized as the project grows.',
        bullets: [
          'Select a folder’s references and drag them all in at once',
          'Tags and nested boards keep a growing board findable',
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
        { feature: 'Palette cards that keep sampled colors', us: 'Yes', them: 'Picker only' },
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
      { q: 'Can Clusters open .pur files?', a: 'Not directly — .pur is PureRef’s own local format. Export your images from PureRef (or gather the originals) and drag the whole set onto a Clusters board in one drop, and the layout takes minutes to rebuild.' },
      { q: 'Is there a free PureRef alternative?', a: 'Yes — Soleil Clusters is free to start on the Demo tier, with no credit card and nothing to install. To be fair, PureRef itself is pay-what-you-want; the difference is that Clusters adds sharing, real-time collaboration, and cloud sync.' },
      { q: 'Is there a PureRef alternative that works online, with no download?', a: 'Yes. Clusters runs entirely in the browser — open a board on any machine and it is the same board, synced and backed up. Nothing to install for you or for anyone you share it with.' },
      { q: 'What is the best PureRef alternative for teams?', a: 'Clusters is built for exactly that: live cursors and presence, comments pinned to the image they are about, and one shared board as the team’s source of truth instead of a file on one artist’s machine.' },
      { q: 'How do I move my PureRef boards into Clusters?', a: 'Export the images from PureRef (or gather the originals), then drag the whole set onto a new Clusters board. It lands in one drop, and you can rebuild your layout in minutes.' },
      { q: 'Does Clusters work offline like PureRef?', a: 'Clusters is a cloud, browser-based workspace, so it is not a fully-offline desktop window the way PureRef is. In exchange you get sharing, collaboration, and cross-device sync.' },
      { q: 'Can I put more than images on a Clusters board?', a: 'Yes — images, notes, links, video, PDFs, docs, and color palettes all live on the same canvas, with non-destructive image adjustments built in.' },
      { q: 'Is Clusters free?', a: 'Yes, the Demo tier is free with no credit card. Creator ($25/mo) adds unlimited cards, 100GB storage, and no size limits.' },
          { q: 'Can an AI assistant work with my reference board?', a: 'In Clusters, yes — connect Claude or any MCP client with one URL and ask it to build or tidy a board. PureRef is an offline desktop app with no API, so there is nothing for an assistant to connect to. Clusters arranges the references you already have rather than generating images.' },
],
    siblingListicle: { path: '/best/pureref-alternatives', label: 'See all 10 PureRef alternatives, ranked by a film studio.' },
    related: ['/best/pureref-alternatives', '/tools/reference-board-maker', '/tools/shared-reference-board', '/tools/mood-board-maker', '/tools/free-mood-board-maker', '/vs/milanote', '/use-cases', '/tools/ai-mood-board-maker'],
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
      'Soleil Clusters is a Miro alternative purpose-built for creative reference work: image-first cards with photo adjustments, color palettes, docs and screenplay mode, and a relationship graph that ties a mood board to a storyboard to a shot list. Choose Miro for enterprise diagramming and workshops; choose Clusters for film, photo, and design pre-production.',
    updated: '2026-10-02',
    cta: { label: 'Try Clusters free', sub: 'Free to start. No credit card.' },
    sections: [
      {
        heading: 'Purpose-built beats general-purpose',
        body: 'Miro is a powerful general whiteboard for diagrams, workshops, and sticky-note sessions. Clusters is tuned for creative reference work: image-first cards with photo adjustments, color palettes, docs and screenplay mode, and a relationship graph that connects a mood board to a storyboard to a shot list. For film, photo, and design teams, the whole tool is pointed at your workflow instead of everyone’s.',
        bullets: [
          'Image-first cards with photo adjustments and palettes',
          'Docs and screenplay mode built in',
          'Tags and a relationship graph across boards',
        ],
      },
      {
        heading: 'Lighter, and made for showing work',
        body: 'Clusters shares as a clean, interactive preview a client can open with one link — no workspace invite, no learning curve, no diagramming clutter. It is designed for the moment you present references, not just the moment you brainstorm them.',
      },
      {
        heading: 'Your client should not need a Miro account',
        body: 'The moment of truth for a creative board is showing it. With Miro, that usually means inviting someone into a workspace and hoping they find their way around. A Clusters board is one link: the client opens a clean, read-only view of the board in the browser — no account, no seat, no toolbar to explain.',
        bullets: [
          'One link — no workspace invite or account',
          'A clean read-only view of the real board',
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
      { q: 'Why choose Clusters over Miro?', a: 'Clusters is purpose-built for visual creative work — mood boards, look books, storyboards, and film pre-production — with image adjustments, palettes, screenplay mode, and a relationship graph. Miro is a general whiteboard; Clusters is pointed at creative reference workflows.' },
      { q: 'Is Miro overkill for mood boards?', a: 'For many creative teams, yes. Miro is powerful for diagramming and workshops, but a reference-first tool like Clusters is lighter and better tuned for mood boards, look books, and storyboards.' },
      { q: 'Can clients view a Clusters board without an account?', a: 'Yes. Share a link and they see a clean, interactive read-only preview — no workspace invite required.' },
      { q: 'Does Clusters have a free tier?', a: 'Yes. The Demo tier is free; Creator is $25/mo for unlimited cards, 100GB storage, and no size limits.' },
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
    updated: '2026-10-02',
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
        heading: 'For production departments',
        body: 'The same canvas, set up for the way each department actually works — with the honest limits of each written down.',
        bullets: [
          'Shared reference boards — one live wall for a studio art team',
          'Director’s treatment — build the look live, export a PDF',
          'Production design — a board per set for the art department',
          'Costume design — a board per character, looks by scene',
          'Cinematography lookbook — light, lens and frame references',
        ],
      },
      {
        heading: 'See real boards',
        body: 'The best way to understand Clusters is to look at boards people have actually built. Browse the Explore gallery for curated example boards — mood boards, palettes, and reference collections — you can open and learn from.',
      },
      {
        heading: 'Switching from another tool?',
        body: 'If you are coming from Milanote, PureRef, Miro, Storyflow, Wonder Unit Storyboarder, Boords, or StudioBinder, here is how Clusters compares and where it fits your workflow — with an honest look at what each tool does best.',
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
      '/vs/storyflow',
      '/vs/eagle',
      '/vs/google-drive',
      '/tools/ai-mood-board-maker',
      '/tools/shared-reference-board',
      '/tools/directors-treatment',
      '/tools/production-design-mood-board',
      '/tools/costume-design-mood-board',
      '/tools/cinematography-lookbook',
    ],
  },
  {
    path: '/templates',
    kind: 'hub',
    title: 'Grid Templates — Storyboard, Contact Sheet, Shot List',
    metaDescription:
      'Free grid layout templates for storyboards, contact sheets, casting boards and more. Pick one, see what each box is for, add it to a board in one click.',
    h1: 'Grid templates',
    subhead:
      'Pick a shape, see what each box is for, add it to a board.',
    answer:
      'A grid template is a cell layout you stamp onto any board — a storyboard page, a 3×3 contact sheet, a casting board, a shot list row. Each one is empty geometry with a label on every box, so it explains itself. Every cell takes an image, text, a link, a video or a nested board.',
    updated: '2026-08-28',
    cta: { label: 'Start free', sub: 'No credit card. Your first board in seconds.' },
    // NO `sections` AND NO `faq`. A storefront is the one page kind here whose
    // content is its INVENTORY, and the prose floor every other landing page
    // obeys (seoLanding.test.mjs: >=3 sections, >=3 FAQ) does not apply to it —
    // the test exempts a storefront by name and demands a catalogue instead.
    //
    // This page shipped twice with copy below the goods, and measured at 1909px
    // of it under the last tile — 44% of the page. The argument for keeping it
    // was that an answer engine quotes prose rather than a grid of tiles. That
    // argument was answering the wrong question. Somebody asking an assistant
    // for a storyboard template wants the LIST: sixteen names, what each is for,
    // the layout, the box count. So the .md mirror now serializes the catalogue
    // (gen-docs `storefrontMarkdown`), which is both more quotable than three
    // paragraphs about what a template is AND comfortably over the 1000-byte
    // floor docsite.test.mjs enforces. The prose was not carrying the AEO weight
    // it was justified by; the inventory does.
    related: [
      '/tools/storyboard-maker',
      '/tools/shot-list-maker',
      '/tools/mood-board-maker',
      '/best/storyboard-software',
      '/use-cases',
    ],
    // The store front. The catalogue comes from templateCards.js plus the
    // published community layouts; search/sort/chips are enhancement over links
    // that are already in the server-rendered HTML. Items are NOT specs in this
    // file — fifteen of them would be ~40KB of prose in a module the CLIENT
    // imports on /explore, and would render fifteen extra chips in every hub nav.
    storefront: true,
    docsLinks: [{ path: '/docs/canvas/grids', label: 'Grids documentation' }],
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
  '/vs/storyflow':                ['screenplay-beat-sheet', 'short-film-shot-list', 'neon-noir-look-book'],
  '/vs/eagle':                    ['film-noir-look-book', 'japandi-living-room', 'neon-noir-look-book'],
  '/vs/google-drive':             ['world-cup-2026-moodboard', 'film-noir-look-book', 'japandi-living-room'],
  '/use-cases':                   ['world-cup-2026-moodboard', 'neon-noir-look-book', 'sage-terracotta-wedding'],
  '/tools/shared-reference-board':        ['film-noir-look-book', 'neon-noir-look-book', 'world-cup-2026-moodboard'],
  '/tools/directors-treatment':           ['neon-noir-look-book', 'film-noir-look-book', 'screenplay-beat-sheet'],
  '/tools/production-design-mood-board':  ['japandi-living-room', 'film-noir-look-book', 'neon-noir-look-book'],
  '/tools/costume-design-mood-board':     ['neon-noir-look-book', 'sage-terracotta-wedding', 'film-noir-look-book'],
  '/tools/cinematography-lookbook':       ['film-noir-look-book', 'neon-noir-look-book', 'short-film-shot-list'],
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
  '/vs/storyflow':                'Storyflow alternative',
  '/vs/eagle':                    'Eagle alternative',
  '/vs/google-drive':             'Google Drive alternative',
  '/use-cases':                   'What you can make',
  '/templates':                   'Grid templates',
  '/tools/shared-reference-board':        'For studio art teams',
  '/tools/directors-treatment':           'For directors',
  '/tools/production-design-mood-board':  'For the art department',
  '/tools/costume-design-mood-board':     'For costume designers',
  '/tools/cinematography-lookbook':       'For cinematographers',
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

// What production LISTS: every page, minus the template store while it is held
// (lib/templatePaths.js). Rendering still resolves every spec through
// getLandingSpec, because the preview deploy serves the held store. Everything
// that hands a URL to a crawler or a reader reads this instead — the sitemap,
// IndexNow, /explore's hub nav, the .md mirrors and llms.txt, and the homepage
// nav test — so a page production 404s is never offered by any of them.
export const SEO_LANDING_LISTED = PAGES.filter((p) => !(TEMPLATE_STORE_HELD && isTemplateStorePath(p.path)));

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
