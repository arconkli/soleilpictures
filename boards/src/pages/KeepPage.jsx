// KeepPage — a draft's keep page: /keep/<token>.
//
// A draft is a cluster ChatGPT or Claude made through /mcp for someone without
// an account (lib/mcpDrafts.js, 0705), and every answer the AI got carries this
// page's link. The page shows the draft as it is, read only, through the real
// canvas (as the share viewer does), and one island over it keeps it: an
// email, the code we send, and the draft's workspace becomes theirs
// (keep_mcp_draft) — a new account's own, or a workspace beside an existing
// account's. Someone already signed in keeps it with one button. The owner's
// pick of 2026-10-27: keep page A, the island over the board.
//
// The token is the key to keeping it. The page posts it in a body
// (lib/keepDraft.js → worker-keep.js), the pictures come by addresses that
// name only the picture, events and errors drop it (linkTokens.js, 0707),
// Meta's pixel never loads here (index.html), and every Referer from here
// names only our origin (worker.js). A new account made here is attributed by
// its landing path, /keep/:token (analytics.js getFirstSource).
//
// Not a marketing surface: none of the share viewer's prompts, remixes or
// share attribution.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { ArrowRight, CheckCircle, Eye, Hourglass, LinkBreak } from '@phosphor-icons/react';
import { b64ToBytes, readCards, readArrows, readStrokes, readGroups } from '../lib/yhelpers.js';
import { CanvasSurface } from '../components/CanvasSurface.jsx';
import { SoleilMark } from '../components/primitives.jsx';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { setReadUrlResolver, clearReadUrlResolver, setImageAuthErrorHandler, clearImageAuthErrorHandler } from '../lib/r2.js';
import { setMetaResolver, clearMetaResolver } from '../lib/imageMeta.js';
import { EntityNavigateContext } from '../hooks/useEntityNavigate.js';
import { OpenDmContext } from '../hooks/useOpenDm.js';
import { supabase } from '../lib/supabase.js';
import { getFirstSource } from '../lib/analytics.js';
import { placedOf } from '../lib/placement.js';
import { boundsOfCards } from '../lib/canvasGeom.js';
import { fitMargin } from '../lib/captureCamera.js';
import { emailProblem } from '../lib/emailTypo.js';
import { resendWait } from '../lib/pendingCode.js';
import { captchaEnabled, captchaToken } from '../auth/turnstile.js';
import { FREE_STORAGE_LABEL } from '../lib/billingCopy.js';
import {
  fetchKeepBundle, firstClusterOf, keepPath, hostName, keepFailure, roomLeft, deleteDay,
  signInWords, signupFirstSource,
} from '../lib/keepDraft.js';
import './keepPage.css';

const EMPTY = [];
const EMPTY_OBJ = {};
const NOOP = () => {};
// CanvasSurface reads one tweak field; arrows show as in the editor.
const KEEP_TWEAK = { showArrows: true };
// Picture addresses are signed for an hour (lib/signedImage.js); fresh ones
// are fetched well before that while the page is open.
const URL_REFRESH_MS = 40 * 60 * 1000;
// The island floats over the canvas's foot: the bar's height, and the room the
// island takes at rest with its 24px gap and some air.
const TOPBAR_H = 48;
const ISLAND_ROOM = 172;

function decodeBundle(bundle) {
  // A bare Y.Doc, as the share viewer reads its bundles: yboard.js would
  // pull the editor's document code into a signed-out page.
  const ydoc = new Y.Doc();
  if (bundle.snapshot) {
    try { Y.applyUpdate(ydoc, b64ToBytes(bundle.snapshot)); }
    catch (e) { console.warn('[keep] snapshot decode failed', e); }
  }
  return {
    board: bundle.board || {},
    ydoc,
    cards: readCards(ydoc),
    arrows: readArrows(ydoc),
    strokes: readStrokes(ydoc),
    groups: readGroups(ydoc),
  };
}

export function KeepPage({ token }) {
  const firstId = useMemo(() => firstClusterOf(window.location.search), []);
  const [status, setStatus] = useState('loading'); // loading | live | kept | expired | unknown | error
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState(null);        // { host, expiresAt, lifetimeDays, cardCount, cardLimit }
  const [cache, setCache] = useState({});          // board id → decoded bundle
  const [navBoards, setNavBoards] = useState({});  // board id → name
  const [stack, setStack] = useState([]);          // board ids, last = shown
  const [navBusy, setNavBusy] = useState(false);
  const [imgEpoch, setImgEpoch] = useState(0);
  const [kept, setKept] = useState(null);          // { boardId, room, limit } once it's theirs

  const imageMapRef = useRef({});
  const imageMetaRef = useRef({});
  const ydocsRef = useRef(new Set());
  const shownFirstRef = useRef(null);              // the cluster the page opened on
  const fetchedAtRef = useRef(0);
  const refreshingRef = useRef(false);
  const lastForcedRef = useRef(0);
  const openingRef = useRef(false);

  const currentId = stack.length ? stack[stack.length - 1] : null;
  const cur = currentId ? cache[currentId] : null;
  const currentIdRef = useRef(null);
  currentIdRef.current = currentId;
  const stackRef = useRef(stack);
  stackRef.current = stack;

  // ── The draft's pictures, from the bundle's signed addresses ──
  useEffect(() => {
    setReadUrlResolver((key) => imageMapRef.current[key] || null);
    setMetaResolver((key) => {
      const m = imageMetaRef.current[key];
      return m ? {
        blur: m.blur || null,
        previewKey: m.preview || null,
        previewW: m.preview_w ?? null,
        previewH: m.preview_h ?? null,
        previewSmKey: m.preview_sm || null,
        previewSmW: m.preview_sm_w ?? null,
        previewSmH: m.preview_sm_h ?? null,
      } : null;
    });
    const docs = ydocsRef.current;
    return () => {
      clearReadUrlResolver();
      clearMetaResolver();
      docs.forEach((d) => { try { d.destroy(); } catch (_) {} });
      docs.clear();
    };
  }, []);

  const applyBundle = useCallback((bundle) => {
    const decoded = decodeBundle(bundle);
    ydocsRef.current.add(decoded.ydoc);
    const id = decoded.board.id;
    if (id) setCache((c) => ({ ...c, [id]: decoded }));
    Object.assign(imageMapRef.current, bundle.image_urls || {});
    Object.assign(imageMetaRef.current, bundle.image_meta || {});
    fetchedAtRef.current = Date.now();
    if (Array.isArray(bundle.nav_boards)) {
      setNavBoards((prev) => {
        const next = { ...prev };
        bundle.nav_boards.forEach((b) => { if (b?.id) next[b.id] = b.name; });
        return next;
      });
    }
    setDraft({
      host: bundle.host || 'other',
      expiresAt: bundle.expires_at || null,
      lifetimeDays: bundle.lifetime_days ?? null,
      cardCount: Number.isFinite(bundle.card_count) ? bundle.card_count : null,
      cardLimit: Number.isFinite(bundle.card_limit) ? bundle.card_limit : null,
    });
    return id;
  }, []);

  // ── First read: the cluster ?b= names, else the draft's main one ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const read = async () => {
        try { return await fetchKeepBundle(token, firstId); }
        catch (e) {
          if (cancelled || e?.status === 429) throw e;
          await new Promise((r) => setTimeout(r, 1500));
          if (cancelled) throw e;
          return fetchKeepBundle(token, firstId);
        }
      };
      try {
        const bundle = await read();
        if (cancelled) return;
        if (bundle.state !== 'live') {
          setDraft({ host: bundle.host || 'other', lifetimeDays: bundle.lifetime_days ?? null });
          setStatus(bundle.state);
          return;
        }
        const id = applyBundle(bundle);
        shownFirstRef.current = id;
        setStack(id ? [id] : []);
        try { window.history.replaceState({ keepStack: [id] }, '', window.location.pathname + window.location.search); } catch (_) {}
        setStatus('live');
      } catch (e) {
        console.warn('[keep] the draft could not be read', e?.status);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, firstId, applyBundle, loadAttempt]);

  useEffect(() => {
    const name = (cur?.board?.name || '').trim();
    document.title = name ? `${name} — Soleil Clusters` : 'Your draft — Soleil Clusters';
  }, [cur]);

  // ── Fresh picture addresses: on a clock, and when one has run out ──
  const refreshUrls = useCallback(async ({ force = false } = {}) => {
    if (refreshingRef.current) return;
    if (!force && Date.now() - fetchedAtRef.current < URL_REFRESH_MS) return;
    refreshingRef.current = true;
    try {
      const id = currentIdRef.current;
      const bundle = await fetchKeepBundle(token, id);
      if (bundle.state !== 'live') return;
      Object.assign(imageMapRef.current, bundle.image_urls || {});
      Object.assign(imageMetaRef.current, bundle.image_meta || {});
      fetchedAtRef.current = Date.now();
      if (force) setImgEpoch((n) => n + 1);
    } catch (_) {
      // The next tick or the next picture that fails asks again.
    } finally {
      refreshingRef.current = false;
    }
  }, [token]);

  useEffect(() => {
    if (status !== 'live') return undefined;
    const onVis = () => { if (document.visibilityState === 'visible') refreshUrls(); };
    document.addEventListener('visibilitychange', onVis);
    const iv = setInterval(() => refreshUrls(), 5 * 60 * 1000);
    setImageAuthErrorHandler(() => {
      const now = Date.now();
      if (now - lastForcedRef.current < 30 * 1000) return;
      lastForcedRef.current = now;
      refreshUrls({ force: true });
    });
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(iv);
      clearImageAuthErrorHandler();
    };
  }, [status, refreshUrls]);

  // ── Moving between the draft's clusters ──
  useEffect(() => {
    const onPop = (e) => {
      const s = e.state?.keepStack;
      if (Array.isArray(s) && s.length && s.every((id) => cache[id])) setStack(s);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [cache]);

  const openBoard = useCallback(async (boardId) => {
    if (!boardId || openingRef.current || boardId === currentIdRef.current) return;
    openingRef.current = true;
    const cached = !!cache[boardId];
    try {
      if (!cached) {
        setNavBusy(true);
        const bundle = await fetchKeepBundle(token, boardId);
        if (bundle.state !== 'live' || bundle.board?.id !== boardId) return;
        applyBundle(bundle);
      }
      const next = [...stackRef.current, boardId];
      setStack(next);
      try { window.history.pushState({ keepStack: next }, '', keepPath(token, boardId, shownFirstRef.current)); } catch (_) {}
    } catch (e) {
      console.warn('[keep] could not open that cluster', e?.status);
    } finally {
      openingRef.current = false;
      if (!cached) setNavBusy(false);
    }
  }, [cache, token, applyBundle]);

  const goToCrumb = useCallback((i) => {
    const prev = stackRef.current;
    if (i >= prev.length - 1) return;
    const next = prev.slice(0, i + 1);
    setStack(next);
    try { window.history.pushState({ keepStack: next }, '', keepPath(token, next[next.length - 1], shownFirstRef.current)); } catch (_) {}
  }, [token]);

  const boardsMap = useMemo(() => {
    const m = {};
    Object.entries(navBoards).forEach(([id, name]) => { m[id] = { id, name }; });
    if (cur?.board?.id) m[cur.board.id] = cur.board;
    return m;
  }, [navBoards, cur]);

  // A cluster card whose cluster isn't the draft's (or is gone) is left out,
  // as the share viewer leaves out what its link doesn't reach.
  const visibleCards = useMemo(() => {
    const cards = cur?.cards || EMPTY;
    const shown = cards.filter((c) => (
      c.kind === 'board' ? !!boardsMap[c.id]
        : c.kind === 'boardlink' ? !!boardsMap[c.target]
          : true));
    return shown.length === cards.length ? cards : shown;
  }, [cur, boardsMap]);
  const canvasCards = useMemo(() => placedOf(visibleCards), [visibleCards]);

  // On a desktop the first view fits the draft into the canvas above the
  // island: CanvasSurface fits this frame, the cards' bounds stretched down by
  // the island's share of the canvas, so the cards keep the canvas's margin
  // and clear the island. A phone keeps the canvas's own opening, framed for
  // reading, above its sheet.
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
  const [me, setMe] = useState(undefined);         // undefined: asking · null: signed out · { email }
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

  const board = cur?.board || EMPTY_OBJ;
  const host = hostName(draft?.host);
  const showCrumbs = stack.length > 1;

  if (status === 'loading') {
    return (
      <div className="public-shell public-dark keep-shell">
        <KeepTopbar />
        <div className="public-loading">
          <SoleilMark size={42} color="var(--soleil)" glow />
          <div>Loading the draft…</div>
        </div>
      </div>
    );
  }
  if (status !== 'live') {
    return (
      <div className="public-shell public-dark keep-shell">
        <KeepTopbar />
        <KeepStateCard status={status} host={host} lifetimeDays={draft?.lifetimeDays} signedIn={!!me}
                       onRetry={() => { setStatus('loading'); setLoadAttempt((n) => n + 1); }} />
      </div>
    );
  }

  return (
    <div className="public-shell public-dark keep-shell" style={{ background: board.bg_color || 'var(--bg-0)' }}>
      <KeepTopbar busy={navBusy}>
        {showCrumbs ? (
          <nav className="keep-crumbs" aria-label="Breadcrumb">
            {stack.map((id, i) => {
              const last = i === stack.length - 1;
              const name = (last ? board.name : navBoards[id] || cache[id]?.board?.name) || 'Cluster';
              return (
                <span key={id} className="keep-crumb-wrap">
                  {i > 0 && <span className="keep-crumb-sep" aria-hidden="true">›</span>}
                  {last ? (
                    <span className="keep-crumb here" aria-current="page">{name}</span>
                  ) : (
                    <button type="button" className="keep-crumb" onClick={() => goToCrumb(i)}>{name}</button>
                  )}
                </span>
              );
            })}
          </nav>
        ) : (
          <span className="keep-name">{board.name || 'Untitled'}</span>
        )}
        <KeepTopbarEnd kept={!!kept} me={me} />
      </KeepTopbar>

      <EntityNavigateContext.Provider value={EMPTY_OBJ}>
        <OpenDmContext.Provider value={NOOP}>
          <div className={`public-canvas-host keep-canvas${navBusy ? ' is-nav-busy' : ''}`} aria-busy={navBusy}>
            <CanvasSurface
              key={`cv-${imgEpoch}`}
              board={board}
              boards={boardsMap}
              cards={canvasCards}
              allCards={visibleCards}
              arrows={cur?.arrows || EMPTY}
              strokes={cur?.strokes || EMPTY}
              groups={cur?.groups || EMPTY}
              ydoc={cur?.ydoc || null}
              getAwareness={undefined}
              currentUser={undefined}
              mutators={EMPTY_OBJ}
              canEdit={false}
              isPublic
              onOpenBoard={openBoard}
              onOpenPicker={NOOP}
              tweak={KEEP_TWEAK}
              initialFrame={initialFrame}
              depth={Math.max(0, stack.length - 1)}
              selectedTool="pan"
              setSelectedTool={NOOP}
              defaults={null}
              workspaceId={null}
              userId={null}
            />
          </div>
        </OpenDmContext.Provider>
      </EntityNavigateContext.Provider>

      <KeepIsland token={token} name={cache[shownFirstRef.current]?.board?.name || board.name}
                  draft={draft} host={host} me={me} kept={kept} onKept={setKept} onGone={setStatus} />
    </div>
  );
}

// ── The bar along the top ────────────────────────────────────────────────────

function KeepTopbar({ busy = false, children = null }) {
  return (
    <div className="public-topbar keep-topbar">
      <a className="public-brand" href="/" title="Clusters home">
        <ClustersMark size={20} />
        <span className="public-brand-name">Clusters</span>
      </a>
      {children ? <span className="keep-topbar-rule" aria-hidden="true" /> : null}
      {children}
      {busy && <div className="public-nav-progress" aria-hidden="true" />}
    </div>
  );
}

// ── The island: keep it ──────────────────────────────────────────────────────

// The steps: email → code → keeping → kept. Someone signed in keeps it with
// "Keep it here" instead of the email and the code.
function KeepIsland({ token, name, draft, host, me, kept, onKept, onGone }) {
  const [step, setStep] = useState('email');      // email | code | keeping
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sends, setSends] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const sentAtRef = useRef(0);
  const captchaRef = useRef(null);
  const codeRef = useRef(null);
  const keepingRef = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setInterval(() => setCooldown(resendWait(sentAtRef.current, Date.now())), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const keep = useCallback(async () => {
    if (keepingRef.current) return;
    keepingRef.current = true;
    setError(null);
    setStep('keeping');
    // supabase-js resolves { data, error }; it never rejects on a refusal.
    const { data, error: e } = await supabase.rpc('keep_mcp_draft', { p_token: token });
    keepingRef.current = false;
    if (!e && data?.status === 'kept') {
      onKept({ boardId: data.board_id || null, room: roomLeft(data.card_count, data.card_limit), limit: data.card_limit ?? null });
      return;
    }
    const why = keepFailure(e);
    if (why === 'kept' || why === 'expired' || why === 'unknown') { onGone(why); return; }
    setStep('email');
    setError(why === 'not_a_person'
      ? 'Sign in with your own email address to keep a draft.'
      : why === 'suspended'
        ? 'This account can’t keep drafts. Sign in with another email.'
        : 'It couldn’t be kept just now. Try again in a moment.');
  }, [token, onKept, onGone]);

  const sendCode = async (resending = false) => {
    setError(null);
    const address = email.trim().toLowerCase();
    if (emailProblem(address)) {
      setError('That address is missing its ending, like .com — check the part after the @.');
      return;
    }
    // The code step shows at once and the request runs under it, as on the
    // sign-in page; a send that fails comes back to the email with its reason.
    if (resending) setBusy(true);
    else { setStep('code'); setCode(''); }
    try {
      const firstSource = signupFirstSource(getFirstSource());
      const challenge = captchaEnabled() ? await captchaToken(captchaRef.current) : '';
      const { error: e } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: window.location.origin,
          ...(challenge ? { captchaToken: challenge } : {}),
          ...(firstSource ? { data: { first_source: firstSource } } : {}),
        },
      });
      if (e) throw e;
      const now = Date.now();
      sentAtRef.current = now;
      setSends((n) => (resending ? Math.max(1, n) + 1 : 1));
      setCooldown(resendWait(now, now));
      if (!resending) setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      if (!resending) setStep('email');
      setError(signInWords(e));
    } finally {
      if (resending) setBusy(false);
    }
  };

  const verify = async (typed) => {
    const token6 = String(typed ?? code).replace(/\s+/g, '');
    if (busy) return;
    if (token6.length < 6) { setError('Enter the 6-digit code from your email.'); return; }
    setError(null);
    setBusy(true);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token6, type: 'email' });
      if (e) throw e;
      setBusy(false);
      await keep();
    } catch (e) {
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
  };

  const madeWith = host ? `Made with ${host}` : 'Made in an AI chat';
  const day = deleteDay(draft?.expiresAt);
  const meta = [
    madeWith,
    Number.isFinite(draft?.cardCount) ? `${draft.cardCount} ${draft.cardCount === 1 ? 'card' : 'cards'}` : null,
    day ? `deleted ${day} unless you keep it` : null,
  ].filter(Boolean).join(' · ');
  const limit = Number.isFinite(draft?.cardLimit) ? draft.cardLimit : null;

  if (kept) {
    const room = kept.room;
    return (
      <section className="keep-island is-kept" aria-live="polite">
        <div className="keep-island-row">
          <span className="keep-kept-mark" aria-hidden="true"><CheckCircle size={22} weight="regular" /></span>
          <div className="keep-island-text">
            <h2 className="keep-island-title">Kept. It’s yours.</h2>
            <p className="keep-island-meta">
              {name || 'It'} is in your Clusters
              {room != null && room > 0 ? `, with room for ${room} more ${room === 1 ? 'card' : 'cards'} on the free plan.` : '.'}
              {room === 0 && kept.limit != null ? ` It fills the free plan’s ${kept.limit} cards: adding more needs room or a plan.` : ''}
            </p>
          </div>
          <a className="public-cta keep-cta" href={kept.boardId ? `/?to=b:${kept.boardId}` : '/'}>
            Open it <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </a>
        </div>
        <p className="keep-island-foot">
          {host
            ? `Back in ${host}, keep asking for changes. The first time, ${host} asks you to connect Clusters: sign in with the same email.`
            : 'Back in your AI chat, keep asking for changes. The first time, it asks you to connect Clusters: sign in with the same email.'}
        </p>
      </section>
    );
  }

  const signedIn = !!me;
  const asking = me === undefined;
  return (
    <section className="keep-island" aria-label="Keep this draft">
      <div className="keep-island-row">
        <div className="keep-island-text">
          <h2 className="keep-island-title">{name || 'Your draft'}</h2>
          {meta && <p className="keep-island-meta">{meta}</p>}
        </div>
        {/* Each step keyed: reused, "edit"'s button would turn into the email
            form's submit during its own click, and the click would send the
            code again. */}
        {step === 'keeping' ? (
          <div key="keeping" className="keep-island-actions">
            <button type="button" className="public-cta keep-cta" disabled>Keeping…</button>
          </div>
        ) : signedIn && step === 'email' ? (
          <div key="here" className="keep-island-actions">
            <button type="button" className="public-cta keep-cta" onClick={keep}>Keep it here</button>
          </div>
        ) : step === 'code' ? (
          <form key="code" className="keep-island-form is-code" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <div className="keep-email-chip">
              <span className="keep-chip">{email.trim().toLowerCase()}</span>
              <button type="button" className="keep-link" onClick={() => { setStep('email'); setCode(''); setError(null); }}>edit</button>
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
                aria-label="6-digit code"
                value={code}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(v);
                  if (v.length === 6) verify(v);
                }}
              />
              <button type="submit" className="public-cta keep-cta" disabled={busy}>{busy ? 'Checking…' : 'Keep it'}</button>
            </div>
          </form>
        ) : (
          <form key="email" className="keep-island-form" onSubmit={(e) => { e.preventDefault(); sendCode(false); }}>
            <div className="keep-island-actions">
              <input
                className="keep-input"
                type="email"
                autoComplete="email"
                placeholder="you@studio.com"
                aria-label="Your email"
                value={email}
                required
                disabled={asking}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="public-cta keep-cta" disabled={asking}>
                Keep it free <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </form>
        )}
      </div>
      {error && <p className="keep-island-error" role="alert">{error}</p>}
      <p className="keep-island-foot">
        {step === 'code' ? (
          <>
            Check your inbox for the 6-digit code — and Spam or Promotions if it isn’t there.{' '}
            {cooldown > 0
              ? <span className="keep-wait">Resend in {cooldown}s</span>
              : <button type="button" className="keep-link" disabled={busy} onClick={() => sendCode(true)}>Resend code</button>}
          </>
        ) : signedIn && step !== 'keeping' ? (
          <>
            Signed in as {me.email}. It comes into your Clusters as a workspace of its own.{' '}
            <button type="button" className="keep-link" onClick={switchEmail}>Use another email</button>
          </>
        ) : (
          <>
            We’ll email you a 6-digit code.
            {limit != null ? ` Free up to ${limit} cards and ${FREE_STORAGE_LABEL}.` : ''}
            {' '}Already on Clusters? Use the email you sign in with.
          </>
        )}
      </p>
      {/* Empty unless Turnstile needs a person to tap. */}
      <div ref={captchaRef} className="auth-captcha" />
    </section>
  );
}

// The top bar's right side: DRAFT and "view only" until it's kept; the
// signed-in person's initial.
function KeepTopbarEnd({ kept, me }) {
  const initial = (me?.email || '').trim().charAt(0).toUpperCase();
  return (
    <>
      {!kept && <span className="keep-badge">Draft</span>}
      <span className="keep-topbar-spacer" />
      {me ? (
        initial ? <span className="keep-avatar" title={me.email} aria-label={`Signed in as ${me.email}`}>{initial}</span> : null
      ) : me === null && !kept ? (
        <span className="keep-viewonly"><Eye size={16} weight="regular" aria-hidden="true" /> View only until you keep it</span>
      ) : null}
    </>
  );
}

// ── A draft that can't be shown ──────────────────────────────────────────────

function KeepStateCard({ status, host, lifetimeDays, signedIn, onRetry }) {
  const ai = host || 'the AI chat';
  const home = signedIn
    ? <a className="public-cta keep-cta" href="/">Open Clusters</a>
    : <a className="public-cta keep-cta" href="/">Try Clusters free</a>;
  let icon = <Hourglass size={20} weight="regular" />;
  let title;
  let body;
  let action = home;
  if (status === 'expired') {
    title = 'This draft is gone';
    body = `${lifetimeDays ? `Drafts are deleted ${lifetimeDays} days after their last change, and` : 'Drafts are deleted a while after their last change, and'} nobody kept this one. Ask ${ai} to make it again, then keep it.`;
  } else if (status === 'kept') {
    icon = <CheckCircle size={20} weight="regular" />;
    title = 'This draft was kept';
    body = 'Whoever kept it has it in their Clusters now. If that was you, sign in to open it.';
    action = <a className="public-cta keep-cta" href="/">{signedIn ? 'Open Clusters' : 'Sign in'}</a>;
  } else if (status === 'unknown') {
    icon = <LinkBreak size={20} weight="regular" />;
    title = 'This link doesn’t open a draft';
    body = `It may have been cut short when it was copied. Ask ${ai} for the keep link again.`;
  } else {
    icon = <SoleilMark size={22} color="var(--soleil)" />;
    title = 'Couldn’t load this draft';
    body = 'The connection dropped or the server didn’t answer in time. Nothing is wrong with the link — try again in a moment.';
    action = <button type="button" className="btn-secondary keep-retry" onClick={onRetry}>Retry</button>;
  }
  return (
    <div className="keep-state-wrap">
      <div className="keep-state" role={status === 'error' ? 'alert' : undefined}>
        <span className="keep-state-icon" aria-hidden="true">{icon}</span>
        <h1 className="keep-state-title">{title}</h1>
        <p className="keep-state-body">{body}</p>
        <div className="keep-state-actions">{action}</div>
      </div>
    </div>
  );
}
