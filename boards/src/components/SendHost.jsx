// The Send to… sheet, mounted once in the signed-in shell beside FileShareHost.
// Anything opens it with openSend() (lib/sendBus.js): a card's menu, a cluster
// row in the sidebar. The sheet is lazy, so the shell only carries this
// listener until someone sends something.
//
// Props: workspaceId, workspaceName, userId, userEmail,
//   boardInfo(boardId) → { name, coverKey, cardCount } | null,
//   onOpenConversation(conversationId) for the toast's "Open chat".
import { Suspense, useCallback, useEffect, useState } from 'react';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { SEND_EVENT, registerSendHost } from '../lib/sendBus.js';

const SendSheet = lazyWithReload(() => import('./SendSheet.jsx').then((m) => ({ default: m.SendSheet })));

export function SendHost({ workspaceId, workspaceName, userId, userEmail, boardInfo, onOpenConversation }) {
  const [req, setReq] = useState(null);
  useEffect(() => registerSendHost(), []);
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (!d.boardId) return;
      setReq({ ...d, cards: Array.isArray(d.cards) ? d.cards : [], seq: Date.now() });
    };
    document.addEventListener(SEND_EVENT, on);
    return () => document.removeEventListener(SEND_EVENT, on);
  }, []);
  const close = useCallback(() => setReq(null), []);
  if (!req) return null;
  return (
    <Suspense fallback={null}>
      <SendSheet
        key={`${req.boardId}:${req.seq}`}
        boardId={req.boardId}
        boardTitle={req.boardTitle || ''}
        cards={req.cards}
        surface={req.surface || null}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        userId={userId}
        userEmail={userEmail}
        boardInfo={boardInfo}
        onOpenConversation={onOpenConversation}
        onClose={close}
      />
    </Suspense>
  );
}
