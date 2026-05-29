// FeedbackButton — "Send feedback" trigger + modal.
//
// Props:
//   as = 'floating' (default) — frosted pill, position: fixed
//   as = 'icon'                — tb-icon-style inline button
//                                (caller controls placement)

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { supabase } from '../lib/supabase.js';

const FEEDBACK_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/send-feedback';
const SUPPORT_EMAIL = 'clusters@soleilpictures.com';
const KINDS = [
  { id: 'bug',    label: 'Bug',    hint: "Something's broken or wrong" },
  { id: 'idea',   label: 'Idea',   hint: 'Feature request or improvement' },
  { id: 'praise', label: 'Praise', hint: 'You love something' },
  { id: 'other',  label: 'Other',  hint: 'Anything else' },
];

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
  const [kind, setKind]       = useState('bug');
  const [message, setMessage] = useState('');
  const [image, setImage]     = useState(null);  // { dataUrl, name } | null
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState(null);  // 'sent' | 'error' | null
  const [error, setError]     = useState('');
  const fileRef = useRef(null);

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
      setTimeout(() => { setOpen(false); setStatus(null); }, 1200);
    } catch (e) {
      setError(e?.message || String(e));
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  const openModal = () => { setOpen(true); setStatus(null); setError(''); setImage(null); };

  const Trigger = as === 'icon' ? (
    <button
      type="button"
      className="tb-icon"
      title="Send feedback"
      aria-label="Send feedback"
      onClick={openModal}
    >
      <PaperPlaneTilt size={16} weight="regular" />
    </button>
  ) : (
    <button
      type="button"
      className="feedback-trigger"
      onClick={openModal}
      title="Send feedback"
      aria-label="Send feedback"
    >
      Feedback
    </button>
  );

  // The modal is rendered through a portal to document.body so a
  // parent with backdrop-filter / transform / contain (which create
  // a containing block for position: fixed) can never clip it.
  const Modal = open && typeof document !== 'undefined' ? createPortal(
    <div className="feedback-overlay" onClick={() => !busy && setOpen(false)}>
      <div className="feedback-modal surface-frosted" onClick={(e) => e.stopPropagation()}>
        <header className="feedback-head">
          <div className="t-h3">Send feedback</div>
          <button type="button" className="feedback-x" onClick={() => !busy && setOpen(false)} aria-label="Close">×</button>
        </header>
        <div className="feedback-body">
          <p className="feedback-help t-meta" style={{ margin: '0 0 2px' }}>
            Hit a bug or something broken? Email{' '}
            <a className="auth-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{' '}
            and we'll jump on it. For ideas, requests, and everything else, tell us here:
          </p>
          <div className="feedback-kinds">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`feedback-kind ${kind === k.id ? 'is-active' : ''}`}
                onClick={() => setKind(k.id)}
                title={k.hint}
                disabled={busy}
              >
                {k.label}
              </button>
            ))}
          </div>
          <textarea
            className="feedback-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={KINDS.find((k) => k.id === kind)?.hint || 'Tell us…'}
            rows={5}
            disabled={busy}
            autoFocus
            maxLength={4000}
          />
          <div className="feedback-attach" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            {image ? (
              <>
                <img
                  src={image.dataUrl}
                  alt="attachment preview"
                  style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flex: '0 0 auto' }}
                />
                <span className="t-meta" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {image.name}
                </span>
                <button type="button" className="auth-link" onClick={() => setImage(null)} disabled={busy}>Remove</button>
              </>
            ) : (
              <button type="button" className="auth-link" onClick={() => fileRef.current?.click()} disabled={busy}>
                + Add a screenshot
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
          </div>
          {error && <div className="feedback-error t-meta">{error}</div>}
        </div>
        <footer className="feedback-foot">
          <button type="button" className="auth-link" onClick={() => !busy && setOpen(false)} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={busy || message.trim().length < 2}
          >
            {status === 'sent' ? 'Thanks!' : busy ? 'Sending…' : 'Send'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  ) : null;

  return (<>{Trigger}{Modal}</>);
}
