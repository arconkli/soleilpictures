// TeamSetup — /team/new, the buying walk's setup, in two modes. Preview host
// and dev only (TierRouter guards the route).
//
// Real (teamsAllowed() and no sample role): team name and which of the
// person's own personal workspaces move in → the seats those workspaces need,
// seats and yearly or monthly → Stripe Checkout (team-billing). The walk ends
// at "Continue to payment"; after paying Stripe returns to /team?checkout=…,
// which opens the new team's page on its Joining tab, where people are
// invited and domains added. lib/teamSetupData.js holds the pieces node tests.
//
// Sample (readTeamPreview() returns a role: the admin's preview, the owner's
// Buy mockup of 2026-10-21): the same two steps on sample data, then where
// Stripe would take the card → bring your people → done. Look only: nothing
// is charged, nobody is emailed, nothing is saved on the server. "Open the
// team page" hands over to the app through lib/teamPreview.js: the role, the
// typed name and "open the page on the next boot".
//
// It wears the workspace setup's frame (setup/setup.css and its Behind), and
// only the pieces that setup doesn't have live in teamSetup.css.
import '../setup/setup.css';
import './teamSetup.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Plus, Minus, Check, ArrowRight, Lock, ChevronLeft, LinkSimple, Copy, Globe, Clock, Users, Envelope, CheckCircle } from '../../lib/icons.js';
import { Behind } from '../setup/WorkspaceSetup.jsx';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { parseEmails } from '../../lib/inviteSubmit.js';
import { sampleTeam, SAMPLE_SETUP_WORKSPACES } from '../../lib/teamSample.js';
import { money, sizeLabel, storageQuota, joinUrl, TEAM_SEAT_MIN, TEAM_SEAT_PRICE } from '../../lib/teamModel.js';
import { writeTeamPreview, writeTeamPreviewName, requestTeamPageOnBoot, readTeamPreview } from '../../lib/teamPreview.js';
import { teamsAllowed } from '../../lib/appHost.js';
import { supabase } from '../../lib/supabase.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { previewTeamSeats } from '../../lib/teamsApi.js';
import { startTeamCheckout } from '../../lib/teamBillingApi.js';
import { refusalLine } from '../../lib/teamCopy.js';
import { loadOwnPersonalWorkspaces, seatFloor, checkoutPlan } from '../../lib/teamSetupData.js';

const SEAT_MAX = 100;
const STEPS = ['team', 'seats', 'people'];
const REAL_STEPS = ['team', 'seats'];
const clampSeats = (n) => Math.max(TEAM_SEAT_MIN, Math.min(SEAT_MAX, n));
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

function readUrl() {
  try {
    const q = new URLSearchParams(window.location.search);
    const s = parseInt(q.get('seats') || '', 10);
    return {
      seats: Number.isFinite(s) && s >= TEAM_SEAT_MIN && s <= SEAT_MAX ? s : null,
      billing: q.get('billing') === 'monthly' ? 'month' : 'year',
    };
  } catch (_) { return { seats: null, billing: 'year' }; }
}

// "lena@northlight.studio" → "Lena"; an address that isn't a name stays whole.
function nameOf(email) {
  const local = String(email).split('@')[0];
  return /^[a-z]{2,}$/i.test(local) ? local.charAt(0).toUpperCase() + local.slice(1).toLowerCase() : email;
}

function Switch({ on, onChange, label }) {
  return <button type="button" className={`tm-sw${on ? ' is-on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function Stepper({ value, onChange, big = false, min = TEAM_SEAT_MIN }) {
  return (
    <span className={`tm-step${big ? ' is-big' : ''}`}>
      <button type="button" aria-label="One fewer seat" disabled={value <= min} onClick={() => onChange(Math.max(min, clampSeats(value - 1)))}>
        <Icon as={Minus} size={big ? 14 : 12} weight="regular" />
      </button>
      <b data-seats>{value}</b>
      <button type="button" aria-label="One more seat" disabled={value >= SEAT_MAX} onClick={() => onChange(clampSeats(value + 1))}>
        <Icon as={Plus} size={big ? 14 : 12} weight="regular" />
      </button>
    </span>
  );
}

export default function TeamSetup({ user, navigate = (url) => window.location.assign(url) }) {
  const { isPhone } = useBreakpoint();
  const url = useMemo(readUrl, []);
  const [today] = useState(() => Date.now());
  const [step, setStep] = useState('team');
  const [real] = useState(() => teamsAllowed() && !readTeamPreview());
  const steps = real ? REAL_STEPS : STEPS;
  const [name, setName] = useState(real ? '' : 'Northlight Films');
  const [picked, setPicked] = useState(() => (real ? [] : SAMPLE_SETUP_WORKSPACES.slice(0, 3).map((w) => w.id)));
  // Real mode: the person's own personal workspaces (null while loading), and
  // what the server says a team of the picked ones needs.
  const [own, setOwn] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [closedLine, setClosedLine] = useState('');
  const [paying, setPaying] = useState(false);
  const [payLine, setPayLine] = useState('');
  const [reask, setReask] = useState(0);
  // null follows the picked workspaces' editors; a number is what the URL or the stepper set.
  const [seatsSet, setSeatsSet] = useState(url.seats);
  const [billing, setBilling] = useState(url.billing);
  const [emails, setEmails] = useState('');
  const [domainOn, setDomainOn] = useState(false);
  const [showDns, setShowDns] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(0);
  const [sentNames, setSentNames] = useState([]);
  const panelRef = useRef(null);

  const chosen = SAMPLE_SETUP_WORKSPACES.filter((w) => picked.includes(w.id));
  const editors = new Set(chosen.flatMap((w) => w.editors)).size;
  const needed = real ? seatFloor(answer) : TEAM_SEAT_MIN;
  const seats = real ? Math.max(needed, clampSeats(seatsSet ?? needed)) : clampSeats(seatsSet ?? editors);
  const yearly = billing === 'year';
  const total = money((yearly ? TEAM_SEAT_PRICE.year : TEAM_SEAT_PRICE.month) * seats);
  const chargeDay = new Date(today + 14 * 864e5).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const leftOut = SAMPLE_SETUP_WORKSPACES.find((w) => !picked.includes(w.id));
  const typed = name.trim();
  const shown = typed || 'Your team';
  const domain = (String(user?.email || '').split('@')[1] || '').trim() || 'northlight.studio';
  const parsed = parseEmails(emails).valid;
  const k = parsed.length;
  const people = useMemo(() => sampleTeam('owner').people.slice(0, 6), []);
  const stepNo = steps.indexOf(step) + 1;

  useEffect(() => { panelRef.current?.focus?.(); }, [step]);

  useEffect(() => {
    if (!real) return undefined;
    let live = true;
    loadOwnPersonalWorkspaces(supabase, user?.id).then((rows) => {
      if (!live) return;
      setOwn(rows);
      setPicked(rows.map((w) => w.id));
    });
    return () => { live = false; };
  }, [real, user?.id]);

  // Ask what the picked workspaces need, once the picking settles. A stale
  // answer is dropped; any failure leaves 3 and lets checkout decide.
  useEffect(() => {
    if (!real || own == null) return undefined;
    let live = true;
    setClosedLine('');
    const t = setTimeout(async () => {
      let n = null;
      try { n = await previewTeamSeats({ p_workspace_ids: picked }); } catch (e) {
        if (live && (e?.hint === 'teams_closed' || e?.hint === 'team_exists')) setClosedLine(refusalLine({ code: e.hint }));
      }
      if (live) setAnswer(n);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [real, own, picked, reask]);

  const toggleWs = (id) => {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    if (url.seats == null) setSeatsSet(null);
    setPayLine('');
  };

  const stripLine = {
    team: real ? `Team · ${picked.length} ${plural(picked.length, 'workspace')} moving in` : `Team · ${chosen.length} ${plural(chosen.length, 'workspace')} moving in · ${editors} ${plural(editors, 'person', 'people')} who edit`,
    seats: `Team · ${seats} seats · billed ${yearly ? 'yearly' : 'monthly'}`,
    people: `Team · ${seats} seats · 14 days free`,
    done: `Team · ${seats} seats${sent ? ` · ${sent} ${plural(sent, 'invite')} out` : ''}`,
  }[step];

  const pay = async () => {
    if (paying) return;
    setPaying(true);
    setPayLine('');
    const res = await startTeamCheckout({ name: typed, color: null, workspaceIds: picked, seats, plan: checkoutPlan(billing), endCreator: false });
    if (res && res.ok && res.url) {
      window.location.assign(res.url);
      return;
    }
    setPayLine(refusalLine({ code: res?.error, needed: Number(res?.detail) || undefined }));
    if (res?.error === 'team_seats_needed') setReask((n) => n + 1);
    setPaying(false);
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`https://${joinUrl('nl-7f3k2q')}`); } catch (_) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const send = () => {
    setSent(k);
    setSentNames(parsed.map(nameOf));
    setStep('done');
  };

  const openPage = () => {
    writeTeamPreview('owner');
    writeTeamPreviewName(name);
    requestTeamPageOnBoot();
    navigate('/');
  };

  const back = () => setStep(step === 'people' ? 'seats' : 'team');
  const cancel = () => navigate(real ? '/' : '/pricing');

  return (
    <div className={`su tm ${isPhone ? 'is-phone' : 'is-desk'} at-${step}`}>
      <Behind name={shown} />
      <div className="su-shell">
        <div className="su-strip" aria-label="Your team, as you set it up">
          <span className="su-strip-av tm-mark" aria-hidden="true">{shown.charAt(0).toUpperCase()}</span>
          <span className="su-strip-text">
            <span className={`su-strip-name${typed ? '' : ' is-empty'}`}>{shown}</span>
            <span className="su-strip-line">{stripLine}</span>
          </span>
          {!real && (
          <span className="su-strip-faces" aria-hidden="true">
            {people.map((p) => <span key={p.id} className="su-face" style={{ background: p.color }}>{p.name.charAt(0)}</span>)}
            {seats > people.length && <span className="su-face tm-more">+{seats - people.length}</span>}
          </span>
          )}
        </div>

        <main className="su-panel" ref={panelRef} tabIndex={-1} aria-labelledby="su-h">
          {(step === 'seats' || step === 'people') && (
            <button type="button" className="su-back" onClick={back}>
              <Icon as={ChevronLeft} size={14} weight="regular" />Back
            </button>
          )}
          {stepNo > 0 && (
            <div className="su-steps" aria-label={`Step ${stepNo} of ${steps.length}`}>
              <span className="su-bars" aria-hidden="true">
                {steps.map((s, i) => <span key={s} className={`su-bar${i + 1 < stepNo ? ' is-done' : i + 1 === stepNo ? ' is-now' : ''}`} />)}
              </span>
              <span className="su-stepof">Step {stepNo} of {steps.length}</span>
            </div>
          )}

          {step === 'team' && (
            <div className="su-step">
              <h1 className="su-h" id="su-h">Set up your team</h1>
              <p className="su-sub">A team owns its workspaces and pays one bill. Everyone who can edit uses a seat; viewers are free.</p>
              <div className="su-field">
                <label className="su-label" htmlFor="tm-name">Team name</label>
                <input id="tm-name" className="su-input" type="text" autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="su-field">
                <div className="su-label tm-label">Which workspaces move in?<em>{picked.length} of {real ? (own || []).length : SAMPLE_SETUP_WORKSPACES.length}</em></div>
                {real && own != null && own.length === 0 ? (
                  <p className="tm-hint">You have no personal workspaces to move in. The team starts empty, and you can make team workspaces in it.</p>
                ) : (
                <div className="tm-wsl" role="group" aria-label="Workspaces that move in">
                  {(real ? (own || []).map((w) => ({ id: w.id, name: w.name, color: pickPresenceColor(w.id), letter: (w.name || '?').trim().charAt(0).toUpperCase() || '?', sub: 'Personal workspace' }))
                    : SAMPLE_SETUP_WORKSPACES.map((w) => ({ ...w, sub: w.editors.length > 1 ? `${w.editors.length} people who can edit` : 'Just you' }))).map((w) => {
                    const on = picked.includes(w.id);
                    return (
                      <button key={w.id} type="button" className="tm-ws" role="checkbox" aria-checked={on} onClick={() => toggleWs(w.id)}>
                        <span className={`tm-chk${on ? ' is-on' : ''}`}><Icon as={Check} size={11} weight="regular" /></span>
                        <span className="tm-ws-av" style={{ background: w.color }}>{w.letter}</span>
                        <span className="tm-ws-t"><b>{w.name}</b><span>{w.sub}</span></span>
                        <span className="tm-ws-tail">{on ? 'Moves in' : 'Stays personal'}</span>
                      </button>
                    );
                  })}
                </div>
                )}
                <p className="tm-hint">Every cluster, file and link stays where it is. Workspaces you leave out stay yours, and you can move one in later.</p>
              </div>
              {/* Creator isn't ended or credited here: the team launched
                  without it (the owner, 2026-10-27), so a Creator buyer keeps
                  Creator until they end it in Billing. */}
              {!real && leftOut && (
                <p className="tm-hint">{leftOut.name} stays personal: while you hold a seat it keeps unlimited cards and 50 GB.</p>
              )}
              {real && closedLine && <p className="su-error" role="alert">{closedLine}</p>}
              <div className="su-actions">
                <button type="button" className="su-btn su-primary" disabled={!typed || (real ? (own == null || !!closedLine) : picked.length === 0)} onClick={() => setStep('seats')}>Continue</button>
                <button type="button" className="su-btn su-quiet" onClick={cancel}>Cancel</button>
              </div>
            </div>
          )}

          {step === 'seats' && (
            <div className="su-step">
              <h1 className="su-h" id="su-h">How many seats?</h1>
              <p className="su-sub">A seat is anyone who can edit, guests from outside the team too. {real ? (needed > TEAM_SEAT_MIN ? `${needed} people edit these workspaces today, so we started there.` : `Teams start at ${TEAM_SEAT_MIN} seats.`) :`${editors} ${plural(editors, 'person', 'people')} edit these workspaces today, so we started there.`}</p>
              <div className="su-field tm-seatrow">
                <Stepper big value={seats} min={real ? needed : TEAM_SEAT_MIN} onChange={setSeatsSet} />
                <span className="tm-seatrow-t"><b>{seats} seats</b><span>At least {TEAM_SEAT_MIN}. Add more any time; seats nobody uses drop at renewal.</span></span>
              </div>
              <div className="su-field tm-opts" role="radiogroup" aria-label="Billing">
                <button type="button" role="radio" aria-checked={yearly} className={`tm-opt${yearly ? ' is-on' : ''}`} onClick={() => setBilling('year')}>
                  <i /><span className="tm-opt-t"><b>Yearly · save 20%</b><span>{money(TEAM_SEAT_PRICE.year)} a seat a year, {money(TEAM_SEAT_PRICE.year / 12)} a month</span></span>
                </button>
                <button type="button" role="radio" aria-checked={!yearly} className={`tm-opt${!yearly ? ' is-on' : ''}`} onClick={() => setBilling('month')}>
                  <i /><span className="tm-opt-t"><b>Monthly</b><span>{money(TEAM_SEAT_PRICE.month)} a seat a month</span></span>
                </button>
              </div>
              <div className="tm-sum">
                <div className="tm-sum-r">{seats} seats × {money(yearly ? TEAM_SEAT_PRICE.year : TEAM_SEAT_PRICE.month)}<b>{total} a {yearly ? 'year' : 'month'}</b></div>
                <div className="tm-sum-r">Storage, shared by the team<b>{sizeLabel(storageQuota(seats))}</b></div>
                <div className="tm-sum-r is-total">Today<b>$0 · 14 days free</b></div>
              </div>
              <p className="tm-hint">Your card is charged {total} on {chargeDay} unless you cancel before. Until then the team’s storage holds 100 GB.</p>
              <div className="su-actions tm-actions-pay">
                <button type="button" className="su-btn su-primary" disabled={real && paying} onClick={real ? pay : () => setStep('people')}>
                  {real && paying ? 'Opening Stripe…' : <>Continue to payment<Icon as={ArrowRight} size={14} weight="regular" /></>}
                </button>
                <span className="tm-lock"><Icon as={Lock} size={12} weight="regular" />Payment is through Stripe</span>
              </div>
              {real && payLine && <p className="su-error" role="alert">{payLine}</p>}
            </div>
          )}

          {step === 'people' && (
            <div className="su-step">
              <p className="tm-hint tm-preview">Preview: this is where Stripe takes the card. Nothing was charged.</p>
              <h1 className="su-h" id="su-h">Bring your people</h1>
              <p className="su-sub">The {editors} {plural(editors, 'person', 'people')} who edit {list(chosen.map((w) => w.name))} are on the team already. Add anyone else, or skip this.</p>
              <div className="su-field">
                <div className="su-label tm-label"><label htmlFor="tm-emails">Invite by email</label><em>Can view · free</em></div>
                <textarea id="tm-emails" className="tm-ta" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@company.com, another@company.com" />
                <p className="tm-hint">They join as viewers. Make them editors and it adds {k > 0 ? `${k} ${plural(k, 'seat')}` : 'a seat each'}.</p>
              </div>
              <div className="su-field">
                <div className="su-label tm-label">Team link<em>Joins as Can view</em></div>
                <div className="tm-lrow">
                  <span className="tm-copybox"><Icon as={LinkSimple} size={13} weight="regular" />{joinUrl('nl-7f3k2q')}</span>
                  <button type="button" className="tm-sbtn" onClick={copyLink}><Icon as={Copy} size={12} weight="regular" />{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </div>
              <div className="tm-box">
                <Icon as={Globe} size={16} weight="regular" />
                <span className="tm-box-t">
                  <b>Anyone with an @{domain} email can join</b>
                  <span>Add one DNS record to prove the domain is yours. <button type="button" className="tm-lnk" onClick={() => setShowDns((v) => !v)}>Show me how</button></span>
                  {showDns && <span>Preview: you’d add a TXT record, soleil-verification=…, and we’d check it.</span>}
                </span>
                <Switch on={domainOn} onChange={setDomainOn} label="Join by company email" />
              </div>
              <div className="su-actions">
                <button type="button" className="su-btn su-primary" onClick={send}>{k > 0 ? `Send ${k} ${plural(k, 'invite')}` : 'Continue'}</button>
                <button type="button" className="su-btn su-quiet" onClick={() => { setSent(0); setSentNames([]); setStep('done'); }}>Skip for now</button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="su-step">
              <div className="tm-done-ic"><Icon as={CheckCircle} size={22} weight="regular" /></div>
              <h1 className="su-h" id="su-h">{shown} is ready</h1>
              <p className="su-sub">{list(chosen.map((w) => w.name))} {chosen.length === 1 ? 'is a team workspace' : 'are team workspaces'} now. Everyone in them kept what they had.</p>
              <div className="tm-facts">
                <div className="tm-fact">
                  <Icon as={Clock} size={16} weight="regular" />
                  <span className="tm-fact-t"><b>14 days free</b><span>Your card is charged {total} on {chargeDay}.</span></span>
                </div>
                <div className="tm-fact">
                  <Icon as={Users} size={16} weight="regular" />
                  <span className="tm-fact-t"><b>{seats} seats, {seats <= editors ? 'all in use' : `${seats - editors} free`}</b><span>When they run out, new people join as viewers and an admin approves a seat.</span></span>
                </div>
                {sent > 0 && (
                  <div className="tm-fact">
                    <Icon as={Envelope} size={16} weight="regular" />
                    <span className="tm-fact-t"><b>{sent} {plural(sent, 'invite')} sent</b><span>{list(sentNames.length > 3 ? [...sentNames.slice(0, 3), `${sentNames.length - 3} more`] : sentNames)} can view.</span></span>
                  </div>
                )}
              </div>
              <div className="su-actions">
                <button type="button" className="su-btn su-primary" onClick={openPage}>Open the team page</button>
                <button type="button" className="su-btn su-secondary" onClick={() => navigate('/')}>Back to {chosen[0]?.name || 'the app'}</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
