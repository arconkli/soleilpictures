// Fixtures for the Messages QA harness (?msgqa=1): a small film crew's
// conversations, in every state the Messages UI draws. Pure JS (no Vite), so
// node tests can import it. Timestamps are relative to `now`, so "Today" and
// "Yesterday" dividers appear whenever the harness loads.
//
// Row shapes are the real ones: messages and conversation_participants as the
// tables hold them (src/lib/messages.js reads them), people as
// list_messageable_users returns them.

import { PEOPLE as SIDEBAR_PEOPLE } from '../sidebarQaFixtures.js';

export const WORKSPACE_ID = 'ws-qa';
export const SELF_ID = 'qa-me';

// user_id-keyed, as list_messageable_users / users_by_ids hand them over.
export const PEOPLE = SIDEBAR_PEOPLE.map((p) => ({ user_id: p.id, email: p.email, name: p.name, color: p.color }));

export const CONVERSATION_IDS = ['c-maya', 'c-cast', 'c-long', 'c-empty', 'c-left'];
// Send to…: every preview-card unit kind. Kept out of CONVERSATION_IDS (the
// conversations the existing specs walk); open it with ?conv=c-sent.
export const SENT_CONVERSATION_ID = 'c-sent';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function buildMsgQaDb(now = Date.now()) {
  const emailOf = (id) => PEOPLE.find((p) => p.user_id === id)?.email || null;
  const iso = (t) => new Date(t).toISOString();
  const ago = (min) => now - min * MIN;
  const d = new Date(now);
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Yesterday at hh:mm local time.
  const yest = (h, m = 0) => startOfToday - DAY + h * HOUR + m * MIN;

  const messages = [];
  const msg = (conv, id, from, body, at, extra = {}) => {
    const row = {
      id,
      workspace_id: WORKSPACE_ID,
      conversation_id: conv,
      sender_id: from,
      sender_email: emailOf(from),
      parent_id: null,
      body,
      attachments: [],
      mentions: [],
      reactions: {},
      kind: 'user',
      is_pinned: false,
      edited_at: null,
      deleted_at: null,
      created_at: iso(at),
      ...extra,
    };
    messages.push(row);
    return row;
  };

  // ── c-maya: a DM, two days, one of everything ─────────────────────
  const M = (id, from, body, at, extra) => msg('c-maya', `maya-${id}`, from, body, at, extra);
  const img = (file, name, size, dims = true) => ({
    kind: 'image', storage_path: `qa/${file}.jpg`, name, mime: 'image/jpeg', size,
    ...(dims ? { width: 1200, height: 1200 } : {}),
  });
  M('01', 'maya', 'Hi! Just back from the barn scout. Better in person than in the listing photos.', yest(14, 2));
  M('02', 'maya', 'Sending stills now.', yest(14, 3));
  M('03', 'maya', 'North wall, late afternoon light.', yest(14, 4), { attachments: [img('alley', 'barn-north-wall.jpg', 184_320)] });
  M('04', 'maya', 'The loft, no dimensions saved for this one.', yest(14, 4), { attachments: [img('interior', 'barn-loft.jpg', 96_256, false)] });
  M('05', SELF_ID, 'Wow, the loft is exactly the look we want for the confession scene.', yest(14, 11));
  M('06', SELF_ID, 'How wide is the main door?', yest(14, 12));
  M('07', 'maya', 'Roughly 3m. Truck access is fine, but the lane is gravel.', yest(14, 20), { parent_id: 'maya-06' });
  M('08', SELF_ID, 'Great. Can you ask about the generator?', yest(14, 25));
  M('09', 'maya', "The owner's reply:\n> No generators in the yard before 8am. Sound carries across the valley.\nSo we plan around it.", yest(14, 31));
  M('10', SELF_ID, 'Pinned Barn exterior in @Locations so Jon can see it.', yest(15, 2), {
    attachments: [
      { kind: 'card', boardId: 'board-locations', cardId: 'card-barn', title: 'Barn exterior' },
      { kind: 'board', boardId: 'board-locations', title: 'Locations' },
    ],
  });
  M('11', 'maya', 'Permit application is attached. Please check the insurance section.', yest(15, 40), {
    attachments: [{ kind: 'file', storage_path: 'qa/barn-permit.pdf', name: 'Barn permit.pdf', mime: 'application/pdf', size: 482_304 }],
  });
  M('12', SELF_ID, 'Looks right. Sending it to Priya for sign-off.', yest(16, 5));
  M('13', 'maya', 'Thanks! Talk tomorrow.', yest(17, 30));
  M('14', 'maya', 'Quick update: the owner confirmed Thursday for the recce.', ago(190));
  M('15', 'maya', 'Sunrise is 6:48 so we have a good window.', ago(189));
  M('16', SELF_ID, "Perfect. I'll book the van for 5:45.", ago(170));
  M('17', 'maya', 'Bring boots, the lane is muddy.', ago(165));
  M('18', SELF_ID, 'Name the clips `LOC_014_barn_A.mov` so they sort with the rest.', ago(160));
  M('19', 'maya', 'Call sheet draft:\n```\n05:45 van leaves\n06:30 crew call\n07:00 first look\n```', ago(120));
  M('20', SELF_ID, 'Looks good. Added @Jon Park to the thread for the camera test.', ago(100), { mentions: ['jon'] });
  M('21', 'maya', '- Bring ND filters\n- Check the permit\n- Parking is on Alder St.', ago(60));
  M('22', SELF_ID, 'Anything for sound?', ago(45));
  M('23', 'maya', 'Marcus says the room is dead, no reverb. Good news for dialogue.', ago(30));
  M('24', SELF_ID, 'Great, locking Thursday.', ago(12));
  M('25', 'maya', 'Can you drop the location stills into Locations before the recce?', ago(6));
  M('26', 'maya', 'Also @You can you check the parking map?', ago(3), { mentions: [SELF_ID] });

  // ── c-cast: a group of four ───────────────────────────────────────
  const C = (id, from, body, at, extra) => msg('c-cast', `cast-${id}`, from, body, at, extra);
  C('01', 'lena', 'Callback list v3 is the source of truth.', yest(11, 0), { is_pinned: true });
  C('02', 'lena', 'Shortlist for Mara is on the board: six faces, in the order we saw them.', yest(11, 1));
  C('03', 'lena', 'Leaning toward the second one.', yest(11, 3), { reactions: { '👍': ['jon', SELF_ID], '🔥': ['sam'] } });
  C('04', 'jon', 'Agree on two. Can we see her in the alley light before we decide?', yest(11, 20));
  C('05', SELF_ID, 'Yes, the alley is free Thursday after 4.', yest(11, 25), { parent_id: 'cast-04' });
  C('06', 'jon', 'Perfect.', yest(11, 27), { parent_id: 'cast-04' });
  C('07', SELF_ID, 'You added Sam', yest(11, 40), { kind: 'system' });
  C('08', 'sam', 'Thanks for adding me. Catching up now.', yest(11, 41));
  // A deleted message and a reply that still points at it.
  C('09', 'jon', "Let's cancel the Wednesday session", yest(12, 0), { deleted_at: iso(yest(12, 2)) });
  C('10', 'lena', 'Agreed, Wednesday is out.', yest(12, 5), { parent_id: 'cast-09' });
  C('11', 'sam', 'Room 4 is free Thursday morning.', ago(90));
  C('12', SELF_ID, 'Booking it now.', ago(86), { edited_at: iso(ago(84)) });
  C('13', 'lena', 'Callbacks moved to Thursday, 10am. Sides go out tonight.', ago(80), { reactions: { '✅': [SELF_ID] } });
  C('14', 'lena', '@Sam Okafor can you send the sides to @Jon Park?', ago(79), { mentions: ['sam', 'jon'] });
  C('15', 'sam', 'On it.', ago(77));
  C('16', 'sam', 'Sent.', ago(76));
  C('17', 'jon', 'Thanks both.', ago(40));

  // ── c-long: 320 messages over five days, for paging ───────────────
  const LINES = [
    'Shot list v4 is up.', 'Can we move the lunch break to 1pm?', 'The permit came through.',
    'Who has the second battery charger?', 'Lens test went well, the 35 is sharper than I expected.',
    'Can you send the call sheet again?', 'Hold on, checking the schedule.', 'Wardrobe wants one more fitting.',
    'The rain cover is in the van.', 'Okay, locking picture on the dailies.', 'Nice. See you on set.',
  ];
  const GAPS = [60, 2, 1, 27]; // minutes; four messages and 90 minutes per cycle
  let t = now - 80 * 90 * MIN - 3 * MIN;
  for (let i = 0; i < 320; i++) {
    t += GAPS[i % 4] * MIN;
    const cycle = Math.floor(i / 4);
    const from = cycle % 2 === 0 ? 'jon' : SELF_ID;
    msg('c-long', `long-${String(i + 1).padStart(3, '0')}`, from, `${LINES[i % LINES.length]} (#${i + 1})`, t);
  }

  // ── c-left: a group you left ──────────────────────────────────────
  const L = (id, from, body, at) => msg('c-left', `left-${id}`, from, body, at);
  L('1', 'sam', 'Wrap party is at the old brewery on Saturday.', ago(3 * 1440 + 30));
  L('2', 'priya', 'I can bring the projector.', ago(3 * 1440 + 20));
  L('3', SELF_ID, 'Count me in. I will bring the playlist.', ago(3 * 1440 + 10));
  L('4', 'priya', 'Great, see everyone there.', ago(2 * 1440 + 5));

  // ── c-sent: cards and clusters sent with Send to… ─────────────────
  // Snapshot keys are bare storage keys "qa/<photo>": the harness serves the
  // local photographs for them (r2.js read-URL override). board-night is readable; board-locked is not in `boards`
  // (the reader can't open it) and board-trashed is in the Trash.
  const S = (id, from, body, at, attachments) => msg(SENT_CONVERSATION_ID, `sent-${id}`, from, body, at, { attachments });
  const snapCard = (boardId, cardId, title, boardTitle, snap) => ({ kind: 'card', boardId, cardId, title, boardTitle, snap: { v: 1, cover: 'qa/interior', ...snap } });
  const at0 = now - 8 * DAY;
  S('01', 'lena', '', at0, [snapCard('board-night', 'cd-1', 'Alley, neon', 'Night shoot', { k: 'image', key: 'qa/neon', w: 1200, h: 800 })]);
  S('02', SELF_ID, 'For tomorrow.', at0 + MIN, [snapCard('board-night', 'cd-2', 'Call time', 'Night shoot', { k: 'note', heading: 'Call time', text: 'Crew call 18:30 at the alley. Bring the rain covers and the long lens; permits are in the van.' })]);
  S('03', 'lena', '', at0 + 2 * MIN, [snapCard('board-night', 'cd-3', 'Neon palette', 'Night shoot', { k: 'palette', swatches: ['#1b1b3a', '#693668', '#a74482', '#f84aa7', '#ff3562'] })]);
  S('04', SELF_ID, '', at0 + 3 * MIN, [snapCard('board-night', 'cd-4', 'Reference reel', 'Night shoot', { k: 'link', url: 'https://vimeo.com/123', host: 'vimeo.com' })]);
  S('05', 'lena', '', at0 + 4 * MIN, [
    snapCard('board-night', 'cd-5', 'Alley, neon', 'Night shoot', { k: 'image', key: 'qa/neon' }),
    snapCard('board-night', 'cd-6', 'Face, close', 'Night shoot', { k: 'image', key: 'qa/face' }),
    snapCard('board-night', 'cd-7', 'Fog test', 'Night shoot', { k: 'image', key: 'qa/fog' }),
    { kind: 'card', boardId: 'board-night', cardId: 'cd-8', title: 'Haze', boardTitle: 'Night shoot' },
    { kind: 'card', boardId: 'board-night', cardId: 'cd-9', title: 'Eye', boardTitle: 'Night shoot' },
  ]);
  S('06', SELF_ID, '', at0 + 5 * MIN, [{ kind: 'board', id: 'board-night', boardId: 'board-night', title: 'Night shoot', snap: { v: 1, k: 'cluster', keys: ['qa/alley', 'qa/neon', 'qa/face', 'qa/fog'], count: 12, ws: 'Soleil', cover: 'qa/interior' } }]);
  S('07', 'lena', '', at0 + 6 * MIN, [{ kind: 'board', id: 'board-locked', boardId: 'board-locked', title: 'Reshoots', snap: { v: 1, k: 'cluster', keys: ['qa/haze'], count: 30, ws: 'Soleil', cover: 'qa/interior' } }]);
  S('08', 'lena', '', at0 + 7 * MIN, [snapCard('board-trashed', 'cd-10', 'Night frame', 'Old plans', { k: 'image', key: 'qa/portrait' })]);

  // ── conversations and who is in them ──────────────────────────────
  const lastUserAt = (id) => {
    let best = null;
    for (const m of messages) if (m.conversation_id === id && m.kind === 'user' && !m.deleted_at && (!best || m.created_at > best)) best = m.created_at;
    return best;
  };
  const conv = (id, title, createdMinAgo) => ({
    id, workspace_id: WORKSPACE_ID, title, created_by: SELF_ID, created_at: iso(ago(createdMinAgo)), last_message_at: lastUserAt(id),
  });
  const conversations = [
    conv('c-maya', null, 5 * 1440),
    conv('c-cast', 'Casting', 4 * 1440),
    conv('c-long', null, 6 * 1440),
    conv('c-empty', null, 1440),
    conv('c-left', 'Wrap party', 5 * 1440),
    conv(SENT_CONVERSATION_ID, 'Sent things', 9 * 1440),
  ];
  const part = (conversation_id, user_id, extra = {}) => ({
    conversation_id, user_id, joined_at: iso(ago(5 * 1440)), left_at: null, last_read_at: iso(now), ...extra,
  });
  const conversation_participants = [
    // You last read c-maya 9 minutes ago: Maya's last two messages are unread.
    // Maya read up to 10 minutes ago, after your newest message (Seen).
    part('c-maya', SELF_ID, { last_read_at: iso(ago(9)) }),
    part('c-maya', 'maya', { last_read_at: iso(ago(10)) }),
    part('c-cast', SELF_ID), part('c-cast', 'lena'), part('c-cast', 'jon'), part('c-cast', 'sam'),
    part('c-long', SELF_ID), part('c-long', 'jon'),
    part('c-empty', SELF_ID), part('c-empty', 'priya'),
    part('c-left', SELF_ID, { left_at: iso(ago(2 * 1440)), last_read_at: iso(ago(2 * 1440 + 1)) }),
    part('c-left', 'sam'), part('c-left', 'priya'),
    part(SENT_CONVERSATION_ID, SELF_ID), part(SENT_CONVERSATION_ID, 'lena'), part(SENT_CONVERSATION_ID, 'jon'),
  ];

  // What the Messages cards ask `boards` about (id, deleted_at) under RLS: a
  // cluster the reader can't open simply isn't there.
  const boards = [
    { id: 'board-locations', deleted_at: null },
    { id: 'board-casting', deleted_at: null },
    { id: 'board-night', deleted_at: null },
    { id: 'board-trashed', deleted_at: iso(ago(1440)) },
  ];

  return { messages, conversations, conversation_participants, boards, people: PEOPLE.map((p) => ({ ...p })) };
}
