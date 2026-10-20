// How tall a message field should be for what's in it: as tall as its text,
// never shorter than one line, and never taller than `maxLines` lines or
// `maxShare` of the panel it sits in. Past that it scrolls inside itself.
//
// `scrollHeight` is read with the field at height:auto, so it covers the text
// and the padding; the field is border-box, so the border goes on top.
export function fieldHeight({
  scrollHeight, lineHeight, paddingY = 0, borderY = 0,
  maxLines = 8, panelHeight = 0, maxShare = 0.4,
}) {
  const oneLine = lineHeight + paddingY + borderY;
  const byLines = lineHeight * maxLines + paddingY + borderY;
  const byPanel = panelHeight > 0 ? Math.floor(panelHeight * maxShare) : Infinity;
  const cap = Math.max(oneLine, Math.min(byLines, byPanel));
  const want = Math.max(oneLine, scrollHeight + borderY);
  return { height: Math.min(want, cap), scrolls: want > cap + 1 };
}
