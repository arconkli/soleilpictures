// Render a small subset of HTML (rich-note bodies, etc.) through a
// React tree, scanning every text node against the workspace trie
// and wrapping matches in <EntityLink> chips so auto-detection works
// inside cards/notes — not just docs and messages.
//
// Skips code/pre blocks and any node already inside a link.
//
// Allowed tags in v1: div p span strong em u s b i br a code pre
// ul ol li h1-h4 blockquote img.

import React from 'react';
import { EntityLink } from '../components/EntityLink.jsx';
import { scanForAutoLinks } from './scanForAutoLinks.js';

const ALLOWED_TAGS = new Set([
  'div','p','span','strong','em','u','s','b','i','br','a','code','pre',
  'ul','ol','li','h1','h2','h3','h4','blockquote','img','small','sup','sub',
]);

const SAFE_ATTRS = new Set([
  'class','style','href','target','rel','src','alt','title',
  'data-link-id','data-records','data-entity-ref',
]);

const SKIP_AUTO = new Set(['code', 'pre', 'a']);

export function renderHtmlWithAutoLinks(html, ctx = {}) {
  if (!html || typeof window === 'undefined') return null;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  return Array.from(wrapper.childNodes).map((n, i) => nodeToReact(n, ctx, `h${i}`));
}

function nodeToReact(node, ctx, key) {
  if (node.nodeType === Node.TEXT_NODE) {
    return scanTextNode(node.textContent, ctx, key);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    // Render unknown tags as plain spans so we don't drop the text.
    return React.createElement('span', { key }, Array.from(node.childNodes).map((c, i) => nodeToReact(c, ctx, `${key}-${i}`)));
  }

  const props = { key };
  for (const att of node.attributes) {
    if (!SAFE_ATTRS.has(att.name)) continue;
    if (att.name === 'class') props.className = att.value;
    else if (att.name === 'style') props.style = parseStyle(att.value);
    else if (att.name === 'href' && tag === 'a') {
      props.href = att.value;
      props.target = props.target || '_blank';
      props.rel = props.rel || 'noopener noreferrer';
    } else {
      // React preserves "data-*" / "title" / "alt" / "src" verbatim.
      props[att.name] = att.value;
    }
  }

  // Self-closing img / br / hr.
  if (tag === 'img' || tag === 'br' || tag === 'hr') {
    return React.createElement(tag, props);
  }

  // Inside SKIP_AUTO ancestors (code / pre / a), don't run the trie
  // scan — pass children through as-is.
  const skipScan = SKIP_AUTO.has(tag) || ctx._skipScan;
  const childCtx = skipScan ? { ...ctx, _skipScan: true } : ctx;
  const children = Array.from(node.childNodes).map((c, i) => nodeToReact(c, childCtx, `${key}-${i}`));
  return React.createElement(tag, props, children);
}

function scanTextNode(text, ctx, key) {
  if (!text) return text;
  if (ctx._skipScan || !ctx.trie) return text;
  const matches = scanForAutoLinks(text, ctx.trie);
  if (!matches.length) return text;
  const out = [];
  let last = 0; let cc = 0;
  for (const m of matches) {
    if (m.start > last) out.push(text.slice(last, m.start));
    out.push(
      <EntityLink
        key={`${key}-e${cc++}`}
        term={m.text}
        workspaceId={ctx.workspaceId}
        asTag="span"
      >
        {m.text}
      </EntityLink>
    );
    last = m.end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function parseStyle(s) {
  const out = {};
  for (const decl of String(s).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (!k || !v) continue;
    out[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}
