// scriptImport — a screenplay file dropped on a board becomes a script.
//
// Screenplay documents have always imported Fountain and Final Draft for free
// (the doc toolbar's Export menu → Import). The SAME file dropped on the
// canvas fell through to the generic file route instead — which is paid-gated
// for a free owner — so a screenwriter's first drop was met with an offer to
// buy storage for a file the product would have opened for nothing, and a
// paying owner got an opaque download card rather than their script.
//
// A drop now creates a script card (App's addScriptCard: screenplay mode) with
// its title page and its whole body written into the card's doc as the card is
// made (docState.writeScriptBody) — never left waiting for an editor: a new doc
// card does not open by itself, and the list view has no editor at all.
//
// parseScriptText is the ONE parse path: DocExportMenu's own import uses it
// too, so a dropped script and an imported one can never come out different.

import { parseFountainTitlePage, fountainToBlocks, fdxToBlocks, fdxToTitlePage, blocksToDocJSON } from './screenplayIO.js';

export const SCRIPT_FILE_RE = /\.(fountain|fdx)$/i;

// { format, blocks, titlePage, title }. Throws when the text cannot be parsed
// (FDX needs a DOM; malformed XML throws there) — callers say so in a toast,
// because a drop that silently produces an empty script reads as a bug.
export function parseScriptText(text, name = '') {
  const src = String(text ?? '');
  const isFdx = /\.fdx$/i.test(String(name || '')) || /<FinalDraft/i.test(src);
  let blocks;
  let titlePage = null;
  if (isFdx) {
    blocks = fdxToBlocks(src);
    titlePage = fdxToTitlePage(src);
  } else {
    const parsed = parseFountainTitlePage(src);
    titlePage = parsed.titlePage;
    blocks = fountainToBlocks(parsed.body);
  }
  const base = String(name || '').replace(/\.[^.]+$/, '').trim();
  const fromTitlePage = titlePage && typeof titlePage.title === 'string' ? titlePage.title.split('\n')[0].trim() : '';
  return {
    format: isFdx ? 'fdx' : 'fountain',
    blocks: Array.isArray(blocks) ? blocks : [],
    titlePage: titlePage || null,
    title: (fromTitlePage || base || 'Untitled script').slice(0, 120),
  };
}

// The ProseMirror JSON the card's first page is written with — the same shape
// the toolbar's Import hands setContent.
export function scriptBody(parsed) {
  return parsed?.blocks?.length ? blocksToDocJSON(parsed.blocks) : null;
}

// Nothing worth creating a card for: no script blocks and no title page.
export function isEmptyScript(parsed) {
  return !parsed || ((!parsed.blocks || parsed.blocks.length === 0) && !parsed.titlePage);
}
