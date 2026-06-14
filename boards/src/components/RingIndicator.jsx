// RingIndicator — a tiny fixed pill telling ring-eligible users which build
// they're on (latest vs stable) with a one-click switch. Invisible to everyone
// else: it renders only when on the latest build, or on prod for a user the
// server has confirmed eligible (ringEligible). Inline-styled to stay out of
// styles.css (which other sessions append to).
import { useState } from 'react';
import { onLatestBuild, ringEligible, ringJoin, ringLeave, setRingPref } from '../lib/ringAuto.js';

export function RingIndicator() {
  const latest = onLatestBuild();
  const [busy, setBusy] = useState(false);

  // Hide for non-eligible users on prod. (On the latest build you're eligible by
  // definition — the cookie got you here.)
  if (!latest && !ringEligible()) return null;

  const switchToStable = async () => {
    setBusy(true);
    setRingPref('stable');
    await ringLeave();
    window.location.reload();
  };
  const switchToLatest = async () => {
    setBusy(true);
    setRingPref('latest');
    const r = await ringJoin();
    if (r?.eligible === true) window.location.reload();
    else setBusy(false); // not eligible after all (e.g. tier changed) — stay put
  };

  const wrap = {
    position: 'fixed', bottom: 12, left: 12, zIndex: 2147483600,
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 10px', borderRadius: 999,
    font: '500 11px/1 ui-sans-serif, system-ui, -apple-system, sans-serif',
    color: '#fff', userSelect: 'none',
    background: latest ? 'rgba(180,120,0,0.92)' : 'rgba(40,40,46,0.92)',
    border: `1px solid ${latest ? 'rgba(255,190,80,0.6)' : 'rgba(255,255,255,0.18)'}`,
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)',
  };
  const dot = {
    width: 7, height: 7, borderRadius: '50%',
    background: latest ? '#ffd27a' : '#8a8a93',
    boxShadow: latest ? '0 0 6px #ffbe50' : 'none',
  };
  const btn = {
    background: 'transparent', color: 'inherit', cursor: busy ? 'default' : 'pointer',
    border: 'none', padding: 0, font: 'inherit', textDecoration: 'underline',
    opacity: busy ? 0.5 : 0.95,
  };

  return (
    <div style={wrap} title={latest ? 'You are previewing the latest (unreleased) build' : 'You are on the stable build'}>
      <span style={dot} />
      <span>{latest ? 'Latest build' : 'Stable build'}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      {latest
        ? <button style={btn} disabled={busy} onClick={switchToStable}>Switch to stable</button>
        : <button style={btn} disabled={busy} onClick={switchToLatest}>Switch to latest</button>}
    </div>
  );
}
