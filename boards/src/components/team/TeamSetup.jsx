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
import { storageQuota, joinUrl, TEAM_SEAT_MIN, TEAM_SEAT_PRICE, TEAM_TRIAL_DAYS } from '../../lib/teamModel.js';
import { writeTeamPreview, writeTeamPreviewName, requestTeamPageOnBoot, readTeamPreview } from '../../lib/teamPreview.js';
import { teamsAllowed } from '../../lib/appHost.js';
import { supabase } from '../../lib/supabase.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { previewTeamSeats } from '../../lib/teamsApi.js';
import { startTeamCheckout } from '../../lib/teamBillingApi.js';
import { refusalLine } from '../../lib/teamCopy.js';
import { loadOwnPersonalWorkspaces, seatFloor, checkoutPlan } from '../../lib/teamSetupData.js';
import { logEvent, logEventNow, logEventOnce } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { initialOf } from '../../lib/graphemes.js';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { namesList, dollarsText } from '../../lib/intlFormat.js';
import { dayLabel, money, sizeLabel } from '../../lib/teamModelWords.js';
import { Trans } from '@lingui/react/macro';

const SEAT_MAX = 100;
const STEPS = ['team', 'seats', 'people'];
const REAL_STEPS = ['team', 'seats'];
const clampSeats = (n) => Math.max(TEAM_SEAT_MIN, Math.min(SEAT_MAX, n));

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
      <button type="button" aria-label={tr`One fewer seat`} disabled={value <= min} onClick={() => onChange(Math.max(min, clampSeats(value - 1)))}>
        <Icon as={Minus} size={big ? 14 : 12} weight="regular" />
      </button>
      <b data-seats>{value}</b>
      <button type="button" aria-label={tr`One more seat`} disabled={value >= SEAT_MAX} onClick={() => onChange(clampSeats(value + 1))}>
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
  const chargeDay = dayLabel(today + 14 * 864e5);
  const daysFree = tr`${plural(TEAM_TRIAL_DAYS, { one: '# day free', other: '# days free' })}`;
  const leftOut = SAMPLE_SETUP_WORKSPACES.find((w) => !picked.includes(w.id));
  const typed = name.trim();
  const shown = typed || tr`Your team`;
  const domain = (String(user?.email || '').split('@')[1] || '').trim() || 'northlight.studio';
  const parsed = parseEmails(emails).valid;
  const k = parsed.length;
  const people = useMemo(() => sampleTeam('owner').people.slice(0, 6), []);
  const stepNo = steps.indexOf(step) + 1;

  useEffect(() => { panelRef.current?.focus?.(); }, [step]);

  useEffect(() => {
    if (real) logEventOnce('team_setup_open', EV.TEAM_SETUP_OPEN, { seats: url.seats, billing: url.billing });
  }, [real, url]);

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

  const wsNames = namesList(chosen.map((w) => w.name));
  const seatsFreeNow = seats - editors;
  const sentList = namesList(sentNames.length > 3 ? [...sentNames.slice(0, 3), tr`${ph({ n: sentNames.length - 3 })} more`] : sentNames);
  const stripLine = {
    team: () => (real
      ? tr`${plural(picked.length, { one: 'Team · # workspace moving in', other: 'Team · # workspaces moving in' })}`
      : tr`${plural(chosen.length, {
        one: `Team · # workspace moving in · ${plural(editors, { one: '# person who edit', other: '# people who edit' })}`,
        other: `Team · # workspaces moving in · ${plural(editors, { one: '# person who edit', other: '# people who edit' })}`,
      })}`),
    seats: () => (yearly ? tr`Team · ${plural(seats, { one: '# seat', other: '# seats' })} · billed yearly` : tr`Team · ${plural(seats, { one: '# seat', other: '# seats' })} · billed monthly`),
    people: () => tr`Team · ${plural(seats, { one: '# seat', other: '# seats' })} · ${plural(TEAM_TRIAL_DAYS, { one: '# day free', other: '# days free' })}`,
    done: () => (sent
      ? tr`${plural(sent, { one: `Team · ${seats} seats · # invite out`, other: `Team · ${seats} seats · # invites out` })}`
      : tr`Team · ${plural(seats, { one: '# seat', other: '# seats' })}`),
  }[step]();

  const pay = async () => {
    if (paying) return;
    setPaying(true);
    setPayLine('');
    const res = await startTeamCheckout({ name: typed, color: null, workspaceIds: picked, seats, plan: checkoutPlan(billing), endCreator: false });
    if (res && res.ok && res.url) {
      logEventNow(EV.TEAM_CHECKOUT_START, { seats, plan: checkoutPlan(billing), workspaces: picked.length });
      window.location.assign(res.url);
      return;
    }
    logEvent(EV.TEAM_CHECKOUT_FAILED, { error: res?.error || 'unknown' });
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
        <div className="su-strip" aria-label={tr`Your team, as you set it up`}>
          <span className="su-strip-av tm-mark" aria-hidden="true">{initialOf(shown, '')}</span>
          <span className="su-strip-text">
            <span className={`su-strip-name${typed ? '' : ' is-empty'}`}>{shown}</span>
            <span className="su-strip-line">{stripLine}</span>
          </span>
          {!real && (
          <span className="su-strip-faces" aria-hidden="true">
            {people.map((p) => <span key={p.id} className="su-face" style={{ background: p.color }}>{initialOf(p.name, '', { upper: false })}</span>)}
            {seats > people.length && <span className="su-face tm-more">+{seats - people.length}</span>}
          </span>
          )}
        </div>

        <main className="su-panel" ref={panelRef} tabIndex={-1} aria-labelledby="su-h">
          {(step === 'seats' || step === 'people') && (
            <button type="button" className="su-back" onClick={back}>
              <Icon as={ChevronLeft} size={14} weight="regular" /><Trans>Back</Trans>
            </button>
          )}
          {stepNo > 0 && (
            <div className="su-steps" aria-label={tr`Step ${stepNo} of ${ph({ count: steps.length })}`}>
              <span className="su-bars" aria-hidden="true">
                {steps.map((s, i) => <span key={s} className={`su-bar${i + 1 < stepNo ? ' is-done' : i + 1 === stepNo ? ' is-now' : ''}`} />)}
              </span>
              <span className="su-stepof"><Trans>Step {stepNo} of {ph({ count: steps.length })}</Trans></span>
            </div>
          )}

          {step === 'team' && (
            <div className="su-step">
              <h1 className="su-h" id="su-h"><Trans>Set up your team</Trans></h1>
              <p className="su-sub"><Trans>A team owns its workspaces and pays one bill. Everyone who can edit uses a seat; viewers are free.</Trans></p>
              <div className="su-field">
                <label className="su-label" htmlFor="tm-name"><Trans>Team name</Trans></label>
                <input id="tm-name" className="su-input" dir="auto" type="text" autoComplete="off" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="su-field">
                <div className="su-label tm-label"><Trans>Which workspaces move in?<em>{ph({ count: picked.length })} of {ph({ value: real ? (own || []).length : SAMPLE_SETUP_WORKSPACES.length })}</em></Trans></div>
                {real && own != null && own.length === 0 ? (
                  <p className="tm-hint"><Trans>You have no personal workspaces to move in. The team starts empty, and you can make team workspaces in it.</Trans></p>
                ) : (
                <div className="tm-wsl" role="group" aria-label={tr`Workspaces that move in`}>
                  {(real ? (own || []).map((w) => ({ id: w.id, name: w.name, color: pickPresenceColor(w.id), letter: initialOf(w.name), sub: tr`Personal workspace` }))
                    : SAMPLE_SETUP_WORKSPACES.map((w) => ({ ...w, sub: w.editors.length > 1 ? tr`${ph({ n: w.editors.length })} people who can edit` : tr`Just you` }))).map((w) => {
                    const on = picked.includes(w.id);
                    return (
                      <button key={w.id} type="button" className="tm-ws" role="checkbox" aria-checked={on} onClick={() => toggleWs(w.id)}>
                        <span className={`tm-chk${on ? ' is-on' : ''}`}><Icon as={Check} size={11} weight="regular" /></span>
                        <span className="tm-ws-av" style={{ background: w.color }}>{w.letter}</span>
                        <span className="tm-ws-t"><b>{w.name}</b><span>{w.sub}</span></span>
                        <span className="tm-ws-tail">{on ? tr`Moves in` : tr`Stays personal`}</span>
                      </button>
                    );
                  })}
                </div>
                )}
                <p className="tm-hint"><Trans>Every cluster, file and link stays where it is. Workspaces you leave out stay yours, and you can move one in later.</Trans></p>
              </div>
              {/* Creator isn't ended or credited here: the team launched
                  without it (the owner, 2026-10-27), so a Creator buyer keeps
                  Creator until they end it in Billing. */}
              {!real && leftOut && (
                <p className="tm-hint"><Trans>{ph({ name: leftOut.name })} stays personal: while you hold a seat it keeps unlimited cards and 50 GB.</Trans></p>
              )}
              {real && closedLine && <p className="su-error" role="alert">{closedLine}</p>}
              <div className="su-actions">
                <button type="button" className="su-btn su-primary" disabled={!typed || (real ? (own == null || !!closedLine) : picked.length === 0)} onClick={() => setStep('seats')}><Trans>Continue</Trans></button>
                <button type="button" className="su-btn su-quiet" onClick={cancel}><Trans>Cancel</Trans></button>
              </div>
            </div>
          )}

          {step === 'seats' && (
            <div className="su-step">
              <h1 className="su-h" id="su-h"><Trans>How many seats?</Trans></h1>
              <p className="su-sub"><Trans>A seat is anyone who can edit, guests from outside the team too.</Trans>{' '}{real
                ? (needed > TEAM_SEAT_MIN ? tr`${plural(needed, { one: '# person edits these workspaces today, so we started there.', other: '# people edit these workspaces today, so we started there.' })}` : tr`${plural(TEAM_SEAT_MIN, { one: 'Teams start at # seat.', other: 'Teams start at # seats.' })}`)
                : tr`${plural(editors, { one: '# person edits these workspaces today, so we started there.', other: '# people edit these workspaces today, so we started there.' })}`}</p>
              <div className="su-field tm-seatrow">
                <Stepper big value={seats} min={real ? needed : TEAM_SEAT_MIN} onChange={setSeatsSet} />
                <span className="tm-seatrow-t"><b>{tr`${plural(seats, { one: '# seat', other: '# seats' })}`}</b><span><Trans>At least {TEAM_SEAT_MIN}. Add more any time; seats nobody uses drop at renewal.</Trans></span></span>
              </div>
              <div className="su-field tm-opts" role="radiogroup" aria-label={tr`Billing`}>
                <button type="button" role="radio" aria-checked={yearly} className={`tm-opt${yearly ? ' is-on' : ''}`} onClick={() => setBilling('year')}>
                  <i /><span className="tm-opt-t"><b><Trans>Yearly · save 20%</Trans></b><span><Trans>{ph({ money: money(TEAM_SEAT_PRICE.year) })} a seat a year, {ph({ money2: money(TEAM_SEAT_PRICE.year / 12) })} a month</Trans></span></span>
                </button>
                <button type="button" role="radio" aria-checked={!yearly} className={`tm-opt${!yearly ? ' is-on' : ''}`} onClick={() => setBilling('month')}>
                  <i /><span className="tm-opt-t"><b><Trans>Monthly</Trans></b><span><Trans>{ph({ money: money(TEAM_SEAT_PRICE.month) })} a seat a month</Trans></span></span>
                </button>
              </div>
              <div className="tm-sum">
                <div className="tm-sum-r"><Trans>{seats} seats × {ph({ money: money(yearly ? TEAM_SEAT_PRICE.year : TEAM_SEAT_PRICE.month) })}</Trans><b>{yearly ? tr`${total} a year` : tr`${total} a month`}</b></div>
                <div className="tm-sum-r"><Trans>Storage, shared by the team</Trans><b>{sizeLabel(storageQuota(seats))}</b></div>
                <div className="tm-sum-r is-total"><Trans>Today<b>{ph({ zero: dollarsText('$0', 0) })} · {daysFree}</b></Trans></div>
              </div>
              <p className="tm-hint"><Trans>Your card is charged {total} on {chargeDay} unless you cancel before. Until then the team’s storage holds 100 GB.</Trans></p>
              <div className="su-actions tm-actions-pay">
                <button type="button" className="su-btn su-primary" disabled={real && paying} onClick={real ? pay : () => setStep('people')}>
                  {real && paying ? tr`Opening Stripe…` : <><Trans>Continue to payment</Trans><Icon as={ArrowRight} size={14} weight="regular" /></>}
                </button>
                <span className="tm-lock"><Icon as={Lock} size={12} weight="regular" /><Trans>Payment is through Stripe</Trans></span>
              </div>
              {real && payLine && <p className="su-error" role="alert">{payLine}</p>}
            </div>
          )}

          {step === 'people' && (
            <div className="su-step">
              <p className="tm-hint tm-preview"><Trans>Preview: this is where Stripe takes the card. Nothing was charged.</Trans></p>
              <h1 className="su-h" id="su-h"><Trans>Bring your people</Trans></h1>
              <p className="su-sub">{tr`${plural(editors, {
                one: `The # person who edit ${wsNames} are on the team already. Add anyone else, or skip this.`,
                other: `The # people who edit ${wsNames} are on the team already. Add anyone else, or skip this.`,
              })}`}</p>
              <div className="su-field">
                <div className="su-label tm-label"><label htmlFor="tm-emails"><Trans>Invite by email</Trans></label><em><Trans>Can view · free</Trans></em></div>
                <textarea id="tm-emails" className="tm-ta" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={tr`name@company.com, another@company.com`} />
                <p className="tm-hint">{k > 0
                  ? tr`${plural(k, { one: 'They join as viewers. Make them editors and it adds # seat.', other: 'They join as viewers. Make them editors and it adds # seats.' })}`
                  : tr`They join as viewers. Make them editors and it adds a seat each.`}</p>
              </div>
              <div className="su-field">
                <div className="su-label tm-label"><Trans>Team link<em>Joins as Can view</em></Trans></div>
                <div className="tm-lrow">
                  <span className="tm-copybox"><Icon as={LinkSimple} size={13} weight="regular" />{joinUrl('nl-7f3k2q')}</span>
                  <button type="button" className="tm-sbtn" onClick={copyLink}><Icon as={Copy} size={12} weight="regular" />{copied ? tr`Copied` : tr`Copy`}</button>
                </div>
              </div>
              <div className="tm-box">
                <Icon as={Globe} size={16} weight="regular" />
                <span className="tm-box-t">
                  <b><Trans>Anyone with an @{domain} email can join</Trans></b>
                  <span><Trans>Add one DNS record to prove the domain is yours.</Trans> <button type="button" className="tm-lnk" onClick={() => setShowDns((v) => !v)}><Trans>Show me how</Trans></button></span>
                  {showDns && <span><Trans>Preview: you’d add a TXT record, soleil-verification=…, and we’d check it.</Trans></span>}
                </span>
                <Switch on={domainOn} onChange={setDomainOn} label={tr`Join by company email`} />
              </div>
              <div className="su-actions">
                <button type="button" className="su-btn su-primary" onClick={send}>{k > 0 ? tr`${plural(k, { one: 'Send # invite', other: 'Send # invites' })}` : tr`Continue`}</button>
                <button type="button" className="su-btn su-quiet" onClick={() => { setSent(0); setSentNames([]); setStep('done'); }}><Trans>Skip for now</Trans></button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="su-step">
              <div className="tm-done-ic"><Icon as={CheckCircle} size={22} weight="regular" /></div>
              <h1 className="su-h" id="su-h"><Trans>{shown} is ready</Trans></h1>
              <p className="su-sub">{chosen.length === 1
                ? tr`${wsNames} is a team workspace now. Everyone in them kept what they had.`
                : tr`${wsNames} are team workspaces now. Everyone in them kept what they had.`}</p>
              <div className="tm-facts">
                <div className="tm-fact">
                  <Icon as={Clock} size={16} weight="regular" />
                  <span className="tm-fact-t"><b>{daysFree}</b><span><Trans>Your card is charged {total} on {chargeDay}.</Trans></span></span>
                </div>
                <div className="tm-fact">
                  <Icon as={Users} size={16} weight="regular" />
                  <span className="tm-fact-t"><b>{seats <= editors ? tr`${plural(seats, { one: '# seat, all in use', other: '# seats, all in use' })}` : tr`${plural(seats, { one: `# seat, ${seatsFreeNow} free`, other: `# seats, ${seatsFreeNow} free` })}`}</b><span><Trans>When they run out, new people join as viewers and an admin approves a seat.</Trans></span></span>
                </div>
                {sent > 0 && (
                  <div className="tm-fact">
                    <Icon as={Envelope} size={16} weight="regular" />
                    <span className="tm-fact-t"><b>{tr`${plural(sent, { one: '# invite sent', other: '# invites sent' })}`}</b><span>{tr`${sentList} can view.`}</span></span>
                  </div>
                )}
              </div>
              <div className="su-actions">
                <button type="button" className="su-btn su-primary" onClick={openPage}><Trans>Open the team page</Trans></button>
                <button type="button" className="su-btn su-secondary" onClick={() => navigate('/')}>{chosen[0]?.name ? tr`Back to ${ph({ name: chosen[0].name })}` : tr`Back to the app`}</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
