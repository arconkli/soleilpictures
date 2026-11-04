// What one /api/v1 request writes to api_request_log (api_log_request, 0858),
// built apart from the Worker so it can be tested without one.
//
// A failed call is the useful row: is_error says it failed, error_code says
// why in the API's own words (not_found, limit_reached, forbidden…) or, for a
// protocol error, as the JSON-RPC code, and client says which app was on the
// other end (set on initialize only, the one call that names it).

const ERROR_CODE_MAX = 64;
const CLIENT_MAX = 120;

// The messages worth a row: not ping or notifications/*, which were nearly all
// of them and say nothing.
export function mcpMethodLogged(method) {
  if (!method) return true;
  const m = String(method);
  return m !== 'ping' && !m.startsWith('notifications/');
}

// "name/version" from an initialize message, trimmed; null for any other.
export function mcpClientName(msg) {
  const first = Array.isArray(msg) ? msg[0] : msg;
  if (first?.method !== 'initialize') return null;
  const info = first?.params?.clientInfo;
  const name = typeof info?.name === 'string' ? info.name.trim() : '';
  if (!name) return null;
  const version = typeof info?.version === 'string' ? info.version.trim() : '';
  return (version ? `${name}/${version}` : name).slice(0, CLIENT_MAX);
}

// Whether a JSON-RPC answer failed, and the code behind it: the protocol error's
// code as a string, or a tool result's isError (whose API code the tool call
// reports through trace.errorCode). A batch is judged by its first failure.
export function mcpOutcome(body) {
  for (const one of Array.isArray(body) ? body : [body]) {
    if (one?.error) return { isError: true, code: one.error.code === undefined ? null : String(one.error.code) };
    if (one?.result?.isError) return { isError: true, code: null };
  }
  return { isError: false, code: null };
}

/**
 * The named parameters of api_log_request, or null when the request is not
 * logged. `trace` is what the route collected: route, target, tool, and for MCP
 * mcpMethod, client, errorCode and isError.
 */
export function apiLogParams({ auth, request, trace, status, ms }) {
  if (trace.mcpMethod !== undefined && !mcpMethodLogged(trace.mcpMethod)) return null;
  const code = trace.errorCode ? String(trace.errorCode).slice(0, ERROR_CODE_MAX) : null;
  const isError = status >= 400 || Boolean(trace.isError) || Boolean(code);
  return {
    p_token_id: auth.tokenId,
    p_user_id: auth.userId,
    p_method: request.method,
    p_route: trace.route,
    p_status: status,
    p_ms: ms,
    p_target: trace.target,
    p_tool: trace.tool || null,
    // 0320: where from. cf-connecting-ip is set by Cloudflare on every
    // request and cannot be forged by the client; the UA is bounded here so
    // the column stays small.
    p_ip: request.headers.get('cf-connecting-ip') || null,
    p_ua: (request.headers.get('user-agent') || '').slice(0, 200) || null,
    p_is_error: isError,
    p_error_code: isError ? code : null,
    p_client: trace.client ? String(trace.client).slice(0, CLIENT_MAX) : null,
  };
}
