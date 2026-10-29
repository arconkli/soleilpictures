// boardMoreEpoch.js — the part of the first-board test App's own chunk needs:
// whether this account could be in it at all, so the rest (lib/boardMore.js,
// components/BoardMoreNudge.jsx) is fetched only for those who could. A module
// goes whole into one chunk, so this stays a leaf.

// The test starts here: accounts made from this instant on (2026-10-29 07:00Z;
// moved up from 11-06 on the owner's "start ASAP", the setup test's coin being
// independent of this one). The saved read starts at the same
// instant.
export const BOARD_MORE_EPOCH = '2026-10-29T07:00:00Z';
export const BOARD_MORE_OVERRIDE_PARAM = 'more';
export const BOARD_MORE_OVERRIDE_KEY = 'soleil.more.override';

// New enough for the test, or a QA override is set for this tab (the caller
// says whether overrides are allowed here: dev and the preview deploy).
export function boardMoreMayRun({ createdAt, search, storage, qaAllowed } = {}) {
  const created = Date.parse(createdAt || '');
  if (Number.isFinite(created) && created >= Date.parse(BOARD_MORE_EPOCH)) return true;
  if (!qaAllowed) return false;
  try {
    const v = new URLSearchParams(search || '').get(BOARD_MORE_OVERRIDE_PARAM);
    if (v && /^[ab]$/i.test(v.trim())) return true;
  } catch (_) { /* fall through */ }
  try {
    const kept = storage?.getItem(BOARD_MORE_OVERRIDE_KEY);
    return kept === 'A' || kept === 'B';
  } catch (_) { return false; }
}
