// Spawns the autotag web worker for a workspace, hydrates it with
// training data, and exposes a `suggestTags(content, targetKey)`
// function for callers (CanvasSurface, DocPageEditor, etc).
//
// Lifecycle:
//   - On workspaceId change: hydrate corpus from applied
//     entity_links (joined with card titles + bodies + board names)
//     and post a single 'init' to the worker.
//   - Subscribe to entity_links realtime, filtered to applied tag
//     rows. New row → fetch the source's text, post 'addApplied'.
//     Delete → post 'removeApplied' (worker rebuilds index).
//   - Subscribe to autotag_ignored realtime, refresh ignored map.
//   - Subscribe to tags realtime, push 'tags' updates so renames /
//     new aliases land in the scorer.
//
// The worker module is imported with Vite's `?worker` syntax so it
// gets a separate bundle and runs off the main thread.

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import AutotagWorker from '../lib/autotagWorker.js?worker';
import * as perf from '../lib/perf.js';

function targetKey(kind, id) {
  return `${kind}:${id}`;
}

function makeText(title, body) {
  return [title || '', body || ''].filter(Boolean).join(' ').trim();
}

export function useAutotagWorker(workspaceId) {
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map()); // requestId -> resolve
  const reqIdRef = useRef(1);
  const [ready, setReady] = useState(false);

  // Spawn worker once.
  useEffect(() => {
    if (!workspaceId) return;
    const w = new AutotagWorker();
    workerRef.current = w;
    w.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'ready') {
        setReady(true);
      } else if (msg.type === 'scored') {
        const resolve = pendingRef.current.get(msg.requestId);
        if (resolve) {
          pendingRef.current.delete(msg.requestId);
          resolve(msg.suggestions || []);
        }
      }
    };
    return () => {
      try { w.terminate(); } catch {}
      workerRef.current = null;
      pendingRef.current.clear();
      setReady(false);
    };
  }, [workspaceId]);

  // Hydrate corpus + ignored + tags, post init.
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const w = workerRef.current;
      if (!w || !workspaceId) return;
      // Run the three top-level queries in parallel — we don't depend
      // on one another's results until enrichment, so this saves a
      // round-trip's worth of latency on cold starts.
      const [tagsResp, linksResp, ignResp] = await Promise.all([
        supabase.from('tags')
          .select('id, name, slug, color')
          .eq('workspace_id', workspaceId),
        supabase.from('entity_links')
          .select('source_kind, source_id, source_board_id, target_id')
          .eq('source_workspace', workspaceId)
          .eq('target_kind', 'tag')
          .eq('link_kind', 'applied'),
        supabase.from('autotag_ignored')
          .select('target_kind, target_id, tag_id')
          .eq('workspace_id', workspaceId),
      ]);
      // Group source ids per kind for batched lookup.
      const cardKeys = new Set();
      const boardIds = new Set();
      for (const r of (linksResp.data || [])) {
        if (r.source_kind === 'card' && r.source_board_id && r.source_id) {
          cardKeys.add(`${r.source_board_id}:${r.source_id}`);
        } else if (r.source_kind === 'board' && r.source_id) {
          boardIds.add(r.source_id);
        }
      }
      // Resolve text for cards (card_index) and boards. Also in parallel.
      const cardText = new Map(); // boardId:cardId -> text
      const boardText = new Map(); // boardId -> text
      const cardIds = cardKeys.size > 0
        ? Array.from(new Set(Array.from(cardKeys).map(k => k.split(':')[1])))
        : [];
      const boardIdList = Array.from(boardIds);
      const [ciResp, bResp] = await Promise.all([
        cardIds.length > 0
          ? supabase.from('card_index')
              .select('board_id, card_id, title, body')
              .eq('workspace_id', workspaceId)
              .in('card_id', cardIds)
          : Promise.resolve({ data: [] }),
        boardIdList.length > 0
          ? supabase.from('boards').select('id, name').in('id', boardIdList)
          : Promise.resolve({ data: [] }),
      ]);
      for (const c of (ciResp.data || [])) {
        cardText.set(`${c.board_id}:${c.card_id}`, makeText(c.title, c.body));
      }
      for (const b of (bResp.data || [])) boardText.set(b.id, b.name || '');
      // Build the corpus passed to the worker.
      const _t0 = perf.isEnabled() ? performance.now() : 0;
      const corpus = [];
      for (const r of (linksResp.data || [])) {
        let text = '';
        let key = '';
        if (r.source_kind === 'card' && r.source_board_id && r.source_id) {
          text = cardText.get(`${r.source_board_id}:${r.source_id}`) || '';
          key = `card:${r.source_board_id}:${r.source_id}`;
        } else if (r.source_kind === 'board' && r.source_id) {
          text = boardText.get(r.source_id) || '';
          key = `board:${r.source_id}`;
        }
        if (text) corpus.push({ tagId: r.target_id, text, key });
      }
      const ignored = {};
      for (const r of (ignResp.data || [])) {
        const k = targetKey(r.target_kind, r.target_id);
        if (!ignored[k]) ignored[k] = [];
        ignored[k].push(r.tag_id);
      }
      if (_t0) {
        const ms = performance.now() - _t0;
        perf.mark('autotag.corpus.ms', ms);
        perf.bump('autotag.runs');
        perf.gauge('autotag.corpusSize', corpus.length);
        if (ms > 50) console.warn('[perf] slow autotag.corpus', `${ms.toFixed(0)}ms`, `${corpus.length} items`);
      }
      if (cancelled) return;
      w.postMessage({
        type: 'init',
        workspaceId,
        tags: tagsResp.data || [],
        corpus,
        ignored,
      });
    }
    // Round 14: defer corpus hydration until after first paint. The
    // worker is needed for tag suggestions on keystroke — NOT on the
    // cold-load critical path. Hydrating synchronously on workspace
    // mount fired 4 Supabase queries + a sync corpus loop during the
    // user-perceived "freeze" window. requestIdleCallback lets the
    // browser fit this in once the canvas has painted. 1s timeout so
    // tag suggestions still come online quickly on busy devices.
    const scheduleIdle = (typeof window !== 'undefined' && window.requestIdleCallback)
      ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 })
      : (fn) => setTimeout(fn, 250);
    const cancelIdle = (typeof window !== 'undefined' && window.cancelIdleCallback)
      ? (id) => window.cancelIdleCallback(id)
      : (id) => clearTimeout(id);
    const idleId = scheduleIdle(() => {
      if (cancelled) return;
      hydrate().catch(err => console.warn('[autotag] hydrate failed', err));
    });
    return () => {
      cancelled = true;
      try { cancelIdle(idleId); } catch (_) {}
    };
  }, [workspaceId]);

  // Realtime: tag definitions (rename / recolor / new tag).
  useEffect(() => {
    const w = workerRef.current;
    if (!w || !workspaceId) return;
    const ch = supabase.channel(`autotag-tags-${workspaceId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tags', filter: `workspace_id=eq.${workspaceId}` },
        async () => {
          const { data } = await supabase.from('tags')
            .select('id, name, slug, color')
            .eq('workspace_id', workspaceId);
          w.postMessage({ type: 'tags', tags: data || [] });
        });
    ch.subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [workspaceId, ready]);

  // Realtime: applied entity_links — incremental add/remove.
  useEffect(() => {
    const w = workerRef.current;
    if (!w || !workspaceId) return;
    const ch = supabase.channel(`autotag-links-${workspaceId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'entity_links', filter: `source_workspace=eq.${workspaceId}` },
        async (payload) => {
          const r = payload?.new || {};
          if (r.target_kind !== 'tag' || r.link_kind !== 'applied') return;
          let text = '';
          let key = '';
          if (r.source_kind === 'card' && r.source_board_id && r.source_id) {
            const { data } = await supabase.from('card_index')
              .select('title, body')
              .eq('board_id', r.source_board_id)
              .eq('card_id', r.source_id)
              .maybeSingle();
            text = makeText(data?.title, data?.body);
            key = `card:${r.source_board_id}:${r.source_id}`;
          } else if (r.source_kind === 'board' && r.source_id) {
            const { data } = await supabase.from('boards')
              .select('name')
              .eq('id', r.source_id)
              .maybeSingle();
            text = data?.name || '';
            key = `board:${r.source_id}`;
          }
          if (text) w.postMessage({ type: 'addApplied', tagId: r.target_id, text, sourceKey: key });
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'entity_links', filter: `source_workspace=eq.${workspaceId}` },
        (payload) => {
          const r = payload?.old || {};
          if (r.target_kind !== 'tag' || r.link_kind !== 'applied') return;
          let key = '';
          if (r.source_kind === 'card' && r.source_board_id && r.source_id) {
            key = `card:${r.source_board_id}:${r.source_id}`;
          } else if (r.source_kind === 'board' && r.source_id) {
            key = `board:${r.source_id}`;
          }
          if (key) w.postMessage({ type: 'removeApplied', tagId: r.target_id, sourceKey: key });
        });
    ch.subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [workspaceId, ready]);

  // Realtime: ignored pairs.
  useEffect(() => {
    const w = workerRef.current;
    if (!w || !workspaceId) return;
    const ch = supabase.channel(`autotag-ignored-${workspaceId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autotag_ignored', filter: `workspace_id=eq.${workspaceId}` },
        async () => {
          const { data } = await supabase.from('autotag_ignored')
            .select('target_kind, target_id, tag_id')
            .eq('workspace_id', workspaceId);
          const ignored = {};
          for (const r of (data || [])) {
            const k = targetKey(r.target_kind, r.target_id);
            if (!ignored[k]) ignored[k] = [];
            ignored[k].push(r.tag_id);
          }
          w.postMessage({ type: 'setIgnored', ignored });
        });
    ch.subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [workspaceId, ready]);

  const suggestTags = useCallback((content, target) => {
    return new Promise((resolve) => {
      const w = workerRef.current;
      if (!w || !ready) { resolve([]); return; }
      const requestId = String(reqIdRef.current++);
      pendingRef.current.set(requestId, resolve);
      w.postMessage({
        type: 'score',
        requestId,
        content,
        targetKey: target ? targetKey(target.kind, target.id) : null,
      });
      // Safety: timeout pending requests so memory doesn't leak.
      setTimeout(() => {
        if (pendingRef.current.has(requestId)) {
          pendingRef.current.delete(requestId);
          resolve([]);
        }
      }, 5000);
    });
  }, [ready]);

  return { ready, suggestTags };
}
