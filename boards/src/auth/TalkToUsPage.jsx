// TalkToUsPage — /pricing/talk-to-us, where the Team card's "Talk to us" goes:
// single sign-on, invoices and purchase orders, or more seats than a team can
// buy itself. Direction C of the Team canvas (the owner's pick, 2026-10-27): a
// page of its own under the public top bar, the form on one card, and the
// card's Sent state in its place.
//
// Routed BEFORE AuthGate (main.jsx) for everyone: a request needs no account,
// and request_team_contact (0542) keeps the sender's id when there is a
// session. The checks, the request and the words after Send are
// lib/teamContact.js's; the server checks again, limits how many come in, and
// pages the owner through ops_alerts. Every request is on /admin › Talk to us.
// Events carry needs, counts and outcomes, never the name, email or company.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { Icon } from '../components/Icon.jsx';
import { Check, ChevronLeft, Plus } from '../lib/icons.js';
import {
  TEAM_CONTACT_LIMITS, TEAM_CONTACT_NEEDS, checkTeamContact, sendTeamContact, teamContactLine,
} from '../lib/teamContact.js';
import { TEAM_SEAT_MAX, TEAM_SEAT_MIN } from '../lib/teamModel.js';
import { TEAM_TALK_META } from '../lib/teamPricingCopy.js';
import { stashTeamStart, teamStartHref } from '../lib/teamStart.js';
import { clearCreatorIntent } from '../lib/creatorIntent.js';
import '../pages/seoLanding.css';
import './talkToUs.css';

const SURFACE = 'talk_page';
const EMPTY = { name: '', email: '', company: '', editors: '', needs: [], message: '' };
const L = TEAM_CONTACT_LIMITS;

// The seats a trial starts with after Send: the people they said would edit,
// inside what a team can buy itself, or the setup's own default if they left it.
function trialSeats(editors) {
  const n = Number(editors);
  if (String(editors).trim() === '' || !Number.isInteger(n) || n < 1) return null;
  return Math.min(TEAM_SEAT_MAX, Math.max(TEAM_SEAT_MIN, n));
}

export function TalkToUsPage() {
  const [form, setForm] = useState(EMPTY);
  const [invalid, setInvalid] = useState(null);   // { field, message } from checkTeamContact
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);     // sendTeamContact's answer
  const [signedIn, setSignedIn] = useState(false);
  const inputs = useRef({});
  const doneRef = useRef(null);

  useEffect(() => {
    const prev = document.title;
    // The Worker injects the same title at the edge (ROUTE_META).
    document.title = TEAM_TALK_META.title;
    logEventOnce('team_talk_view', EV.TEAM_TALK_VIEW, {});
    return () => { document.title = prev; };
  }, []);

  // A session fills in the work email while the box is empty, and sends Start
  // a Team trial straight to the setup instead of through sign-in.
  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => {
      const session = data?.session;
      if (!live || !session) return;
      setSignedIn(true);
      const email = session.user?.email;
      if (email) setForm((f) => (f.email ? f : { ...f, email }));
    }, () => {});
    return () => { live = false; };
  }, []);

  useEffect(() => { if (result?.ok) doneRef.current?.focus(); }, [result]);

  const edit = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    if (invalid?.field === key) setInvalid(null);
  };
  const toggleNeed = (key) => setForm((f) => ({
    ...f, needs: f.needs.includes(key) ? f.needs.filter((k) => k !== key) : [...f.needs, key],
  }));

  const send = async (e) => {
    e.preventDefault();
    if (sending) return;
    const checked = checkTeamContact(form);
    if (!checked.ok) {
      setInvalid({ field: checked.field, message: checked.message });
      inputs.current[checked.field]?.focus();
      return;
    }
    setInvalid(null);
    setResult(null);
    setSending(true);
    const answer = await sendTeamContact(supabase, checked.request);
    setSending(false);
    setResult(answer);
    if (answer.ok) {
      // Kept either way: 'already' is the same address again within a day.
      logEvent(EV.TEAM_TALK_SENT, {
        already: answer.status === 'already', needs: checked.request.p_needs,
        editors: checked.request.p_editors, signed_in: signedIn,
      });
    } else {
      logEvent(EV.TEAM_TALK_FAILED, { error: answer.error });
    }
  };

  // The newest press wins, as on the pricing pages: a kept Creator intent goes.
  const startTrial = () => {
    const seats = trialSeats(form.editors);
    logEventNow(EV.PRICING_TEAM_START, { surface: SURFACE, plan: 'monthly', seats });
    if (signedIn) {
      window.location.assign(teamStartHref({ seats, billing: 'monthly' }));
      return;
    }
    clearCreatorIntent();
    stashTeamStart({ seats, billing: 'monthly' });
    window.location.assign('/');
  };

  const line = result ? teamContactLine(result, { name: form.name, email: form.email }) : null;

  const field = (key, label, props = {}) => {
    const bad = invalid?.field === key;
    return (
      <div className="tt-fld">
        <label className="tt-label" htmlFor={`tt-${key}`}>{label}</label>
        <input
          id={`tt-${key}`} ref={(el) => { inputs.current[key] = el; }} className="tt-in"
          value={form[key]} onChange={edit(key)}
          aria-invalid={bad || undefined} aria-describedby={bad ? `tt-${key}-err` : undefined}
          {...props}
        />
        {bad && <p className="tt-err" id={`tt-${key}-err`}>{invalid.message}</p>}
      </div>
    );
  };

  return (
    <div className="public-shell seo-shell public-dark pp-shell tt-shell">
      <div className="public-topbar">
        <a className="public-brand" href="/" title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-topbar-spacer" />
        <div className="public-topbar-actions">
          <a className="public-signin-quiet" href="/explore">Explore</a>
          <a className="public-signin-quiet" href="/docs">Docs</a>
        </div>
      </div>

      <div className="seo-scroll">
        <main className="tt-main">
          <a className="tt-back" href="/pricing">
            <Icon as={ChevronLeft} size={13} weight="regular" />
            Pricing
          </a>

          {result?.ok ? (
            <section className="tt-card tt-done" aria-labelledby="tt-done-h">
              <span className="tt-done-ic"><Icon as={Check} size={16} weight="regular" /></span>
              <h1 className="tt-h" id="tt-done-h" tabIndex={-1} ref={doneRef}>{line.title}</h1>
              <p className="tt-sub">{line.body}</p>
              <div className="tt-foot tt-foot-end">
                <a className="tt-btn" href="/pricing">Back to pricing</a>
                <button type="button" className="tt-btn tt-btn-ink" onClick={startTrial}>Start a Team trial</button>
              </div>
            </section>
          ) : (
            <form className="tt-card" onSubmit={send} noValidate aria-labelledby="tt-h">
              <div className="tt-head">
                <h1 className="tt-h" id="tt-h">Talk to us</h1>
                <p className="tt-sub">
                  Single sign-on, invoices and purchase orders, or more than {TEAM_SEAT_MAX} seats: tell us what your team needs, and we’ll write back.
                </p>
              </div>

              <div className="tt-fields">
                {field('name', 'Your name', { autoComplete: 'name', maxLength: L.name })}
                {field('email', 'Work email', { type: 'email', autoComplete: 'email', inputMode: 'email', maxLength: L.email })}
                {field('company', 'Company', { autoComplete: 'organization', maxLength: L.company })}
                {field('editors', 'People who would edit', { inputMode: 'numeric', autoComplete: 'off', maxLength: 7 })}

                <fieldset className="tt-fld tt-wide">
                  <legend className="tt-label">What do you need?</legend>
                  <div className="tt-chips">
                    {TEAM_CONTACT_NEEDS.map((n) => {
                      const on = form.needs.includes(n.key);
                      return (
                        <button key={n.key} type="button" className={`tt-chip${on ? ' is-on' : ''}`}
                                aria-pressed={on} onClick={() => toggleNeed(n.key)}>
                          <Icon as={on ? Check : Plus} size={12} weight="regular" />
                          {n.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="tt-fld tt-wide">
                  <label className="tt-label" htmlFor="tt-message">Anything else<small>optional</small></label>
                  <textarea
                    id="tt-message" ref={(el) => { inputs.current.message = el; }} className="tt-in"
                    rows={3} maxLength={L.message} value={form.message} onChange={edit('message')}
                    aria-invalid={invalid?.field === 'message' || undefined}
                    aria-describedby={invalid?.field === 'message' ? 'tt-message-err' : undefined}
                  />
                  {invalid?.field === 'message' && <p className="tt-err" id="tt-message-err">{invalid.message}</p>}
                </div>
              </div>

              {line && <p className="tt-error" role="alert"><b>{line.title}</b> {line.body}</p>}

              <div className="tt-foot">
                <span className="tt-note">We’ll write back to your work email.</span>
                <button type="submit" className="tt-btn tt-btn-ink" disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
