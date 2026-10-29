// AdminBoardsTab — the library of example boards the boards engine makes, with
// the shots (screenshots) you download to post.
//
// The engine (scripts/engine/run.mjs) writes a real board into the Showcase
// workspace, shoots it in the real app and files the shots with
// showcase_library() (migrations 0820 + 0821). The first ten wait here for a
// person's OK (showcase_decide); after that the engine's own checks are the gate.
//
// Every rule about what shows (the waiting list, the cluster counts, which shot
// answers which switch, the check lines, the links) lives in lib/showcaseLibrary.js.
// This file draws it.

import { useEffect, useMemo, useRef, useState } from 'react';
import './adminBoards.css';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import {
  libraryView, boardById, bigShot, viewsFor, shotGroups, downloadUrl, sizeLabel,
  usedOn, checkLines, linksFor, dayLabel, HAND_OKS,
} from '../../lib/showcaseLibrary.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';

const NO_FILTER = { q: '', cluster: 'all', theme: 'both', onPage: false };

// The open board lives in the URL (?board=<id>) so a reload or a pasted link
// lands on it. replaceState: opening a board is not a navigation worth a Back.
function readBoardParam() {
  try { return new URLSearchParams(window.location.search).get('board') || null; } catch { return null; }
}
function writeBoardParam(id) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('board', id); else url.searchParams.delete('board');
    window.history.replaceState({}, '', url);
  } catch { /* ignore */ }
}

const metaLine = (b) => [
  b.cluster,
  b.cards != null ? `${b.cards} cards` : null,
  dayLabel(b.made_at) || null,
].filter(Boolean).join(' · ');

const safeLink = (href) => (/^https?:\/\//i.test(String(href || '')) ? href : null);

export function AdminBoardsTab({ onWaitingChange }) {
  const feedback = useFeedback();
  const [filter, setFilter] = useState(NO_FILTER);
  const [openId, setOpenId] = useState(readBoardParam);
  const [selectedId, setSelectedId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const { data, loading, error, hasData, refresh } = useAdminData(async () => {
    const { data: lib, error: err } = await supabase.rpc('showcase_library');
    if (err) throw err;
    return lib || { boards: [], ok_by_person: 0, last_run: null };
  }, []);

  const view = useMemo(() => libraryView(data, filter), [data, filter]);

  // The Boards pill's badge follows the waiting list, not a second read.
  const waitingRef = useRef(onWaitingChange);
  waitingRef.current = onWaitingChange;
  useEffect(() => {
    if (data !== undefined) waitingRef.current?.(view.waiting.length);
  }, [data, view.waiting.length]);

  const open = (id) => {
    setOpenId(id);
    if (id) setSelectedId(id);
    writeBoardParam(id);
    try { document.querySelector('.admin-body')?.scrollTo?.({ top: 0 }); } catch { /* ignore */ }
  };

  const decide = async (b, status, announce = true) => {
    if (busyId) return;
    setBusyId(b.board_id);
    try {
      const { error: err } = await supabase.rpc('showcase_decide', { p_board_id: b.board_id, p_status: status });
      if (err) throw err;
      if (announce) {
        feedback.toast({
          type: 'success',
          message: status === 'ok' ? `OK’d “${b.title}”` : `Skipped “${b.title}”`,
          action: { label: 'Undo', onClick: () => decide(b, 'new', false) },
        });
      }
      await refresh();
    } catch (e) {
      feedback.toast({ type: 'error', code: 'admin_showcase_decide_failed', message: `Couldn’t save that: ${e?.message || e}` });
    } finally {
      setBusyId(null);
    }
  };

  const copyLink = async (b) => {
    const l = linksFor(b);
    try {
      await navigator.clipboard.writeText(window.location.origin + (l.live || l.app));
      feedback.toast({ type: 'success', message: 'Link copied' });
    } catch {
      feedback.toast({ type: 'error', code: 'admin_copy_failed', message: 'Copy failed' });
    }
  };

  const openBoard = openId && hasData ? boardById(data, openId) : null;
  // A ?board= that matches nothing (deleted, mistyped) falls back to the grid.
  useEffect(() => {
    if (openId && hasData && !openBoard) open(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, hasData, openBoard]);

  return (
    <div className="ab">
      <AdminAsync
        loading={loading}
        error={error}
        hasData={hasData}
        onRetry={refresh}
        skeleton={<AdminSkeleton variant="cards" rows={4} />}
      >
        {openBoard ? (
          <BoardDetail
            key={openBoard.board_id}
            board={openBoard}
            busy={busyId === openBoard.board_id}
            onBack={() => open(null)}
            onDecide={decide}
            onCopy={copyLink}
          />
        ) : (
          <BoardGrid
            view={view}
            filter={filter}
            setFilter={setFilter}
            selectedId={selectedId}
            busyId={busyId}
            onOpen={open}
            onDecide={decide}
          />
        )}
      </AdminAsync>
    </div>
  );
}

// ── The tab: header, waiting panel, bar, grid ─────────────────────────────

function BoardGrid({ view, filter, setFilter, selectedId, busyId, onOpen, onDecide }) {
  const { engine, totals, waiting, firstTen, tiles } = view;
  const filtered = !!(filter.q || filter.cluster !== 'all' || filter.theme !== 'both' || filter.onPage);
  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));

  return (
    <>
      <div className="ab-top">
        <div>
          <h1 className="ab-h1">Boards</h1>
          <div className="ab-sub">
            {totals.boards} boards · {totals.shots} shots · made by the boards engine from real photos
          </div>
        </div>
        <div className="ab-engine" role="status" data-tone={engine.tone}>
          <i className="ab-engine-dot" aria-hidden="true" />
          <b>{engine.text}</b>
          {engine.detail ? <span>· {engine.detail}</span> : null}
        </div>
      </div>

      {waiting.length > 0 && (
        <section className="ab-wait" aria-label="Waiting for your OK">
          <div className="ab-wait-h">
            <b>Waiting for your OK · {waiting.length}</b>
            {!firstTen.finished && (
              <div className="ab-prog">
                First ten: {firstTen.done} OK’d
                <span className="ab-pips" aria-hidden="true">
                  {Array.from({ length: HAND_OKS }).map((_, i) => <i key={i} className={i < firstTen.done ? 'd' : ''} />)}
                </span>
                then it runs by itself
              </div>
            )}
          </div>
          <div className="ab-wgrid">
            {waiting.map((b) => (
              <div className="ab-wcard" key={b.board_id}>
                <div className="ab-thumb ab-wthumb">
                  {b.thumb ? <img className="ab-fill" src={b.thumb} alt="" loading="lazy" /> : null}
                </div>
                <div className="ab-wmeta">
                  <div className="ab-t">{b.title}</div>
                  <div className="ab-for">
                    {b.page_path ? <>For <code>{b.page_path}</code></> : 'For marketing'}
                  </div>
                  <div className="ab-checks">
                    ✓ Passed every check{b.photos ? ` · ${b.photos} real photos` : ''}
                  </div>
                  <div className="ab-acts">
                    <button type="button" className="ab-btn ab-pri" disabled={!!busyId} onClick={() => onDecide(b, 'ok')}>OK</button>
                    <button type="button" className="ab-btn" disabled={!!busyId} onClick={() => onDecide(b, 'skipped')}>Skip</button>
                    <button type="button" className="ab-btn ab-ghost" onClick={() => onOpen(b.board_id)} aria-label={`Open ${b.title}`}>Open</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="ab-bar">
        <label className="ab-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={filter.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search boards, subjects, pages…"
            aria-label="Search boards"
          />
        </label>
        <div className="ab-chips" role="group" aria-label="Cluster">
          {view.clusters.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`ab-chip${view.cluster === c.id ? ' is-on' : ''}`}
              aria-pressed={view.cluster === c.id}
              onClick={() => set({ cluster: c.id })}
            >
              {c.label}<em>{c.count}</em>
            </button>
          ))}
        </div>
        <Seg
          label="Theme"
          value={view.theme}
          onChange={(v) => set({ theme: v })}
          options={[{ id: 'both', label: 'Both' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]}
        />
        <button
          type="button"
          className={`ab-chip${filter.onPage ? ' is-on' : ''}`}
          aria-pressed={filter.onPage}
          onClick={() => set({ onPage: !filter.onPage })}
        >
          On a search page<em>{view.onPageCount}</em>
        </button>
      </div>

      {tiles.length > 0 ? (
        <div className="ab-grid">
          {tiles.map((b) => <Tile key={b.board_id} b={b} selected={selectedId === b.board_id} onOpen={onOpen} />)}
        </div>
      ) : filtered ? (
        <div className="ab-empty">
          <b>No boards match</b>
          <span>Nothing in the library fits that search.</span>
          <button type="button" className="ab-btn" onClick={() => setFilter(NO_FILTER)}>Clear filters</button>
        </div>
      ) : (
        <div className="ab-empty">
          <b>{waiting.length ? 'Nothing OK’d yet' : 'No boards yet'}</b>
          <span>
            {waiting.length
              ? 'OK a board above and it lands here with its shots.'
              : 'The engine hasn’t made any boards yet. The first ones wait here for your OK.'}
          </span>
        </div>
      )}
    </>
  );
}

function Tile({ b, selected, onOpen }) {
  const zip = shotGroups(b).zip;
  const zipHref = zip ? downloadUrl(b, zip) : null;
  return (
    <article className={`ab-tile${selected ? ' is-sel' : ''}`}>
      <button type="button" className="ab-tile-main" onClick={() => onOpen(b.board_id)} aria-label={b.title}>
        <span className="ab-thumb ab-tthumb">
          {b.thumb ? <img className="ab-fill" src={b.thumb} alt="" loading="lazy" /> : null}
        </span>
        <span className="ab-tmeta">
          <span className="ab-t">{b.title}</span>
          <span className="ab-m">{metaLine(b)}</span>
          {b.page_path
            ? <span className={`ab-tag${b.live ? ' is-live' : ''}`}>On {b.page_path}</span>
            : <span className="ab-tag">Library only</span>}
        </span>
      </button>
      <div className="ab-hover">
        {zipHref && <a className="ab-btn ab-sm" href={zipHref} download aria-label={`Download shots for ${b.title}`}>↓ Shots</a>}
        <button type="button" className="ab-btn ab-sm" onClick={() => onOpen(b.board_id)} aria-label={`Open ${b.title}`}>Open</button>
      </div>
    </article>
  );
}

function Seg({ label, value, onChange, options }) {
  return (
    <div className="ab-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={value === o.id ? 'is-on' : ''}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── One board, opened ─────────────────────────────────────────────────────

function BoardDetail({ board: b, busy, onBack, onDecide, onCopy }) {
  const [theme, setTheme] = useState('light');
  const [viewId, setViewId] = useState(null);
  const [closeOpen, setCloseOpen] = useState(false);

  const views = viewsFor(b);
  const view = views.find((v) => v.id === viewId)?.id || views[0]?.id || 'app';
  const big = bigShot(b, view, theme);
  const groups = shotGroups(b);
  const links = linksFor(b);
  const used = usedOn(b);
  const credits = b.credits || [];
  const zipHref = groups.zip ? downloadUrl(b, groups.zip) : null;

  const status = b.status === 'new'
    ? 'waiting for your OK'
    : b.status === 'skipped'
      ? 'skipped'
      : b.decided_by_person ? 'OK’d by you' : 'OK’d by the engine';
  const meta = [b.cluster, b.cards != null ? `${b.cards} cards` : null, `made ${dayLabel(b.made_at)}`, status]
    .filter(Boolean).join(' · ');

  return (
    <div className="ab-det">
      <div className="ab-det-l">
        <nav className="ab-crumbs" aria-label="Breadcrumb">
          <button type="button" className="ab-crumb-back" onClick={onBack}>← Boards</button>
          <span aria-hidden="true">/</span>
          <b>{b.title}</b>
        </nav>
        <div className="ab-row">
          <Seg
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]}
          />
          {views.length > 1 && (
            <Seg
              label="View"
              value={view}
              onChange={setViewId}
              options={views.map((v) => ({ id: v.id, label: v.label }))}
            />
          )}
        </div>
        <div className="ab-big">
          {big ? <img src={big.url} alt={b.title} /> : <div className="ab-big-none">No picture for this view yet</div>}
        </div>
      </div>

      <div className="ab-det-r">
        <div>
          <h2 className="ab-h2">{b.title}</h2>
          <div className="ab-m ab-meta-line">{meta}</div>
        </div>

        <div className="ab-row">
          {b.status === 'new' && (
            <>
              <button type="button" className="ab-btn ab-pri" disabled={busy} onClick={() => onDecide(b, 'ok')}>OK</button>
              <button type="button" className="ab-btn" disabled={busy} onClick={() => onDecide(b, 'skipped')}>Skip</button>
            </>
          )}
          <a className={`ab-btn${b.status === 'new' ? '' : ' ab-pri'}`} href={links.app} target="_blank" rel="noopener noreferrer">Open in the app</a>
          {links.live && <a className="ab-btn" href={links.live} target="_blank" rel="noopener noreferrer">Open live ↗</a>}
          <a className="ab-btn" href={links.capture} target="_blank" rel="noopener noreferrer">Capture</a>
          <button type="button" className="ab-btn ab-ghost" onClick={() => onCopy(b)}>Copy link</button>
        </div>

        <section className="ab-sec" aria-label="Shots">
          <h3>
            Shots
            {zipHref && <a className="ab-btn ab-sm" href={zipHref} download>↓ All (zip)</a>}
          </h3>
          <ul className="ab-shots">
            {groups.shots.map((s) => (
              <li className="ab-shot" key={`${s.kind}-${s.file}`}>
                <div className="ab-pv"><img src={s.thumb_url || s.url} alt="" loading="lazy" /></div>
                <div className="ab-nm">{s.label || s.kind}</div>
                <div className="ab-dl">
                  <span className="ab-sz">{sizeLabel(s)}</span>
                  <a className="ab-dlb" href={downloadUrl(b, s)} download aria-label={`Download ${s.label || s.kind}`}>↓</a>
                </div>
              </li>
            ))}
            {groups.closeUps.length > 0 && (
              <li className="ab-shot">
                <div className="ab-pv ab-checker">
                  <img src={groups.closeUps[0].thumb_url || groups.closeUps[0].url} alt="" loading="lazy" />
                </div>
                <div className="ab-nm">Close-ups · {groups.closeUps.length}</div>
                <div className="ab-dl">
                  <span className="ab-sz">cut-out PNGs</span>
                  <button
                    type="button"
                    className="ab-dlb"
                    aria-expanded={closeOpen}
                    aria-controls="ab-closeups"
                    aria-label={closeOpen ? 'Hide close-ups' : 'Show close-ups'}
                    onClick={() => setCloseOpen((v) => !v)}
                  >
                    {closeOpen ? '▴' : '▾'}
                  </button>
                </div>
              </li>
            )}
          </ul>
          {closeOpen && groups.closeUps.length > 0 && (
            <ul className="ab-shots ab-closeups" id="ab-closeups">
              {groups.closeUps.map((s, i) => (
                <li className="ab-shot" key={`${s.file}-${i}`}>
                  <div className="ab-pv ab-checker"><img src={s.thumb_url || s.url} alt="" loading="lazy" /></div>
                  <div className="ab-nm">{s.label || `Close-up ${i + 1}`}</div>
                  <div className="ab-dl">
                    <span className="ab-sz">{sizeLabel(s)}</span>
                    <a className="ab-dlb" href={downloadUrl(b, s)} download aria-label={`Download ${s.label || `close-up ${i + 1}`}`}>↓</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {used.length > 0 && (
          <section className="ab-sec" aria-label="Used on">
            <h3>Used on</h3>
            <dl className="ab-kv">
              {used.map((u) => (
                <div key={`${u.label}-${u.path}`} className="ab-kv-row">
                  <dt>{u.label}</dt>
                  <dd><a href={u.path} target="_blank" rel="noopener noreferrer">{u.path}</a></dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="ab-sec" aria-label="Engine check">
          <h3>Engine check</h3>
          <ul className="ab-okl">
            {checkLines(b).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>

        {credits.length > 0 && (
          <section className="ab-sec" aria-label="Photo credits">
            <h3>Photo credits</h3>
            <ul className="ab-credits">
              {credits.map((c, i) => {
                const href = safeLink(c.link);
                return (
                  <li key={c.id || i}>
                    {href
                      ? <a href={href} target="_blank" rel="noopener noreferrer">{c.name || c.source || 'Photo'}</a>
                      : (c.name || c.source || 'Photo')}
                    {c.source && c.name ? <span> · {c.source}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
