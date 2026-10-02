// starterDocs — documents a page promises, written when its visitor arrives.
//
// /tools/directors-treatment is titled "Director's Treatment Template", and
// until now pressing its button gave a blank board — the page described a
// template and the product never handed one over. Pressing it now notes the
// request (starterIntent.js) and the signed-in app writes this document onto
// the cluster that opens: a cover, then a page per section, each headed and
// with a line on what goes there. The sections are the SAME list the page
// prints as its steps (seoLanding.js imports TREATMENT_SECTIONS), so the page
// and the document cannot come to disagree about what a treatment holds.
//
// Pure: plain ProseMirror JSON, written by docState.writeScriptBody — one page
// at a time, inside the card's own creation transaction.

// Each section: `t` the heading (page and document alike), `d` the page's step
// text (written for someone reading about treatments), `prompt` the line under
// the heading in the document (written for someone about to write one).
export const TREATMENT_SECTIONS = Object.freeze([
  {
    t: 'Concept',
    d: 'One paragraph: what the piece is and why it works. Write it first, at the top of the document.',
    prompt: 'What the piece is and why it works, in one paragraph.',
  },
  {
    t: 'Tone and references',
    d: 'The frames, films and photographs that set the feel — gathered on the board, where the team argues them into agreement.',
    prompt: 'The frames, films and photographs that set the feel. Bring in the ones the team agreed on.',
  },
  {
    t: 'Look and light',
    d: 'Palette, lensing, light and texture. Sample swatches off any reference image with the eyedropper and keep them beside the frames they came from.',
    prompt: 'Palette, lensing, light and texture.',
  },
  {
    t: 'Casting',
    d: 'Faces and types, with a note on each. Tag each reference as a character so the tag gathers every image of them.',
    prompt: 'Faces and types, with a line on each.',
  },
  {
    t: 'Wardrobe and art direction',
    d: 'Silhouettes, fabrics, sets and props, each in its own nested cluster so each department can work in theirs.',
    prompt: 'Silhouettes, fabrics, sets and props.',
  },
  {
    t: 'Locations',
    d: 'Scout photos and found references, a cluster per setting.',
    prompt: 'Scout photos and found references, setting by setting.',
  },
  {
    t: 'Edit, music and pace',
    d: 'How it moves: reference clips as video cards, tracks as audio cards, and the rhythm you are after.',
    prompt: 'How it moves: the cut, the music and the rhythm you are after.',
  },
]);

// The page's last step is not a section of the document — it is what you do
// with the document — so it is printed on the page and never written into one.
export const TREATMENT_EXPORT_STEP = Object.freeze({
  t: 'Export and send',
  d: 'Lay the chosen images into the document, a page per section, and export a PDF from the browser’s print dialog.',
});

// The page's steps, in order.
export function treatmentPageSteps() {
  return [...TREATMENT_SECTIONS.map(({ t, d }) => ({ t, d })), { ...TREATMENT_EXPORT_STEP }];
}

const heading = (text, level = 1) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

export const STARTER_DOCS = Object.freeze({
  treatment: Object.freeze({
    title: 'Director’s treatment',
    pages: Object.freeze([
      { name: 'Cover', content: [heading('Untitled treatment'), paragraph('Director · Production company · Draft date')] },
      ...TREATMENT_SECTIONS.map((s) => ({ name: s.t, content: [heading(s.t), paragraph(s.prompt)] })),
    ]),
  }),
});

export const isStarterKind = (kind) => Object.prototype.hasOwnProperty.call(STARTER_DOCS, kind);

// Where a starter document goes on a board that already has things on it:
// beside them, top-aligned, rather than on top of the first one. A centre, as
// addStarterDoc takes it (it subtracts half the card). Null on an empty board.
export function starterDocSpot(cards, { w = 320, h = 240, gap = 80 } = {}) {
  const live = (cards || []).filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y));
  if (!live.length) return null;
  const right = Math.max(...live.map((c) => c.x + (Number.isFinite(c.w) ? c.w : 0)));
  const top = Math.min(...live.map((c) => c.y));
  return { x: right + gap + w / 2, y: top + h / 2 };
}

// [{ name, docJSON }] for writeScriptBody, or [] for a kind there is no
// document for.
export function starterDocPages(kind) {
  if (!isStarterKind(kind)) return [];
  return STARTER_DOCS[kind].pages.map((p) => ({ name: p.name, docJSON: { type: 'doc', content: p.content } }));
}
