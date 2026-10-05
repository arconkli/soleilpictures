// UpgradeReasonAsk — "What's holding you back?", asked once, as an offer closes.
//
// Nobody has paid and nobody has started the Creator trial, and until this
// existed nobody had ever been asked why. The funnel could say where people
// stopped and never what stopped them: a price, a card form, an offer that came
// too early, a plan that was simply enough. The owner's decisions on price and
// on the card-required trial are now read off these answers (see the
// pre-registered rules on EV.UPGRADE_REASON_ANSWERED).
//
// WHEN. The moment someone closes an offer is the one moment the question is
// already on their mind. PricingModal and the over-cap import dialog announce
// that moment with OFFER_DISMISSED; this listens for it. Only a demo owner, only
// after the offer was actually on screen (a one-second floor, so an accidental
// open-and-close is not taken as an answer), and only once per account.
//
// HOW IT STAYS HONEST — the same rules ReturnReasonAsk learned the hard way:
//   • the write's `error` is DESTRUCTURED and read. supabase-js resolves with
//     {data, error}; a try/catch around it proves nothing.
//   • the tap is banked first, the note second, so a dropped follow-up costs the
//     note and never the answer; a pending record retries a transport failure
//     on a later page load, for at most a week, and a terminal code stops it.
//   • it counts as asked only once it has been on a live screen for a few
//     seconds, and that is stamped on the server (upgrade_prompts.
//     upgrade_reason_asked_at) so another device does not ask again.
//   • a refused upsell slot means "not this time", never "answered".
//   • what rides along with the answer is printed under it — nothing is
//     attached that the person cannot see.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { claimUpsellSlot } from '../lib/upsellSlot.js';
import { readUpgradePrompts, stampUpgradePrompt } from '../lib/upgradePrompts.js';
import { buildFeedbackContext, describeFeedbackContext } from '../lib/feedbackContext.js';
import { feedbackEnv } from '../lib/feedbackEnv.js';
import { OFFER_DISMISSED } from '../lib/offerEvents.js';
import { useAuth } from '../auth/AuthGate.jsx';

// The server's closed list (submit_upgrade_reason, 0348) and its labels
// (_upgrade_reason_label). feedbackContract.test.mjs compares both, in order.
// Fixed order, never rotated: at this volume randomising only adds variance and
// destroys the month-on-month comparison. "Something else" is last and is a
// real answer — without it, a reason that is not listed gets forced into one
// that is, and the price read is the first thing that would be corrupted.
const CHOICES = [
  { id: 'enough_room',  label: 'The free plan is enough for me', probe: 'What do you mostly use it for?' },
  { id: 'price',        label: 'The price',                      probe: 'What would feel fair?' },
  { id: 'no_card',      label: 'Putting a card in for a trial',  probe: 'What would make it easier?' },
  { id: 'unsure_value', label: "Not sure what I'd get",          probe: 'What would you want to know first?' },
  { id: 'just_trying',  label: 'Just trying it out for now',     probe: 'What would make it worth it?' },
  { id: 'other',        label: 'Something else',                 probe: 'What is it?' },
];

// PER ACCOUNT, not per device. On a shared computer a device-wide marker meant
// one account answering retired the question for the next, and a pending answer
// written in one account's session could be delivered in another's — filed by
// auth.uid() under the wrong person. Both the asked marker and the pending
// answer are keyed by account: each account's unsent answer waits in its own
// slot, is only ever sent in that account's session, and can't be overwritten
// by the next account's.
const askedKey = (uid) => `soleil.upgradereason.v1:${uid || 'anon'}`;
const pendingKey = (uid) => `soleil.upgradereason.pending.v1:${uid || 'anon'}`;
const MAX_TRIES = 3;
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL = new Set(['23514', '22023', '42501', '42883', '23505']);

const MIN_OFFER_DWELL_MS = 1_000; // the offer must have been read, not flicked shut
const SHOW_DELAY_MS = 450;        // after the modal's own exit, never on top of it
const DELIVERED_MS = 4_000;       // on a live screen this long = asked
const TICK_MS = 500;
const NOTE_IDLE_MS = 12_000;
const RECEIPT_MS = 1_600;

function readKey(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function writeKey(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
function dropKey(k) { try { localStorage.removeItem(k); } catch (_) {} }

let serverAskedFor = null;   // the account the server said has been asked
function alreadyHandled(uid) { return (uid && serverAskedFor === uid) || !!readKey(askedKey(uid)); }

function readPending(uid) {
  try {
    const raw = readKey(pendingKey(uid));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.choice) return null;
    if (!Number.isFinite(p.at) || Date.now() - p.at > PENDING_TTL_MS) { dropKey(pendingKey(uid)); return null; }
    return p;
  } catch (_) { dropKey(pendingKey(uid)); return null; }
}
function writePending(uid, p) { try { writeKey(pendingKey(uid), JSON.stringify(p)); } catch (_) {} }

// `data === false` is SUCCESS: the server already holds this account's answer.
async function deliver(choice, note, context) {
  try {
    const { data, error } = await supabase.rpc('submit_upgrade_reason', {
      p_choice: choice,
      p_note: note || null,
      p_context: context || null,
    });
    if (!error) return { ok: true, stored: data === true };
    const code = error.code || null;
    logEvent(EV.UPGRADE_REASON_WRITE_FAILED, { code, terminal: !code || TERMINAL.has(code), stage: note ? 'note' : 'choice' });
    return { ok: false, terminal: !!code && TERMINAL.has(code) };
  } catch (_) {
    logEvent(EV.UPGRADE_REASON_WRITE_FAILED, { code: null, terminal: false, stage: note ? 'note' : 'choice' });
    return { ok: false, terminal: false };
  }
}

// Module scope, not a ref: StrictMode double-invokes effects in dev, and a
// per-mount guard would spend two of the three attempts on one page load.
// Once per account per page load; another account's record waits in its own
// slot for that account's session.
const flushedFor = new Set();
async function flushPending(uid) {
  if (!uid || flushedFor.has(uid)) return;
  flushedFor.add(uid);
  const p = readPending(uid);
  if (!p || p.uid !== uid) return;
  if ((Number(p.tries) || 0) >= MAX_TRIES) { dropKey(pendingKey(uid)); return; }
  writePending(uid, { ...p, tries: (Number(p.tries) || 0) + 1 });
  const res = await deliver(p.choice, p.note, p.context);
  if (res.ok || res.terminal) dropKey(pendingKey(uid));
}

export function UpgradeReasonAsk() {
  const { user } = useAuth() || {};
  const uid = user?.id || null;
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const [ask, setAsk] = useState(null);       // { offer, surface, method, trial, context }
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingShowRef = useRef(null);
  const deliveredRef = useRef(null);
  const idleRef = useRef(null);
  const touchedRef = useRef(false);
  const openRef = useRef(false);
  openRef.current = !!ask;

  useEffect(() => { flushPending(uid); }, [uid]);

  useEffect(() => {
    let cancelled = false;

    const onDismissed = async (e) => {
      const d = e?.detail || {};
      const who = uidRef.current;
      if (openRef.current || pendingShowRef.current) return;
      if (alreadyHandled(who)) return;
      if (d.tier !== 'demo') return;
      // Import-dialog answers carry no dwell; a modal that was flicked shut does.
      if (Number.isFinite(d.dwell_ms) && d.dwell_ms < MIN_OFFER_DWELL_MS) return;

      // The per-account marker lives on the server. Read it at the moment it
      // matters rather than threading it through App: a stale "not asked" here
      // costs one extra question on a second device, at most once.
      pendingShowRef.current = 'reading';
      try {
        const prompts = await readUpgradePrompts();
        if (prompts?.upgrade_reason_asked_at) serverAskedFor = who;
      } catch (_) { /* unreadable: fall back to this device's marker */ }
      if (cancelled || alreadyHandled(who) || uidRef.current !== who) { pendingShowRef.current = null; return; }

      pendingShowRef.current = setTimeout(() => {
        pendingShowRef.current = null;
        if (cancelled || alreadyHandled(who) || uidRef.current !== who) return;
        // Claimed at show time. A refusal is "not this time" — nothing has been
        // stamped, so the next dismissal can ask again.
        if (!claimUpsellSlot('upgrade-reason')) return;
        // `surface` stays where the person was (the canvas, the list); the
        // offer they closed is `offer`, and what had opened it is `via`.
        const context = buildFeedbackContext({
          offer: d.offer, method: d.method, via: d.via,
          trial_offered: d.trial === true, dwell_ms: d.dwell_ms,
          cards: d.cards, server_cards: d.server_cards, cap: d.cap, tier: d.tier,
        }, feedbackEnv());
        setPicked(null); setNote(''); setReceipt(false); touchedRef.current = false;
        setAsk({ uid: who, offer: d.offer || null, surface: d.surface || null, method: d.method || null, trial: d.trial === true, context });
      }, SHOW_DELAY_MS);
    };

    window.addEventListener(OFFER_DISMISSED, onDismissed);
    return () => {
      cancelled = true;
      window.removeEventListener(OFFER_DISMISSED, onDismissed);
      if (typeof pendingShowRef.current === 'number') clearTimeout(pendingShowRef.current);
      pendingShowRef.current = null;
    };
  }, []);

  // Delivery: counts as asked once it has been on a live screen for a while.
  useEffect(() => {
    if (!ask) return undefined;
    let onScreen = 0;
    deliveredRef.current = setInterval(() => {
      if (document.hidden) return;
      onScreen += TICK_MS;
      if (onScreen < DELIVERED_MS) return;
      clearInterval(deliveredRef.current);
      deliveredRef.current = null;
      if (readKey(askedKey(ask.uid))) return;
      writeKey(askedKey(ask.uid), 'shown');
      try { logEvent(EV.UPGRADE_REASON_SHOWN, { offer: ask.offer, surface: ask.surface, method: ask.method, trial: ask.trial }); } catch (_) {}
      stampUpgradePrompt({ upgrade_reason_asked_at: new Date().toISOString() });
    }, TICK_MS);
    return () => { if (deliveredRef.current) clearInterval(deliveredRef.current); deliveredRef.current = null; };
  }, [ask]);

  // The follow-up closes itself if it is never touched.
  useEffect(() => {
    if (!ask || !picked || receipt) return undefined;
    idleRef.current = setTimeout(() => { if (!touchedRef.current) setAsk(null); }, NOTE_IDLE_MS);
    return () => { if (idleRef.current) clearTimeout(idleRef.current); idleRef.current = null; };
  }, [ask, picked, receipt]);

  if (!ask) return null;

  const current = CHOICES.find((c) => c.id === picked) || null;
  const contextLine = describeFeedbackContext(ask.context);

  // The delivery tick's event, logged now if the tick hasn't run: a tap or a
  // close inside the first seconds otherwise retired the tick before it logged,
  // so the denominator left out every fast response. The tick writes the
  // marker, so either it or this runs — the return question's rule.
  const markShown = () => {
    if (readKey(askedKey(ask.uid))) return;
    try { logEvent(EV.UPGRADE_REASON_SHOWN, { offer: ask.offer, surface: ask.surface, method: ask.method, trial: ask.trial }); } catch (_) {}
  };

  const bank = async (choice) => {
    if (busy || picked) return;
    setBusy(true);
    markShown();
    writeKey(askedKey(ask.uid), 'answered');
    writePending(ask.uid, { uid: ask.uid, choice, note: null, context: ask.context, tries: 1, at: Date.now() });
    try { logEventNow(EV.UPGRADE_REASON_ANSWERED, { choice, offer: ask.offer, surface: ask.surface, trial: ask.trial }); } catch (_) {}
    stampUpgradePrompt({ upgrade_reason_asked_at: new Date().toISOString() });
    const res = await deliver(choice, null, ask.context);
    if (res.ok || res.terminal) dropKey(pendingKey(ask.uid));
    setBusy(false);
    setPicked(choice);
  };

  const send = async () => {
    const text = note.trim();
    if (!text || busy) return;
    setBusy(true);
    // The tap's context travels with the note: if the tap's own write failed,
    // this is the write that creates the row, and without it the answer would
    // be banded by its author's plan and count TODAY, not when they answered.
    writePending(ask.uid, { uid: ask.uid, choice: picked, note: text, context: ask.context, tries: 1, at: Date.now() });
    try { logEvent(EV.UPGRADE_REASON_NOTE, { choice: picked, len: text.length }); } catch (_) {}
    const res = await deliver(picked, text, ask.context);
    if (res.ok || res.terminal) dropKey(pendingKey(ask.uid));
    setBusy(false);
    setReceipt(true);
    setTimeout(() => setAsk(null), RECEIPT_MS);
  };

  // "Not now" is an answer to whether to be asked, so it ends the question on
  // every device — not only this browser, as it would if only the local marker
  // were written.
  const dismiss = (via) => {
    if (!picked) markShown();
    if (!picked && !readKey(askedKey(ask.uid))) writeKey(askedKey(ask.uid), 'dismissed');
    if (!picked) stampUpgradePrompt({ upgrade_reason_asked_at: new Date().toISOString() });
    try { logEvent(EV.UPGRADE_REASON_DISMISSED, { via }); } catch (_) {}
    setAsk(null);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); dismiss('esc'); }
  };
  const onNoteKeyDown = (e) => {
    touchedRef.current = true;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  };

  if (receipt) {
    return (
      <div className="fv-banner surface-frosted rr-ask ur-ask rr-receipt" role="status" aria-live="polite">
        <div className="fv-banner-copy"><div className="fv-banner-title">Read. Thank you.</div></div>
      </div>
    );
  }

  return (
    <div className="fv-banner surface-frosted rr-ask ur-ask" role="dialog" aria-label="One question" onKeyDown={onKeyDown}>
      <div className="fv-banner-copy">
        <div className="fv-banner-title">{picked ? 'Thanks — that helps.' : "What's holding you back?"}</div>
        <div className="fv-banner-body">
          {picked ? current?.probe : 'One tap. We ask once, and a person here reads every answer.'}
        </div>

        <div className="rr-choices" aria-hidden={picked ? 'true' : undefined}>
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`rr-chip ${picked === c.id ? 'is-picked' : ''}`}
              disabled={busy || !!picked}
              tabIndex={picked ? -1 : undefined}
              onClick={() => bank(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {picked && (
          <textarea
            className="rr-note"
            rows={2}
            value={note}
            maxLength={500}
            disabled={busy}
            placeholder="Optional — a sentence is plenty."
            aria-label={current?.probe || 'Anything else'}
            autoFocus={typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)')?.matches}
            onChange={(e) => { touchedRef.current = true; setNote(e.target.value); }}
            onKeyDown={onNoteKeyDown}
          />
        )}

        {!picked && contextLine && (
          <div className="ask-context">Sent with your answer: {contextLine}</div>
        )}
      </div>

      <div className="fv-banner-actions">
        {picked ? (
          <>
            <button className="fv-banner-dismiss" onClick={() => dismiss('skip')} disabled={busy}>Skip</button>
            <button className="rr-send" onClick={send} disabled={busy || !note.trim()}>Send</button>
          </>
        ) : (
          <button className="fv-banner-dismiss" onClick={() => dismiss('x')} disabled={busy}>Not now</button>
        )}
      </div>
    </div>
  );
}
