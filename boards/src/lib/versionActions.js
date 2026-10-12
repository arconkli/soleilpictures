// What a person does with versions, end to end: upload one, make one current,
// delete, restore, label — each a single mutators.updateCard (one undo step)
// with the toast the house convention asks for. The surfaces (the board, Files,
// Info) only gather the arguments; the patches are lib/cardVersions.js.
//
//   env: { mutators, feedback, userId, getCard(id) → the LIVE card, ctx (versionUpload) }
import {
  addVersionPatch, setCurrentPatch, deleteVersionPatch, restoreVersionPatch, labelVersionPatch,
  pruneDeletedPatch, separateCardFrom, versionLabel, liveVersions, canVersion, VERSION_LIMIT,
} from './cardVersions.js';
import { uploadVersion, canBeVersionOf, versionKindOf } from './versionUpload.js';
import { undoToast } from './undoToast.js';

const KIND_WORD = { image: 'an image', video: 'a video', audio: 'an audio file', pdf: 'a PDF', file: 'a file' };
const nameOf = (c) => c?.title || c?.fileName || c?.name || 'this file';

function topStack(mutators) {
  const um = mutators?.undoManager;
  return um?.undoStack?.length ? um.undoStack[um.undoStack.length - 1] : null;
}

// Apply a patch as its own undo step; returns the step it made (for undoToast).
function commit(mutators, cardId, patch) {
  mutators?.breakUndo?.();
  mutators.updateCard(cardId, patch);
  mutators?.breakUndo?.();
  return topStack(mutators);
}

export function versionRefusal(card, file, opts) {
  if (!canVersion(card)) return 'This card can’t have versions.';
  if (!canBeVersionOf(card, file, opts)) {
    const k = versionKindOf(file, opts);
    return `A new version of ${KIND_WORD[card.kind] || 'this'} has to be ${KIND_WORD[card.kind] || 'the same kind'} too${k ? ` — that’s ${KIND_WORD[k]}` : ''}.`;
  }
  if (liveVersions(card).length >= VERSION_LIMIT) return `A file keeps up to ${VERSION_LIMIT} versions — delete an old one first.`;
  return null;
}

// Upload `file` and show it as the newest version of card `cardId`.
export async function addVersionFromFile(env, cardId, file) {
  const { mutators, feedback, userId, getCard, ctx = {} } = env;
  const card = getCard(cardId);
  const refusal = versionRefusal(card, file, ctx);
  if (refusal) { feedback?.toast?.({ type: 'error', message: refusal }); return null; }
  let fields;
  try {
    fields = await uploadVersion(file, card, ctx);
  } catch (err) {
    feedback?.toast?.({ type: 'error', message: `Couldn’t upload the new version: ${err?.message || err}` });
    return null;
  }
  // The card as it is NOW — it may have changed while the file uploaded.
  const live = getCard(cardId);
  if (!live) { feedback?.toast?.({ type: 'error', message: 'The card was deleted while its new version uploaded.' }); return null; }
  const { _top, ...entryFields } = fields;
  const pruned = pruneDeletedPatch(live);
  const base = pruned ? { ...live, ...pruned } : live;
  const r = addVersionPatch(base, entryFields, { by: userId || null });
  if (!r) { feedback?.toast?.({ type: 'error', message: versionRefusal(live, file, ctx) || 'Couldn’t add the version.' }); return null; }
  const patch = { ...r.patch, ...(_top || {}) };
  const step = commit(mutators, cardId, patch);
  const um = mutators?.undoManager;
  const stillTop = () => !um || !step || topStack(mutators) === step;
  feedback?.toast?.({
    type: 'success',
    message: `Added ${versionLabel(r.entry)} of “${nameOf(live)}”`,
    ttl: 8000,
    actions: [
      { label: 'Undo', onClick: () => {
        if (!stillTop()) { feedback.toast({ type: 'info', message: 'The board changed since — press ⌘Z to step back instead.' }); return; }
        mutators.undo?.();
      } },
      // Meant it as a file of its own: take the version back off, and add it
      // as a card beside this one.
      { label: 'Keep as separate file', onClick: () => {
        if (!stillTop()) { feedback.toast({ type: 'info', message: 'The board changed since — press ⌘Z, then drop it again.' }); return; }
        mutators.undo?.();
        const now = getCard(cardId) || live;
        const id = `${live.kind.slice(0, 3)}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const sep = separateCardFrom(now, { ...r.entry, ...(_top || {}) }, id);
        if (live.kind === 'audio' && _top) Object.assign(sep, _top);
        mutators.addCard?.(sep);
      } },
    ],
  });
  return r.entry;
}

export function makeCurrent(env, cardId, versionId) {
  const { mutators, feedback, getCard } = env;
  const card = getCard(cardId);
  const patch = card && setCurrentPatch(card, versionId);
  if (!patch) return;
  const step = commit(mutators, cardId, patch);
  const v = liveVersions({ ...card, ...patch }).find((x) => x.id === versionId);
  undoToast(feedback, { message: `Showing ${versionLabel(v)} of “${nameOf(card)}”`, undoManager: mutators.undoManager, stackItem: step, onUndo: () => mutators.undo?.() });
}

export function deleteVersion(env, cardId, versionId) {
  const { mutators, feedback, getCard } = env;
  const card = getCard(cardId);
  const v = liveVersions(card).find((x) => x.id === versionId);
  const patch = card && deleteVersionPatch(card, versionId);
  if (!patch) { feedback?.toast?.({ type: 'error', message: 'A file keeps at least one version.' }); return; }
  const step = commit(mutators, cardId, patch);
  undoToast(feedback, {
    message: `Deleted ${versionLabel(v)} — it’s under Recently deleted in Info for 30 days`,
    undoManager: mutators.undoManager, stackItem: step, onUndo: () => mutators.undo?.(),
  });
}

export function restoreVersion(env, cardId, versionId) {
  const { mutators, getCard } = env;
  const card = getCard(cardId);
  const patch = card && restoreVersionPatch(card, versionId);
  if (patch) commit(mutators, cardId, patch);
}

export async function labelVersion(env, cardId, versionId) {
  const { mutators, feedback, getCard } = env;
  const card = getCard(cardId);
  const v = liveVersions(card).find((x) => x.id === versionId);
  if (!v) return;
  const label = await feedback?.prompt?.({ title: `Label ${versionLabel(v)}`, label: 'Label', defaultValue: v.label || '', placeholder: 'Picture lock, Director’s cut…', confirmLabel: 'Save' });
  if (label == null) return;
  const patch = labelVersionPatch(getCard(cardId), versionId, label);
  if (patch) commit(mutators, cardId, patch);
}

// A file picker for "Upload new version…", then addVersionFromFile.
export function pickVersionFile(env, cardId) {
  const card = env.getCard(cardId);
  if (!card) return;
  const input = document.createElement('input');
  input.type = 'file';
  const accept = { image: 'image/*', video: 'video/*', audio: 'audio/*,.wav,.aif,.aiff,.flac,.m4a,.mp3', pdf: 'application/pdf,.pdf' }[card.kind];
  if (accept) input.accept = accept;
  input.onchange = () => { const f = input.files?.[0]; if (f) addVersionFromFile(env, cardId, f); };
  input.click();
}
