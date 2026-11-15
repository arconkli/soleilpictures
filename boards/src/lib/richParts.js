// richParts — a translated line with **bold** runs, split into the rich parts
// the import tray draws (strings and { b } runs, never markup from strings).
// A whole sentence is one message with ** around its bold words, so a
// translator can move the bold with the words. A ** inside a placeholder value
// (a cluster's name) would only move the bold; a name is never parsed.

// 'Open **Takeout**.' → ['Open ', { b: 'Takeout' }, '.']
export function rich(s) {
  return String(s).split('**')
    .map((t, i) => (i % 2 ? { b: t } : t))
    .filter((p) => (typeof p === 'string' ? p : p.b));
}
