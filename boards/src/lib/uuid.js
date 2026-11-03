// One answer to "is this a uuid?". A uuid column refuses anything else with
// 22P02 and the whole request fails, and a doc card's id on a board is not
// always one (`doc-…`), so a read or delete keyed on it must ask first.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}
