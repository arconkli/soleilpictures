// The review player's remembered settings, per device: speed, volume, mute,
// the last framing guide, and how the timecode reads. Storage can throw
// (private mode, blocked site data) — every read falls back to the default.
const KEY = 'soleil.player.prefs';
export const PREF_DEFAULTS = { rate: 1, volume: 1, muted: false, guide: '2.39', tcMode: null };

function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

export function readPrefs(storage = store()) {
  try {
    const raw = storage?.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ...PREF_DEFAULTS };
    const out = { ...PREF_DEFAULTS };
    if (Number.isFinite(p.rate) && p.rate >= 0.1 && p.rate <= 4) out.rate = p.rate;
    if (Number.isFinite(p.volume) && p.volume >= 0 && p.volume <= 1) out.volume = p.volume;
    if (typeof p.muted === 'boolean') out.muted = p.muted;
    if (typeof p.guide === 'string' && p.guide.length < 12) out.guide = p.guide;
    if (['tc', 'clip', 'frames', 'seconds'].includes(p.tcMode)) out.tcMode = p.tcMode;
    return out;
  } catch (_) {
    return { ...PREF_DEFAULTS };
  }
}

export function writePrefs(patch, storage = store()) {
  try {
    const next = { ...readPrefs(storage), ...patch };
    storage?.setItem(KEY, JSON.stringify(next));
    return next;
  } catch (_) {
    return null;
  }
}
