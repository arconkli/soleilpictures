// Put on board (App.jsx putFilesOnBoard) refuses with words fit to show, and
// with a reason those words can't carry to the Errors page: a toast is reported
// by its code alone (lib/errorReporting.js reportToast), never by its words,
// which quote a cluster's name. So every refusal used to reach the Errors page
// as one files_put_failed, whatever happened. The reason now names the toast's
// code and rides on the files_put event, so "Put files on a cluster" failing
// says why: view-only, the cluster didn't come up, another one opened first.
//
// An error with no reason isn't one of these refusals but a fault of ours, and
// its own words (a TypeError's, say) aren't fit to show: the toast says the
// plain sentence instead.

export const PUT_FAILED_WORDS = 'Those files couldn’t be put on the board.';

// reason: 'gone' | 'view_only' | 'not_open' | 'other_opened' | 'capture' | 'replaced'
export function putRefusal(reason, message) {
  const e = new Error(message);
  e.reason = reason;
  return e;
}

export const putFailReason = (e) => (typeof e?.reason === 'string' && e.reason) || 'error';

// The toast for a Put on board that didn't happen. Each error toast below
// spells its code as a literal, as errorToastContract.test.mjs requires.
export function putFailToast(e) {
  const message = e?.message || PUT_FAILED_WORDS;
  switch (putFailReason(e)) {
    case 'gone': return { type: 'error', code: 'files_put_gone', message };
    case 'view_only': return { type: 'error', code: 'files_put_view_only', message };
    case 'not_open': return { type: 'error', code: 'files_put_not_open', message };
    case 'other_opened': return { type: 'error', code: 'files_put_other_opened', message };
    case 'capture': return { type: 'error', code: 'files_put_capture', message };
    // A second Put on board took this one's place: nothing went wrong.
    case 'replaced': return { type: 'info', message };
    default: return { type: 'error', code: 'files_put_failed', message: PUT_FAILED_WORDS };
  }
}
