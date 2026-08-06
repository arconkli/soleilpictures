// Scout — reading short replies to a proposed move.
//
// Pure string predicates, kept out of filing.js because that module pulls in
// sharp and the provider stack. Same reason STAGES lives in replies.js: the
// logic worth testing shouldn't drag an image pipeline into the test run.
//
// The governing rule here is that AMBIGUITY IS NOT CONSENT. parseConfirmation
// returns null for anything it doesn't clearly recognise, and the caller then
// treats the message as ordinary content rather than as a yes. Moving twenty of
// someone's photos because they happened to text the word "sure" in a sentence
// about something else is exactly the failure this whole flow exists to prevent.

// Anchored at the start of the message and bounded by a word break: "ok" is a
// yes, "okay so the diner is on 3rd" is not.
const YES = /^\s*(y|ya|yes|yep|yeah|yup|ok|okay|k|sure|do it|go|go ahead|confirm|please|👍|✅)\s*[.!]*\s*$/i;
const NO = /^\s*(n|no|nope|nah|cancel|stop|don'?t|wait|hold on|not yet)\s*[.!]*\s*$/i;
const UNDO = /^\s*(undo|revert|put (them|it|those) back|nevermind|never mind)\s*[.!]*\s*$/i;

export function parseConfirmation(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (UNDO.test(s)) return 'undo';
  if (NO.test(s)) return 'no';
  if (YES.test(s)) return 'yes';
  return null;
}

// "put EVERYTHING in the diner board" — the explicit opt-in to the whole Bin
// rather than just the batch they most recently sent.
export function wantsEverything(text) {
  return /\b(everything|all of (it|them)|the whole (bin|lot)|the rest|all \d+)\b/i
    .test(String(text || ''));
}

export function isBinQuery(text) {
  const s = String(text || '');
  return /^\s*\/bin\b/i.test(s)
    || /\bwhat('?s| is)\s+in\s+(my\s+|the\s+)?bin\b/i.test(s)
    || /\bshow me (my )?bin\b/i.test(s);
}
