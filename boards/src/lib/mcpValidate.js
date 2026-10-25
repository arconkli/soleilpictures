// A tool's arguments, held to its own inputSchema before the tool runs.
//
// The schema is what a model reads to build a call, so it is also the contract
// the call is held to. Until this existed nothing checked it: a misspelt key
// (`boardId`) was dropped without a word and the call ran without it, a name
// where an id belongs reached the database as a malformed uuid and came back
// as "that request was not valid", and an enum typo surfaced, if at all, as
// some other route's refusal. A model can only correct what it is told about,
// so every problem here names its path and what would have been accepted.
//
// It is also deliberately forgiving about the habits models and hosts really
// have, because refusing a call that means one obvious thing costs a round trip
// and teaches nothing:
//   · null for an optional argument means "not given" (OpenAI's strict mode
//     fills every optional field with null);
//   · a number or boolean sent as a string ("10", "true") is read as one;
//   · an array or object sent as JSON text is parsed, which is how some hosts
//     double-encode nested arguments;
//   · an enum value in the wrong case is the value it obviously means.
//
// Hand-rolled rather than a validator package so the npm server stays free of
// dependencies; it covers exactly the keywords mcpLint.test.mjs allows in a
// tool schema, and an unknown keyword there fails that test before it can be
// silently ignored here. Copied into mcp/src/validate.js by `npm run sync`.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// How many problems one refusal lists. Past a handful, the rest are usually
// the same mistake repeated down an array, and a wall of them buries the first.
const MAX_PROBLEMS = 6;

const FORMATS = {
  uuid: (s) => UUID.test(s),
  date: (s) => DATE.test(s) && Number.isFinite(Date.parse(s)),
  'date-time': (s) => DATE_TIME.test(s) && Number.isFinite(Date.parse(s)),
  email: (s) => EMAIL.test(s),
  uri: (s) => { try { return !!new URL(s); } catch { return false; } },
};

const FORMAT_WORDS = {
  uuid: 'an id (a uuid such as 3f2a6c1e-8b4d-4e7a-9c1f-2d5e8a7b6c4d)',
  date: 'a date such as 2026-10-24',
  'date-time': 'an ISO timestamp such as 2026-10-24T18:30:00Z',
  email: 'an email address',
  uri: 'an absolute URL',
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const typesOf = (schema) => (Array.isArray(schema?.type) ? schema.type
  : schema?.type ? [schema.type] : []);

function typeMatches(type, v) {
  switch (type) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return isPlainObject(v);
    case 'null': return v === null;
    default: return true;
  }
}

// A value as the schema evidently meant it, when the difference is only
// encoding: "10" for 10, "true" for true, '["a"]' for ["a"], 7 for "7".
function coerce(types, v) {
  if (typeof v === 'string') {
    const s = v.trim();
    if ((types.includes('number') || types.includes('integer')) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
      return Number(s);
    }
    if (types.includes('boolean') && /^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
    if ((types.includes('array') && s.startsWith('[')) || (types.includes('object') && s.startsWith('{'))) {
      try { return JSON.parse(s); } catch { return v; }
    }
  }
  if (typeof v === 'number' && Number.isFinite(v) && types.includes('string') && !types.includes('number')) {
    return String(v);
  }
  return v;
}

const show = (v) => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'an array'
  : typeof v === 'object' ? 'an object' : typeof v === 'string' ? `the string ${show(v)}` : show(v));

const TYPE_WORDS = {
  string: 'text', number: 'a number', integer: 'a whole number', boolean: 'true or false',
  array: 'a list', object: 'an object', null: 'null',
};

// The property a misspelt key was probably meant to be: same letters once case,
// underscores and hyphens are ignored (boardId, board-id, BoardID → board_id).
function closest(key, names) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const k = norm(key);
  return names.find((n) => norm(n) === k)
    || names.find((n) => k.length > 2 && (norm(n).startsWith(k) || k.startsWith(norm(n))))
    || null;
}

function check(schema, value, path, problems) {
  if (!schema || typeof schema !== 'object') return value;
  const types = typesOf(schema);
  let v = types.length ? coerce(types, value) : value;

  if (types.length && !types.some((t) => typeMatches(t, v))) {
    problems.push(`${path} must be ${types.map((t) => TYPE_WORDS[t] || t).join(' or ')} (got ${kindOf(v)})`);
    return v;
  }

  if (schema.enum) {
    if (!schema.enum.includes(v)) {
      const sameish = typeof v === 'string'
        && schema.enum.find((e) => typeof e === 'string' && e.toLowerCase() === v.trim().toLowerCase());
      if (sameish) v = sameish;
      else {
        problems.push(`${path} must be one of ${schema.enum.join(', ')} (got ${show(v)})`);
        return v;
      }
    }
  }
  if ('const' in schema && v !== schema.const) {
    problems.push(`${path} must be ${show(schema.const)} (got ${show(v)})`);
    return v;
  }

  if (typeof v === 'string') {
    if (Number.isFinite(schema.minLength) && v.length < schema.minLength) {
      problems.push(schema.minLength === 1 ? `${path} must not be empty`
        : `${path} must be at least ${schema.minLength} characters (got ${v.length})`);
    }
    if (Number.isFinite(schema.maxLength) && v.length > schema.maxLength) {
      problems.push(`${path} must be at most ${schema.maxLength} characters (got ${v.length})`);
    }
    if (schema.pattern) {
      let re = null;
      try { re = new RegExp(schema.pattern, 'u'); } catch { re = null; }
      if (re && !re.test(v)) problems.push(`${path} does not match the pattern ${schema.pattern}`);
    }
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](v)) {
      problems.push(`${path} must be ${FORMAT_WORDS[schema.format]} (got ${show(v)})`
        + (schema.format === 'uuid' ? ' — use the id from a search or list result, not a name' : ''));
    }
  }

  if (typeof v === 'number') {
    if (Number.isFinite(schema.minimum) && v < schema.minimum) {
      problems.push(`${path} must be at least ${schema.minimum} (got ${v})`);
    }
    if (Number.isFinite(schema.maximum) && v > schema.maximum) {
      problems.push(`${path} must be at most ${schema.maximum} (got ${v})`);
    }
  }

  if (Array.isArray(v)) {
    if (Number.isFinite(schema.minItems) && v.length < schema.minItems) {
      problems.push(`${path} needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'} (got ${v.length})`);
    }
    if (Number.isFinite(schema.maxItems) && v.length > schema.maxItems) {
      problems.push(`${path} takes at most ${schema.maxItems} items (got ${v.length}) — split it across calls`);
    }
    if (schema.items) {
      v = v.map((item, i) => (problems.length >= MAX_PROBLEMS ? item
        : check(schema.items, item, `${path}[${i}]`, problems)));
    }
  }

  if (isPlainObject(v) && (schema.properties || schema.required || schema.additionalProperties !== undefined)) {
    v = checkObject(schema, v, path, problems);
  }
  return v;
}

function checkObject(schema, obj, path, problems) {
  const props = schema.properties || {};
  const names = Object.keys(props);
  const required = new Set(schema.required || []);
  const out = {};
  const at = (k) => (path ? `${path}.${k}` : k);

  for (const [k, raw] of Object.entries(obj)) {
    const sub = props[k];
    if (sub) {
      // "Not given", said the way the host knows how: null where null means
      // nothing, or an empty string where only an id, a date or a listed value
      // could ever go. A required one is then reported as missing, once.
      if (raw === null && !typesOf(sub).includes('null')) continue;
      if (raw === '' && (sub.format || sub.enum)) continue;
      out[k] = check(sub, raw, at(k), problems);
    } else if (schema.additionalProperties === false) {
      const guess = closest(k, names);
      problems.push(`${at(k)} is not an argument here`
        + (guess ? ` — did you mean ${at(guess)}?` : names.length ? ` (it takes ${names.join(', ')})` : ''));
    } else if (isPlainObject(schema.additionalProperties)) {
      out[k] = check(schema.additionalProperties, raw, at(k), problems);
    } else {
      out[k] = raw;
    }
    if (problems.length >= MAX_PROBLEMS) break;
  }

  for (const k of required) {
    if (out[k] === undefined || out[k] === null) {
      const sub = props[k];
      const what = sub?.format ? ` (${FORMAT_WORDS[sub.format] || sub.format})` : '';
      problems.push(`${at(k)} is required${what}`);
    }
  }
  return out;
}

/**
 * Check `args` against a tool's input schema.
 *
 * Returns `{ args, problems }`: the arguments as the tool should receive them
 * (coerced, with "not given" nulls dropped), and a sentence per problem. An
 * empty `problems` means run the tool with `args`.
 */
export function checkArgs(schema, input) {
  let value = input;
  if (value === undefined || value === null) value = {};
  // Some hosts send the whole arguments object as JSON text.
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { /* reported below */ }
  }
  if (!isPlainObject(value)) {
    return { args: {}, problems: [`arguments must be an object (got ${kindOf(value)})`] };
  }
  if (!schema || typeof schema !== 'object') return { args: value, problems: [] };
  const problems = [];
  const args = checkObject(schema, value, '', problems);
  return { args, problems: problems.slice(0, MAX_PROBLEMS) };
}

// The refusal a model reads: which tool, then each problem on its own line.
export function argsProblemText(toolName, problems) {
  return `Invalid arguments for ${toolName}:\n${problems.map((p) => `- ${p}`).join('\n')}`;
}
