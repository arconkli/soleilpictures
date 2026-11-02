// PhonePosts.jsx — the panel's Posts tab: everything the TikTok posts page does
// (Save all, Copy text, Copy pin, Posted), plus how the last posts did, read
// from the day's "At 72 h: …" note. Files come through the admin-only proxy
// (postsApi.js); Posted goes to the same topic the page uses.
import { useEffect, useMemo, useState } from 'react';
import { postsApi as realApi } from './postsApi.js';
import { parseNote, noteBars, localDate, dayLabel, unpostedCount } from '../../../lib/phonePanel.js';

const KEY = 'admin.posts.posted';
const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]').map(Number); } catch { return []; } };
const writeLocal = (set) => { try { localStorage.setItem(KEY, JSON.stringify([...set].slice(-200))); } catch { /* private mode */ } };

function Slide({ api, date, file, alt }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let live = true;
    api.slide(date, file).then((f) => { if (live) { url = URL.createObjectURL(f); setSrc(url); } }, () => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [api, date, file]);
  return src ? <img src={src} alt={alt} /> : <div className="ph" aria-hidden="true" />;
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ap-btn"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* denied */ }
      }}
    >{done ? 'Copied' : label}</button>
  );
}

function Post({ api, day, post, done, onPosted }) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const files = await Promise.all(post.slides.map((f) => api.slide(day.date, f)));
      if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ files });
      else {
        for (const f of files) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(f); a.download = f.name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }
      }
    } catch (e) {
      if (e?.name !== 'AbortError') window.alert(`Couldn’t open the share sheet: ${e?.message || e}`);
    } finally { setSaving(false); }
  };
  return (
    <div className={`ap-card ap-post${done ? ' is-done' : ''}`} data-testid={`ap-post-${post.n}`}>
      <header><b>#{post.n}</b>{post.postAt && <span className="at">post at {post.postAt}</span>}{post.twin && <span className="at">· twin of #{post.twin}</span>}</header>
      {post.hook && <div className="ap-hook">{post.hook}</div>}
      <div className="ap-strip">
        {post.slides.map((f, i) => <Slide key={f} api={api} date={day.date} file={f} alt={`Slide ${i + 1}`} />)}
      </div>
      <div className="ap-row">
        <button type="button" className="ap-btn is-save" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save all'}</button>
        <CopyButton text={post.caption || ''} label="Copy text" />
        <button type="button" className="ap-btn is-posted" aria-pressed={done} onClick={() => onPosted(post.n, !done)}>
          {done ? 'Posted ✓' : 'Posted'}
        </button>
      </div>
      {post.caption && <p className="ap-caption">{post.caption}</p>}
      {post.pin && (
        <>
          <p className="ap-pin">{post.pin}</p>
          <div className="ap-row"><CopyButton text={post.pin} label="Copy pin" /></div>
        </>
      )}
    </div>
  );
}

function HowTheyDid({ note }) {
  const parsed = parseNote(note);
  if (!note) return null;
  return (
    <>
      <h2>How the last ones did</h2>
      <div className="ap-card ap-did">
        {parsed ? (
          <>
            {noteBars(parsed).map((p) => (
              <div className="r" key={p.n}>
                <b>#{p.n}</b>
                <div className="ap-bar"><i className={p.up ? 'up' : ''} style={{ width: `${Math.round(p.width * 100)}%` }} /></div>
                <span className="v">{p.shown}</span>
                <span className={`x${p.up ? ' up' : ''}`}>{p.ratio}×</span>
              </div>
            ))}
            <small>Views {parsed.hours} h after posting, against your usual post</small>
          </>
        ) : <p>{note}</p>}
      </div>
    </>
  );
}

export function PhonePosts({ refreshKey, api = realApi, onBadge, onLoaded }) {
  const [days, setDays] = useState(null);
  const [error, setError] = useState(null);
  const [posted, setPosted] = useState(() => new Set(readLocal()));
  const [openDay, setOpenDay] = useState(null);

  useEffect(() => {
    let live = true;
    api.days().then(
      (d) => { if (live) { setDays(Array.isArray(d) ? d : []); setError(null); onLoaded?.(true); } },
      (e) => { if (live) { setError(e); onLoaded?.(false); } },
    );
    api.posted().then((list) => {
      if (!live) return;
      setPosted((prev) => { const next = new Set([...prev, ...list.map(Number)]); writeLocal(next); return next; });
    }, () => {});
    return () => { live = false; };
  }, [api, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (days) onBadge?.(unpostedCount(days, posted)); }, [days, posted, onBadge]);

  const onPosted = (n, on) => {
    setPosted((prev) => {
      const next = new Set(prev);
      if (on) next.add(Number(n)); else next.delete(Number(n));
      writeLocal(next);
      return next;
    });
    if (on) api.markPosted(n).catch(() => {});
  };

  const today = localDate();
  const { todayDay, earlier } = useMemo(() => {
    const list = days || [];
    return { todayDay: list.find((d) => d.date === today) || null, earlier: list.filter((d) => d.date !== today) };
  }, [days, today]);

  if (error && !days) {
    return <div className="ap-card ap-err" role="alert">{error.message || 'Couldn’t load the posts.'}</div>;
  }
  if (!days) return <div className="ap-card ap-err" aria-busy="true">Loading…</div>;

  const latestNote = (todayDay || days[0])?.note;
  return (
    <>
      <HowTheyDid note={latestNote} />

      <h2>Today · {dayLabel(today)}</h2>
      {todayDay?.kind && <p className="ap-note">New kind today: {todayDay.kind}</p>}
      {todayDay?.posts?.length
        ? todayDay.posts.map((p) => <Post key={p.n} api={api} day={todayDay} post={p} done={posted.has(Number(p.n))} onPosted={onPosted} />)
        : <div className="ap-card ap-err">No posts today yet.</div>}

      {earlier.length > 0 && <h2>Earlier</h2>}
      {earlier.map((d) => {
        const n = d.posts?.length || 0;
        const k = (d.posts || []).filter((p) => posted.has(Number(p.n))).length;
        const isOpen = openDay === d.date;
        return (
          <div key={d.date}>
            <button type="button" className="ap-card ap-day" aria-expanded={isOpen} onClick={() => setOpenDay(isOpen ? null : d.date)}>
              <b>{dayLabel(d.date)}</b><span>{n} post{n === 1 ? '' : 's'} · {k} posted {isOpen ? '⌄' : '›'}</span>
            </button>
            {isOpen && d.posts.map((p) => <Post key={p.n} api={api} day={d} post={p} done={posted.has(Number(p.n))} onPosted={onPosted} />)}
          </div>
        );
      })}
      <p className="ap-how">To post: Save all → TikTok → + → Photo → pick the newest → paste the text → add a sound → Disclose post content → Your brand.</p>
    </>
  );
}
