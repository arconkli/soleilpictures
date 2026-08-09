// The MCP tool registry — the single definition, used by both transports.
//
// WHY IT LIVES HERE and not in mcp/. There are two servers now: the stdio one a
// person runs on their machine, and the hosted one the Worker serves at
// /api/v1/mcp so a studio can connect with a URL and a token instead of cloning
// a repository. Two copies of thirty tool definitions would drift within a
// week, and the drift would be silent — a tool present on one transport and
// missing on the other looks like a client bug.
//
// So this file holds plain JSON Schema and plain functions. No SDK, no zod, no
// Node built-ins: the Worker has to be able to import it. The stdio adapter
// hands these straight to the low-level MCP Server, which takes JSON Schema
// directly; the Worker serves them over JSON-RPC itself.
//
// WHAT PROTECTS THE USER, in order of how much it is worth:
//   1. The token's scopes. A read-only token makes every write fail at the API
//      whatever the model intends, and `delete` is separate from `write` so
//      "can add to my moodboard" and "can destroy my moodboard" are different
//      decisions.
//   2. The annotations below. destructiveHint / readOnlyHint are what a client
//      reads when deciding whether a call needs confirming — structured, so
//      unlike prose they participate in the decision.
//   3. The wording of the descriptions. Last and least: advice to a model, not
//      a control. Written bluntly anyway.

// Annotation presets, spelled out once so a new tool cannot land in a weaker
// bucket by having its hints forgotten. openWorldHint is true throughout: this
// talks to a live account over a network, not to a closed dataset.
const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const EDITS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const DESTROYS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const uuid = (description) => ({ type: 'string', format: 'uuid', description });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });

const schema = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

// Output schemas are LOOSE on purpose: they name the fields a client can rely
// on without failing when the API grows one. A strict mirror of the wire format
// would be a third source of truth after the Worker and the OpenAPI document,
// and its failure mode is a hard tool error rather than a degraded response.
const looseObject = (properties) => ({ type: 'object', properties, additionalProperties: true });

const IDENTIFIER = {
  type: 'array',
  description: 'Foreign identifiers from another system, e.g. [{"scope":"shotgrid","value":"Shot:12345"}]',
  items: schema({ scope: str('The system that assigned it'), value: str('Its identifier there') },
    ['scope', 'value']),
};
const PROPS = {
  type: 'object',
  description: 'Free-form fields. A null value removes a key. Keys beginning "soleil." are reserved.',
  additionalProperties: true,
};

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Long card text is shortened by default so one call cannot fill a model's
// context. `full` is the escape hatch, and the truncation says so in-band
// rather than silently cutting.
function trimCards(cards, full) {
  if (full) return cards;
  return cards.map((c) => {
    const out = { ...c };
    if (typeof out.body === 'string' && out.body.length > 500) {
      out.body = `${out.body.slice(0, 500)}… [${out.body.length - 500} more characters — call again with full=true]`;
      out.truncated = true;
    }
    if (out.html) out.html = '[html omitted — call again with full=true]';
    if (out.raw) out.raw = '[raw omitted — call again with full=true]';
    return out;
  });
}

export const TOOLS = [
  // ── Orientation ───────────────────────────────────────────────────────────
  {
    name: 'whoami',
    title: 'Who this token belongs to',
    description: 'The account these tools act as, and what this token is allowed to do. '
      + 'Worth calling first: it reports the scopes, so you can find out whether you may '
      + 'write or delete instead of discovering it by being refused. It also says whether '
      + 'this is a service account, and which workspace it is confined to.',
    annotations: READS,
    inputSchema: schema({}),
    outputSchema: looseObject({
      user_id: { type: 'string' },
      scopes: { type: 'array', items: { type: 'string' } },
      service_account: { type: 'boolean' },
    }),
    call: (_a, { api }) => api('/me'),
  },
  {
    name: 'list_workspaces',
    title: 'List workspaces',
    description: 'List the Soleil Clusters workspaces this account can see.',
    annotations: READS,
    inputSchema: schema({}),
    call: (_a, { api }) => api('/workspaces'),
  },

  // ── Finding things ────────────────────────────────────────────────────────
  {
    name: 'search',
    title: 'Search boards and cards',
    description: 'Find boards and cards by text — board names, card titles and card bodies. '
      + 'This is how to locate the board about something WITHOUT listing every board and '
      + 'reading each one, so prefer it over list_boards when you know roughly what you are '
      + 'looking for. Card results carry a short excerpt; use read_board for the rest.',
    annotations: READS,
    inputSchema: schema({
      q: str('At least 2 characters. Punctuation is matched literally.', { minLength: 2 }),
      kind: str('Restrict to one or the other; omit for both', { enum: ['board', 'card'] }),
      workspace_id: uuid('Restrict to one workspace'),
      limit: num('Default 100, max 500', { minimum: 1, maximum: 500 }),
      offset: num('Skip this many, for paging past the first page', { minimum: 0 }),
    }, ['q']),
    call: (a, { api }) => api(`/search${qs({
      q: a.q, kind: a.kind, workspace: a.workspace_id, limit: a.limit, offset: a.offset,
    })}`),
  },
  {
    name: 'list_boards',
    title: 'List boards',
    description: 'List boards. Optionally filter to one workspace, or to the children of one '
      + 'parent board. Pass parent="root" for top-level boards only. Results are paged — if '
      + 'has_more is true, call again with the offset it gives you. To see a whole hierarchy '
      + 'at once, use board_tree instead.',
    annotations: READS,
    inputSchema: schema({
      workspace_id: uuid('Restrict to one workspace'),
      parent: str('A board id, or "root" for top level'),
      since: str('ISO timestamp — only boards changed at or after this'),
      cursor: str('Continue a `since` walk, from a previous next_cursor'),
      limit: num('Default 100, max 500', { minimum: 1, maximum: 500 }),
      offset: num('Skip this many', { minimum: 0 }),
    }),
    call: (a, { api }) => api(`/boards${qs({
      workspace: a.workspace_id, parent: a.parent, since: a.since,
      cursor: a.cursor, limit: a.limit, offset: a.offset,
    })}`),
  },
  {
    name: 'board_tree',
    title: 'Read a whole board hierarchy',
    description: 'The full nested structure under a board, or across a workspace, in ONE call '
      + 'rather than one call per level. Each entry carries its depth and parent, so you can '
      + 'see the shape of a project — show, department, sequence, shot — without walking it.',
    annotations: READS,
    inputSchema: schema({
      root: uuid('A board id to start from'),
      workspace_id: uuid('Or a whole workspace, from its top-level boards'),
      depth: num('How many levels down. Default 10, maximum 20.', { minimum: 1, maximum: 20 }),
    }),
    call: (a, { api }) => api(`/boards/tree${qs({
      root: a.root, workspace: a.workspace_id, depth: a.depth,
    })}`),
  },
  {
    name: 'get_board',
    title: 'Read one board',
    description: 'One board with its metadata AND its capacity — how many cards the owner has '
      + 'used of their allowance. Worth checking before a large add: without it you discover '
      + 'the limit by being refused halfway through.',
    annotations: READS,
    inputSchema: schema({
      board_id: uuid('The board'),
      include: str('Comma-separated: props, identifiers'),
    }, ['board_id']),
    call: (a, { api }) => api(`/boards/${a.board_id}${qs({ include: a.include })}`),
  },
  {
    name: 'list_deleted_boards',
    title: 'List deleted boards',
    description: 'Boards that were deleted but are still recoverable. Pair with restore_board.',
    annotations: READS,
    inputSchema: schema({
      workspace_id: uuid('Restrict to one workspace'),
      limit: num('Default 100, max 500', { minimum: 1, maximum: 500 }),
      offset: num('Skip this many', { minimum: 0 }),
    }),
    call: (a, { api }) => api(`/boards${qs({
      deleted: '1', workspace: a.workspace_id, limit: a.limit, offset: a.offset,
    })}`),
  },
  {
    name: 'resolve_identifier',
    title: 'Find something by an identifier from another system',
    description: 'Given an identifier another system assigned — a ShotGrid id, an ftrack id, a '
      + 'checksum — find the board or card carrying it. Use this instead of searching by name '
      + 'when you have a real id: names are ambiguous and identifiers are not.',
    annotations: READS,
    inputSchema: schema({
      scope: str('The system that assigned it, e.g. "shotgrid"'),
      value: str('Its identifier there, e.g. "Shot:12345"'),
      type: str('Restrict to one kind of object', { enum: ['board', 'card', 'image'] }),
      workspace_id: uuid('Restrict to one workspace'),
    }, ['scope', 'value']),
    call: (a, { api }) => api(`/resolve${qs({
      scope: a.scope, value: a.value, type: a.type, workspace: a.workspace_id,
    })}`),
  },

  // ── Reading a board ───────────────────────────────────────────────────────
  {
    name: 'read_board',
    title: 'Read a board',
    description: 'Read the cards on a board — text, links, images and their positions. This is '
      + 'how to find out what is actually on a board before changing it. Long card text is '
      + 'shortened by default so one call cannot fill your context; pass full=true when you '
      + 'genuinely need every word.',
    annotations: READS,
    inputSchema: schema({
      board_id: uuid('The board'),
      full: bool('Return untruncated body/html. Can be very large.'),
      include: str('Comma-separated: props, identifiers, raw'),
      source: str('"index" is cheaper on very large boards but returns a projection, not the card',
        { enum: ['live', 'index'] }),
      since: str('ISO timestamp — with source=index, only cards changed since then'),
      limit: num('Default 100, max 500', { minimum: 1, maximum: 500 }),
      offset: num('Skip this many', { minimum: 0 }),
      cursor: str('Continue from a previous next_cursor (source=index)'),
    }, ['board_id']),
    call: async (a, { api }) => {
      const data = await api(`/boards/${a.board_id}/cards${qs({
        include: a.include, source: a.source, since: a.since,
        limit: a.limit, offset: a.offset, cursor: a.cursor,
      })}`);
      return { ...data, cards: trimCards(data.cards || [], a.full) };
    },
  },
  {
    name: 'view_image',
    title: 'Look at an image on a board',
    description: "Fetch an image card's actual picture so you can SEE it, rather than only "
      + 'knowing its key. Takes the image_key from a card returned by read_board. This is what '
      + 'makes it possible to say anything real about a moodboard.',
    annotations: READS,
    inputSchema: schema({
      image_key: str('The image_key field of an image card'),
    }, ['image_key']),
    // Returns content blocks directly rather than JSON — see toContent below.
    image: true,
    call: (a, { api }) => api(
      `/images/${a.image_key.split('/').map(encodeURIComponent).join('/')}?variant=preview`,
      { raw: true }),
  },
  {
    name: 'list_images',
    title: 'List stored images',
    description: 'Every image stored in a workspace, with its size and dimensions, cursor-paged. '
      + 'Use it to check what has already been uploaded before uploading again.',
    annotations: READS,
    inputSchema: schema({
      workspace_id: uuid('Restrict to one workspace'),
      board_id: uuid('Restrict to images charged to one board'),
      since: str('ISO timestamp'),
      cursor: str('From a previous next_cursor'),
      limit: num('Default 100, max 500', { minimum: 1, maximum: 500 }),
    }),
    call: (a, { api }) => api(`/images${qs({
      workspace: a.workspace_id, board: a.board_id, since: a.since,
      cursor: a.cursor, limit: a.limit,
    })}`),
  },
  {
    name: 'export_board',
    title: 'Export a whole board',
    description: 'A board and everything on it in one document. format="json" is complete, '
      + 'including the internal form of cards this API cannot otherwise describe. format="omc" '
      + 'renders it as MovieLabs OMC-JSON, the film industry ontology for production material.',
    annotations: READS,
    inputSchema: schema({
      board_id: uuid('The board'),
      format: str('Default json', { enum: ['json', 'omc'] }),
    }, ['board_id']),
    call: (a, { api }) => api(`/boards/${a.board_id}/export${qs({ format: a.format })}`),
  },
  {
    name: 'get_metadata',
    title: 'Read identifiers and properties',
    description: 'The foreign identifiers and structured properties attached to a board or its '
      + 'cards. These are how an outside system marks what an object is; they survive edits to '
      + 'the card itself.',
    annotations: READS,
    inputSchema: schema({
      board_id: uuid('The board'),
      cards: bool('Read the cards’ metadata instead of the board’s'),
    }, ['board_id']),
    call: (a, { api }) => (a.cards
      ? api(`/boards/${a.board_id}/cards?include=props,identifiers&limit=500`)
      : api(`/boards/${a.board_id}?include=props,identifiers`)),
  },
  {
    name: 'list_audit',
    title: 'Read the audit log',
    description: 'Recent writes made through the API, and fetches of image bytes — who, what, '
      + 'when, and with which token. Covers this account and, for a workspace owner, its '
      + 'service accounts. It does NOT cover edits people made in the app.',
    annotations: READS,
    inputSchema: schema({
      since: str('ISO timestamp'),
      cursor: str('From a previous next_cursor'),
      limit: num('Default 100, max 500', { minimum: 1, maximum: 500 }),
    }),
    call: (a, { api }) => api(`/audit${qs({ since: a.since, cursor: a.cursor, limit: a.limit })}`),
  },

  // ── Creating ──────────────────────────────────────────────────────────────
  {
    name: 'create_board',
    title: 'Create a board',
    description: 'CREATES a new, empty board. If workspace_id is omitted it goes in the personal '
      + 'workspace. Pass parent_board_id to nest it inside another board.',
    annotations: WRITES,
    inputSchema: schema({
      name: str('Up to 200 characters', { minLength: 1, maxLength: 200 }),
      workspace_id: uuid('Defaults to the personal workspace'),
      parent_board_id: uuid('Nest it inside this board'),
      view: str('How it opens', { enum: ['canvas', 'list'] }),
      identifiers: IDENTIFIER,
      props: PROPS,
    }, ['name']),
    outputSchema: looseObject({ board: { type: 'object' } }),
    call: (a, { api }) => api('/boards', { method: 'POST', body: a }),
  },
  {
    name: 'create_boards',
    title: 'Create many boards at once',
    description: 'CREATES many boards in one call — for building out a structure rather than '
      + 'adding one board. Pass on_conflict="identifier" and any board already carrying one of '
      + 'the identifiers you supply is updated instead of duplicated, which is what makes an '
      + 'import safe to run twice.',
    annotations: WRITES,
    inputSchema: schema({
      workspace_id: uuid('The default workspace for every entry'),
      on_conflict: str('Set to "identifier" to update rather than duplicate', { enum: ['identifier'] }),
      boards: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        items: schema({
          name: str('Up to 200 characters', { minLength: 1, maxLength: 200 }),
          workspace_id: uuid('Overrides the default'),
          parent_board_id: uuid('Nest it inside this board'),
          view: str('How it opens', { enum: ['canvas', 'list'] }),
          identifiers: IDENTIFIER,
          props: PROPS,
        }, ['name']),
      },
    }, ['boards']),
    call: (a, { api }) => api('/boards', { method: 'POST', body: a }),
  },
  {
    name: 'add_cards',
    title: 'Add cards to a board',
    description: 'ADDS cards to a board. Existing cards are never touched, and new cards are '
      + 'positioned in free space so they cannot cover anything already there. Give x and y only '
      + 'if you specifically want to place a card yourself. For an image card, call upload_image '
      + 'first and pass the image_key it returns.',
    annotations: WRITES,
    inputSchema: schema({
      board_id: uuid('The board'),
      on_conflict: str('Set to "identifier" to update rather than duplicate', { enum: ['identifier'] }),
      cards: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: schema({
          kind: str('Defaults to note', { enum: ['note', 'image', 'link', 'doc', 'video', 'file'] }),
          title: str('A heading'),
          body: str('The text of the card, whatever kind it is'),
          html: str('Rich text, for kind=note or doc'),
          url: str('For kind=link'),
          image_key: str('From upload_image. For kind=image'),
          file_key: str('For kind=video or file'),
          file_name: str('For kind=file'),
          mime: str('For kind=file'),
          alt: str('Alt text, for kind=image'),
          color: str('A colour for the card'),
          x: num('Left position'), y: num('Top position'),
          w: num('Width'), h: num('Height'),
          identifiers: IDENTIFIER,
          props: PROPS,
        }),
      },
    }, ['board_id', 'cards']),
    call: (a, { api }) => api(`/boards/${a.board_id}/cards`,
      { method: 'POST', body: { cards: a.cards, on_conflict: a.on_conflict } }),
  },
  {
    name: 'upload_image',
    title: 'Upload an image',
    description: 'UPLOADS image bytes and returns an image_key to pass to add_cards. The image is '
      + "charged against the board owner's storage. Give the bytes base64-encoded. Maximum 25MB, "
      + 'and the content type must be a real image type. For anything larger, or for video and '
      + 'other files, use the REST API’s multipart upload.',
    annotations: WRITES,
    inputSchema: schema({
      board_id: uuid('The board this upload is charged to'),
      data: str('The image bytes, base64-encoded'),
      content_type: str('The image’s real type', {
        enum: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/avif'],
      }),
    }, ['board_id', 'data', 'content_type']),
    call: (a, { api }) => api(`/uploads?board=${a.board_id}`, {
      method: 'POST',
      rawBody: a.data,
      headers: { 'content-type': a.content_type },
    }),
  },

  // ── Changing ──────────────────────────────────────────────────────────────
  {
    name: 'rename_board',
    title: 'Rename or move a board',
    description: "CHANGES a board's name, its view, or which board it sits inside. Only what you "
      + 'pass is altered. Moving a board under one of its own descendants is refused.',
    annotations: EDITS,
    inputSchema: schema({
      board_id: uuid('The board'),
      name: str('Up to 200 characters', { minLength: 1, maxLength: 200 }),
      view: str('How it opens', { enum: ['canvas', 'list'] }),
      parent_board_id: { type: ['string', 'null'], description: 'null moves it to the top level' },
      identifiers: IDENTIFIER,
      props: PROPS,
    }, ['board_id']),
    call: (a, { api }) => {
      const { board_id: boardId, ...patch } = a;
      return api(`/boards/${boardId}`, { method: 'PATCH', body: patch });
    },
  },
  {
    name: 'move_boards',
    title: 'Move several boards at once',
    description: 'MOVES boards under a different parent, or to the top level with '
      + 'parent_board_id=null. Anything it refuses comes back in `skipped` with a reason, rather '
      + 'than failing the whole batch.',
    annotations: EDITS,
    inputSchema: schema({
      board_ids: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string' } },
      parent_board_id: { type: ['string', 'null'], description: 'null moves them to the top level' },
    }, ['board_ids']),
    call: (a, { api }) => api('/boards/move', { method: 'POST', body: a }),
  },
  {
    name: 'update_card',
    title: 'Update a card',
    description: 'CHANGES an existing card in place. Only the fields you pass are altered; '
      + 'anything you leave out keeps its current value. The card id cannot be changed, and '
      + '`kind` must be a real kind — an unrecognised one is refused rather than quietly turning '
      + 'the card into a note.',
    annotations: EDITS,
    inputSchema: schema({
      board_id: uuid('The board the card is on'),
      card_id: str('The card'),
      kind: str('Change the kind', { enum: ['note', 'image', 'link', 'doc', 'video', 'file'] }),
      title: str('A heading'),
      body: str('The text of the card'),
      html: str('Rich text'),
      url: str('For kind=link'),
      image_key: str('Point an image card at different bytes'),
      file_key: str('For kind=video or file'),
      alt: str('Alt text'),
      color: str('A colour for the card'),
      x: num('Left position'), y: num('Top position'),
      w: num('Width'), h: num('Height'),
      identifiers: IDENTIFIER,
      props: PROPS,
    }, ['board_id', 'card_id']),
    call: (a, { api }) => {
      const { board_id: boardId, card_id: cardId, ...patch } = a;
      return api(`/boards/${boardId}/cards/${encodeURIComponent(cardId)}`,
        { method: 'PATCH', body: patch });
    },
  },
  {
    name: 'update_cards',
    title: 'Update several cards at once',
    description: 'CHANGES many cards on one board in a single call. Each entry needs an id; '
      + 'everything else is an ordinary partial update. Far faster than one call per card, and '
      + 'collaborators see the batch land at once rather than as a stream of edits.',
    annotations: EDITS,
    inputSchema: schema({
      board_id: uuid('The board'),
      cards: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: looseObject({ id: str('The card to change') }),
      },
    }, ['board_id', 'cards']),
    call: (a, { api }) => api(`/boards/${a.board_id}/cards`,
      { method: 'PATCH', body: { cards: a.cards } }),
  },
  {
    name: 'move_cards',
    title: 'Move cards to another board',
    description: 'MOVES cards from one board to another. They stop being on the source board. '
      + 'They are re-laid-out on the destination so they do not overlap what is there.',
    annotations: WRITES,
    inputSchema: schema({
      from_board_id: uuid('Where the cards are now'),
      to_board_id: uuid('Where they should go'),
      card_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
    }, ['from_board_id', 'to_board_id', 'card_ids']),
    call: (a, { api }) => api(`/boards/${a.from_board_id}/cards/move`,
      { method: 'POST', body: { to_board_id: a.to_board_id, card_ids: a.card_ids } }),
  },
  {
    name: 'set_metadata',
    title: 'Attach identifiers and properties',
    description: 'ATTACHES foreign identifiers and structured properties to a board or a card. '
      + 'Properties are merged, so send only the keys you mean to change and use null to remove '
      + 'one. Identifiers REPLACE the existing set.',
    annotations: EDITS,
    inputSchema: schema({
      board_id: uuid('The board'),
      card_id: str('Omit to set them on the board itself'),
      identifiers: IDENTIFIER,
      props: PROPS,
    }, ['board_id']),
    call: (a, { api }) => (a.card_id
      ? api(`/boards/${a.board_id}/cards/${encodeURIComponent(a.card_id)}`,
        { method: 'PATCH', body: { props: a.props, identifiers: a.identifiers } })
      : api(`/boards/${a.board_id}`,
        { method: 'PATCH', body: { props: a.props, identifiers: a.identifiers } })),
  },
  {
    name: 'restore_board',
    title: 'Restore a deleted board',
    description: 'Puts a deleted board back. Find candidates with list_deleted_boards.',
    annotations: EDITS,
    inputSchema: schema({ board_id: uuid('The board') }, ['board_id']),
    call: (a, { api }) => api(`/boards/${a.board_id}/restore`, { method: 'POST', body: {} }),
  },

  // ── Destroying ────────────────────────────────────────────────────────────
  {
    name: 'delete_card',
    title: 'Delete a card',
    description: "DELETES a card from a board. This removes the user's content — confirm with "
      + 'them before calling it. The deleted card is returned in full, and passing it back to '
      + 'add_cards restores its content.',
    annotations: DESTROYS,
    inputSchema: schema({
      board_id: uuid('The board'),
      card_id: str('The card'),
    }, ['board_id', 'card_id']),
    call: (a, { api }) => api(`/boards/${a.board_id}/cards/${encodeURIComponent(a.card_id)}`,
      { method: 'DELETE' }),
  },
  {
    name: 'delete_cards',
    title: 'Delete several cards',
    description: "DELETES many cards from one board. This removes the user's content — confirm "
      + 'with them before calling it. Every removed card is returned in full, so the response is '
      + 'the undo.',
    annotations: DESTROYS,
    inputSchema: schema({
      board_id: uuid('The board'),
      card_ids: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string' } },
    }, ['board_id', 'card_ids']),
    call: (a, { api }) => api(`/boards/${a.board_id}/cards`,
      { method: 'DELETE', body: { card_ids: a.card_ids } }),
  },
  {
    name: 'delete_board',
    title: 'Delete a board',
    description: 'DELETES a whole board and everything on it — confirm with the user before '
      + 'calling it. The delete is recoverable: restore_board puts it back, and '
      + 'list_deleted_boards finds it again.',
    annotations: DESTROYS,
    inputSchema: schema({ board_id: uuid('The board') }, ['board_id']),
    call: (a, { api }) => api(`/boards/${a.board_id}`, { method: 'DELETE' }),
  },

  // ── Local only ────────────────────────────────────────────────────────────
  {
    name: 'upload_file',
    title: 'Upload a file from this machine',
    description: 'UPLOADS a file from the local filesystem — including large ones like video, '
      + 'which cannot go through upload_image. Handles the whole multipart transfer and returns '
      + 'a key to pass to add_cards as file_key with kind "video" or "file". Only available when '
      + 'the server is running on your own machine.',
    annotations: WRITES,
    // Filtered out of the hosted registry: there is no local filesystem there,
    // and a tool that can only fail is worse than one that is absent.
    local: true,
    inputSchema: schema({
      board_id: uuid('The board this upload is charged to'),
      path: str('Absolute path to the file'),
      content_type: str('Defaults to a guess from the extension'),
    }, ['board_id', 'path']),
    // async so a refusal is a rejected promise like every other failure here —
    // a synchronous throw would escape a caller that only awaits.
    call: async (a, ctx) => {
      if (!ctx.uploadLocalFile) {
        throw new Error('upload_file needs a local filesystem — use the multipart REST endpoints instead');
      }
      return ctx.uploadLocalFile(a);
    },
  },
];

export const HOSTED_TOOLS = TOOLS.filter((t) => !t.local);

// Prompts. Small on purpose: a prompt is a starting point a person picks from a
// menu, not a place to hide instructions the tools should carry themselves.
export const PROMPTS = [
  {
    name: 'describe_board',
    title: 'Describe what a board is going for',
    description: 'Look at every image on a board and write what it is reaching for — the palette, '
      + 'the mood, the references. Useful for a lookbook someone else made.',
    arguments: [{ name: 'board_id', description: 'The board to describe', required: true }],
    render: (a) => `Read board ${a.board_id} with read_board, then use view_image on every image `
      + 'card. Describe what the board is going for: palette, light, texture, period, and any '
      + 'recurring motif. Quote the card titles that carry the idea. Say what is NOT there as '
      + 'well — an absence is often the point.',
  },
  {
    name: 'organize_board',
    title: 'Propose a grouping for a messy board',
    description: 'Read a board and propose how to split it into child boards, without moving '
      + 'anything until asked.',
    arguments: [{ name: 'board_id', description: 'The board to organize', required: true }],
    render: (a) => `Read board ${a.board_id} with read_board (use view_image where the picture `
      + 'matters). Propose a grouping into child boards, with a name for each and which cards go '
      + 'where. Do NOT create or move anything yet — show me the plan first. Flag anything that '
      + 'fits nowhere rather than forcing it into a group.',
  },
  {
    name: 'import_plan',
    title: 'Plan an import from a file listing',
    description: 'Turn a list of files or a folder structure into a plan of boards and cards, '
      + 'with identifiers so the import can be re-run.',
    arguments: [
      { name: 'workspace_id', description: 'Where it should go', required: true },
      { name: 'listing', description: 'The file listing or folder structure', required: true },
    ],
    render: (a) => `Here is a listing to import into workspace ${a.workspace_id}:\n\n${a.listing}\n\n`
      + 'Propose the board tree it should become, and for each board and card give an '
      + '`identifiers` entry derived from its source path so the import can be re-run without '
      + 'duplicating anything. Use create_boards with on_conflict="identifier". Show me the plan '
      + 'before creating anything.',
  },
];

export const SERVER_INFO = { name: 'soleil-clusters', version: '2.0.0' };

// The MCP protocol shape of a tool, without its implementation.
export const toolManifest = (t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema,
  ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
  annotations: t.annotations,
});
