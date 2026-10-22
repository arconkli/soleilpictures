// WorkspaceSetup — the first-run setup, before the canvas (workspace_setup
// arm B; lib/workspaceSetup.js has the rules, lib/setupGate.js the gate).
//
// The design the owner picked ("I tuned", 2026-10-20): a frosted card over the
// workspace it sets up, with the workspace itself as a card above it that
// fills in as they answer. Three steps for someone starting out (name it, who
// and what it's for, invite with the link first) and one for someone joining
// another person's workspace. Every answer is kept in
// profiles.settings.welcome as it is given, so a reload resumes where they
// were, and every step's view, answer and time on it is logged.

import './setup.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  User, Users, UsersThree, FilmSlate, Camera, PenNib, Megaphone, MusicNotes, GraduationCap, Heart, DotsThree, CaretLeft,
} from '@phosphor-icons/react';
import { Icon } from '../Icon.jsx';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { getOrCreatePersonalWorkspace, renameWorkspace, updateOwnSettings } from '../../lib/boardsApi.js';
import { bootPrefetchSetupDone } from '../../lib/bootPrefetch.js';
import {
  NAME_MAX, TEAM_OPTIONS, WORK_OPTIONS, SETUP_STEPS, validateWorkspaceName, inviteCopyFor, nextSetupState,
  workToFirstBoardKind,
} from '../../lib/workspaceSetup.js';
import { firstBoardCopy } from '../../lib/firstBoardCopy.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { InviteStep } from './InviteStep.jsx';

const TEAM_ICONS = { solo: User, few: Users, team: UsersThree };
const WORK_ICONS = {
  film: FilmSlate, photo: Camera, design: PenNib, ads: Megaphone, music: MusicNotes, school: GraduationCap, personal: Heart, other: DotsThree,
};
const iso = () => new Date().toISOString();
const initial = (s) => (String(s || '').trim().charAt(0) || '?').toUpperCase();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The workspace behind the card, out of focus. A brand-new workspace is a
// sidebar and an empty board, so this is that, drawn plainly.
export function Behind({ name }) {
  return (
    <>
      <div className="su-behind" aria-hidden="true">
        <div className="su-bd-side">
          <div className="su-bd-ws"><span className="su-bd-av">{initial(name)}</span><span className="su-bd-name">{name || 'Your workspace'}</span></div>
          <div className="su-bd-eyebrow">Clusters</div>
          <div className="su-bd-row is-on" />
          <div className="su-bd-row is-short" />
          <div className="su-bd-eyebrow">Files</div>
          <div className="su-bd-row" /><div className="su-bd-row is-short" /><div className="su-bd-row" />
        </div>
        <div className="su-bd-top"><span className="su-bd-pill" /><span className="su-bd-pill is-round" /></div>
        <div className="su-bd-hero"><div className="su-bd-h" /><div className="su-bd-p" /><div className="su-bd-p" /></div>
      </div>
      <div className="su-scrim" aria-hidden="true" />
    </>
  );
}

function Chips({ value, onPick }) {
  return (
    <div className="su-chips">
      {WORK_OPTIONS.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} type="button" className={`su-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onPick(on ? null : o.id)}>
            <Icon as={WORK_ICONS[o.id]} size={16} weight="regular" className="su-chip-ico" /><span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function WorkspaceSetup({ user, initialState, invitee, onDone }) {
  const { isPhone } = useBreakpoint();
  const uid = user?.id;
  const [state, setState] = useState(initialState);
  const stateRef = useRef(initialState);
  const [typed, setTyped] = useState('');
  const [ws, setWs] = useState(null);                // { id, name } once the name is saved
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [team, setTeam] = useState(initialState?.team || null);
  const [work, setWork] = useState(initialState?.work || null);
  const [out, setOut] = useState(false);             // the link went out, or an email did
  const [invited, setInvited] = useState([]);
  const [links, setLinks] = useState(0);
  const startedAt = useRef(Date.now());
  const stepAt = useRef(Date.now());
  const panelRef = useRef(null);
  const wayOnRef = useRef(null);
  const step = state?.step || (invitee ? 'invitee' : 'name');

  // A resumed setup past the name step needs the workspace it named. It
  // already exists, so this only reads it.
  useEffect(() => {
    if (invitee || step === 'name' || ws || !uid) return;
    getOrCreatePersonalWorkspace({ userId: uid })
      .then((w) => { if (w?.id) setWs({ id: w.id, name: w.name }); })
      .catch((e) => { try { logEvent(EV.SETUP_ERROR, { op: 'workspace', reason: String(e?.message || e).slice(0, 80) }); } catch (_) {} });
  }, [invitee, step, ws, uid]);

  // One view per step, and the time spent on it rides the move that leaves it.
  // Keyed on the step, so an effect run twice (StrictMode) still counts once.
  const viewedRef = useRef(null);
  useEffect(() => {
    if (viewedRef.current !== step) {
      viewedRef.current = step;
      stepAt.current = Date.now();
      try { logEvent(EV.SETUP_STEP, { step, action: 'view', invitee: !!invitee, phone: isPhone }); } catch (_) {}
    }
    // Focus lands on the new step, so a keyboard or a screen reader starts at
    // its heading rather than on the button that was pressed.
    const t = setTimeout(() => {
      const target = panelRef.current?.querySelector('[data-autofocus]') || panelRef.current;
      target?.focus?.();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Once the link is out, the way on changes to "Open {ws}". On a short phone
  // it sits below the fold, so bring it into view.
  useEffect(() => {
    if (!out) return undefined;
    const raf = requestAnimationFrame(() => wayOnRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
    return () => cancelAnimationFrame(raf);
  }, [out]);

  // The app opens after the invite step, so what it opens with starts as the
  // step shows (lib/bootPrefetch.js bootPrefetchSetupDone), and "Open {ws}"
  // lands on a painted canvas. Not for someone joining another workspace,
  // which is where they land.
  useEffect(() => {
    if (step === 'invite' && !invitee && ws?.id) bootPrefetchSetupDone(user, ws.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, invitee, ws?.id]);

  const persist = useCallback((next) => {
    const write = updateOwnSettings({ welcome: next }).catch((e) => {
      try { logEvent(EV.SETUP_ERROR, { op: 'settings', reason: String(e?.message || e).slice(0, 80) }); } catch (_) {}
    });
    return write;
  }, []);

  const move = useCallback((m, props = {}) => {
    const prev = stateRef.current;
    const next = nextSetupState(prev, { ...m, now: iso() });
    if (next === prev) return prev;
    const action = m.type === 'back' ? 'back' : (m.type === 'skip_who' || m.type === 'invite_skipped') ? 'skip' : 'done';
    try {
      logEvent(EV.SETUP_STEP, { step: prev.step, action, ms: Date.now() - stepAt.current, invitee: !!invitee, phone: isPhone, ...props });
    } catch (_) {}
    stateRef.current = next;
    setState(next);
    return next;
  }, [invitee, isPhone]);

  // The way out of the last step: the record is written before the app opens
  // (briefly waited for, so a reload right after doesn't land back here), then
  // the app takes over.
  const finish = useCallback(async (m, props) => {
    const next = move(m, props);
    if (!next?.done) return;
    try {
      logEventNow(EV.SETUP_DONE, {
        invitee: !!invitee, team: next.team, work: next.work, invite: next.invite || null,
        emails: invited.length, links, ms_total: Date.now() - startedAt.current, phone: isPhone,
      });
    } catch (_) {}
    setBusy(true);
    // Whatever went stale while the step was open starts again beside the save.
    if (!invitee && ws?.id) bootPrefetchSetupDone(user, ws.id);
    await Promise.race([persist(next), wait(1500)]);
    onDone?.(next);
  }, [move, persist, onDone, invitee, invited.length, links, isPhone, user, ws]);

  // ── Step 1: the name ──────────────────────────────────────────────────────
  const submitName = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const v = validateWorkspaceName(typed);
    if (!v.ok) {
      setNameError(v.reason === 'too_long' ? `Keep it to ${NAME_MAX} characters.` : 'Give your workspace a name to continue.');
      return;
    }
    setBusy(true);
    setNameError(null);
    try {
      let w = await getOrCreatePersonalWorkspace({ userId: uid, name: v.name });
      if (w?.id && w.name !== v.name && (!w.created_by || w.created_by === uid)) {
        await renameWorkspace(w.id, v.name);
        w = { ...w, name: v.name };
      }
      setWs({ id: w.id, name: v.name });
      const next = move({ type: 'name', name: v.name }, { chars: [...v.name].length });
      persist(next);
    } catch (err) {
      setNameError('That didn’t save. Try again.');
      try { logEvent(EV.SETUP_ERROR, { op: 'workspace', reason: String(err?.message || err).slice(0, 80) }); } catch (_) {}
    } finally {
      setBusy(false);
    }
  };

  // ── Step 2: who and what ──────────────────────────────────────────────────
  const submitWho = (skip) => {
    const next = skip
      ? move({ type: 'skip_who' })
      : move({ type: 'who', team, work }, { team, work });
    persist(next);
  };

  const back = () => {
    const next = move({ type: 'back' });
    // Back at the name, after a reload too: the field holds the name they gave.
    if (next?.step === 'name' && !typed.trim() && ws?.name) setTyped(ws.name);
    persist(next);
  };

  // ── What the workspace card says ──────────────────────────────────────────
  const shownName = invitee ? invitee.name : (ws?.name || typed.trim());
  const kind = workToFirstBoardKind(step === 'who' ? work : (state?.work ?? work));
  const firstHead = firstBoardCopy(kind).head;
  const stripLine = invitee
    ? (invitee.kind === 'board' ? 'Shared with you' : 'Studio')
    : step === 'invite'
      ? (invited.length ? `${invited.length} invited` : out ? 'Invite link ready' : 'Studio')
      : (firstHead || 'Studio');
  const wsName = ws?.name || typed.trim() || 'your workspace';
  // The team answer shows as empty seats on the workspace card, which the
  // people invited on the next step fill.
  const teamNow = step === 'who' ? team : (state?.team ?? null);
  const seats = step === 'who' || step === 'invite' ? (teamNow === 'team' ? 3 : teamNow === 'few' ? 2 : 0) : 0;
  const invCopy = inviteCopyFor(state?.team ?? team, wsName);
  const stepNo = SETUP_STEPS.indexOf(step) + 1;

  const strip = (
    <div className="su-strip" aria-label="Your workspace, as you set it up">
      <span className="su-strip-av" aria-hidden="true">{initial(shownName)}</span>
      <span className="su-strip-text">
        <span className={`su-strip-name${shownName ? '' : ' is-empty'}`}>{shownName || 'Your workspace'}</span>
        <span className="su-strip-line">{stripLine}</span>
      </span>
      {invitee?.faces?.length > 0 && (
        <span className="su-strip-faces" aria-hidden="true">
          {invitee.faces.map((f) => <span key={f.id} className="su-face" style={f.color ? { background: f.color } : undefined}>{initial(f.name)}</span>)}
        </span>
      )}
      {!invitee && (seats > 0 || (step === 'invite' && invited.length > 0)) && (
        <span className="su-strip-faces" aria-hidden="true">
          {step === 'invite' && invited.slice(0, 4).map((e) => <span key={e} className="su-face is-invited" style={{ background: pickPresenceColor(e) }}>{initial(e)}</span>)}
          {Array.from({ length: Math.max(0, seats - (step === 'invite' ? invited.length : 0)) }, (_, i) => <span key={`seat-${i}`} className="su-face is-seat" />)}
        </span>
      )}
    </div>
  );

  return (
    <div className={`su ${isPhone ? 'is-phone' : 'is-desk'} at-${step}`}>
      <Behind name={shownName} />
      <div className="su-shell">
        {strip}
        <main className="su-panel" ref={panelRef} tabIndex={-1} aria-labelledby="su-h">
          {!invitee && stepNo > 1 && (
            <button type="button" className="su-back" onClick={back} disabled={busy}>
              <Icon as={CaretLeft} size={14} weight="regular" />Back
            </button>
          )}
          {!invitee && stepNo > 0 && (
            <div className="su-steps" aria-label={`Step ${stepNo} of ${SETUP_STEPS.length}`}>
              <span className="su-bars" aria-hidden="true">
                {SETUP_STEPS.map((s, i) => <span key={s} className={`su-bar${i + 1 < stepNo ? ' is-done' : i + 1 === stepNo ? ' is-now' : ''}`} />)}
              </span>
              <span className="su-stepof">Step {stepNo} of {SETUP_STEPS.length}</span>
            </div>
          )}

          {step === 'name' && (
            <form className="su-step su-step-name" onSubmit={submitName} noValidate>
              <h1 className="su-h" id="su-h">Name your workspace</h1>
              <p className="su-sub">It’s where your clusters, files and people live. You can rename it any time.</p>
              <div className="su-field">
                <label className="su-label" htmlFor="su-wsname">Workspace name</label>
                <input id="su-wsname" className="su-input su-input-name" type="text" autoComplete="off" maxLength={NAME_MAX * 2}
                  placeholder="e.g. Lost Time, Northlight Studio" value={typed} data-autofocus disabled={busy}
                  aria-invalid={!!nameError} aria-describedby={nameError ? 'su-name-err' : undefined}
                  onChange={(e) => { setTyped(e.target.value); if (nameError) setNameError(null); }} />
                {nameError && <p className="su-error" id="su-name-err" role="alert">{nameError}</p>}
              </div>
              <div className="su-actions">
                <button type="submit" className="su-btn su-primary" disabled={busy || !typed.trim()}>{busy ? 'Saving…' : 'Continue'}</button>
                <span className="su-enter" aria-hidden="true">or press <kbd>Enter</kbd></span>
              </div>
            </form>
          )}

          {step === 'who' && (
            <div className="su-step su-step-who">
              <h1 className="su-h" id="su-h" tabIndex={-1} data-autofocus>Tell us about {wsName}</h1>
              <p className="su-sub">Two taps. We’ll set up your first cluster to match.</p>
              <fieldset className="su-group">
                <legend className="su-legend">Who’s working in it?</legend>
                <div className="su-opts">
                  {TEAM_OPTIONS.map((o) => {
                    const on = team === o.id;
                    return (
                      <button key={o.id} type="button" className={`su-opt${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setTeam(on ? null : o.id)}>
                        <Icon as={TEAM_ICONS[o.id]} size={20} weight="regular" className="su-opt-ico" /><span className="su-opt-lbl">{o.label}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="su-group">
                <legend className="su-legend">What kind of work?</legend>
                <Chips value={work} onPick={setWork} />
              </fieldset>
              <div className="su-actions">
                <button type="button" className="su-btn su-primary" onClick={() => submitWho(false)}>Continue</button>
                <button type="button" className="su-btn su-quiet" onClick={() => submitWho(true)}>Skip</button>
              </div>
            </div>
          )}

          {step === 'invite' && (
            <div className="su-step su-step-invite">
              <h1 className="su-h" id="su-h" tabIndex={-1} data-autofocus>{invCopy.head}</h1>
              <p className="su-sub">{invCopy.sub}</p>
              <InviteStep workspaceId={ws?.id || null} workspaceName={wsName} surface="setup" isPhone={isPhone}
                onOut={(how) => { setOut(true); if (how === 'link') setLinks((n) => n + 1); }}
                onInvited={(emails) => setInvited((prev) => [...prev, ...emails])} />
              <div className="su-actions-lf">
                {out
                  ? <button ref={wayOnRef} type="button" className="su-btn su-primary" disabled={busy} onClick={() => finish({ type: 'invite_sent' }, { emails: invited.length, links })}>Open {wsName}</button>
                  : <button type="button" className="su-skip" disabled={busy} onClick={() => finish({ type: 'invite_skipped' })}>Skip for now</button>}
              </div>
            </div>
          )}

          {step === 'invitee' && invitee && (
            <div className="su-step su-step-invitee">
              {invitee.faces?.length > 0 && (
                <div className="su-joining" aria-hidden="true">
                  {invitee.faces.map((f) => <span key={f.id} className="su-jface" style={f.color ? { background: f.color } : undefined}>{initial(f.name)}</span>)}
                </div>
              )}
              <h1 className="su-h" id="su-h" tabIndex={-1} data-autofocus>{invitee.head}</h1>
              <p className="su-sub">{invitee.sub}</p>
              <fieldset className="su-group">
                <legend className="su-legend">What kind of work do you do?<span className="su-opt-note">Optional</span></legend>
                <Chips value={work} onPick={setWork} />
              </fieldset>
              <div className="su-actions">
                <button type="button" className="su-btn su-primary" disabled={busy} onClick={() => finish({ type: 'invitee_done', work }, { work, kind: invitee.kind })}>
                  {invitee.name ? `Open ${invitee.name}` : 'Open it'}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
