// AdminPhonePanel.jsx — /admin on a phone (the owner, 2026-11-01: "make our
// tiktok posts downloaded thing into like a mobile admin panel where it's
// really easy to keep up with and see stats for clusters").
//
// Three tabs: Today (lib/phonePanel.js over the admin's own reads), Posts (the
// TikTok posts page, through /api/admin/posts/) and Boards (the existing phone
// Boards tab, passed in). ?tab=posts / ?tab=boards opens one; ?full=1 skips
// the panel for the desktop admin. Refreshes on open, on coming back to the
// app, every 5 minutes while open, and on a pull down. While it is mounted the
// manifest is /admin.webmanifest, so Add to Home Screen opens straight here.
import { useCallback, useEffect, useRef, useState } from 'react';
import './adminPhone.css';
import { PhoneToday } from './PhoneToday.jsx';
import { PhonePosts } from './PhonePosts.jsx';

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
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [ok, setOk] = useState(true);
  const [badge, setBadge] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [pulling, setPulling] = useState(false);
  const scrollRef = useRef(null);
  const lastRefresh = useRef(Date.now());
  useAdminManifest();

  const refresh = useCallback(() => {
    lastRefresh.current = Date.now();
    setRefreshKey((k) => k + 1);
  }, []);

  const select = (id) => {
    setTab(id);
    try {
      const url = new URL(window.location.href);
      if (id === 'today') url.searchParams.delete('tab'); else url.searchParams.set('tab', id);
      window.history.replaceState({}, '', url);
    } catch { /* ignore */ }
    scrollRef.current?.scrollTo?.(0, 0);
  };

  // Every 5 minutes while open; on coming back after a minute away.
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current >= EVERY) refresh();
    }, 30000);
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > 60000) refresh();
      setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);

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
    const end = () => { if (armed) refresh(); y0 = null; armed = false; setPulling(false); };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
    };
  }, [refresh, tab]);

  const onLoaded = useCallback((good) => { setOk(!!good); if (good) setUpdatedAt(Date.now()); setNow(Date.now()); }, []);

  return (
    <div className="ap">
      <div className="ap-scroll" ref={scrollRef}>
        <div className={`ap-pull${pulling ? ' is-on' : ''}`} aria-hidden="true">Let go to refresh</div>
        <div className="ap-top">
          <div className="ap-mark">SOLEIL<small>{SUB[tab]}</small></div>
          {tab !== 'boards' && (
            <button type="button" className="ap-upd" onClick={refresh} aria-label="Refresh">
              <i className={ok ? '' : 'is-off'} />{ok ? updatedText(updatedAt, now) : 'Couldn’t refresh · tap to retry'}
            </button>
          )}
        </div>
        {tab === 'today' && <PhoneToday refreshKey={refreshKey} onLoaded={onLoaded} onRetry={refresh} onBoards={() => select('boards')} />}
        {/* Posts stays mounted once opened so its slides and badge survive a tab switch. */}
        <div hidden={tab !== 'posts'}>
          <PhonePosts refreshKey={refreshKey} api={postsApi} onBadge={setBadge} onLoaded={tab === 'posts' ? onLoaded : undefined} />
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
    </div>
  );
}
