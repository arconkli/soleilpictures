// helpHub.js — what the Help hub says, as data. Pure, node-testable.
//
// The product-education pass (2026-10-06) found that every surface which TELLS
// people about features — the tour, the intent pick, the just-in-time reveals,
// the docs site — is null for return, and that the most habitual users reach
// grids, docs and list view on their own. So the hub is pull, not push: it
// opens only when someone asks (a ? button, a ⌘K command), it is one screen
// that names every kind of card with one honest line each, and it is graded on
// its own reach (admin_feature_reach, 0365), never on return.
//
// Every docs path here is asserted to exist in the generated registry by
// helpHub.test.mjs, so a renamed page cannot leave a dead link in the app.

// One line per kind, in the order a newcomer meets them: the material first,
// then the containers, then the annotations. The lines describe what the
// product does today — "Any file" says so about the free plan, and changes
// the day file types open up there.
import { t } from '@lingui/core/macro';
import { coarsePointer } from './noteTouchTyping.js';
export const ADD_KINDS = Object.freeze([
  { id: 'image',   get title() { return t`Image`; },            get line() { return t`Paste from any tab, drag from your desktop, or drop a whole folder — they arrange themselves.`; }, docs: '/docs/canvas/images' },
  { id: 'note',    get title() { return t`Note`; },             get line() { return coarsePointer() ? t`Bold, lists, and @-mentions of other cards.` : t`Press N, or right-click the canvas. Bold, lists, and @-mentions of other cards.`; }, docs: '/docs/canvas/notes' },
  { id: 'doc',     get title() { return t`Doc`; },              get line() { return t`Long-form writing with pages, an outline, comments and backlinks.`; }, docs: '/docs/documents' },
  { id: 'script',  get title() { return t`Script`; },           get line() { return t`A doc in screenplay mode. Drop a .fountain or .fdx file and it opens as one.`; }, docs: '/docs/documents/screenplay' },
  { id: 'link',    get title() { return t`Link`; },             get line() { return t`Paste a URL onto the canvas and it unfurls into a card.`; }, docs: '/docs/canvas/cards' },
  { id: 'media',   get title() { return t`Video & audio`; },    get line() { return t`Real players on the canvas; audio you can loop and audition from Files.`; }, docs: '/docs/files/video-and-audio' },
  { id: 'pdf',     get title() { return t`PDF`; },              get line() { return t`A viewer on the canvas, so a deck or a contract is readable where it sits.`; }, docs: '/docs/files/pdf' },
  { id: 'file',    get title() { return t`Any file`; },         get line() { return t`On Creator, anything at all becomes a file card with a download. Free covers images, video, audio and PDFs within size caps.`; }, docs: '/docs/files' },
  { id: 'cluster', get title() { return t`Cluster`; },          get line() { return t`A board inside a board. Drag cards onto it to file them; its files are in the sidebar, and F opens them full screen like a drive.`; }, docs: '/docs/clusters' },
  { id: 'grid',    get title() { return t`Grid`; },             get line() { return t`A resizable frame with cells that snap images into a layout — press G.`; }, docs: '/docs/canvas/grids' },
  { id: 'palette', get title() { return t`Color palette`; },    get line() { return t`Swatches pulled from an image, or picked by hand.`; }, docs: '/docs/canvas/palettes-and-color' },
  { id: 'draw',    get title() { return t`Shapes & drawing`; }, get line() { return t`Free-draw with D; shapes you can resize and recolor.`; }, docs: '/docs/canvas/shapes-and-drawing' },
  { id: 'arrow',   get title() { return t`Arrow`; },            get line() { return t`Press A. Arrows anchor to cards and follow them when you move things.`; }, docs: '/docs/canvas/arrows' },
  { id: 'vote',    get title() { return t`Vote card`; },        get line() { return t`A question with options that everyone on the cluster can vote on.`; }, docs: '/docs/canvas/vote-cards' },
]);

// The hub's other doors, in display order. `item` is what help_item logs.
export const HUB_ACTIONS = Object.freeze([
  { item: 'shortcuts', get label() { return t`Keyboard shortcuts`; }, get hint() { return t`or press ?`; } },
  { item: 'guides',    get label() { return t`Guides`; },             get hint() { return t`the handbook, by what you are trying to do`; } },
  { item: 'changelog', get label() { return t`What's new`; },         get hint() { return t`every change, newest first`; }, href: '/changelog' },
  { item: 'feedback',  get label() { return t`Send feedback`; },      get hint() { return t`one tap is enough`; } },
]);

// One link per docs section: the section's index page when it has one, else
// its first page by order. Built from the generated registry so a section
// added to content/docs appears here without anyone editing this file.
export function guideLinks(sections, pages) {
  const out = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    const own = (Array.isArray(pages) ? pages : [])
      .filter((p) => p && p.section === s.id && typeof p.path === 'string')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!own.length) continue;
    const index = own.find((p) => p.path === `/docs/${s.id}` || p.path === '/docs') || own[0];
    out.push({ id: s.id, label: s.label, blurb: s.blurb || '', path: index.path });
  }
  return out;
}
