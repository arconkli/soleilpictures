// Fixtures for the sidebar QA harness's Home and Messages (?sidebarqa=1
// &surface=home, &messages=1): a small production's people, conversations and
// clusters, so the real ClustersHome and MessagesPanel draw what they would in
// a signed-in workspace. Dev only (the harness is behind import.meta.env.DEV).

export const SELF = { id: 'qa-me', name: 'You', email: 'you@qa.test', color: '#2f6fd6' };

export const PEOPLE = [
  SELF,
  { id: 'maya', name: 'Maya Ortiz', email: 'maya@lostfilms.co', color: '#9a6b88' },
  { id: 'jon', name: 'Jon Park', email: 'jon@lostfilms.co', color: '#6b9088' },
  { id: 'lena', name: 'Lena Fischer', email: 'lena@castbox.io', color: '#6b8090' },
  { id: 'sam', name: 'Sam Okafor', email: 'sam@okafor.studio', color: '#5b8def' },
  { id: 'priya', name: 'Priya Nair', email: 'priya@gradehouse.tv', color: '#b88958' },
];

// As workspace presence hands them over (userProfiles.populateFromPeers).
export const PEERS = PEOPLE.map((p) => ({ user: p }));

const ago = (now, min) => new Date(now - min * 60_000).toISOString();

export function messagesFixture(now = Date.now()) {
  const conv = (id, title, people, last, minAgo) => ({
    conversation_id: id,
    title,
    last_message_body: last.body,
    last_message_sender_id: last.from,
    last_message_kind: last.kind || 'text',
    last_message_at: ago(now, minAgo),
    people,
  });
  const convs = [
    conv('c-maya', null, ['maya'], { from: 'maya', body: 'Can you drop the location stills into Locations before the recce?' }, 4),
    conv('c-cast', 'Casting · Feature film', ['lena', 'jon', 'sam'], { from: 'lena', body: 'Callbacks moved to Thursday, 10am. Sides go out tonight.' }, 22),
    conv('c-grade', 'Grade', ['priya', 'sam'], { from: 'priya', body: 'The LUT test is on the board' }, 60),
    conv('c-jon', null, ['jon'], { from: SELF.id, body: 'Sent the revised shot list' }, 120),
    conv('c-sam', null, ['sam'], { from: 'sam', body: 'Thanks, that works' }, 3 * 1440),
    conv('c-lena', null, ['lena'], { from: SELF.id, body: 'See you at the recce' }, 5 * 1440),
  ];
  const participants = convs.flatMap((c) => [SELF.id, ...c.people].map((user_id) => ({
    conversation_id: c.conversation_id, user_id, left_at: null, last_read_at: ago(now, 0),
  })));
  const msg = (id, from, body, minAgo, extra = {}) => ({
    id, conversation_id: extra.conv || 'c-cast', sender_id: from, body, created_at: ago(now, minAgo),
    edited_at: null, kind: extra.kind || 'text', attachments: [], reactions: extra.reactions || {},
    is_pinned: !!extra.pinned, parent_id: null, mentions: [],
  });
  const yesterday = 18 * 60;
  return {
    conversations: convs.map(({ people, ...c }) => c),
    participants,
    counts: { 'c-maya': 2, 'c-grade': 1 },
    messages: {
      'c-cast': [
        msg('m1', 'lena', 'Callback list v3 is the source of truth.', yesterday + 40, { pinned: true }),
        msg('m2', 'lena', 'Shortlist for Mara is on the board: six faces, in the order we saw them.', yesterday + 20),
        msg('m3', 'lena', 'Leaning toward the second one.', yesterday + 19, { reactions: { '👍': ['jon', SELF.id], '🔥': ['sam'] } }),
        msg('m4', 'jon', 'Agree on two. Can we see her in the alley light before we decide?', yesterday),
        msg('m5', SELF.id, 'You added Sam', yesterday - 5, { kind: 'system' }),
        msg('m6', 'sam', 'Room 4 is free Thursday morning.', 36),
        msg('m7', SELF.id, 'Booking it now.', 29),
        msg('m8', 'lena', 'Callbacks moved to Thursday, 10am. Sides go out tonight.', 22),
      ],
      'c-maya': [
        msg('d1', 'maya', 'Morning! The recce is at 2.', 5, { conv: 'c-maya' }),
        msg('d2', 'maya', 'Can you drop the location stills into Locations before the recce?', 4, { conv: 'c-maya' }),
      ],
    },
    replyCounts: { 'c-cast': { m4: { count: 3, lastAt: ago(now, 120) } } },
    typing: { 'c-cast': { jon: now } },
  };
}

// Home's covers: the landing page's look-books, which are real boards.
export const HOME_COVERS = {
  film: '/landing/film-noir-look-book.webp',
  mv: '/landing/neon-noir-look-book.webp',
  mood: '/landing/world-cup-2026-moodboard.webp',
  cast: '/landing/short-film-shot-list.webp',
};

export const HOME_PHOTOS = {
  film: [
    { id: 'p1', src: '/signin-losttime-still1.webp' },
    { id: 'p2', src: '/signin-losttime-still2.webp' },
    { id: 'p3', src: '/signin-yahweh.webp' },
  ],
};
