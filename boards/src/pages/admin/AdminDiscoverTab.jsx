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

import { useEffect, useState } from 'react';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { adminListPublicBoards, adminSetPublicBoard, adminUnpublishBoard } from '../../lib/boardsApi.js';

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
      await refresh();
      setSelected(res?.board_id || null);
      setOrigSlug(form.slug);
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (ex?.message || ex) });
    } finally {
      setBusy(false);
    }
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

                  <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn-primary" disabled={busy || !!slugErr} onClick={() => save(true)}>
                      {busy ? 'Saving…' : (current?.is_published ? 'Save & keep live' : 'Publish')}
                    </button>
                    <button className="btn-secondary" disabled={busy || !!slugErr} onClick={() => save(false)}>
                      Save as draft
                    </button>
                    {current?.is_published && (
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
