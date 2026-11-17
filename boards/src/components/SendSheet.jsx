// The Send to… sheet: pick people, groups or an email, add a note, and a card
// (or several, or a whole cluster) goes to their chat as a preview card. A
// 440px dialog on a desktop, a bottom sheet under a finger (sendSheet.css).
//
// Opened by SendHost from the bus (lib/sendBus.js). Sending gives view access
// to anyone who can't open the cluster yet when the sender may let people in;
// the line by Send says so before it happens (sendToStatus, asked again as the
// picks change). The server finds or makes each conversation (sendBoardTo);
// the messages themselves are posted from here, as MessageThread posts them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import { Icon } from './Icon.jsx';
import { R2Image } from './R2Image.jsx';
import { PersonFace } from './PersonFace.jsx';
import { useFeedback } from './AppFeedback.jsx';
import { Check, Envelope, Eye, EyeOff, Search, X } from '../lib/icons.js';
import {
  listConversations, listMyConversationParticipants, listMessageableUsers, sendMessage,
} from '../lib/messages.js';
import { broadcastConversationMessage } from '../lib/messageRealtime.js';
import { newMessageId } from '../lib/messageStore.js';
import * as userProfiles from '../lib/userProfiles.js';
import { namesList } from '../lib/intlFormat.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { initialOf } from '../lib/graphemes.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { SEND_MAX_PEOPLE } from '../lib/sendBus.js';
import { kindWord, unitMeta } from '../lib/messageThing.js';
import {
  recipientsFrom, isEmailish, rowMatches, accessLine, tallySend, afterSendNotes, sentWords, storageKey,
  sendToStatus, sendBoardTo, cardAttachments, clusterAttachment, clusterSnap, cardSnap,
} from '../lib/sendTo.js';
import './sendSheet.css';
import { t, plural } from '@lingui/core/macro';

const STATUS_DEBOUNCE_MS = 150;
const NOTE_MAX = 1000;

const errCode = (e) => {
  const c = e?.code ?? e?.status;
  return c == null || c === '' ? null : String(c).slice(0, 16);
};

// What is being sent, as the "what" row shows it: { title, meta, key, text }.
// workspaceName is '' when the cluster's workspace isn't known to be the open one.
function whatOf({ cards, boardTitle, workspaceName, cover }) {
  if (!cards.length) {
    return { title: boardTitle, meta: unitMeta({ cluster: true, snap: { ws: workspaceName } }), key: storageKey(cover), text: '' };
  }
  const first = cardAttachments({ boardId: '', boardTitle, cards: cards.slice(0, 1), cover: null })[0];
  const snap = first.snap || cardSnap(cards[0]);
  const n = cards.length;
  const title = first.title || String(snap.heading || '').trim() || kindWord(snap.k);
  // The same words the chat card shows under its name.
  const meta = unitMeta({ cluster: false, several: n > 1, count: n, kind: snap.k, snap, boardTitle });
  return { title, meta, key: snap.key || null, text: snap.k === 'note' || snap.k === 'text' ? (snap.text || '') : '' };
}

export function SendSheet({
  boardId, boardTitle: titleProp = '', cards = [], surface = null,
  workspaceId, workspaceName = '', userId, userEmail = null, boardInfo, onOpenConversation, onClose,
}) {
  const feedback = useFeedback();
  const info = typeof boardInfo === 'function' ? boardInfo(boardId) : null;
  const boardTitle = titleProp || info?.name || '';
  const cover = info?.coverKey || null;
  // The open workspace's name belongs to the cluster only when it lives there;
  // one shared with you from another workspace has no name we know.
  const clusterWsName = info?.workspaceId && info.workspaceId === workspaceId ? workspaceName : '';
  const what = useMemo(
    () => whatOf({ cards, boardTitle, workspaceName: clusterWsName, cover }),
    [cards, boardTitle, clusterWsName, cover],
  );

  const [loaded, setLoaded] = useState(false);
  const [convs, setConvs] = useState([]);
  const [parts, setParts] = useState([]);
  const [people, setPeople] = useState([]);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  // key → row, in pick order. Keys: 'c:<conversation>', 'u:<user>', 'e:<email>'.
  const [picks, setPicks] = useState(() => new Map());
  const [status, setStatus] = useState(null); // { canGrant, closed:Set } | null
  const [sending, setSending] = useState(false);
  const [tick, bump] = useState(0);

  const searchRef = useRef(null);
  const noteRef = useRef(null);
  const listRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => userProfiles.subscribe(() => bump((n) => (n + 1) | 0)), []);

  // The three reads, once, when the sheet opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, p, u] = await Promise.all([
        listConversations({ workspaceId }),
        listMyConversationParticipants({ workspaceId }),
        listMessageableUsers({ workspaceId }),
      ]);
      if (cancelled) return;
      if (c) setConvs(c);
      if (p) {
        setParts(p);
        for (const r of p) if (r.user_id !== userId) userProfiles.resolve(r.user_id);
      }
      setPeople(u || []);
      setLoaded(true);
    })().catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [workspaceId, userId]);

  const profileOf = useCallback((id) => userProfiles.get(id), []);
  const nameOf = useCallback((id) => {
    const u = people.find((x) => x.user_id === id);
    const p = userProfiles.get(id);
    return u?.name || p?.name || u?.email || p?.email || t`Member`;
  }, [people]);

  const { recent, people: others } = useMemo(
    () => recipientsFrom({ conversations: convs, participants: parts, people, me: userId, profileOf }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convs, parts, people, userId, profileOf, tick],
  );

  const q = query.trim();
  const shownRecent = useMemo(() => recent.filter((r) => rowMatches(r, q)), [recent, q]);
  const shownPeople = useMemo(() => others.filter((r) => rowMatches(r, q)), [others, q]);
  const keyOf = (r) => (r.type === 'person' ? `u:${r.userId}` : r.type === 'email' ? `e:${r.email}` : `c:${r.conversationId}`);

  // A typed address that no listed row has exactly gets its own row, first. Addresses
  // already picked stay in the list, so they can be taken back.
  const canInvite = status ? status.canGrant : true;
  const emailRows = useMemo(() => {
    const rows = [...picks.values()].filter((r) => r.type === 'email');
    const typed = q.toLowerCase();
    const listed = (r) => String(r.email || '').toLowerCase() === typed;
    if (isEmailish(typed) && !picks.has(`e:${typed}`) && !shownRecent.some(listed) && !shownPeople.some(listed)) {
      rows.unshift({ type: 'email', email: typed, name: typed });
    }
    return rows;
  }, [picks, q, shownRecent, shownPeople]);

  const rows = useMemo(() => [
    ...emailRows.map((r) => ({ section: 'email', row: r })),
    ...shownRecent.map((r) => ({ section: 'recent', row: r })),
    ...shownPeople.map((r) => ({ section: 'people', row: r })),
  ], [emailRows, shownRecent, shownPeople]);

  const toggle = useCallback((row) => {
    if (row.type === 'email' && !canInvite && !picks.has(keyOf(row))) return;
    // The server takes this many people, groups and addresses at once.
    if (!picks.has(keyOf(row)) && picks.size >= SEND_MAX_PEOPLE) {
      const max = SEND_MAX_PEOPLE;
      feedback.toast({ type: 'info', message: t`You can send to up to ${max} at a time.` });
      return;
    }
    setPicks((m) => {
      const next = new Map(m);
      const k = keyOf(row);
      if (next.has(k)) next.delete(k); else next.set(k, row);
      return next;
    });
    if (row.type === 'email') setQuery('');
  }, [canInvite, picks, feedback]);

  // Who is picked, split the way the server takes them.
  const picked = useMemo(() => {
    const all = [...picks.values()];
    return {
      all,
      userIds: all.filter((r) => r.type === 'person').map((r) => r.userId),
      emails: all.filter((r) => r.type === 'email').map((r) => r.email),
      conversationIds: all.filter((r) => r.type === 'dm' || r.type === 'group').map((r) => r.conversationId),
    };
  }, [picks]);

  // Who among the picked can't open the cluster yet: on open, and again
  // shortly after the picks change. An older answer never overwrites a newer.
  const statusSeq = useRef(0);
  const pickedKey = `${picked.userIds.join(',')}|${picked.conversationIds.join(',')}`;
  useEffect(() => {
    const seq = ++statusSeq.current;
    const timer = setTimeout(async () => {
      const s = await sendToStatus({ boardId, userIds: picked.userIds, conversationIds: picked.conversationIds });
      if (mounted.current && seq === statusSeq.current && s) setStatus(s);
    }, STATUS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, pickedKey]);

  // The picked people the cluster is still closed to, by name.
  const closedIds = useMemo(() => {
    const ids = new Set();
    if (!status) return ids;
    for (const r of picked.all) {
      if (r.type === 'person' || r.type === 'dm') { if (status.closed.has(r.userId)) ids.add(r.userId); }
      else if (r.type === 'group') for (const m of r.memberIds || []) if (status.closed.has(m)) ids.add(m);
    }
    return ids;
  }, [status, picked]);
  const closedNames = useMemo(() => [...closedIds].map(nameOf), [closedIds, nameOf]);
  const line = status
    ? accessLine({ canGrant: status.canGrant, closedNames, emails: picked.emails, boardTitle })
    : null;

  // The quiet line under a picked row that can't open the cluster yet.
  const subOf = (r) => {
    const k = keyOf(r);
    if (r.type === 'email') {
      return canInvite
        ? t`Gets it in Messages, or an email invite if they're new`
        : t`Only people who can edit ${boardTitle} can send it to a new email.`;
    }
    if (picks.has(k) && status) {
      if (r.type === 'group') {
        const n = (r.memberIds || []).filter((m) => status.closed.has(m)).length;
        if (n) return plural(n, { one: "# can't open it yet", other: "# can't open it yet" });
      } else if (status.closed.has(r.userId)) {
        return t`Can't open ${boardTitle} yet`;
      }
    }
    if (r.type === 'person') return r.email || '';
    if (r.type === 'dm') return r.email || '';
    return '';
  };

  const send = useCallback(async () => {
    if (sending || !picked.all.length) return;
    setSending(true);
    const what_ = cards.length === 0 ? 'cluster' : cards.length === 1 ? 'card' : 'cards';
    const shape = {
      what: what_, surface,
      n_people: picked.all.filter((r) => r.type === 'person' || r.type === 'dm').length,
      n_groups: picked.all.filter((r) => r.type === 'group').length,
      n_emails: picked.emails.length,
    };
    let result;
    try {
      result = await sendBoardTo({
        boardId, workspaceId,
        userIds: picked.userIds, emails: picked.emails, conversationIds: picked.conversationIds,
      });
    } catch (e) {
      console.warn('send_board_to failed', e);
      logEvent(EV.SEND_TO, { ...shape, n_granted: 0, n_invited: 0, n_closed: 0, n_refused: 0, ok: false, code: errCode(e) });
      feedback.toast({ type: 'error', code: 'send_to_failed', message: t`Couldn't send. Try again.` });
      if (mounted.current) setSending(false);
      return;
    }
    const tally = tallySend(result);
    const targets = Array.isArray(result?.targets) ? result.targets : [];

    let attachments = [];
    let attachError = null;
    try {
      attachments = cards.length
        ? cardAttachments({ boardId, boardTitle, cards, cover })
        : [clusterAttachment({ boardId, title: boardTitle, snap: await clusterSnap({ boardId, workspaceName: clusterWsName }) })];
    } catch (e) { attachError = e; }

    // Names for the toast: what each conversation is called to the sender.
    const nameByConv = new Map();
    for (const r of picked.all) if (r.conversationId) nameByConv.set(r.conversationId, r.name);
    for (const p of result?.people || []) {
      if (!p.conversation_id || nameByConv.has(p.conversation_id)) continue;
      const hit = picked.all.find((r) => (p.user_id && r.userId === p.user_id) || (p.email && r.email === p.email));
      if (hit) nameByConv.set(p.conversation_id, hit.name);
    }

    const posted = [];
    if (!attachError) {
      const text = note.trim();
      await Promise.all(targets.map(async (conversationId) => {
        try {
          const id = newMessageId();
          const saved = await sendMessage({
            id, workspaceId, conversationId,
            senderId: userId, senderEmail: userEmail,
            body: text, attachments,
          });
          posted.push(conversationId);
          broadcastConversationMessage({ conversationId, payload: { id: saved?.id || id, sender_id: userId } })
            .then(null, (e) => console.warn('send broadcast failed', e));
        } catch (e) {
          console.warn('send message failed', e);
        }
      }));
    }

    const ok = !attachError && (posted.length > 0 || (targets.length === 0 && tally.invited > 0));
    const notes = afterSendNotes(tally, { nameOf, posted: posted.length });
    // Nothing went anywhere because the server turned every pick away: say why.
    const refusedAll = !ok && !attachError && targets.length === 0 && notes.length > 0;
    logEvent(EV.SEND_TO, {
      ...shape, n_granted: tally.granted, n_invited: tally.invited, n_closed: tally.closed, n_refused: tally.refused,
      ok, ...(ok ? {} : { code: refusedAll ? 'refused' : (errCode(attachError) || 'post_failed') }),
    });
    if (!ok) {
      if (refusedAll) {
        for (const message of notes) feedback.toast({ type: 'warning', code: 'send_to_refused', message });
      } else {
        feedback.toast({ type: 'error', code: 'send_to_failed', message: t`Couldn't send. Try again.` });
      }
      if (mounted.current) setSending(false);
      return;
    }

    onClose?.();
    const names = posted.map((id) => nameByConv.get(id)).filter(Boolean);
    if (posted.length) {
      const one = posted.length === 1 ? posted[0] : null;
      feedback.toast({
        type: 'success', message: sentWords(names),
        ...(one && onOpenConversation ? { action: { label: t`Open chat`, onClick: () => onOpenConversation(one) } } : {}),
      });
    } else {
      const list = namesList(tally.invitedEmails);
      feedback.toast({ type: 'success', message: t`Invited ${list}` });
    }
    if (posted.length < targets.length) {
      const failed = targets.filter((id) => !posted.includes(id)).map((id) => nameByConv.get(id)).filter(Boolean);
      const list = namesList(failed);
      feedback.toast({
        type: 'error', code: 'send_to_failed',
        message: failed.length ? t`Couldn't send to ${list}. Try again.` : t`Couldn't send. Try again.`,
      });
    }

    // One short line for each thing that did not go the usual way.
    for (const message of notes) feedback.toast({ type: 'info', message });
  }, [sending, picked, cards, surface, boardId, workspaceId, boardTitle, clusterWsName, cover, note,
    userId, userEmail, feedback, onClose, onOpenConversation, nameOf]);

  // Up and down walk the search field and the rows; Enter in the search picks
  // the first match; Cmd/Ctrl+Enter sends. A row is a button, so Enter and Space
  // toggle it as they would any checkbox.
  const onKeyDown = (e) => {
    if (isComposingKey(e)) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return; }
    const el = e.target;
    // The note is one line: Enter sends, as the phone keyboard's Send key says.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && el === noteRef.current) { e.preventDefault(); send(); return; }
    if (e.key === 'Enter' && el === searchRef.current && q) {
      const first = rows.find((x) => !(x.row.type === 'email' && !canInvite && !picks.has(keyOf(x.row))));
      if (first) { e.preventDefault(); toggle(first.row); }
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const stops = [searchRef.current, ...(listRef.current?.querySelectorAll('[role="checkbox"]:not([aria-disabled="true"])') || [])].filter(Boolean);
    const at = stops.indexOf(el);
    if (at < 0) return;
    e.preventDefault();
    const to = stops[Math.max(0, Math.min(stops.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    to?.focus();
  };

  const n = picked.all.length;
  const sendLabel = n === 0 ? t`Send` : plural(n, { one: 'Send', other: 'Send to #' });
  const titleId = 'snd-title';

  const section = (key, caption) => {
    const list = rows.filter((x) => x.section === key);
    if (!list.length) return null;
    return (
      <div className="snd-section" key={key} role="group" aria-label={caption || undefined}>
        {caption && <div className="snd-cap">{caption}</div>}
        {list.map(({ row }) => {
          const k = keyOf(row);
          const on = picks.has(k);
          const disabled = row.type === 'email' && !canInvite && !on;
          const sub = subOf(row);
          return (
            <button
              key={k} type="button" role="checkbox" aria-checked={on} aria-disabled={disabled || undefined}
              className={`snd-row${on ? ' is-on' : ''}${disabled ? ' is-off' : ''}`}
              onClick={() => toggle(row)}
            >
              <Faces row={row} />
              <span className="snd-tx">
                <span className="snd-nm" dir="auto">{row.name}</span>
                {sub && <span className="snd-sub" dir="auto">{sub}</span>}
              </span>
              <span className="snd-ck" aria-hidden="true"><Icon as={Check} size={13} weight="bold" /></span>
            </button>
          );
        })}
      </div>
    );
  };

  const noMatch = loaded && q && !rows.length;
  return (
    <Modal
      open
      onClose={onClose}
      className="snd-modal"
      backdropClassName="snd-backdrop"
      labelledBy={titleId}
      initialFocusRef={searchRef}
    >
      <div className="snd-grab" aria-hidden="true" />
      <div className="snd-head">
        <h2 id={titleId} className="snd-title">{t`Send to…`}</h2>
        <button type="button" className="snd-x" aria-label={t`Close`} onClick={() => onClose?.()}>
          <Icon as={X} size={16} />
        </button>
      </div>
      {/* The keys are handled here so arrows work from the search and every row. */}
      <div className="snd-body" onKeyDown={onKeyDown}>
        <div className="snd-what">
          <span className="snd-th">
            {what.key
              ? <R2Image src={`r2:${what.key}`} alt="" className="snd-th-img" eager />
              : what.text ? <span className="snd-th-note" aria-hidden="true">{what.text.slice(0, 80)}</span> : null}
          </span>
          <span className="snd-tx">
            <span className="snd-wnm" dir="auto">{what.title}</span>
            <span className="snd-wmt" dir="auto">{what.meta}</span>
          </span>
        </div>

        <label className="snd-find">
          <Icon as={Search} size={15} />
          <input
            ref={searchRef} type="text" className="snd-input" value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t`Name or email`} aria-label={t`Name or email`}
            autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            enterKeyHint="search"
          />
        </label>

        <div className="snd-list" ref={listRef}>
          {section('email', null)}
          {section('recent', t`Recent`)}
          {section('people', t`People`)}
          {!loaded && <div className="snd-empty" role="status">{t`Loading…`}</div>}
          {noMatch && <div className="snd-empty" role="status">{t`No one matches. Type a full email address to send it by email.`}</div>}
        </div>
      </div>

      <div className="snd-foot">
        <input
          ref={noteRef} type="text" className="snd-note" value={note} maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)} onKeyDown={onKeyDown}
          placeholder={t`Add a note (optional)`} aria-label={t`Add a note (optional)`}
          autoComplete="off" enterKeyHint="send"
        />
        <div className="snd-go">
          <p className="snd-access" role="status" aria-live="polite">
            {line && (
              <>
                <span className="snd-access-ic" aria-hidden="true">
                  <Icon as={status?.canGrant ? Eye : EyeOff} size={14} />
                </span>
                <span>{line}</span>
              </>
            )}
          </p>
          <button type="button" className="snd-send" disabled={!n || sending} onClick={send}>
            {sendLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Avatar(s) at the left of a row: a face, two stacked for a group, an envelope
// for an address.
function Faces({ row }) {
  if (row.type === 'email') {
    return <span className="snd-mail" aria-hidden="true"><Icon as={Envelope} size={15} /></span>;
  }
  if (row.type === 'group') {
    const ids = (row.memberIds || []).slice(0, 2);
    return (
      <span className="snd-av is-stack" aria-hidden="true">
        {ids.map((id) => {
          const p = userProfiles.get(id);
          const name = p?.name || p?.email || '';
          return <PersonFace key={id} userId={id} name={name} color={p?.color || row.color} initial={initialOf(name, 'M')} className="snd-face" ariaHidden />;
        })}
      </span>
    );
  }
  return (
    <span className="snd-av" aria-hidden="true">
      <PersonFace userId={row.userId} name={row.name} color={row.color} initial={initialOf(row.name, 'M')} className="snd-face" ariaHidden />
    </span>
  );
}
