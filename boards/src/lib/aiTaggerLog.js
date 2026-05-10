// Instrumentation for the AI tagger. Two things:
//   1. Per-suggestion structured console log (collapsed group). Gated by
//      localStorage `soleil.ai_tagger_debug` so it's off by default.
//   2. Cumulative session stats accessible from the console via
//      `window.aiTagger`: total calls, total tokens (embed + apply),
//      total cost estimate, latency histogram, and per-decision counts.
//
// Cost numbers are OpenAI list prices as of 2026-04 — keep them roughly
// honest, not penny-accurate. We round to 4 sig figs in the report.
const PRICE = {
  embed_in:        0.02 / 1_000_000,  // text-embedding-3-small
  completion_in:   0.15 / 1_000_000,  // gpt-4o-mini cached or fresh, roughly
  completion_out:  0.60 / 1_000_000,  // gpt-4o-mini output
};

const state = {
  calls: 0,
  applied_silent: 0,       // embedding distance said "yes" without AI
  applied_high: 0,         // AI verdict high
  surfaced_medium: 0,      // AI verdict medium (sidebar suggestion)
  dropped_low: 0,          // AI verdict low
  dropped_embedding: 0,    // tag fell outside any band
  embed_tokens: 0,
  apply_in_tokens: 0,
  apply_out_tokens: 0,
  apply_calls: 0,          // how many times we actually invoked /apply
  embed_ms_total: 0,
  apply_ms_total: 0,
  recent: [],              // last 50 decisions, for inspection
};

const MAX_RECENT = 50;

export function isDebug() {
  try { return localStorage.getItem('soleil.ai_tagger_debug') === '1'; }
  catch { return false; }
}

// Called once per suggestTags invocation with the full decision context.
// Pushes a console.groupCollapsed if debug is on, and always updates
// the rolling stats so `window.aiTagger.stats()` stays accurate.
export function logDecision(ctx) {
  recordCall(ctx);
  if (!isDebug()) return;
  const { input, target, perTag, verdicts, embedMs, applyMs, embedUsage, applyUsage } = ctx;

  const silentCount = perTag.filter(p => p.outcome === 'silent').length;
  const candidateCount = perTag.filter(p => p.outcome === 'candidate').length;
  const droppedCount = perTag.filter(p => p.outcome === 'dropped').length;
  const verdictCounts = verdicts.reduce((acc, v) => {
    acc[v.confidence] = (acc[v.confidence] || 0) + 1;
    return acc;
  }, {});

  const summary = [
    `[ai-tagger]`,
    target ? `${target.kind || '?'}:${(target.id || '').slice(0, 6)}` : 'unknown',
    `"${(input || '').slice(0, 60).replace(/\s+/g, ' ')}…"`,
    `→ ${silentCount} silent`,
    candidateCount ? `${candidateCount} → AI` : null,
    verdictCounts.high ? `${verdictCounts.high}↑` : null,
    verdictCounts.medium ? `${verdictCounts.medium}~` : null,
    verdictCounts.low ? `${verdictCounts.low}↓` : null,
    `(${Math.round(embedMs + (applyMs || 0))}ms)`,
  ].filter(Boolean).join(' ');

  console.groupCollapsed(summary);
  console.table(
    perTag.map(p => ({
      tag: p.tagName,
      distance: p.distance.toFixed(3),
      outcome: p.outcome,
      ai_verdict: p.aiConfidence || '—',
    })),
  );
  if (embedUsage) console.log('embed tokens:', embedUsage, `(${Math.round(embedMs)}ms)`);
  if (applyUsage) console.log('apply tokens:', applyUsage, `(${Math.round(applyMs)}ms)`);
  console.groupEnd();
}

export function recordCall(ctx) {
  state.calls++;
  state.embed_ms_total += ctx.embedMs || 0;
  state.apply_ms_total += ctx.applyMs || 0;
  if (ctx.embedUsage?.total_tokens) state.embed_tokens += ctx.embedUsage.total_tokens;
  if (ctx.applyUsage?.prompt_tokens)     state.apply_in_tokens  += ctx.applyUsage.prompt_tokens;
  if (ctx.applyUsage?.completion_tokens) state.apply_out_tokens += ctx.applyUsage.completion_tokens;
  if (ctx.applyUsage) state.apply_calls++;
  for (const p of (ctx.perTag || [])) {
    if (p.outcome === 'silent') state.applied_silent++;
    else if (p.outcome === 'dropped') state.dropped_embedding++;
  }
  for (const v of (ctx.verdicts || [])) {
    if (v.confidence === 'high') state.applied_high++;
    else if (v.confidence === 'medium') state.surfaced_medium++;
    else if (v.confidence === 'low') state.dropped_low++;
  }
  state.recent.push({
    at: new Date().toISOString(),
    target: ctx.target,
    input: (ctx.input || '').slice(0, 120),
    decisions: ctx.perTag,
    verdicts: ctx.verdicts,
    embedMs: Math.round(ctx.embedMs || 0),
    applyMs: Math.round(ctx.applyMs || 0),
  });
  if (state.recent.length > MAX_RECENT) state.recent.shift();
}

function reportCost() {
  const embedCost      = state.embed_tokens     * PRICE.embed_in;
  const applyInCost    = state.apply_in_tokens  * PRICE.completion_in;
  const applyOutCost   = state.apply_out_tokens * PRICE.completion_out;
  const total = embedCost + applyInCost + applyOutCost;
  return {
    embed_usd:    +embedCost.toFixed(4),
    apply_in_usd: +applyInCost.toFixed(4),
    apply_out_usd:+applyOutCost.toFixed(4),
    total_usd:    +total.toFixed(4),
  };
}

export function statsSnapshot() {
  return {
    session_calls: state.calls,
    decisions: {
      silent_applied:    state.applied_silent,
      ai_high_applied:   state.applied_high,
      ai_medium_chip:    state.surfaced_medium,
      ai_low_dropped:    state.dropped_low,
      embedding_dropped: state.dropped_embedding,
    },
    tokens: {
      embed: state.embed_tokens,
      apply_input:  state.apply_in_tokens,
      apply_output: state.apply_out_tokens,
    },
    api_calls: {
      embed: state.calls,             // one embed per suggestTags
      apply: state.apply_calls,
    },
    latency_ms: {
      embed_total: Math.round(state.embed_ms_total),
      embed_avg:   state.calls ? Math.round(state.embed_ms_total / state.calls) : 0,
      apply_total: Math.round(state.apply_ms_total),
      apply_avg:   state.apply_calls ? Math.round(state.apply_ms_total / state.apply_calls) : 0,
    },
    cost: reportCost(),
  };
}

export function resetStats() {
  for (const k of Object.keys(state)) {
    if (Array.isArray(state[k])) state[k].length = 0;
    else state[k] = 0;
  }
}

export function recentDecisions(n = 20) {
  return state.recent.slice(-n);
}

// Expose to console for live inspection. `window.aiTagger.stats()`,
// `window.aiTagger.recent()`, `window.aiTagger.debug(true)`.
if (typeof window !== 'undefined') {
  window.aiTagger = {
    stats: statsSnapshot,
    recent: recentDecisions,
    reset: resetStats,
    debug: (on = true) => {
      try {
        if (on) localStorage.setItem('soleil.ai_tagger_debug', '1');
        else localStorage.removeItem('soleil.ai_tagger_debug');
      } catch {}
      return isDebug();
    },
    isDebug,
  };
}
