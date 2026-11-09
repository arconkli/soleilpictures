// canvasToolEvents.js — which canvas tools people reach for, and how soon.
//
// One event, EV.CANVAS_TOOL, carries { action, how?, via?, tool?, n?, board_id }.
// It feeds Admin › Outlines (tool use by cluster age) and nothing else. The
// props are closed: canvasToolProps keeps only the keys an action is allowed,
// and only values from a fixed set, so a title, a colour, a file name or a url
// cannot ride along even if a call site passes one. n is a bucket, never a count.
//
// Frequency: a drag or a nudge happens too often to log one by one. Every call
// is counted on the session summary under its tool group (13 `tool.*` counters),
// and the event itself goes out at most once per 5 minutes per action, tool, how, via + cluster,
// so the first-day and first-week bands still get their sample.
//
// This file is pure on purpose (analytics.js needs a browser to load): the
// logger takes its two sinks, and logCanvasTool wires them to analytics.js the
// first time it is called.

export const CANVAS_TOOL_ACTIONS = Object.freeze({
  pick:           Object.freeze({
    tool: Object.freeze(['select', 'pan', 'image', 'text', 'doc', 'board', 'grid', 'arrow', 'draw', 'shape', 'palette']),
    via:  Object.freeze(['rail', 'key', 'menu', 'palette']),
  }),
  draw:           Object.freeze({}),
  tidy:           Object.freeze({ how: Object.freeze(['justified', 'masonry', 'grid', 'row', 'column']), n: true }),
  // The edge and axis names are alignCards' and distributeCards' own.
  align:          Object.freeze({ how: Object.freeze(['left', 'center-x', 'right', 'top', 'middle', 'bottom']), n: true }),
  distribute:     Object.freeze({ how: Object.freeze(['horizontal', 'vertical']), n: true }),
  resize:         Object.freeze({ n: true }),
  rotate:         Object.freeze({}),
  zorder:         Object.freeze({ how: Object.freeze(['front', 'back', 'forward', 'backward']) }),
  move:           Object.freeze({ n: true }),
  section_add:    Object.freeze({ n: true }),
  section_remove: Object.freeze({}),
  undo:           Object.freeze({}),
  redo:           Object.freeze({}),
  duplicate:      Object.freeze({ n: true }),
  copy:           Object.freeze({ n: true }),
  cut:            Object.freeze({ n: true }),
  paste:          Object.freeze({ n: true }),
  select_many:    Object.freeze({ n: true }),
  grid_split:     Object.freeze({}),
  grid_merge:     Object.freeze({}),
  grid_fill:      Object.freeze({ via: Object.freeze(['set', 'drop', 'upload', 'paste']) }),
});

// action → the tool row it counts toward. `pick` is not a row. Arrows have no
// action here: arrow_created is its own event.
export const TOOL_GROUP = Object.freeze({
  move: 'move', tidy: 'arrange', align: 'align', distribute: 'align',
  section_add: 'sections', section_remove: 'sections', draw: 'pen',
  grid_split: 'grid', grid_merge: 'grid', grid_fill: 'grid',
  duplicate: 'duplicate', copy: 'copy_paste', cut: 'copy_paste', paste: 'copy_paste',
  undo: 'undo', redo: 'undo', resize: 'resize', rotate: 'rotate',
  zorder: 'layer', select_many: 'multi_select',
});

export function nBucket(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return null;
  if (v < 2) return '1';
  if (v < 5) return '2-4';
  if (v < 10) return '5-9';
  if (v < 25) return '10-24';
  return '25+';
}

/** The event's props for an action, or null for an action that is not one of ours. */
export function canvasToolProps(action, opts = {}) {
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(CANVAS_TOOL_ACTIONS, action)) return null;
  const allowed = CANVAS_TOOL_ACTIONS[action];
  const o = opts && typeof opts === 'object' ? opts : {};
  const props = { action };
  for (const key of Object.keys(allowed)) {
    if (key === 'n') {
      const b = nBucket(o.n);
      if (b) props.n = b;
    } else if (typeof o[key] === 'string' && allowed[key].includes(o[key])) {
      props[key] = o[key];
    }
  }
  if (o.boardId != null && o.boardId !== '') props.board_id = String(o.boardId).slice(0, 64);
  return props;
}

export const SEND_EVERY_MS = 5 * 60 * 1000;
const MAX_SEEN = 500;

/**
 * A logger over two sinks: `send(name, props)` and `count(key)`. Separate from
 * logCanvasTool so a test can drive it with a clock and a recorder.
 */
export function createCanvasToolLogger({ send, count, now = Date.now, eventName = 'canvas_tool' }) {
  const lastSent = new Map();
  return function log(action, opts = {}) {
    try {
      const props = canvasToolProps(action, opts);
      if (!props) return;
      const group = TOOL_GROUP[action];
      if (group) count('tool.' + group);
      const key = [action, props.tool || '', props.how || '', props.via || '', props.board_id || '-'].join(':');
      const t = now();
      const last = lastSent.get(key);
      if (last !== undefined && t - last < SEND_EVERY_MS) return;
      if (lastSent.size > MAX_SEEN) lastSent.clear();
      lastSent.set(key, t);
      send(eventName, props);
    } catch (_) { /* analytics never throws into the canvas */ }
  };
}

let wired = null;
function wire() {
  if (!wired) {
    wired = Promise.all([import('./analytics.js'), import('./analyticsEvents.js')])
      .then(([{ logEvent, noteSessionCounter }, { EV }]) => createCanvasToolLogger({
        send: logEvent,
        count: (k) => noteSessionCounter(k),
        eventName: EV.CANVAS_TOOL,
      }))
      .catch(() => () => {});
  }
  return wired;
}

/** Call at the commit point of a canvas action. Never throws. */
export function logCanvasTool(action, opts = {}) {
  try { wire().then((log) => log(action, opts)); } catch (_) {}
}
