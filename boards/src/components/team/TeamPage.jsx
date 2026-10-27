// TeamPage — the Team page, direction B (the owner's pick 2026-10-21): a page of
// its own over the board column, with tabs People · Seats & billing · Joining.
// It renders a TeamSnapshot (lib/teamModel.js). Handed a `live` prop (TeamPageLive:
// a real team, `live.act` runs each action) it draws the `team` prop and every
// click is a real call; without one it answers through teamReducer, look only:
// nothing leaves the browser. Lazy and the only importer of team.css, so the
// signed-in app's CSS budget doesn't move.
import { useEffect, useReducer, useRef, useState } from 'react';
import './team.css';
import { Icon } from '../Icon.jsx';
import { UserPlus, MoreHorizontal, X, Eye, Warning } from '../../lib/icons.js';
import { teamReducer, teamCan, peopleCounts, dateLabel } from '../../lib/teamModel.js';
import { refusalLine, successLine, seatPriceLine } from '../../lib/teamCopy.js';
import { previewTeamSeatsCost, newSeatRequestId } from '../../lib/teamBillingApi.js';
import { TeamMenu } from './TeamMenu.jsx';
import { TeamConfirm } from './TeamConfirm.jsx';
import TeamPeople from './TeamPeople.jsx';
import TeamBilling from './TeamBilling.jsx';
import TeamJoining from './TeamJoining.jsx';

const FROZEN = 'The team is view-only until it’s paid';
// A confirm stays open after these, so a retry reuses the same preview.
const RETRYABLE = new Set(['retry', 'network']);

const dayLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

export default function TeamPage({ team, initialTab = 'people', onClose, onToast, live = null }) {
  const isLive = !!live;
  const [sample, dispatch] = useReducer(teamReducer, team);
  const t = isLive ? team : sample;
  const onAction = isLive
    ? live.act
    : (type, payload) => { dispatch({ type, ...payload }); return Promise.resolve({ ok: true }); };
  const [confirmState, setConfirmState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const role = t.me.role;
  const manager = teamCan(role, 'managePeople');
  const viewOnly = t.status === 'view_only';
  const tabIds = manager ? ['people', 'billing', 'joining'] : ['people'];
  const [tab, setTabState] = useState(tabIds.includes(initialTab) ? initialTab : 'people');
  const [focusKey, setFocusKey] = useState(0);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const titleRef = useRef(null);
  const tabRefs = useRef({});

  const setTab = (id) => { setTabState(id); setFocusKey(0); };

  useEffect(() => { titleRef.current?.focus(); }, []);

  // Esc closes the page; an open menu takes it first (TeamMenu stops it).
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const onTabKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabIds.indexOf(tab);
    const next = tabIds[(i + (e.key === 'ArrowRight' ? 1 : tabIds.length - 1)) % tabIds.length];
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const inviteClick = () => { setTabState('joining'); setFocusKey((k) => k + 1); };

  // A real team's answer, as a toast. The sample says nothing here: its own
  // handlers toast their "Preview: …" lines.
  const report = (type, res, say) => {
    if (!isLive) return res;
    if (res.ok) { if (say !== false) onToast(say || successLine(type)); }
    else onToast(refusalLine(res.refusal));
    return res;
  };
  const go = async (type, payload, say) => report(type, await onAction(type, payload), say);
  const ask = (o) => setConfirmState(o);
  const runConfirm = async () => {
    const o = confirmState;
    if (!o) return;
    setBusy(true);
    let res = null;
    try { res = await o.run(); } finally { setBusy(false); }
    if (!(res && res.ok === false && RETRYABLE.has(res.refusal?.code))) setConfirmState(null);
  };

  // The price of buying up to `total` seats, from the server's own preview,
  // then `run(preview, requestId)` once confirmed. One request id per preview.
  const priceThen = async (total, label, run, lead = '') => {
    if (!t.plan) return;
    const p = await previewTeamSeatsCost(t.id, total);
    if (!p || p.ok === false) { onToast(refusalLine({ code: p && p.error })); return; }
    const requestId = newSeatRequestId();
    ask({ message: `${lead}${seatPriceLine(p)}`, confirmLabel: label, run: () => run(p, requestId) });
  };

  const openPortal = async () => {
    const res = await onAction('portal');
    if (res.ok && res.data && res.data.url) globalThis.location.assign(res.data.url);
    else if (!res.ok) onToast(refusalLine(res.refusal));
  };

  const closeTeamToast = () => {
    if (!isLive) {
      onToast('Preview: closing is look-only. Its workspaces would move to your own account, and everyone in them keeps what they had.');
      return;
    }
    ask({
      message: `Close ${t.name}? Its workspaces move to your personal account and the plan ends.`,
      confirmLabel: 'Close the team',
      danger: true,
      run: async () => {
        const res = await go('close');
        if (res.ok) onClose?.();
        return res;
      },
    });
  };
  const leaveTeam = () => {
    if (!isLive) {
      onToast('Preview: leaving is look-only. You’d keep your own workspaces and give back your seat.');
      return;
    }
    ask({
      message: `Leave ${t.name}? You keep your own workspaces and give back your seat.`,
      confirmLabel: 'Leave the team',
      danger: true,
      run: async () => {
        const res = await go('leave');
        if (res.ok) onClose?.();
        return res;
      },
    });
  };

  const menuItems = [];
  if (teamCan(role, 'renameTeam')) menuItems.push({ id: 'renameTeam', label: 'Rename the team' });
  if (teamCan(role, 'leaveTeam')) menuItems.push({ id: 'leaveTeam', label: 'Leave the team' });
  if (teamCan(role, 'closeTeam')) menuItems.push({ id: 'closeTeam', label: 'Close the team', danger: true });
  const pickMenu = (id) => {
    if (id === 'renameTeam') { setDraft(t.name); setRenaming(true); }
    else if (id === 'leaveTeam') leaveTeam();
    else if (id === 'closeTeam') closeTeamToast();
  };

  const saveRename = () => {
    if (isLive) { if (draft.trim()) go('rename', { name: draft.trim() }); }
    else onAction('rename', { name: draft });
    setRenaming(false);
    titleRef.current?.focus();
  };

  const common = { t, now, viewOnly, onAction, onToast, live: isLive, go, report, ask, priceThen, openPortal };
  const tabLabels = { people: 'People', billing: 'Seats & billing', joining: 'Joining' };
  const unpaid = t.unpaid;
  const failedOn = unpaid && unpaid.failedAt ? ` on ${dayLabel(unpaid.failedAt)}` : '';
  // The sample's banner shows while it is view-only; a real team's also covers
  // the grace period before that.
  const showBanner = !!unpaid && (isLive || viewOnly);
  const frozen = isLive ? !!unpaid && unpaid.viewOnly : viewOnly;

  return (
    <div className="tp-ground" data-team-page>
      <section className="tp-sheet" aria-label={`${t.name}, team`}>
        <div className="tp-head">
          <span className="tp-mark" style={{ background: t.color }} aria-hidden="true">{t.letter}</span>
          <div className="tp-name">
            <div className="tp-titleline">
              {renaming ? (
                <input
                  className="tp-title-input"
                  aria-label="Team name"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename();
                    if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false); titleRef.current?.focus(); }
                  }}
                />
              ) : (
                <h2 className="tp-title" ref={titleRef} tabIndex={-1}>{t.name}</h2>
              )}
              {t.sample && <span className="tp-badge">Test team</span>}
              {viewOnly && <span className="tp-badge"><Icon as={Eye} size={11} weight="regular" />View-only</span>}
            </div>
            <span className="tp-sub">
              {manager
                ? (t.plan ? `Team plan · ${t.plan.seats} seats · billed ${t.plan.interval === 'year' ? 'yearly' : 'monthly'}` : 'Team plan')
                : 'Team · you’re a member'}
            </span>
          </div>
          {manager && (
            <div className="tp-acts">
              <button
                type="button"
                className={`tp-btn${viewOnly ? '' : ' tp-btn-primary'}`}
                disabled={viewOnly}
                title={viewOnly ? FROZEN : undefined}
                aria-label="Invite people"
                onClick={inviteClick}
              >
                <Icon as={UserPlus} size={14} weight="regular" /><span className="tp-btn-label">Invite people</span>
              </button>
              <span className="tp-acts-wrap">
                <button
                  type="button"
                  className="tp-btn tp-btn-icon"
                  aria-label="More"
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  onClick={() => setMenu(!menu)}
                >
                  <Icon as={MoreHorizontal} size={15} weight="regular" />
                </button>
                {menu && <TeamMenu align="right" items={menuItems} onPick={pickMenu} onClose={() => setMenu(false)} />}
              </span>
            </div>
          )}
          <button type="button" className="tp-close" aria-label="Close the team page" onClick={() => onClose?.()}>
            <Icon as={X} size={15} weight="regular" />
          </button>
        </div>

        <div className="tp-tabs" role="tablist" aria-label="Team" onKeyDown={onTabKey}>
          {tabIds.map((id) => (
            <button
              key={id}
              ref={(el) => { tabRefs.current[id] = el; }}
              type="button"
              role="tab"
              id={`tp-tab-${id}`}
              className="tp-tab"
              aria-selected={tab === id}
              aria-controls="tp-panel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {tabLabels[id]}
              {id === 'people' && <span className="tp-tab-n">{peopleCounts(t.people).all}</span>}
            </button>
          ))}
        </div>

        <div className="tp-body" role="tabpanel" id="tp-panel" aria-labelledby={`tp-tab-${tab}`}>
          {confirmState && (
            <TeamConfirm
              message={confirmState.message}
              confirmLabel={confirmState.confirmLabel}
              danger={confirmState.danger}
              busy={busy}
              onConfirm={runConfirm}
              onCancel={() => setConfirmState(null)}
            />
          )}
          {showBanner && (
            <div className="tp-banner" role="status">
              <Icon as={Warning} size={17} weight="regular" />
              <span className="tp-banner-t">
                {frozen ? (
                  <>
                    <span>
                      <b>{t.name} is view-only.</b> The team’s payment didn’t go through{failedOn}. Opening, downloading and exporting still work, and paying turns editing back on.
                    </span>
                    <small>
                      Nothing has been deleted. If the team stays unpaid, its workspaces are deleted
                      {unpaid.deleteAt ? ` on ${dateLabel(unpaid.deleteAt)}` : ' a year after it went view-only'}, and we’ll remind you before then.
                    </small>
                  </>
                ) : (
                  <>
                    <span>
                      <b>{t.name}’s payment didn’t go through{failedOn}.</b> Editing keeps working
                      {unpaid.graceEndsAt ? ` until ${dateLabel(unpaid.graceEndsAt)}` : ' for now'}; updating the card keeps it that way.
                    </span>
                  </>
                )}
              </span>
              {teamCan(role, 'changeCard') && (
                <button
                  type="button"
                  className="tp-btn tp-btn-primary"
                  onClick={isLive ? openPortal : () => onToast('Preview: the card form comes with billing. Nothing was charged.')}
                >
                  Update the card
                </button>
              )}
            </div>
          )}
          {tab === 'people' && <TeamPeople {...common} />}
          {tab === 'billing' && manager && <TeamBilling {...common} onCloseTeam={closeTeamToast} />}
          {tab === 'joining' && manager && <TeamJoining {...common} focusKey={focusKey} />}
        </div>
      </section>
    </div>
  );
}
