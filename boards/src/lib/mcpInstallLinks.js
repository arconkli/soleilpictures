// mcpInstallLinks.js — one-click "add this MCP server" links for the editors
// that publish an install link format. Settings > Connections and the docs both
// build theirs here, so the strings cannot drift apart.
//
// Formats:
//   Cursor   https://cursor.com/en/install-mcp?name=<name>&config=<base64 JSON>
//            cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 JSON>
//            config is the server's own object ({"url": …}), not the mcpServers wrapper.
//   VS Code  vscode:mcp/install?<url-encoded JSON {"name","type","url"}>
//            https://insiders.vscode.dev/redirect/mcp/install?name=<name>&config=<url-encoded JSON>
//            The https form works before the app is installed, so it is the default.

export const MCP_SERVER_NAME = 'soleil-clusters';

const b64 = (s) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64'));

export function cursorInstallLinks(mcpUrl, name = MCP_SERVER_NAME) {
  const config = encodeURIComponent(b64(JSON.stringify({ url: mcpUrl })));
  const q = `name=${encodeURIComponent(name)}&config=${config}`;
  return {
    web: `https://cursor.com/en/install-mcp?${q}`,
    app: `cursor://anysphere.cursor-deeplink/mcp/install?${q}`,
  };
}

export function vscodeInstallLinks(mcpUrl, name = MCP_SERVER_NAME) {
  const json = JSON.stringify({ name, type: 'http', url: mcpUrl });
  const inner = JSON.stringify({ type: 'http', url: mcpUrl });
  return {
    web: `https://insiders.vscode.dev/redirect/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(inner)}`,
    app: `vscode:mcp/install?${encodeURIComponent(json)}`,
  };
}
