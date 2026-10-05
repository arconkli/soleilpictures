// starterSections — what a director's treatment holds, as the page prints it
// and the starter document is written from (starterDocs.js).
//
// Its own module, with no imports, because the PUBLIC landing pages read it
// (seoLanding.js → treatmentPageSteps; starterIntent.js → isStarterKind), and
// those pages must not pull the Yjs document machinery into their bundle.

// The kinds of starter document there are.
export const STARTER_KINDS = Object.freeze(['treatment']);
export const isStarterKind = (kind) => STARTER_KINDS.includes(kind);

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
