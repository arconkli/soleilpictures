// subjects.mjs — what the boards engine makes boards about.
//
// PAGES: one brief per search page that shows an example board (the owner,
// 2026-10-29, #87: "each page gets a board on its own subject"). The page's
// board is made to that brief and placed on the page by hand, in a batch,
// through a normal land (scripts/engine/README in scripts/README.md).
//
// MARKETING: the daily rotation (#70: about one board a day), leaning toward
// film and creative work. A day takes the next subject in turn; the recipe
// step invents the particular board inside it, so the same subject comes back
// as a different board.
//
// cluster: the Showcase cluster the board goes in (made under Studio when it's
// missing). look: the board's light; the shots come in both themes anyway.
// wants: card kinds the board must hold beyond pictures, notes and a palette.

export const PAGES = [
  { page: '/tools/free-mood-board-maker', cluster: 'Interiors', subject: 'interiors',
    brief: 'An interior designer\'s mood board for a warm Mediterranean kitchen: limewash walls, terracotta tile, olive wood, linen, brass, morning light. Materials, finishes, a palette, and short notes to the client.' },
  { page: '/tools/ai-mood-board-maker', cluster: 'Fashion', subject: 'fashion',
    brief: 'A fashion stylist\'s mood board for an autumn knitwear campaign shot on a windswept coast: textures, styling, locations, light, a palette, and notes for the shoot.' },
  { page: '/tools/storyboard-maker', cluster: 'Film', subject: 'storyboard',
    brief: 'A storyboard for the opening of a short film: a cyclist crossing a city at dawn, told in numbered frames (wide, medium, close, insert), each picture captioned with its shot and action, plus the scene\'s notes.',
    wants: ['frames'] },
  { page: '/tools/look-book-maker', cluster: 'Film', subject: 'look-book',
    brief: 'A director\'s look book for an indie road movie across the American desert: tone, light, locations, wardrobe, references, a palette, and the director\'s words on the feel.' },
  { page: '/tools/video-reference-board', cluster: 'Music video', subject: 'music-video',
    brief: 'A reference board for a music video set in a neon roller rink: motion references as video clips, lighting, wardrobe, choreography notes, a palette.',
    wants: ['video'] },
  { page: '/tools/shared-reference-board', cluster: 'Concept art', subject: 'concept-art',
    brief: 'A game studio art team\'s shared environment reference for a flooded coastal city: architecture, water, weathering, light, scale, with notes from the art director to the team.' },
  { page: '/tools/directors-treatment', cluster: 'Film', subject: 'treatment',
    brief: 'A director\'s treatment for a short drama about a lighthouse keeper\'s last winter: logline, tone, visual approach, casting, locations, sound, and a short script excerpt.',
    wants: ['script'] },
  { page: '/tools/production-design-mood-board', cluster: 'Production design', subject: 'production-design',
    brief: 'A production designer\'s board for a 1970s newsroom set: architecture, desks and props, signage, wall colours, light sources, a palette, and build notes.' },
  { page: '/tools/costume-design-mood-board', cluster: 'Costume', subject: 'costume',
    brief: 'A costume designer\'s board for a contemporary drama set in a working harbour town in winter: silhouettes, fabrics, textures, accessories, character notes, a palette.' },
  { page: '/tools/cinematography-lookbook', cluster: 'Cinematography', subject: 'cinematography',
    brief: 'A cinematographer\'s lookbook for a winter thriller: cold practical light, framing, lenses, colour, night exteriors, references, and notes on the camera language.' },
  { page: '/vs/milanote', cluster: 'Film', subject: 'pre-production',
    brief: 'A short film\'s pre-production board kept by the producer: locations to scout, casting references, the look, props, and the week\'s to-dos.' },
  { page: '/vs/storyflow', cluster: 'Commercial', subject: 'commercial',
    brief: 'A crew\'s board for a one-day commercial shoot for a cycling brand: the shoot day plan, references, locations, wardrobe, gear notes.' },
  { page: '/vs/eagle', cluster: 'Branding', subject: 'brand-photography',
    brief: 'A brand photography reference library for a small coffee roaster: product, process, people, place, light, colour, with art direction notes.' },
  { page: '/vs/google-drive', cluster: 'Documentary', subject: 'documentary',
    brief: 'A documentary project board about a fishing town\'s last cannery: interview subjects, archive references, locations, visual approach, and research notes.' },
  { page: '/vs/miro', cluster: 'Film', subject: 'horror-short',
    brief: 'A horror short\'s pre-production board: the farmhouse location, creature and practical effects references, lighting, sound ideas, and the shoot plan.' },
  { page: '/use-cases', cluster: 'Photography', subject: 'photo-series',
    brief: 'A photographer\'s plan for a travel photo series on Kyoto in autumn: places, times of day, subjects, compositions, a palette, and a shot list in notes.' },
  { page: '/best/milanote-alternatives', cluster: 'Writing', subject: 'world-building',
    brief: 'A novelist\'s world-building board for a story set on a remote northern island: places, people, weather, objects, and notes on the plot and the island\'s history.' },
  { page: '/best/mood-board-apps', cluster: 'Interiors', subject: 'hospitality',
    brief: 'A mood board for a boutique hotel in Lisbon: lobby, rooms, materials, tiles, lighting, signage, a palette, and notes for the architect.' },
  { page: '/best/storyboard-software', cluster: 'Film', subject: 'storyboard',
    brief: 'A storyboard for a chase through a night market: numbered frames from wide to close, each picture captioned with shot size and action, plus the sequence\'s notes.',
    wants: ['frames'] },
];

// The pages that keep their boards until their read (#86 A): given engine
// boards after 2026-11-19. Never made for by --page until then.
export const LATER_PAGES = [
  '/vs/pureref', '/tools/reference-board-maker', '/tools/shot-list-maker',
  '/tools/mood-board-maker', '/best/pureref-alternatives',
];

// The daily rotation: film and creative work first.
export const MARKETING = [
  { cluster: 'Film', subject: 'look-book', brief: 'A director\'s look book for a feature film. Pick a fresh genre, era and place.' },
  { cluster: 'Costume', subject: 'costume', brief: 'A costume designer\'s board for a film or stage production. Pick a fresh present-day world and characters that stock photos can show.' },
  { cluster: 'Music video', subject: 'music-video', brief: 'A reference board for a music video. Pick a fresh song mood and setting.' },
  { cluster: 'Production design', subject: 'production-design', brief: 'A production designer\'s set board. Pick a fresh setting and era.' },
  { cluster: 'Cinematography', subject: 'cinematography', brief: 'A cinematographer\'s lookbook. Pick a fresh story, light and season.' },
  { cluster: 'Film', subject: 'pre-production', brief: 'A short film\'s pre-production board kept by its producer. Pick a fresh story.' },
  { cluster: 'Fashion', subject: 'fashion', brief: 'A fashion editorial or campaign mood board. Pick a fresh season, place and story.' },
  { cluster: 'Photography', subject: 'photo-series', brief: 'A photographer\'s plan for a photo series. Pick a fresh place and theme.' },
  { cluster: 'Concept art', subject: 'concept-art', brief: 'An art team\'s environment reference for a game or animated film. Pick a fresh world.' },
  { cluster: 'Commercial', subject: 'commercial', brief: 'A crew\'s board for a commercial shoot. Pick a fresh product and setting.' },
  { cluster: 'Documentary', subject: 'documentary', brief: 'A documentary project board. Pick a fresh subject and place.' },
  { cluster: 'Interiors', subject: 'interiors', brief: 'An interior designer\'s mood board for one room. Pick a fresh style and place.' },
  { cluster: 'Weddings', subject: 'wedding', brief: 'A wedding planner\'s mood board. Pick a fresh season, place and palette.' },
  { cluster: 'Writing', subject: 'world-building', brief: 'A writer\'s world-building board for a novel or series. Pick a fresh world.' },
  { cluster: 'Film', subject: 'storyboard', brief: 'A storyboard for one scene of a short film, told in numbered frames. Pick a fresh scene.', wants: ['frames'] },
  { cluster: 'Branding', subject: 'brand-photography', brief: 'A brand photography and art direction board for a small business. Pick a fresh business.' },
];

export const pageBrief = (path) => PAGES.find((p) => p.page === path) || null;

// The day's marketing subject: the one in the rotation least recently made.
// `made` is [{ subject, made_at }] for the library's marketing boards.
export function nextMarketing(made = []) {
  const last = new Map();
  for (const m of made) {
    const t = Date.parse(m.made_at) || 0;
    if (t > (last.get(m.subject) || -1)) last.set(m.subject, t);
  }
  let best = MARKETING[0];
  let bestAt = Infinity;
  for (const s of MARKETING) {
    const t = last.has(s.subject) ? last.get(s.subject) : -1;
    if (t < bestAt) { best = s; bestAt = t; }
  }
  return best;
}
