// FeedbackButton — "Send feedback" trigger + modal.
//
// Props:
//   as = 'floating' (default) — frosted pill, position: fixed
//   as = 'icon'                — tb-icon-style inline button
//                                (caller controls placement)

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PaperPlaneTilt, Bug, Lightbulb, Heart, ChatCircle, CheckCircle } from '@phosphor-icons/react';
import { supabase } from '../lib/supabase.js';

const FEEDBACK_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/send-feedback';
const SUPPORT_EMAIL = 'clusters@soleilpictures.com';
const MAX_MESSAGE = 4000;
const KINDS = [
  { id: 'idea',   label: 'Idea',   icon: Lightbulb,  hint: 'A feature request or improvement' },
  { id: 'bug',    label: 'Bug',    icon: Bug,        hint: "Something's broken or wrong" },
  { id: 'praise', label: 'Praise', icon: Heart,      hint: 'You love something' },
  { id: 'other',  label: 'Other',  icon: ChatCircle, hint: 'Anything else' },
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
  const [open, setOpen]       = useState(false);
  const [kind, setKind]       = useState('idea');
  const [message, setMessage] = useState('');
  const [image, setImage]     = useState(null);  // { dataUrl, name } | null
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState(null);  // 'sent' | 'error' | null
  const [error, setError]     = useState('');
  const fileRef    = useRef(null);
  const panelRef   = useRef(null);
  const lastFocus  = useRef(null);   // element to restore focus to on close

  const canSend = message.trim().length >= 2 && !busy;

  const close = () => { if (!busy) setOpen(false); };

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
    if (message.trim().length < 2) { setError('Please write a bit more.'); return; }
    setBusy(true);
    setError('');
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
          kind,
          message: message.trim(),
          image_data_url: image?.dataUrl || null,
          url:        typeof window !== 'undefined' ? window.location.href : null,
          viewport:   typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setStatus('sent');
      setMessage('');
      setImage(null);
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

  const activeHint = KINDS.find((k) => k.id === kind)?.hint || 'Tell us…';

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
            <div className="feedback-success-sub t-meta">We read every note that comes in.</div>
          </div>
        ) : (
          <>
            <div className="feedback-body">
              <div className="feedback-kinds" role="radiogroup" aria-label="Feedback type">
                {KINDS.map((k) => {
                  const KIco = k.icon;
                  const active = kind === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`feedback-kind ${active ? 'is-active' : ''}`}
                      onClick={() => setKind(k.id)}
                      title={k.hint}
                      disabled={busy}
                    >
                      <span className="feedback-kind-ico" aria-hidden="true"><KIco size={17} weight={active ? 'fill' : 'regular'} /></span>
                      {k.label}
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
                  rows={5}
                  disabled={busy}
                  autoFocus
                  maxLength={MAX_MESSAGE}
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
