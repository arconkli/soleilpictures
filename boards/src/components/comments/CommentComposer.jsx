import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { ArrowUp } from '../../lib/icons.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { filterMentionPeople, mentionQueryAt, mentionQuerySpaces, mentionsIn } from '../../lib/commentMentionText.js';
import { readCommentDraft, writeCommentDraft, clearCommentDraft, pruneCommentDrafts } from '../../lib/commentDraft.js';
import { CommentFace } from './CommentFace.jsx';
import { CommentPop } from './CommentPop.jsx';
import { t as tr, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import './commentsLook.css';

const MAX_LINES = 8;
const DRAFT_WAIT_MS = 300;
// Drafts past two weeks are dropped once per page load, when the first box mounts.
let pruned = false;

// The box a comment is written in: a new one, a reply, or a change to your
// own. Enter sends, Shift+Enter makes a line. "@" lists the people who can
// see the thing, above the box. Unsent words are kept under draftKey and are
// back when the box opens again.
//
//   draftKey         where unsent words are kept (lib/commentDraft.js); none = not kept
//   initialValue     the words to start from (edit mode: the comment as it stands)
//   initialMentions  [{ id, name }] already in those words
//   people           [{ id, name, avatar, color, role }] who "@" can find
//   placeholder      the hint in the empty box
//   submitLabel      the send button's name ("Send"; "Save" in edit mode)
//   mode             'new' | 'reply' | 'edit'
//   busy             the surface is sending: the button waits
//   autoFocus        take the caret on mount
//   maxLength        the most characters the surface takes; "n left" shows near it
//   onSubmit({ body, mentions })  may return a promise; what was sent leaves the
//                    box only once it resolves (words typed meanwhile stay), and
//                    the box keeps the words and says so if it rejects
//   onCancel()       Esc with nothing to lose, Cancel, or after Discard
//   onDirtyChange(bool)  there are words that would be lost
export function CommentComposer({
  draftKey = null,
  initialValue = '',
  initialMentions = null,
  people = null,
  placeholder = '',
  submitLabel = null,
  mode = 'reply',
  busy = false,
  autoFocus = false,
  maxLength = null,
  onSubmit,
  onCancel,
  onDirtyChange,
}) {
  const edit = mode === 'edit';
  const start = useRef(null);
  if (start.current === null) {
    if (!pruned) { pruned = true; pruneCommentDrafts(); }
    const kept = draftKey ? readCommentDraft(draftKey) : null;
    start.current = kept
      ? { body: kept.body, mentions: [...(initialMentions || []), ...kept.mentions] }
      : { body: String(initialValue ?? ''), mentions: [...(initialMentions || [])] };
  }
  const [value, setValue] = useState(start.current.body);
  const [picked, setPicked] = useState(start.current.mentions);
  const [pick, setPick] = useState(null);          // { tokenStart, query, index } while the @ list is open
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const keepRef = useRef(null);
  const live = useRef({ value, picked });
  live.current = { value, picked };
  const saved = useRef(false);     // an edit that went through: nothing left to keep
  const inFlight = useRef(false);  // a send is on its way: its words are not a draft
  const alive = useRef(true);
  const caretNext = useRef(null);  // where the caret goes once the sent words have left the box
  const listId = useId();
  const askId = useId();

  const original = String(initialValue ?? '');
  const hasPeople = !!(people && people.length);
  const hasText = value.trim().length > 0;
  const dirty = edit ? value !== original : hasText;
  const canSend = hasText && !sending && !busy && (!edit || value.trim() !== original.trim());
  const matches = pick ? filterMentionPeople(people, pick.query, 6) : [];
  const listOpen = !!pick && matches.length > 0;
  const index = listOpen ? Math.min(pick.index, matches.length - 1) : 0;
  const max = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : null;
  const left = max != null && value.length >= max * 0.9 ? Math.max(0, max - value.length) : null;

  // grow with the words, one line to eight
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    el.style.height = `${Math.min(el.scrollHeight, Math.ceil(line * MAX_LINES + pad))}px`;
    // with the new words in place, before another key can land
    if (caretNext.current != null) {
      const at = Math.min(caretNext.current, el.value.length);
      caretNext.current = null;
      try { el.setSelectionRange(at, at); } catch (_) {}
    }
  }, [value]);

  const dirtyCb = useRef(onDirtyChange);
  dirtyCb.current = onDirtyChange;
  useEffect(() => { dirtyCb.current?.(dirty); }, [dirty]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; dirtyCb.current?.(false); };
  }, []);

  // keep unsent words: a moment after the last key, and at once on the way out
  const keep = useCallback(() => {
    if (!draftKey) return;
    const { value: v, picked: p } = live.current;
    if (saved.current || !v.trim() || (edit && v === original)) clearCommentDraft(draftKey);
    else writeCommentDraft(draftKey, { body: v, mentions: mentionsIn(v, p) });
  }, [draftKey, edit, original]);
  useEffect(() => {
    if (!draftKey) return undefined;
    const t = setTimeout(keep, DRAFT_WAIT_MS);
    return () => clearTimeout(t);
  }, [value, draftKey, keep]);
  useEffect(() => {
    if (!draftKey) return undefined;
    window.addEventListener('pagehide', keep);
    // Words on their way are not a draft: closing the box mid-send must not
    // bring them back next time. send() settles the draft once it knows.
    return () => { window.removeEventListener('pagehide', keep); if (!inFlight.current) keep(); };
  }, [draftKey, keep]);

  const syncPick = (text, caret) => {
    const q = hasPeople
      ? mentionQueryAt(text, caret, { spaces: mentionQuerySpaces(people), picked: live.current.picked })
      : null;
    setPick((p) => (q ? { tokenStart: q.tokenStart, query: q.query, index: p && p.query === q.query ? p.index : 0 } : null));
  };

  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch (_) {}
    syncPick(el.value, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the question takes the caret, on the answer that loses nothing
  useEffect(() => {
    if (confirm) keepRef.current?.focus({ preventScroll: true });
  }, [confirm]);

  const choose = (person) => {
    const el = inputRef.current;
    const caret = el ? el.selectionStart : value.length;
    const insert = `@${person.name} `;
    const next = value.slice(0, pick.tokenStart) + insert + value.slice(caret);
    const at = pick.tokenStart + insert.length;
    setValue(next);
    setPicked((list) => (list.some((m) => m.id === person.id) ? list : [...list, { id: person.id, name: person.name }]));
    setPick(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(at, at); } catch (_) {}
    });
  };

  const send = async () => {
    if (!canSend) return;
    const raw = value;
    const body = raw.trim();
    const mentions = mentionsIn(body, picked);
    setError('');
    setConfirm(false);
    setPick(null);
    setSending(true);
    inFlight.current = true;
    try {
      await onSubmit?.({ body, mentions });
    } catch (_) {
      inFlight.current = false;
      // the box went away meanwhile: the words go back where they are kept
      if (!alive.current) { keep(); return; }
      setSending(false);
      setError(edit ? tr`Couldn't save. Your words are still here.` : tr`Couldn't send. Your words are still here.`);
      return;
    }
    inFlight.current = false;
    if (edit) {
      saved.current = true;
      if (draftKey) clearCommentDraft(draftKey);
      if (alive.current) setSending(false);
      return;
    }
    // Only what was sent leaves the box. Words typed while it was on its way
    // stay; if the sent words were changed meanwhile, the box is left alone.
    const cur = live.current.value;
    let rest = cur;
    if (cur.trim() === body) rest = '';
    else if (cur.startsWith(raw)) rest = cur.slice(raw.length).replace(/^\s+/, '');
    const restPicked = rest.trim() ? mentionsIn(rest, live.current.picked) : [];
    if (draftKey) {
      if (rest.trim()) writeCommentDraft(draftKey, { body: rest, mentions: restPicked });
      else clearCommentDraft(draftKey);
    }
    if (!alive.current) return;
    setSending(false);
    const el = inputRef.current;
    if (rest !== cur) {
      caretNext.current = el ? Math.max(0, el.selectionStart - (cur.length - rest.length)) : rest.length;
      live.current = { value: rest, picked: restPicked };
      setValue(rest);
      setPicked(restPicked);
    }
    el?.focus({ preventScroll: true });
  };

  const discard = () => {
    if (draftKey) clearCommentDraft(draftKey);
    live.current = { value: edit ? original : '', picked: [] };
    setValue(edit ? original : '');
    setPicked(edit ? [...(initialMentions || [])] : []);
    setConfirm(false);
    setError('');
    onCancel?.();
  };
  const cancel = () => {
    if (dirty && hasText) setConfirm(true);
    else discard();
  };
  const keepWriting = () => {
    setConfirm(false);
    inputRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (e) => {
    if (isComposingKey(e)) return;
    if (listOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setPick((p) => (p ? { ...p, index: (index + step + matches.length) % matches.length } : p));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[index]); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      send();
    }
  };
  // Esc anywhere in the box (the words, Keep writing, Discard, Cancel, Save)
  // follows one rule and never reaches the card: it closes the @ list, then
  // the question, then asks it or leaves.
  const onEscape = (e) => {
    if (e.key !== 'Escape' || isComposingKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (listOpen) setPick(null);
    else if (confirm) keepWriting();
    else cancel();
  };

  const sendName = submitLabel || (edit ? tr`Save` : tr`Send`);
  const ask = edit ? tr`Discard your changes?` : tr`Discard this comment?`;
  return (
    <div className={`cmt-composer cmt-composer--${mode}`} data-cmt-composer={mode} onKeyDown={onEscape}>
      <div
        ref={boxRef}
        className={`cmt-box${edit ? ' is-edit' : ''}`}
        onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}
      >
        <textarea
          ref={inputRef}
          className="cmt-input"
          rows={1}
          value={value}
          maxLength={max ?? undefined}
          placeholder={placeholder}
          aria-label={placeholder || (edit ? tr`Edit comment` : tr`Comment`)}
          role={hasPeople ? 'combobox' : undefined}
          aria-haspopup={hasPeople ? 'listbox' : undefined}
          aria-autocomplete={hasPeople ? 'list' : undefined}
          aria-expanded={hasPeople ? listOpen : undefined}
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={listOpen ? `${listId}-${index}` : undefined}
          enterKeyHint="send"
          autoCapitalize="sentences"
          spellCheck
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError('');
            syncPick(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => { if (document.activeElement === e.target) syncPick(e.target.value, e.target.selectionStart); }}
          onFocus={(e) => { const el = e.target; requestAnimationFrame(() => { if (document.activeElement === el) syncPick(el.value, el.selectionStart); }); }}
          onBlur={() => setPick(null)}
          onKeyDown={onKeyDown}
        />
        {!edit && (
          <button
            type="button"
            className={`cmt-send${canSend ? ' is-ready' : ''}`}
            aria-label={sendName}
            disabled={!canSend}
            aria-busy={sending || busy || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={send}
          >
            <Icon as={ArrowUp} size={16} weight="regular" />
          </button>
        )}
      </div>
      {listOpen && (
        <CommentPop anchor={boxRef.current} place="above-start" gap={6} className="cmt-picker" role="listbox" id={listId} aria-label={tr({ message: 'People', context: 'who an @ in a comment offers' })}>
          {matches.map((p, i) => (
            <div
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === index}
              className={`cmt-pick${i === index ? ' is-on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setPick((s) => (s ? { ...s, index: i } : s))}
              onClick={() => choose(p)}
            >
              <CommentFace name={p.name} userId={p.id} color={p.color} size={20} />
              <span className="cmt-pick-name">{p.name}</span>
              {p.role && <span className="cmt-pick-role">{p.role}</span>}
            </div>
          ))}
        </CommentPop>
      )}
      {left != null && <div className="cmt-left" aria-live="polite">{plural(left, { one: '# left', other: '# left' })}</div>}
      {error && <div className="cmt-err" role="alert">{error}</div>}
      {confirm && (
        <div className="cmt-confirm" role="alertdialog" aria-labelledby={askId}>
          <span id={askId}>{ask}</span>
          <button ref={keepRef} type="button" className="cmt-btn" data-cmt-keep onClick={keepWriting}><Trans>Keep writing</Trans></button>
          <button type="button" className="cmt-btn cmt-btn--ink" data-cmt-discard onClick={discard}><Trans context="put away words written in a comment box">Discard</Trans></button>
        </div>
      )}
      {edit && !confirm && (
        <div className="cmt-editbtns">
          <button type="button" className="cmt-btn" onClick={cancel}><Trans>Cancel</Trans></button>
          <button type="button" className="cmt-btn cmt-btn--ink" disabled={!canSend} aria-busy={sending || busy || undefined} onClick={send}>{sendName}</button>
        </div>
      )}
    </div>
  );
}
