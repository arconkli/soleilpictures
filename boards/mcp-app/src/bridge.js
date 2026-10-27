// The view's side of MCP Apps (spec 2026-01-26): JSON-RPC 2.0 over
// postMessage with the host page that framed it.
//
// Written out rather than taken from @modelcontextprotocol/ext-apps: its
// self-contained build is over 300 kB (it carries an MCP client and zod), for
// a dozen messages. The shapes here are the ones that package sends, read from
// its source (1.7.5; the protocol is byte-identical in 2.x): `ui/initialize`
// then `ui/notifications/initialized`; `ui/message` content is an ARRAY of
// blocks; sizes are measured as its autoResize measures them.

export const PROTOCOL_VERSION = '2026-01-26';

export function createBridge({ host, win, appInfo, appCapabilities = {}, timeoutMs = 20_000 }) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  const post = (msg) => host.postMessage(msg, '*');

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no answer`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      post({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  const notify = (method, params) =>
    post({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });

  function on(method, fn) {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  }

  // What the host may ask of a view. A teardown is answered once the view has
  // let go; anything else is a method this view does not have.
  async function answerRequest(msg) {
    let result;
    if (msg.method === 'ui/resource-teardown' || msg.method === 'ping') {
      for (const fn of listeners.get(msg.method) || []) {
        try { await fn(msg.params); } catch { /* answered regardless */ }
      }
      result = {};
    }
    if (result) post({ jsonrpc: '2.0', id: msg.id, result });
    else post({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }

  function receive(event) {
    if (event.source !== host) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
    if (typeof msg.method === 'string') {
      if (msg.id !== undefined && msg.id !== null) {
        answerRequest(msg);
        return;
      }
      for (const fn of listeners.get(msg.method) || []) {
        try { fn(msg.params || {}); } catch (e) { console.error('[clusters view]', msg.method, e); }
      }
      return;
    }
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    clearTimeout(waiting.timer);
    if (msg.error) {
      const e = new Error(msg.error.message || `${waiting.method} failed`);
      e.code = msg.error.code;
      waiting.reject(e);
    } else {
      waiting.resolve(msg.result);
    }
  }
  win.addEventListener('message', receive);

  // The handshake: the host answers with what it can do and where the view is.
  async function connect() {
    const init = await request('ui/initialize', {
      appInfo, appCapabilities, protocolVersion: PROTOCOL_VERSION,
    });
    notify('ui/notifications/initialized');
    return init || {};
  }

  return { connect, request, notify, on };
}

// The view's height, measured as the SDK measures it: the page at its natural
// height, and the window's width; sent only when either changes.
export function watchSize(win, doc, send) {
  let queued = false;
  let lastW = 0;
  let lastH = 0;
  const measure = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(() => {
      queued = false;
      const html = doc.documentElement;
      const before = html.style.height;
      html.style.height = 'max-content';
      const height = Math.ceil(html.getBoundingClientRect().height);
      html.style.height = before;
      const width = Math.ceil(win.innerWidth);
      if (width !== lastW || height !== lastH) {
        lastW = width;
        lastH = height;
        send({ width, height });
      }
    });
  };
  measure();
  const ro = new win.ResizeObserver(measure);
  ro.observe(doc.documentElement);
  ro.observe(doc.body);
  return measure;
}

// The host's look: its theme, its CSS variables, its fonts (added once).
export function applyHostLook(doc, context) {
  if (!context) return;
  const root = doc.documentElement;
  if (context.theme === 'dark' || context.theme === 'light') {
    root.setAttribute('data-theme', context.theme);
    root.style.colorScheme = context.theme;
  }
  const vars = context.styles?.variables;
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v === 'string' && /^--[\w-]+$/.test(k)) root.style.setProperty(k, v);
    }
  }
  const fonts = context.styles?.css?.fonts;
  if (typeof fonts === 'string' && fonts && !doc.getElementById('__mcp-host-fonts')) {
    const style = doc.createElement('style');
    style.id = '__mcp-host-fonts';
    style.textContent = fonts;
    doc.head.appendChild(style);
  }
}
