// The Changes tab of version history: what a board_meta_history row says, in
// words. Values are stored as jsonb, and some writers wrap a scalar as { v }
// (moveBoardsUnder logs parent_board_id that way), so every read goes through
// unwrapMetaValue. Labels are whole messages written when called, never at
// import, so they follow the interface's language.
import { t as tr, ph } from '@lingui/core/macro';

// The fields a person can revert from the list (a sanctioned write path each).
export const REVERTIBLE_FIELDS = new Set(['name', 'bg_color', 'cover', 'view']);

// Shoot-day fields, retired with schedules (2026-10-20); old rows still show.
const SCHEDULE_FIELDS = new Set(['scheduled_date', 'scheduled_end', 'day_label', 'sched_status', 'day_start', 'day_end', 'day_place', 'day_type']);

// { v: x } → x; anything else as it is.
export function unwrapMetaValue(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'v') return v.v;
  }
  return v;
}

// The plain value Revert hands renameBoard / updateBoardMeta.
export function jsonbToPlain(v) {
  const u = unwrapMetaValue(v);
  if (u == null) return null;
  if (typeof u === 'string') return u;
  try { return JSON.parse(JSON.stringify(u)); } catch (_) { return u; }
}

// A value as text in the list: a dash for none.
function shown(v) {
  const u = unwrapMetaValue(v);
  if (u == null || u === '') return '—';
  return typeof u === 'object' ? JSON.stringify(u) : String(u);
}

// One whole sentence per row: name and background show before → after, the
// rest only say that they changed.
export function changeLine(row) {
  const field = row?.field;
  if (field === 'name') return tr`Name: “${ph({ before: shown(row.before_value) })}” → “${ph({ after: shown(row.after_value) })}”`;
  if (field === 'bg_color') return tr`Background: ${ph({ before: shown(row.before_value) })} → ${ph({ after: shown(row.after_value) })}`;
  if (field === 'cover') return tr`Cover changed`;
  if (field === 'view') return tr`View changed`;
  if (field === 'meta') return tr`Settings changed`;
  if (field === 'parent_board_id') return tr`Moved`;
  if (SCHEDULE_FIELDS.has(field)) return tr`Schedule changed`;
  return tr`${ph({ field: String(field ?? '') })} changed`;
}

// The toast after a revert, one message per revertible field.
export function revertedText(field) {
  if (field === 'name') return tr`Name restored.`;
  if (field === 'bg_color') return tr`Background restored.`;
  if (field === 'cover') return tr`Cover restored.`;
  if (field === 'view') return tr`View restored.`;
  return tr`Restored.`;
}
