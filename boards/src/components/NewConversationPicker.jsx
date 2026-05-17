import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Search, X, Check } from '../lib/icons.js';
import { useWorkspaceMembers } from '../hooks/useWorkspaceMembers.js';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { findOrCreateDm, createGroupConversation } from '../lib/messages.js';

// 2-stage popover: pick people, then optionally name the group.
//   workspaceId
//   currentUserId — excluded from the member list
//   anchor — DOMRect to position against
//   onCreated(conversationId) — called once the conversation exists
//   onClose()
const PAD = 8;
const WIDTH = 320;

export function NewConversationPicker({ workspaceId, currentUserId, anchor, onCreated, onClose }) {
  const { members } = useWorkspaceMembers(workspaceId);
  const [stage, setStage] = useState('pick');           // 'pick' | 'name'
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]);             // array of user_id
  const [title, setTitle] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 480 });
  const [busy, setBusy] = useState(false);
  const popRef = useRef(null);
  const inputRef = useRef(null);

  // Resolve names for every member so the list isn't all "Member".
  useEffect(() => {
    for (const m of members || []) userProfiles.resolve(m.user_id);
  }, [members]);
  const [, force] = useState(0);
  useEffect(() => userProfiles.subscribe(() => force(n => (n + 1) | 0)), []);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const spaceBelow = vh - anchor.bottom - PAD;
      const spaceAbove = anchor.top - PAD;
      const placeAbove = spaceBelow < 320 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(Math.max(placeAbove ? spaceAbove : spaceBelow, 240) - PAD, Math.round(vh * 0.7));
      const top = placeAbove
        ? Math.max(PAD, anchor.top - maxHeight - PAD)
        : Math.min(vh - maxHeight - PAD, anchor.bottom + PAD);
      const left = Math.min(Math.max(PAD, anchor.left), vw - WIDTH - PAD);
      setPos({ top, left, maxHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => { inputRef.current?.focus(); }, [stage]);

  const visibleMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members || [])
      .filter(m => m.user_id !== currentUserId)
      .map(m => {
        const p = userProfiles.get(m.user_id);
        return {
          user_id: m.user_id,
          name: p?.name || p?.email || 'Member',
          email: p?.email || '',
          color: p?.color || pickPresenceColor(m.user_id),
        };
      })
      .filter(m => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, query, currentUserId]);

  const togglePick = (userId) => {
    setPicked(p => p.includes(userId) ? p.filter(x => x !== userId) : [...p, userId]);
  };

  const handleContinue = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    try {
      if (picked.length === 1) {
        const convId = await findOrCreateDm({ workspaceId, peerId: picked[0] });
        if (convId) onCreated?.(convId);
        onClose?.();
      } else {
        setStage('name');
        setBusy(false);
      }
    } catch (e) {
      console.warn('[NewConversationPicker] start DM failed', e);
      setBusy(false);
    }
  };

  const handleCreateGroup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const convId = await createGroupConversation({
        workspaceId,
        title: title.trim() || null,
        memberIds: picked,
      });
      if (convId) onCreated?.(convId);
      onClose?.();
    } catch (e) {
      console.warn('[NewConversationPicker] create group failed', e);
      setBusy(false);
    }
  };

  return (
    <div
      ref={popRef}
      className="msg-newconv-pop"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: WIDTH, maxHeight: pos.maxHeight }}
      role="dialog"
    >
      <div className="msg-newconv-head">
        <span className="t-eyebrow">
          {stage === 'pick' ? (picked.length >= 2 ? `NEW GROUP CHAT · ${picked.length}` : 'NEW CHAT') : 'NAME THIS GROUP'}
        </span>
        <button className="msg-panel-icon" onClick={onClose} title="Close" aria-label="Close">
          <Icon as={X} size={12} />
        </button>
      </div>

      {stage === 'pick' ? (
        <>
          <div className="msg-newconv-search">
            <Icon as={Search} size={12} />
            <input
              ref={inputRef}
              className="msg-newconv-input"
              placeholder="Find people…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && picked.length > 0) { e.preventDefault(); handleContinue(); } }}
            />
          </div>
          {picked.length > 0 && (
            <div className="msg-newconv-chips">
              {picked.map(uid => {
                const p = userProfiles.get(uid);
                return (
                  <button key={uid} className="msg-newconv-chip" onClick={() => togglePick(uid)} title="Remove">
                    {p?.name || p?.email || 'Member'} ×
                  </button>
                );
              })}
            </div>
          )}
          <div className="msg-newconv-list">
            {visibleMembers.length === 0 && (
              <div className="msg-empty t-meta">No members match.</div>
            )}
            {visibleMembers.map(m => {
              const sel = picked.includes(m.user_id);
              return (
                <button
                  key={m.user_id}
                  className={`msg-newconv-row ${sel ? 'is-picked' : ''}`}
                  onClick={() => togglePick(m.user_id)}
                >
                  <span className="msg-row-avatar" style={{ background: m.color }}>
                    {(m.name || 'M').charAt(0).toUpperCase()}
                  </span>
                  <span className="msg-row-text">
                    <span className="msg-row-name">{m.name}</span>
                    {m.email && m.email !== m.name && (
                      <span className="msg-row-preview t-meta">{m.email}</span>
                    )}
                  </span>
                  {sel && <Icon as={Check} size={14} />}
                </button>
              );
            })}
          </div>
          <div className="msg-newconv-foot">
            <button
              className="msg-newconv-btn primary"
              disabled={picked.length === 0 || busy}
              onClick={handleContinue}
            >
              {picked.length <= 1 ? 'Start chat' : 'Next →'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="msg-newconv-name-body">
            <label className="t-eyebrow">TITLE (OPTIONAL)</label>
            <input
              ref={inputRef}
              className="msg-newconv-input"
              placeholder="Leave blank to use member names"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateGroup(); } }}
              maxLength={80}
            />
            <div className="msg-newconv-members t-meta">
              {picked.map(uid => userProfiles.get(uid)?.name || userProfiles.get(uid)?.email || 'Member').join(', ')}
            </div>
          </div>
          <div className="msg-newconv-foot">
            <button className="msg-newconv-btn" onClick={() => setStage('pick')}>← Back</button>
            <button
              className="msg-newconv-btn primary"
              disabled={busy}
              onClick={handleCreateGroup}
            >
              Create
            </button>
          </div>
        </>
      )}
    </div>
  );
}
