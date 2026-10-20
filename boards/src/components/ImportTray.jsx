import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CaretDown, X, Pause, Play, Check, Warning, Clock } from '@phosphor-icons/react';
import { Icon } from './Icon.jsx';
import { subscribeImportJobs, importJobsSnapshot, trayEntries, dropImportJob } from '../lib/importJobs.js';
import { trayCopy } from '../lib/importCopy.js';
import './importTray.css';

// The bulk import's tray (the owner's pick A, 2026-10-19): bottom-right, just
// above the zoom control, showing the import that is going now and folding to
// a corner chip. Every word comes from lib/importCopy.js trayCopy() and every
// button calls the entry's own act(id); this file only draws them. Gold is on
// the paid step (.is-primary) and on focus, nowhere else.

const RING_C = 2 * Math.PI * 6;
const GLYPHS = { clock: Clock, pause: Pause, check: Check, warning: Warning, x: X };

// A rich line is strings and { b } runs: text and <b>, never markup from strings.
function Rich({ parts }) {
  return (parts || []).map((p, i) => (typeof p === 'string' ? p : <b key={i}>{p.b}</b>));
}

function Chip({ m, onOpen, aboveNav }) {
  const { chip } = m;
  const dash = chip.pct === null ? RING_C / 4 : (RING_C * chip.pct) / 100;
  const Glyph = GLYPHS[chip.icon];
  return (
    <button type="button" className={'imptray-chip' + (aboveNav ? ' is-above-nav' : '')}
            aria-label={chip.label} title={chip.label} onClick={onOpen}>
      {chip.kind === 'ring' ? (
        <svg className={chip.pct === null ? 'is-spin' : undefined} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block' }}>
          <circle className="imptray-ring-track" cx="8" cy="8" r="6" fill="none" strokeWidth="2" />
          <circle className="imptray-ring-arc" cx="8" cy="8" r="6" fill="none" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={`${dash} ${RING_C}`} transform="rotate(-90 8 8)" />
        </svg>
      ) : Glyph ? <Icon as={Glyph} size={14} weight="regular" /> : null}
      <span>{chip.text}</span>
    </button>
  );
}

export function ImportTray({ aboveNav = false, initialMinimized = false }) {
  const { list } = useSyncExternalStore(subscribeImportJobs, importJobsSnapshot, importJobsSnapshot);
  const { lead, more } = trayEntries(list);
  const [minimized, setMinimized] = useState(initialMinimized);
  const leadKey = lead?.key;
  // A new import opens expanded, whatever the last one was folded to.
  // (Not for the first import to show: initialMinimized is its own choice.)
  const seenKey = useRef(leadKey);
  useEffect(() => {
    const prev = seenKey.current;
    seenKey.current = leadKey;
    if (prev && leadKey && prev !== leadKey) setMinimized(false);
  }, [leadKey]);
  if (!lead) return null;

  const m = trayCopy(lead);
  const act = (id) => lead.act?.(id);
  if (minimized) return <Chip m={m} aboveNav={aboveNav} onOpen={() => setMinimized(false)} />;

  const fin = m.finished;
  return (
    <section className={'imptray' + (aboveNav ? ' is-above-nav' : '')} aria-label="Imports">
      <header className="imptray-head">
        <span className="imptray-title"><span aria-live="polite">{m.title}</span></span>
        {m.close === 'close' ? (
          <button type="button" className="imptray-ib" aria-label="Close" onClick={() => { act('close'); dropImportJob(lead.key); }}>
            <Icon as={X} size={13} weight="regular" />
          </button>
        ) : (
          <button type="button" className="imptray-ib" aria-label="Minimize" onClick={() => setMinimized(true)}>
            <Icon as={CaretDown} size={14} weight="regular" />
          </button>
        )}
      </header>

      <div className="imptray-sum">
        <div className="imptray-line"><Rich parts={m.line} /></div>
        {m.bar && (
          <div className={'imptray-bar' + (m.bar.reading ? ' is-reading' : '')} aria-hidden="true">
            <span style={m.bar.reading ? undefined : { width: `${m.bar.pct}%` }} />
          </div>
        )}
        {m.meta && <div className="imptray-meta">{m.meta}</div>}
        {fin && (
          <div className="imptray-row-actions">
            {fin.resume && (
              <button type="button" className="imptray-btn is-sm" onClick={() => act('resume')}>
                <Icon as={Play} size={13} weight="regular" />Resume
              </button>
            )}
            {fin.open && <button type="button" className="imptray-btn is-sm" onClick={() => act('open')}>{fin.open.label}</button>}
            {fin.remove && <button type="button" className="imptray-btn is-sm is-quiet" onClick={() => act('remove')}>Remove this import</button>}
          </div>
        )}
      </div>

      {m.rows.length > 0 && (
        <div className="imptray-list">
          {m.rows.map((r) => (
            <div key={r.key} className={'imptray-row' + (r.state === 'now' ? ' is-now' : r.state === 'later' ? ' is-later' : r.state === 'part' ? ' is-part' : '')}>
              <span className="ok">{r.state === 'done' && <Icon as={Check} size={12} weight="regular" />}</span>
              <span className="n">{r.name}</span>
              {r.state === 'now' && <span className="imptray-minibar" aria-hidden="true"><span style={{ width: `${r.pct}%` }} /></span>}
              <span className="c">{r.count}</span>
            </div>
          ))}
        </div>
      )}

      {m.wait && (
        <div className="imptray-wait">
          <div className="imptray-wait-text"><Rich parts={m.wait.text} /></div>
          {(m.wait.action || m.wait.aside) && (
            <div className="imptray-row-actions">
              {m.wait.action && (
                <button type="button" className="imptray-btn is-primary is-sm" onClick={() => act(m.wait.action.id)}>{m.wait.action.label}</button>
              )}
              {m.wait.aside && <span className="imptray-meta">{m.wait.aside}</span>}
            </div>
          )}
        </div>
      )}

      {m.fails && (
        <div className="imptray-fails">
          <div className="imptray-fails-head"><Icon as={Warning} size={14} weight="regular" />{m.fails.head}</div>
          {m.fails.list.map((f, i) => (
            <div key={i} className="imptray-fail"><span className="p" title={f.path}>{f.path}</span><span className="w">{f.why}</span></div>
          ))}
          {m.fails.more && <div className="imptray-meta">{m.fails.more}</div>}
          {m.fails.retry && (
            <div className="imptray-row-actions" style={{ marginTop: 6 }}>
              <button type="button" className="imptray-btn is-sm" onClick={() => act('retry')}>Try these again</button>
            </div>
          )}
        </div>
      )}

      {(m.foot || more > 0) && (
        <footer className="imptray-foot">
          {m.foot?.meta && <span className="imptray-meta">{m.foot.meta}</span>}
          {more > 0 && <span className="imptray-meta">{`${more} more ${more === 1 ? 'import' : 'imports'} after this`}</span>}
          <span className="imptray-gap" />
          {(m.foot?.actions || []).map((a) => (
            <button key={a.id} type="button" className="imptray-btn is-sm is-quiet" onClick={() => act(a.id)}>
              {a.icon === 'pause' && <Icon as={Pause} size={13} weight="regular" />}
              {a.icon === 'play' && <Icon as={Play} size={13} weight="regular" />}
              {a.label}
            </button>
          ))}
        </footer>
      )}
    </section>
  );
}
