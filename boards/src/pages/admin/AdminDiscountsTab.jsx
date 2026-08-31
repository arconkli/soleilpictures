// AdminDiscountsTab — create and manage Stripe discount codes.
//
//   • Top: code + percent + max redemptions + expiry + note → Create.
//     A live preview states the real outcome in the operator's own numbers.
//   • Bottom: every promotion code with its redemption count, and per-row
//     Deactivate (undo-able — Stripe cannot delete a code, only deactivate it).
//
// Stripe is the source of truth for the codes; only redemption attribution is
// ours (discount_redemptions, 0274), because Stripe detaches a `once` discount
// after the first invoice and forgets who used it.
//
// Codes apply to the MONTHLY plan only. That is enforced in
// create-checkout-session, which withholds Checkout's promo field on annual —
// see promoCodesAllowedForPlan. The form says so, because it is the single most
// surprising thing about these codes.

import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../../components/AppFeedback.jsx';
import { CopyableText } from '../../components/CopyableText.jsx';
import { fmtDate, formatCount, formatExpires } from '../../lib/adminFormat.js';
import {
  codeStatus,
  discountPreviewLine,
  generateDiscountCode,
  normalizeDiscountCode,
} from '../../lib/discountCodes.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { StatusPill } from './AdminPills.jsx';
import { Tag } from '../../lib/icons.js';

const FN_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/admin-discount-action';

async function discountAction(payload) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function AdminDiscountsTab() {
  const feedback = useFeedback();

  const [code, setCode]       = useState('');
  const [percent, setPercent] = useState('50');
  const [maxUses, setMaxUses] = useState('1');
  const [expires, setExpires] = useState('');
  const [note, setNote]       = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId]   = useState(null);

  const preview = useMemo(() => discountPreviewLine({ percentOff: percent }), [percent]);

  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    // Codes come from Stripe; redemptions from our own ledger. Neither can
    // stand in for the other — Stripe knows the count, we know the people.
    const [listed, reds] = await Promise.all([
      discountAction({ action: 'list' }),
      supabase
        .from('discount_redemptions')
        .select('stripe_promotion_code_id, user_id, plan, redeemed_at')
        .order('redeemed_at', { ascending: false })
        .limit(500),
    ]);
    if (reds.error) throw reds.error;
    return { codes: listed.codes || [], redemptions: reds.data || [] };
  }, []);

  const codes = data?.codes || [];
  const redemptions = data?.redemptions || [];

  const stats = useMemo(() => {
    const counted = codes.map((c) => codeStatus(c));
    return {
      active:   counted.filter((s) => s === 'active' || s === 'forever').length,
      redeemed: codes.reduce((n, c) => n + (c.times_redeemed || 0), 0),
      expired:  counted.filter((s) => s === 'expired').length,
      revoked:  counted.filter((s) => s === 'revoked').length,
    };
  }, [codes]);

  const onCreate = async (e) => {
    e?.preventDefault?.();
    const clean = normalizeDiscountCode(code);
    if (clean.length < 3) {
      feedback.toast({ type: 'info', message: 'Enter a code of at least 3 letters or digits.' });
      return;
    }
    if (!preview) {
      feedback.toast({ type: 'info', message: 'Percent off must be between 1 and 100.' });
      return;
    }
    const uses = maxUses.trim() === '' ? null : Number(maxUses);
    if (uses !== null && (!Number.isInteger(uses) || uses < 1)) {
      feedback.toast({ type: 'info', message: 'Max redemptions must be a whole number, or blank for unlimited.' });
      return;
    }

    const ok = await feedback.confirm({
      title: `Create ${clean}?`,
      message: `${preview}\n\n${uses === null ? 'Unlimited redemptions.' : `Usable ${uses} time${uses === 1 ? '' : 's'}.`}`
        + '\n\nA code cannot be edited once created — only deactivated.',
      confirmLabel: 'Create code',
    });
    if (!ok) return;

    setCreating(true);
    try {
      await discountAction({
        action: 'create',
        code: clean,
        percent_off: Number(percent),
        max_redemptions: uses,
        // The picker gives a date; end-of-day so "expires the 5th" includes the 5th.
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        note: note.trim() || null,
      });
      feedback.toast({ type: 'success', message: `${clean} created` });
      setCode(''); setNote(''); setExpires('');
      await refresh();
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Create failed: ' + (ex?.message || ex) });
    } finally {
      setCreating(false);
    }
  };

  // Deactivate is reversible, so it gets the undo toast rather than a confirm —
  // matching the house convention for destructive-looking actions.
  const onSetActive = async (row, active) => {
    setBusyId(row.id);
    try {
      await discountAction({ action: 'set_active', promotion_code_id: row.id, active });
      await refresh();
      feedback.toast({
        type: 'success',
        message: active ? `${row.code} reactivated` : `${row.code} deactivated`,
        action: active ? undefined : {
          label: 'Undo',
          onClick: async () => {
            try {
              await discountAction({ action: 'set_active', promotion_code_id: row.id, active: true });
              await refresh();
            } catch (ex) {
              feedback.toast({ type: 'error', message: 'Undo failed: ' + (ex?.message || ex) });
            }
          },
        },
      });
    } catch (ex) {
      feedback.toast({ type: 'error', message: 'Failed: ' + (ex?.message || ex) });
    } finally {
      setBusyId(null);
    }
  };

  const redeemedBy = (promoId) => redemptions.filter((r) => r.stripe_promotion_code_id === promoId).length;

  return (
    <div className="admin-section">

      {!loading && !error && (
        <div className="admin-stat-grid">
          <AdminStatCard label="Active"   value={formatCount(stats.active)}   sub="redeemable now" />
          <AdminStatCard label="Redeemed" value={formatCount(stats.redeemed)} sub="all time" />
          <AdminStatCard label="Expired"  value={formatCount(stats.expired)}  sub="used up or lapsed" />
          <AdminStatCard label="Inactive" value={formatCount(stats.revoked)}  sub="deactivated" />
        </div>
      )}

      {/* ===== Create ===== */}
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Create a code</h3>
          <span className="admin-chart-sub t-meta">
            Discounts the first month on the monthly plan. Annual checkouts are not offered a code field.
          </span>
        </header>

        <form onSubmit={onCreate} className="admin-discount-form">
          <div className="admin-discount-row">
            <label className="admin-discount-field">
              <span className="t-meta admin-muted">Code</span>
              <div className="admin-discount-code-input">
                <input
                  className="auth-input"
                  type="text"
                  placeholder="LAUNCH50"
                  value={code}
                  onChange={(e) => setCode(normalizeDiscountCode(e.target.value))}
                  aria-label="Discount code"
                />
                <button type="button" className="admin-action" onClick={() => setCode(generateDiscountCode())}>
                  Generate
                </button>
              </div>
            </label>

            <label className="admin-discount-field admin-discount-field-narrow">
              <span className="t-meta admin-muted">Percent off</span>
              <input className="auth-input" type="number" min="1" max="100"
                     value={percent} onChange={(e) => setPercent(e.target.value)} aria-label="Percent off" />
            </label>

            <label className="admin-discount-field admin-discount-field-narrow">
              <span className="t-meta admin-muted">Max uses</span>
              <input className="auth-input" type="number" min="1" placeholder="∞"
                     value={maxUses} onChange={(e) => setMaxUses(e.target.value)} aria-label="Max redemptions" />
            </label>

            <label className="admin-discount-field admin-discount-field-narrow">
              <span className="t-meta admin-muted">Expires</span>
              <input className="auth-input" type="date"
                     value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expiry date" />
            </label>
          </div>

          <div className="admin-discount-controls">
            <input className="auth-input admin-discount-note" type="text" placeholder="note (optional)"
                   value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="submit" className="admin-action admin-action-primary" disabled={creating || code.length < 3}>
              {creating ? 'Creating…' : 'Create code'}
            </button>
          </div>

          {preview && <p className="admin-discount-preview t-meta">{preview}</p>}
        </form>
      </section>

      {/* ===== List ===== */}
      <section className="admin-chart-panel admin-chart-panel-wide">
        <header className="admin-chart-head">
          <h3 className="admin-chart-title">Codes</h3>
          <span className="admin-chart-sub t-meta">
            Live from Stripe. A code cannot be edited or deleted once created — only deactivated.
          </span>
        </header>

        <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated} />

        <AdminAsync
          loading={loading}
          error={error}
          onRetry={refresh}
          skeleton={<AdminSkeleton variant="table" rows={5} cols={8} />}
          isEmpty={codes.length === 0}
          empty={{
            icon: Tag,
            title: 'No discount codes yet',
            body: 'Create one above. It will apply to the first month on the monthly plan.',
          }}
        >
          <table className={`admin-table admin-discounts-table ${refreshing ? 'is-refreshing' : ''}`}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Status</th>
                <th>Redeemed</th>
                <th>Expires</th>
                <th>Created</th>
                <th>Note</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const status = codeStatus(c);
                const ledger = redeemedBy(c.id);
                const used = c.times_redeemed ?? 0;
                return (
                  <tr key={c.id}>
                    <td><CopyableText value={c.code} className="admin-discount-code" /></td>
                    <td>{c.percent_off ? `${c.percent_off}% first month` : '—'}</td>
                    <td><StatusPill kind={status} /></td>
                    <td className="admin-muted"
                        title={ledger !== used
                          ? `Stripe counts ${used}; our ledger holds ${ledger}. Redemptions from before the ledger existed are not attributable.`
                          : undefined}>
                      {formatCount(used)}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}
                    </td>
                    <td className="admin-muted">{c.expires_at ? formatExpires(c.expires_at) : '—'}</td>
                    <td className="admin-muted" title={c.created_by || ''}>{fmtDate(c.created)}</td>
                    <td className="admin-muted admin-discounts-note" title={c.note || ''}>{c.note || ''}</td>
                    <td className="admin-actions">
                      <button
                        className={`admin-action ${c.active ? 'admin-action-danger' : ''}`}
                        disabled={busyId === c.id}
                        onClick={() => onSetActive(c, !c.active)}
                        title={c.active ? 'Stop this code being redeemed' : 'Allow this code again'}
                      >
                        {busyId === c.id ? '…' : c.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminAsync>
      </section>
    </div>
  );
}
