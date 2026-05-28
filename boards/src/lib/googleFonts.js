// Curated catalog of popular Google Fonts. Each entry is just a family name
// (the CSS family is `'Name', fallback`); the picker auto-injects a Google
// Fonts <link> on first selection so users don't need to add anything.

export const GOOGLE_FONT_CATEGORIES = [
  {
    label: 'Sans',
    fonts: [
      'Inter', 'Manrope', 'DM Sans', 'IBM Plex Sans', 'Plus Jakarta Sans',
      'Work Sans', 'Mulish', 'Nunito', 'Nunito Sans', 'Poppins',
      'Open Sans', 'Roboto', 'Lato', 'Montserrat', 'Source Sans 3',
      'Karla', 'Outfit', 'Geist', 'Sora', 'Hanken Grotesk',
    ],
  },
  {
    label: 'Serif',
    fonts: [
      'Playfair Display', 'Lora', 'Merriweather', 'EB Garamond',
      'Cormorant Garamond', 'Crimson Pro', 'Source Serif 4',
      'Libre Caslon Text', 'Libre Baskerville', 'Bitter',
      'Roboto Serif', 'PT Serif', 'Spectral', 'Newsreader',
      'DM Serif Display', 'DM Serif Text', 'Fraunces', 'Lusitana',
      'Vollkorn', 'Cardo',
    ],
  },
  {
    label: 'Mono',
    fonts: [
      'JetBrains Mono', 'IBM Plex Mono', 'Geist Mono', 'Fira Code',
      'Source Code Pro', 'Roboto Mono', 'Space Mono', 'Inconsolata',
      'DM Mono', 'Ubuntu Mono',
    ],
  },
  {
    label: 'Display',
    fonts: [
      'Bebas Neue', 'Anton', 'Archivo Black', 'Pacifico',
      'Caveat', 'Dancing Script', 'Lobster', 'Permanent Marker',
      'Righteous', 'Bungee', 'Abril Fatface', 'Ultra',
      'Cinzel', 'Marcellus', 'Italiana', 'Forum',
    ],
  },
  {
    label: 'Hand / Script',
    fonts: [
      'Kalam', 'Indie Flower', 'Patrick Hand', 'Shadows Into Light',
      'Reenie Beanie', 'Architects Daughter', 'Homemade Apple',
      'Sacramento', 'Great Vibes', 'Allura',
    ],
  },
];

// Flat list for search.
export const GOOGLE_FONT_LIST = GOOGLE_FONT_CATEGORIES.flatMap(cat =>
  cat.fonts.map(name => ({ name, category: cat.label }))
);

// Best-guess fallback per category so unloaded fonts still render readably.
function fallbackFor(category) {
  switch (category) {
    case 'Serif':         return 'Georgia, serif';
    case 'Mono':          return 'ui-monospace, monospace';
    case 'Display':
    case 'Hand / Script': return 'Georgia, serif';
    default:              return 'system-ui, sans-serif';
  }
}

export function googleFontCss(name, category) {
  return `'${name}', ${fallbackFor(category)}`;
}

// Lazy injector. Each font gets its own <link rel="stylesheet"> appended to
// <head> on first request; subsequent calls are no-ops. Loads weights 400 +
// 600 + 700 italics so we cover the editor's common needs.
const injected = new Set();
export function ensureGoogleFontLoaded(name) {
  if (typeof document === 'undefined') return;
  if (!name || injected.has(name)) return;
  injected.add(name);
  const family = name.trim().replace(/\s+/g, '+');
  const href = `https://fonts.googleapis.com/css2?family=${family}:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.googleFont = name;
  document.head.appendChild(link);
}

// Lookup set for fast "is this a known Google catalog font?" checks.
const GOOGLE_FONT_NAMES = new Set(GOOGLE_FONT_LIST.map(f => f.name.toLowerCase()));

// Strip the primary family name out of a CSS `font-family` value:
//   "'Playfair Display', Georgia, serif" → "Playfair Display"
//   '"Inter", sans-serif'                → "Inter"
//   Roboto                               → "Roboto"
function primaryFamilyName(cssValue) {
  if (!cssValue) return '';
  const first = String(cssValue).split(',')[0].trim();
  return first.replace(/^["']|["']$/g, '').trim();
}

// Walk saved HTML for inline font-family declarations and inject the Google
// stylesheet for each one that matches a name in the catalog. Without this,
// notes/docs saved with a Google font render in the fallback after a cold
// reload (the <link> is only added the first time the user picks the font
// via the toolbar). Cheap: parses into a detached <template>, runs once
// per content payload.
export function ensureFontsFromHtml(html) {
  if (typeof document === 'undefined' || !html) return;
  let tpl;
  try {
    tpl = document.createElement('template');
    tpl.innerHTML = String(html);
  } catch (_) { return; }
  const root = tpl.content;
  // Inline `style="font-family: ..."`
  root.querySelectorAll('[style*="font-family"]').forEach(el => {
    const name = primaryFamilyName(el.style?.fontFamily);
    if (name && GOOGLE_FONT_NAMES.has(name.toLowerCase())) ensureGoogleFontLoaded(name);
  });
  // Legacy <font face="..."> just in case.
  root.querySelectorAll('font[face]').forEach(el => {
    const name = primaryFamilyName(el.getAttribute('face'));
    if (name && GOOGLE_FONT_NAMES.has(name.toLowerCase())) ensureGoogleFontLoaded(name);
  });
}

// Pre-load every Google catalog font the user has used recently. Called once
// at app start so the corresponding stylesheets are in <head> before any
// note/doc renders. Complements ensureFontsFromHtml — recent-fonts covers
// the case where the user previously used a font but no note on the current
// board references it yet; ensureFontsFromHtml covers the per-content path.
export function preloadRecentGoogleFonts(recents) {
  if (!Array.isArray(recents)) return;
  for (const f of recents) {
    if (f?.gfName) ensureGoogleFontLoaded(f.gfName);
  }
}

// Build the "all fonts" list — merges built-in, Google catalog, and the
// user's custom fonts into a single alphabetized array. Each entry is
// `{ key, label, css, gfName? }` ready for a picker dropdown.
export function combineAllFonts(builtIn = [], customFonts = []) {
  const out = [];
  for (const f of builtIn) {
    out.push({ key: 'b:' + f.id, label: f.label || f.name, css: f.css, gfName: null });
  }
  for (const cat of GOOGLE_FONT_CATEGORIES) {
    for (const name of cat.fonts) {
      out.push({ key: 'g:' + name, label: name, css: googleFontCss(name, cat.label), gfName: name });
    }
  }
  for (const f of customFonts) {
    out.push({ key: 'c:' + f.id, label: f.name, css: f.css, gfName: f.source?.kind === 'google' ? (f.source.value || f.name) : null });
  }
  // De-dupe by label (built-in Sans wins over a Google Sans of same name).
  const seen = new Set();
  const dedup = out.filter(f => {
    const k = f.label.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  dedup.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return dedup;
}
