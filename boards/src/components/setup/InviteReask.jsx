// InviteReask — the setup's one more ask (workspaceSetup.js reaskDue): someone
// who skipped the invite step, once their workspace has some work in it, sees
// their own pictures and the same invite panel, link first. "Not now" until
// something went out, then "Done". Asked once, ever; the host keeps the record.

import './setup.css';
import './setupInWorkspace.css';
import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { Icon } from '../Icon.jsx';
import { R2Image } from '../R2Image.jsx';
import { registerModalOpen } from '../../lib/modalGuard.js';
import { InviteStep } from './InviteStep.jsx';

const MAX_PICS = 5;

export default function InviteReask({ workspace, boardIds = [], loadPhotos, isPhone, onClose }) {
  const [pics, setPics] = useState([]);
  const [out, setOut] = useState(false);
  const counts = useRef({ emails: 0, links: 0 });
  const headRef = useRef(null);
  const closedRef = useRef(false);
  const name = workspace?.name || 'Your workspace';

  // Their newest pictures: the cluster they're in, then the others asked for.
  useEffect(() => {
    if (!loadPhotos) return undefined;
    let cancelled = false;
    (async () => {
      const seen = new Set();
      const found = [];
      for (const id of boardIds) {
        if (!id || found.length >= MAX_PICS) continue;
        const list = await Promise.resolve(loadPhotos(id)).catch(() => []);
        for (const p of list || []) {
          if (p?.src && !seen.has(p.src) && found.length < MAX_PICS) { seen.add(p.src); found.push(p); }
        }
      }
      if (!cancelled) setPics(found);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPhotos, boardIds.join('|')]);

  const close = (action) => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose?.(action, { ...counts.current });
  };

  // A dialog like any other: Escape closes it, and the canvas keeps its keys.
  useEffect(() => registerModalOpen({ onEscape: () => { close(out ? 'done' : 'close'); return true; } }), [out]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { headRef.current?.focus?.(); }, []);

  return (
    <>
      <div className="su-ra-scrim" aria-hidden="true" onClick={() => close(out ? 'done' : 'close')} />
      <div className={`su-ra${isPhone ? ' is-phone' : ''}`} role="dialog" aria-modal="true" aria-labelledby="su-ra-h">
        <button type="button" className="su-ra-x" aria-label="Close" onClick={() => close(out ? 'done' : 'close')}>
          <Icon as={X} size={16} weight="regular" />
        </button>
        {pics.length > 0 && (
          <div className="su-ra-pics" aria-hidden="true">
            {pics.map((p) => <span key={p.id || p.src} className="su-ra-pic"><R2Image src={p.src} alt="" /></span>)}
          </div>
        )}
        <h2 className="su-ra-h" id="su-ra-h" ref={headRef} tabIndex={-1}>{name} is taking shape.<br />Who should see it?</h2>
        <p className="su-ra-sub">Send a collaborator or a client the link. They see what you add, as you add it.</p>
        <InviteStep workspaceId={workspace?.id || null} workspaceName={name} surface="reask" isPhone={isPhone}
          onOut={(how) => {
            setOut(true);
            if (how === 'link') counts.current.links += 1;
          }}
          onInvited={(emails) => { counts.current.emails += emails.length; }} />
        <div className="su-ra-foot">
          {out
            ? <button type="button" className="su-btn su-primary" onClick={() => close('done')}>Done</button>
            : <button type="button" className="su-btn su-quiet" onClick={() => close('not_now')}>Not now</button>}
        </div>
      </div>
    </>
  );
}
