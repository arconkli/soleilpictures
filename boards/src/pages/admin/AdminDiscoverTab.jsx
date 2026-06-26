// AdminDiscoverTab — curate admin-only public marketing boards (migration 0136).
//
// Promote any board to a clean, keyword-rich, search-indexable page at
// /c/<slug> with its own SEO copy (title, meta description, body, target
// keyword). Publishing makes it live + sitemapped + indexable; unpublishing
// 404s it and de-indexes it (the slug stays reserved). All writes go through
// is_admin()-gated RPCs — the UI gate here is cosmetic.
//
// Master-detail: left = published + draft boards (+ "add a board" by pasting a
// board id or a /share/<link>); right = the SEO editor with guardrails.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { adminListPublicBoards, adminSetPublicBoard, adminUnpublishBoard,
  aiDraftBoardSeo, aiGenerateBoardAlts, pingIndexNow,
  adminPublicBoardStats, adminImportGscCsv } from '../../lib/boardsApi.js';

const SITE_ORIGIN = 'https://clusters.soleilpictures.com';
// Mirror of the DB CHECK (migration 0136) so the UI flags problems before the
// round-trip; the DB is still the real gate.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(['c', 'explore', 'share', 'pricing', 'legal', 'api', 'assets', 'admin',
  'robots', 'sitemap', 'app', 'auth', 'login', 'signup', 'board', 'boards', 'favicon', '_headers']);
const UUID_RE = /^[0-9a-f-]{36}$/i;
const TITLE_MAX = 60;
const DESC_MAX = 155;
const NEW = '__new__';
const EMPTY = { slug: '', seoTitle: '', seoDescription: '', seoBody: '', targetKeyword: '', priority: 0 };

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function slugError(slug) {
  if (!slug) return 'Slug is required';
  if (slug.length > 80) return 'Too long (max 80)';
  if (!SLUG_RE.test(slug)) return 'Lowercase letters, numbers and single hyphens only';
  if (RESERVED.has(slug)) return 'That word is reserved';
  return null;
}
// Parse a pasted board id or /share/<token> URL → { boardId } | { shareToken } | null.
function parseBoardRef(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/share\/([0-9a-f-]{36})/i);
  if (m) return { shareToken: m[1] };
  if (UUID_RE.test(s)) return { boardId: s };
  return null;
}

// Tolerant parse of a Google Search Console "Pages" CSV export → clean rows.
// Only rows whose page URL contains /c/<slug> are kept by the server importer.
function parseGscCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l) => {
    const out = []; let cur = ''; let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const idx = (names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const pi = idx(['page', 'url', 'address', 'landing']);
  const ci = idx(['click']);
  const ii = idx(['impress']);
  const ti = idx(['ctr']);
  const oi = idx(['position']);
  const num = (v) => { const n = parseFloat(String(v || '').replace(/[%,]/g, '')); return Number.isNaN(n) ? null : n; };
  const rows = [];
  for (let k = 1; k < lines.length; k++) {
    const c = split(lines[k]);
    const page = pi >= 0 ? c[pi] : c[0];
    if (!page) continue;
    rows.push({
      page,
      clicks: ci >= 0 ? (num(c[ci]) || 0) : 0,
      impressions: ii >= 0 ? (num(c[ii]) || 0) : 0,
      ctr: ti >= 0 ? num(c[ti]) : null,
      position: oi >= 0 ? num(c[oi]) : null,
    });
  }
  return rows;
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--border, #2a2722)', background: 'var(--bg-0, #0a0908)',
  color: 'var(--text, #e8e4dc)', font: 'inherit',
};
const labelStyle = { display: 'block', fontSize: '.8rem', fontWeight: 600, margin: '14px 0 5px', color: 'var(--text-soft, #b7b1a6)' };

export function AdminDiscoverTab() {
  const feedback = useFeedback();
  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(adminListPublicBoards, []);
  const boards = data || [];

  const [selected, setSelected] = useState(null);  // board_id | NEW | null
  const [addRef, setAddRef] = useState('');         // pasted board id / share link (NEW mode)
  const [form, setForm] = useState(EMPTY);
  const [origSlug, setOrigSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [audit, setAudit] = useState(null);   // admin_seo_audit for the selected saved board
  const [statsBySlug, setStatsBySlug] = useState({});   // GSC perf per slug (latest snapshot)

  // Load a selected board into the form. Intentionally NOT keyed on `boards`,
  // so a background refresh doesn't clobber in-progress edits.
  useEffect(() => {
    if (!selected || selected === NEW) return;
    const b = boards.find((x) => x.board_id === selected);
    if (b) {
      setForm({
        slug: b.slug || '', seoTitle: b.seo_title || '', seoDescription: b.seo_description || '',
        seoBody: b.seo_body || '', targetKeyword: b.target_keyword || '', priority: b.priority || 0,
      });
      setOrigSlug(b.slug || '');
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = selected && selected !== NEW ? boards.find((b) => b.board_id === selected) : null;
  const slugErr = slugError(form.slug);
  const onField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // SEO audit (image count, %-with-alt, body uniqueness, related count) for the
  // publish-quality gate. Re-fetched on board change + after save / alt-gen.
  const refreshAudit = useCallback(async (boardId) => {
    if (!boardId) { setAudit(null); return; }
    try {
      const { data, error } = await supabase.rpc('admin_seo_audit', { p_board_id: boardId });
      if (!error) setAudit(data);
    } catch (_) { /* non-fatal */ }
  }, []);
  useEffect(() => { refreshAudit(current?.board_id || null); }, [current?.board_id, refreshAudit]);

  // The board id AI tooling can target: a saved board, or a pasted UUID in NEW
  // mode. A pasted /share token has no client-side board id until first save.
  const aiBoardId = current?.board_id || (selected === NEW ? (parseBoardRef(addRef)?.boardId || null) : null);

  // GSC performance per slug (latest snapshot). Loaded on mount + after import.
  const loadStats = useCallback(async () => {
    try {
      const rows = await adminPublicBoardStats(90);
      const map = {};
      for (const r of rows) map[r.slug] = r;
      setStatsBySlug(map);
    } catch (_) { /* non-fatal */ }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  const onImportCsv = async (file) => {
    if (!file || busy) return;
    try {
      const text = await file.text();
      const rows = parseGscCsv(text).filter((r) => /\/c\/[a-z0-9]/i.test(r.page));
      if (!rows.length) { feedback.toast({ type: 'error', message: 'No /c/<slug> rows found in that CSV.' }); return; }
      const n = await adminImportGscCsv(rows);
      feedback.toast({ type: 'success', message: `Imported GSC stats for ${n} board${n === 1 ? '' : 's'}.` });
      await loadStats();
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'CSV import failed: ' + (ex?.message || ex) });
    }
  };

  const startNew = () => { setSelected(NEW); setForm(EMPTY); setOrigSlug(''); setAddRef(''); };

  const save = async (publishOverride) => {
    if (busy) return;
    if (slugErr) { feedback.toast({ type: 'error', message: slugErr }); return; }

    let ref;
    if (selected === NEW) {
      ref = parseBoardRef(addRef);
      if (!ref) { feedback.toast({ type: 'error', message: 'Paste a board id or a /share/<link> to pick the board' }); return; }
    } else {
      ref = { boardId: selected };
    }

    const willPublish = publishOverride ?? (current ? !!current.is_published : false);

    if (current && origSlug && form.slug !== origSlug) {
      const ok = await feedback.confirm({
        title: 'Change the slug?',
        message: `This moves the board from /c/${origSlug} to /c/${form.slug}. The old URL stops working and any ranking it accrued is lost — there are no redirects. Continue?`,
        confirmLabel: 'Change slug',
      });
      if (!ok) return;
    }
    if (willPublish && !(current && current.is_published)) {
      const ok = await feedback.confirm({
        title: 'Publish this board?',
        message: `It goes live at ${SITE_ORIGIN}/c/${form.slug}, becomes search-indexable, and is added to the sitemap.`,
        confirmLabel: 'Publish',
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      const res = await adminSetPublicBoard({
        ...ref,
        slug: form.slug,
        seoTitle: form.seoTitle || null,
        seoDescription: form.seoDescription || null,
        seoBody: form.seoBody || null,
        targetKeyword: form.targetKeyword || null,
        priority: Number(form.priority) || 0,
        published: willPublish,
      });
      feedback.toast({ type: 'success', message: willPublish ? 'Saved — live' : 'Saved as draft' });
      if (willPublish) pingIndexNow(res?.slug || form.slug);  // best-effort Bing/Yandex ping
      await refresh();
      setSelected(res?.board_id || null);
      setOrigSlug(form.slug);
      await refreshAudit(res?.board_id || null);
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (ex?.message || ex) });
    } finally {
      setBusy(false);
    }
  };

  // AI: draft the SEO copy from the board's real content (fills the form for
  // human review — does NOT save). Requires a concrete board id.
  const onDraftAI = async () => {
    if (aiBusy || !aiBoardId) return;
    setAiBusy(true);
    try {
      const { draft } = await aiDraftBoardSeo(aiBoardId);
      setForm((f) => ({
        ...f,
        seoTitle: draft.seo_title || f.seoTitle,
        seoDescription: draft.seo_description || f.seoDescription,
        seoBody: draft.seo_body || f.seoBody,
        targetKeyword: f.targetKeyword || draft.suggested_keyword || '',
      }));
      feedback.toast({ type: 'success', message: 'AI draft filled in — review and edit before publishing.' });
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Draft failed: ' + (ex?.message || ex) });
    } finally { setAiBusy(false); }
  };

  // AI: generate + write alt text for image cards lacking it (into card_alts).
  const onGenAlts = async () => {
    if (aiBusy || !aiBoardId) return;
    setAiBusy(true);
    try {
      const r = await aiGenerateBoardAlts(aiBoardId);
      feedback.toast({ type: 'success', message: `Alt text — wrote ${r.written}, ${r.remaining} remaining.` });
      await refreshAudit(aiBoardId);
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Alt generation failed: ' + (ex?.message || ex) });
    } finally { setAiBusy(false); }
  };

  const unpublish = async () => {
    if (busy || !current) return;
    const ok = await feedback.confirm({
      title: 'Unpublish this board?',
      message: `/c/${current.slug} will stop resolving, drop out of the sitemap, and be de-indexed over time. The slug stays reserved for you.`,
      confirmLabel: 'Unpublish',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await adminUnpublishBoard(current.board_id);
      feedback.toast({ type: 'success', message: 'Unpublished' });
      await refresh();
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Unpublish failed: ' + (ex?.message || ex) });
    } finally {
      setBusy(false);
    }
  };

  // ── Publish-quality checklist (Phase C) ──────────────────────────────────
  // Text checks come from the live form (instant feedback); image/uniqueness/
  // related checks come from the server audit (DB-backed). `required` checks
  // gate the Publish action; warnings don't.
  const titleLen = form.seoTitle.trim().length;
  const descLen = form.seoDescription.trim().length;
  const bodyWords = form.seoBody.trim() ? form.seoBody.trim().split(/\s+/).length : 0;
  const kw = form.targetKeyword.trim();
  const checks = [
    { label: 'SEO title 10–60 characters', ok: titleLen >= 10 && titleLen <= TITLE_MAX, required: true },
    { label: 'Meta description 50–155 characters', ok: descLen >= 50 && descLen <= DESC_MAX, required: true },
    { label: 'Body copy ≥ 40 unique words', ok: bodyWords >= 40, required: true },
    { label: 'Target keyword set', ok: !!kw, required: true },
    { label: 'Keyword appears in the title', ok: !!kw && form.seoTitle.toLowerCase().includes(kw.toLowerCase()), required: false },
    { label: '≥ 3 images on the board', ok: !audit || audit.image_count >= 3, required: true, pending: !audit },
    { label: '≥ 60% of images have alt text', ok: !audit || audit.alt_pct == null || audit.alt_pct >= 60, required: true, pending: !audit },
    { label: 'Body not a near-duplicate of another board', ok: !audit || (audit.body_max_similarity ?? 0) < 0.7, required: true, pending: !audit },
    { label: 'Has related boards (shared tags)', ok: !!audit && audit.related_board_count > 0, required: false, pending: !audit },
  ];
  const requiredFailing = checks.filter((c) => c.required && !c.ok);
  const publishable = requiredFailing.length === 0;
  const score = Math.round((100 * checks.filter((c) => c.ok).length) / checks.length);
  const isLive = !!current?.is_published;
  const isNew = selected === NEW;

  return (
    <div className="admin-section">
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Discoverable boards</h3>
          <span className="admin-chart-sub t-meta">
            Promote a board to a clean, search-indexable page at <code>/c/&lt;slug&gt;</code> with its own
            SEO copy. Published boards are added to the sitemap and the public <code>/explore</code> index.
          </span>
        </header>

        <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated}>
          <button className="btn-secondary" onClick={startNew}>+ Add a board</button>
          <label className="btn-secondary" style={{ cursor: 'pointer' }}
                 title="Import a Google Search Console 'Pages' CSV export to see per-board clicks/impressions/position">
            Import GSC CSV
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                   onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onImportCsv(f); }} />
          </label>
        </AdminToolbar>

        <AdminAsync loading={loading} error={error} onRetry={refresh}
                    skeleton={<AdminSkeleton variant="table" rows={4} />} isEmpty={false}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 20, alignItems: 'start' }}>
            {/* Left: list */}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {boards.length === 0 && (
                <li className="t-meta admin-muted" style={{ padding: '8px 2px' }}>No public boards yet.</li>
              )}
              {boards.map((b) => {
                const active = selected === b.board_id;
                return (
                  <li key={b.board_id}>
                    <button
                      onClick={() => setSelected(b.board_id)}
                      style={{
                        width: '100%', textAlign: 'left', cursor: 'pointer',
                        padding: '9px 11px', borderRadius: 9, font: 'inherit',
                        border: '1px solid ' + (active ? 'var(--soleil, #ffb000)' : 'var(--border, #2a2722)'),
                        background: active ? 'var(--soleil-soft, rgba(255,176,0,.12))' : 'var(--bg-1, #14110d)',
                        color: 'inherit',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {b.board_name || b.slug}
                        </span>
                        <span style={{
                          fontSize: '.68rem', fontWeight: 700, letterSpacing: '.03em', padding: '2px 7px', borderRadius: 999,
                          background: b.is_published ? 'rgba(80,200,120,.16)' : 'rgba(255,255,255,.08)',
                          color: b.is_published ? '#74e39b' : 'var(--text-soft, #b7b1a6)',
                        }}>{b.is_published ? 'LIVE' : 'DRAFT'}</span>
                      </div>
                      <div className="t-meta admin-muted" style={{ marginTop: 2 }}>
                        /c/{b.slug}{b.deleted ? ' · board deleted' : ''}
                      </div>
                      {(() => {
                        const st = statsBySlug[b.slug];
                        if (st && st.impressions > 0) {
                          return (
                            <div className="t-meta" style={{ marginTop: 3, color: '#74e39b' }}>
                              {st.impressions} impr · {st.clicks} clicks · pos {st.position ?? '—'}
                            </div>
                          );
                        }
                        if (b.is_published) {
                          return (
                            <div className="t-meta" style={{ marginTop: 3, color: '#e0a366' }}>
                              no search impressions yet
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Right: editor */}
            <div>
              {!selected ? (
                <div className="t-meta admin-muted" style={{ padding: '18px 2px' }}>
                  Select a board on the left, or <b>+ Add a board</b> to make one discoverable.
                </div>
              ) : (
                <div>
                  {selected === NEW && (
                    <>
                      <label style={labelStyle}>Board to publish</label>
                      <input style={inputStyle} value={addRef} placeholder="Paste a board id or a /share/<link>"
                             onChange={(e) => setAddRef(e.target.value)} />
                      <div className="t-meta admin-muted" style={{ marginTop: 4 }}>
                        {parseBoardRef(addRef)
                          ? (parseBoardRef(addRef).shareToken ? 'Resolved from share link ✓' : 'Board id ✓')
                          : 'Paste a board UUID or a /share/<token> URL.'}
                      </div>
                    </>
                  )}

                  <label style={labelStyle}>Slug</label>
                  <input style={{ ...inputStyle, borderColor: slugErr ? '#e06666' : inputStyle.border }}
                         value={form.slug} onChange={onField('slug')}
                         onBlur={() => setForm((f) => ({ ...f, slug: slugify(f.slug) }))}
                         placeholder="backrooms-fanart" />
                  <div className="t-meta" style={{ marginTop: 4, color: slugErr ? '#e06666' : 'var(--text-soft, #b7b1a6)' }}>
                    {slugErr || `${SITE_ORIGIN}/c/${form.slug || '…'}`}
                  </div>

                  {/* AI assist (Phase B). Drafts copy from the board's real content (fills
                      the form for review — never auto-saves) + fills empty image alt. */}
                  <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn-secondary" disabled={aiBusy || !aiBoardId} onClick={onDraftAI}
                            title={aiBoardId ? 'Draft title/description/body from this board' : 'Save as draft first (or paste a board id)'}>
                      {aiBusy ? 'Working…' : '✨ Draft SEO with AI'}
                    </button>
                    <button className="btn-secondary" disabled={aiBusy || !aiBoardId} onClick={onGenAlts}
                            title={aiBoardId ? 'Generate alt text for images missing it' : 'Save as draft first (or paste a board id)'}>
                      🖼 Generate alt text
                    </button>
                    {!aiBoardId && (
                      <span className="t-meta admin-muted">Save as draft first to enable AI.</span>
                    )}
                  </div>

                  <label style={labelStyle}>SEO title <span style={{ fontWeight: 400 }}>({form.seoTitle.length}/{TITLE_MAX})</span></label>
                  <input style={inputStyle} value={form.seoTitle} onChange={onField('seoTitle')}
                         placeholder="Backrooms Fanart — Curated Community Art | Soleil Clusters" />

                  <label style={labelStyle}>Meta description <span style={{ fontWeight: 400 }}>({form.seoDescription.length}/{DESC_MAX})</span></label>
                  <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} value={form.seoDescription}
                            onChange={onField('seoDescription')} placeholder="A curated moodboard of the best backrooms fanart…" />

                  <label style={labelStyle}>Target keyword</label>
                  <input style={inputStyle} value={form.targetKeyword} onChange={onField('targetKeyword')} placeholder="backrooms fanart" />

                  <label style={labelStyle}>
                    Body copy <span style={{ fontWeight: 400 }}>(the biggest ranking lever — aim for 150–400 words)</span>
                  </label>
                  <textarea style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }} value={form.seoBody}
                            onChange={onField('seoBody')} placeholder="Write a real paragraph or two about this board's topic…" />

                  <label style={labelStyle}>Priority <span style={{ fontWeight: 400 }}>(higher sorts first on /explore)</span></label>
                  <input style={{ ...inputStyle, width: 120 }} type="number" value={form.priority} onChange={onField('priority')} />

                  {/* SEO score / publish-quality gate (Phase C). */}
                  <div style={{
                    marginTop: 18, padding: '12px 14px', borderRadius: 10,
                    border: '1px solid var(--border, #2a2722)', background: 'var(--bg-1, #14110d)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontWeight: 600 }}>SEO readiness</span>
                      <span style={{
                        fontSize: '.78rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: publishable ? 'rgba(80,200,120,.16)' : 'rgba(224,166,102,.16)',
                        color: publishable ? '#74e39b' : '#e0a366',
                      }}>{score}% {publishable ? '· ready' : '· needs work'}</span>
                      {isNew && <span className="t-meta admin-muted">save as draft to run image/uniqueness checks</span>}
                    </div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
                      {checks.map((c, i) => (
                        <li key={i} className="t-meta" style={{
                          color: c.pending ? 'var(--text-soft, #b7b1a6)' : (c.ok ? '#74e39b' : (c.required ? '#e06666' : '#e0a366')),
                        }}>
                          {c.pending ? '○' : (c.ok ? '✓' : (c.required ? '✗' : '!'))} {c.label}{!c.required ? ' (recommended)' : ''}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Search performance (GSC, Phase E) for this board, if imported. */}
                  {current && (() => {
                    const st = statsBySlug[current.slug];
                    return (
                      <div className="t-meta" style={{ marginTop: 12, color: 'var(--text-soft, #b7b1a6)' }}>
                        {st && st.impressions > 0
                          ? <>Search (last snapshot): <b style={{ color: '#74e39b' }}>{st.impressions}</b> impressions · {st.clicks} clicks · avg position {st.position ?? '—'}{st.top_query ? <> · top query “{st.top_query}”</> : null}</>
                          : (current.is_published
                              ? <>No search impressions yet — give it time, then check it’s indexed in GSC. Import a GSC CSV to track it here.</>
                              : <>Publish + import a GSC CSV to track search performance here.</>)}
                      </div>
                    );
                  })()}

                  <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                    {isLive ? (
                      <button className="btn-primary" disabled={busy || !!slugErr} onClick={() => save(true)}>
                        {busy ? 'Saving…' : 'Save & keep live'}
                      </button>
                    ) : (
                      <button className="btn-primary"
                              disabled={busy || !!slugErr || isNew || !publishable}
                              title={isNew ? 'Save as draft first, then publish once the checklist passes'
                                : (!publishable ? 'Fix the required SEO checklist items first' : '')}
                              onClick={() => save(true)}>
                        {busy ? 'Saving…' : 'Publish'}
                      </button>
                    )}
                    <button className="btn-secondary" disabled={busy || !!slugErr} onClick={() => save(false)}>
                      Save as draft
                    </button>
                    {isLive && (
                      <>
                        <a className="btn-secondary" href={`/c/${current.slug}`} target="_blank" rel="noreferrer">View live ↗</a>
                        <button className="btn-primary btn-danger" disabled={busy} onClick={unpublish}>
                          Unpublish
                        </button>
                      </>
                    )}
                  </div>

                  {current?.deleted && (
                    <p className="t-meta" style={{ color: '#e0a366', marginTop: 12 }}>
                      ⚠ The underlying board was deleted — its /c page already returns nothing. Unpublish to tidy up.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </AdminAsync>
      </section>
    </div>
  );
}
