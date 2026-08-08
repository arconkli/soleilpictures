// The OpenAPI 3.1 description of /api/v1.
//
// Served unauthenticated at GET /api/v1/openapi.json. A machine-readable spec
// you need a credential to read is not discoverable, and this describes only
// the shape of the API — never anyone's data.
//
// WHY IT LIVES NEXT TO THE ROUTES rather than in a docs folder: a spec that
// drifts is worse than no spec, because it is confidently wrong. Keeping it in
// the same directory as worker-api.js is not a guarantee, but it is the version
// of this that someone editing a route actually sees.
//
// Hand-written rather than generated. The generator would have to infer the
// wire format from the normalizer, and the interesting parts — that image cards
// take an image_key you get from /uploads, that DELETE hands back the card as
// its own undo — are exactly the parts inference cannot produce.

const card = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: ['note', 'image', 'link', 'doc'] },
    x: { type: 'number' }, y: { type: 'number' },
    w: { type: 'number' }, h: { type: 'number' }, z: { type: 'number' },
    title: { type: ['string', 'null'] },
    body: { type: ['string', 'null'], description: 'The text of the card, whatever kind it is.' },
    html: { type: ['string', 'null'] },
    url: { type: ['string', 'null'] },
    image_key: { type: ['string', 'null'], description: 'A key from POST /uploads. Image cards only.' },
    alt: { type: ['string', 'null'] },
    color: { type: ['string', 'null'] },
    created_at: { type: ['string', 'null'], format: 'date-time' },
    updated_at: { type: ['string', 'null'], format: 'date-time' },
  },
};

const board = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    workspace_id: { type: 'string', format: 'uuid' },
    parent_board_id: { type: ['string', 'null'], format: 'uuid' },
    view: { type: 'string', enum: ['canvas', 'list'] },
    deleted: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: ['string', 'null'], format: 'date-time' },
  },
};

const errorSchema = {
  type: 'object',
  required: ['error', 'code'],
  properties: {
    error: { type: 'string', description: 'Written for a person.' },
    code: {
      type: 'string',
      description: 'Stable. Branch on this, not on the message.',
      enum: [
        'invalid_token', 'rate_limited', 'insufficient_scope', 'forbidden',
        'not_found', 'conflict', 'bad_request', 'limit_reached',
        'unsupported_media_type', 'payload_too_large', 'method_not_allowed',
        'idempotency_in_progress', 'session_unavailable', 'storage_unavailable',
        'upstream_error', 'internal_error',
      ],
    },
  },
};

const pageProps = {
  limit: { type: 'integer' },
  offset: { type: 'integer' },
  has_more: { type: 'boolean' },
  next_offset: { type: ['integer', 'null'] },
};

const limitParam = {
  name: 'limit', in: 'query', required: false,
  schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
};
const offsetParam = {
  name: 'offset', in: 'query', required: false,
  schema: { type: 'integer', minimum: 0, default: 0 },
};
const boardIdParam = {
  name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' },
};

const err = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const okJson = (description, schema) => ({
  description,
  content: { 'application/json': { schema } },
});

export function openapiDocument(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Soleil Clusters API',
      version: '1.0.0',
      description:
        'Read and write your boards from your own software, or from an AI assistant.\n\n'
        + 'A token acts **as you**: it reaches exactly what your account reaches and nothing '
        + 'more, because the API exchanges it for your own session and every call runs under '
        + 'the same row-level security the app uses.\n\n'
        + 'Scopes are `read`, `write` and `delete`. Every token can read; `write` covers '
        + 'creating, editing and moving; `delete` is separate so a token can be allowed to '
        + 'add things without being allowed to destroy them.\n\n'
        + 'Rate limit: 1000 requests per hour per token. Every response carries '
        + '`X-RateLimit-Remaining` and `X-RateLimit-Reset`.',
      license: { name: 'Proprietary' },
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http', scheme: 'bearer',
          description: 'A personal access token from Settings → API. Looks like `sk_live_…`.',
        },
      },
      schemas: { Card: card, Board: board, Error: errorSchema },
      responses: {
        Unauthorized: err('Missing, unknown, revoked or expired token.'),
        Forbidden: err('The token lacks the scope, or the account cannot reach that thing.'),
        NotFound: err('No such thing — including things this account cannot see.'),
        RateLimited: err('Over 1000 requests in the last hour. See Retry-After.'),
      },
    },
    paths: {
      '/me': {
        get: {
          summary: 'Who this token belongs to',
          operationId: 'getMe',
          responses: {
            200: okJson('The account, its scopes and its remaining rate limit', {
              type: 'object',
              properties: {
                user_id: { type: 'string', format: 'uuid' },
                display_name: { type: ['string', 'null'] },
                tier: { type: 'string' },
                scopes: { type: 'array', items: { type: 'string' } },
                rate_limit: { type: 'object' },
              },
            }),
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/workspaces': {
        get: {
          summary: 'Workspaces this account can see',
          operationId: 'listWorkspaces',
          responses: { 200: okJson('Workspaces', { type: 'object' }) },
        },
      },
      '/search': {
        get: {
          summary: 'Find boards and cards by text',
          description:
            'Searches board names, and card titles and bodies. This is how to find the board '
            + 'about something without listing every board and reading each one.',
          operationId: 'search',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
            {
              name: 'kind', in: 'query', required: false,
              schema: { type: 'string', enum: ['board', 'card'] },
              description: 'Restrict to one or the other. Omit for both.',
            },
            { name: 'workspace', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
            limitParam, offsetParam,
          ],
          responses: {
            200: okJson('Matching boards and cards. Card hits carry a 300-character excerpt, not the whole card.', {
              type: 'object',
              properties: {
                query: { type: 'string' },
                boards: { type: 'object', properties: { items: { type: 'array', items: board }, ...pageProps } },
                cards: { type: 'object', properties: { items: { type: 'array' }, ...pageProps } },
              },
            }),
            400: err('q was shorter than 2 characters, or a filter was not a uuid'),
          },
        },
      },
      '/boards': {
        get: {
          summary: 'List boards',
          operationId: 'listBoards',
          parameters: [
            { name: 'workspace', in: 'query', schema: { type: 'string', format: 'uuid' } },
            {
              name: 'parent', in: 'query', schema: { type: 'string' },
              description: 'A board id, or "root" for top-level boards only.',
            },
            {
              name: 'deleted', in: 'query', schema: { type: 'string', enum: ['1'] },
              description: 'Pass 1 to list soft-deleted boards instead of live ones.',
            },
            limitParam, offsetParam,
          ],
          responses: {
            200: okJson('A page of boards', {
              type: 'object',
              properties: { boards: { type: 'array', items: board }, ...pageProps },
            }),
          },
        },
        post: {
          summary: 'Create a board',
          operationId: 'createBoard',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string', maxLength: 200 },
                    workspace_id: { type: 'string', format: 'uuid', description: 'Defaults to the personal workspace.' },
                    parent_board_id: { type: ['string', 'null'], format: 'uuid' },
                    view: { type: 'string', enum: ['canvas', 'list'] },
                  },
                },
              },
            },
          },
          responses: {
            201: okJson('The board', { type: 'object', properties: { board } }),
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
      '/boards/{id}': {
        parameters: [boardIdParam],
        get: {
          summary: 'One board, with its remaining card capacity',
          operationId: 'getBoard',
          responses: {
            200: okJson('The board and its capacity', {
              type: 'object',
              properties: { board, capacity: { type: ['object', 'null'] } },
            }),
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
        patch: {
          summary: 'Rename, change view, or reparent',
          operationId: 'updateBoard',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', maxLength: 200 },
                    view: { type: 'string', enum: ['canvas', 'list'] },
                    parent_board_id: {
                      type: ['string', 'null'], format: 'uuid',
                      description: 'null moves it to the top level. Cycles are refused with 409.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: okJson('The board as it now stands', { type: 'object', properties: { board } }),
            409: err('The reparent was refused — usually because it would make a cycle'),
          },
        },
        delete: {
          summary: 'Soft-delete a board',
          description: 'Recoverable. Requires the `delete` scope. Children are not touched.',
          operationId: 'deleteBoard',
          responses: {
            200: okJson('The board as it was, and how to put it back', { type: 'object' }),
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
      '/boards/{id}/restore': {
        parameters: [boardIdParam],
        post: {
          summary: 'Restore a soft-deleted board',
          operationId: 'restoreBoard',
          responses: { 200: okJson('The restored board', { type: 'object' }) },
        },
      },
      '/boards/{id}/cards': {
        parameters: [boardIdParam],
        get: {
          summary: 'Every card on a board',
          operationId: 'listCards',
          parameters: [limitParam, offsetParam],
          responses: {
            200: okJson('A page of cards', {
              type: 'object',
              properties: {
                board_id: { type: 'string', format: 'uuid' },
                cards: { type: 'array', items: card },
                total: { type: 'integer' },
                ...pageProps,
              },
            }),
          },
        },
        post: {
          summary: 'Add cards',
          description:
            'Cards without x/y are placed in free space so they cannot cover what is already '
            + 'there. For an image card, upload the bytes first with POST /uploads and pass the '
            + 'image_key it returns.',
          operationId: 'addCards',
          parameters: [{
            name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' },
            description: 'A retry with the same key replays the original response instead of adding the cards twice. Remembered for 24 hours.',
          }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { cards: { type: 'array', maxItems: 100, items: card } },
                },
              },
            },
          },
          responses: {
            201: okJson('The cards as they landed. `live: false` means they are saved but an open canvas will not show them until it reloads.', {
              type: 'object',
              properties: {
                board_id: { type: 'string' },
                cards: { type: 'array', items: card },
                live: { type: 'boolean' },
              },
            }),
            400: err('An unrecognised kind, or more than 100 cards'),
            402: err('The board is at its card cap'),
          },
        },
      },
      '/boards/{id}/cards/{cardId}': {
        parameters: [boardIdParam, { name: 'cardId', in: 'path', required: true, schema: { type: 'string' } }],
        patch: {
          summary: 'Change a card in place',
          description: 'Only the fields you send change. The id cannot be changed.',
          operationId: 'updateCard',
          requestBody: { content: { 'application/json': { schema: card } } },
          responses: {
            200: okJson('The card as it now stands', { type: 'object', properties: { card } }),
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
        delete: {
          summary: 'Remove a card',
          description:
            'Requires the `delete` scope. The removed card comes back in full — there is no undo '
            + 'toast on an HTTP call, so the response body IS the undo. POST it back to restore it.',
          operationId: 'deleteCard',
          responses: {
            200: okJson('The card that was removed', { type: 'object' }),
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
      '/boards/{id}/cards/move': {
        parameters: [boardIdParam],
        post: {
          summary: 'Move cards to another board',
          operationId: 'moveCards',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['to_board_id', 'card_ids'],
                  properties: {
                    to_board_id: { type: 'string', format: 'uuid' },
                    card_ids: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: { 200: okJson('What moved', { type: 'object' }) },
        },
      },
      '/uploads': {
        post: {
          summary: 'Upload an image',
          description:
            'The raw bytes go in the body, with Content-Type set to the image type. Returns a key '
            + 'to pass as `image_key` when creating a card. Charged against the board owner\'s '
            + 'storage, so ?board= is required. 25MB maximum.',
          operationId: 'uploadImage',
          parameters: [{
            name: 'board', in: 'query', required: true, schema: { type: 'string', format: 'uuid' },
          }],
          requestBody: {
            required: true,
            content: {
              'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              'image/png': { schema: { type: 'string', format: 'binary' } },
              'image/gif': { schema: { type: 'string', format: 'binary' } },
              'image/webp': { schema: { type: 'string', format: 'binary' } },
              'image/heic': { schema: { type: 'string', format: 'binary' } },
              'image/avif': { schema: { type: 'string', format: 'binary' } },
            },
          },
          responses: {
            201: okJson('The stored key, and its dimensions where they could be read', {
              type: 'object',
              properties: {
                image_key: { type: 'string' },
                width: { type: ['integer', 'null'] },
                height: { type: ['integer', 'null'] },
                bytes: { type: 'integer' },
                content_type: { type: 'string' },
              },
            }),
            402: err('That would go past the storage included with this account'),
            413: err('Larger than 25MB'),
            415: err('Not an image type this API accepts'),
          },
        },
      },
      '/images/{key}': {
        get: {
          summary: 'Fetch an uploaded image',
          description:
            'The bytes back, for a key this account can see. The key contains slashes; send it '
            + 'as-is after /images/.',
          operationId: 'getImage',
          parameters: [{
            name: 'key', in: 'path', required: true, schema: { type: 'string' },
          }],
          responses: {
            200: { description: 'The image bytes', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
    },
  };
}
