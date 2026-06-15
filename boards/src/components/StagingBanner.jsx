// StagingBanner — a tiny fixed pill telling eligible users which build they're
// on, with a one-click switch. On the preview host it always shows ("Latest
// build · Exit to stable"). On the prod host it shows ONLY for an eligible user
// who has opted to stay on stable ("Preview the latest build"), so normal users
// never see it. Inline-styled to stay out of styles.css (other sessions append
// to it). See lib/stagingRedirect.js.
import { useState, useEffect } from 'react';
import { onProdHost, onPreviewHost, getStagingTarget, stablePref, exitToStable, switchToLatest } from '../lib/stagingRedirect.js';

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

  return preview ? (
    <div style={wrap} title="You're previewing the latest, unreleased build">
      <span style={dot} />
      <span>Latest build</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <button style={btn} onClick={exitToStable}>Exit to stable</button>
    </div>
  ) : (
    <div style={wrap} title="You're on the stable build">
      <span style={dot} />
      <span>Stable</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <button style={btn} onClick={switchToLatest}>Preview the latest build</button>
    </div>
  );
}
