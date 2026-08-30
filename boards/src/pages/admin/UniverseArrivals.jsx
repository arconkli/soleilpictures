// UniverseArrivals — the last few things that appeared, and a way back to them.
//
// This exists because of an arithmetic problem, not a design one. The platform
// creates a node roughly once every twenty minutes. When one lands it gets a
// shockwave, a flash and a minute of afterglow — but all of that happens at one
// point in a field of several thousand, and you were probably looking somewhere
// else. An effect you have to already be watching is not an answer to "I want
// to see new nodes appear".
//
// So arrivals also become a list. Miss the ring and the thing is still here,
// with its kind, its colour and its age, one click from having the camera flown
// to it. The ephemeral channel is for when you happen to be looking; this is
// for the other nineteen minutes.
//
// Deliberately capped and deliberately not scrollable: it is a tail, not a log.
// The full history lives in the admin tabs that exist for it.

import { useEffect, useState } from 'react';
import { KIND_COLORS } from './UniverseGraph.jsx';

const CAP = 8;

const LABELS = {
  user: 'User', ws: 'Workspace', board: 'Board', doc: 'Doc', note: 'Note',
  image: 'Image', palette: 'Palette', link: 'Link', grid: 'Grid',
  url: 'External link', boardlink: 'Board link', card: 'Card',
};

function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 10)    return 'just now';
  if (s < 60)    return `${Math.round(s)}s ago`;
  if (s < 3600)  return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Track arrivals in a small ring. Exposed as a hook so the shell owns the state
// and the panel stays a pure render — the same split the legend uses.
export function useArrivals() {
  const [items, setItems] = useState([]);
  const push = (node) => {
    setItems((prev) => {
      if (prev.some((p) => p.id === node.id)) return prev;
      return [{
        id: node.id,
        kind: node.cardKind && KIND_COLORS[node.cardKind] ? node.cardKind : node.kind,
        color: node.color,
        at: Date.now(),
      }, ...prev].slice(0, CAP);
    });
  };
  return [items, push];
}

export function UniverseArrivals({ items, onFocus, streamStatus, pulse }) {
  // Ages are the whole point of the panel, so they have to keep counting even
  // when nothing new arrives — which, here, is most of the time.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const down = streamStatus === 'reconnecting';

  // The activity line is what keeps this panel meaningful during the long
  // stretches with no arrivals: creation is rare, but people are doing things
  // far more often, and the age of the last event is the difference between "a
  // quiet platform" and "a dead connection".
  const lastAgo = pulse?.lastEventAt ? ago(pulse.lastEventAt) : null;

  return (
    <div className="universe-arrivals surface-frosted" aria-label="Recent arrivals">
      <div className="universe-arrivals-head">
        <span className={`universe-arrivals-dot ${down ? 'is-down' : ''}`} />
        <span className="t-eyebrow">{down ? 'Reconnecting' : 'Live'}</span>
      </div>
      {pulse && !down && (
        <div className="universe-arrivals-pulse t-meta">
          {pulse.total > 0
            ? <>{pulse.total} events · 60m{lastAgo ? <> · last {lastAgo}</> : null}</>
            : 'No activity in the last hour'}
        </div>
      )}
      {items.length === 0 ? (
        // Never "no activity" — that is a claim about the platform. This is a
        // claim about the window you have been watching, which is all the panel
        // can honestly know, and it says how sparse the truth is so a still
        // screen does not read as a broken one.
        <div className="universe-arrivals-empty t-meta">
          {down
            ? 'Stream is down — reconnecting.'
            : 'Nothing new since you opened this. The platform adds a node every ~20 minutes.'}
        </div>
      ) : (
        <ul className="universe-arrivals-list">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" className="universe-arrival" onClick={() => onFocus(it.id)}
                      title="Fly the camera here">
                <span className="universe-arrival-dot" style={{ background: it.color }} />
                <span className="universe-arrival-kind">{LABELS[it.kind] || it.kind}</span>
                <span className="universe-arrival-age">{ago(it.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
