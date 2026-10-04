// publicClaims.test.mjs — truth-in-advertising lint over every public copy
// surface, not just billingCopy.
//
// billingCopy.js carries the rule ("EVERY LINE HERE MUST BE TRUE AND ENFORCED
// IN CODE") and billingCopy.test.mjs enforces it — but only for the strings
// that live IN that module. The SEO landing registry, the listicle family, the
// Worker's edge-injected meta and the docs pages all make plan claims of their
// own, and nothing checked them. That gap shipped two retired claims for
// months: "Edit Mode" (migration 0188 made editing free for every tier) and
// "unlimited boards" as a Creator feature (boards were never capped on any
// tier). Both were found by grepping a production bundle, which is not a
// process.
//
// The enforced free/paid differences are exactly three (see billingCopy.js):
// cards, file types, per-file size on a 100GB drive. Anything else sold as a
// paid unlock is false.
//
// SCOPE NOTE: these files legitimately describe COMPETITORS' plans, which do
// cap boards and do gate editing. Every rule below is therefore scoped to
// sentences that talk about OUR plan (they name Creator, or our Demo tier), so
// a sentence about Milanote's free tier can say whatever is true of Milanote.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, '../..');

function walk(dir, match, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match.test(name)) out.push(p);
  }
  return out;
}

// Whole-line comments out, for CODE files only.
//
// The pricing components had to join this corpus (see below) and their comment
// blocks are where the rationale lives — which means they quote, at length, the
// exact false claims these rules ban. Scanning them unstripped fails the lint
// on its own explanation of why the lint exists.
//
// Line-based, and never applied to Markdown: in a .md file `*` opens a list
// item and `//` appears in URLs, so a code stripper would silently delete real
// public copy and quietly pass a lint that scans nothing.
function stripCodeComments(text) {
  return text
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*\/|\*|\/\*)/.test(l))
    .join('\n');
}

// Code files carrying public plan claims. The two pricing COMPONENTS are here
// because they were the hole: every rule below is a rule about what we tell the
// public, and until now the lint could not see the two screens that tell the
// public the most. billingCopy.test.mjs covers the strings that live in
// billingCopy; anything typed straight into the JSX escaped both.
// `ours: true` means EVERY sentence in the file is a claim about our own plan,
// so the scoped rules below apply without needing the span to name Creator.
// The SEO registries and the Worker legitimately describe competitors' plans
// (which do cap boards, and do gate editing), which is what the scoping exists
// for — but a pricing screen has no competitors on it. Without this flag the
// scoped rules almost never fire on the components, because their four header
// branches each state the offer without repeating the word "Creator", and a
// lint that can only catch the claims that name themselves is not much of one.
const CODE = [
  { path: resolve(BOARDS, 'src/lib/seoLanding.js'), ours: false },
  { path: resolve(BOARDS, 'src/lib/seoListicles.js'), ours: false },
  { path: resolve(BOARDS, 'src/worker.js'), ours: false },
  { path: resolve(BOARDS, 'src/lib/billingCopy.js'), ours: true },
  // The crawlable /pricing body and its .md twin — every sentence is ours.
  { path: resolve(BOARDS, 'src/lib/pricingCrawlable.js'), ours: true },
  // The "What it costs" block on comparison and professional pages.
  { path: resolve(BOARDS, 'src/lib/planBlock.js'), ours: true },
  { path: resolve(BOARDS, 'src/components/PricingModal.jsx'), ours: true },
  { path: resolve(BOARDS, 'src/auth/PublicPricingPage.jsx'), ours: true },
  { path: resolve(BOARDS, 'src/auth/PricingPage.jsx'), ours: true },
  // The /pricing SCREEN moved here; the two files above are now thin route
  // shells that pass props. Without this the corpus named the doors and not
  // the room — every line of prose a visitor actually reads on that page was
  // unlinted from the moment the view was extracted.
  { path: resolve(BOARDS, 'src/auth/PricingPageView.jsx'), ours: true },
  // And the shared card internals, which render the benefit titles and bodies.
  { path: resolve(BOARDS, 'src/components/PricingBits.jsx'), ours: true },
  // The homepage. '/' is the sign-in screen, and its animated backdrop is the
  // first copy every visitor reads — it said a dropped file is "auto-tagged and
  // filed to the right board" for a month after the SEO pages stopped saying
  // it, because nothing scanned it. index.html carries the crawlable body that
  // stands in for the same screen.
  { path: resolve(BOARDS, 'src/auth/SignInBackdrop.jsx'), ours: true },
  { path: resolve(BOARDS, 'index.html'), ours: true, html: true },
];

// HTML comments out, for the one HTML file. They span lines, so the line-based
// stripper above cannot see them, and index.html's explain the page at length.
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

const FILES = [
  ...CODE.map((c) => ({ ...c, code: true })),
  ...walk(resolve(BOARDS, 'content/docs'), /\.md$/).map((p) => ({ path: p, code: false, ours: false })),
  // The template pages (/templates/<slug>) are public SEO copy too; one sold
  // "re-order by dragging" on a single grid whose cells cannot be dragged.
  ...walk(resolve(BOARDS, 'content/templates'), /\.md$/).map((p) => ({ path: p, code: false, ours: false })),
].map(({ path: p, code, ours, html }) => {
  const raw = readFileSync(p, 'utf8');
  const text = html ? stripHtmlComments(raw) : code ? stripCodeComments(raw) : raw;
  return { path: p, rel: relative(BOARDS, p), ours, text };
});

// Split into sentence-ish spans so a rule can require two terms to co-occur in
// ONE claim. Newlines end a span too: adjacent bullets are separate claims.
function sentences(text) {
  return text.split(/(?<=[.!?])\s+|\n/g);
}

// A span is about OUR plan if it names Creator or our Demo tier. Competitor
// prose in these files names the competitor instead, so it falls out of scope.
function aboutOurPlan(s) {
  return /\bCreator\b/.test(s) || /\bDemo tier\b/i.test(s) || /\bfree Demo\b/i.test(s);
}

// An FAQ *question* restates the phrase a searcher typed; it asserts nothing,
// and the answer beneath it is what has to be true. "Is there a free Milanote
// alternative without item caps?" is a legitimate question to answer honestly
// ("Both free tiers cap items…") — flagging the question would push us toward
// not answering it at all.
// Both key styles appear: bare `q:` in the landing registry, quoted `"q":` in
// the listicle JSON blocks.
function isFaqQuestion(s) {
  return /["']?\bq["']?:\s*['"`]/.test(s) && /\?/.test(s);
}

const RULES = [
  {
    name: 'Edit Mode is a retired feature name (0188 made editing free for every tier)',
    // Capitalized, it is the retired product noun and always wrong. Lowercase
    // "edit mode" is ordinary UI vocabulary — a note leaves edit mode when you
    // click away — so that form is only an error inside a plan claim.
    scoped: false,
    pattern: /Edit Mode/,
  },
  {
    name: 'editing is not part of what a plan unlocks',
    scoped: true,
    pattern: /edit mode/i,
  },
  {
    // Until 2026-10-01 this rule banned "unlimited boards" only when sold as a
    // CREATOR unlock, and let "the free tier covers N cards across unlimited
    // boards" pass as true. The owner ruled otherwise: every cluster sits on its
    // parent's canvas as a card and spends one of those N, so on a capped plan
    // "unlimited clusters" reads as free room that is not there. Same for photo
    // uploads — each photo is a card; "uploads never metered" (no SEPARATE
    // budget) is the true form. Nesting really is unlimited, and "unlimited
    // nesting" passes. Scoped like the rest: competitors' unlimited boards are
    // theirs to claim.
    name: 'a cluster or a photo costs a card — never sell either as unlimited',
    scoped: true,
    pattern: /unlimited (boards|clusters|photo uploads)|(clusters|boards) (are|is) unlimited/i,
  },
  {
    name: 'invited collaborators edit free on every tier (a public LINK is read-only, a collaborator is not)',
    scoped: true,
    pattern: /collaborators?[^.!?]*\bread-only\b|\bread-only\b[^.!?]*collaborators?/i,
  },
  {
    name: 'editing is not sold per seat and is not a paid unlock',
    scoped: true,
    pattern: /(unlocks?|turns on|adds?|enables?) (shared )?editing|paid seat to edit/i,
  },
  {
    // The most expensive claim found in this sweep: a whole landing page was
    // titled "No Item Caps" and its answer paragraph — the block AI engines
    // quote — promised "no hard item cap on the free tier", while
    // enforce_demo_card_cap_trg stops that tier at 50 cards (100
    // grandfathered). Uploads are not metered SEPARATELY, which is the true
    // and still-good claim; every file simply lands as a card under the cap.
    name: 'the free tier IS card-capped — never advertise it as uncapped',
    scoped: false,
    pattern: /no (hard )?(item|card) (cap|wall)|without (the )?item (caps?|wall)|no upload ceiling|no ceiling on (image )?uploads|does not meter uploads/i,
  },
  {
    // /docs/account/mobile told visitors and AI answer engines for months that
    // Clusters "ships as iOS and Android apps" and takes photos from the system
    // share sheet, while the native shells were never built for a store and no
    // share target existed on any surface. A shipped app is a store listing you
    // can link to; until there is one, the docs describe the browser and the
    // home-screen web app only.
    name: 'no native iOS/Android app is shipped — do not describe one as available',
    scoped: false,
    // Widened 2026-09-19 after four landing FAQs and three docs pages slipped
    // the original: "apps are available", "also iOS and Android builds", "in
    // the native apps", "a native iOS app as well", and exports "through the
    // system share sheet". "Builds are in development" (mobile.md) is TRUE and
    // must keep passing — the alternations name the false shapes, not the noun.
    // Widened again 2026-10-02: two docs pages described downloads "in the
    // phone and tablet apps" — the Capacitor shells' behaviour, in no store.
    pattern: /ships as (native )?(iOS|Android)|native apps for iOS and Android|native (iOS|Android)( and Android)? apps? (for|handle|land|open)|native (iOS|Android)( and Android)? apps? (are|is) (also )?available|(Yes|yes),? for iOS and Android|share sheet from photos|the (native )?iOS and Android apps|also iOS and Android builds|in the native apps|native iOS app as well|(export|exports) (goes?|are delivered) through the (platform's own |system )?share sheet|\bin the phone and tablet apps?\b/i,
    known: [
      'In the phone and tablet apps files come down one at a time, through the system share sheet.',
      'Clusters ships as iOS and Android apps',
    ],
    theirs: ['Native iOS and Android builds are in development.'],
  },
  {
    // Twenty-five marketing lines, four compare-table rows and the homepage's
    // crawlable body said a dropped file is read, tagged and "filed to the right
    // board automatically". Two things are wrong with that. A tag is not a
    // location: tagging moves nothing, ever. And automatic tagging reads TEXT —
    // titles, notes, the names of groups and clusters — against tags somebody
    // already made; it never looks at what a picture shows, so a dropped image
    // is not tagged either. (What it does do, when a card's text closely matches
    // an existing tag, is apply that tag marked "auto", to be confirmed or
    // dismissed — see docs/organize/tags.md.) Removed 2026-10-01; the homepage
    // animation (SignInBackdrop.jsx) kept saying it until 2026-10-02 because it
    // sat outside this corpus. Competitors' auto-tagging (Eagle's, refern's) is
    // theirs to claim; these shapes are ours.
    name: 'tagging moves nothing and never reads a picture — never sell dropped files as auto-tagged or auto-filed',
    scoped: false,
    pattern: /auto-?tagging (files|reads and files|organi[sz]es (images|them|references))|reads it,? (auto-?)?tags it|tags and files each one|files (each|every) (dropped )?(reference|image|one) (as it lands|to the right board)|files (them|it|a dropped image) to the right board|automatic organi[sz]ation of dropped files|(drop|dropped|upload)[^.!?]{0,60}\bauto-?tags? (it|them|each)/i,
    known: [
      'Drop any image, link, or file — Clusters reads it, auto-tags it, and files it to the right board.',
      'auto-tagging files each reference to the right board',
    ],
    theirs: [
      'Auto-tag rules, smart folders, and search by dominant color do the organizing',
    ],
  },
  {
    // Five professional pages, the reference-board page and a /vs/pureref
    // compare row ("Color palette extraction: Yes / No") said a palette is
    // pulled or extracted from any image. Nothing extracts one: a palette
    // card's eyedropper samples ONE pixel per click into a swatch
    // (CanvasSurface sampleImagePixel), and PureRef has a picker of its own, so
    // the row was wrong on both sides. The true form is "sample swatches off any
    // image with the eyedropper". Fixed 2026-10-02.
    name: 'a palette is sampled a swatch at a time — never sell palette extraction',
    scoped: false,
    pattern: /(extract|pull)(s|ed|ing)? (a |the )?(colou?r )?palettes? (from|out of|straight (from|out of))|palettes? (pulled|extracted) (from|out of|straight)|palettes? come straight out of|colou?r palette extraction|palettes? from any (image|frame|reference)/i,
    unless: (s) => /\b(Eagle|Milanote|Adobe|Canva|Coolors|Pinterest|Figma|Miro|refern|PureRef|Storyflow|StudioBinder|Boords)\b/.test(s),
    known: [
      'Steal the palette — extract a color palette from any image and keep it on the board',
      'Look and light. Pull a palette from any reference image and keep it beside the frames',
      'Palettes pulled from any image, with hex values',
      'Black-and-white value checks and palettes from any image',
      'Palettes come straight out of any reference.',
      "{ feature: 'Color palette extraction', us: 'Yes', them: 'No' },",
    ],
    theirs: [
      'Coolors extracts a colour palette from any image you upload',
      'A palette card holds a set of colours on your board that everything else can pull from',
      'Sample swatches off any reference with the eyedropper and keep the hex values beside the set',
    ],
  },
  // Three mechanics the same pass described wrongly, each fixed 2026-10-02. A
  // comment anchors to a card, a group, an empty point on the canvas, a board or
  // a text range — never to a spot inside a picture (there is no 'cell' or
  // 'pixel' anchor kind). A vote card is ONE up/down poll, so choosing between
  // options means a card beside each option. And a grid cell holds one thing:
  // there is no per-cell caption (the action goes in the box beneath) and cells
  // do not drag into a new order — re-sequencing is done by moving whole grids
  // in a numbered sequence (SHOT [#], gridSequence.js).
  {
    name: 'a comment pins to a card or a spot on the canvas, never a point inside an image',
    scoped: false,
    pattern: /\bpoint on (the|an?) (image|picture|frame|reference|photo)\b|anchors? to the card, or to a point on it/i,
    unless: (s) => /\b(Milanote|Miro|Frame\.io|Figma|Boords|StudioBinder|Storyflow|Filestage|Ziflow)\b/.test(s),
    known: [
      'Comment on a card or a point on the image, tag references by character or setting',
      'In Clusters a comment anchors to the card, or to a point on it, so “push the rim light here” sits on the exact frame',
    ],
    theirs: ['Frame.io pins a comment to a point on the frame at a timecode'],
  },
  {
    name: 'a vote card is one up/down poll — it cannot pick between several options on its own',
    scoped: false,
    pattern: /\ba vote card (settles|decides|picks)\b|that last one settles ['‘“]?which of/i,
    known: [
      'when it comes down to two options, a vote card decides.',
      'and a vote card picks between options.',
      "and vote cards — that last one settles 'which of these five frames' arguments without a meeting.",
    ],
    theirs: ['and a vote card beside each chair settles “which of these three” without a meeting.'],
  },
  {
    name: 'a grid cell holds one thing — no per-cell captions, and cells do not drag into a new order',
    scoped: false,
    pattern: /\bcells? (re-?order|swap|move) by dragging|\bre-?order (shots|panels|cells|frames) by dragging|\bre-?order by dragging|\bdragging (one|a shot|a frame|a panel) re-?(sequences|orders)|drag one and the sequence follows|\bdrag (panels|cells) to re-?(sequence|order)|captions? (sit )?under each (frame|panel|cell)|\bcaption each (cell|frame)|numbered panels with captions|a cell per scene or change[^.!?]{0,30}caption/i,
    unless: (s) => /\b(Milanote|Boords|StudioBinder|Storyflow|Plot|Canva|Miro|Frame\.io|Storyboarder|Celtx)\b/.test(s),
    known: [
      'Cells reorder by dragging, captions sit under each frame',
      'caption and re-order shots by dragging',
      'Drag panels to re-sequence the scene, and number them automatically.',
      'Auto-numbered panels with captions',
      'A grid per character with a cell per scene or change — the look, a caption, and the swatch.',
      // Stamped grids join ONE group (App.jsx ensureGridGroup), so dragging a
      // shot moves the whole sequence and nothing renumbers. Fixed 2026-10-02.
      'Each shot numbers itself by position, so dragging one re-sequences the scene.',
      'Shots that number themselves — drag one and the sequence follows',
      'Drop in a shoot, re-order by dragging, share one link.',
    ],
    theirs: ['Type SHOT [#] in a box, then stamp the next shot from the + on the grid’s edge. Each new shot carries the box and numbers itself by where it sits.'],
  },
];

// Schedule cards have been held off production since 2026-09-01 (owner: "these
// are so bad, they should NOT be on prod right now"). appHost's
// scheduleCreationAllowed() is DEV-or-preview only, the docs say "being
// rebuilt" — and until 2026-10-01 eight SEO pages still told visitors to "add a
// schedule card to map shots to shoot days" and ranked us first "from mood board
// to call sheet". A professional who arrived on that promise found no such
// button. This guard reads the hold out of appHost.js itself, so it lifts on its
// own the day the gate opens, and the claims can come back with the feature.
// Marketing surfaces only: the docs DESCRIBE existing schedule cards under a
// being-rebuilt banner, which is true, and competitors' call sheets and
// stripboards are real and stay in the listicles.
const SCHEDULE_GATE = (readFileSync(resolve(BOARDS, 'src/lib/appHost.js'), 'utf8')
  .match(/export function scheduleCreationAllowed\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
const SCHEDULE_HELD = /onPreviewHost\(\)/.test(SCHEDULE_GATE) && /import\.meta\.env\.DEV/.test(SCHEDULE_GATE);
const SCHEDULE_CLAIM = /schedule card|schedules? and the screenplay|schedule, the screenplay|map(s|ping)? (each |every )?shots? to (its |their )?(shoot )?days|mood board to call sheet|reach a call sheet|grids, schedules|palettes?, (and )?(a )?schedules?|(shot list|storyboard|mood board),? (and )?(the )?schedule (are|as|live|become)|the shot list,? (and )?the schedule|production schedule and screenplay/i;

test('no marketing copy sells schedules, shoot days or call sheets while schedule creation is held', () => {
  // The pattern must keep catching the claims it was written for, or the guard
  // passes vacuously the first time someone rephrases one.
  for (const known of [
    'Add a schedule card to map shots to shoot days',
    'taking a production team from mood board to call sheet',
    'the mood board, the storyboard grid, the visual shot list, and the schedule are linked boards',
    'palettes, grids, schedules, and vote cards',
  ]) assert.ok(SCHEDULE_CLAIM.test(known), `the schedule guard no longer recognises: ${known}`);
  // Competitor facts must keep passing: StudioBinder really does ship these.
  for (const theirs of [
    'Autofilled call sheets driven by a contact database, with delivery analytics',
    'Shot list scheduling that ties coverage to shoot days',
    'Concepting only — no shot list, schedule or production context around the board',
  ]) assert.ok(!SCHEDULE_CLAIM.test(theirs), `the schedule guard would flag a competitor fact: ${theirs}`);

  // If the gate function moves or is renamed, say so — a guard that quietly
  // stops reading the hold is the failure this test exists to prevent.
  assert.ok(SCHEDULE_GATE, 'appHost.js no longer exports scheduleCreationAllowed() — point this guard at the new gate');
  if (!SCHEDULE_HELD) return; // the hold is lifted — schedule claims may return
  const hits = [];
  for (const rel of ['src/lib/seoLanding.js', 'src/lib/seoListicles.js', 'index.html', 'scripts/gen-docs.mjs']) {
    const raw = readFileSync(resolve(BOARDS, rel), 'utf8');
    const text = rel.endsWith('.html') ? raw : stripCodeComments(raw);
    sentences(text).forEach((s) => {
      if (SCHEDULE_CLAIM.test(s) && !isFaqQuestion(s)) hits.push(`${rel}: ${s.trim().slice(0, 160)}`);
    });
  }
  assert.deepEqual(hits, [],
    `schedule creation is held off production (appHost.scheduleCreationAllowed), so these sell a feature a visitor cannot use:\n  ${hits.join('\n  ')}`);
});

// Settings → Connections is where Soleil Scout's connect code lives — and the
// bot has never run, so appHost.scoutConnectAllowed() holds the section off
// production. Production used to carry that hold as its own commit, together
// with the docs wording; when the hold moved into main (2026-10-03) the docs had
// to say the same everywhere: a connect code or a pending-claim list in your
// settings is built but not switched on. This reads the hold out of appHost.js,
// so it lifts the day the gate opens and the docs can offer the code again.
const SCOUT_GATE = (readFileSync(resolve(BOARDS, 'src/lib/appHost.js'), 'utf8')
  .match(/export function scoutConnectAllowed\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
const SCOUT_HELD = /onPreviewHost\(\)/.test(SCOUT_GATE) && /import\.meta\.env\.DEV/.test(SCOUT_GATE);
const SCOUT_CLAIM = /Settings → Connections\**\s+(gives|shows|lists|has) you a connect code|(is|are) listed in \**Settings → Connections\**[^.]*\b(number|claim|phone)|claim[^.]{0,60}listed in \**Settings → Connections|\*\*Soleil Scout\*\* — the connect code|alongside Soleil Scout/i;

test('no docs offer Scout\'s connect code in settings while the Scout section is held', () => {
  for (const known of [
    '**Settings → Connections** gives you a connect code. Text `/code <code>` and the phone',
    'A pending claim on your account is listed in **Settings → Connections**, so a number',
    '- **Soleil Scout** — the connect code that binds a phone number to this',
    'Under Connections, alongside Soleil Scout and any apps you have approved.',
  ]) assert.ok(SCOUT_CLAIM.test(known), `the Scout guard no longer recognises: ${known}`);
  for (const ok of [
    'When it is, you will get a connect code from your settings and text it once.',
    'Afterwards the connection is listed under **Settings → Connections → Connected apps**,',
  ]) assert.ok(!SCOUT_CLAIM.test(ok), `the Scout guard would flag a true sentence: ${ok}`);
  assert.ok(SCOUT_GATE, 'appHost.js no longer exports scoutConnectAllowed() — point this guard at the new gate');
  if (!SCOUT_HELD) return;
  const hits = [];
  for (const p of walk(resolve(BOARDS, 'content/docs'), /\.md$/)) {
    readFileSync(p, 'utf8').split(/\n\s*\n/).forEach((para) => {
      const flat = para.replace(/\n/g, ' ');
      if (SCOUT_CLAIM.test(flat)) hits.push(`${p.slice(BOARDS.length + 1)}: ${flat.trim().slice(0, 160)}`);
    });
  }
  assert.deepEqual(hits, [],
    `Scout's settings section is held off production (appHost.scoutConnectAllowed), so these offer something no one can see:\n  ${hits.join('\n  ')}`);
});

// Dragging a FOLDER onto the canvas does nothing useful today. No drop path
// reads a directory — there is no webkitGetAsEntry walk and no webkitdirectory
// input — so the browser hands over one empty File named after the folder. What
// works is selecting everything INSIDE the folder and dragging that, which is
// what the copy now says. Until 2026-10-02 the SEO pages, the docs, the empty
// board, the tour and the post-checkout toast all said "drop a whole folder",
// and two of those were written by the same pass that removed the schedule and
// auto-filing claims. Like the schedule guard, this reads the source rather
// than a flag: the day a drop path walks directories it lifts on its own, and
// folder claims can come back with the feature.
const FOLDER_SOURCE = walk(resolve(BOARDS, 'src'), /\.(jsx?|mjs)$/)
  .filter((p) => !/\.test\.mjs$/.test(p) && !/(docsite|changelog)(Content|Crawlable|Index)\.js$/.test(p));
const FOLDER_DROP_LIVE = FOLDER_SOURCE.some((p) =>
  /webkitGetAsEntry|getAsFileSystemHandle|webkitdirectory/.test(stripCodeComments(readFileSync(p, 'utf8'))));
const FOLDER_CLAIM = /\b(drop|drag)(s|ped|ping|ged|ging)? (in )?(a|the|its|your|one) (whole |entire )?(reference )?folder\b|\bwhole folder (lands|at once|in one)|\bfolder (of [a-z]+ )?lands in one|\bby the folder\b|\bsingle drag of a folder\b|\bdragging a folder\b|\bkeep the whole folder\b|\b(a|the|your) folder (you drop|will not fit|won't fit|does not fit)/i;

test('no copy tells anyone to drop a folder while no drop path can read one', () => {
  for (const known of [
    'Drag images, screenshots, links, and files straight onto the canvas — a whole folder lands in one drop.',
    'Drop period photography, film frames and scout photos in by the folder',
    'Paste or drag images from any tab, or drop a whole folder',
    'Moving to Soleil Clusters means dragging your files in, which for a reference board is usually a single drag of a folder.',
    'Drag its reference folder onto a new cluster; let it auto-arrange.',
    'If you drag in a folder with more files than your remaining allowance',
    'Drop the whole set at once — a folder of references lands in one go.',
    'Drop your folder again — all 40 will fit.',
    'the prompts that show up when a folder you drop will not fit',
    'or the dialog that appears when a folder will not fit',
  ]) assert.ok(FOLDER_CLAIM.test(known), `the folder guard no longer recognises: ${known}`);
  for (const fine of [
    'select everything in a folder and drag it in',
    'Select a folder’s references and drag them all in at once',
    'so a folder of samples becomes something you can order by tempo or by key',
    '| Folder | A nested cluster — nesting is unlimited |',
    'Bring reference in from wherever it lives now — a shared drive folder, a CDN',
  ]) assert.ok(!FOLDER_CLAIM.test(fine), `the folder guard would flag a true sentence: ${fine}`);

  if (FOLDER_DROP_LIVE) return; // a drop path walks directories — folder claims may return
  const corpus = [
    'src/lib/seoLanding.js', 'src/lib/seoListicles.js', 'index.html', 'scripts/gen-docs.mjs',
    'src/auth/SignInBackdrop.jsx', 'src/lib/firstBoardCopy.js', 'src/lib/onboardingTour.js',
    'src/auth/PricingSuccess.jsx', 'src/App.jsx',
    ...walk(resolve(BOARDS, 'content'), /\.md$/).map((p) => relative(BOARDS, p)),
  ];
  const hits = [];
  for (const rel of corpus) {
    const raw = readFileSync(resolve(BOARDS, rel), 'utf8');
    const text = rel.endsWith('.md') ? raw : rel.endsWith('.html') ? stripHtmlComments(raw) : stripCodeComments(raw);
    sentences(text).forEach((s) => {
      if (FOLDER_CLAIM.test(s) && !isFaqQuestion(s)) hits.push(`${rel}: ${s.trim().slice(0, 160)}`);
    });
  }
  assert.ok(corpus.length > 60, `the folder guard should scan the docs and changelog too, found ${corpus.length} files`);
  assert.deepEqual(hits, [],
    `nothing reads a dropped directory (no webkitGetAsEntry), so these promise a drop that hands over one empty file — say "select everything in the folder and drag it in":\n  ${hits.join('\n  ')}`);
});

for (const rule of RULES) {
  test(`no public copy claims: ${rule.name}`, () => {
    // A rule that names the claims it was written for must keep catching them,
    // or it passes vacuously the first time the pattern is edited.
    for (const k of rule.known || []) assert.ok(rule.pattern.test(k), `the rule no longer recognises: ${k}`);
    for (const t of rule.theirs || []) {
      assert.ok(!rule.pattern.test(t) || (rule.unless && rule.unless(t)), `the rule would flag a true sentence: ${t}`);
    }
    const hits = [];
    for (const f of FILES) {
      sentences(f.text).forEach((s) => {
        if (!rule.pattern.test(s)) return;
        if (isFaqQuestion(s)) return;
        if (rule.scoped && !f.ours && !aboutOurPlan(s)) return;
        if (rule.unless && rule.unless(s)) return;
        hits.push(`${f.rel}: ${s.trim().slice(0, 160)}`);
      });
    }
    assert.deepEqual(hits, [],
      `these public claims are false — see billingCopy.js for the three enforced differences:\n  ${hits.join('\n  ')}`);
  });
}

// A lint that scans nothing passes everything. Prove the corpus is real and
// that the scan can actually see plan claims inside it.
test('the public copy corpus is actually being scanned', () => {
  assert.ok(FILES.length > 20, `expected the docs + SEO registries, found ${FILES.length} files`);
  const creatorClaims = FILES.filter((f) => /\bCreator\b/.test(f.text)).length;
  assert.ok(creatorClaims >= 4, `only ${creatorClaims} files mention Creator — the scan is looking in the wrong place`);

  // The pricing screens are in the corpus and are treated as wholly ours.
  const ours = FILES.filter((f) => f.ours);
  assert.ok(ours.length >= 4, `expected the pricing surfaces to be scanned as our own claims, found ${ours.length}`);
  for (const rel of ['src/components/PricingModal.jsx', 'src/auth/PublicPricingPage.jsx', 'src/auth/PricingPageView.jsx',
    'src/auth/SignInBackdrop.jsx', 'index.html']) {
    assert.ok(FILES.some((f) => f.rel === rel && f.ours),
      `${rel} must be in the corpus — copy typed into the JSX escaped every lint until it was`);
  }

  // Stripping must remove comments and nothing else. A stripper that ate the
  // file would make every rule above pass vacuously; an earlier version of this
  // idiom in a sibling test swallowed 40% of a source file without saying so.
  const modal = FILES.find((f) => f.rel === 'src/components/PricingModal.jsx');
  assert.ok(/upgrade-title/.test(modal.text), 'the stripper must leave the markup intact');
  assert.ok(!/^\s*\/\/ PricingModal —/m.test(modal.text), 'and must remove the comment header');

  // Same for the HTML stripper: the comments go, the crawlable body stays.
  const home = FILES.find((f) => f.rel === 'index.html');
  assert.ok(/id="seo-fallback"/.test(home.text), 'the HTML stripper must leave the crawlable body');
  assert.ok(!/SEO \+ no-JS fallback/.test(home.text), 'and must remove the HTML comments');
  const backdrop = FILES.find((f) => f.rel === 'src/auth/SignInBackdrop.jsx');
  assert.ok(/kind:'note'/.test(backdrop.text), 'the backdrop notes must be in the scanned text');
});
