// FeedbackButton — "Send feedback" trigger + modal.
//
// Props:
//   as = 'floating' (default) — frosted pill, position: fixed
//   as = 'icon'                — tb-icon-style inline button
//                                (caller controls placement)

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { supabase } from '../lib/supabase.js';

const FEEDBACK_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/send-feedback';
const KINDS = [
  { id: 'bug',    label: 'Bug',    hint: "Something's broken or wrong" },
  { id: 'idea',   label: 'Idea',   hint: 'Feature request or improvement' },
  { id: 'praise', label: 'Praise', hint: 'You love something' },
  { id: 'other',  label: 'Other',  hint: 'Anything else' },
];

export function FeedbackButton({ as = 'floating' }) {
  const [open, setOpen]       = useState(false);
  const [kind, setKind]       = useState('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState(null);  // 'sent' | 'error' | null
  const [error, setError]     = useState('');

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
          url:        typeof window !== 'undefined' ? window.location.href : null,
          viewport:   typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setStatus('sent');
      setMessage('');
      setTimeout(() => { setOpen(false); setStatus(null); }, 1200);
    } catch (e) {
      setError(e?.message || String(e));
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  const openModal = () => { setOpen(true); setStatus(null); setError(''); };

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
