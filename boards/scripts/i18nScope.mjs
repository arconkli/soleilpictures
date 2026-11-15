// What "the translated app" is, and the shared rules for deciding which strings
// are text a person reads. Used by scripts/i18nWrap.mjs (the codemod that wraps
// English in the Lingui macros) and scripts/i18nCoverage.mjs (the guard that
// keeps wrapped files wrapped). The two walkers are written separately on
// purpose, so they check each other; they share only this file's lists.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse } from '@babel/parser';

export const BOARDS = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
export const SRC = join(BOARDS, 'src');

// Files whose own subgraph is outside the translated app: the English-only
// public site, the admin console, the admin-only Settings tabs and Surface
// Gallery, and the dev harnesses. The walk never enters one.
export const STOP_ENTRIES = [
  'src/local/',
  'src/pages/admin/',
  'src/pages/AdminPage.jsx',
  'src/components/PublicBoardView.jsx',
  'src/pages/ExplorePage.jsx',
  'src/auth/LegalPage.jsx',
  'src/auth/TalkToUsPage.jsx',
  'src/pages/SeoLandingPage.jsx',
  'src/pages/ScoutPage.jsx',
  'src/pages/SeoListiclePage.jsx',
  'src/pages/DocsPage.jsx',
  'src/pages/ChangelogPage.jsx',
  // Admin-only, found by reading SettingsPanel.jsx (ADMIN_TABS, rendered only
  // when isAdmin) and App.jsx (the lazy SurfaceGallery, opened from the Gallery
  // tab): no signed-in non-admin can reach them.
  'src/components/settings/CaptureTab.jsx',
  'src/components/settings/GalleryTab.jsx',
  'src/components/settings/SecurityTab.jsx',
  'src/components/settings/PreviewTab.jsx',
  'src/components/gallery/SurfaceGallery.jsx',
  // Its only importers outside src/local, CanvasSurface and ListSurface, take
  // just TEAMMATES (people's names, not UI text).
  'src/data.js',
];

const stopAbs = STOP_ENTRIES.map((p) => join(BOARDS, p));
export function isStop(file) {
  return stopAbs.some((s) => (s.endsWith('/') ? file.startsWith(s) : file === s));
}

const EXTS = ['.js', '.mjs', '.jsx', '.ts', '.tsx'];
const isFile = (f) => existsSync(f) && statSync(f).isFile();

// A relative specifier, resolved as the i18nGuard test's lingui() does: exact,
// then an extension, then index.js / index.ts.
export function resolveSpecifier(from, spec) {
  const base = resolve(dirname(from), spec);
  return [base, ...EXTS.map((e) => base + e), ...['.js', '.ts'].map((e) => join(base, 'index' + e))].find(isFile) || null;
}

function parseFile(file, source) {
  const ts = /\.tsx?$/.test(file);
  try {
    return parse(source, { sourceType: 'module', plugins: ts ? ['jsx', 'typescript'] : ['jsx'] });
  } catch (_) {
    return null;
  }
}

// Every relative specifier a module names: import, export … from, import('x').
function specifiersOf(ast) {
  const out = [];
  for (const node of ast.program.body) {
    const from = node.source?.value;
    if (from && /^(Import|ExportNamed|ExportAll)Declaration$/.test(node.type)) out.push(from);
  }
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') out.push(node.source.value);
    else if (node.type === 'CallExpression' && node.callee.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') out.push(node.arguments[0].value);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  ast.program.body.forEach(visit);
  return out;
}

const importCache = new Map();
// The files `file` imports by relative specifier (resolved, cached).
function importsOf(file) {
  if (!importCache.has(file)) {
    const ast = parseFile(file, readFileSync(file, 'utf8'));
    importCache.set(file, ast ? specifiersOf(ast).filter((x) => x.startsWith('.')).map((x) => resolveSpecifier(file, x)).filter(Boolean) : []);
  }
  return importCache.get(file);
}

// The files a static walk reaches from `roots` (relative specifiers only).
export function reachable(roots, { stop = () => false } = {}) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || stop(file) || !isFile(file)) continue;
    seen.add(file);
    stack.push(...importsOf(file));
  }
  return seen;
}

function walkDir(dir, keep) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkDir(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

const isCode = (p) => /\.(jsx?|mjs|tsx?)$/.test(p);

// The roots of every consumer that runs source WITHOUT the Lingui macro
// transform (running the macro untransformed throws), by group. Whatever a
// static walk reaches from them is shared: it must never import Lingui and is
// never wrapped. Playwright runs its specs and helpers under plain node, so
// anything they import from src/ is shared too. The exception is a test helper
// whose graph holds a .jsx file: plain node cannot load JSX, so the Vite dev
// server serves it (tests/helpers/panelsProbe.js and tagsProbe.js say so in
// their headers) and the macro transform applies.
let servedCache = null;
export function viteServedTests() {
  servedCache ||= walkDir(join(BOARDS, 'tests'), isCode).filter((f) => [...reachable([f])].some((g) => g.endsWith('.jsx')));
  return servedCache;
}

// Hand-run dev scripts, run under the Lingui loader (`node --import ./scripts/linguiNode.mjs ...`),
// so the app modules they reach (importCopy.js, importJob.js, activityWords.js) can be wrapped.
export const LOADER_SCRIPTS = ['scripts/measure-import-doc.mjs'];

export function workerRoots() {
  const served = new Set(viteServedTests());
  return {
    worker: [join(SRC, 'worker.js')],
    scripts: readdirSync(join(BOARDS, 'scripts')).filter((n) => n.endsWith('.mjs') && !LOADER_SCRIPTS.includes(`scripts/${n}`)).sort().map((n) => join(BOARDS, 'scripts', n)),
    party: walkDir(join(BOARDS, 'party'), isCode),
    mcp: walkDir(join(BOARDS, '../mcp/src'), isCode),
    scout: walkDir(join(BOARDS, '../scout/src'), isCode),
    tests: walkDir(join(BOARDS, 'tests'), isCode).filter((f) => !served.has(f)),
  };
}

let sharedCache = null;
// Files some consumer runs without the macro transform: the Worker, every
// top-level scripts/*.mjs, the Party worker, the MCP server, the Scout bot and
// the Playwright specs, with everything they statically reach.
export function workerShared() {
  if (!sharedCache) {
    sharedCache = [...reachable(Object.values(workerRoots()).flat())].sort();
  }
  return sharedCache;
}

// How many src files each root group reaches, and how many it adds that no
// earlier group had (in workerRoots() order). { group: { roots, src, added, jsx } }
export function workerSharedBreakdown() {
  const inSrc = (f) => f.startsWith(SRC + sep);
  const seen = new Set();
  const out = {};
  for (const [group, roots] of Object.entries(workerRoots())) {
    const files = [...reachable(roots)];
    const fresh = files.filter((f) => !seen.has(f));
    files.forEach((f) => seen.add(f));
    out[group] = {
      roots: roots.length,
      src: files.filter(inSrc).length,
      added: fresh.filter(inSrc).length,
      jsx: fresh.filter((f) => inSrc(f) && f.endsWith('.jsx')).map((f) => relative(BOARDS, f)),
    };
  }
  return out;
}

let appCache = null;
// The translated app: sorted absolute paths of .js/.jsx/.mjs source files
// reached from src/main.jsx without entering a STOP entry, minus the files a
// consumer without the macro transform also runs (workerShared()).
export function appFiles() {
  if (!appCache) {
    const keep = (f) => /\.(jsx?|mjs)$/.test(f) && !/\.test\.mjs$/.test(f) && f.startsWith(SRC + sep) && !f.startsWith(join(SRC, 'locales') + sep);
    const shared = new Set(workerShared());
    appCache = [...reachable([join(SRC, 'main.jsx')], { stop: isStop })].filter((f) => keep(f) && !shared.has(f)).sort();
  }
  return appCache;
}

export const rel = (file) => relative(BOARDS, file).split(sep).join('/');

// ---- predicates ----

export const hasWords = (s) => /\p{L}{2,}/u.test(s);

export function looksUi(s) {
  if (typeof s !== 'string' || !hasWords(s)) return false;
  const t = s.trim();
  if (/^(https?:|mailto:|data:|\/|\.\/|#)/.test(t)) return false;
  if (/^[a-z0-9]+([_.:-][a-z0-9]+)*$/.test(t) || /^[a-z]+([A-Z][a-z0-9]*)+$/.test(t)) return false;
  if (/^-?\d|\dpx\b|rgba?\(|hsla?\(|var\(--|^#[0-9a-f]{3,8}$|\b(solid|dashed|inherit|auto|none)\b/i.test(t)) return false;
  if (/^[a-z]+\/[\w.+-]+$/.test(t)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return false;
  return /\s/.test(t) || /^\p{Lu}/u.test(t) || /[.…?!:]$/.test(t);
}

// ---- lists ----

// JSX attribute names whose literal value is text a person reads.
export const TEXT_PROPS = new Set([
  'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext',
  'title', 'label', 'placeholder', 'alt', 'data-tip', 'ariaLabel', 'menuLabel', 'desc', 'description',
  'sub', 'subtitle', 'text', 'body', 'head', 'heading', 'what', 'tip', 'tooltip', 'hint', 'caption',
  'message', 'error', 'retryLabel', 'spinnerLabel', 'commitLabel', 'confirmLabel', 'cancelLabel',
  'actionLabel', 'emptyText', 'emptyLabel', 'imgAlt', 'aside',
]);

// A text prop by name: the list above, or any camelCase prop ending in a word
// that says it is words (backLabel, emptyTitle, helpText, …). Not enterKeyHint:
// a keyboard attribute whose values are a fixed list ("go", "search"), not words.
export const isTextProp = (name) => TEXT_PROPS.has(name)
  || (name !== 'enterKeyHint' && /^[a-z][A-Za-z0-9]*(Label|Title|Text|Hint|Placeholder|Message)$/.test(name));

// A call is a sink when its callee is `toast` or `undoToast`, or a member whose
// property is one of SINK_MEMBERS (feedback.toast, feedback.confirm, …). Every
// argument that is an object literal is read for SINK_KEYS.
export const SINK_IDENTIFIERS = new Set(['toast', 'undoToast']);
export const SINK_MEMBERS = new Set(['toast', 'undoToast', 'confirm', 'prompt']);
export const SINK_KEYS = new Set(['message', 'groupMessage', 'title', 'label', 'confirmLabel', 'cancelLabel', 'placeholder', 'hint', 'body', 'detail', 'description']);
export const SINK_NESTED = new Set(['action', 'actions']);
export const NATIVE_NAMES = new Set(['confirm', 'alert', 'prompt']);
export const SINKS = { identifiers: SINK_IDENTIFIERS, members: SINK_MEMBERS, keys: SINK_KEYS, nested: SINK_NESTED };
export const NATIVE_DIALOGS = NATIVE_NAMES;

export const STRICT_KEYS = new Set([
  'label', 'ariaLabel', 'menuLabel', 'placeholder', 'hint', 'tooltip', 'tip', 'confirmLabel', 'cancelLabel',
  'actionLabel', 'retryLabel', 'emptyText', 'emptyLabel', 'subtitle', 'caption', 'description', 'desc',
]);

// Strings inside the arguments of these calls are never edited or reported.
export const DENY_CALLS = {
  // callee is this bare name (or `new Name`)
  names: new Set([
    'logEvent', 'logEventOnce', 'logEventNow', 'fetch', 'postMessage', 'URLSearchParams', 'URL', 'getElementById',
    'addEventListener', 'removeEventListener', 'matchMedia', 'createElement', 'RegExp', 'Worker', 'import',
    // The repo's own analytics and error reporters (lib/analytics.js, errorReporting.js,
    // errorCrumbs.js, perfReport.js, serverErrors.js, workerErrors.js): they carry codes
    // and context for the database, never text a person reads.
    'reportError', 'reportToast', 'reportWorkerError', 'reportServerError', 'postPerfIncident', 'noteRequest',
    'noteChannel', 'noteSessionCounter', 'setAnalyticsContext', 'setErrorUser', 'setPerfContext', 'bumpPerf', 'crumb',
    'trackOp', 'seedShareFirstSource', 'seedFileShareFirstSource', 'seedPublicBoardFirstSource',
    // CSS class helpers
    'clsx', 'cx', 'classNames', 'cn',
  ]),
  prefixes: ['track', 'querySelector'],
  // `<object>.<anything>(…)`
  objects: new Set(['console', 'analytics', 'JSON', 'localStorage', 'sessionStorage', 'classList']),
  // `<anything>.<property>(…)`
  properties: new Set([
    'from', 'rpc', 'insert', 'update', 'upsert', 'delete', 'select', 'eq', 'neq', 'in', 'match', 'filter', 'order',
    'is', 'or', 'ilike', 'like', 'contains', 'single', 'maybeSingle', 'channel', 'on',
    'querySelector', 'querySelectorAll', 'getElementById', 'addEventListener', 'removeEventListener', 'supports',
    'postMessage', 'matchMedia',
  ]),
};

// Exact trimmed strings that stay English (brand and format names).
export const KEEP_ENGLISH = new Set([
  'Soleil Clusters', 'Soleil', 'Google Drive', 'Dropbox', 'Pinterest', 'Figma', 'GitHub', 'Claude', 'ChatGPT',
  'Stripe', 'PDF', 'PNG', 'JPEG', 'GIF', 'SVG', 'MP4', 'ZIP', 'CSV', 'MCP', 'API',
]);

export const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'code', 'em', 'i', 'kbd', 'mark', 'q', 's', 'small', 'span', 'strong',
  'sub', 'sup', 'time', 'u', 'wbr',
]);
export const NO_WRAP_PARENTS = new Set(['code', 'pre', 'style', 'script']);

// Components that read their `children` as text (Menu.jsx: MenuHead does
// `typeof children === 'string' && children.toLowerCase() === …`): their text
// is `{t`…`}`, never <Trans>, which would make children an element.
export const STRING_CHILD_COMPONENTS = new Set(['MenuHead']);

// Calls whose arguments a module-scope table can sit in without being read
// while the module loads (labelled `Object.freeze`, `new Map`, …).
export const SAFE_MODULE_CALLS = new Set(['Object.freeze', 'new Map', 'new Set', 'createContext']);

// A module-scope table read with one of these at load runs its getters.
export const LOAD_METHODS = new Set(['map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every', 'flatMap', 'slice', 'concat', 'sort']);
