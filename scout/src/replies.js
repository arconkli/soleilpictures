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

// Describe what actually landed, e.g. "5 photos + 1 voice note".
function describe({ images = 0, videos = 0, audio = 0, files = 0, links = 0, notes = 0 }) {
  const parts = [];
  if (images) parts.push(plural(images, 'photo', 'photos'));
  if (videos) parts.push(plural(videos, 'clip', 'clips'));
  if (audio) parts.push(plural(audio, 'voice note', 'voice notes'));
  if (files) parts.push(plural(files, 'file', 'files'));
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
  received: ({ images, videos, audio, files, links, notes }) => {
    const bits = [];
    if (images) bits.push(plural(images, 'photo', 'photos'));
    if (videos) bits.push(plural(videos, 'clip', 'clips'));
    if (audio) bits.push(plural(audio, 'voice note', 'voice notes'));
    if (files) bits.push(plural(files, 'file', 'files'));
    if (links) bits.push(plural(links, 'link', 'links'));
    if (notes) bits.push('a note');
    return `Got ${bits.join(' + ') || 'that'} — working on it…`;
  },
  // Named by KIND. "Uploading 3 of 12 photos" while converting a video is a
  // small lie, and on a slow connection the narration is the only thing telling
  // someone the bot is still alive — it has to be true.
  uploading: (n, total, kind = 'image') => {
    const noun = kind === 'video' ? 'clips' : kind === 'audio' ? 'voice notes'
      : kind === 'image' ? 'photos' : 'files';
    return `Uploading ${total ? `${n} of ${total} ${noun}` : noun}…`;
  },
  // Transcoding is the slowest thing Scout does and it happens on the one media
  // type people will not wait for in silence.
  converting: (n, total) => `Converting ${total > 1 ? `clip ${n} of ${total}` : 'the clip'} so it plays everywhere…`,
  transcribing: () => 'Listening to that…',
  searching: () => 'Looking…',
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
    'This is Soleil Scout. Text me photos, clips, voice notes or links and they land on a canvas.',
    '',
    'Your board is here — no signup needed:',
    url,
    '',
    'Say "put these in <board>" any time to file things somewhere specific.',
  ].join('\n');
}

// The same hello, for somebody who joined the waitlist on the web and then made
// an account there.
//
// The offer is folded into the message Scout was going to send anyway, so
// connecting costs one word and no extra round trip — which is the whole reason
// the binding waits for this moment instead of happening at signup. Texting is
// the only proof anyone can give that they hold this phone.
//
// The account is named. "An account is waiting" leaves someone unable to tell
// whether it is theirs, and the entire decision rests on that.
export function welcomeWithClaim({ url, email }) {
  return [
    'This is Soleil Scout. Text me photos, clips, voice notes or links and they land on a canvas.',
    '',
    `You already made a Clusters account — ${email}. Reply YES and this number`,
    'connects to it, so everything you send goes straight there.',
    '',
    'Or just start sending. Your board is here either way:',
    url,
  ].join('\n');
}

export function connectDeclined() {
  return 'No problem — I\'ll keep everything here. Say "connect" whenever you want it moved across.';
}

export function connectNothingPending() {
  return 'Nothing waiting to connect to this number. Settings → Scout in the app gives you a code if you want to link an account.';
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
    'Text me photos, clips, voice notes, files or links — they collect in your Scout Bin.',
    'When you\'re ready, tell me where they go and I\'ll arrange them.',
    '',
    '"put these in Diner Recce"  file the batch you just sent',
    '"put everything in ..."     file the whole Bin',
    '/bin                        what\'s waiting, and how old',
    '/find diner                 search everything you\'ve sent',
    '/board Diner Recce          send what follows straight there',
    '/delete                     remove the batch you just sent',
    // Settings → Scout, not an email round-trip. /link used to promise one and
    // there has never been anything behind it.
    '/code ABCD1234              connect an account you already have',
    'STOP                        I stop messaging you',
    '',
    url,
  ].join('\n');
}

// ── Creating a board ─────────────────────────────────────────────────────────
//
// Confirmed rather than created on sight. A typo used to be a dead end ("I
// couldn't find a board called Dinner Recce"), which was at least honest;
// creating it silently would turn the typo into a permanent second board with
// half the work in it, discovered a week later.
export function boardCreateOffer(name) {
  return [
    `I don't have a board called "${name}".`,
    '',
    'Reply CREATE and I\'ll make one, or say the name again if I misheard it.',
  ].join('\n');
}

export function boardCreated({ boardName, url }) {
  const lines = [`Made ${boardName}. Everything from here goes there.`];
  if (url) lines.push(url);
  lines.push('');
  lines.push('Say /bin to go back to collecting in your Bin.');
  return lines.join('\n');
}

export function boardCreateFailed(name) {
  return `I couldn't make "${name}" just now. Try again in a moment.`;
}

// ── Deleting ─────────────────────────────────────────────────────────────────
//
// Confirmed like a move, and answered with an undo — the app's convention is
// that deleting always shows an undo, and a thread is no reason to drop it.
export function deleteConfirm({ count, boardName }) {
  return [
    `Delete ${plural(count, 'card', 'cards')} from ${boardName}?`,
    '',
    'Reply YES.',
  ].join('\n');
}

export function deleteDone({ count, boardName }) {
  return [
    `Deleted ${plural(count, 'card', 'cards')} from ${boardName}.`,
    '',
    'Reply UNDO in the next day and I\'ll put them back.',
  ].join('\n');
}

export function deleteUndone({ count }) {
  return `Put ${plural(count, 'card', 'cards')} back.`;
}

export function nothingToDelete() {
  return 'Nothing recent to delete. /bin shows what\'s waiting.';
}

// ── Search ───────────────────────────────────────────────────────────────────
//
// Grouped by board, because "where is it" is the question — a flat list of
// twenty card ids answers nothing anybody asked.
export function searchResults({ query, groups, total, url }) {
  const lines = [`${plural(total, 'match', 'matches')} for "${query}":`];
  for (const g of groups) lines.push(`  ${g.board} · ${g.count}`);
  if (url) { lines.push(''); lines.push(url); }
  return lines.join('\n');
}

export function searchEmpty(query) {
  return `Nothing matching "${query}". I search titles and text — including what you say in voice notes.`;
}

export function searchTooShort() {
  return 'Give me at least two characters to go on — try "find diner".';
}

// ── Files we won't take ──────────────────────────────────────────────────────
//
// Named specifically. "That didn't work" is the reply that generates a support
// message; saying WHICH file and WHY is the one that doesn't.
export function needsPaidPlan({ count, billingUrl }) {
  return [
    `${plural(count, 'file', 'files')} needs a Creator plan — big clips and`,
    'anything that isn\'t a photo, video, audio file or PDF.',
    '',
    `Creator lifts it and adds 100GB: ${billingUrl}`,
  ].join('\n');
}

export function tooLarge({ count }) {
  return `${plural(count, 'file was', 'files were')} too big for me to take over a text. Drag them onto the board instead.`;
}

// Something arrived that we could not turn into anything at all. This exists so
// that a burst which reached the service ALWAYS gets an answer — silence is the
// one reply that is indistinguishable from being ignored.
export function nothingUsable() {
  return [
    'That came through but I couldn\'t make anything of it.',
    '',
    'Photos, clips, voice notes, PDFs, links and plain text all work. /help for the rest.',
  ].join('\n');
}

// ── Stopping ─────────────────────────────────────────────────────────────────
export function stopped() {
  return [
    'Done — I won\'t message you again.',
    '',
    'Your boards and photos are untouched. Text START if you change your mind.',
  ].join('\n');
}

export function stoppedAlready() {
  return 'You asked me to stop, so I\'m not filing anything. Text START and I\'ll pick right back up.';
}

export function resumed({ url }) {
  const lines = ['Back on. Send me anything and it lands on your canvas.'];
  if (url) lines.push(url);
  return lines.join('\n');
}

export function dailyLimit() {
  return [
    'That\'s a lot in one day — I\'ve stopped taking new things for now so nothing gets lost.',
    '',
    'It resets on a rolling 24 hours. Everything you already sent is safe.',
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
