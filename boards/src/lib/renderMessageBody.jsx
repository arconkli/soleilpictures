// Tiny markdown + auto-link renderer for chat message bodies.
//
// Goals: render to React nodes (no dangerouslySetInnerHTML), no new
// dependencies, handle the common chat formatting people expect:
//   **bold**, *italic*, `code`, ```fenced``` code blocks,
//   > blockquote, -/* lists, 1. lists, auto-link bare URLs.
//
// Layered passes:
//   1. Pull out fenced code blocks (```...```) FIRST so other regex
//      can't munge their contents.
//   2. Walk lines. Group blockquotes / lists into block elements.
//   3. For inline text inside each block, do another pass for
//      mentions (@token), inline code, bold, italic, and auto-links.
//   4. Last pass: highlight any literal substring matches for the
//      search feature (the `highlight` prop).
//
// Mention pills + entity attachments take precedence over markdown
// matches that fall inside their token text — we render the pill and
// move on without re-parsing.

import React from 'react';
import { EntityLink } from '../components/EntityLink.jsx';
import { scanForAutoLinks } from './scanForAutoLinks.js';

const URL_RE = /https?:\/\/[^\s<>]+/g;
const FENCE_RE = /```([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
const ITALIC_RE = /(^|[^*\w])\*([^*\n]+)\*(?!\w)/g;
const MENTION_RE = /@([a-zA-Z0-9_'’\- ]{1,40})/g;

function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function truncateUrl(u, max = 50) {
  if (u.length <= max) return u;
  return u.slice(0, max - 1) + '…';
}

// Inline-string → React nodes. Handles @mentions, inline code, bold,
// italic, auto-link, and search-highlight. Order matters — outermost
// first so we don't double-process the contents of a pill or code
// span.
function renderInline(str, ctx, keyPrefix = 'i') {
  if (!str) return [];

  // 1. @mentions — pull out as pills (or plain text if not resolved
  //    in the message's mentions[]/attachments[] context).
  const mentionMap = new Map();
  for (const userId of (ctx.mentions || [])) {
    const name = ctx.userNamesById?.[userId];
    if (name) mentionMap.set(name.toLowerCase(), { kind: 'user', id: userId });
  }
  for (const att of (ctx.attachments || [])) {
    if (att.title || att.name) {
      mentionMap.set((att.title || att.name).toLowerCase(), { kind: att.kind, ref: att });
    }
  }
  const looksLikeMention = (ctx.mentions?.length || 0) > 0 || (ctx.attachments?.length || 0) > 0;

  const out = [];
  let i = 0; let m; let counter = 0;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(str)) != null) {
    if (m.index > i) {
      // Process the in-between text through inline markdown.
      out.push(...renderTextSegment(str.slice(i, m.index), ctx, `${keyPrefix}-${counter++}`));
    }
    const tokenName = m[1].trim().toLowerCase();
    const hit = mentionMap.get(tokenName);
    if (hit) {
      out.push(<span key={`${keyPrefix}-mn${counter++}`} className={`msg-pill msg-pill-${hit.kind}`}>{m[0]}</span>);
    } else if (looksLikeMention) {
      out.push(<span key={`${keyPrefix}-mn${counter++}`} className="msg-pill msg-pill-user">{m[0]}</span>);
    } else {
      out.push(...renderTextSegment(m[0], ctx, `${keyPrefix}-${counter++}`));
    }
    i = m.index + m[0].length;
  }
  if (i < str.length) {
    out.push(...renderTextSegment(str.slice(i), ctx, `${keyPrefix}-${counter++}`));
  }
  return out;
}

// Process a plain-text run for inline code, bold, italic, auto-links,
// and search highlight. No mentions here — those are pulled out in
// the wrapping renderInline pass.
function renderTextSegment(str, ctx, keyPrefix) {
  if (!str) return [];

  // Inline code first — its contents must NOT be processed for bold/
  // italic/auto-link.
  const codeParts = splitOn(str, INLINE_CODE_RE, (full, inner, key) => (
    <code key={key} className="msg-inline-code">{inner}</code>
  ), keyPrefix + '-c');

  // Now bold / italic / auto-links recursively on the string parts.
  return codeParts.flatMap((part, idx) => {
    if (typeof part !== 'string') return [part];
    const k = `${keyPrefix}-${idx}`;
    const boldParts = splitOn(part, BOLD_RE, (full, inner, key) => (
      <strong key={key} className="msg-bold">{inner}</strong>
    ), k + '-b');
    const italicParts = boldParts.flatMap((bp, j) => {
      if (typeof bp !== 'string') return [bp];
      // ITALIC_RE has a lookbehind-ish prefix; preserve it.
      const segs = [];
      let last = 0; let mm; let cc = 0;
      ITALIC_RE.lastIndex = 0;
      while ((mm = ITALIC_RE.exec(bp)) != null) {
        if (mm.index > last) segs.push(bp.slice(last, mm.index + (mm[1] || '').length));
        else if (mm[1]) segs.push(mm[1]);
        segs.push(<em key={`${k}-i${j}-${cc++}`} className="msg-italic">{mm[2]}</em>);
        last = mm.index + mm[0].length;
      }
      if (last < bp.length) segs.push(bp.slice(last));
      return segs;
    });
    // Last inline pass: auto-link URLs and search-highlight.
    return italicParts.flatMap((ip, j) => {
      if (typeof ip !== 'string') return [ip];
      return autoLinkAndHighlight(ip, ctx, `${k}-l${j}`);
    });
  });
}

// Wrap http(s) URLs in <a>, then auto-detect entity-name matches,
// then run the search highlight overlay.
function autoLinkAndHighlight(str, ctx, keyPrefix) {
  // 1. URL auto-link first.
  const urlOut = [];
  let i = 0; let m; let counter = 0;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(str)) != null) {
    if (m.index > i) urlOut.push(str.slice(i, m.index));
    urlOut.push(
      <a key={`${keyPrefix}-u${counter++}`}
         className="msg-link"
         href={m[0]} target="_blank" rel="noopener noreferrer"
         title={m[0]}>{truncateUrl(m[0])}</a>
    );
    i = m.index + m[0].length;
  }
  if (i < str.length) urlOut.push(str.slice(i));

  // 2. Entity auto-detect on the remaining string segments. Wraps
  //    matched ranges in <EntityLink term=... refs={...}> chips so
  //    hover/click work the same as everywhere else.
  const trie = ctx.trie;
  const withEntities = !trie ? urlOut : urlOut.flatMap((p, idx) => {
    if (typeof p !== 'string') return [p];
    const matches = scanForAutoLinks(p, trie);
    if (!matches.length) return [p];
    const segs = [];
    let last = 0; let cc = 0;
    for (const mm of matches) {
      if (mm.start > last) segs.push(p.slice(last, mm.start));
      segs.push(
        <EntityLink
          key={`${keyPrefix}-e${idx}-${cc++}`}
          term={mm.text}
          workspaceId={ctx.workspaceId}
          asTag="span"
        >{mm.text}</EntityLink>
      );
      last = mm.end;
    }
    if (last < p.length) segs.push(p.slice(last));
    return segs;
  });

  // 3. Highlight pass — only on the remaining string parts.
  const q = (ctx.highlight || '').trim();
  if (!q) return withEntities;
  return withEntities.flatMap((p, idx) => {
    if (typeof p !== 'string') return [p];
    const segs = [];
    const re2 = new RegExp(escapeReg(q), 'gi');
    let last = 0; let mm; let cc = 0;
    while ((mm = re2.exec(p)) != null) {
      if (mm.index > last) segs.push(p.slice(last, mm.index));
      segs.push(<mark key={`${keyPrefix}-hl${idx}-${cc++}`} className="msg-bubble-mark">{mm[0]}</mark>);
      last = mm.index + mm[0].length;
    }
    if (last < p.length) segs.push(p.slice(last));
    return segs;
  });
}

// Generic helper: split a string on a regex; for each match emit the
// React node from `transform(full, group1, key)`.
function splitOn(str, re, transform, keyPrefix) {
  const out = [];
  let i = 0; let m; let counter = 0;
  re.lastIndex = 0;
  while ((m = re.exec(str)) != null) {
    if (m.index > i) out.push(str.slice(i, m.index));
    out.push(transform(m[0], m[1] || '', `${keyPrefix}-${counter++}`));
    i = m.index + m[0].length;
  }
  if (i < str.length) out.push(str.slice(i));
  return out;
}

// ── Block-level pass ────────────────────────────────────────────────
// Split the body into block elements: fenced code, blockquotes, lists,
// paragraphs. Each block is wrapped in the appropriate React node
// with renderInline for its inner content.

export function renderMessageBody(body, ctx = {}) {
  if (!body) return null;

  // 1. Pull fenced code blocks first — opaque, never touched by
  //    inline parsing.
  const blocks = [];
  let lastEnd = 0; let m; let counter = 0;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(body)) != null) {
    if (m.index > lastEnd) {
      blocks.push({ kind: 'text', value: body.slice(lastEnd, m.index) });
    }
    blocks.push({ kind: 'code', value: m[1].replace(/^\n/, '') });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < body.length) blocks.push({ kind: 'text', value: body.slice(lastEnd) });

  // 2. For text runs, group by line into paragraph / blockquote / list.
  const out = [];
  for (const blk of blocks) {
    if (blk.kind === 'code') {
      out.push(
        <pre key={`pre-${counter++}`} className="msg-code-block">
          <code>{blk.value}</code>
        </pre>
      );
      continue;
    }
    const lines = blk.value.split(/\n/);
    let buffer = [];
    let listAcc = null; // { ordered: bool, items: string[] }
    let quoteAcc = null; // string[]

    const flushPara = () => {
      if (buffer.length === 0) return;
      const text = buffer.join('\n');
      out.push(
        <p key={`p-${counter++}`} className="msg-line">
          {renderInline(text, ctx, `p${counter}`)}
        </p>
      );
      buffer = [];
    };
    const flushList = () => {
      if (!listAcc) return;
      const Tag = listAcc.ordered ? 'ol' : 'ul';
      out.push(
        <Tag key={`list-${counter++}`} className="msg-list">
          {listAcc.items.map((it, idx) => (
            <li key={idx}>{renderInline(it, ctx, `li${counter}-${idx}`)}</li>
          ))}
        </Tag>
      );
      listAcc = null;
    };
    const flushQuote = () => {
      if (!quoteAcc) return;
      out.push(
        <blockquote key={`q-${counter++}`} className="msg-quote">
          {renderInline(quoteAcc.join('\n'), ctx, `q${counter}`)}
        </blockquote>
      );
      quoteAcc = null;
    };

    for (const line of lines) {
      const ulMatch = /^[-*]\s+(.+)$/.exec(line);
      const olMatch = /^\d+\.\s+(.+)$/.exec(line);
      const quoteMatch = /^>\s?(.*)$/.exec(line);

      if (ulMatch) {
        flushPara(); flushQuote();
        if (!listAcc || listAcc.ordered) { flushList(); listAcc = { ordered: false, items: [] }; }
        listAcc.items.push(ulMatch[1]);
      } else if (olMatch) {
        flushPara(); flushQuote();
        if (!listAcc || !listAcc.ordered) { flushList(); listAcc = { ordered: true, items: [] }; }
        listAcc.items.push(olMatch[1]);
      } else if (quoteMatch) {
        flushPara(); flushList();
        if (!quoteAcc) quoteAcc = [];
        quoteAcc.push(quoteMatch[1]);
      } else {
        flushList(); flushQuote();
        // Empty line → break paragraphs apart.
        if (line.trim() === '') flushPara();
        else buffer.push(line);
      }
    }
    flushPara(); flushList(); flushQuote();
  }
  return out;
}
