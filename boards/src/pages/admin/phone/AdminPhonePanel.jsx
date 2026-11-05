// AdminPhonePanel.jsx — /admin on a phone (the owner, 2026-11-01: "make our
// tiktok posts downloaded thing into like a mobile admin panel where it's
// really easy to keep up with and see stats for clusters").
//
// Three tabs: Today (lib/phonePanel.js over the admin's own reads), Posts (the
// TikTok posts page, through /api/admin/posts/) and Boards (the existing phone
// Boards tab, passed in). ?tab=posts / ?tab=boards opens one; ?full=1 skips
// the panel for the desktop admin. On Today, ?page=<id> opens one of the pages
// behind it (PhonePages.jsx) and ?sheet=<measure id> a measure sheet over the
// home or a page; each is one history entry, so Back closes it. Refreshes on open, on coming back to the
// app, every 5 minutes while open, and on a pull down. While it is mounted the
// manifest is /admin.webmanifest, so Add to Home Screen opens straight here.
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './adminPhone.css';
import { PhoneToday } from './PhoneToday.jsx';
import { PhonePosts } from './PhonePosts.jsx';
import { PhoneSheet } from './PhoneSheet.jsx';
import { PAGE_CALLS } from './phoneData.js';
import { MEASURES } from '../../../lib/phonePanel.js';

// The pages behind Today (Growth, Search, ...) load as their own chunk.
const PhonePage = lazy(() => import('./PhonePages.jsx'));

const TABS = [
  { id: 'today', label: 'Today', icon: <path d="M4 19V10M10 19V5M16 19v-6M22 19H2" /> },
  { id: 'posts', label: 'Posts', icon: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M10 17h4" /></> },
  { id: 'boards', label: 'Boards', icon: <><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /></> },
];
const SUB = { today: 'Admin', posts: 'Posts', boards: 'Boards' };
const EVERY = 5 * 60 * 1000;

function firstTab() {
  try {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'posts' || t === 'boards') return t;
  } catch { /* ignore */ }
  return 'today';
}

// ?page=<id> and ?sheet=<measure id>, valid on the Today tab only.
function urlView() {
  try {
    const q = new URLSearchParams(window.location.search);
    const t = q.get('tab');
    if (t === 'posts' || t === 'boards') return { page: null, sheet: null };
    const page = q.get('page');
    const sheet = q.get('sheet');
    return {
      page: page && Object.prototype.hasOwnProperty.call(PAGE_CALLS, page) ? page : null,
      sheet: sheet && MEASURES.some((m) => m.id === sheet) ? sheet : null,
    };
  } catch { return { page: null, sheet: null }; }
}

const depthNow = () => { try { return Number(window.history.state?.apDepth) || 0; } catch { return 0; } };

// The current URL with one param set (value) or removed (null), kept otherwise.
function withParam(name, value) {
  const url = new URL(window.location.href);
  if (value == null) url.searchParams.delete(name); else url.searchParams.set(name, value);
  return url;
}

function useAdminManifest() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    const title = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const before = link?.getAttribute('href');
    const beforeTitle = title?.getAttribute('content');
    const beforeDoc = document.title;
    link?.setAttribute('href', '/admin.webmanifest');
    title?.setAttribute('content', 'Soleil admin');
    // iOS names a Home Screen icon after the page title when no meta says otherwise.
    document.title = 'Soleil admin';
    return () => {
      document.title = beforeDoc;
      if (link && before != null) link.setAttribute('href', before);
      if (title && beforeTitle != null) title.setAttribute('content', beforeTitle);
    };
  }, []);
}

function updatedText(at, now) {
  if (!at) return 'Loading…';
  const s = Math.round((now - at) / 1000);
  if (s < 60) return 'Updated just now';
  if (s < 3600) return `Updated ${Math.floor(s / 60)} min ago`;
  return `Updated ${Math.floor(s / 3600)} h ago`;
}

export function AdminPhonePanel({ boards, postsApi }) {
  const [tab, setTab] = useState(firstTab);
  const [view, setView] = useState(urlView);
  const { page, sheet } = view;
  const [refresh, setRefresh] = useState({ n: 0, force: false });
  const [updatedAt, setUpdatedAt] = useState(null);
  const [ok, setOk] = useState(true);
  const [badge, setBadge] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [pulling, setPulling] = useState(false);
  const scrollRef = useRef(null);
  const pageRef = useRef(null);
  const lastRefresh = useRef(Date.now());
  const homeScroll = useRef(0);
  const opener = useRef(null);
  const focusBack = useRef(false);
  const pendingTab = useRef(null);
  const warmed = useRef(false);
  const prevPage = useRef(page);
  useAdminManifest();

  const doRefresh = useCallback((force) => {
    lastRefresh.current = Date.now();
    setRefresh((r) => ({ n: r.n + 1, force }));
  }, []);
  const auto = useCallback(() => doRefresh(false), [doRefresh]);
  const forced = useCallback(() => doRefresh(true), [doRefresh]);

  // Pages and sheets live in the URL and in history: opening pushes an entry
  // (apDepth counts ours), so Back, the Android button and the Safari swipe
  // close them. A cold deep link has no entry of ours to pop; closing then
  // takes the param out of the URL instead.
  const push = (name, value) => {
    try {
      window.history.pushState({ ...(window.history.state || {}), apDepth: depthNow() + 1 }, '', withParam(name, value));
    } catch { /* ignore */ }
  };
  const drop = (name) => {
    if (depthNow() > 0) { window.history.back(); return; }
    try { window.history.replaceState(window.history.state, '', withParam(name, null)); } catch { /* ignore */ }
    setView((v) => ({ ...v, [name]: null }));
  };

  const openPage = (id) => {
    if (!Object.prototype.hasOwnProperty.call(PAGE_CALLS, id)) return;
    homeScroll.current = scrollRef.current?.scrollTop || 0;
    opener.current = document.activeElement;
    focusBack.current = true;
    push('page', id);
    setView({ page: id, sheet: null });
    scrollRef.current?.scrollTo?.(0, 0);
  };
  const openSheet = (id) => {
    if (!MEASURES.some((m) => m.id === id)) return;
    push('sheet', id);
    setView((v) => ({ ...v, sheet: id }));
  };
  const closePage = () => drop('page');
  const closeSheet = () => drop('sheet');

  const switchTab = (id) => {
    setTab(id);
    try {
      const url = withParam('tab', id === 'today' ? null : id);
      url.searchParams.delete('page');
      url.searchParams.delete('sheet');
      window.history.replaceState({}, '', url);
    } catch { /* ignore */ }
    setView({ page: null, sheet: null });
    scrollRef.current?.scrollTo?.(0, 0);
  };
  const select = (id) => {
    const depth = depthNow();
    if (depth > 0) {
      // Pop our entries first; the popstate handler then switches the tab.
      pendingTab.current = id;
      window.history.go(-depth);
    } else {
      switchTab(id);
    }
  };
  const switchRef = useRef(switchTab);
  switchRef.current = switchTab;

  useEffect(() => {
    const onPop = () => {
      if (pendingTab.current) {
        const id = pendingTab.current;
        pendingTab.current = null;
        switchRef.current(id);
        return;
      }
      setView(urlView());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Closing a page: the home comes back where it was, and focus goes to the control that opened it.
  useLayoutEffect(() => {
    if (prevPage.current && !page) {
      if (scrollRef.current) scrollRef.current.scrollTop = homeScroll.current;
      const el = opener.current;
      opener.current = null;
      if (el && el.isConnected) { try { el.focus({ preventScroll: true }); } catch { /* ignore */ } }
    }
    prevPage.current = page;
  }, [page]);

  // Opening a page from inside the panel: focus its back button once the chunk
  // has drawn it. A page that came from the URL at load, or from Back/Forward,
  // leaves focus alone (no ring on a cold deep link).
  useEffect(() => {
    if (!page) return undefined;
    if (!focusBack.current) return undefined;
    focusBack.current = false;
    let tries = 0;
    let raf = 0;
    const look = () => {
      const bk = pageRef.current?.querySelector('.ap-bk');
      if (bk) { bk.focus({ preventScroll: true }); return; }
      if (tries++ < 60) raf = requestAnimationFrame(look);
    };
    raf = requestAnimationFrame(look);
    return () => cancelAnimationFrame(raf);
  }, [page]);

  // Every 5 minutes while open; on coming back after a minute away.
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current >= EVERY) auto();
    }, 30000);
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 60000) auto();
      setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
  }, [auto]);

  // Pull down at the top to refresh.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let y0 = null;
    let armed = false;
    const start = (e) => { y0 = el.scrollTop <= 0 ? e.touches[0].clientY : null; armed = false; };
    const move = (e) => {
      if (y0 == null) return;
      armed = e.touches[0].clientY - y0 > 70;
      setPulling(armed);
    };
    const end = () => { if (armed) forced(); y0 = null; armed = false; setPulling(false); };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
    };
  }, [forced, tab]);

  const onLoaded = useCallback((good) => {
    setOk(!!good);
    if (good) setUpdatedAt(Date.now());
    setNow(Date.now());
    // The first wave is in: fetch the pages' chunk while nobody is waiting on it.
    if (good && !warmed.current) {
      warmed.current = true;
      setTimeout(() => { import('./PhonePages.jsx').catch(() => {}); }, 1500);
    }
  }, []);

  const onToday = tab === 'today';
  return (
    <div className="ap">
      <div className="ap-scroll" ref={scrollRef}>
        <div className={`ap-pull${pulling ? ' is-on' : ''}`} aria-hidden="true">Let go to refresh</div>
        <div className="ap-top" hidden={onToday && !!page}>
          <div className="ap-mark">SOLEIL<small>{SUB[tab]}</small></div>
          {tab !== 'boards' && (
            <button type="button" className="ap-upd" onClick={forced} aria-label="Refresh">
              <i className={ok ? '' : 'is-off'} />{ok ? updatedText(updatedAt, now) : 'Couldn’t refresh · tap to retry'}
            </button>
          )}
        </div>
        {/* The home stays mounted while a page is open, so it keeps its data and state. */}
        {onToday && (
          <div hidden={!!page}>
            <PhoneToday
              refresh={refresh}
              now={now}
              onLoaded={onLoaded}
              onRetry={forced}
              onBoards={() => select('boards')}
              onOpen={openPage}
              onSheet={openSheet}
            />
          </div>
        )}
        {onToday && page && (
          <div ref={pageRef}>
            <Suspense fallback={<div className="ap-skel ap-skel-chart" aria-busy="true" />}>
              <PhonePage key={page} id={page} refresh={refresh} now={now} onBack={closePage} onSheet={openSheet} onRetry={forced} />
            </Suspense>
          </div>
        )}
        {/* Posts stays mounted once opened so its slides and badge survive a tab switch. */}
        <div hidden={tab !== 'posts'}>
          <PhonePosts refreshKey={refresh.n} api={postsApi} onBadge={setBadge} onLoaded={tab === 'posts' ? onLoaded : undefined} />
        </div>
        {tab === 'boards' && <div className="ap-boards">{boards}</div>}
      </div>
      <nav className="ap-tabs" aria-label="Admin and Clusters">
        <div className="ap-tablist" role="tablist" aria-label="Admin">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="ap-tab" aria-selected={tab === t.id} onClick={() => select(t.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{t.icon}</svg>
              {t.label}
              {t.id === 'posts' && badge > 0 && <span className="ap-badge" aria-label={`${badge} not posted yet`}>{badge}</span>}
            </button>
          ))}
        </div>
        {/* Back to the app itself (the owner, 2026-11-03: "be able to go back
            to normal clusters so it's like a full clusters app"). Its menu's
            Admin button comes back here. */}
        <a className="ap-tab ap-home" href="/">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" /></svg>
          Clusters
        </a>
      </nav>
      {onToday && sheet && <PhoneSheet id={sheet} refresh={refresh} onClose={closeSheet} />}
    </div>
  );
}
