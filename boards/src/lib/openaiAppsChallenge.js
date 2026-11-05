// OpenAI's plugin portal checks that whoever submits the Clusters MCP server
// controls its domain: it shows a one-off token and fetches
// /.well-known/openai-apps-challenge, expecting exactly that token as plain
// text. The token lives in the Worker secret OPENAI_APPS_CHALLENGE, set in
// Cloudflare and never committed (the repo is public), so verifying needs no
// deploy. Unset or blank, the path answers like any other unknown
// /.well-known/ path: the JSON 404.
export const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge';

export function openaiAppsChallengeResponse(pathname, method, env) {
  if (pathname !== OPENAI_APPS_CHALLENGE_PATH) return null;
  if (method !== 'GET' && method !== 'HEAD') return null;
  const token = typeof env?.OPENAI_APPS_CHALLENGE === 'string' ? env.OPENAI_APPS_CHALLENGE.trim() : '';
  if (!token) return null;
  return new Response(method === 'HEAD' ? null : token, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
