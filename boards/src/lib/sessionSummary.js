// sessionSummary — one dense row describing a whole session, at its end.
//
// WHY THIS EXISTS. The product's high-resolution telemetry covers a new user's
// FIRST session and stops: the ps_* journey opens at signup and closes at
// activation. app_trace covers established users but is deliberately quiet and
// reaches very few of them. usage_session records seconds per surface but has
// no notion of how a session ended, which visit it was, or what came of it.
//
// So the question that matters most — what does the session BEFORE someone
// comes back look like, against the session before they never do — cannot be
// asked for visit two onward. That is exactly the transition where this product
// loses nearly everyone, and it is the one stretch of behaviour nothing
// summarises.
//
// Modelled on up_exposure_summary, which is the established idiom here: one
// terminal row per episode carrying the shape of the whole thing, rather than a
// join across six event streams that each know a fraction of it.
//
// DELIBERATELY NOT A DUPLICATE of usage_session. That table has per-surface
// active seconds and this does not try to; what it adds is the ordinal (which
// visit this was), the outcome (what got made), and the ending. The read side
// joins them.
//
// Pure: an accumulator plus functions over it, no timers, no DOM, no imports —
// same shape as upsellSlot.js and depthDock.js, and unit-testable under node.

// Events that mean the person changed the contents of a cluster, mirroring
// WORK_EVENTS in analyticsEvents.js. Kept as a literal set rather than imported
// so this module stays dependency-free and node-testable on its own; the test
// asserts the two do not drift.
const WROTE = new Set([
  'card_placed', 'card_edit', 'doc_edit', 'arrow_created', 'comment_create',
  'remix_clone', 'tag_manual_apply', 'tag_confirm', 'tag_merge',
  'tag_candidate_promote', 'tag_set_type',
]);

// Anything whose name marks a failure the user could feel. Suffix match rather
// than a list, so an error event added later is counted without touching this.
const isError = (name) => typeof name === 'string'
  && (name.endsWith('_error') || name.endsWith('_failed') || name.endsWith('_blocked'));

/**
 * A fresh accumulator for one session.
 *
 * `view` is the page's state at the moment the session starts — whether the tab
 * is visible and whether it holds focus. Time is then banked per span by
 * noteVisibility/noteFocus. Most late visits are tabs left open for hours with no
 * input at all, and input-gated active time cannot tell a reference wall on a
 * second screen (visible, unfocused, looked at) from a forgotten background tab
 * (hidden). These two numbers can.
 */
export function createSummary(session, now = Date.now(), view = null) {
  const visible = !!view?.visible;
  const focused = !!view?.focused;
  return {
    id: session?.id || null,
    seq: Number(session?.seq) || 0,
    startedAt: Number(session?.startedAt) || now,
    lastAt: now,
    events: 0,
    cards: 0,
    intents: 0,
    boards: new Set(),
    surfaces: new Set(),
    wrote: false,
    errors: 0,
    visibleMs: 0,
    visibleSince: visible ? now : null,
    focusedMs: 0,
    focusedSince: focused ? now : null,
  };
}

// Bank an open span up to `now` and close it, or open one. A clock that runs
// backwards banks nothing rather than a negative span.
function bank(acc, msKey, sinceKey, on, now) {
  if (!acc) return acc;
  const since = acc[sinceKey];
  if (since != null) {
    const d = Number(now) - Number(since);
    if (Number.isFinite(d) && d > 0) acc[msKey] += d;
    acc[sinceKey] = null;
  }
  if (on) acc[sinceKey] = now;
  return acc;
}

/** The tab became visible (true) or hidden (false). */
export function noteVisibility(acc, visible, now = Date.now()) {
  return bank(acc, 'visibleMs', 'visibleSince', !!visible, now);
}

/** The window gained (true) or lost (false) focus. */
export function noteFocus(acc, focused, now = Date.now()) {
  return bank(acc, 'focusedMs', 'focusedSince', !!focused, now);
}

// Banked time plus the span still open, without mutating the accumulator — a
// summary can be emitted mid-span (a rotation) and the span must keep running.
function spanTotal(ms, since, now) {
  const open = since != null ? Number(now) - Number(since) : 0;
  return Math.max(0, Math.round((Number(ms) || 0) + (Number.isFinite(open) && open > 0 ? open : 0)));
}

/**
 * Fold one event into the accumulator. Called for every event the app logs, so
 * it must stay cheap and must never throw on a malformed prop bag.
 */
export function noteEvent(acc, name, props, now = Date.now()) {
  if (!acc || !name) return acc;
  // The summary is itself an event; counting it would make the row describe a
  // session one event longer than the one it reports on.
  if (name === 'session_summary') return acc;

  acc.events += 1;
  acc.lastAt = now;

  if (name === 'card_placed') {
    const n = Number(props?.n);
    acc.cards += Number.isFinite(n) && n > 0 ? n : 1;
  }
  // Intents per card is the one thing that tells a hand-built board from a
  // folder dumped on it — the same twenty-six cards arrive as twenty gestures
  // or as two. Counters that see only cards cannot tell them apart.
  if (name === 'card_create_intent') acc.intents += 1;
  if (props?.board_id) acc.boards.add(String(props.board_id));
  if (props?.surface) acc.surfaces.add(String(props.surface));
  if (WROTE.has(name)) acc.wrote = true;
  if (isError(name)) acc.errors += 1;

  return acc;
}

/**
 * The props for the terminal row.
 *
 * `of_session` names the session being described. It is carried in props rather
 * than relied upon from the row's own app_session_id column, because at a
 * rotation the summary is emitted for the session that just ENDED while the
 * client has already advanced to the next one — the column would name the wrong
 * session. Read of_session, not app_session_id.
 *
 * `ms_span` is wall time from first to last event, not active time. usage_session
 * owns active seconds and this does not duplicate it; the span is bounded by the
 * 30-minute idle rotation, so it cannot run away with a tab left open for days.
 *
 * `visible_ms` / `focused_ms` run to `now`, not to the last event: a reference
 * wall someone looks at without touching produces no events, and that silence is
 * exactly the case these exist to measure.
 */
export function summaryProps(acc, ended, now = Date.now()) {
  if (!acc) return null;
  return {
    of_session: acc.id,
    visit_n: acc.seq,
    ms_span: Math.max(0, (Number(acc.lastAt) || now) - (Number(acc.startedAt) || now)),
    events_n: acc.events,
    cards_placed: acc.cards,
    intents_n: acc.intents,
    boards_opened: acc.boards.size,
    surfaces_n: acc.surfaces.size,
    wrote: !!acc.wrote,
    errors_n: acc.errors,
    visible_ms: spanTotal(acc.visibleMs, acc.visibleSince, now),
    focused_ms: spanTotal(acc.focusedMs, acc.focusedSince, now),
    ended: ended || 'unknown',
  };
}

/**
 * Is there anything here worth a row?
 *
 * A session that logged nothing but its own boot is noise — every page load
 * would otherwise emit a summary, and the table would fill with rows describing
 * nobody doing anything. One real event is the bar.
 */
export function worthEmitting(acc) {
  return !!acc && acc.events > 0;
}
