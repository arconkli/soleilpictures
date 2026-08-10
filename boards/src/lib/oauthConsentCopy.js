// Turning an OAuth failure into something a person can act on.
//
// The consent screen used to render `error_description` straight from the API.
// That field is written for whoever is integrating — "unknown client",
// "invalid_grant" — and it is the right thing to send a developer reading JSON.
// It is the wrong thing to show the person who clicked, who did not choose the
// client, cannot fix its registration, and mostly wants to know whether
// anything just happened to their account.
//
// Found by landing on it: a stale authorize link produced a full-page
// "THIS REQUEST CANNOT BE APPROVED / unknown client", which reads like an
// accusation and answers none of that.
//
// Every message here ends by saying nothing was shared, because that is the
// actual question, and because it is true — every one of these fires BEFORE any
// code is issued.

const FALLBACK = {
  title: 'This request cannot be approved',
  body: 'Something about that link was not right. Nothing has been shared.',
};

const BY_CODE = {
  invalid_client: {
    title: 'That link is out of date',
    body: 'The application that sent you here is no longer registered with Clusters. '
      + 'Try connecting again from the app you started in. Nothing has been shared.',
  },
  invalid_request: {
    title: 'That link is incomplete',
    body: 'It is missing something it needs, so it cannot be approved. '
      + 'Try connecting again from the app you started in. Nothing has been shared.',
  },
  invalid_redirect_uri: {
    title: 'That link cannot be trusted',
    body: 'It asks to send you somewhere the application has not registered, so we have '
      + 'not sent anything there. Nothing has been shared.',
  },
  invalid_target: {
    title: 'That link is for somewhere else',
    body: 'It asks for access to a service this account does not cover. Nothing has been shared.',
  },
  access_denied: {
    title: 'That could not be approved',
    body: 'Your account was not able to approve this request. Nothing has been shared.',
  },
  server_error: {
    title: 'Something went wrong on our end',
    body: 'Not your doing, and nothing has been shared. Try again in a moment.',
  },
};

/**
 * Pick the sentence to show for an OAuth failure.
 *
 * `description` is accepted but deliberately NOT rendered when a code is
 * recognised — the whole point is to stop the machine-facing string reaching a
 * person. It is used only when there is no code to go on, where a specific
 * sentence still beats a generic one.
 */
export function consentError(code, description) {
  if (code && Object.prototype.hasOwnProperty.call(BY_CODE, code)) return BY_CODE[code];
  if (description && typeof description === 'string' && description.length <= 160) {
    return { title: FALLBACK.title, body: `${description}. Nothing has been shared.` };
  }
  return FALLBACK;
}

// Problems decidable from the URL alone, before any network call. Same
// principle: name the thing that is wrong without quoting a parameter name at
// someone who has never heard of OAuth.
export function consentRequestProblem({ clientId, redirectUri, responseType, codeChallenge, challengeMethod }) {
  if (!clientId || !redirectUri) return BY_CODE.invalid_request;
  if (responseType !== 'code') return BY_CODE.invalid_request;
  if (!codeChallenge) return BY_CODE.invalid_request;
  if (challengeMethod && challengeMethod !== 'S256') return BY_CODE.invalid_request;
  return null;
}
