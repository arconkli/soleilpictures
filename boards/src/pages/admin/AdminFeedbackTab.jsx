// AdminFeedbackTab — shows submissions from the in-app feedback
// widget. Kind filter at top; full message expands on click.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

const KINDS = ['bug', 'idea', 'praise', 'other'];

function relativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function AdminFeedbackTab() {
  const [rows, setRows]       = useState([]);
  const [kind, setKind]       = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc('admin_list_feedback', {
      p_limit:  200,
      p_offset: 0,
      p_kind:   kind || null,
    });
    if (error) setError(error.message);
    setRows(data || []);
    setLoading(false);
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <div className="admin-section">
      <div className="admin-filter-row">
        <select
          className="auth-input admin-filter-select"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <div className="admin-filter-meta t-meta">
          {loading ? 'Loading…' : `${rows.length} entries`}
        </div>
      </div>

      {error && <div className="auth-error t-meta">{error}</div>}

      {!loading && rows.length === 0 && (
        <div className="admin-empty">No feedback yet.</div>
      )}

      <div className="admin-feedback-list">
        {rows.map((r) => {
          const isExpanded = expanded.has(r.id);
          const preview = (r.message || '').slice(0, 160);
          const isLong = (r.message || '').length > 160;
          return (
            <div key={r.id} className="admin-feedback-row" onClick={() => isLong && toggle(r.id)}>
              <div className="admin-feedback-meta">
                <span className={`admin-status admin-status-${r.kind === 'bug' ? 'rejected' : r.kind === 'praise' ? 'accepted' : 'pending'}`}>{r.kind}</span>
                <span className="admin-email">{r.email || 'anonymous'}</span>
                <span className="admin-muted">{relativeTime(r.created_at)}</span>
                {r.url && (
                  <a className="admin-link admin-muted" href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    {(() => { try { return new URL(r.url).pathname; } catch { return r.url; } })()}
                  </a>
                )}
              </div>
              <div className="admin-feedback-message">
                {isExpanded ? r.message : preview}{!isExpanded && isLong ? '…' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
