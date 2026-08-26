// Documentation — the whole /docs site, indexed and searchable, without
// leaving the app to go looking for it.
//
// The registry is loaded on demand rather than imported at the top. It is
// ~145KB of generated JSON and today only the Worker and the lazy DocsPage
// chunk pull it in; importing it here would put all of that in AppShell for
// everyone, to serve a tab most people open never. The dynamic import puts it
// in a chunk that DocsPage shares.
//
// Every link opens in a new tab. Losing an unsaved canvas to a same-tab
// navigation is a poor trade for a help link — the same reason the ⌘K
// "Documentation" command does it.
import { useEffect, useMemo, useState } from 'react';
import { SettingsCategory } from './fields.jsx';

export function DocsTab() {
  const [reg, setReg] = useState(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    import('../../lib/docsiteIndex.js')
      .then((m) => {
        if (!alive) return;
        setReg({ sections: m.DOCS_SECTIONS || [], pages: m.DOCS_PAGES || [] });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // Titles alone are too thin to search: "scroll wheel" has to find the
  // keyboard page, whose heading for it reads "Swapping what the wheel does".
  // So headings, the one-line answer and the FAQ go in too — between them they
  // are what the page actually tells you, in the words a reader would use.
  const haystack = useMemo(() => {
    const map = new Map();
    for (const p of reg?.pages || []) {
      map.set(p.path, [
        p.navLabel, p.h1, p.title, p.answer,
        ...(p.headings || []).map((h) => h.text),
        ...(p.faq || []).flatMap((f) => [f.q, f.a]),
      ].filter(Boolean).join(' ').toLowerCase());
    }
    return map;
  }, [reg]);

  const query = q.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!reg) return [];
    return reg.sections
      .map((s) => ({
        ...s,
        pages: reg.pages
          .filter((p) => p.section === s.id)
          .filter((p) => !query || (haystack.get(p.path) || '').includes(query))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      }))
      .filter((s) => s.pages.length > 0);
  }, [reg, query, haystack]);

  const hits = groups.reduce((n, s) => n + s.pages.length, 0);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Documentation</h3>
      <p className="settings-section-hint">
        Every page of the handbook, including the{' '}
        <a href="/docs/api" target="_blank" rel="noreferrer noopener">REST API</a> and{' '}
        <a href="/docs/mcp" target="_blank" rel="noreferrer noopener">MCP</a> reference.
        {' '}Links open in a new tab so you never lose what is on your canvas.
      </p>

      <input
        className="settings-input"
        type="search"
        placeholder="Search the docs — try “scroll wheel” or “export”"
        aria-label="Search documentation"
        value={q}
        onChange={(e) => setQ(e.target.value)} />

      {failed ? (
        <p className="settings-section-hint">
          Couldn’t load the index.{' '}
          <a href="/docs" target="_blank" rel="noreferrer noopener">Open the docs site</a> instead.
        </p>
      ) : !reg ? (
        <div className="settings-empty">Loading…</div>
      ) : !hits ? (
        <p className="settings-section-hint">
          Nothing matches “{q.trim()}”. Try a different word, or{' '}
          <a href="/docs" target="_blank" rel="noreferrer noopener">browse the docs site</a>.
        </p>
      ) : (
        groups.map((s) => (
          <SettingsCategory key={s.id} title={s.label} desc={query ? null : s.blurb}>
            <div className="settings-doclist">
              {s.pages.map((p) => (
                <a key={p.path} className="settings-doc-item"
                   href={p.path} target="_blank" rel="noreferrer noopener">
                  <span className="settings-doc-title">{p.navLabel || p.h1}</span>
                  {p.answer && <span className="settings-doc-blurb">{p.answer}</span>}
                </a>
              ))}
            </div>
          </SettingsCategory>
        ))
      )}

      <p className="settings-section-hint" style={{ marginTop: 16 }}>
        <a href="/docs" target="_blank" rel="noreferrer noopener">Open the full documentation →</a>
        {' '}It is also readable as plain Markdown at <code>/docs/*.md</code>, and
        {' '}as <code>/llms.txt</code> for AI agents.
      </p>
    </div>
  );
}
