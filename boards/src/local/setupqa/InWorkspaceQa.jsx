// The setup's part inside the workspace, for QA (?setupqa=1&inws=…, DEV only):
// the real SetupInWorkspace over the real sidebar (SidebarQaHarness), given
// what App would give it. Settings writes and analytics rows land in the
// setup harness's fake (window.__setupQa.db / events()); the rest is driven
// from window.__setupQa.inws:
//
//   setCards(n)        the account's own cards (and the open cluster's)
//   setUploading(b)    an upload in flight, or not
//   log                what the host asked of the app: 'open' / 'close' (the
//                      phone drawer) and 'guide' (the import guide)
//
//   &inws=tips         their own Northlight, the invite step done; 3 cards
//   &inws=reask        the same, the invite step skipped; 6 cards
//   &inws=joiner       just joined Nora's Lost Time by its link, landed on a cluster
//   &cards=N  &setup=A|B  &import=0 (no import guide here)  &wscards=N (joiner)
//   &drawer=0          a phone starts with the drawer shut, as App does

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { shellOf } from '../../lib/deviceShell.js';
import { markJoined } from '../../lib/workspaceLink.js';
import { Icon } from '../../components/Icon.jsx';
import { PanelLeftOpen } from '../../lib/icons.js';
import { SidebarQaHarness } from '../SidebarQaHarness.jsx';

const SetupInWorkspace = lazy(() => import('../../components/setup/SetupInWorkspace.jsx'));

const PHOTOS = Object.values(import.meta.glob('../qa-photos/*.jpg', { eager: true, query: '?url', import: 'default' }));

// Mounted in the same commit as the host, so once <html data-inws-ready> is
// set its timers are running and a spec can move the clock.
function Ready() {
  useEffect(() => { document.documentElement.setAttribute('data-inws-ready', '1'); }, []);
  return null;
}

// Three of a cluster's newest pictures, as loadClusterPhotos returns them.
async function loadPhotos(boardId) {
  const start = boardId === 'root' ? 3 : 0;
  return [0, 1, 2].map((i) => ({ id: `${boardId}-${i}`, src: PHOTOS[(start + i) % PHOTOS.length] }));
}

export default function InWorkspaceQa({ db, mode, qs }) {
  const { mobileShell } = shellOf(useBreakpoint());
  const me = db.users[0];
  const joiner = mode === 'joiner';
  const workspace = useMemo(() => db.workspaces.find((w) => w.id === (joiner ? 'ws-lost-time' : 'ws-northlight')), [db, joiner]);
  // The profile as it was read when the page loaded, as App's settings are.
  const settings = useMemo(() => JSON.parse(JSON.stringify(db.profiles[0].settings || {})), [db]);
  const [cards, setCards] = useState(() => (qs.has('cards') ? Number(qs.get('cards')) : mode === 'reask' ? 6 : joiner ? 0 : 3));
  const [uploading, setUploading] = useState(false);
  const [drawer, setDrawer] = useState(qs.get('drawer') !== '0');
  const [log] = useState(() => {
    // Joined by the link this visit, as AuthGate or the join card leaves it.
    if (joiner) markJoined(me.id, 'ws-lost-time');
    return [];
  });

  useEffect(() => {
    window.__setupQa.inws = { setCards, setUploading, log };
  }, [log]);

  // The sidebar harness draws the drawer open or shut from &drawer; here it
  // opens and shuts as App's does, from the menu button and the host.
  useEffect(() => {
    if (!mobileShell) return;
    document.querySelector('.sidebar')?.classList.toggle('is-mobile-open', drawer);
  }, [drawer, mobileShell]);

  return (
    <>
      <SidebarQaHarness />
      {mobileShell && (
        <div className="topbar" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50 }}>
          <div className="tb-left">
            <button className="tb-icon" title="Open menu" aria-label="Open menu" onClick={() => setDrawer(true)}>
              <Icon as={PanelLeftOpen} size={16} />
            </button>
          </div>
        </div>
      )}
      {mobileShell && drawer && (
        <div className="sidebar-mobile-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />
      )}
      <Suspense fallback={null}>
        <Ready />
        <SetupInWorkspace
          user={{ id: me.id, created_at: me.created_at }}
          workspace={workspace}
          settings={settings}
          settingsLoaded
          welcome={settings.welcome || null}
          arm={qs.get('setup') || null}
          ownCards={cards}
          boardCards={cards}
          wsCards={joiner ? Number(qs.get('wscards') || 0) : cards}
          uploading={uploading}
          phone={mobileShell}
          sidebarShown
          openDrawer={() => { log.push('open'); setDrawer(true); }}
          closeDrawer={() => { log.push('close'); setDrawer(false); }}
          canImport={qs.get('import') !== '0'}
          openGuide={() => { log.push('guide'); }}
          currentBoardId="film"
          rootBoardId="root"
          boardsReady
          loadPhotos={loadPhotos}
        />
      </Suspense>
    </>
  );
}
