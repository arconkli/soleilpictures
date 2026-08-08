// Scout — what the bot says.
//
// Quiet by default. One reply per burst, not per message: a 12-photo dump
// arrives as 12 separate messages, and 12 confirmations is how you get muted.
// The bot only speaks up when something changed or something is wrong.
//
// Voice matches the app's "Studio" register (see lib/billingCopy.js): plain,
// specific, no exclamation marks, no emoji padding. This is a tool used by
// working crew standing in a parking lot, not a chat companion.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Describe what actually landed, e.g. "5 photos + 1 note".
function describe({ images = 0, links = 0, notes = 0 }) {
  const parts = [];
  if (images) parts.push(plural(images, 'photo', 'photos'));
  if (links) parts.push(plural(links, 'link', 'links'));
  if (notes) parts.push(plural(notes, 'note', 'notes'));
  if (!parts.length) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} + ${parts[parts.length - 1]}`;
}

// Stage narration, edited into a single message as work progresses.
// Deliberately concrete: "Got 12 photos" proves the bot saw all twelve, which
// is the exact thing you're anxious about standing in a parking lot.
export const STAGES = {
  received: ({ images, links, notes }) => {
    const bits = [];
    if (images) bits.push(plural(images, 'photo', 'photos'));
    if (links) bits.push(plural(links, 'link', 'links'));
    if (notes) bits.push('a note');
    return `Got ${bits.join(' + ') || 'that'} — working on it…`;
  },
  uploading: (n, total) => `Uploading ${total ? `${n} of ${total} photos` : 'photos'}…`,
  arranging: (boardName) => `Arranging on ${boardName}…`,
  // Filing does real work — reading two boards, sorting by colour, rendering a
  // sheet — so it narrates too rather than going quiet mid-instruction.
  checking: () => 'Checking what\'s in your Bin…',
  moving: (n, boardName) => `Moving ${n} ${n === 1 ? 'card' : 'cards'} → ${boardName}…`,
  composing: () => 'Laying out the moodboard…',
};

export function ingestConfirmation({ counts, boardName, url, used, cap }) {
  const lines = [`Got it — ${describe(counts)} → ${boardName}`];
  if (url) lines.push(url);
  // Only show the meter once it means something. Telling someone they've used
  // 6 of 100 cards is noise; telling them at 80 is a heads-up.
  if (Number.isFinite(cap) && used / cap >= 0.5) {
    lines.push(`${used}/${cap} cards`);
  }
  return lines.join('\n');
}

// Fired once, at 75%. scout_accounts.cap_warned_at makes it once per ACCOUNT,
// not once per thread.
export function capWarning({ used, cap }) {
  return [
    `Heads up — your board is filling up. ${used} of ${cap} free cards used.`,
    'Keep going; I\'ll tell you when you hit the wall.',
  ].join('\n');
}

// The wall. This is the one moment the bot is allowed to sell, so it says what
// they get and gets out of the way.
export function capReached({ cap, billingUrl, kept = 0 }) {
  const lines = [`That's the wall — ${cap}/${cap} cards on your free plan.`];
  if (kept > 0) lines.push(`I saved the first ${plural(kept, 'item', 'items')}; the rest didn't land.`);
  else lines.push('Nothing from that last batch landed.');
  lines.push('');
  lines.push(`Creator lifts the cap and adds 100GB: ${billingUrl}`);
  return lines.join('\n');
}

// ── Filing ───────────────────────────────────────────────────────────────────
//
// A move is the one destructive-ish thing Scout does, so it is always confirmed
// first. The confirmation ships with a contact sheet (sheets.js) — the words
// below carry the count and the leftover, the picture carries which photos.

export function moveConfirm({ count, boardName, leftover, leftoverLabel }) {
  const lines = [`Move ${plural(count, 'card', 'cards')} → ${boardName}?`];
  if (leftover > 0) {
    lines.push('');
    lines.push(
      `${plural(leftover, 'older card', 'older cards')} from ${leftoverLabel} `
      + 'stay in your Bin. Say "everything" to include them.',
    );
  }
  lines.push('');
  lines.push('Reply YES.');
  return lines.join('\n');
}

export function moveDone({ count, boardName, url, leftover, leftoverLabel }) {
  const lines = [`Moved ${plural(count, 'card', 'cards')} → ${boardName}`];
  if (url) lines.push(url);
  if (leftover > 0) {
    lines.push('');
    lines.push(`${plural(leftover, 'card', 'cards')} still in your Bin from ${leftoverLabel}.`);
  }
  lines.push('');
  lines.push('Reply UNDO if that wasn\'t right.');
  return lines.join('\n');
}

export function moveCancelled() {
  return 'Left everything where it was.';
}

export function moveExpired() {
  return 'That was a while ago, so I didn\'t move anything. Say it again and I\'ll line it up fresh.';
}

export function binEmpty() {
  return 'Your Bin is empty — everything you\'ve sent is already filed.';
}

export function nothingToMove(boardName) {
  return `There's nothing in your Bin to move to ${boardName}. Send me some photos first.`;
}

export function undoDone({ count, boardName }) {
  return `Put ${plural(count, 'card', 'cards')} back in your Bin, out of ${boardName}.`;
}

export function undoNothing() {
  return 'Nothing recent to undo.';
}

// "What's in my Bin" — grouped by run so the answer matches how filing works.
export function binSummary({ groups, url }) {
  const lines = [`Your Bin — ${plural(groups.reduce((s, g) => s + g.count, 0), 'card', 'cards')}:`];
  for (const g of groups) lines.push(`  ${g.label} · ${g.count}`);
  lines.push('');
  lines.push('Say "put these in <board>" to file the most recent group.');
  if (url) lines.push(url);
  return lines.join('\n');
}

export function welcome({ url }) {
  return [
    'This is Soleil Scout. Text me photos, links or notes and they land on a canvas.',
    '',
    'Your board is here — no signup needed:',
    url,
    '',
    'Say "put these in <board>" any time to file things somewhere specific.',
  ].join('\n');
}

export function boardSwitched({ boardName, created }) {
  return created
    ? `New board — ${boardName}. Everything goes here now.`
    : `Switched to ${boardName}. Everything goes here now.`;
}

export function boardNotFound(name) {
  return `I couldn't find a board called "${name}". Say it again with the exact name, or I'll keep collecting in your Bin.`;
}

export function linkCodeSent(email) {
  return `Sent a code to ${email}. Reply with it and I'll connect this number to that account.`;
}

export function linked({ email }) {
  return `Connected to ${email}. Your boards are all here.`;
}

// The adoption case: this number had already been texting into a throwaway
// account before it was linked. Name the count — the whole worry in that moment
// is "did I just lose the photos I already sent", and a number answers it in a
// way "all set" does not.
export function adopted({ email, count }) {
  const what = count === 1 ? 'the card' : `all ${count} cards`;
  return `Connected to ${email}, and I brought ${what} you'd already sent into your Bin.`;
}

export function linkFailed() {
  return 'That code didn\'t work — they expire after 15 minutes. Generate a fresh one in Settings → Scout.';
}

export function help({ url }) {
  return [
    'Text me photos, links or notes — they collect in your Scout Bin.',
    'When you\'re ready, tell me where they go and I\'ll arrange them.',
    '',
    '"put these in Diner Recce"  file the batch you just sent',
    '"put everything in ..."     file the whole Bin',
    '/bin                        what\'s waiting, and how old',
    // Settings → Scout, not an email round-trip. /link used to promise one and
    // there has never been anything behind it.
    '/code ABCD1234              connect an account you already have',
    '',
    url,
  ].join('\n');
}

// Something broke on our side. Never blame the user, never expose internals,
// and be explicit about whether their photos survived — that's the only thing
// they actually care about in this moment.
export function ingestFailed({ retained }) {
  return retained
    ? 'Something went wrong writing to your board. Your photos are safe — send anything else and I\'ll retry.'
    : 'Something went wrong on my end and that batch didn\'t land. Worth sending again.';
}
