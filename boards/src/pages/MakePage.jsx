// MakePage — /make: a board an AI wrote into a link, shown before it is kept.
//
// An AI without the Clusters app writes the board into the link's fragment
// (lib/makeLink.js), or as text to paste here. The page reads it, loads its
// pictures from their own sites to learn their shapes, lays the board out as
// the API would (lib/makeBoard.js) and shows it through the real canvas, read
// only, as a draft's keep page does. The island over it keeps it: an email and
// the code we send, or one button for someone signed in, and the Worker makes
// the same board for real (worker-make.js), its pictures copied in. The
// owner's pick of 2026-10-28: the keep page's island A, the board shown at
// once; and the app first wherever an AI has one.
//
// Nothing reaches us until it is kept: the fragment never leaves the browser
// (nor any Referer: a fragment never rides in one), events carry counts, and
// error reports carry the path alone. A picture is measured as the canvas
// loads it, so a site that refuses us is a picture left out here and on the
// kept board alike. Nothing an AI wrote is ever a link here (makeLink drops
// the addresses from a note's links).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { ArrowRight, CheckCircle, ClipboardText, Eye, LinkBreak } from '@phosphor-icons/react';
import { cardToYMap, readCards, readGroups, upsertGroup } from '../lib/yhelpers.js';
import { CanvasSurface } from '../components/CanvasSurface.jsx';
import { SoleilMark } from '../components/primitives.jsx';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { EntityNavigateContext } from '../hooks/useEntityNavigate.js';
import { OpenDmContext } from '../hooks/useOpenDm.js';
import { supabase } from '../lib/supabase.js';
import { signupLocale } from '../lib/uiLocale.js';
import { getFirstSource, logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { placedOf } from '../lib/placement.js';
import { boundsOfCards } from '../lib/canvasGeom.js';
import { fitMargin } from '../lib/captureCamera.js';
import { emailProblem } from '../lib/emailTypo.js';
import { resendWait } from '../lib/pendingCode.js';
import { captchaEnabled, captchaToken } from '../auth/turnstile.js';
import { freeStorageLabel } from '../lib/billingCopyWords.js';
import { DEMO_CARD_LIMIT } from '../lib/demoCardCap.js';
import { signInWords, signupFirstSource, keepFailReason } from '../lib/keepDraft.js';
import { parseMakeFragment, parseMakeText, MAKE_PATH } from '../lib/makeLink.js';
import { composeMakeBoard } from '../lib/makeBoard.js';
import './keepPage.css';
import { initialOf } from '../lib/graphemes.js';
import './makePage.css';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const EMPTY = [];
const EMPTY_OBJ = {};
const NOOP = () => {};
const MAKE_TWEAK = { showArrows: true };
const TOPBAR_H = 48;
const ISLAND_ROOM = 172;
// How long a picture has to load before the board is shown without it.
const PICTURE_WAIT_MS = 12_000;
// Roles that may add a cluster to a workspace (worker-make.js).
const ADDS_CLUSTERS = new Set(['owner', 'co_owner', 'editor']);

// One picture's size as this browser draws it, loaded as the canvas's <img>
// loads it (no CORS, the page's Referer policy), so the canvas then draws it
// from what is already here: null when it doesn't load in time.
function measurePicture(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    const done = (v) => { clearTimeout(timer); img.onload = null; img.onerror = null; resolve(v); };
    const timer = setTimeout(() => { done(null); try { img.src = ''; } catch (_) {} }, PICTURE_WAIT_MS);
    img.onload = () => done(img.naturalWidth > 0 && img.naturalHeight > 0
      ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

// The board as the canvas reads one: a bare Y.Doc of its cards and sections.
function boardDoc(made) {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    const cards = ydoc.getMap('cards');
    for (const c of made.cards) cards.set(c.id, cardToYMap(c));
    const groups = ydoc.getMap('groups');
    for (const g of made.groups) upsertGroup(groups, g.id, g);
  });
  return { ydoc, cards: readCards(ydoc), groups: readGroups(ydoc) };
}

const readLink = () => {
  const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
  return hash ? { kind: 'link', text: hash } : null;
};

export function MakePage() {
  const [source, setSource] = useState(readLink);  // { kind: 'link'|'text', text } | null
  const [phase, setPhase] = useState(() => (readLink() ? 'loading' : 'paste')); // paste | loading | shown | empty
  const [parsed, setParsed] = useState(null);
  const [sizes, setSizes] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [kept, setKept] = useState(null);

  // Another link opened in this tab.
  useEffect(() => {
    const onHash = () => {
      const next = readLink();
      if (!next) return;
      setKept(null);
      setSource(next);
      setPhase('loading');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Read it, then learn every picture's shape.
  useEffect(() => {
    if (!source) return undefined;
    let alive = true;
    const board = source.kind === 'text' ? parseMakeText(source.text) : parseMakeFragment(source.text);
    setSizes(null);
    setParsed(board);
    if (!board.count) {
      setPhase('empty');
      logEvent(EV.MAKE_PAGE_VIEW, { from: source.kind, cards: 0, pictures: 0, left_out: 0, cut: !!board.cut });
      return undefined;
    }
    const pics = board.sections.flatMap((s) => s.items).filter((i) => i.kind === 'picture');
    setProgress({ done: 0, total: pics.length });
    Promise.all(pics.map((p) => measurePicture(p.url).then((d) => {
      if (alive) setProgress((x) => ({ ...x, done: x.done + 1 }));
      return d;
    }))).then((dims) => {
      if (!alive) return;
      setSizes(dims);
      setPhase('shown');
      logEvent(EV.MAKE_PAGE_VIEW, {
        from: source.kind,
        cards: board.count,
        pictures: pics.length,
        left_out: dims.filter((d) => !d).length + (board.problems.find((p) => p.code === 'bad_pictures')?.n || 0),
        cut: !!board.cut,
      });
    });
    return () => { alive = false; };
  }, [source]);

  useEffect(() => {
    if (phase === 'paste') logEvent(EV.MAKE_PAGE_VIEW, { from: 'none', cards: 0, pictures: 0, left_out: 0, cut: false });
  }, [phase]);

  const made = useMemo(() => (parsed && sizes ? composeMakeBoard(parsed, { pictures: sizes }) : null), [parsed, sizes]);
  // A board of its own for every link or text read here: the island starts
  // over with it.
  const islandKey = useMemo(() => `${source?.kind}:${Date.now()}`, [source]);
  useEffect(() => {
    const name = phase === 'shown' ? (made?.name || '').trim() : '';
    document.title = name ? tr`${ph({ name })} — Soleil Clusters` : tr`Make a cluster — Soleil Clusters`;
  }, [made, phase]);
  const shown = useMemo(() => (made ? boardDoc(made) : null), [made]);
  useEffect(() => () => { try { shown?.ydoc.destroy(); } catch (_) {} }, [shown]);
  const canvasCards = useMemo(() => placedOf(shown?.cards || EMPTY), [shown]);

  // On a desktop the first view fits the board into the canvas above the
  // island, as the keep page does; a phone keeps the canvas's own opening.
  const initialFrame = useMemo(() => {
    const w = window.innerWidth || 0;
    const h = (window.innerHeight || 0) - TOPBAR_H;
    if (w <= 640) return null;
    const m = fitMargin({ width: w });
    const free = h - ISLAND_ROOM - 2 * m;
    const b = boundsOfCards(canvasCards);
    if (!b || b.h <= 0 || free < 120) return null;
    return { x: b.x, y: b.y, w: b.w, h: b.h * ((h - 2 * m) / free) };
  }, [canvasCards]);

  // ── Who is here ──
  const [me, setMe] = useState(undefined);         // undefined: asking · null: signed out · { id, email }
  useEffect(() => {
    let alive = true;
    const read = (session) => {
      const u = session?.user;
      if (alive) setMe(u?.id ? { id: u.id, email: u.email || '' } : null);
    };
    try {
      supabase?.auth?.getSession().then(({ data }) => read(data?.session)).catch(() => read(null));
    } catch (_) { read(null); }
    const sub = supabase?.auth?.onAuthStateChange?.((_event, session) => read(session));
    return () => {
      alive = false;
      try { sub?.data?.subscription?.unsubscribe(); } catch (_) {}
    };
  }, []);

  const pasteInstead = useCallback(() => {
    try { window.history.replaceState(null, '', MAKE_PATH); } catch (_) {}
    setSource(null);
    setParsed(null);
    setSizes(null);
    setKept(null);
    setPhase('paste');
  }, []);

  const makeFromText = useCallback((text) => {
    setKept(null);
    setSizes(null);
    setSource({ kind: 'text', text });
    setPhase('loading');
  }, []);

  if (phase === 'paste') {
    return (
      <div className="public-shell public-dark keep-shell">
        <MakeTopbar />
        <MakePaste onMake={makeFromText} />
      </div>
    );
  }
  if (phase === 'loading') {
    return (
      <div className="public-shell public-dark keep-shell">
        <MakeTopbar />
        <div className="public-loading">
          <SoleilMark size={42} color="var(--soleil)" glow />
          <div>
            {progress.total
              ? tr`Opening the board · ${ph({ done: progress.done })} of ${plural(progress.total, { one: '# picture', other: '# pictures' })}`
              : tr`Opening the board…`}
          </div>
        </div>
      </div>
    );
  }
  if (phase === 'empty' || !made) {
    return (
      <div className="public-shell public-dark keep-shell">
        <MakeTopbar />
        <MakeEmpty cut={!!parsed?.cut} fromText={source?.kind === 'text'} onPaste={pasteInstead} />
      </div>
    );
  }

  return (
    <div className="public-shell public-dark keep-shell">
      <MakeTopbar>
        <span className="keep-name">{made.name}</span>
        <MakeTopbarEnd kept={!!kept} me={me} />
      </MakeTopbar>

      <EntityNavigateContext.Provider value={EMPTY_OBJ}>
        <OpenDmContext.Provider value={NOOP}>
          <div className="public-canvas-host keep-canvas">
            <CanvasSurface
              board={{ id: 'make', name: made.name }}
              boards={EMPTY_OBJ}
              cards={canvasCards}
              allCards={shown.cards}
              arrows={EMPTY}
              strokes={EMPTY}
              groups={shown.groups}
              ydoc={shown.ydoc}
              getAwareness={undefined}
              currentUser={undefined}
              mutators={EMPTY_OBJ}
              canEdit={false}
              isPublic
              onOpenBoard={NOOP}
              onOpenPicker={NOOP}
              tweak={MAKE_TWEAK}
              initialFrame={initialFrame}
              depth={0}
              selectedTool="pan"
              setSelectedTool={NOOP}
              defaults={null}
              workspaceId={null}
              userId={null}
            />
          </div>
        </OpenDmContext.Provider>
      </EntityNavigateContext.Provider>

      <MakeIsland key={islandKey} source={source} parsed={parsed} made={made} sizes={sizes} me={me}
                  kept={kept} onKept={setKept} onPaste={pasteInstead} />
    </div>
  );
}

// ── The bar along the top ────────────────────────────────────────────────────

function MakeTopbar({ children = null }) {
  return (
    <div className="public-topbar keep-topbar">
      <a className="public-brand" href="/" title={tr`Clusters home`}>
        <ClustersMark size={20} />
        <span className="public-brand-name"><Trans context="brand">Clusters</Trans></span>
      </a>
      {children ? <span className="keep-topbar-rule" aria-hidden="true" /> : null}
      {children}
    </div>
  );
}

function MakeTopbarEnd({ kept, me }) {
  const initial = initialOf(me?.email, '');
  return (
    <>
      {!kept && <span className="keep-badge"><Trans>Not saved</Trans></span>}
      <span className="keep-topbar-spacer" />
      {me ? (
        initial ? <span className="keep-avatar" title={me.email} aria-label={tr`Signed in as ${ph({ email: me.email })}`}>{initial}</span> : null
      ) : me === null && !kept ? (
        <span className="keep-viewonly"><Eye size={16} weight="regular" aria-hidden="true" /> <Trans>View only until you keep it</Trans></span>
      ) : null}
    </>
  );
}

// ── Paste what the AI wrote ──────────────────────────────────────────────────

function MakePaste({ onMake }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const board = parseMakeText(text);
    if (!board.count) {
      setError(tr`There’s no board in that yet: it needs a picture’s link, a note or a palette. Ask the AI for the board as text “for Clusters” and paste all of it.`);
      return;
    }
    onMake(text);
  };
  return (
    <div className="keep-state-wrap">
      <form className="keep-state make-paste" onSubmit={submit}>
        <span className="keep-state-icon" aria-hidden="true"><ClipboardText size={20} weight="regular" /></span>
        <h1 className="keep-state-title"><Trans>Make a board from what your AI wrote</Trans></h1>
        <p className="keep-state-body">
          <Trans>Ask any AI for a board “for Clusters”, then paste its answer here. Pictures come in by their links.</Trans>
        </p>
        <textarea
          className="make-paste-text"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          placeholder={tr`# Tokyo noir, 1974\n## Look\n![Wet street](https://…)\nPalette: #101820 Ink, #f2aa4c Sodium\n## Story\n### Logline\nA night-shift cabbie…`}
          aria-label={tr`What your AI wrote`}
          rows={9}
          spellCheck={false}
        />
        {error && <p className="keep-island-error" role="alert">{error}</p>}
        <div className="keep-state-actions">
          <button type="submit" className="public-cta keep-cta" disabled={!text.trim()}>
            <Trans>Make the board</Trans> <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <p className="make-paste-foot"><Trans>Nothing is saved until you keep it.</Trans></p>
      </form>
    </div>
  );
}

// ── A link with no board in it ───────────────────────────────────────────────

function MakeEmpty({ cut, fromText, onPaste }) {
  return (
    <div className="keep-state-wrap">
      <div className="keep-state">
        <span className="keep-state-icon" aria-hidden="true"><LinkBreak size={20} weight="regular" /></span>
        <h1 className="keep-state-title">{fromText ? tr`There’s no board in that` : tr`This link doesn’t open a board`}</h1>
        <p className="keep-state-body">
          {cut
            ? tr`The chat cut it short before any of the board came through. Ask the AI for the board as text, and paste it here instead.`
            : tr`It may have been cut short when it was copied. Ask the AI for the link again, or for the board as text to paste here.`}
        </p>
        <div className="keep-state-actions">
          <button type="button" className="public-cta keep-cta" onClick={onPaste}><Trans>Paste it instead</Trans></button>
        </div>
      </div>
    </div>
  );
}

// ── The island: keep it ──────────────────────────────────────────────────────

// The steps: email → code → keeping → kept; someone signed in keeps it with
// "Keep it here". Over the account's room, the island offers the first cards
// that fit.
function MakeIsland({ source, parsed, made, sizes, me, kept, onKept, onPaste }) {
  const FREE_STORAGE_LABEL = freeStorageLabel();
  const [step, setStep] = useState('email');      // email | code | keeping
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sends, setSends] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [room, setRoom] = useState(null);         // { room, needed } once the account's cards are known to be short
  const [spaces, setSpaces] = useState(null);     // workspaces the person may add a cluster to
  const [workspaceId, setWorkspaceId] = useState(null);
  const sentAtRef = useRef(0);
  const captchaRef = useRef(null);
  const codeRef = useRef(null);
  const keepingRef = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setInterval(() => setCooldown(resendWait(sentAtRef.current, Date.now())), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Where someone signed in may keep it: their workspaces where they may add
  // a cluster, their own first.
  useEffect(() => {
    if (!me?.id) { setSpaces(null); return undefined; }
    let alive = true;
    (async () => {
      // supabase-js resolves { data, error }; it never rejects on a refusal.
      const { data } = await supabase
        .from('workspace_members')
        .select('workspace_id, role, created_at, workspaces(id, name, created_by)')
        .eq('user_id', me.id)
        .order('created_at', { ascending: true });
      if (!alive) return;
      const list = (data || [])
        .filter((m) => ADDS_CLUSTERS.has(m.role) && m.workspaces?.id)
        .map((m) => ({ id: m.workspaces.id, name: m.workspaces.name || tr`Workspace`, own: m.workspaces.created_by === me.id }))
        .sort((a, b) => Number(b.own) - Number(a.own));
      setSpaces(list);
      setWorkspaceId((cur) => cur || list[0]?.id || null);
    })().catch(() => { if (alive) setSpaces([]); });
    return () => { alive = false; };
  }, [me?.id]);

  const keep = useCallback(async (via, { fit = false } = {}) => {
    if (keepingRef.current) return;
    keepingRef.current = true;
    setError(null);
    setStep('keeping');
    let answer = null;
    let status = 0;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw Object.assign(new Error('signed out'), { status: 401 });
      const res = await fetch('/api/make/keep', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          source: source.text,
          kind: source.kind,
          pictures: sizes,
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
          ...(fit ? { fit: true } : {}),
        }),
      });
      status = res.status;
      answer = await res.json().catch(() => null);
    } catch (e) {
      status = e?.status || 0;
    }
    keepingRef.current = false;
    if (status === 201 && answer?.board?.id) {
      logEventNow(EV.MAKE_KEPT, { via, cards: answer.cards, left_out: answer.pictures_failed || 0, fit });
      onKept({
        boardId: answer.board.id, workspaceId: answer.workspace_id || null, cards: answer.cards,
        failed: answer.pictures_failed || 0, over: answer.over || 0, room: answer.room_left,
      });
      return;
    }
    const code = answer?.code || (status ? `http_${status}` : 'network');
    logEvent(EV.MAKE_FAILED, { step: 'keep', reason: code });
    setStep('email');
    if (code === 'limit_reached' && Number.isFinite(answer?.room)) {
      setRoom({ room: answer.room, needed: answer.needed });
      return;
    }
    setError(code === 'unauthorized'
      ? tr`Your sign-in ran out. Enter your email again to keep it.`
      : code === 'forbidden'
        ? tr`You can’t add clusters to that workspace. Pick another, or ask its owner.`
        : code === 'rate_limited'
          ? tr`Hold on — too many boards kept just now. Try again in a minute.`
          : tr`It couldn’t be kept just now. Try again in a moment.`);
  }, [source, sizes, workspaceId, onKept]);

  const sendCode = async (resending = false) => {
    setError(null);
    const address = email.trim().toLowerCase();
    if (emailProblem(address)) {
      setError(tr`That address is missing its ending, like .com — check the part after the @.`);
      return;
    }
    if (resending) setBusy(true);
    else { setStep('code'); setCode(''); }
    try {
      const firstSource = signupFirstSource(getFirstSource());
      const locale = signupLocale();
      const signupData = {
        ...(firstSource ? { first_source: firstSource } : {}),
        ...(locale !== 'en' ? { locale } : {}),
      };
      const challenge = captchaEnabled() ? await captchaToken(captchaRef.current) : '';
      const { error: e } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: window.location.origin,
          ...(challenge ? { captchaToken: challenge } : {}),
          ...(Object.keys(signupData).length ? { data: signupData } : {}),
        },
      });
      if (e) throw e;
      logEvent(EV.MAKE_CODE_SENT, { resend: resending });
      const now = Date.now();
      sentAtRef.current = now;
      setSends((n) => (resending ? Math.max(1, n) + 1 : 1));
      setCooldown(resendWait(now, now));
      if (!resending) setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      logEvent(EV.MAKE_FAILED, { step: 'send', reason: keepFailReason(e) });
      if (!resending) setStep('email');
      setError(signInWords(e));
    } finally {
      if (resending) setBusy(false);
    }
  };

  const verify = async (typed) => {
    const token6 = String(typed ?? code).replace(/\s+/g, '');
    if (busy) return;
    if (token6.length < 6) { setError(tr`Enter the 6-digit code from your email.`); return; }
    setError(null);
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token6, type: 'email' });
      if (e) throw e;
      setBusy(false);
      // A new account has no workspace yet: the Worker makes its own. One
      // that has some keeps it in its own (the first listed) without asking.
      await keep('code');
    } catch (e) {
      logEvent(EV.MAKE_FAILED, { step: 'code', reason: keepFailReason(e) });
      setError(signInWords(e, { resent: sends > 1 }));
      setCode('');
      setBusy(false);
      setTimeout(() => codeRef.current?.focus(), 0);
    }
  };

  const switchEmail = async () => {
    try { await supabase.auth.signOut(); } catch (_) {}
    setStep('email');
    setEmail('');
    setError(null);
    setRoom(null);
  };

  const shownCount = made.cards.length;
  const failedHere = (parsed.problems.find((p) => p.code === 'bad_pictures')?.n || 0) + made.left;
  const meta = [
    source.kind === 'text' ? tr`From what your AI wrote` : tr`From a link an AI wrote`,
    parsed.cut
      ? tr`${ph({ shown: shownCount })} of ${plural(parsed.cut.expected, { one: '# card', other: '# cards' })} came through`
      : tr`${plural(shownCount, { one: '# card', other: '# cards' })} · not saved yet`,
    failedHere ? tr`${plural(failedHere, { one: '# picture', other: '# pictures' })} didn’t load` : null,
  ].filter(Boolean).join(' · ');

  if (kept) {
    // Its workspace by name only for someone with more than one.
    const space = spaces && spaces.length > 1 ? spaces.find((s) => s.id === kept.workspaceId) : null;
    const roomText = kept.room != null && kept.room > 0 ? plural(kept.room, { one: '# more card', other: '# more cards' }) : null;
    const keptLine = space
      ? (roomText ? tr`${ph({ name: made.name })} is in ${ph({ space: space.name })}, with room for ${roomText} on the free plan.` : tr`${ph({ name: made.name })} is in ${ph({ space: space.name })}.`)
      : (roomText ? tr`${ph({ name: made.name })} is in your Clusters, with room for ${roomText} on the free plan.` : tr`${ph({ name: made.name })} is in your Clusters.`);
    return (
      <section className="keep-island is-kept" aria-live="polite">
        <div className="keep-island-row">
          <span className="keep-kept-mark" aria-hidden="true"><CheckCircle size={22} weight="regular" /></span>
          <div className="keep-island-text">
            <h2 className="keep-island-title"><Trans>Kept. It’s yours.</Trans></h2>
            <p className="keep-island-meta">
              {keptLine}
              {kept.failed ? ` ${plural(kept.failed, { one: '# picture couldn’t be copied in, and were left out.', other: '# pictures couldn’t be copied in, and were left out.' })}` : ''}
              {kept.over ? ` ${plural(kept.over, { one: '# card past your plan’s room were left out.', other: '# cards past your plan’s room were left out.' })}` : ''}
            </p>
          </div>
          <a className="public-cta keep-cta" href={`/?to=b:${kept.boardId}`}>
            <Trans>Open it</Trans> <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </a>
        </div>
        <p className="keep-island-foot">
          <Trans>Its pictures were copied in, so the board keeps them even if the sites they came from take them down.
          {' '}Next time your AI can make the board in Clusters itself:{' '}
          <a className="keep-link" href="/docs/mcp">add the Clusters app to ChatGPT or Claude</a>.</Trans>
        </p>
      </section>
    );
  }

  const signedIn = !!me;
  const asking = me === undefined;
  const keepLabel = parsed.cut ? tr`Keep these ${ph({ count: shownCount })}` : tr`Keep it`;
  return (
    <section className="keep-island" aria-label={tr`Keep this board`}>
      <div className="keep-island-row">
        <div className="keep-island-text">
          <h2 className="keep-island-title">{made.name}</h2>
          <p className="keep-island-meta">{meta}</p>
        </div>
        {step === 'keeping' ? (
          <div key="keeping" className="keep-island-actions">
            <button type="button" className="public-cta keep-cta" disabled><Trans>Keeping…</Trans></button>
          </div>
        ) : room ? (
          <div key="room" className="keep-island-actions">
            {room.room > 0 ? (
              <button type="button" className="public-cta keep-cta" onClick={() => keep(signedIn ? 'signed_in' : 'code', { fit: true })}>
                <Trans>Keep the first {ph({ room: room.room })}</Trans>
              </button>
            ) : null}
            <a className="btn-secondary keep-retry make-plans" href="/pricing"><Trans>See plans</Trans></a>
          </div>
        ) : signedIn && step === 'email' ? (
          <div key="here" className="keep-island-actions">
            {spaces && spaces.length > 1 ? (
              <select
                className="keep-input make-select"
                aria-label={tr`Workspace`}
                value={workspaceId || ''}
                onChange={(e) => setWorkspaceId(e.target.value)}
              >
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : null}
            <button type="button" className="public-cta keep-cta" disabled={spaces === null}
                    onClick={() => keep('signed_in')}>
              {parsed.cut ? keepLabel : tr`Keep it here`}
            </button>
          </div>
        ) : step === 'code' ? (
          <form key="code" className="keep-island-form is-code" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <div className="keep-email-chip">
              <span className="keep-chip">{email.trim().toLowerCase()}</span>
              <button type="button" className="keep-link" onClick={() => { setStep('email'); setCode(''); setError(null); }}>{tr`edit`}</button>
            </div>
            <div className="keep-island-actions">
              <input
                ref={codeRef}
                className="keep-input keep-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="••••••"
                aria-label={tr`6-digit code`}
                value={code}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(v);
                  if (v.length === 6) verify(v);
                }}
              />
              <button type="submit" className="public-cta keep-cta" disabled={busy}>{busy ? tr`Checking…` : keepLabel}</button>
            </div>
          </form>
        ) : (
          <form key="email" className="keep-island-form" onSubmit={(e) => { e.preventDefault(); sendCode(false); }}>
            <div className="keep-island-actions">
              <input
                className="keep-input"
                type="email"
                autoComplete="email"
                placeholder={tr`you@studio.com`}
                aria-label={tr`Your email`}
                value={email}
                required
                disabled={asking}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="public-cta keep-cta" disabled={asking}>
                {parsed.cut ? keepLabel : tr`Keep it free`} <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </form>
        )}
      </div>
      {error && <p className="keep-island-error" role="alert">{error}</p>}
      <p className="keep-island-foot">
        {room ? (
          room.room > 0
            ? tr`This board has ${plural(room.needed, { one: '# card', other: '# cards' })}, and your plan has room for ${ph({ room: room.room })} more. Keep the first ${ph({ keep: room.room })}, or see the plans with room for all of it.`
            : tr`Your plan has no room for more cards. See the plans with room for this board.`
        ) : parsed.cut && step !== 'code' ? (
          <>
            {tr`The chat cut this link short: ${plural(parsed.cut.missing, { one: '# card', other: '# cards' })} didn’t come through.`}
            {' '}<Trans>Keep these {shownCount}, or ask the AI for the board as text and{' '}
            <button type="button" className="keep-link" onClick={onPaste}>paste it instead</button>.</Trans>
          </>
        ) : step === 'code' ? (
          <>
            <Trans>Check your inbox for the 6-digit code — and Spam or Promotions if it isn’t there.</Trans>{' '}
            {cooldown > 0
              ? <span className="keep-wait"><Trans>Resend in {cooldown}s</Trans></span>
              : <button type="button" className="keep-link" disabled={busy} onClick={() => sendCode(true)}><Trans>Resend code</Trans></button>}
          </>
        ) : signedIn && step !== 'keeping' ? (
          <>
            {spaces && spaces.length > 1
              ? tr`Signed in as ${ph({ email: me.email })}. It goes into this workspace as a cluster of its own.`
              : tr`Signed in as ${ph({ email: me.email })}. It goes into your workspace as a cluster of its own.`}{' '}
            <button type="button" className="keep-link" onClick={switchEmail}><Trans>Use another email</Trans></button>
          </>
        ) : (
          <>
            <Trans>We’ll email you a 6-digit code. Free up to {DEMO_CARD_LIMIT} cards and {FREE_STORAGE_LABEL}.
            {' '}Already on Clusters? Use the email you sign in with.</Trans>
          </>
        )}
      </p>
      {/* Empty unless Turnstile needs a person to tap. */}
      <div ref={captchaRef} className="auth-captcha" />
    </section>
  );
}
