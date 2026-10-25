// AdminIssueTrail — what one browser was doing around a problem (0582's
// admin_error_session_trail): its errors, its analytics events (the name and
// the few props that explain each, never attribution) and the person's own
// feedback, as one timeline either side of the moment.

import { useCallback } from 'react';
import { Modal } from '../../components/Modal.jsx';
import { supabase } from '../../lib/supabase.js';
import { fmtDateTime } from '../../lib/adminFormat.js';
import { kindLabel, sourceLabel, contextChips, eventSummary, offsetText, trailItems } from '../../lib/adminIssues.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { SeverityBadge } from './AdminIssueBits.jsx';

function TrailRow({ it, showPath }) {
  const r = it.row;
  if (it.is === 'error') {
    const chips = contextChips(r.context);
    return (
      <>
        <span className="iss-trail-what">
          <SeverityBadge severity={r.severity} /> <b>{kindLabel(r.kind)}</b>
          {r.source && r.source !== 'client' && <span className="t-meta"> · {sourceLabel(r.source)}</span>}
          {r.message && <> {r.message}</>}
        </span>
        {(chips.length > 0 || showPath) && (
          <span className="iss-trail-sub t-meta">
            {showPath && r.path && <span className="iss-mono">{r.path}</span>}
            {showPath && r.path && chips.length > 0 && ' · '}
            {chips.join(' · ')}
          </span>
        )}
      </>
    );
  }
  if (it.is === 'feedback') {
    return (
      <>
        <span className="iss-trail-what">
          <span className="iss-badge">Feedback</span> {r.kind}{r.choice ? ` · ${r.choice}` : ''}
        </span>
        {r.message && <span className="iss-trail-sub iss-trail-quote">{r.message}</span>}
      </>
    );
  }
  const summary = eventSummary(r);
  return (
    <>
      <span className="iss-trail-what iss-mono">{r.event}</span>
      {(summary || (showPath && r.path)) && (
        <span className="iss-trail-sub t-meta">
          {showPath && r.path && <span className="iss-mono">{r.path}</span>}
          {showPath && r.path && summary && ' · '}
          {summary}
        </span>
      )}
    </>
  );
}

export function AdminIssueTrail({ sessionId, at, onClose }) {
  const fetchTrail = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_error_session_trail', { p_session_id: sessionId, p_at: at || null });
    if (error) throw error;
    return data;
  }, [sessionId, at]);
  const q = useAdminData(fetchTrail, [sessionId, at]);
  const t = q.data;
  const items = trailItems(t);
  const dev = t?.device || {};
  const device = [dev.browser, dev.os, dev.device_type, dev.tier, dev.build].filter(Boolean).join(' · ');
  let lastPath = null;

  return (
    <Modal open onClose={onClose} className="modal iss-trail-modal" ariaLabel="What they were doing" showClose>
      <div className="iss-trail-head">
        <h3 className="iss-trail-title">What they were doing</h3>
        <div className="t-meta">
          {t?.user?.email || 'Signed out'}
          {device && ` · ${device}`}
          {t?.from && ` · ${fmtDateTime(t.from)} to ${fmtDateTime(t.to)}`}
        </div>
      </div>
      <div className="iss-trail-body">
        <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh}
                    skeleton={<AdminSkeleton variant="table" rows={8} />}
                    isEmpty={items.length === 0}
                    empty={{ title: 'Nothing recorded', body: 'This browser left no events or errors in this window.' }}>
          <ol className="iss-trail">
            {items.map((it) => {
              const path = it.row?.path || null;
              const showPath = path != null && path !== lastPath;
              if (path != null) lastPath = path;
              const moment = it.is === 'error' && Math.abs(it.offset) < 1000;
              return (
                <li key={it.key} className={`iss-trail-item is-${it.is}${moment ? ' is-moment' : ''}`}>
                  <span className="iss-trail-when t-meta" title={fmtDateTime(it.at)}>{offsetText(it.offset)}</span>
                  <span className="iss-trail-body-cell"><TrailRow it={it} showPath={showPath} /></span>
                </li>
              );
            })}
          </ol>
        </AdminAsync>
      </div>
    </Modal>
  );
}
