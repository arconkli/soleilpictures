// errorWords — the app's own thrown sentences, shown in the person's language.
//
// Thrown messages stay English: error collection groups uncaught errors by
// their message (migration 0580) and alerts count per group, so a translated
// message would split one bug into one group per language. Every place that
// SHOWS an error to a person goes through shownError() instead; places that
// log, record, compare or store a message keep reading err.message.
//
// The table is keyed by the exact English of each static sentence the app
// throws for people, and maps to a function returning the same English read
// through Lingui (a function, never a module-level t call: R2). A message that
// is not in the table is server text or a technical detail and passes through
// unchanged (S4). Messages with a value in them (a template literal) cannot be
// keyed and stay English; the lines that throw them are listed in the
// 13-sweep triage log. App only: errorWords.test.mjs holds the English.
import { t as tr } from '@lingui/core/macro';

const TABLE = {
  'This workspace has no clusters and could not be repaired.': () => tr`This workspace has no clusters and could not be repaired.`,
  'Could not resolve the PDF URL': () => tr`Could not resolve the PDF URL`,
  'Not signed in.': () => tr`Not signed in.`,
  'Not signed in': () => tr`Not signed in`,
  'Not connected.': () => tr`Not connected.`,
  'Sign-in is unavailable right now.': () => tr`Sign-in is unavailable right now.`,
  'Tag name required': () => tr`Tag name required`,
  'This browser could not draw the board.': () => tr`This browser could not draw the board.`,
  'Too large to unpack here.': () => tr`Too large to unpack here.`,
  'Nothing to zip': () => tr`Nothing to zip`,
  "Storage is full for this cluster's owner — free up space or upgrade to add more.": () => tr`Storage is full for this cluster's owner — free up space or upgrade to add more.`,
  'Upload network error': () => tr`Upload network error`,
  'Upload aborted': () => tr`Upload aborted`,
  'Upload stalled': () => tr`Upload stalled`,
  'Part upload network error': () => tr`Part upload network error`,
  'Part upload stalled': () => tr`Part upload stalled`,
  'Could not finish saving the image — please try again.': () => tr`Could not finish saving the image — please try again.`,
  'Could not finish saving the audio — please try again.': () => tr`Could not finish saving the audio — please try again.`,
  'Could not finish saving the PDF — please try again.': () => tr`Could not finish saving the PDF — please try again.`,
  'Could not finish saving the video — please try again.': () => tr`Could not finish saving the video — please try again.`,
  'Could not finish saving the file — please try again.': () => tr`Could not finish saving the file — please try again.`,
  'Could not read the video length — re-export and try again.': () => tr`Could not read the video length — re-export and try again.`,
  // lib/commentsApi.js notAllowed(): one whole sentence for each thing refused
  'Only its author or an editor of this cluster can change this comment.': () => tr`Only its author or an editor of this cluster can change this comment.`,
  'Only its author or an editor of this cluster can delete this comment.': () => tr`Only its author or an editor of this cluster can delete this comment.`,
  'Only its author or an editor of this cluster can restore this comment.': () => tr`Only its author or an editor of this cluster can restore this comment.`,
  'Already recording.': () => tr`Already recording.`,
  'Could not read a frame.': () => tr`Could not read a frame.`,
  'The captured surface had no size.': () => tr`The captured surface had no size.`,
  'Workspace name is required': () => tr`Workspace name is required`,
  'Only the owner or a co-owner can change this.': () => tr`Only the owner or a co-owner can change this.`,
  'Only the workspace’s owner and co-owners can delete a cluster for good.': () => tr`Only the workspace’s owner and co-owners can delete a cluster for good.`,
  'Version snapshot is empty or corrupt; refusing to restore.': () => tr`Version snapshot is empty or corrupt; refusing to restore.`,
  'Snapshot has 0 cards / arrows / strokes — restore would empty the board.': () => tr`Snapshot has 0 cards / arrows / strokes — restore would empty the board.`,
};

export const ERROR_WORDS = TABLE;

// The text to show for a thrown Error (or a string): the translation when the
// message is one of the app's own sentences, otherwise the message unchanged
// (server text), otherwise `fallback`. With nothing to show and no fallback, a
// non-Error value is shown as String(value), as `e.message || e` did.
export function shownError(err, fallback) {
  const message = typeof err === 'string' ? err : err?.message;
  if (message) {
    const words = Object.prototype.hasOwnProperty.call(TABLE, message) ? TABLE[message] : null;
    return words ? words() : message;
  }
  if (fallback !== undefined) return fallback;
  return err == null ? '' : String(err);
}
