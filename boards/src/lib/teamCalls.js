// teamCalls — the fetch half of the Team page's calls, with its
// dependencies passed in so node can test it (teamBillingApi.js binds the
// real session, URL and origin). Modelled on storageAddon.js's call().
// Every call resolves; none throws.

export function makeTeamCalls({ getToken, fetchImpl, billingUrl, domainCheckUrl, getOrigin }) {
  async function post(url, body) {
    let token = null;
    try { token = await getToken(); } catch (_) { token = null; }
    if (!token) return { ok: false, error: 'auth required' };
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (_) {
      return { ok: false, error: 'network' };
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, ...json, error: json.error || `http_${res.status}` };
    return json;
  }

  return {
    teamBilling: (action, body = {}) => post(billingUrl, { action, ...body, return_origin: getOrigin() }),
    domainCheck: (orgId, domain) => post(domainCheckUrl, { org_id: orgId, domain }),
  };
}
