// Doc starter templates. Each picks a Tiptap JSON document; the picker seeds
// the page tree + content via prosemirrorJSONToYXmlFragment.
//
// Templates lean toward what a film/creative studio actually writes — a
// production journal, a treatment, a shot list — instead of generic SaaS
// "meeting notes". The mini-previews in the picker reflect each layout.

const today = () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export const DOC_TEMPLATES = [
  {
    id: 'blank',
    label: 'Blank',
    blurb: 'Start from nothing.',
    swatches: [],
    pages: [{ name: 'Untitled', content: emptyDoc() }],
  },
  {
    id: 'treatment',
    label: 'Treatment',
    blurb: 'Logline, synopsis, tone, characters, structure.',
    swatches: ['#1c1c1f', '#dab277', '#7d3f3f'],
    pages: [{ name: 'Treatment', content: treatment() }],
  },
  {
    id: 'shotlist',
    label: 'Shot list',
    blurb: 'Scene-by-scene table with shot, lens, framing, notes.',
    swatches: ['#0a0a0c', '#5b5c61', '#f5f5f6'],
    pages: [{ name: 'Shot list', content: shotList() }],
  },
  {
    id: 'onepager',
    label: 'One-pager',
    blurb: 'Single-page pitch with hero quote + bullets.',
    swatches: ['#fef3c7', '#fbbf24', '#1a1300'],
    pages: [{ name: 'One-pager', content: onePager() }],
  },
  {
    id: 'journal',
    label: 'Daily journal',
    blurb: 'Date heading + open prompts. Stack one per day.',
    swatches: ['#f5f2ec', '#7c5e3a', '#1a1a1a'],
    pages: [{ name: today(), content: journal() }],
  },
  {
    id: 'production',
    label: 'Production plan',
    blurb: 'Multi-page: brief · schedule · crew · todos.',
    swatches: ['#1a3a52', '#dab277', '#ef4444', '#10b981'],
    pages: [
      { name: 'Brief',    content: prodBrief() },
      { name: 'Schedule', content: prodSchedule() },
      { name: 'Crew',     content: prodCrew() },
      { name: 'To-dos',   content: prodTodos() },
    ],
  },
  {
    id: 'moodnotes',
    label: 'Mood board notes',
    blurb: 'Reference grid · color callouts · lighting refs.',
    swatches: ['#3b3a39', '#c9a87c', '#7a7066', '#d8b9a8'],
    pages: [{ name: 'Moodboard', content: moodNotes() }],
  },
  {
    id: 'spec',
    label: 'Spec',
    blurb: 'Problem · users · scope · open questions.',
    swatches: ['#0a0a0c', '#3b82f6', '#10b981'],
    pages: [{ name: 'Spec', content: spec() }],
  },
];

// ── Tiptap JSON helpers ──────────────────────────────────────────────────────
function emptyDoc()                   { return { type: 'doc', content: [{ type: 'paragraph' }] }; }
function h(level, text)               { return { type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : [] }; }
function p(text)                      { return text == null ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text }] }; }
function pBold(text)                  { return { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text }] }; }
function pStyle(text, marks)          { return { type: 'paragraph', content: [{ type: 'text', marks, text }] }; }
function ul(items)                    { return { type: 'bulletList', content: items.map(t => ({ type: 'listItem', content: [p(t)] })) }; }
function ol(items)                    { return { type: 'orderedList', content: items.map(t => ({ type: 'listItem', content: [p(t)] })) }; }
function quote(text)                  { return { type: 'blockquote', content: [p(text)] }; }
function tasks(items) {
  return { type: 'taskList', content: items.map(t => ({
    type: 'taskItem', attrs: { checked: false }, content: [p(t)],
  })) };
}
function rule()                       { return { type: 'horizontalRule' }; }
function table(rows) {
  return {
    type: 'table',
    content: rows.map((row, i) => ({
      type: 'tableRow',
      content: row.map(cell => ({
        type: i === 0 ? 'tableHeader' : 'tableCell',
        attrs: { colspan: 1, rowspan: 1 },
        content: [p(cell)],
      })),
    })),
  };
}

// ── Templates ────────────────────────────────────────────────────────────────
function treatment() {
  return { type: 'doc', content: [
    h(1, 'Treatment'),
    pStyle(today(), [{ type: 'italic' }]),
    rule(),
    h(2, 'Logline'),
    quote('A one-sentence pitch that captures the heart of the story.'),
    h(2, 'Synopsis'),
    p('Two or three paragraphs covering setup, conflict, and resolution. Read like the back of a book — vivid, present-tense, told with the same voice the film will have.'),
    p(),
    p(),
    h(2, 'Tone & visual language'),
    ul(['Reference film 1', 'Reference film 2', 'Lighting cue', 'Color cue']),
    h(2, 'Main characters'),
    pBold('NAME'),
    p('Who they are, what they want, what stands in the way.'),
    pBold('NAME'),
    p('Same.'),
    h(2, 'Structure'),
    ol(['Act I — setup',
        'Act II — confrontation',
        'Act III — resolution']),
  ]};
}

function shotList() {
  return { type: 'doc', content: [
    h(1, 'Shot list'),
    pStyle(today() + ' · Director · DP', [{ type: 'italic' }]),
    rule(),
    h(3, 'Scene 1 — INT. KITCHEN — MORNING'),
    table([
      ['#',  'Shot',         'Lens', 'Framing',     'Movement', 'Notes'],
      ['1A', 'Master',       '35mm', 'WS',          'Locked',   'Establish'],
      ['1B', 'Coverage',     '50mm', 'MCU',         'Push in',  'On the line'],
      ['1C', 'Insert',       '85mm', 'ECU',         'Locked',   'Hands on cup'],
    ]),
    p(),
    h(3, 'Scene 2 — EXT. PORCH — GOLDEN HOUR'),
    table([
      ['#',  'Shot',     'Lens',  'Framing', 'Movement', 'Notes'],
      ['2A', 'Two-shot', '35mm',  'MS',      'Slow dolly out', '—'],
      ['2B', 'OTS',      '50mm',  'MS',      'Locked', 'Each side'],
    ]),
  ]};
}

function onePager() {
  return { type: 'doc', content: [
    h(1, 'One-pager'),
    quote('A single line that lands the whole project — quoted, bold, hard to forget.'),
    rule(),
    h(3, 'What it is'),
    p('Two sentences. No fluff.'),
    h(3, 'Who it is for'),
    p('One sentence about the audience.'),
    h(3, 'Why now'),
    p('One sentence about the moment.'),
    h(3, 'Why us'),
    ul(['Edge 1', 'Edge 2', 'Edge 3']),
    h(3, 'Ask'),
    p('What the reader should do next.'),
  ]};
}

function journal() {
  return { type: 'doc', content: [
    h(1, today()),
    rule(),
    pBold('What I made today'),
    p(),
    pBold('What I noticed'),
    p(),
    pBold('Three things I want to remember'),
    ul(['', '', '']),
    pBold('Tomorrow'),
    tasks(['']),
  ]};
}

function prodBrief() {
  return { type: 'doc', content: [
    h(1, 'Production brief'),
    pStyle('Working title · client · format · runtime', [{ type: 'italic' }]),
    rule(),
    h(2, 'Brief'),
    p('Three sentences on what we are making and why.'),
    h(2, 'Audience'),
    p('Who watches this and where.'),
    h(2, 'Deliverables'),
    ul(['Master file specs', 'Cutdowns', 'Stills', 'Behind-the-scenes']),
    h(2, 'Constraints'),
    ul(['Budget', 'Timeline', 'Locations', 'Talent']),
  ]};
}
function prodSchedule() {
  return { type: 'doc', content: [
    h(1, 'Schedule'),
    table([
      ['Phase',       'Dates',     'Milestone'],
      ['Pre-pro',     '—',         'Locations + casting'],
      ['Production',  '—',         'Principal photography'],
      ['Post',        '—',         'Picture lock + deliverables'],
    ]),
  ]};
}
function prodCrew() {
  return { type: 'doc', content: [
    h(1, 'Crew'),
    table([
      ['Role',           'Name', 'Contact', 'Days'],
      ['Director',       '',     '',        ''],
      ['DP',             '',     '',        ''],
      ['1st AC',         '',     '',        ''],
      ['Sound mixer',    '',     '',        ''],
      ['Production designer', '', '',       ''],
    ]),
  ]};
}
function prodTodos() {
  return { type: 'doc', content: [
    h(1, 'To-dos'),
    h(3, 'This week'), tasks(['Lock script', 'Confirm locations', 'Cast principals']),
    h(3, 'Backlog'),    tasks(['Prep call sheet', 'Insurance', 'Music clearances']),
  ]};
}

function moodNotes() {
  return { type: 'doc', content: [
    h(1, 'Moodboard notes'),
    pStyle('What this lookbook is reaching for.', [{ type: 'italic' }]),
    rule(),
    h(3, 'Color'),
    ul(['Warm earth tones', 'Single accent: terracotta', 'Cool neutrals in shadow']),
    h(3, 'Light'),
    ul(['Practicals only after dusk', 'Soft sunlight through linen', 'No hard fill']),
    h(3, 'Texture'),
    ul(['Linen', 'Aged plaster', 'Matte ceramic']),
    h(3, 'References'),
    p('Drag images here, or use the slash menu → Image.'),
  ]};
}

function spec() {
  return { type: 'doc', content: [
    h(1, 'Spec'),
    h(2, 'Problem'), p('What user problem is this solving?'),
    h(2, 'Users'), p('Who experiences the problem most acutely?'),
    h(2, 'Scope'), ul(['In: …', 'Out: …']),
    h(2, 'Design notes'), p('Sketches, references, decisions.'),
    h(2, 'Open questions'), ul(['…']),
  ]};
}
