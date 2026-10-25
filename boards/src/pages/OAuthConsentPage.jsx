// /oauth/authorize — the one screen a person sees when an assistant connects.
//
// It renders INSIDE <AuthGate>, and that is the whole design. Our sign-in is a
// single email box that creates the account if there isn't one, so a person who
// has never heard of Soleil Clusters can press "Connect" in Claude, type their
// address, approve, and have a working assistant — without ever visiting the
// site. The sign-in wall stops being a wall and becomes the sign-up.
//
// SECURITY POSTURE. The rule that governs every branch here: never redirect to
// a URI we have not confirmed belongs to the client. A malformed or unknown
// request is shown as an error page, not bounced onward — bouncing is exactly
// the open redirect the flow is supposed to prevent. So the page asks
// /oauth/client whether this redirect_uri is registered BEFORE it renders
// anything, and the Deny button goes through the Worker (which re-checks)
// rather than building a redirect in the browser.
//
// The Worker owns the code; this page owns none of it. Approving POSTs to
// /oauth/authorize with the person's own Supabase session, and the code is
// bound to auth.uid() inside Postgres — so nothing here can approve on
// somebody else's behalf even if it wanted to.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { Icon } from '../components/Icon.jsx';
import { Lock, Check, X } from '../lib/icons.js';
import { consentError, consentRequestProblem, consentRequestFault } from '../lib/oauthConsentCopy.js';
import { connectEventProps } from '../lib/oauthConnect.js';
import { logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// What each scope actually lets an assistant do, in the words of the product
// rather than the words of the API. "write" is not a permission anyone can
// weigh; "create and change clusters, cards and files" is.
const SCOPE_COPY = {
  read: {
    title: 'Read your clusters',
    body: 'See your clusters, the cards on them, and the images and files they hold.',
  },
  write: {
    title: 'Create and change things',
    body: 'Add clusters and cards, upload files, move and arrange what is already there.',
  },
  delete: {
    title: 'Delete things',
    body: 'Remove cards and clusters. Deleted clusters go to the bin and can be restored.',
  },
};

function Shell({ children }) {
  return (
    <div className="oauth-screen">
      <div className="oauth-card">
        <div className="oauth-brand"><SoleilWordmark size="block" /></div>
        {children}
      </div>
    </div>
  );
}

export function OAuthConsentPage() {
  const { user } = useAuth();
  const params = new URLSearchParams(window.location.search);

  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const responseType = params.get('response_type') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const challengeMethod = params.get('code_challenge_method') || '';
  const state = params.get('state');
  const resource = params.get('resource') || '';
  const scopes = (params.get('scope') || 'read write')
    .split(/[\s,]+/).map((s) => s.trim().toLowerCase())
    .filter((s) => s in SCOPE_COPY);
  const shown = scopes.length ? scopes : ['read', 'write'];

  const [client, setClient] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState('');

  // Everything wrong with the REQUEST itself, decided before any network call.
  // Phrased for the person who clicked, not the person who integrated — see
  // lib/oauthConsentCopy.js.
  const request = { clientId, redirectUri, responseType, codeChallenge, challengeMethod };
  const requestProblem = consentRequestProblem(request);

  // What the connect funnel records at each step — lib/oauthConnect.js decides
  // what may go in (a host, never the redirect URI; never the code or state).
  const eventProps = () => connectEventProps({
    clientId, redirectUri, scopes: shown, userCreatedAt: user?.created_at,
  });

  // A failure the page shows, with where it happened and why, for the error
  // event. The person reads consentError's sentence either way.
  const fail = (stage, reason, description) => setProblem({
    ...consentError(reason === 'network' ? 'server_error' : reason, description),
    stage,
    reason,
  });

  useEffect(() => {
    if (requestProblem) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/oauth/client?client_id=${encodeURIComponent(clientId)}`
          + `&redirect_uri=${encodeURIComponent(redirectUri)}`);
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) {
          fail('client', body?.error || `http_${res.status}`, body?.error_description);
          return;
        }
        if (!body?.redirect_uri_registered) {
          // Deliberately NOT redirected back with an error — an unregistered
          // callback is the thing we refuse to send anything to at all.
          fail('client', 'invalid_redirect_uri');
          return;
        }
        setClient(body);
      } catch {
        if (alive) fail('client', 'network');
      }
    })();
    return () => { alive = false; };
  }, [clientId, redirectUri, requestProblem]);

  const send = async (path) => {
    setBusy(path);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token || '';
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: scopes.length ? scopes : ['read', 'write'],
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
          resource,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.redirect_to) {
        fail('consent', body?.error || (res.ok ? 'no_redirect' : `http_${res.status}`), body?.error_description);
        setBusy('');
        return;
      }
      // Beaconed: the redirect on the next line unloads the page.
      logEventNow(path === '/oauth/deny' ? EV.OAUTH_CONSENT_DENIED : EV.OAUTH_CONSENT_ALLOWED, eventProps());
      window.location.assign(body.redirect_to);
    } catch {
      fail('consent', 'network');
      setBusy('');
    }
  };

  useEffect(() => {
    if (client) logEventOnce(`oauth_view:${clientId}`, EV.OAUTH_AUTHORIZE_VIEW, eventProps());
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const fatal = requestProblem || problem;
  const failStage = requestProblem ? 'request' : problem?.stage;
  const failReason = requestProblem ? consentRequestFault(request) : problem?.reason;
  useEffect(() => {
    if (!failReason) return;
    logEventOnce(`oauth_error:${failStage}:${failReason}`, EV.OAUTH_AUTHORIZE_ERROR, {
      ...eventProps(), stage: failStage, reason: String(failReason).slice(0, 40),
    });
  }, [failStage, failReason]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fatal) {
    return (
      <Shell>
        <EmptyState
          icon={Lock}
          title={fatal.title}
          body={fatal.body}
          action={{ label: 'Go to Clusters', onClick: () => window.location.assign('/') }}
        />
      </Shell>
    );
  }

  if (!client) {
    return (
      <Shell>
        <div className="oauth-loading t-body">Checking that application…</div>
      </Shell>
    );
  }

  const host = (() => {
    try { return new URL(redirectUri).host || new URL(redirectUri).protocol; } catch { return redirectUri; }
  })();

  return (
    <Shell>
      <h1 className="oauth-title t-h1">
        <b>{client.client_name}</b> wants to connect to your clusters
      </h1>
      <div className="oauth-sub t-body">
        Signed in as <b>{user?.email}</b>
      </div>

      <ul className="oauth-scopes">
        {shown.map((s) => (
          <li key={s} className="oauth-scope">
            <span className="oauth-scope-tick"><Icon as={Check} size={14} /></span>
            <span>
              <span className="oauth-scope-title">{SCOPE_COPY[s].title}</span>
              <span className="oauth-scope-body t-meta">{SCOPE_COPY[s].body}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="oauth-note t-meta">
        It will reach exactly what you can reach — no more. You can disconnect it at any time in
        {' '}<b>Settings → Connections</b>, and everything it does is recorded in your audit log.
      </div>

      <div className="oauth-actions">
        <button
          type="button"
          className="oauth-deny"
          disabled={!!busy}
          onClick={() => send('/oauth/deny')}
        >
          <Icon as={X} size={14} /> {busy === '/oauth/deny' ? 'Cancelling…' : 'Cancel'}
        </button>
        <button
          type="button"
          className="oauth-allow"
          disabled={!!busy}
          onClick={() => send('/oauth/authorize')}
        >
          {busy === '/oauth/authorize' ? 'Connecting…' : `Connect ${client.client_name}`}
        </button>
      </div>

      <div className="oauth-target t-meta">You will be returned to {host}</div>
    </Shell>
  );
}
