// data.js — unified model: everything is a board.
// Each board has:
//   id, kind: 'board', name, meta?, members?, cover?
//   view: 'canvas' | 'list'
//   cards: [...]              positioned items inside the board
//   arrows: [...]             within-board connections
//   links: [boardId, ...]     cross-board references shown as link cards
// Inside cards[], a 'board' card is a sub-board reference (positioned tile).

export const TEAMMATES = [
  { id: 't1', name: 'Mira Okafor',    role: 'Director',          color: '#6366f1' },
  { id: 't2', name: 'Daniel Reyes',   role: 'DP',                color: '#0ea5e9' },
  { id: 't3', name: 'Astrid Lindh',   role: 'Production Design', color: '#f97316' },
  { id: 't4', name: 'Jules Bremer',   role: 'Producer',          color: '#10b981' },
  { id: 't5', name: 'Hana Park',      role: 'Costume',           color: '#ec4899' },
  { id: 't6', name: 'Theo Marchetti', role: '1st AD',            color: '#eab308' },
  { id: 't7', name: 'Rumi Sato',      role: 'Editor',            color: '#8b5cf6' },
  { id: 't8', name: 'Owen Calder',    role: 'Sound',             color: '#14b8a6' },
];

export const BOARDS = {
  // ── Root ────────────────────────────────────────────────────────────────
  'root': {
    id: 'root', kind: 'board', name: 'Studio',
    view: 'canvas',
    cards: [
      { id: 'b-features', kind: 'board', x: 60,  y: 80,  w: 280, h: 320 },
      { id: 'b-shorts',   kind: 'board', x: 360, y: 80,  w: 280, h: 290 },
      { id: 'b-stills',   kind: 'board', x: 660, y: 80,  w: 280, h: 260 },
      { id: 'b-sundown',  kind: 'board', x: 60,  y: 440, w: 280, h: 200 },
      { id: 'b-halcyon',  kind: 'board', x: 360, y: 410, w: 280, h: 200 },
      { id: 'home-note',  kind: 'note',  x: 660, y: 380, w: 240, h: 180,
        body: 'Studio inbox\n\nDrop projects here. Switch a board to list view to use it as a bucket.' },
      { id: 'home-link',  kind: 'link',  x: 60,  y: 670, w: 280, h: 110,
        title: 'Q4 production calendar', source: 'docs.soleil' },
      { id: 'home-pal',   kind: 'palette', x: 360, y: 640, w: 280, h: 110, title: 'House palette',
        swatches: [
          { name: 'Ink',    hex: '#0a0a0c' },
          { name: 'Stone',  hex: '#525258' },
          { name: 'Paper',  hex: '#f5f5f5' },
          { name: 'Signal', hex: '#3b82f6' },
          { name: 'Warn',   hex: '#f59e0b' },
        ]},
      { id: 'home-image', kind: 'image', x: 660, y: 600, w: 240, h: 200, tone: 'neutral', label: 'PINNED · KEY ART REF' },
    ],
    arrows: [],
    links: [],
  },

  // ── Buckets — list view ──────────────────────────────────────────────────
  'b-features': {
    id: 'b-features', kind: 'board', name: 'Features',
    meta: '3 projects', view: 'list',
    cards: [
      { id: 'b-sundown',    kind: 'board', x: 80,  y: 80, w: 280, h: 200 },
      { id: 'b-northwind',  kind: 'board', x: 400, y: 80, w: 280, h: 200 },
      { id: 'b-glasshouse', kind: 'board', x: 720, y: 80, w: 280, h: 200 },
    ],
    arrows: [], links: [],
  },
  'b-shorts': {
    id: 'b-shorts', kind: 'board', name: 'Shorts & spec',
    meta: '2 projects', view: 'list',
    cards: [
      { id: 'b-halcyon', kind: 'board', x: 80,  y: 80, w: 280, h: 200 },
      { id: 'b-pomelo',  kind: 'board', x: 400, y: 80, w: 280, h: 200 },
    ],
    arrows: [], links: [],
  },
  'b-stills': {
    id: 'b-stills', kind: 'board', name: 'Stills',
    meta: '1 project', view: 'list',
    cards: [
      { id: 'b-fieldnotes', kind: 'board', x: 80, y: 80, w: 280, h: 200 },
    ],
    arrows: [], links: [],
  },

  // ── Sundown Highway ──────────────────────────────────────────────────────
  'b-sundown': {
    id: 'b-sundown', kind: 'board', name: 'Sundown Highway',
    meta: 'Feature · Dir. Mira Okafor', members: ['t1','t2','t3','t4','t6'], cover: 'sun',
    view: 'canvas',
    cards: [
      { id: 'sb-tone',   kind: 'board', x: 60,  y: 80, w: 280, h: 290 },
      { id: 'sb-cast',   kind: 'board', x: 360, y: 80, w: 280, h: 260 },
      { id: 'sb-locs',   kind: 'board', x: 660, y: 80, w: 280, h: 290 },
      { id: 'sb-act1',   kind: 'board', x: 60,  y: 410, w: 240, h: 180 },
      { id: 'sb-act2',   kind: 'board', x: 320, y: 410, w: 240, h: 180 },

      { id: 's-img1',    kind: 'image', x: 80,  y: 500, w: 320, h: 200, tone: 'sun',  label: 'REF · GOLDEN HOUR ASPHALT', caption: 'Dust + low sun' },
      { id: 's-img2',    kind: 'image', x: 440, y: 500, w: 240, h: 200, tone: 'sand', label: 'REF · SALT FLATS' },
      { id: 's-img3',    kind: 'image', x: 720, y: 500, w: 280, h: 200, tone: 'dusk', label: 'REF · NEON MOTEL', caption: 'practical sodium' },
      { id: 's-pal',     kind: 'palette', x: 80, y: 740, w: 320, h: 110, title: 'Act I',
        swatches: [
          { name: 'Bleach', hex: '#E8D9B8' },
          { name: 'Rust',   hex: '#C26A3A' },
          { name: 'Ink',    hex: '#2D2A26' },
          { name: 'Sodium', hex: '#F4A14A' },
          { name: 'Dusk',   hex: '#5C3E5E' },
        ]},
      { id: 's-doc',     kind: 'doc', x: 440, y: 740, w: 280, h: 280, title: 'Treatment v4', author: 'Mira O.', date: 'today',
        lines: [
          { h: 1, text: 'Sundown Highway' },
          { h: 3, text: 'Tone' },
          { bullet: true, text: 'Warm, slow, slightly faded' },
          { bullet: true, text: 'Practical light only' },
          { h: 3, text: 'Rules' },
          { bullet: true, text: 'No handheld unless in vehicle' },
          { bullet: true, text: '35mm; 1.85:1' },
        ]},
      { id: 's-sched',   kind: 'schedule', x: 740, y: 740, w: 320, h: 200, title: '6-day shoot · v3',
        rows: [
          { day: 'D1', what: 'Diner — int + ext',   loc: 'LOC-02' },
          { day: 'D2', what: 'Motel — neon, night', loc: 'LOC-03' },
          { day: 'D3', what: 'White Sands',         loc: 'LOC-01' },
          { day: 'D4', what: 'Highway driving',     loc: 'TBD'    },
        ]},

      { id: 's-xlink-1', kind: 'boardlink', target: 'b-fieldnotes', x: 1080, y: 300, w: 220, h: 160,
        note: 'Same desert location' },
    ],
    arrows: [
      { from: 's-img1', to: 's-pal',  label: 'palette pulled from' },
      { from: 's-img3', to: 's-pal',  label: '', dashed: true },
    ],
    links: ['b-halcyon', 'b-fieldnotes'],
  },

  // ── Other project boards ─────────────────────────────────────────────────
  'b-halcyon':    { id: 'b-halcyon',    kind: 'board', name: 'Halcyon',         meta: 'Music video · 4:12', members: ['t1','t2','t5','t7','t8'], cover: 'dusk',    view: 'canvas', cards: [], arrows: [], links: [] },
  'b-northwind':  { id: 'b-northwind',  kind: 'board', name: 'Northwind',       meta: 'Documentary short',  members: ['t2','t4','t6','t8'],      cover: 'cool',    view: 'canvas', cards: [], arrows: [], links: [] },
  'b-glasshouse': { id: 'b-glasshouse', kind: 'board', name: 'Glasshouse',      meta: 'Brand spot · 60s',   members: ['t1','t3','t5','t7'],      cover: 'neutral', view: 'canvas', cards: [], arrows: [], links: [] },
  'b-pomelo':     { id: 'b-pomelo',     kind: 'board', name: 'Pomelo & Co.',    meta: 'Brand film · 90s',   members: ['t1','t3','t4','t7'],      cover: 'sun',     view: 'canvas', cards: [], arrows: [], links: [] },
  'b-fieldnotes': { id: 'b-fieldnotes', kind: 'board', name: 'Field Notes III', meta: 'Photo series',       members: ['t2','t5','t6'],           cover: 'sand',    view: 'canvas', cards: [], arrows: [], links: ['b-sundown'] },

  // Sub-boards inside Sundown Highway
  'sb-tone': { id: 'sb-tone', kind: 'board', name: 'Tone & Palette', view: 'list',
    cards: [
      { id: 'sb-tone-act1', kind: 'board' },
      { id: 'sb-tone-act2', kind: 'board' },
      { id: 'sb-tone-act3', kind: 'board' },
    ], arrows: [], links: [] },
  'sb-cast': { id: 'sb-cast', kind: 'board', name: 'Cast', view: 'list',
    cards: [
      { id: 'sb-cast-leads',   kind: 'board' },
      { id: 'sb-cast-support', kind: 'board' },
    ], arrows: [], links: [] },
  'sb-locs': { id: 'sb-locs', kind: 'board', name: 'Locations', view: 'list',
    cards: [
      { id: 'sb-locs-desert', kind: 'board' },
      { id: 'sb-locs-motel',  kind: 'board' },
      { id: 'sb-locs-coast',  kind: 'board' },
    ], arrows: [], links: [] },

  'sb-tone-act1':    { id: 'sb-tone-act1',    kind: 'board', name: 'Act I — Bleached gold',     view: 'canvas', cover: 'sun',     cards: [], arrows: [], links: [] },
  'sb-tone-act2':    { id: 'sb-tone-act2',    kind: 'board', name: 'Act II — Sodium dusk',     view: 'canvas', cover: 'dusk',    cards: [], arrows: [], links: [] },
  'sb-tone-act3':    { id: 'sb-tone-act3',    kind: 'board', name: 'Act III — Cold dawn',      view: 'canvas', cover: 'cool',    cards: [], arrows: [], links: [] },
  'sb-cast-leads':   { id: 'sb-cast-leads',   kind: 'board', name: 'Leads',                    view: 'canvas', cover: 'sand',    cards: [], arrows: [], links: [] },
  'sb-cast-support': { id: 'sb-cast-support', kind: 'board', name: 'Supporting',               view: 'canvas', cover: 'neutral', cards: [], arrows: [], links: [] },
  'sb-locs-desert':  { id: 'sb-locs-desert',  kind: 'board', name: 'Mojave + salt flats',      view: 'canvas', cover: 'sand',    cards: [], arrows: [], links: [] },
  'sb-locs-motel':   { id: 'sb-locs-motel',   kind: 'board', name: 'Sunset Motel exteriors',   view: 'canvas', cover: 'dusk',    cards: [], arrows: [], links: [] },
  'sb-locs-coast':   { id: 'sb-locs-coast',   kind: 'board', name: 'Pacific coast — final',    view: 'canvas', cover: 'sea',     cards: [], arrows: [], links: [] },
  'sb-act1': { id: 'sb-act1', kind: 'board', name: 'Act I — Desert', meta: '14 cards', members: ['t1','t2'], cover: 'sun',  view: 'canvas', cards: [], arrows: [], links: [] },
  'sb-act2': { id: 'sb-act2', kind: 'board', name: 'Act II — Motel', meta: '21 cards', members: ['t1','t3'], cover: 'dusk', view: 'canvas', cards: [], arrows: [], links: [] },
};

export const ROOT_BOARD = BOARDS['root'];

export const INBOX_SEED = [
  { id: 'i-01', kind: 'image', from: 'Daniel Reyes',  source: 'iMessage',  when: 'just now',
    tone: 'sun',     label: 'IMG_4429.heic',
    caption: 'shot from the canyon scout this morning' },
  { id: 'i-02', kind: 'link',  from: 'Astrid Lindh',  source: 'Slack',     when: '4m',
    title: 'Roger Deakins — On Light, Not Lighting',
    url: 'youtube.com/watch?v=…' },
  { id: 'i-03', kind: 'image', from: 'Mira Okafor',   source: 'iMessage',  when: '12m',
    tone: 'dusk',    label: 'sunset_motel_ref.png' },
  { id: 'i-04', kind: 'note',  from: 'You',           source: 'Quick note',when: '38m',
    body: 'Casting brief — push back on lead\'s look. Less polished, more sun-damaged.' },
  { id: 'i-05', kind: 'image', from: 'Theo Park',     source: 'Drive',     when: '1h',
    tone: 'sand',    label: 'salt_flats_drone.jpg' },
  { id: 'i-06', kind: 'link',  from: 'Astrid Lindh',  source: 'Email',     when: '1h',
    title: 'Vendor quote — Panavision DXL2 + anamorphic set',
    url: 'mail · vendors/panavision' },
  { id: 'i-07', kind: 'image', from: 'Daniel Reyes',  source: 'iMessage',  when: '2h',
    tone: 'cool',    label: 'morning_pacific.jpg' },
  { id: 'i-08', kind: 'doc',   from: 'Jules Bonin',   source: 'Drive',     when: '2h',
    title: 'Sundown — script v0.7 notes',
    lines: [
      { kind: 'h', text: 'Sundown Highway — script notes v0.7' },
      { kind: 'p', text: 'Tightened Act II to 24p. Diner sequence merged.' },
      { kind: 'p', text: 'Coast finale runtime now ~6m, was 9.' },
    ],
    author: 'Jules Bonin', date: 'Today' },
  { id: 'i-09', kind: 'image', from: 'Sana Ahmed',    source: 'AirDrop',   when: '3h',
    tone: 'warm',    label: 'wardrobe_swatches.jpg' },
  { id: 'i-10', kind: 'link',  from: 'You',           source: 'Pinned',    when: '4h',
    title: 'Kodak 250D — color science notes',
    url: 'docs.soleil/kodak-250d' },
  { id: 'i-11', kind: 'image', from: 'Theo Park',     source: 'Drive',     when: 'yesterday',
    tone: 'sea',     label: 'pacific_dailies_03.jpg' },
  { id: 'i-12', kind: 'note',  from: 'Mira Okafor',   source: 'Quick note',when: 'yesterday',
    body: 'Reminder: confirm permits for Mojave 11/14–11/18.' },
  { id: 'i-13', kind: 'image', from: 'Daniel Reyes',  source: 'iMessage',  when: 'yesterday',
    tone: 'neutral', label: 'lens_test_anam_01.jpg' },
  { id: 'i-14', kind: 'link',  from: 'Astrid Lindh',  source: 'Slack',     when: '2d',
    title: 'Insurance — short-term equipment rider',
    url: 'tally.so/r/equip-rider' },
  { id: 'i-15', kind: 'image', from: 'Sana Ahmed',    source: 'AirDrop',   when: '2d',
    tone: 'sand',    label: 'location_motel_ext.jpg' },
];
