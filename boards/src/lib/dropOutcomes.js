// dropOutcomes — what a drop does with the files it deliberately did NOT
// upload, said once and the same way from all three ingest paths (canvas drop,
// canvas paste, list drop).
//
// Before this, every one of these files fell through to the generic file
// route: a free owner was pitched paid storage for a half-finished download,
// for a PureRef scene no plan can open, and for a screenplay the doc editor
// imports for free. The pitch then claimed the upgrade moment for a file
// nobody meant to buy — on 2026-09-17 a `.crdownload` inside a photo folder
// replaced the upgrade screen someone had just asked for.

import { logEvent } from './analytics.js';
import { EV } from './analyticsEvents.js';
import { skippedFilesNotice } from './fileIngest.js';
// The script parser is loaded only when a screenplay actually arrives: this
// module sits in the app shell (App.jsx imports it for the list drop), and a
// parser for a rare drop has no business in the bundle every visit downloads.
const loadScriptImport = () => import('./scriptImport.js');

const ext = (name) => (String(name || '').split('.').pop() || '').toLowerCase().slice(0, 12) || null;

// skipped: { partial: File[], pureref: File[] }
export function reportSkippedFiles({ partial = [], pureref = [] } = {}, { surface, toast } = {}) {
  const notice = skippedFilesNotice({ partial: partial.length, pureref: pureref.length });
  if (!notice) return false;
  try {
    if (partial.length) logEvent(EV.FILE_SKIPPED, { reason: 'partial_download', surface, n: partial.length, ext: ext(partial[0]?.name) });
    if (pureref.length) logEvent(EV.FILE_SKIPPED, { reason: 'pureref', surface, n: pureref.length, ext: 'pur' });
  } catch (_) { /* telemetry must never stop the toast */ }
  toast?.({ type: 'info', message: notice, ttl: 7000 });
  return true;
}

export const SCRIPT_UNREADABLE = "Couldn't read that file — it doesn't look like Fountain or Final Draft.";
export const SCRIPT_EMPTY = 'Nothing importable found in that file.';
export const SCRIPT_ONE_AT_A_TIME = 'One script at a time — the first is on the board; drop the next on its own.';

// Turn the FIRST screenplay in a gesture into a script card, its title page and
// body written into the card's doc as it is made (App's addScriptCard). One per gesture: every script in a drop would be
// placed on the same spot, each exactly on top of the last, and the toast says
// to drop the next on its own.
// Returns the card's id, or null when nothing was made (unreadable, empty, or
// refused by the cap — which shows its own wall), and only a card that exists
// is counted as imported.
export async function importDroppedScripts(files, { addScriptCard, pos = null, source, toast } = {}) {
  if (!files?.length) return null;
  const file = files[0];
  let parsed;
  let mod;
  try {
    mod = await loadScriptImport();
    parsed = mod.parseScriptText(await file.text(), file?.name || '');
  } catch (err) {
    console.error('[drop] screenplay parse failed', err);
    toast?.({ type: 'error', message: SCRIPT_UNREADABLE });
    return null;
  }
  if (mod.isEmptyScript(parsed)) { toast?.({ type: 'error', message: SCRIPT_EMPTY }); return null; }
  const id = addScriptCard?.(pos, { title: parsed.title, script: { titlePage: parsed.titlePage, body: mod.scriptBody(parsed) } });
  if (!id) return null;
  try { logEvent(EV.SCRIPT_IMPORTED, { source, format: parsed.format, blocks: parsed.blocks.length }); } catch (_) {}
  // Said only once the first one is really on the board.
  if (files.length > 1) toast?.({ type: 'info', message: SCRIPT_ONE_AT_A_TIME, ttl: 6000 });
  return id;
}
