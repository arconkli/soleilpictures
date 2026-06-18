// Auto-linkify + link-preview generation for note html. Runs as a write-through
// post-process on the html derived from a note's Y.XmlFragment (the editor
// stores plain URL text; this turns bare URLs into <a> and appends a
// .note-link-preview block per unique URL — matching the legacy note contract
// so the read-only renderer + the preview-remove handler keep working).
//
// This is the fragment-path twin of the contentEditable linkify in
// RichNoteEditor; it intentionally does NOT touch checklists (Tiptap emits
// clean .ck markup), so it is checklist-normalization-free.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

function normalizeUrl(url) {
  const trimmed = String(url || '').replace(/[.,;:!?)]$/, '');
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

export function linkifyNoteHtml(html) {
  if (typeof document === 'undefined') return html || '';
  const root = document.createElement('div');
  root.innerHTML = html || '';
  // Drop any previews already present so we never duplicate them.
  root.querySelectorAll('.note-link-preview').forEach(node => node.remove());
  const hidden = new Set(
    Array.from(root.querySelectorAll('.note-preview-hidden')).map(node => node.dataset.url)
  );
  const urls = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !URL_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      URL_RE.lastIndex = 0;
      if (node.parentElement?.closest('a, .note-link-preview, .note-preview-hidden')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(node => {
    const frag = document.createDocumentFragment();
    const text = node.nodeValue;
    let last = 0;
    text.replace(URL_RE, (match, _url, index) => {
      const normalized = normalizeUrl(match);
      const label = match.replace(/[.,;:!?)]$/, '');
      if (index > last) frag.appendChild(document.createTextNode(text.slice(last, index)));
      const a = document.createElement('a');
      a.href = normalized;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      frag.appendChild(a);
      const trailing = match.slice(label.length);
      if (trailing) frag.appendChild(document.createTextNode(trailing));
      urls.set(normalized, label);
      last = index + match.length;
      return match;
    });
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });

  urls.forEach((label, url) => {
    if (hidden.has(url)) return;
    const preview = document.createElement('div');
    preview.className = 'note-link-preview';
    preview.dataset.url = url;
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
    preview.innerHTML = `<div class="note-link-preview-meta"><span>LINK PREVIEW</span><strong>${escapeHtml(host)}</strong><small>${escapeHtml(label)}</small></div><button type="button" class="note-preview-remove" aria-label="Remove link preview">x</button>`;
    root.appendChild(preview);
  });

  return root.innerHTML;
}
