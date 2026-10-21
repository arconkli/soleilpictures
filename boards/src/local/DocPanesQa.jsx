// ?docqa=1&panes=1 — two docs side by side, as App hosts them (lib/docPanes.js).
//
// Three real RichDocCards on a stand-in board, and the real DockedDocPane in
// App's split pane and beside it, in the main pane's place, each inside the
// DocPaneFrame App uses: SplitContainer's .split-wrap > .split-pane chain, with
// the pane claims App makes. The board's Y.Doc is in memory; nothing reaches a
// backend. For tests/doc-panes.spec.js. DocQaHarness mounts this, and is only
// ever imported in a DEV build.
//
// &cold=1 holds each pane as App draws it while its board's Y.Doc is still on
// its way: DocOpening, with the pane's close (tests/doc-opening.spec.js).

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import * as docState from '../lib/docState.js';
import * as screenplayFlow from '../components/docExtensions/screenplay/screenplayFlow.js';
import * as screenplayIO from '../lib/screenplayIO.js';
import { NO_DOC_PANES, openBesideDock, dockDoc, closeDock, closeBeside } from '../lib/docPanes.js';
import { getActivePane, subscribeActivePane } from '../lib/activePane.js';
import { RichDocCard, DockedDocPane } from '../components/DocCard.jsx';
import { DocPaneFrame } from '../components/DocPaneFrame.jsx';
import { DocOpening } from '../components/DocOpening.jsx';

const BOARD_ID = 'docqa-board';
const DOCS = [
  { id: 'doc-a', title: 'Treatment', left: 40, top: 40 },
  { id: 'doc-b', title: 'Sundown Highway', left: 400, top: 40 },
  { id: 'doc-c', title: 'Notes', left: 40, top: 320 },
];
const COLD = new URLSearchParams(window.location.search).get('cold') === '1';
const USER = { id: 'docqa-user', name: 'QA Tester', email: 'qa@soleilpictures.com', color: '#d98c2b' };

function createBoard() {
  const ydoc = new Y.Doc();
  const cards = ydoc.getMap('cards');
  const maps = {};
  ydoc.transact(() => {
    for (const d of DOCS) {
      const m = new Y.Map();
      m.set('id', d.id);
      m.set('kind', 'doc');
      cards.set(d.id, m);
      maps[d.id] = m;
    }
  }, 'local');
  for (const d of DOCS) docState.initCardDocStore(ydoc, maps[d.id]);
  return { ydoc, maps };
}

export function DocPanesQa() {
  const [{ ydoc, maps }] = useState(createBoard);
  const [titles, setTitles] = useState(() => Object.fromEntries(DOCS.map((d) => [d.id, d.title])));
  const [panes, setPanes] = useState(NO_DOC_PANES);
  const [full, setFull] = useState({ dock: false, beside: false });
  const [activePane, setActivePaneState] = useState(() => getActivePane());
  useEffect(() => subscribeActivePane(setActivePaneState), []);

  const scopeOf = useMemo(() => {
    const scopes = {};
    for (const d of DOCS) scopes[d.id] = { ...docState.cardScope(maps[d.id]), cardId: d.id, docCardId: d.id, boardId: BOARD_ID };
    return (id) => scopes[id];
  }, [maps]);

  useEffect(() => {
    window.__soleilDocTest = {
      ...docState,
      ...(window.__soleilDocTest || {}), // keeps `editor`, which each DocSurface sets
      Y, ydoc, scopeOf, panes: () => panes, activePane: getActivePane,
      screenplay: { ...screenplayFlow, ...screenplayIO },
    };
  }, [ydoc, scopeOf, panes]);

  const cardOf = (id) => ({ id, kind: 'doc', title: titles[id] || '', x: 0, y: 0, w: 320, h: 240 });
  const retitle = (id) => (patch) => {
    if (patch && 'title' in patch) setTitles((t) => ({ ...t, [id]: patch.title || '' }));
  };
  const move = (next) => {
    setPanes(next);
    setFull({ dock: false, beside: false });
  };
  const docProps = (id) => ({
    card: cardOf(id), ydoc, cardYMap: maps[id], hostBoardId: BOARD_ID,
    workspaceId: null, userId: USER.id, currentUser: USER, getAwareness: () => null,
    boards: {}, wsPeers: [], onJumpToPeer: () => {}, canEdit: true, onUpdate: retitle(id),
  });
  const docked = panes.dock?.cardId || null;

  const docPane = (which) => {
    const id = panes[which].cardId;
    const pane = which === 'dock' ? 'split' : 'beside';
    const onClose = () => move(which === 'dock' ? closeDock(panes) : closeBeside(panes));
    return (
      <DocPaneFrame pane={pane} cardId={id}>
        {COLD ? <DocOpening onClose={onClose} /> : (
          <DockedDocPane {...docProps(id)} pane={pane}
                         onClose={onClose}
                         full={full[which]}
                         onSetFull={(v) => setFull((f) => ({ ...f, [which]: !!v }))} />
        )}
      </DocPaneFrame>
    );
  };

  return (
    <div data-docqa-panes-ready="" style={{ position: 'fixed', inset: 0, display: 'flex', background: 'var(--bg-1, #111)' }}>
      <div className="split-wrap">
        <div className={`split-pane${docked && activePane !== 'split' ? ' is-active' : ''}`}
             style={{ flex: docked ? 0.5 : 1 }}>
          <div className="surface-wrap is-canvas" data-docqa-canvas="">
            {DOCS.map((d) => (
              <div key={d.id} data-docqa-card={d.id}
                   style={{ position: 'absolute', left: d.left, top: d.top, width: 320, height: 240 }}>
                <RichDocCard {...docProps(d.id)}
                             onDock={({ cardId }) => move(dockDoc(panes, { cardId, boardId: BOARD_ID }))}
                             isDocked={docked === d.id}
                             onOpenBeside={docked && docked !== d.id
                               ? ({ cardId }) => move(openBesideDock(panes, { cardId, boardId: BOARD_ID }) || panes)
                               : null}
                             autoFocus={false} />
              </div>
            ))}
          </div>
          {panes.beside && docPane('beside')}
        </div>
        {docked && <div className="split-divider" />}
        {docked && (
          <div className={`split-pane${activePane === 'split' ? ' is-active' : ''}`} style={{ flex: 0.5 }}>
            {docPane('dock')}
          </div>
        )}
      </div>
    </div>
  );
}
