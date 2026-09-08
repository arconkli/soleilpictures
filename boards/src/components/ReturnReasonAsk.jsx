// ReturnReasonAsk — the one question the product asks anyone.
//
// It shipped once and it did not work, in two independent ways worth naming
// here so neither comes back.
//
// 1. NOTHING IT COLLECTED WAS EVER STORED. submit_return_reason stamps
//    kind='return_reason'; public.feedback has carried a CHECK permitting only
//    bug|idea|praise|other since it was created. Every call raised 23514. This
//    file could not see it, because the supabase-js builder RESOLVES with
//    {data, error} rather than throwing — the try/catch around the call caught
//    nothing and the returned error was discarded — and the once-per-account
//    marker was written BEFORE the round trip, so each account was retired on a
//    write that always failed. Migration 0310 widens the constraint; the rule
//    below is that the error is DESTRUCTURED AND READ, never wrapped and hoped
//    over, and that a failed write does not get to retire an account.
//
// 2. THE OPTIONS COULD NOT BE POOLED EVEN IF THEY HAD LANDED. The old list
//    mixed a JOB (unfinished, new_material) with a TRIGGER (reminded,
//    someone_asked), so a person with a true answer on each axis had to discard
//    one — and which one they discarded depended on salience, not on truth.
//    "Just having another look" sat at the end as a costless universal
//    terminator and was, predictably, the only answer anyone ever gave.
//
// So: one axis (what you are here to do), five options with five distinct
// opening verbs, and the null moved OUT of the row into the actions, where it
// is honest to press and does not compete with five substantive claims.
//
// WHY ASK AT ALL. The product loses almost everyone between the first visit and
// the second. There is no honest way to ask someone who has already gone, but
// roughly a third do come back, and what pulls them is invisible in telemetry:
// the app cannot tell "I had photos to sort" from "a colleague asked me". The
// free text is the deliverable; the tap is the on-ramp to it, and it is banked
// first so that skipping the follow-up costs the note and never the choice.
//
// WHAT KEEPS IT FROM BEING A NAG:
//   • never on a first session — it fires only on a return
//   • it counts as asked only once it has actually been on a live screen, so a
//     banner that rendered into a closing tab does not burn the one chance
//   • once per account: locally at delivery, and on the server by a partial
//     unique index the RPC upserts against
//   • routed through the shared upsell slot, so it can never stack on the cap
//     wall, the share ask or the mix prompt
//   • it waits for a quiet moment rather than materialising under a moving
//     pointer or over a focused editor
//   • one tap answers it; the follow-up is optional and closes itself

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventNow, currentSessionShape, getFirstSource } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { claimUpsellSlot } from '../lib/upsellSlot.js';
import { anyModalOpen } from '../lib/modalGuard.js';
import { isEditablePointerTarget } from '../lib/isEditableTarget.js';
import { isReturnQaMode } from '../lib/localMode.js';

// VISIBLE time, not wall time. The old 45s was a plain setTimeout, so it ran
// while the tab was backgrounded — opening the app and walking away spent the
// account's one lifetime exposure on an empty room. It also fired later than a
// typical return session lasts, which is why so many shows were the last thing
// that ever happened in their session.
const VISIBLE_MS = 20_000;
const TICK_MS = 500;

// Once the clock is up, wait for a quiet moment rather than interrupting one.
const SETTLE_MS = 1_500;      // how long things must stay quiet
const SETTLE_GRACE_MS = 8_000; // then show anyway…
const SETTLE_GIVE_UP_MS = 90_000; // …unless something is genuinely still in flight

// If another ambient surface owns the slot, wait and try again rather than
// dropping the question. UPSELL_STACK_WINDOW_MS is 60s, so this clears one
// occupant.
const RETRY_MS = 70_000;
const RETRIES = 2;

// It counts as asked only after it has been on a live screen this long.
const DELIVERED_MS = 8_000;

// The follow-up closes itself if it is never touched, so "one tap and you're
// done" stays literally true for someone who taps and looks away.
const NOTE_IDLE_MS = 12_000;
const RECEIPT_MS = 1_600;

const ASKED_KEY = 'soleil.returnreason.v2';
const LEGACY_KEY = 'soleil.returnreason.v1';
const PENDING_KEY = 'soleil.returnreason.pending.v1';

const MAX_TRIES = 3;
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// SQLSTATEs that will fail identically forever. Retrying a check violation is
// how a week of answers died quietly the first time; the only thing worth
// retrying is a failure with no code at all, which is transport-shaped.
const TERMINAL = new Set(['23514', '22023', '42501', '42883', '23505']);

// One axis: what you are here to do. Five distinct opening verbs — Picking,
// Adding, Starting, Looking, Showing — so the column scans rather than reads.
// The ids are the server's closed list; boards/src/lib/feedbackContract.test.mjs
// asserts these against the migration, because the list now lives in three
// places and only two of them were ever checked against each other.
//
// Fixed order, never rotated, and published on the privacy page: at the volume
// this collects, randomising only adds variance and destroys the ability to
// compare one month with the next. A known position bias beats an unknown one.
const CHOICES = [
  { id: 'resuming',  label: 'Picking up where I left off',           probe: 'What are you picking up?' },
  { id: 'adding',    label: "Adding material I've collected since",  probe: 'Where did you find it?' },
  { id: 'starting',  label: 'Starting something new',                probe: 'What are you starting?' },
  { id: 'reviewing', label: "Looking back through what I've got",    probe: 'What are you looking for?' },
  { id: 'sharing',   label: 'Showing it to someone, or working together', probe: "Who's it for?" },
];

// Recorded as a real answer rather than as a refusal. A costless truthful null
// is worth more than a dismissal: it turns "ignored" into a denominator, and it
// removes the pressure to claim a job you did not come here to do. It is NOT a
// sixth row — as a peer it becomes the cheapest thing on screen to press.
const NOTHING = 'nothing';

function readKey(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function writeKey(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }
function dropKey(k) { try { localStorage.removeItem(k); } catch (_) {} }

function alreadyHandled() { return !!readKey(ASKED_KEY); }

// The question changed shape, so the key advances and everyone gets asked once
// in its new form — except anyone who already said no thanks to the old one.
// Carrying that refusal forward is the whole point of doing this considerately.
function migrateLegacyKey() {
  if (readKey(ASKED_KEY)) return;
  if (readKey(LEGACY_KEY) === 'dismissed') writeKey(ASKED_KEY, 'dismissed');
}

// ── The pending answer ──────────────────────────────────────────────────────
// A SEPARATE key from the asked-state, because they answer different questions.
// ASKED_KEY governs whether we ask again; this governs whether the write is
// still owed. Conflating them into one marker is how the first version managed
// to both lose the answer and keep the account retired.
//
// The attempt count lives here rather than in a ref: a ref resets on every page
// load, so "three attempts" would have been unbounded.
function readPending() {
  try {
    const raw = readKey(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.choice) return null;
    if (!Number.isFinite(p.at) || Date.now() - p.at > PENDING_TTL_MS) { dropKey(PENDING_KEY); return null; }
    return p;
  } catch (_) { dropKey(PENDING_KEY); return null; }
}

function writePending(p) { try { writeKey(PENDING_KEY, JSON.stringify(p)); } catch (_) {} }

/**
 * The one call that matters.
 *
 * `error` is DESTRUCTURED and read. supabase-js resolves with {data, error}
 * and does not throw, so a try/catch here proves nothing — the first version
 * had one, and it is the reason total destruction of every answer looked
 * exactly like success for as long as it did.
 *
 * `data === false` is SUCCESS, not failure: the server returns false when this
 * account already has an answer on record. There is nothing left to deliver.
 */
async function deliver(choice, note) {
  try {
    const { data, error } = await supabase.rpc('submit_return_reason', {
      p_choice: choice,
      p_note: note || null,
    });
    if (!error) return { ok: true, stored: data === true };
    const code = error.code || null;
    logEvent(EV.RETURN_REASON_WRITE_FAILED, { code, terminal: !code || TERMINAL.has(code), stage: note ? 'note' : 'choice' });
    return { ok: false, terminal: !!code && TERMINAL.has(code) };
  } catch (e) {
    // A genuine throw is a transport failure — offline, aborted, DNS. Worth
    // one more go on a later page load.
    logEvent(EV.RETURN_REASON_WRITE_FAILED, { code: null, terminal: false, stage: note ? 'note' : 'choice' });
    return { ok: false, terminal: false };
  }
}

// Retry anything still owed, once per page load. A terminal code or a spent
// attempt budget drops the record rather than looping on it forever.
//
// Module scope, not a ref: React StrictMode double-invokes effects in dev, and
// a per-mount guard would spend two of the three attempts on one page load.
let flushed = false;

async function flushPending() {
  if (flushed) return;
  flushed = true;
  const p = readPending();
  if (!p) return;
  if ((Number(p.tries) || 0) >= MAX_TRIES) { dropKey(PENDING_KEY); return; }
  writePending({ ...p, tries: (Number(p.tries) || 0) + 1 });
  const res = await deliver(p.choice, p.note);
  if (res.ok || res.terminal) dropKey(PENDING_KEY);
}

// A share or invite landing already records why that person is here, in full,
// in the session's own provenance. Spending an account's single lifetime ask on
// the one population whose answer we already hold is the worst trade available.
function arrivedViaSomeoneElse() {
  try {
    const { pathname, search } = window.location;
    if (pathname.startsWith('/share/')) return true;
    if (new URLSearchParams(search).has('join')) return true;
    // The path they actually landed on this session, not the one they have
    // since navigated to — getFirstSource caches it at entry for exactly this.
    const landed = String(getFirstSource()?.landing_path || '');
    return landed.startsWith('/share/');
  } catch (_) { return false; }
}

export function ReturnReasonAsk() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);   // choice id once tapped
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(false);
  const [busy, setBusy] = useState(false);

  const daysRef = useRef(null);
  const timerRef = useRef(null);      // the arming timer / visible-time ticker
  const settleRef = useRef(null);
  const deliveredRef = useRef(null);
  const idleRef = useRef(null);
  const rootRef = useRef(null);
  const pointerDownRef = useRef(false);
  const touchedRef = useRef(false);   // the follow-up has been typed in

  // Real pointer state, not a mousemove heuristic. Capture phase and passive so
  // nothing on the canvas can stop us seeing it, and so we never delay a frame.
  useEffect(() => {
    const down = () => { pointerDownRef.current = true; };
    const up = () => { pointerDownRef.current = false; };
    window.addEventListener('pointerdown', down, { capture: true, passive: true });
    window.addEventListener('pointerup', up, { capture: true, passive: true });
    window.addEventListener('pointercancel', up, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointerup', up, { capture: true });
      window.removeEventListener('pointercancel', up, { capture: true });
    };
  }, []);

  // Is this a moment we can take? A drag is read off the DOM class the canvas
  // actually applies for the duration of one, rather than inferred from
  // movement — a banner materialising under a moving pointer is worse than not
  // asking at all.
  const quiet = useCallback(() => {
    if (typeof document === 'undefined') return false;
    if (document.hidden) return false;
    if (pointerDownRef.current) return false;
    if (anyModalOpen()) return false;
    if (document.querySelector('.is-dragging')) return false;
    if (isEditablePointerTarget({ target: document.activeElement })) return false;
    return true;
  }, []);

  useEffect(() => {
    migrateLegacyKey();
    flushPending();

    if (alreadyHandled()) return undefined;
    if (arrivedViaSomeoneElse()) return undefined;

    let tries = 0;
    let visible = 0;
    let settled = 0;
    let waited = 0;

    const show = () => {
      if (alreadyHandled()) return;
      // Claimed late, at show time rather than at trigger time: whether another
      // surface owns the moment is only knowable when the moment arrives.
      //
      // Losing the claim must not lose the question, and — per upsellSlot's own
      // header — nothing may be STAMPED before this returns true. A deferral is
      // not a decline, and burning the one-shot on one would retire the surface
      // for that account forever.
      if (!claimUpsellSlot('return-reason')) {
        tries += 1;
        if (tries <= RETRIES) {
          timerRef.current = setTimeout(show, RETRY_MS);
        } else {
          timerRef.current = null;
        }
        return;
      }
      timerRef.current = null;
      setOpen(true);
    };

    // Phase 2: the clock is up; wait for quiet, then take the moment.
    const settle = () => {
      settleRef.current = setTimeout(() => {
        waited += TICK_MS;
        settled = quiet() ? settled + TICK_MS : 0;
        if (settled >= SETTLE_MS || (waited >= SETTLE_GRACE_MS && quiet())) {
          settleRef.current = null;
          show();
          return;
        }
        // Something is genuinely still in flight. Stand down for the session
        // WITHOUT marking the question asked — it will come round again.
        if (waited >= SETTLE_GIVE_UP_MS) { settleRef.current = null; return; }
        settle();
      }, TICK_MS);
    };

    // Phase 1: accumulate visible time only.
    const tick = () => {
      timerRef.current = setTimeout(() => {
        if (alreadyHandled()) { timerRef.current = null; return; }
        if (!document.hidden) visible += TICK_MS;
        if (visible >= VISIBLE_MS) { timerRef.current = null; settle(); return; }
        tick();
      }, TICK_MS);
    };

    const onReturned = (e) => {
      if (alreadyHandled() || timerRef.current || settleRef.current) return;
      daysRef.current = Number(e?.detail?.days) || null;
      tick();
    };

    // Dev-only: skip the clock and the settle gate so the banner can actually
    // be looked at. The literal import.meta.env.DEV lets the bundler drop this
    // and the harness string from production. Everything after the tap runs for
    // real, which is the whole point — the previous version of this surface was
    // unviewable without a signed-in account on a second calendar day and a
    // forty-five second wait, and it shipped completely broken.
    if (import.meta.env.DEV && isReturnQaMode()) {
      daysRef.current = 1;
      timerRef.current = setTimeout(show, 300);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = null; };
    }

    window.addEventListener('soleil:returned', onReturned);
    return () => {
      window.removeEventListener('soleil:returned', onReturned);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (settleRef.current) clearTimeout(settleRef.current);
      // Nulled, not merely cleared. The arming guard above reads this ref, so
      // leaving a stale handle in it silently swallows every later return
      // signal — harmless while the ask is one-shot, a landmine the moment it
      // is not.
      timerRef.current = null;
      settleRef.current = null;
    };
  }, [quiet]);

  // DELIVERY. The question counts as asked only once it has been on a live
  // screen for a few seconds — and the marker and the event are written in the
  // same block, so localStorage and the telemetry denominator can never
  // disagree about what was actually shown to a person.
  //
  // Marking at render instead would have spent the account's one chance on
  // every banner that painted into a tab already on its way out.
  useEffect(() => {
    if (!open) return undefined;
    let onScreen = 0;
    deliveredRef.current = setInterval(() => {
      if (document.hidden) return;
      onScreen += TICK_MS;
      if (onScreen < DELIVERED_MS) return;
      clearInterval(deliveredRef.current);
      deliveredRef.current = null;
      if (!alreadyHandled()) {
        writeKey(ASKED_KEY, 'shown');
        try { logEvent(EV.RETURN_REASON_SHOWN, { days_since_last_seen: daysRef.current }); } catch (_) {}
      }
    }, TICK_MS);
    return () => { if (deliveredRef.current) clearInterval(deliveredRef.current); deliveredRef.current = null; };
  }, [open]);

  // The follow-up closes itself if it is never touched. Cancelled permanently
  // on the first keystroke — someone mid-sentence must never be interrupted.
  useEffect(() => {
    if (!picked || picked === NOTHING || receipt) return undefined;
    idleRef.current = setTimeout(() => { if (!touchedRef.current) setOpen(false); }, NOTE_IDLE_MS);
    return () => { if (idleRef.current) clearTimeout(idleRef.current); idleRef.current = null; };
  }, [picked, receipt]);

  if (!open) return null;

  const current = CHOICES.find((c) => c.id === picked) || null;

  const bank = async (choice) => {
    if (busy) return;
    setBusy(true);
    // Written before the round trip, and that is deliberate now rather than
    // accidental. Two things make it safe that were not true before: by this
    // point the delivery marker has usually already retired the account anyway,
    // so this changes nothing about whether we ask again; and the pending record
    // written beside it means a transport failure still owes us the answer on
    // the next page load.
    //
    // A TERMINAL failure does lose the answer, and does leave this person
    // retired. That is the deliberate trade: a terminal code means the code is
    // broken for everybody, and un-retiring on it would turn one deploy-shaped
    // bug into every returning user being asked on every single return until it
    // was fixed. So it fails quietly for the user and LOUDLY for us —
    // RETURN_REASON_WRITE_FAILED exists for exactly this, and its absence is
    // the reason the last such bug went a week without anyone noticing.
    writeKey(ASKED_KEY, 'answered');
    writePending({ choice, note: null, tries: 1, at: Date.now() });
    try {
      logEventNow(EV.RETURN_REASON_ANSWERED, {
        choice,
        days_since_last_seen: daysRef.current,
        ...currentSessionShape(),
      });
    } catch (_) {}

    const res = await deliver(choice, null);
    if (res.ok || res.terminal) dropKey(PENDING_KEY);
    setBusy(false);

    if (choice === NOTHING) { setOpen(false); return; }
    setPicked(choice);
  };

  const send = async () => {
    const text = note.trim();
    if (!text || busy) return;
    setBusy(true);
    writePending({ choice: picked, note: text, tries: 1, at: Date.now() });
    // Length only, never the text. This repo has never put typed content on an
    // analytics event and one useful metric is not a reason to start; the note
    // goes to public.feedback and nowhere else.
    try { logEvent(EV.RETURN_REASON_NOTE, { choice: picked, len: text.length }); } catch (_) {}
    const res = await deliver(picked, text);
    if (res.ok || res.terminal) dropKey(PENDING_KEY);
    setBusy(false);
    setReceipt(true);
    setTimeout(() => setOpen(false), RECEIPT_MS);
  };

  const dismiss = () => {
    writeKey(ASKED_KEY, 'dismissed');
    try { logEvent(EV.RETURN_REASON_DISMISSED, { days_since_last_seen: daysRef.current }); } catch (_) {}
    setOpen(false);
  };

  // Only while focus is inside the banner. A window-level handler would eat
  // Escape from the canvas, where it clears a selection.
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  const onNoteKeyDown = (e) => {
    touchedRef.current = true;
    // Plain Enter inserts a newline — this is a textarea because people write
    // two sentences, and a form that eats the second one is not asking honestly.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  };

  if (receipt) {
    return (
      <div className="fv-banner surface-frosted rr-ask rr-receipt" role="status" aria-live="polite">
        <div className="fv-banner-copy"><div className="fv-banner-title">Read. Thank you.</div></div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="fv-banner surface-frosted rr-ask"
      role="dialog"
      aria-label="One question"
      onKeyDown={onKeyDown}
    >
      <div className="fv-banner-copy">
        <div className="fv-banner-title">{picked ? 'Thanks.' : 'What brings you back today?'}</div>
        <div className="fv-banner-body">
          {picked ? current?.probe : 'One tap. We only ask once, and a person here reads every answer.'}
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
            placeholder="A sentence is plenty."
            aria-label={current?.probe || 'Anything else'}
            // Focus is already inside the banner — the user just clicked here,
            // so taking it is expected. Only on a fine pointer: on touch an
            // autofocus throws the software keyboard over the canvas, which is
            // the exact hostility this surface exists to avoid.
            autoFocus={typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)')?.matches}
            onChange={(e) => { touchedRef.current = true; setNote(e.target.value); }}
            onKeyDown={onNoteKeyDown}
          />
        )}
      </div>

      <div className="fv-banner-actions">
        {picked ? (
          <>
            <button className="fv-banner-dismiss" onClick={() => setOpen(false)} disabled={busy}>Skip</button>
            <button className="rr-send" onClick={send} disabled={busy || !note.trim()}>Send</button>
          </>
        ) : (
          <>
            <button className="rr-nothing" onClick={() => bank(NOTHING)} disabled={busy}>Nothing in particular</button>
            <button className="fv-banner-dismiss" onClick={dismiss} disabled={busy}>Not now</button>
          </>
        )}
      </div>
    </div>
  );
}
