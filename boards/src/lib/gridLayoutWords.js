// The words of the grid-template panel, in the person's language.
//
// Two sets, both app-only:
//  - the ten bare shapes' names (lib/gridLayout.js PRESETS labels): a MIRROR,
//    because gen-docs and the Worker's /templates pages read the same labels
//    through templateLayouts.layoutById and need them in English;
//  - the panel's section titles (lib/gridLayoutLibrary.js mergeSections): moved
//    here, since only the panel shows them.
// gridLayoutWords.test.mjs keeps the mirror equal to the shared English.
import { t } from '@lingui/core/macro';
import { SOURCES } from './gridLayoutLibrary.js';

export function presetLabel(id) {
  switch (id) {
    case 'storyboard-1-2': return t`Storyboard · 1 top / 2 bottom`;
    case 'db-row-1-3': return t`Database row · 1 left / 3 stacked`;
    case '2x2': return t`2 × 2`;
    case '3up': return t`3 across`;
    case '4up': return t`4 across`;
    case 'contact-sheet-3x3': return t`Contact sheet · 3 × 3`;
    case 'hero-3-strip': return t`Hero + 3 below`;
    case 'split-2': return t`Side by side`;
    case 'stack-2': return t`Stacked pair`;
    case 'single': return t`Single cell`;
    default: return null;
  }
}

export function sectionTitle(source) {
  switch (source) {
    case SOURCES.USER: return t`Yours`;
    case SOURCES.WORKSPACE: return t`Workspace`;
    case SOURCES.DOWNLOADED: return t`Downloaded`;
    case SOURCES.STORE: return t`Store`;
    case SOURCES.COMMUNITY: return t`Community`;
    case SOURCES.BUILTIN: return t`Shapes`;
    default: return null;
  }
}

// A panel row with its stand-in name in the person's language: a record with
// no name reads 'Untitled' in gridLayoutLibrary (stored rows keep English).
export function localizeRow(row) {
  return row && row.unnamed ? { ...row, name: t`Untitled` } : row;
}

// mergeSections' output with its titles, and the bare shapes' names, in the
// person's language. Rows keep their ids, so nothing that finds a row by id
// notices; the panel's search then matches the names it shows.
export function localizeSections(sections) {
  return (sections || []).map((s) => ({
    ...s,
    title: sectionTitle(s.id) || s.title,
    rows: s.id === SOURCES.BUILTIN
      ? s.rows.map((r) => ({ ...r, name: presetLabel(r.id) || r.name }))
      : s.rows.map(localizeRow),
  }));
}
