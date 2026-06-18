// Pure screenplay interchange: Fountain (.fountain plain-text) + Final Draft
// (.fdx XML) import/export. NO Tiptap imports — unit-testable + bridge-exposed.
//
// A "block" is { element, text }. blocksToDocJSON / docJSONToBlocks bridge to
// the ProseMirror doc the editor uses (screenplayBlock nodes).

const FDX_TYPE = {
  scene: 'Scene Heading', action: 'Action', character: 'Character',
  parenthetical: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition',
  shot: 'Shot', centered: 'Action',
};
const TYPE_FDX = {
  'Scene Heading': 'scene', 'Action': 'action', 'Character': 'character',
  'Parenthetical': 'parenthetical', 'Dialogue': 'dialogue', 'Transition': 'transition',
  'Shot': 'shot', 'General': 'action',
};

const SCENE_RE = /^(INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)[\. ]/i;
const isAllCaps = (s) => /[A-Z]/.test(s) && !/[a-z]/.test(s);
const blockText = (b) => (b.text || '');

// ── Title page ───────────────────────────────────────────────────────────────
// Field ⇄ Fountain key. (Fountain title pages are a leading block of
// `Key: Value` pairs, values optionally continuing on indented lines,
// terminated by the first blank line.)
const TP_FIELD_TO_KEY = {
  title: 'Title', credit: 'Credit', authors: 'Author', source: 'Source',
  draftDate: 'Draft date', contact: 'Contact', copyright: 'Copyright', notes: 'Notes',
};
const TP_KEY_TO_FIELD = (() => {
  const m = {};
  for (const [field, key] of Object.entries(TP_FIELD_TO_KEY)) m[key.toLowerCase()] = field;
  m['authors'] = 'authors';   // alias
  m['date'] = 'draftDate';    // alias
  return m;
})();

export function jsonToFountainTitlePage(tp) {
  if (!tp || !tp.enabled) return '';
  const out = [];
  for (const [field, key] of Object.entries(TP_FIELD_TO_KEY)) {
    const v = (tp[field] == null ? '' : String(tp[field]));
    if (!v.trim()) continue;
    const lines = v.split('\n');
    if (lines.length === 1) out.push(`${key}: ${lines[0]}`);
    else { out.push(`${key}:`); for (const ln of lines) out.push(`    ${ln}`); }
  }
  return out.length ? out.join('\n') + '\n\n' : '';
}

// Split a Fountain string into { titlePage, body }. A title page is present
// only when the first non-blank line is a recognized `Key:`; otherwise the
// whole string is body (so a screenplay starting with "FADE IN:" isn't
// mistaken for metadata).
export function parseFountainTitlePage(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const fm = (lines[i] || '').match(/^([A-Za-z][A-Za-z0-9 _-]*):/);
  if (!fm || TP_KEY_TO_FIELD[fm[1].trim().toLowerCase()] === undefined) {
    return { titlePage: null, body: raw };
  }
  const tp = {};
  let curField = null;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.trim() === '') { i++; break; }
    const mt = ln.match(/^([A-Za-z][A-Za-z0-9 _-]*):\s?(.*)$/);
    if (mt && TP_KEY_TO_FIELD[mt[1].trim().toLowerCase()] !== undefined) {
      curField = TP_KEY_TO_FIELD[mt[1].trim().toLowerCase()];
      tp[curField] = mt[2] || '';
    } else if (/^\s+\S/.test(ln) && curField) {
      tp[curField] = (tp[curField] ? tp[curField] + '\n' : '') + ln.trim();
    } else {
      break; // unknown key or plain line → body starts here
    }
    i++;
  }
  while (i < lines.length && lines[i].trim() === '') i++;
  const body = lines.slice(i).join('\n');
  for (const k of Object.keys(tp)) tp[k] = (tp[k] || '').replace(/^\n+|\n+$/g, '');
  return { titlePage: { enabled: true, ...tp }, body };
}

// ── ProseMirror doc ⇄ blocks ────────────────────────────────────────────────
export function docJSONToBlocks(doc) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'screenplayBlock') {
      const text = (n.content || []).map(c => (c.type === 'text' ? (c.text || '') : '')).join('');
      const b = { element: n.attrs?.element || 'action', text };
      if (n.attrs?.sceneNumber) b.sceneNumber = n.attrs.sceneNumber;
      out.push(b);
      return;
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}

export function blocksToDocJSON(blocks) {
  return {
    type: 'doc',
    content: (blocks || []).map(b => ({
      type: 'screenplayBlock',
      attrs: { element: b.element || 'action', ...(b.sceneNumber ? { sceneNumber: String(b.sceneNumber) } : {}) },
      content: b.text ? [{ type: 'text', text: b.text }] : [],
    })),
  };
}

// ── Fountain ────────────────────────────────────────────────────────────────
export function jsonToFountain(docOrBlocks, titlePage = null) {
  const blocks = Array.isArray(docOrBlocks) ? docOrBlocks : docJSONToBlocks(docOrBlocks);
  const tpStr = jsonToFountainTitlePage(titlePage);
  const lines = [];
  const blankBefore = new Set(['scene', 'action', 'character', 'transition', 'shot']);
  for (const b of blocks) {
    const el = b.element || 'action';
    const text = blockText(b);
    if (blankBefore.has(el) && lines.length) lines.push('');
    switch (el) {
      case 'scene':
        lines.push(SCENE_RE.test(text) ? text.toUpperCase() : '.' + text.toUpperCase());
        break;
      case 'action': {
        // Force (leading !) when an action line would otherwise be misread as a
        // character cue or another forced element.
        const force = isAllCaps(text) || /^[>=~#.!@]/.test(text);
        lines.push(force ? '!' + text : text);
        break;
      }
      case 'character':
        lines.push(isAllCaps(text) ? text : '@' + text);
        break;
      case 'parenthetical': {
        const t = text.trim();
        lines.push(/^\(.*\)$/.test(t) ? t : `(${t.replace(/^\(|\)$/g, '')})`);
        break;
      }
      case 'dialogue':
        lines.push(text || ' ');
        break;
      case 'transition':
        lines.push(/TO:$/.test(text.toUpperCase()) ? text.toUpperCase() : '> ' + text.toUpperCase());
        break;
      case 'shot':
        lines.push(text.toUpperCase());
        break;
      case 'centered':
        lines.push('> ' + text.trim() + ' <');
        break;
      default:
        lines.push(text);
    }
  }
  return tpStr + lines.join('\n') + '\n';
}

export function fountainToBlocks(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let prevBlank = true;
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === '') { prevBlank = true; i++; continue; }

    // Forced markers.
    if (line[0] === '.' && line[1] !== '.') { blocks.push({ element: 'scene', text: line.slice(1).trim().toUpperCase() }); prevBlank = false; i++; continue; }
    if (line[0] === '!') { blocks.push({ element: 'action', text: line.slice(1) }); prevBlank = false; i++; continue; }
    if (line[0] === '>' && line.endsWith('<')) { blocks.push({ element: 'centered', text: line.slice(1, -1).trim() }); prevBlank = false; i++; continue; }
    if (line[0] === '>') { blocks.push({ element: 'transition', text: line.slice(1).trim().toUpperCase() }); prevBlank = false; i++; continue; }

    const forcedChar = line[0] === '@';
    const cue = forcedChar ? line.slice(1).trim() : line;

    if (SCENE_RE.test(line)) { blocks.push({ element: 'scene', text: line.toUpperCase() }); prevBlank = false; i++; continue; }
    if (isAllCaps(line) && /TO:$/.test(line)) { blocks.push({ element: 'transition', text: line }); prevBlank = false; i++; continue; }

    // Character cue: blank before + (forced @ OR all-caps) + a non-blank line follows.
    const nextNonBlank = (lines[i + 1] || '').trim() !== '';
    if (prevBlank && (forcedChar || isAllCaps(line)) && nextNonBlank) {
      blocks.push({ element: 'character', text: (forcedChar ? cue : line).toUpperCase() });
      i++;
      // Consume the speech block: parentheticals + dialogue until a blank line.
      while (i < lines.length && lines[i].trim() !== '') {
        const dl = lines[i].trim();
        if (/^\(.*\)$/.test(dl)) blocks.push({ element: 'parenthetical', text: dl });
        else blocks.push({ element: 'dialogue', text: dl });
        i++;
      }
      prevBlank = false;
      continue;
    }

    blocks.push({ element: 'action', text: line });
    prevBlank = false;
    i++;
  }
  return blocks;
}

// ── Final Draft (.fdx) ──────────────────────────────────────────────────────
function escapeXml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

// A Final Draft <TitlePage> with centered title/credit/authors/source and
// left/right-aligned contact/date so the file opens correctly in Final Draft.
function fdxTitlePageXml(tp) {
  if (!tp || !tp.enabled) return '';
  const para = (text, align) => {
    if (!text) return '';
    return String(text).split('\n').map(line =>
      `   <Paragraph Alignment="${align}"><Text>${escapeXml(line)}</Text></Paragraph>`).join('\n');
  };
  const parts = [
    para(tp.title, 'Center'), para(tp.credit, 'Center'), para(tp.authors, 'Center'),
    para(tp.source, 'Center'), para(tp.contact, 'Left'), para(tp.copyright, 'Left'),
    para(tp.draftDate, 'Right'), para(tp.notes, 'Right'),
  ].filter(Boolean);
  if (!parts.length) return '';
  return `\n <TitlePage>\n  <Content>\n${parts.join('\n')}\n  </Content>\n </TitlePage>`;
}

export function jsonToFdx(docOrBlocks, titlePage = null) {
  const blocks = Array.isArray(docOrBlocks) ? docOrBlocks : docJSONToBlocks(docOrBlocks);
  const paras = blocks.map(b => {
    const type = FDX_TYPE[b.element] || 'Action';
    // Locked scene numbers ride along as the Final Draft Number attribute.
    const num = (b.element === 'scene' && b.sceneNumber) ? ` Number="${escapeXml(b.sceneNumber)}"` : '';
    return `  <Paragraph Type="${type}"${num}><Text>${escapeXml(blockText(b))}</Text></Paragraph>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
 <Content>
${paras}
 </Content>${fdxTitlePageXml(titlePage)}
</FinalDraft>
`;
}

function directChild(parent, tag) {
  if (!parent) return null;
  const kids = parent.childNodes || [];
  for (let k = 0; k < kids.length; k++) {
    const n = kids[k];
    if (n.nodeType === 1 && (n.tagName === tag || n.localName === tag)) return n;
  }
  return null;
}

// Parse an .fdx string into body blocks. Needs a DOM (browser/jsdom).
// Scopes to the script's own <Content> so <TitlePage> paragraphs are NOT
// folded into the body (use fdxToTitlePage for those).
export function fdxToBlocks(xml) {
  if (typeof DOMParser === 'undefined') throw new Error('fdxToBlocks requires a DOM (DOMParser)');
  const doc = new DOMParser().parseFromString(String(xml || ''), 'application/xml');
  const root = doc.getElementsByTagName('FinalDraft')[0] || doc;
  const content = directChild(root, 'Content') || root;
  const out = [];
  const paras = content.getElementsByTagName('Paragraph');
  for (const p of paras) {
    const type = p.getAttribute('Type') || 'Action';
    const element = TYPE_FDX[type] || 'action';
    let text = '';
    const texts = p.getElementsByTagName('Text');
    for (const t of texts) text += t.textContent || '';
    const b = { element, text };
    const num = p.getAttribute('Number');
    if (element === 'scene' && num) b.sceneNumber = num;
    out.push(b);
  }
  return out;
}

// Best-effort parse of an .fdx <TitlePage> into our structured fields.
export function fdxToTitlePage(xml) {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(String(xml || ''), 'application/xml');
  const root = doc.getElementsByTagName('FinalDraft')[0] || doc;
  const tpEl = directChild(root, 'TitlePage') || root.getElementsByTagName('TitlePage')[0];
  if (!tpEl) return null;
  const paras = [];
  const ps = tpEl.getElementsByTagName('Paragraph');
  for (const p of ps) {
    let text = '';
    const ts = p.getElementsByTagName('Text');
    for (const t of ts) text += t.textContent || '';
    if (text.trim() === '') continue;
    paras.push({ text: text.trim(), align: (p.getAttribute('Alignment') || '').toLowerCase() });
  }
  if (!paras.length) return null;
  const tp = { enabled: true };
  tp.title = paras[0].text;
  const creditIdx = paras.findIndex((p, k) => k >= 1 && /^(written|screenplay|story|teleplay|adapted) by\b/i.test(p.text));
  if (creditIdx >= 0) {
    tp.credit = paras[creditIdx].text;
    const auth = [];
    for (let k = creditIdx + 1; k < paras.length; k++) {
      if (paras[k].align && paras[k].align !== 'center') break;
      auth.push(paras[k].text);
    }
    if (auth.length) tp.authors = auth.join('\n');
  }
  const left = paras.filter(p => p.align === 'left').map(p => p.text);
  if (left.length) tp.contact = left.join('\n');
  const right = paras.filter(p => p.align === 'right').map(p => p.text);
  if (right.length) { tp.draftDate = right[0]; if (right.length > 1) tp.notes = right.slice(1).join('\n'); }
  const cr = paras.find(p => /©|copyright/i.test(p.text));
  if (cr) tp.copyright = cr.text;
  return tp;
}

export { FDX_TYPE, TYPE_FDX };
