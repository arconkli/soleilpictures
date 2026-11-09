// anchorLocate — find the word a model claimed in a paragraph. The model's
// start_offset is only a hint (often off by a character or two), so every
// occurrence of the claimed text is found and the one closest to the hint
// wins. The claimed text is also tried in NFC and NFD, so a model that
// answers "Café" composed still finds "Café" pasted decomposed.
// Case-insensitive in every cased script (the 'i' flag is Unicode-aware for
// Cyrillic, Greek, accented Latin).
export function locateAnchor(text, claimed, aiStart) {
  const src = String(text || '');
  const forms = [...new Set([claimed, claimed.normalize('NFC'), claimed.normalize('NFD')])].filter(Boolean);
  let best = null;
  let bestDist = Infinity;
  for (const form of forms) {
    const re = new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let m;
    while ((m = re.exec(src)) !== null) {
      const dist = Number.isFinite(aiStart) ? Math.abs(m.index - aiStart) : 0;
      if (dist < bestDist) { bestDist = dist; best = { start: m.index, length: m[0].length }; }
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return best;
}
