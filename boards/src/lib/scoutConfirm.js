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

// "CREATE" — the reply that turns a board name we didn't recognise into a board.
// Its own predicate rather than a YES, because it must not be satisfiable by
// accident: "ok" should never conjure a board.
const CREATE = /^\s*(create|make it|yes create|new board)\s*[.!]*\s*$/i;
export function isCreateConfirmation(text) {
  return CREATE.test(String(text || ''));
}

// ── Opting out ───────────────────────────────────────────────────────────────
//
// STOP has to mean stop. The bot recognised these words from the beginning and
// answered them with sympathetic copy that changed nothing: the next photo was
// ingested exactly as before and the invite queue was untouched.
//
// THE OVERLAP WITH "CANCEL" IS DELIBERATE AND IS RESOLVED BY CONTEXT, not here.
// Bare "stop" and "cancel" already mean "don't do that move" (see NO above),
// and that reading is almost always the right one when a move is pending —
// somebody watching a confirmation appear and typing "stop" means the move.
// So the caller checks the pending move FIRST, and only an idle thread reads a
// bare "stop" as an opt-out. The unambiguous phrasings below never mean
// anything else and are honoured in either state.
const STOP_ALWAYS = /^\s*(stop\s*all|stopall|unsubscribe|opt\s*out|optout|remove me|leave me alone|delete my (account|data)|do not (text|message) me|don'?t (text|message) me)\s*[.!]*\s*$/i;
const STOP_BARE = /^\s*(stop|quit|end|cancel everything)\s*[.!]*\s*$/i;
const START = /^\s*(start|unstop|resume|subscribe|opt\s*in|optin)\s*[.!]*\s*$/i;

/**
 * 'stop' | 'start' | null.
 *
 * `movePending` tells us whether a bare "stop" is ambiguous. With a proposal on
 * the table it is a cancellation; on an idle thread it is an opt-out.
 */
export function parseStopIntent(text, { movePending = false } = {}) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (START.test(s)) return 'start';
  if (STOP_ALWAYS.test(s)) return 'stop';
  if (!movePending && STOP_BARE.test(s)) return 'stop';
  return null;
}

// ── Search ───────────────────────────────────────────────────────────────────
//
// "find the diner photos" / "where are the warehouse shots" — the natural forms
// of a question Scout could not answer at all.
//
// Kept narrow for the same reason parseFileIntent is: the cost of a false
// positive is answering a search nobody asked for instead of keeping their
// note, so the verb has to be explicit. "where do things go" is a question
// about the product and is left to the answer topics.
const FIND_RE = /^\s*(?:\/find|\/search|find|search for|search|look for|where (?:are|is)|show me)\s+(?:the\s+|my\s+)?(.+?)\s*(?:\?)?\s*$/i;
const FIND_STOPWORDS = /^(my (bin|boards?|stuff|things)|it|them|things|everything|anything|bin)$/i;

export function parseFindIntent(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 140) return null;
  const m = FIND_RE.exec(t);
  if (!m) return null;
  const q = m[1].trim().replace(/[.!?]+$/, '').replace(/\s+(photos?|pics?|pictures?|shots?|cards?|files?)$/i, '');
  if (!q || q.length < 2 || FIND_STOPWORDS.test(q)) return null;
  return { query: q.slice(0, 80) };
}

// ── Deleting ─────────────────────────────────────────────────────────────────
//
// Narrower still, and only ever about the batch just sent — "delete" with a
// noun ("delete the diner board") is NOT matched, because deleting a board over
// a text message on a guessed name is not a thing this bot should be able to do.
// "bin" and "scrap" are deliberately NOT verbs here. The Bin is a noun in this
// product's own vocabulary, and a bot that reads "bin" as "destroy the last
// batch" would eventually destroy a batch for someone who meant "show me the
// Bin". The cost of the two readings is not symmetric.
const DELETE_RE = /^\s*(?:\/delete|delete|remove|get rid of)\s*(?:the\s+)?(?:last\s+|latest\s+)?(?:one|that|those|these|batch|photos?|pics?|cards?|lot)?\s*[.!]*\s*$/i;

export function isDeleteIntent(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return DELETE_RE.test(s);
}
