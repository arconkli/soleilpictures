// A Babel plugin that runs after Lingui's macro (descriptorFields: 'message').
//
// The macro leaves every message's English text in the code. Lingui's runtime
// can only show a message in its compiled form (placeholders and plurals as an
// array), and compiles a plain string at run time only with its 6.5 KB message
// compiler loaded; without it, "{n} cards" shows as written. So this turns each
// English message into the compiled form at build time, with the same
// compileMessage `lingui compile` uses for the catalogs. English then needs no
// catalog to fetch and no compiler in the bundle, and every other language
// still comes from its compiled catalog (lib/i18nBoot.js), with the English
// in the code as the fallback for a message it lacks.
//
// Only descriptors the macro made are touched: their id is the hash of their
// message and context (Lingui's own generateMessageId), which an object the
// app writes by hand ({ id, message } for a toast) never matches.
//
// It also checks what ICU MessageFormat did to the English: the placeholders
// and tags the compiled message uses must be exactly the descriptor's own
// values and components. An apostrophe right before a placeholder, or a bare
// { in the text, changes them silently ("Delete '{name}'?" shows a literal
// {name}), so the build fails there with a code frame instead.
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { generateMessageId } from '@lingui/message-utils/generateMessageId';

const keyOf = (p) => (p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value
  : p.key.type === 'NumericLiteral' ? String(p.key.value) : null);

// The placeholder names a compiled message uses, and the tag numbers in its
// text. A part is a string or [name, type?, options?]; plural and select
// options hold more parts.
function collectUses(parts, names, tags) {
  for (const part of parts) {
    if (typeof part === 'string') {
      for (const m of part.matchAll(/<(\/?)(\d+)(\/?)>/g)) tags.add(m[2]);
    } else if (Array.isArray(part)) {
      names.add(String(part[0]));
      const options = part[2];
      if (options && typeof options === 'object') {
        for (const v of Object.values(options)) if (Array.isArray(v)) collectUses(v, names, tags);
      }
    }
  }
}

// Keys of an ObjectExpression property of the descriptor, or null when it is
// absent (an empty set) or not plain enough to read (a spread, a computed key).
function keysOf(node, name) {
  const prop = node.properties.find((p) => p.type === 'ObjectProperty' && !p.computed && keyOf(p) === name);
  if (!prop) return new Set();
  if (prop.value.type !== 'ObjectExpression') return null;
  const keys = new Set();
  for (const p of prop.value.properties) {
    if (p.type !== 'ObjectProperty' || p.computed) return null;
    const k = keyOf(p);
    if (k === null) return null;
    keys.add(k);
  }
  return keys;
}

function checkUses(path, english, compiled) {
  const names = new Set();
  const tags = new Set();
  collectUses(compiled, names, tags);
  names.delete('#');
  const values = keysOf(path.node, 'values');
  const components = keysOf(path.node, 'components');
  const problems = [];
  if (values) {
    const missing = [...names].filter((n) => !values.has(n));
    const extra = [...values].filter((n) => !names.has(n));
    if (missing.length) problems.push(`the text uses ${missing.map((n) => `{${n}}`).join(', ')} with no value`);
    if (extra.length) problems.push(`the value ${extra.map((n) => `{${n}}`).join(', ')} is not shown`);
  }
  if (components) {
    const missing = [...tags].filter((n) => !components.has(n));
    const extra = [...components].filter((n) => !tags.has(n));
    if (missing.length) problems.push(`the text uses tag ${missing.map((n) => `<${n}>`).join(', ')} with no component`);
    if (extra.length) problems.push(`the component <${extra.join('>, <')}> is not shown`);
  }
  if (!problems.length) return;
  throw path.buildCodeFrameError(
    `Message "${english}" does not compile to what it was written as: ${problems.join('; ')}.\n`
    + `An apostrophe right before a placeholder hides it (ICU quoting): write two apostrophes ('') to show one.\n`
    + `A { or } in the text starts a placeholder: write '{' or '}' (in quotes) to show it.`,
  );
}

export default function linguiCompiledMessages({ types: t }) {
  const compileIn = (path) => {
    const node = path.node;
    let id = null;
    let message = null;
    let context = '';
    for (const p of node.properties) {
      if (p.type !== 'ObjectProperty' || p.computed) continue;
      const k = keyOf(p);
      if (k === 'id' && p.value.type === 'StringLiteral') id = p.value.value;
      else if (k === 'message' && p.value.type === 'StringLiteral') message = p;
      else if (k === 'context' && p.value.type === 'StringLiteral') context = p.value.value;
    }
    if (!id || !message || generateMessageId(message.value.value, context) !== id) return;
    const compiled = compileMessage(message.value.value);
    checkUses(path, message.value.value, compiled);
    message.value = t.valueToNode(compiled);
  };
  return {
    name: 'lingui-compiled-messages',
    visitor: {
      // On exit, so the macro has written its descriptors whatever order the
      // plugins' visitors run in.
      Program: { exit(path) { path.traverse({ ObjectExpression(p) { compileIn(p); } }); } },
    },
  };
}
