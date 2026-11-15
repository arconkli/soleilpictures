// TeamPage — the Team page, direction B (the owner's pick 2026-10-21): a page of
// its own over the board column, with tabs People · Workspaces · Seats & billing
// · Joining (Workspaces is for everyone in the team; the last two are the
// owner's and admins').
// It renders a TeamSnapshot (lib/teamModel.js). Handed a `live` prop (TeamPageLive:
// a real team, `live.act` runs each action) it draws the `team` prop and every
// click is a real call; without one it answers through teamReducer, look only:
// nothing leaves the browser. Lazy and the only importer of team.css, so the
// signed-in app's CSS budget doesn't move.
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import './team.css';
import { Icon } from '../Icon.jsx';
import { UserPlus, MoreHorizontal, X, Eye, Warning } from '../../lib/icons.js';
import { teamReducer, teamCan, peopleCounts, seatsUsed } from '../../lib/teamModel.js';
import { dateLabel, dayLabel } from '../../lib/teamModelWords.js';
import { refusalLine, successLine, seatPriceLine, removeSeatLines, undoLabel } from '../../lib/teamCopy.js';
import { createPendingRemovals, withoutPending, UNDO_MS } from '../../lib/teamPendingRemovals.js';
import { previewTeamSeatsCost, newSeatRequestId } from '../../lib/teamBillingApi.js';
import { TeamMenu } from './TeamMenu.jsx';
import { TeamConfirm } from './TeamConfirm.jsx';
import TeamPeople from './TeamPeople.jsx';
import TeamWorkspaces from './TeamWorkspaces.jsx';
import TeamBilling from './TeamBilling.jsx';
import TeamJoining from './TeamJoining.jsx';
import { isComposingKey } from '../../lib/composerKeys.js';
import { t as tr, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const frozenTip = () => tr`The team is view-only until it’s paid`;
// A confirm stays open after these, so a retry reuses the same preview.
const RETRYABLE = new Set(['retry', 'network']);


export default function TeamPage({ team, initialTab = 'people', tabKey, onClose, onToast, onOpenWorkspace, live = null }) {
  const isLive = !!live;
  const [sample, dispatch] = useReducer(teamReducer, team);
  const onAction = isLive
    ? live.act
    : (type, payload) => { dispatch({ type, ...payload }); return Promise.resolve({ ok: true }); };

  // Removing a person, revoking an invite and removing a domain wait for an
  // Undo (lib/teamPendingRemovals.js). The row is left out of the snapshot
  // drawn here until the call has answered, so a reload of the snapshot never
  // brings it back; only a refused call does. The page closing sends them.
  const latest = useRef(null);
  latest.current = { onAction, onToast };
  const queueRef = useRef(null);
  if (!queueRef.current) {
    queueRef.current = createPendingRemovals({
      commit: (item) => latest.current.onAction(item.type, item.payload),
      onFail: (_item, res) => latest.current.onToast(refusalLine(res && res.refusal)),
    });
  }
  const queue = queueRef.current;
  const pendingVersion = useSyncExternalStore(queue.subscribe, queue.version);
  const base = isLive ? team : sample;
  const t = useMemo(() => withoutPending(base, queue.has), [base, queue, pendingVersion]);
  useEffect(() => {
    const flushNow = () => { queue.flush(); };
    window.addEventListener('pagehide', flushNow);
    return () => { window.removeEventListener('pagehide', flushNow); flushNow(); };
  }, [queue]);
  const [confirmState, setConfirmState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const role = t.me.role;
  const manager = teamCan(role, 'managePeople');
  const viewOnly = t.status === 'view_only';
  const tabIds = manager ? ['people', 'workspaces', 'billing', 'joining'] : ['people', 'workspaces'];
  const [tab, setTabState] = useState(tabIds.includes(initialTab) ? initialTab : 'people');
  const [busyKeys, setBusyKeys] = useState([]);
  const [focusKey, setFocusKey] = useState(0);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const titleRef = useRef(null);
  const tabRefs = useRef({});

  const setTab = (id) => { setTabState(id); setFocusKey(0); };

  // The app opened the page again (a bell notice) while it was already open:
  // go to the tab it asked for, when this person has it.
  const seenTabKey = useRef(tabKey);
  useEffect(() => {
    if (seenTabKey.current === tabKey) return;
    seenTabKey.current = tabKey;
    if (tabIds.includes(initialTab)) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, initialTab]);

  useEffect(() => { titleRef.current?.focus(); }, []);

  // Esc closes the page; an open menu takes it first (TeamMenu stops it).
  useEffect(() => {
    const key = (e) => { if (isComposingKey(e)) return; if (e.key === 'Escape') onClose?.(); };
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

  // A row's own call is running: its controls wait (`isBusy(key)`), the rest of
  // the page doesn't. `track(key, fn)` wraps the call and resolves what it does.
  const isBusy = (key) => busyKeys.includes(key);
  const track = async (key, fn) => {
    setBusyKeys((k) => [...k, key]);
    try {
      return await fn();
    } finally {
      setBusyKeys((k) => { const i = k.indexOf(key); return i < 0 ? k : [...k.slice(0, i), ...k.slice(i + 1)]; });
    }
  };

  // The row goes at once and the toast offers Undo; the call is made when the
  // wait ends (or the page closes), and Undo before that sends nothing.
  const removeLater = ({ key, type, payload, line }) => {
    queue.add(key, { type, payload });
    onToast({ message: line, ttl: UNDO_MS, action: { label: undoLabel(), onClick: () => { queue.undo(key); } } });
  };

  // A seat changes the bill, so it asks first and says what changes. Seats &
  // billing's "Remove a seat" calls go / onAction('removeSeat'); it comes here.
  const askRemoveSeat = () => {
    if (!t.plan) return Promise.resolve({ ok: false, asked: true });
    const { lead, detail } = removeSeatLines(t.plan.seats, Math.max(0, t.plan.seats - 1 - seatsUsed(t.people)));
    ask({
      message: (
        <>
          {lead}{' '}
          <span className="tp-confirm-sub">{detail}</span>
        </>
      ),
      confirmLabel: tr`Remove a seat`,
      run: () => (isLive ? go('removeSeat') : onAction('removeSeat')),
    });
    return Promise.resolve({ ok: false, asked: true });
  };
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
  const priceThen = async (total, label, run, lead = '') => {   // lead: '' | 'send' | 'approve' | 'role' | 'moveIn'
    if (!t.plan) return;
    const p = await previewTeamSeatsCost(t.id, total);
    if (!p || p.ok === false) { onToast(refusalLine({ code: p && p.error })); return; }
    const requestId = newSeatRequestId();
    const line = seatPriceLine(p);
    const message = lead === 'send' ? tr`Sending needs more seats. ${line}`
      : lead === 'approve' ? tr`Every seat is in use. Approving adds one. ${line}`
      : lead === 'role' ? tr`Every seat is in use. This adds one. ${line}`
      : lead === 'moveIn' ? tr`Moving it in needs more seats. ${line}`
      : line;
    ask({ message, confirmLabel: label, run: () => run(p, requestId) });
  };

  const openPortal = async () => {
    const res = await onAction('portal');
    if (res.ok && res.data && res.data.url) globalThis.location.assign(res.data.url);
    else if (!res.ok) onToast(refusalLine(res.refusal));
  };

  const closeTeamToast = () => {
    if (!isLive) {
      onToast(tr`Preview: closing is look-only. Its workspaces would move to your own account, and everyone in them keeps what they had.`);
      return;
    }
    ask({
      message: tr`Close ${ph({ name: t.name })}? Its workspaces move to your personal account and the plan ends.`,
      confirmLabel: tr`Close the team`,
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
      onToast(tr`Preview: leaving is look-only. You’d keep your own workspaces and give back your seat.`);
      return;
    }
    ask({
      message: tr`Leave ${ph({ name: t.name })}? You keep your own workspaces and give back your seat.`,
      confirmLabel: tr`Leave the team`,
      danger: true,
      run: async () => {
        const res = await go('leave');
        if (res.ok) onClose?.();
        return res;
      },
    });
  };

  const menuItems = [];
  if (teamCan(role, 'renameTeam')) menuItems.push({ id: 'renameTeam', label: tr`Rename the team` });
  if (teamCan(role, 'leaveTeam')) menuItems.push({ id: 'leaveTeam', label: tr`Leave the team` });
  if (teamCan(role, 'closeTeam')) menuItems.push({ id: 'closeTeam', label: tr`Close the team`, danger: true });
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

  const goAsked = (type, payload, say) => (type === 'removeSeat' ? askRemoveSeat() : go(type, payload, say));
  const onActionAsked = (type, payload) => (type === 'removeSeat' ? askRemoveSeat() : onAction(type, payload));
  const common = {
    t, now, viewOnly, onAction: onActionAsked, onToast, live: isLive, go: goAsked, report, ask, priceThen, openPortal,
    removeLater, track, isBusy,
  };
  const tabLabels = { people: tr`People`, workspaces: tr`Workspaces`, billing: tr`Seats & billing`, joining: tr`Joining` };
  const unpaid = t.unpaid;
  const failedDay = unpaid && unpaid.failedAt ? dayLabel(unpaid.failedAt) : null;
  // The sample's banner shows while it is view-only; a real team's also covers
  // the grace period before that.
  const showBanner = !!unpaid && (isLive || viewOnly);
  const frozen = isLive ? !!unpaid && unpaid.viewOnly : viewOnly;

  return (
    <div className="tp-ground" data-team-page>
      <section className="tp-sheet" aria-label={tr`${ph({ name: t.name })}, team`}>
        <div className="tp-head">
          <span className="tp-mark" style={{ background: t.color }} aria-hidden="true">{t.letter}</span>
          <div className="tp-name">
            <div className="tp-titleline">
              {renaming ? (
                <input
                  className="tp-title-input"
                  aria-label={tr`Team name`}
                  dir="auto"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (isComposingKey(e)) return;
                    if (e.key === 'Enter') saveRename();
                    if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false); titleRef.current?.focus(); }
                  }}
                />
              ) : (
                <h2 className="tp-title" ref={titleRef} tabIndex={-1} dir="auto">{t.name}</h2>
              )}
              {t.sample && <span className="tp-badge"><Trans>Test team</Trans></span>}
              {viewOnly && <span className="tp-badge"><Icon as={Eye} size={11} weight="regular" /><Trans>View-only</Trans></span>}
            </div>
            <span className="tp-sub">
              {manager
                ? (t.plan
                  ? (t.plan.interval === 'year'
                    ? tr`Team plan · ${ph({ seats: t.plan.seats })} seats · billed yearly`
                    : tr`Team plan · ${ph({ seats: t.plan.seats })} seats · billed monthly`)
                  : tr`Team plan`)
                : tr`Team · you’re a member`}
            </span>
          </div>
          {manager && (
            <div className="tp-acts">
              <button
                type="button"
                className={`tp-btn${viewOnly ? '' : ' tp-btn-primary'}`}
                disabled={viewOnly}
                title={viewOnly ? frozenTip() : undefined}
                aria-label={tr`Invite people`}
                onClick={inviteClick}
              >
                <Icon as={UserPlus} size={14} weight="regular" /><span className="tp-btn-label"><Trans>Invite people</Trans></span>
              </button>
              <span className="tp-acts-wrap">
                <button
                  type="button"
                  className="tp-btn tp-btn-icon"
                  aria-label={tr`More`}
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
          <button type="button" className="tp-close" aria-label={tr`Close the team page`} onClick={() => onClose?.()}>
            <Icon as={X} size={15} weight="regular" />
          </button>
        </div>

        <div className="tp-tabs" role="tablist" aria-label={tr`Team`} onKeyDown={onTabKey}>
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
              {id === 'workspaces' && <span className="tp-tab-n">{(t.workspaces || []).length}</span>}
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
                      {failedDay
                        ? <Trans><b>{ph({ name: t.name })} is view-only.</b> The team’s payment didn’t go through on {ph({ day: failedDay })}. Opening, downloading and exporting still work, and paying turns editing back on.</Trans>
                        : <Trans><b>{ph({ name: t.name })} is view-only.</b> The team’s payment didn’t go through. Opening, downloading and exporting still work, and paying turns editing back on.</Trans>}
                    </span>
                    <small>
                      {unpaid.deleteAt
                        ? tr`Nothing has been deleted. If the team stays unpaid, its workspaces are deleted on ${ph({ date: dateLabel(unpaid.deleteAt) })}, and we’ll remind you before then.`
                        : tr`Nothing has been deleted. If the team stays unpaid, its workspaces are deleted a year after it went view-only, and we’ll remind you before then.`}
                    </small>
                  </>
                ) : (
                  <>
                    <span>
                      <b>{failedDay
                        ? tr`${ph({ name: t.name })}’s payment didn’t go through on ${ph({ day: failedDay })}.`
                        : tr`${ph({ name: t.name })}’s payment didn’t go through.`}</b>{' '}
                      {unpaid.graceEndsAt
                        ? tr`Editing keeps working until ${ph({ date: dateLabel(unpaid.graceEndsAt) })}; updating the card keeps it that way.`
                        : tr`Editing keeps working for now; updating the card keeps it that way.`}
                    </span>
                  </>
                )}
              </span>
              {teamCan(role, 'changeCard') && (
                <button
                  type="button"
                  className="tp-btn tp-btn-primary"
                  onClick={isLive ? openPortal : () => onToast(tr`Preview: the card form comes with billing. Nothing was charged.`)}
                >
                  <Trans>Update the card</Trans>
                </button>
              )}
            </div>
          )}
          {tab === 'people' && <TeamPeople {...common} />}
          {tab === 'workspaces' && <TeamWorkspaces {...common} onOpenWorkspace={onOpenWorkspace} />}
          {tab === 'billing' && manager && <TeamBilling {...common} onCloseTeam={closeTeamToast} />}
          {tab === 'joining' && manager && <TeamJoining {...common} focusKey={focusKey} />}
        </div>
      </section>
    </div>
  );
}
