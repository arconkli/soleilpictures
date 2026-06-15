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

// ── ProseMirror doc ⇄ blocks ────────────────────────────────────────────────
export function docJSONToBlocks(doc) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'screenplayBlock') {
      const text = (n.content || []).map(c => (c.type === 'text' ? (c.text || '') : '')).join('');
      out.push({ element: n.attrs?.element || 'action', text });
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
      attrs: { element: b.element || 'action' },
      content: b.text ? [{ type: 'text', text: b.text }] : [],
    })),
  };
}

// ── Fountain ────────────────────────────────────────────────────────────────
export function jsonToFountain(docOrBlocks) {
  const blocks = Array.isArray(docOrBlocks) ? docOrBlocks : docJSONToBlocks(docOrBlocks);
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
  return lines.join('\n') + '\n';
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

export function jsonToFdx(docOrBlocks) {
  const blocks = Array.isArray(docOrBlocks) ? docOrBlocks : docJSONToBlocks(docOrBlocks);
  const paras = blocks.map(b => {
    const type = FDX_TYPE[b.element] || 'Action';
    return `  <Paragraph Type="${type}"><Text>${escapeXml(blockText(b))}</Text></Paragraph>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
 <Content>
${paras}
 </Content>
</FinalDraft>
`;
}

// Parse an .fdx string into blocks. Needs a DOM (browser/jsdom) for DOMParser.
export function fdxToBlocks(xml) {
  if (typeof DOMParser === 'undefined') throw new Error('fdxToBlocks requires a DOM (DOMParser)');
  const doc = new DOMParser().parseFromString(String(xml || ''), 'application/xml');
  const out = [];
  const paras = doc.getElementsByTagName('Paragraph');
  for (const p of paras) {
    const type = p.getAttribute('Type') || 'Action';
    const element = TYPE_FDX[type] || 'action';
    // Concatenate all <Text> runs in the paragraph.
    let text = '';
    const texts = p.getElementsByTagName('Text');
    for (const t of texts) text += t.textContent || '';
    out.push({ element, text });
  }
  return out;
}

export { FDX_TYPE, TYPE_FDX };
