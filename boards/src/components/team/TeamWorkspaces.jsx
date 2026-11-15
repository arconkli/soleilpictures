// TeamWorkspaces — the Workspaces tab: the team's workspaces and who can open
// each. The owner and admins make one private or move it out of the team;
// anyone with a seat moves one of their own in, and sees what that takes
// before anything moves. On the sample team it is look only: the list answers
// through teamReducer and nothing leaves the browser.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Plus, Lock, ArrowSquareOut, LogOut, MoreHorizontal, ChevronDown } from '../../lib/icons.js';
import { teamCan, moveOutReceivers } from '../../lib/teamModel.js';
import { refusalLine, moveInNeedLine, moveInAskLine, ownEditorsLine } from '../../lib/teamCopy.js';
import { runTeamAction } from '../../lib/teamActions.js';
import { previewMoveIntoTeam } from '../../lib/teamsApi.js';
import { loadOwnPersonalWorkspaces } from '../../lib/teamSetupData.js';
import { supabase } from '../../lib/supabase.js';
import { initialOf } from '../../lib/graphemes.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { TeamMenu } from './TeamMenu.jsx';
import { t as tr, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const frozen = () => tr`The team is view-only until it’s paid`;

// The workspace menu re-reads the teams (hooks/useMyTeams.js).
function teamsChanged() {
  try { window.dispatchEvent(new Event('soleil:teams-changed')); } catch (_) {}
}

// The owner's pick of who a workspace leaving the team goes to, inside the
// confirm's sentence. The pick lives in `pickRef` and nowhere else: the
// confirm reads it when it runs, and a new confirm resets it.
function MoveOutTo({ people, meId, pickRef }) {
  const [open, setOpen] = useState(false);
  const [, redraw] = useState(0);
  const id = pickRef.current;
  const you = tr({ message: 'you', context: 'who a workspace moves to' });
  const label = (p) => (p.id === meId ? you : p.name);
  const cur = people.find((p) => p.id === id);
  return (
    <span className="tp-selwrap tp-ws-to">
      <button type="button" className="tp-sel" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {cur ? label(cur) : you}<Icon as={ChevronDown} size={10} weight="regular" />
      </button>
      {open && (
        <TeamMenu
          items={people.map((p) => ({ id: p.id, label: label(p), checked: p.id === id }))}
          onPick={(next) => { pickRef.current = next; redraw((n) => n + 1); }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

// "Move one of yours in": the person's own workspaces outside a team, and
// what moving the picked one in takes.
function MoveIn({ t, live, go, onAction, onToast, ask, priceThen, onClose }) {
  const canBuy = teamCan(t.me.role, 'addSeats');
  const [own, setOwn] = useState(null);   // a real team's list; null while it loads
  const [pick, setPick] = useState(null);
  const [look, setLook] = useState(null); // { loading } | { seatsNeeded } | { refusal }
  const [busy, setBusy] = useState(false);
  const pickRef = useRef(null);
  const pricing = useRef(false);          // a price from here is waiting to be confirmed

  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    loadOwnPersonalWorkspaces(supabase, t.me.id).then((rows) => { if (alive) setOwn(rows); });
    return () => { alive = false; };
  }, [live, t.me.id]);

  const list = live ? own : (t.ownWorkspaces || []);
  const picked = (list || []).find((w) => w.id === pick) || null;
  const need = look && !look.loading && !look.refusal ? look.seatsNeeded : null;

  const choose = async (w) => {
    pickRef.current = w.id;
    setPick(w.id);
    if (!live) { setLook({ seatsNeeded: Math.max(0, w.seatsNeeded | 0) }); return; }
    setLook({ loading: true });
    // Straight to the function, not through the page's act: a look changes
    // nothing, so the team isn't read again.
    const res = await runTeamAction({ previewMoveIntoTeam }, t.id, 'previewMoveIn', { workspaceId: w.id });
    if (pickRef.current !== w.id) return; // another one was picked meanwhile
    setLook(res.ok ? { seatsNeeded: res.data.seatsNeeded } : { refusal: res.refusal });
  };

  const moveIn = async () => {
    if (!picked) return;
    setBusy(true);
    const res = await go('moveIn', live ? { workspaceId: picked.id } : { workspaceId: picked.id, workspace: picked });
    setBusy(false);
    if (res.ok) { if (live) teamsChanged(); onClose(); return; }
    // The free seats went while the card was open: say what it takes now.
    if (res.refusal?.code === 'team_seats_needed' && Number(res.refusal.needed) > 0) {
      setLook({ seatsNeeded: Number(res.refusal.needed) });
    }
  };

  // The seats first, at the price shown, then the move: the move never buys.
  const seePrice = async () => {
    if (!picked || !(need > 0)) return;
    const w = picked;
    if (!live) {
      onAction('addSeats', { n: need });
      onAction('moveIn', { workspaceId: w.id, workspace: w });
      onToast(tr`Preview: nothing was charged.`);
      onClose();
      return;
    }
    const total = t.plan.seats + need;
    setBusy(true);
    try {
      await priceThen(total, tr`Add seats and move it in`, async (p, requestId) => {
        pricing.current = false;
        const bought = await go('addSeats', { seats: total, requestId, prorationDate: p.proration_date }, false);
        if (!bought.ok) return bought;
        const res = await go('moveIn', { workspaceId: w.id });
        if (res.ok) { teamsChanged(); onClose(); } else choose(w);
        return res;
      }, 'moveIn');
      pricing.current = true;
    } finally { setBusy(false); }
  };

  const cancel = () => {
    if (pricing.current) { pricing.current = false; ask(null); }
    onClose();
  };

  return (
    <div className="tp-card tp-ws-card">
      <span className="tp-card-k"><Trans>Move one of yours in</Trans></span>
      <p className="tp-card-t">
        <Trans>Its clusters, files and people come with it. The team pays for it from then on, and everyone in the team can open it unless an admin makes it private.</Trans>
      </p>
      {list === null ? (
        <p className="tp-card-t" role="status"><Trans>Loading…</Trans></p>
      ) : list.length === 0 ? (
        <p className="tp-card-t"><Trans>You have no workspaces of your own to move in.</Trans></p>
      ) : (
        <div className="tp-opts" role="radiogroup" aria-label={tr`Move one of yours in`}>
          {list.map((w) => (
            <label key={w.id} className={`tp-opt${pick === w.id ? ' is-on' : ''}${busy ? ' is-off' : ''}`}>
              <input type="radio" name="tp-move-in" checked={pick === w.id} disabled={busy} onChange={() => choose(w)} />
              <span className="tp-opt-t">
                <b>{w.name}</b>
                <span>{live ? tr`Personal workspace` : ownEditorsLine(w.editors)}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {look && (
        <p className="tp-card-t" role="status">
          {look.loading ? tr`Checking…`
            : look.refusal ? refusalLine(look.refusal)
            : need === 0 ? tr`Fits in the seats you have.`
            : (
              <>
                <b>{moveInNeedLine(need)}</b>{' '}
                {!canBuy ? moveInAskLine(need)
                  : live && !t.plan ? refusalLine({ code: 'no_plan' })
                  : <>{tr`Some of its editors don’t have a seat in the team yet.`}{' '}{tr`You’ll see the price before anything is charged.`}</>}
              </>
            )}
        </p>
      )}
      <div className="tp-card-acts">
        {need === 0 && (
          <button type="button" className="tp-btn tp-btn-sm" disabled={busy} onClick={moveIn}><Trans>Move it in</Trans></button>
        )}
        {need > 0 && canBuy && (!live || t.plan) && (
          <button type="button" className="tp-btn tp-btn-sm" disabled={busy} onClick={seePrice}><Trans>See the price</Trans></button>
        )}
        <button type="button" className="tp-link" onClick={cancel}><Trans>Cancel</Trans></button>
      </div>
    </div>
  );
}

export default function TeamWorkspaces({ t, viewOnly, onAction, onToast, live, go, ask, priceThen, onOpenWorkspace }) {
  const role = t.me.role;
  const manager = teamCan(role, 'manageWorkspaces');
  const canMoveIn = teamCan(role, 'moveWorkspaceIn');
  const [menu, setMenu] = useState(null);     // the workspace whose "…" menu is open
  const [busyId, setBusyId] = useState(null); // the workspace whose action is running
  const [moving, setMoving] = useState(false);
  const toRef = useRef(null);                 // who a workspace being moved out goes to
  const list = t.workspaces || [];
  const lock = viewOnly ? { disabled: true, title: frozen() } : {};

  // One row's action: its controls are off until it answers.
  const run = async (w, fn) => {
    setBusyId(w.id);
    try {
      const res = await fn();
      if (live && res.ok) teamsChanged();
      return res;
    } finally { setBusyId(null); }
  };

  const open = (w) => {
    if (!live) { onToast(tr`Preview: ${ph({ name: w.name })} is an example workspace in the test team.`); return; }
    onOpenWorkspace?.(w.id);
  };

  // Making one private asks first; opening it to the team again doesn't.
  const setPrivate = (w, on) => {
    if (!on) { run(w, () => go('workspacePrivate', { workspaceId: w.id, private: false })); return; }
    ask({
      message: (
        <>
          {tr`Make ${ph({ name: w.name })} private?`}{' '}
          <span className="tp-confirm-sub">{tr`Anyone who opens it only through the team loses it. The owner, admins and people added to it keep it.`}</span>
        </>
      ),
      confirmLabel: tr`Make it private`,
      run: () => run(w, () => go('workspacePrivate', { workspaceId: w.id, private: true })),
    });
  };

  // The owner picks who gets it, themselves unless they say otherwise; an
  // admin's goes to the owner, the only receiver an admin may name.
  const moveOut = (w) => {
    const mine = role === 'owner';
    const owner = t.people.find((p) => p.role === 'owner');
    toRef.current = t.me.id;
    ask({
      message: (
        <>
          {mine
            ? <Trans>Move {ph({ name: w.name })} out of the team, to <MoveOutTo people={moveOutReceivers(t)} meId={t.me.id} pickRef={toRef} />?</Trans>
            : owner ? tr`Move ${ph({ name: w.name })} out of the team, to ${ph({ owner: owner.name })}?`
            : tr`Move ${ph({ name: w.name })} out of the team, to its owner?`}{' '}
          <span className="tp-confirm-sub">{tr`Anyone who opens it only through the team loses it. People added to it directly keep it.`}</span>
        </>
      ),
      confirmLabel: tr`Move it out`,
      run: () => run(w, () => go('moveOut', { workspaceId: w.id, ...(mine ? { toUserId: toRef.current } : {}) })),
    });
  };

  return (
    <>
      <div className="tp-tools">
        <span className="tp-note tp-ws-note"><Trans>Everyone in the team can open these, except the private ones.</Trans></span>
        {canMoveIn && (
          <button type="button" className="tp-btn tp-ws-add" aria-expanded={moving} onClick={() => setMoving(!moving)} {...lock}>
            <Icon as={Plus} size={12} weight="regular" /><Trans>Move one of yours in</Trans>
          </button>
        )}
      </div>

      {moving && canMoveIn && !viewOnly && (
        <MoveIn t={t} live={live} go={go} onAction={onAction} onToast={onToast} ask={ask} priceThen={priceThen} onClose={() => setMoving(false)} />
      )}

      <div className={`tp-tbl tp-wstbl${manager ? '' : ' is-plain'}`} role="table" aria-label={tr`Workspaces`}>
        <div className="tp-tr is-ws is-head" role="row">
          <span><Trans>Workspace</Trans></span><span><Trans>Who can open it</Trans></span>{manager && <span><Trans>Private</Trans></span>}<span />
        </div>
        {list.map((w) => {
          const busy = busyId === w.id;
          const items = [{ id: 'open', label: <span className="tp-ws-mi"><Icon as={ArrowSquareOut} size={13} weight="regular" />{tr`Open`}</span> }];
          if (manager) items.push({ id: 'out', label: <span className="tp-ws-mi"><Icon as={LogOut} size={14} weight="regular" />{tr`Move out of the team`}</span> });
          return (
            <div className="tp-tr is-ws" role="row" key={w.id}>
              <span className="tp-who">
                <span className="tp-ws" style={{ background: w.color || t.color || pickPresenceColor(w.id) }} aria-hidden="true">
                  {initialOf(w.name, w.letter || t.letter)}
                </span>
                <span className="tp-nm">
                  <span className="tp-ws-name">{w.name}</span>
                  {w.private && <span className="tp-ws-lock" role="img" aria-label={tr`Private`}><Icon as={Lock} size={12} weight="regular" /></span>}
                </span>
              </span>
              <span className={`tp-cell${w.private ? '' : ' is-now'}`}>
                {w.private ? tr`The owner, admins and people added to it` : tr`Everyone in the team`}
              </span>
              {manager && (
                <span className="tp-ws-sw">
                  <button
                    type="button"
                    className="tp-sw"
                    role="switch"
                    aria-checked={!!w.private}
                    aria-label={tr`${ph({ name: w.name })} is private`}
                    disabled={busy}
                    onClick={() => setPrivate(w, !w.private)}
                  />
                </span>
              )}
              <span className="tp-rowacts">
                <span className="tp-dotswrap">
                  <button
                    type="button"
                    className="tp-dots"
                    aria-label={tr`More for ${ph({ name: w.name })}`}
                    aria-haspopup="menu"
                    aria-expanded={menu === w.id}
                    disabled={busy}
                    onClick={() => setMenu(menu === w.id ? null : w.id)}
                  >
                    <Icon as={MoreHorizontal} size={15} weight="regular" />
                  </button>
                  {menu === w.id && (
                    <TeamMenu
                      align="right"
                      items={items}
                      onPick={(id) => (id === 'open' ? open(w) : moveOut(w))}
                      onClose={() => setMenu(null)}
                    />
                  )}
                </span>
              </span>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="tp-empty" role="row"><Trans>No workspaces here yet.</Trans></div>
        )}
      </div>
    </>
  );
}
