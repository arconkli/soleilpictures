import { useEffect, useRef, useState } from 'react';
import TogetherChip from '../components/TogetherChip.jsx';

// Dev-only Together chip harness (?togetherqa=1). The real <TogetherChip> in
// each state, in a strip that looks like the top bar, for tests/together-chip.spec.js
// and design review. Dropped from production by main.jsx's import.meta.env.DEV guard.
const base = { on: true, since: 1, at: 1, startedCapped: false, base: 0, roomEarned: 0, earned: 0, peers: ['u-lena'], boost: 1, month: 4, cap: 25, capped: false, progress: 0.3 };
const PEERS = [
  { key: 'a', user: { id: 'u-lena', name: 'Lena', email: 'lena@example.com', color: '#ec4899' } },
  { key: 'b', user: { id: 'u-sam', name: 'Sam', email: 'sam@example.com', color: '#10b981' } },
  { key: 'c', user: { id: 'u-ola', name: 'Ola', email: 'ola@example.com', color: '#4f8df8' } },
  { key: 'd', user: { id: 'u-kit', name: 'Kit', email: 'kit@example.com', color: '#f59e0b' } },
];

const STATES = [
  { id: 'one-zero', label: '1. One other, no cards yet', state: { ...base } },
  { id: 'one-open', label: '2. One other, +3 cards, open', open: true, state: { ...base, earned: 3, month: 7, progress: 0.6 } },
  { id: 'two-open', label: '3. Two others, open', open: true, state: { ...base, peers: ['u-lena', 'u-sam'], boost: 2, earned: 4, month: 9 } },
  { id: 'three-open', label: '4. Three others, open', open: true, state: { ...base, peers: ['u-lena', 'u-sam', 'u-ola'], boost: 3, earned: 6, month: 12, progress: 0.8 } },
  { id: 'capped-open', label: '5. Capped mid-stretch, open', open: true, state: { ...base, earned: 5, month: 25, capped: true, progress: 0 } },
  { id: 'phone', label: '6. Phone (compact), +3', compact: true, state: { ...base, earned: 3, month: 7, progress: 0.6 } },
  { id: 'unknown-open', label: '7. Unknown peer', open: true, state: { ...base, peers: ['u-gone'], earned: 1, month: 5 } },
];

function Strip({ item }) {
  const ref = useRef(null);
  const opened = useRef(false);
  useEffect(() => {
    // StrictMode runs this twice before React re-renders: open once.
    if (!item.open || opened.current) return;
    opened.current = true;
    ref.current?.querySelector('.tg-chip')?.click();
  }, [item.open]);
  return (
    <div className="qa-box" data-qa={item.id}>
      <div className="qa-label">{item.label}</div>
      <div className="qa-strip" ref={ref} style={item.compact ? { width: 280 } : undefined}>
        <span className="qa-fill" />
        <TogetherChip state={item.state} peers={PEERS} selfId="u-me" compact={!!item.compact} />
      </div>
    </div>
  );
}

export function TogetherQaHarness() {
  // ?theme=light starts in the light theme (a click on the toggle would count
  // as an outside press and close the open popovers).
  const [light, setLight] = useState(() => new URLSearchParams(window.location.search).get('theme') === 'light');
  const [toast, setToast] = useState(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  }, [light]);
  useEffect(() => {
    document.getElementById('root')?.setAttribute('data-togetherqa-ready', '1');
  }, []);

  const arrive = () => {
    try { localStorage.removeItem('soleil:together-note-day'); } catch (_) {}
    setToast(null);
    setRound((n) => n + 1);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', color: 'var(--ink-1)', padding: 20, font: '13px var(--font-sans)' }}>
      <style>{`
        .qa-box{margin:0 0 14px;max-width:480px}
        .qa-label{font:500 11px/1 var(--font-sans);color:var(--ink-3);margin-bottom:6px}
        .qa-strip{display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;border:1px solid var(--line-1);border-radius:8px;background:var(--bg-1)}
        .qa-fill{flex:1}
        .qa-open-wrap[data-open="1"] .qa-box{min-height:280px}
        .qa-toast{position:fixed;right:20px;bottom:20px;max-width:320px;padding:10px 14px;border-radius:10px;background:var(--bg-2);border:1px solid var(--line-2);color:var(--ink-0)}
      `}</style>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" data-qa-theme onClick={() => setLight((v) => !v)}>{light ? 'Dark' : 'Light'} theme</button>
        <button type="button" data-qa-arrive onClick={arrive}>Arrive</button>
      </div>
      {STATES.map((item) => (
        <div key={item.id} data-open={item.open ? 1 : 0} className="qa-open-wrap">
          <Strip item={item} />
        </div>
      ))}
      <div className="qa-box" data-qa="arrival">
        <div className="qa-label">8. Arrival note (press Arrive)</div>
        <div className="qa-strip">
          <span className="qa-fill" />
          {round > 0 && (
            <TogetherChip key={round} state={{ ...base, since: round, earned: 0 }} peers={PEERS} selfId="u-me"
                          onArrive={(message) => setToast(message)} />
          )}
        </div>
      </div>
      {toast && <div className="qa-toast" role="status" data-qa-toast>{toast}</div>}
    </div>
  );
}
