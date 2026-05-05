import { useEffect, useRef, useCallback } from 'react';
import { Icon } from './Icon.jsx';
import { ChevronLeft, X } from '../lib/icons.js';
import { useMessageThread } from '../hooks/useMessageThread.js';
import { sendMessage, deleteMessage, editMessage, toggleReaction } from '../lib/messages.js';
import {
  broadcastBoardMessage, broadcastDmMessage,
  broadcastBoardTyping,  broadcastDmTyping,
} from '../lib/messageRealtime.js';
import { MessageBubble } from './MessageBubble.jsx';
import { MessageComposer } from './MessageComposer.jsx';
import { INBOX_MIME } from '../lib/dragMimes.js';
import { inboxPayloadFor } from '../lib/messageAttachments.js';

export function MessageThread({ workspaceId, currentUser, thread, onBack, onClose }) {
  const userId = currentUser?.id;
  const { messages, typingUsers, refetch } = useMessageThread({ workspaceId, userId, thread });
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(async ({ body, attachments, mentions }) => {
    const dmPeerId = thread.kind === 'dm' ? thread.peerId : null;
    const boardId  = thread.kind === 'board' ? thread.boardId : null;
    try {
      const inserted = await sendMessage({ workspaceId, boardId, dmPeerId, senderId: userId, body, attachments, mentions });
      const payload = { ...inserted, sender_name: currentUser?.name || currentUser?.email };
      if (boardId) await broadcastBoardMessage({ boardId, payload });
      else         await broadcastDmMessage({ userA: userId, userB: dmPeerId, payload });
      refetch();
    } catch (e) { console.warn('send failed', e); }
  }, [workspaceId, userId, thread, currentUser, refetch]);

  const handleDelete = useCallback(async (msg) => {
    await deleteMessage({ id: msg.id });
    refetch();
  }, [refetch]);

  const handleEdit = useCallback(async (msg, newBody) => {
    await editMessage({ id: msg.id, body: newBody });
    refetch();
  }, [refetch]);

  const handleReact = useCallback(async (msg, emoji) => {
    if (!emoji) return;
    await toggleReaction({ messageId: msg.id, emoji, userId });
    refetch();
  }, [userId, refetch]);

  const handleTyping = useCallback(() => {
    if (thread.kind === 'board') broadcastBoardTyping({ boardId: thread.boardId, userId });
    else                          broadcastDmTyping({ userA: userId, userB: thread.peerId, userId });
  }, [thread, userId]);

  const handleAttachmentDragStart = (e, att) => {
    const payload = inboxPayloadFor(att);
    if (!payload) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(INBOX_MIME, JSON.stringify(payload));
  };

  return (
    <div className="msg-panel">
      <div className="msg-panel-head">
        <button className="modal-close" onClick={onBack}><Icon as={ChevronLeft} size={16} /></button>
        <span className="t-eyebrow">{thread?.name || 'Thread'}</span>
        <button className="modal-close" onClick={onClose}><Icon as={X} size={16} /></button>
      </div>
      <div className="msg-thread-body" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="msg-empty t-meta">No messages yet — type one below.</div>
        )}
        {messages.map(m => (
          <MessageBubble
            key={m.id}
            msg={m}
            selfId={userId}
            onDelete={handleDelete}
            onAttachmentDragStart={handleAttachmentDragStart}
            onReact={handleReact}
            onEdit={handleEdit}
          />
        ))}
        {typingUsers.size > 0 && (
          <div className="msg-typing t-meta">{typingUsers.size === 1 ? 'Typing…' : `${typingUsers.size} typing…`}</div>
        )}
      </div>
      <MessageComposer onSend={handleSend} onTyping={handleTyping}
                       workspaceId={workspaceId} userId={userId} />
    </div>
  );
}
