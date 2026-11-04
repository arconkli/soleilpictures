// node --test src/lib/mcpInstallLinks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorInstallLinks, vscodeInstallLinks, MCP_SERVER_NAME } from './mcpInstallLinks.js';

const URL_ = 'https://clusters.soleilpictures.com/api/v1/mcp';

test('cursor links carry the name and a base64 {"url"} config', () => {
  const { web, app } = cursorInstallLinks(URL_);
  assert.ok(web.startsWith('https://cursor.com/en/install-mcp?name=soleil-clusters&config='));
  assert.ok(app.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=soleil-clusters&config='));
  const cfg = new URL(web).searchParams.get('config');
  assert.deepEqual(JSON.parse(Buffer.from(cfg, 'base64').toString()), { url: URL_ });
});

test('vscode links carry the http server', () => {
  const { web, app } = vscodeInstallLinks(URL_);
  assert.ok(web.startsWith('https://insiders.vscode.dev/redirect/mcp/install?name=soleil-clusters&config='));
  assert.deepEqual(JSON.parse(new URL(web).searchParams.get('config')), { type: 'http', url: URL_ });
  assert.ok(app.startsWith('vscode:mcp/install?'));
  assert.deepEqual(JSON.parse(decodeURIComponent(app.slice('vscode:mcp/install?'.length))),
    { name: MCP_SERVER_NAME, type: 'http', url: URL_ });
});
