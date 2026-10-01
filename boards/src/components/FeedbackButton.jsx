// FeedbackButton — "Send feedback" trigger + modal.
//
// Props:
//   as = 'floating' (default) — frosted pill, position: fixed
//   as = 'icon'                — tb-icon-style inline button
//                                (caller controls placement)
//
// One tap is enough (2026-10-01). The modal used to demand at least two
// characters of prose under one of four broad kinds, so a person with a quick
// "this is slow" had to compose a sentence to say it — and almost nobody did.
// Now a TOPIC alone can be sent; the words are optional. Topics file under the
// established kinds (send-feedback TOPIC_KIND) so every existing reader keeps
// working, and the topic itself is the row's `choice`.
//
// What rides along is SHOWN before it is sent — "Sent with: canvas · 34 cards
// · Free · desktop" — and "OK to email me about this" is an explicit, unticked
// choice. The topic ids and labels are the server's (_feedback_topic_label,
// 0348); feedbackContract.test.mjs compares them.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PaperPlaneTilt, Bug, Lightbulb, Heart, ChatCircle, CheckCircle, Question, Hourglass, Tag } from '@phosphor-icons/react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { buildFeedbackContext, describeFeedbackContext } from '../lib/feedbackContext.js';
import { feedbackEnv } from '../lib/feedbackEnv.js';

const FEEDBACK_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/send-feedback';
const SUPPORT_EMAIL = 'clusters@soleilpictures.com';
const MAX_MESSAGE = 4000;
const TOPICS = [
  { id: 'broke',           label: 'Something broke',   icon: Bug,        hint: 'What happened, and what did you expect? (optional)' },
  { id: 'missing_feature', label: 'Missing a feature', icon: Lightbulb,  hint: 'What would you like it to do? (optional)' },
  { id: 'confusing',       label: 'Confusing',         icon: Question,   hint: 'What was unclear? (optional)' },
  { id: 'slow',            label: 'Slow',              icon: Hourglass,  hint: 'What was slow, and where? (optional)' },
  { id: 'pricing',         label: 'Plans and pricing', icon: Tag,        hint: 'What should we know? (optional)' },
  { id: 'love',            label: 'I love something',  icon: Heart,      hint: 'Tell us what — we like knowing. (optional)' },
  { id: 'other',           label: 'Other',             icon: ChatCircle, hint: 'Anything at all (optional)' },
];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Downscale a chosen image to a small JPEG data URL so a screenshot can ride
// along in the feedback payload without bloating the row. Caps the longest
// edge and re-encodes; typical screenshots land around 100–300 KB.
const MAX_DIM = 1200;
const MAX_DATA_URL_BYTES = 2_800_000;  // stay under send-feedback's 3 MB guard

function fileToDownscaledDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) { reject(new Error('Please choose an image file.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
      const scale = Math.min(1, MAX_DIM / longest);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/jpeg', 0.82)); }
      catch (_) { reject(new Error("Couldn't process that image.")); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

export function FeedbackButton({ as = 'floating' }) {
  const { user } = useAuth();
  const myTier = useMyTier({ userId: user?.id });
  const [open, setOpen]       = useState(false);
  const [topic, setTopic]     = useState(null);
  const [message, setMessage] = useState('');
  const [image, setImage]     = useState(null);  // { dataUrl, name } | null
  const [contactOk, setContactOk] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState(null);  // 'sent' | 'error' | null
  const [error, setError]     = useState('');
  const fileRef    = useRef(null);
  const panelRef   = useRef(null);
  const lastFocus  = useRef(null);   // element to restore focus to on close

  // A topic alone is a whole answer. Without one, words are (the old shape).
  const hasText = message.trim().length >= 2;
  const canSend = (Boolean(topic) || hasText) && !busy;

  const close = () => { if (!busy) setOpen(false); };

  // What will be attached, computed while the modal is open so the line the
  // person reads is the record that is sent.
  const context = useMemo(() => (open ? buildFeedbackContext({
    cards: myTier.tier ? myTier.demoCardCount : undefined,
    server_cards: myTier.serverCardCount,
    cap: myTier.tier === 'demo' ? myTier.effectiveCardLimit : undefined,
    tier: myTier.tier,
  }, feedbackEnv()) : null), [open, myTier.tier, myTier.demoCardCount, myTier.serverCardCount, myTier.effectiveCardLimit]);
  const contextLine = context ? describeFeedbackContext(context) : '';

  // While open: lock background scroll, trap Tab inside the panel, Esc closes.
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const nodes = Array.from(panel.querySelectorAll(FOCUSABLE)).filter((n) => n.getClientRects().length > 0);
        if (!nodes.length) return;
        const first = nodes[0];
        const last  = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened the modal once it unmounts.
      const t = lastFocus.current; lastFocus.current = null;
      if (t && typeof t.focus === 'function') {
        requestAnimationFrame(() => { try { t.focus({ preventScroll: true }); } catch (_) {} });
      }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the first topic on open: the Tab trap above only holds focus that is
  // already inside the panel, and a textarea autofocus would put the software
  // keyboard over a list of one-tap answers on a phone.
  useEffect(() => {
    if (!open || status === 'sent') return undefined;
    const raf = requestAnimationFrame(() => {
      try { panelRef.current?.querySelector('.feedback-kind')?.focus({ preventScroll: true }); } catch (_) {}
    });
    return () => cancelAnimationFrame(raf);
  }, [open, status]);

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';  // allow re-picking the same file
    if (!file) return;
    setError('');
    try {
      const dataUrl = await fileToDownscaledDataUrl(file);
      if (dataUrl.length > MAX_DATA_URL_BYTES) {
        setError('That image is too large even after shrinking — try a smaller one.');
        return;
      }
      setImage({ dataUrl, name: file.name || 'screenshot' });
    } catch (err) {
      setError(err?.message || 'Could not attach that image.');
    }
  };

  const submit = async () => {
    if (!topic && !hasText) { setError('Pick a topic, or write a few words.'); return; }
    setBusy(true);
    setError('');
    const text = message.trim();
    try {
      let token = '';
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token || '';
      } catch (_) {}
      const res = await fetch(FEEDBACK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          // Words with no topic file as 'other' — the same place they always went.
          choice: topic || 'other',
          message: text,
          context,
          contact_ok: Boolean(user) && contactOk,
          image_data_url: image?.dataUrl || null,
          url:        typeof window !== 'undefined' ? window.location.href : null,
          viewport:   typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // Length only, never the words — the same rule every ask follows.
      try {
        logEvent(EV.FEEDBACK_SENT, {
          topic: topic || 'other', has_text: text.length > 0, len: text.length,
          has_image: Boolean(image), contact_ok: Boolean(user) && contactOk,
        });
      } catch (_) {}
      setStatus('sent');
      setMessage('');
      setImage(null);
      setTopic(null);
      setContactOk(false);
      setTimeout(() => { setOpen(false); setStatus(null); }, 1600);
    } catch (e) {
      setError(e?.message || String(e));
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  const onTextareaKeyDown = (e) => {
    // ⌘/Ctrl + Enter sends — the universal "submit this form" shortcut.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSend) { e.preventDefault(); submit(); }
  };

  const openModal = (e) => {
    lastFocus.current = e?.currentTarget || (typeof document !== 'undefined' ? document.activeElement : null);
    setOpen(true);
    setStatus(null);
    setError('');
    setImage(null);
    try { logEvent(EV.FEEDBACK_OPENED, { surface: feedbackEnv().surface || null }); } catch (_) {}
  };

  const Trigger = as === 'icon' ? (
    <button type="button" className="tb-icon" title="Send feedback" aria-label="Send feedback" onClick={openModal}>
      <PaperPlaneTilt size={16} weight="regular" />
    </button>
  ) : (
    <button type="button" className="feedback-trigger" onClick={openModal} title="Send feedback" aria-label="Send feedback">
      <PaperPlaneTilt size={14} weight="fill" /> Feedback
    </button>
  );

  const activeHint = TOPICS.find((t) => t.id === topic)?.hint || 'Pick a topic above, or just write — either is enough.';

  // The modal is rendered through a portal to document.body so a parent with
  // backdrop-filter / transform / contain (which create a containing block for
  // position: fixed) can never clip it.
  const Modal = open && typeof document !== 'undefined' ? createPortal(
    <div className="feedback-overlay" onMouseDown={close}>
      <div
        ref={panelRef}
        className="feedback-modal surface-frosted"
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="feedback-head">
          <div className="feedback-head-title">
            <span className="feedback-head-ico" aria-hidden="true"><PaperPlaneTilt size={16} weight="fill" /></span>
            <span className="t-h3">Send feedback</span>
          </div>
          <button type="button" className="feedback-x" onClick={close} aria-label="Close" disabled={busy}>×</button>
        </header>

        {status === 'sent' ? (
          <div className="feedback-success" role="status">
            <span className="feedback-success-ico" aria-hidden="true"><CheckCircle size={40} weight="fill" /></span>
            <div className="feedback-success-title">Thanks — got it.</div>
            <div className="feedback-success-sub t-meta">A person here reads every note that comes in.</div>
          </div>
        ) : (
          <>
            <div className="feedback-body">
              <div className="feedback-kinds" role="radiogroup" aria-label="What is it about?">
                {TOPICS.map((t) => {
                  const TIco = t.icon;
                  const active = topic === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`feedback-kind ${active ? 'is-active' : ''}`}
                      // Tapping the chosen topic again clears it.
                      onClick={() => setTopic(active ? null : t.id)}
                      disabled={busy}
                    >
                      <span className="feedback-kind-ico" aria-hidden="true"><TIco size={17} weight={active ? 'fill' : 'regular'} /></span>
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <div className="feedback-field">
                <textarea
                  className="feedback-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={onTextareaKeyDown}
                  placeholder={activeHint}
                  rows={4}
                  disabled={busy}
                  maxLength={MAX_MESSAGE}
                  aria-label="Details (optional)"
                />
                {message.length > 0 && (
                  <span className={`feedback-count t-meta ${message.length >= MAX_MESSAGE ? 'is-max' : ''}`}>
                    {message.length}/{MAX_MESSAGE}
                  </span>
                )}
              </div>

              <div className="feedback-attach">
                {image ? (
                  <div className="feedback-attach-chip">
                    <img src={image.dataUrl} alt="" className="feedback-attach-thumb" />
                    <span className="feedback-attach-name t-meta">{image.name}</span>
                    <button type="button" className="auth-link" onClick={() => setImage(null)} disabled={busy}>Remove</button>
                  </div>
                ) : (
                  <button type="button" className="feedback-attach-add" onClick={() => fileRef.current?.click()} disabled={busy}>
                    + Add a screenshot
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
              </div>

              {user && (
                <label className="feedback-consent">
                  <input
                    type="checkbox"
                    checked={contactOk}
                    onChange={(e) => setContactOk(e.target.checked)}
                    disabled={busy}
                  />
                  <span>OK to email me about this</span>
                </label>
              )}

              {contextLine && (
                <div className="ask-context">Sent with: {contextLine}</div>
              )}

              {error && <div className="feedback-error t-meta" role="alert">{error}</div>}
            </div>

            <footer className="feedback-foot">
              <a className="feedback-email t-meta" href={`mailto:${SUPPORT_EMAIL}`}>Prefer email?</a>
              <div className="feedback-foot-actions">
                <button type="button" className="auth-link" onClick={close} disabled={busy}>Cancel</button>
                <button type="button" className="btn-primary" onClick={submit} disabled={!canSend}>
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (<>{Trigger}{Modal}</>);
}
