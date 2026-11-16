import { useEffect, useState } from 'react';
// the parts as one set (this dev-only gallery is the one static importer)
import { CommentCard, CommentRow } from '../components/comments/commentParts.js';
import { commentPowers } from '../lib/commentRules.js';
import { threadSummaryLine } from '../lib/commentTime.js';
import { commentDraftKey, writeCommentDraft, clearCommentDraft } from '../lib/commentDraft.js';
import { commentLinkUrl } from '../lib/commentLinkUrl.js';

// Dev-only comments gallery (?commentqa=1): every state of the shared comment
// parts, laid out as the mockup's states sheet (comments, "everywhere") so a
// screenshot can sit beside it. &theme=light|dark picks the theme;
// &part=sheet shows the phone sheet alone. Nothing here talks to the network:
// each card keeps its own thread in memory, so replying, editing, deleting,
// resolving and reopening all work. main.jsx mounts it behind
// import.meta.env.DEV.

const QS = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
const THEME = QS.get('theme') === 'light' ? 'light' : 'dark';
const PART = QS.get('part') || 'all';
const PHOTOS = import.meta.glob('./qa-photos/*.jpg', { eager: true, query: '?url', import: 'default' });
const photo = (n) => PHOTOS[`./qa-photos/${n}.jpg`] || null;

const ME = { id: 'u-you', name: 'Andrew Conklin' };
const PEOPLE = [
  { id: 'u-you', name: 'Andrew Conklin', color: '#e8d48f', role: 'Owner' },
  { id: 'u-mara', name: 'Mara Okafor', color: '#e6a57e', role: 'Editor' },
  { id: 'u-manon', name: 'Manon Leclerc', color: '#e3b4c8', role: 'Viewer' },
  { id: 'u-dev', name: 'Dev Shah', color: '#8fb8de', role: 'Editor' },
  { id: 'u-jun', name: 'Jun Park', color: '#b59ae8', role: 'Editor' },
  { id: 'u-lena', name: 'Lena Ruiz', color: '#9fd3a9', role: 'Viewer' },
];
const WHO = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.now();
const yesterday = (() => { const d = new Date(NOW); d.setDate(d.getDate() - 1); d.setHours(15, 20, 0, 0); return d.getTime(); })();
const daysAgo = (n) => { const d = new Date(NOW); d.setDate(d.getDate() - n); d.setHours(11, 5, 0, 0); return d.getTime(); };

let seq = 0;
const row = (id, by, at, body, over = {}) => ({
  id, authorId: by, authorName: WHO[by]?.name || '', authorAvatar: null, authorColor: WHO[by]?.color || null,
  body, mentions: [], createdAt: at, editedAt: null, deleted: false, ...over,
});
const thread = (id, rows, over = {}) => ({
  id, root: { ...rows[0], id }, replies: rows.slice(1), resolved: false, resolvedBy: null, resolvedAt: null,
  lastActivityAt: rows[rows.length - 1].createdAt, ...over,
});

const THREADS = {
  t1: thread('t1', [
    row('t1', 'u-mara', NOW - 2 * HOUR, 'This is the light for the bar scenes. Can we pull the magenta back a little?'),
    row('a2', 'u-dev', NOW - HOUR, "Yes. I'll grade a version at 80% tonight."),
    row('a3', 'u-jun', NOW - 12 * MIN, "@Andrew Conklin keep the practicals in the back, they're doing most of the work.", { mentions: [{ id: 'u-you', name: 'Andrew Conklin' }] }),
    row('a4', 'u-you', NOW - 20 * 1000, 'Agreed. The red in the sign can stay.', { editedAt: NOW - 5000 }),
  ], { unread: true }),
  t3: thread('t3', [
    row('t3', 'u-jun', NOW - 3 * HOUR, 'Swap the teal for something warmer. It fights the skin tones.'),
    row('b2', 'u-lena', NOW - 2 * HOUR, "Trying a bronze. I'll drop it here."),
  ]),
  t2: thread('t2', [
    row('t2', 'u-dev', yesterday, 'Love the wet ground. Can we find one with someone walking through it?'),
    row('c2', 'u-you', NOW - 5 * MIN, 'Found two, adding them now.'),
  ]),
  t6: thread('t6', [
    row('t6', 'u-mara', daysAgo(3), 'Crop this to 2.39 so it matches the opening.'),
    row('d2', 'u-dev', yesterday, 'Done, and the grade matches the alley now.'),
  ], { resolved: true, resolvedBy: { id: 'u-dev', name: 'Dev' }, resolvedAt: yesterday + 5 * MIN }),
  t7: thread('t7', [
    row('t7', 'u-lena', NOW - 4 * HOUR, 'Is the doorway too dark to read her face?'),
    row('f2', 'u-mara', NOW - 3 * HOUR, 'A little. One more stop would do it.'),
  ]),
  t8: thread('t8', [
    row('t8', null, NOW - 6 * HOUR, '', { deleted: true, authorName: '' }),
    row('g2', 'u-dev', NOW - 5 * HOUR, 'Agreed, the second take is the one.'),
    row('g3', 'u-you', NOW - 30 * MIN, 'Marking it. Sending in a moment.', { pending: true }),
  ]),
  t9: thread('t9', [
    row('t9', 'u-dev', NOW - 2 * HOUR, 'The cut to the alley comes early. Let her finish the walk.'),
    row('h2', 'u-jun', NOW - HOUR, "Agreed, there's a nice beat when she turns."),
  ]),
  t10: thread('t10', [
    row('t10', 'u-dev', NOW - 25 * MIN, 'How low? Knee height, or under the lens?'),
    row('i2', 'u-mara', NOW - 10 * MIN, 'Under the lens. Only in the background.'),
  ], { unread: true }),
  t11: thread('t11', [
    row('t11', 'u-dev', NOW - 25 * MIN, 'How low? Knee height, or under the lens?'),
    row('j2', 'u-mara', NOW - 10 * MIN, 'Under the lens. Only in the background.'),
  ]),
};

const BOARD = '0b0b0b0b-1111-4222-8333-444444444444';
const draftKeyFor = (id) => commentDraftKey({ userId: ME.id, surface: 'qa', scope: 'gallery', targetId: id });

// The words the gallery shows half-written are put where a draft is kept,
// so the real restore path draws them.
const DRAFTS = {
  t3: { body: 'Love it. @Ma' },
  [`t2`]: null,
  new1: { body: 'Can we try this one at dusk?' },
  t7: { body: 'Maybe the wider one' },
  t11: { body: "Got it, I'll tell the smoke team" },
};
const EDIT_DRAFTS = { t2: { row: 'c2', body: 'Found two, adding them now. One has a cyclist.' } };
for (const [id, d] of Object.entries(DRAFTS)) {
  if (d) writeCommentDraft(draftKeyFor(id), d); else clearCommentDraft(draftKeyFor(id));
}
for (const [id, d] of Object.entries(EDIT_DRAFTS)) writeCommentDraft(`${draftKeyFor(id)}.edit.${d.row}`, { body: d.body });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One card with its thread in memory: every button works, nothing is sent.
function Demo({ id, startNew = false, title, thumb, variant = 'float', canWrite = true, slow = false, closable = true, ...rest }) {
  const [t, setT] = useState(startNew ? null : THREADS[id]);
  const [closed, setClosed] = useState(false);
  const [note, setNote] = useState('');
  const say = (s) => { setNote(s); };
  const patchRow = (rid, fn) => setT((cur) => {
    if (!cur) return cur;
    const root = cur.root.id === rid ? fn(cur.root) : cur.root;
    return { ...cur, root, replies: cur.replies.map((r) => (r.id === rid ? fn(r) : r)) };
  });
  const add = ({ body, mentions }) => {
    const r = row(`n${++seq}`, ME.id, Date.now(), body, { mentions });
    setT((cur) => (cur
      ? { ...cur, replies: [...cur.replies, r], resolved: false, resolvedBy: null, resolvedAt: null, lastActivityAt: r.createdAt }
      : thread(`new${seq}`, [r])));
  };
  if (closed) {
    return <button type="button" className="cqa-reopen" onClick={() => setClosed(false)}>Closed. Open again</button>;
  }
  return (
    <>
      <CommentCard
        thread={t}
        me={ME}
        powers={(r) => commentPowers({ me: ME, row: r, thread: t, canRead: true, canWrite })}
        people={PEOPLE}
        title={title}
        thumb={thumb}
        variant={variant}
        draftKey={draftKeyFor(id)}
        onReply={async (next) => { if (slow) await wait(600); add(next); }}
        onStart={async (next) => { if (slow) await wait(600); add(next); }}
        onEdit={(rid, { body, mentions }) => patchRow(rid, (r) => ({ ...r, body, mentions, editedAt: Date.now() }))}
        onDelete={(rid) => { patchRow(rid, (r) => ({ ...r, deleted: true, body: '', authorName: '', authorColor: null })); say('Comment deleted'); }}
        onDeleteThread={() => { setClosed(true); say('Conversation deleted'); }}
        onResolve={async () => { await wait(500); setT((cur) => ({ ...cur, resolved: true, resolvedBy: { id: ME.id, name: 'Andrew' }, resolvedAt: Date.now() })); }}
        onReopen={async () => { await wait(300); setT((cur) => ({ ...cur, resolved: false, resolvedBy: null, resolvedAt: null })); }}
        onCopyLink={(rid) => say(commentLinkUrl(window.location.href, { surface: 'canvas', boardId: BOARD, commentId: BOARD.replace(/^0b0b0b0b/, rid.padEnd(8, '0').slice(0, 8).replace(/[^0-9a-f]/g, 'a')) }) || 'No link')}
        onClose={closable ? () => setClosed(true) : undefined}
        {...rest}
      />
      {note && <div className="cqa-note" data-cqa-note>{note}</div>}
    </>
  );
}

const CSS = `
html, body { margin: 0; background: var(--bg-0); }
.cqa { position: relative; width: 1240px; height: 1300px; margin: 0 auto; color: var(--ink-1); font: 400 13px/1.45 var(--font-sans);
  background-color: var(--bg-0); background-image: radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--ink-0) 9%, transparent) 1px, transparent 1px); background-size: 24px 24px; }
.cqa-cap { position: absolute; font: 600 12px var(--font-sans); color: var(--ink-2); letter-spacing: .01em; white-space: nowrap; }
.cqa-at { position: absolute; }
.cqa-note { margin-top: 8px; max-width: 320px; font: 400 11px/1.4 ui-monospace, monospace; color: var(--ink-3); overflow-wrap: anywhere; }
.cqa-reopen { border: 0; border-radius: 8px; padding: 8px 12px; background: var(--bg-act); color: var(--ink-1); font: 600 12px var(--font-sans); cursor: pointer; }
.cqa-room { width: 368px; padding: 10px 8px; border-radius: 12px; background: #0b0b0d; }
.cqa-open { border-radius: 10px; background: rgba(255,255,255,.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); padding: 8px 0 0; }
.cqa-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 7px; border-radius: 6px; background: #1b1b1f; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); color: #f5f5f7; font: 600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.cqa-panel { width: 352px; padding: 4px 0; border-radius: 12px; background: var(--bg-1); box-shadow: inset 0 0 0 1px var(--line-1); }
.cqa-th { margin: 6px 10px; border-radius: 10px; background: var(--bg-3); box-shadow: inset 0 0 0 1px var(--line-3); padding: 10px 0 2px; }
.cqa-th.is-closed { background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-1); padding: 10px 12px 10px; }
[data-theme='light'] .cqa-th.is-closed { background: #fff; }
.cqa-quote { margin: 0 0 6px; padding: 0 0 0 10px; box-shadow: inset 2px 0 0 var(--line-3); font: italic 13px/1.45 Georgia, 'Times New Roman', serif; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cqa-more { padding: 0 0 0 34px; font-size: 12px; color: var(--ink-3); }
.cqa-phone { position: relative; width: 100%; max-width: 390px; height: 100vh; min-height: 640px; margin: 0 auto; overflow: hidden; background: var(--bg-0); color: var(--ink-1); font: 400 17px/1.55 var(--font-sans); }
.cqa-phone-top { display: flex; align-items: center; gap: 10px; height: 52px; margin-top: 44px; padding: 0 16px; color: var(--ink-0); font: 600 15px var(--font-sans); }
.cqa-phone p { margin: 14px 20px; color: var(--ink-0); }
.cqa-phone mark { background: var(--soleil-soft); color: inherit; box-shadow: inset 0 -1px 0 var(--soleil); }
.cqa-scrim { position: absolute; inset: 0; background: var(--cmt-scrim); }
.cqa-sheet { position: absolute; left: 0; right: 0; bottom: 0; }
.cqa-keys { height: 250px; background: var(--bg-2); display: grid; grid-template-rows: repeat(4, 1fr); gap: 8px; padding: 8px 6px 18px; box-sizing: border-box; }
.cqa-keys div { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; }
.cqa-keys i { border-radius: 6px; background: var(--bg-4); }
`;

function Cap({ x, y, children }) {
  return <span className="cqa-cap" style={{ left: x, top: y }}>{children}</span>;
}
function At({ x, y, w, name, children }) {
  return <div className="cqa-at" data-cqa={name} style={{ left: x, top: y, width: w }}>{children}</div>;
}

function Sheet() {
  return (
    <div className="cqa-phone" data-cqa="phone">
      <div className="cqa-phone-top">‹&nbsp; Look notes</div>
      <p>Shoot wet. Every street gets a water truck pass so the practicals smear into the ground. <mark>Keep the haze low and thin</mark> — it should read as air, not smoke.</p>
      <div className="cqa-scrim" />
      <div className="cqa-sheet" data-cqa="sheet">
        <Demo id="t11" variant="sheet" title="Keep the haze low and thin" />
        <div className="cqa-keys" aria-hidden="true">
          {[10, 10, 9, 5].map((n, i) => <div key={i}>{Array.from({ length: n }, (_, k) => <i key={k} />)}</div>)}
        </div>
      </div>
    </div>
  );
}

// Open the states a still picture needs, by doing what a person would do.
async function pose() {
  const q = (s) => document.querySelector(s);
  const step = () => wait(80);
  if (PART === 'sheet') {
    q('[data-cqa="sheet"] textarea')?.focus();
    return;
  }
  // an edit under way (its unsaved words come back from the draft)
  q('[data-cqa="edit"] [data-cmt-row="c2"] .cmt-ib--edit')?.click();
  await step();
  q('[data-cqa="edit"] .cmt-box.is-edit')?.classList.add('is-focus');
  q('[data-cqa="new"] .cmt-box')?.classList.add('is-focus');
  // Esc with words in the box asks before it throws them away
  const esc = q('[data-cqa="confirm"] textarea');
  esc?.focus();
  esc?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await step();
  // a row's menu, and the whole date over its time
  q('[data-cqa="reading"] [data-cmt-row="a4"] .cmt-ib--more')?.click();
  await step();
  q('[data-cqa="reading"] [data-cmt-row="t1"] time')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await step();
  // last, so it keeps the caret: "@Ma" lists the people
  const at = q('[data-cqa="writing"] textarea');
  if (at) { at.setSelectionRange(at.value.length, at.value.length); at.focus(); }
  await wait(200);
  document.documentElement.dataset.cqaReady = '1';
}

export function CommentQaHarness() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', THEME);
    const t = setTimeout(pose, 250);
    return () => clearTimeout(t);
  }, []);

  if (PART === 'sheet') {
    return (<><style>{CSS}</style><Sheet /></>);
  }
  const closedThread = THREADS.t10;
  return (
    <>
      <style>{CSS}</style>
      <div className="cqa" data-cqa="gallery">
        <Cap x={40} y={30}>Reading · point at a time for the date; your own words get Edit</Cap>
        <At x={40} y={56} name="reading"><Demo id="t1" title="Rosa, neon" thumb={photo('neon')} /></At>

        <Cap x={440} y={30}>Writing · @ lists the people who can see it</Cap>
        <At x={440} y={56} name="writing"><Demo id="t3" title="Night palette" thumb={photo('haze')} /></At>

        <Cap x={840} y={30}>Changing your own comment</Cap>
        <At x={840} y={56} name="edit"><Demo id="t2" title="Alley, neon" thumb={photo('alley')} /></At>

        <Cap x={40} y={560}>Resolved · a reply opens it again</Cap>
        <At x={40} y={586} name="resolved"><Demo id="t6" title="Wet street, 2am" thumb={photo('street')} /></At>

        <Cap x={440} y={560}>A new comment · words you haven’t sent stay if you click away</Cap>
        <At x={440} y={586} name="new"><Demo id="new1" startNew title="Theo, key light" thumb={photo('portrait')} /></At>

        <Cap x={840} y={560}>Esc with words in the box asks first</Cap>
        <At x={840} y={586} name="confirm"><Demo id="t7" title="Doorway" thumb={photo('interior')} /></At>

        <Cap x={40} y={900}>A deleted comment keeps its replies, and no name</Cap>
        <At x={40} y={926} name="deleted"><Demo id="t8" title="Take 2" thumb={photo('still1')} slow /></At>

        <Cap x={440} y={900}>The dark room · a shared file, dark in either theme</Cap>
        <At x={440} y={926} name="dark">
          <div className="cqa-room">
            <div className="cqa-open">
              <Demo id="t9" variant="dark" closable={false} canWrite={false} headerExtra={<span className="cqa-chip">0:42</span>} />
            </div>
          </div>
        </At>

        <Cap x={840} y={900}>In a panel · beside a doc or a note</Cap>
        <At x={840} y={926} name="panel">
          <div className="cqa-panel">
            <div className="cqa-th">
              <Demo id="t10" variant="panel" closable={false} headerExtra={<span className="cqa-quote">Keep the haze low and thin</span>} />
            </div>
            <div className="cqa-th is-closed">
              <div className="cqa-quote">let the neon outside do the work on her face</div>
              <CommentRow row={closedThread.root} />
              <div className="cqa-more">{threadSummaryLine(closedThread, NOW)}</div>
            </div>
          </div>
        </At>
      </div>
    </>
  );
}
