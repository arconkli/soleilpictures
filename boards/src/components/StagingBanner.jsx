// StagingBanner — a tiny fixed pill telling eligible users which build they're
// on, with a one-click switch. On the preview host it always shows ("Latest
// build · Exit to stable"). On the prod host it shows ONLY for an eligible user
// who has opted to stay on stable ("Preview the latest build"), so normal users
// never see it. Inline-styled to stay out of styles.css (other sessions append
// to it). See lib/stagingRedirect.js.
//
// It can be COLLAPSED to just its status dot, because at bottom-left with a
// z-index above everything it sits on top of whatever a panel puts in that
// corner — Settings → Display was the report.
//
// Collapsed still renders the dot, deliberately: this pill is the only thing
// telling you the build you are looking at is not the one your users have, and
// a control that can hide that completely is how someone ends up filing a bug
// against preview believing it is production. The dot keeps its colour, keeps
// its tooltip, and clicking it brings the pill back.
import { useState, useEffect } from 'react';
import { onProdHost, onPreviewHost, getStagingTarget, stablePref, exitToStable, switchToLatest } from '../lib/stagingRedirect.js';

// Per device, like the other one-off UI prefs. Read-fail defaults to EXPANDED —
// the inverse of the hint modules' "read-fail = seen", because their failure
// mode is nagging and this one's is concealing which build you are on.
const COLLAPSE_KEY = 'soleil.stagingCollapsed';
function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_) { return false; }
}
function writeCollapsed(v) {
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch (_) {}
}

export function StagingBanner() {
  const preview = onPreviewHost();
  // On prod, only reveal the "switch to latest" affordance to an eligible user
  // (target != null) who opted out. The auto-redirect already ran getStagingTarget,
  // so this shares its memoized result — no extra round-trip.
  const [showProdSwitch, setShowProdSwitch] = useState(false);
  useEffect(() => {
    if (!onProdHost() || !stablePref()) return;
    let live = true;
    getStagingTarget().then((t) => { if (live) setShowProdSwitch(!!t); });
    return () => { live = false; };
  }, []);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const collapse = (v) => { setCollapsed(v); writeCollapsed(v); };

  if (!preview && !showProdSwitch) return null;

  const wrap = {
    position: 'fixed', bottom: 12, left: 12, zIndex: 2147483600,
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 10px', borderRadius: 999,
    font: '500 11px/1 ui-sans-serif, system-ui, -apple-system, sans-serif',
    color: '#fff', userSelect: 'none',
    background: preview ? 'rgba(180,120,0,0.92)' : 'rgba(40,40,46,0.92)',
    border: `1px solid ${preview ? 'rgba(255,190,80,0.6)' : 'rgba(255,255,255,0.18)'}`,
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)',
  };
  const dot = {
    width: 7, height: 7, borderRadius: '50%',
    background: preview ? '#ffd27a' : '#8a8a93',
    boxShadow: preview ? '0 0 6px #ffbe50' : 'none',
  };
  const btn = {
    background: 'transparent', color: 'inherit', cursor: 'pointer',
    border: 'none', padding: 0, font: 'inherit', textDecoration: 'underline', opacity: 0.95,
  };
  // The minimise affordance. Not underlined like the action links — it is
  // chrome, not the thing the pill is here to offer.
  const minBtn = {
    background: 'transparent', color: 'inherit', cursor: 'pointer',
    border: 'none', padding: '0 0 0 2px', marginLeft: 2, lineHeight: 1,
    font: '600 13px/1 ui-sans-serif, system-ui, sans-serif', opacity: 0.55,
  };
  const title = preview
    ? "You're previewing the latest, unreleased build"
    : "You're on the stable build";

  if (collapsed) {
    // Dot only — same corner, same colour, same tooltip. Sized for a real
    // click target rather than the 7px indicator it wraps.
    return (
      <button
        type="button"
        onClick={() => collapse(false)}
        title={`${title} — click to expand`}
        aria-label={`${preview ? 'Latest build' : 'Stable build'} — expand build switcher`}
        style={{
          position: 'fixed', bottom: 12, left: 12, zIndex: 2147483600,
          width: 20, height: 20, borderRadius: '50%', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: preview ? 'rgba(180,120,0,0.92)' : 'rgba(40,40,46,0.92)',
          border: `1px solid ${preview ? 'rgba(255,190,80,0.6)' : 'rgba(255,255,255,0.18)'}`,
          boxShadow: '0 2px 10px rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)',
        }}>
        <span style={dot} />
      </button>
    );
  }

  return (
    <div style={wrap} title={title}>
      <span style={dot} />
      <span>{preview ? 'Latest build' : 'Stable'}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <button style={btn} onClick={preview ? exitToStable : switchToLatest}>
        {preview ? 'Exit to stable' : 'Preview the latest build'}
      </button>
      <button style={minBtn} onClick={() => collapse(true)}
              title="Minimise to a dot" aria-label="Minimise build switcher">−</button>
    </div>
  );
}
