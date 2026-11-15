// The coverage guard's checker: what a file still has in plain English that the
// codemod (scripts/i18nWrap.mjs) would wrap. It is its own small walker, not a
// call into the codemod, so the two check each other: a rule one of them gets
// wrong shows up as a disagreement. Both read the lists in scripts/i18nScope.mjs.
//
// Kinds: jsx-text, prop, jsx-expr, sink, shadowed-t, nested.
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  hasWords, isTextProp, SINK_IDENTIFIERS, SINK_MEMBERS, SINK_KEYS, SINK_NESTED, NATIVE_NAMES, KEEP_ENGLISH, NO_WRAP_PARENTS,
} from './i18nScope.mjs';

const traverse = traverseModule.default || traverseModule;

const CORE = '@lingui/core/macro';
const REACT = '@lingui/react/macro';

const jsxName = (n) => (n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? `${jsxName(n.object)}.${n.property.name}` : '');
const importedName = (s) => s.imported && (s.imported.name || s.imported.value);

// The untagged string and template literals a value can show: through ?: and
// || ?? &&, nothing else.
function englishLeaves(node, out = []) {
  if (!node) return out;
  if (node.type === 'StringLiteral') {
    if (hasWords(node.value) && !KEEP_ENGLISH.has(node.value.trim())) out.push(node);
  } else if (node.type === 'TemplateLiteral') {
    const text = node.quasis.map((q) => q.value.cooked || '').join('');
    if (hasWords(text) && !KEEP_ENGLISH.has(text.trim())) out.push(node);
  } else if (node.type === 'ConditionalExpression') {
    englishLeaves(node.consequent, out);
    englishLeaves(node.alternate, out);
  } else if (node.type === 'LogicalExpression') {
    englishLeaves(node.left, out);
    englishLeaves(node.right, out);
  }
  return out;
}

// Whether an expression holds English of its own: an untagged string or template
// literal with words, anywhere in it. Not looked into: a tagged template (already
// wrapped). A singular/plural ternary is looked into like any other: its English
// is never translated, so it is `nested`. A call of the macro's plural, select or
// selectOrdinal (`isMacroCall` says so) is one ICU message with its options: the
// option strings and the text of their templates are part of it, but its first
// argument and the placeholders inside the templates are still looked into.
function holdsEnglish(node, isMacroCall) {
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'TaggedTemplateExpression') return false;
  if (node.type === 'CallExpression' && isMacroCall(node)) {
    const [first, options, ...rest] = node.arguments;
    if (holdsEnglish(first, isMacroCall) || rest.some((x) => holdsEnglish(x, isMacroCall))) return true;
    if (!options) return false;
    if (options.type !== 'ObjectExpression') return holdsEnglish(options, isMacroCall);
    return options.properties.some((p) => {
      if (p.type !== 'ObjectProperty') return holdsEnglish(p, isMacroCall);
      if (p.computed && holdsEnglish(p.key, isMacroCall)) return true;
      if (p.value.type === 'StringLiteral') return false;
      if (p.value.type === 'TemplateLiteral') return p.value.expressions.some((x) => holdsEnglish(x, isMacroCall));
      return holdsEnglish(p.value, isMacroCall);
    });
  }
  if (node.type === 'StringLiteral' && hasWords(node.value)) return true;
  if (node.type === 'TemplateLiteral' && hasWords(node.quasis.map((q) => q.value.cooked || '').join(''))) return true;
  for (const k of Object.keys(node)) {
    if (k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v) ? v.some((x) => holdsEnglish(x, isMacroCall)) : v && typeof v.type === 'string' && holdsEnglish(v, isMacroCall)) return true;
  }
  return false;
}

export function coverageViolations(code, filename = 'file.jsx') {
  let ast;
  try { ast = parse(code, { sourceType: 'module', plugins: ['jsx'] }); } catch (_) { return []; }
  const lines = code.split('\n');
  const found = [];
  const add = (kind, node) => {
    const line = node.loc.start.line;
    found.push({ line, kind, text: (lines[line - 1] || '').trim().slice(0, 120) });
  };

  const coreLocals = new Map(); // local name -> imported name
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && node.source.value === CORE) {
      for (const s of node.specifiers) if (s.type === 'ImportSpecifier') coreLocals.set(s.local.name, importedName(s));
    }
  }

  const isTrans = (path) => {
    if (!path.isJSXElement()) return false;
    const n = path.node.openingElement.name;
    if (n.type !== 'JSXIdentifier') return false;
    const b = path.scope.getBinding(n.name);
    return !!(b && b.path.isImportSpecifier() && b.path.parent.source.value === REACT && importedName(b.path.node) === 'Trans');
  };
  // a call of plural/select/selectOrdinal that is the macro import, not a local helper
  const macroCallIn = (path) => (call) => {
    const c = call.callee;
    if (c.type !== 'Identifier' || !/^(plural|select|selectOrdinal)$/.test(coreLocals.get(c.name) || '')) return false;
    const b = path.scope.getBinding(c.name);
    return !!(b && b.path.isImportSpecifier() && b.path.parent.source.value === CORE);
  };
  const insideTrans = (path) => !!path.findParent(isTrans);
  const insideNoWrap = (path) => !!path.findParent((p) => p.isJSXElement() && NO_WRAP_PARENTS.has(jsxName(p.node.openingElement.name)));

  const sinkObject = (obj) => {
    for (const prop of obj.get('properties')) {
      if (!prop.isObjectProperty() || prop.node.computed) continue;
      const k = prop.node.key.type === 'Identifier' ? prop.node.key.name : prop.node.key.type === 'StringLiteral' ? prop.node.key.value : null;
      if (!k) continue;
      const value = prop.get('value');
      if (SINK_KEYS.has(k)) {
        if (englishLeaves(value.node).length) add('sink', value.node);
      } else if (k === 'action' && value.isObjectExpression()) {
        sinkObject(value);
      } else if (SINK_NESTED.has(k) && k === 'actions' && value.isArrayExpression()) {
        for (const el of value.get('elements')) if (el.node && el.isObjectExpression()) sinkObject(el);
      }
    }
  };

  traverse(ast, {
    JSXText(path) {
      const text = path.node.value;
      if (!hasWords(text) || KEEP_ENGLISH.has(text.trim())) return;
      if (insideTrans(path) || insideNoWrap(path)) return;
      add('jsx-text', path.node);
    },
    JSXAttribute(path) {
      const nm = path.node.name.type === 'JSXIdentifier' ? path.node.name.name : null;
      const v = path.node.value;
      if (!nm || !isTextProp(nm) || !v) return;
      if (v.type === 'StringLiteral') {
        if (hasWords(v.value) && !KEEP_ENGLISH.has(v.value.trim())) add('prop', v);
      } else if (v.type === 'JSXExpressionContainer' && englishLeaves(v.expression).length) {
        add('prop', v);
      }
    },
    JSXExpressionContainer(path) {
      if (path.parent.type !== 'JSXElement' && path.parent.type !== 'JSXFragment') return;
      // English inside a placeholder of a message is not translated with it.
      if (insideTrans(path)) { if (holdsEnglish(path.node.expression, macroCallIn(path))) add('nested', path.node); return; }
      if (insideNoWrap(path)) return;
      if (englishLeaves(path.node.expression).length) add('jsx-expr', path.node);
    },
    'CallExpression|OptionalCallExpression'(path) {
      const { callee } = path.node;
      const arg0 = path.node.arguments[0];
      // a call of a core macro's local name that is not the import
      if (coreLocals.size && callee.type === 'Identifier' && coreLocals.has(callee.name)) {
        const b = path.scope.getBinding(callee.name);
        if (!b || !(b.path.isImportSpecifier() && b.path.parent.source.value === CORE)) add('shadowed-t', path.node);
      }
      if (!arg0) return;
      const member = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression';
      const prop = member && !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : null;
      if ((callee.type === 'Identifier' && SINK_IDENTIFIERS.has(callee.name)) || (prop && SINK_MEMBERS.has(prop))) {
        path.get('arguments').forEach((a) => { if (a.isObjectExpression()) sinkObject(a); });
      }
      const native = (member && callee.object.type === 'Identifier' && callee.object.name === 'window' && prop && NATIVE_NAMES.has(prop))
        || (callee.type === 'Identifier' && NATIVE_NAMES.has(callee.name) && !path.scope.getBinding(callee.name));
      if (native && englishLeaves(arg0).length) add('sink', arg0);
    },
    TaggedTemplateExpression(path) {
      const tag = path.node.tag;
      if (!coreLocals.size || tag.type !== 'Identifier' || !coreLocals.has(tag.name)) return;
      const b = path.scope.getBinding(tag.name);
      if (!b || !(b.path.isImportSpecifier() && b.path.parent.source.value === CORE)) { add('shadowed-t', path.node); return; }
      if (coreLocals.get(tag.name) === 't' && path.node.quasi.expressions.some((x) => holdsEnglish(x, macroCallIn(path)))) add('nested', path.node);
    },
  });
  return found.sort((a, b) => a.line - b.line);
}

// ---- components that read `children` as text (F4) ----

const TEXT_METHODS = new Set(['toLowerCase', 'toUpperCase', 'trim', 'length', 'split', 'replace', 'includes', 'startsWith']);
const isChildren = (n) => !!n && ((n.type === 'Identifier' && n.name === 'children') || ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && !n.computed && n.property.type === 'Identifier' && n.property.name === 'children'));

// Where `code` treats its `children` as text: `typeof children === 'string'`,
// `children.toLowerCase()` (and trim, length, split, replace, includes,
// startsWith, toUpperCase), `String(children)`, and `Children.toArray(children)`
// that is then joined. A Trans in such a component's children makes them an
// element, so its text must stay a string. [{ line, name, how }], `name` being
// the module-level declaration the read sits in.
export function childrenTextReads(code) {
  let ast;
  try { ast = parse(code, { sourceType: 'module', plugins: ['jsx'] }); } catch (_) { return []; }
  const found = [];
  const topName = (path) => {
    const top = path.findParent((p) => p.parentPath && p.parentPath.isProgram()) || path;
    let n = top.node;
    if (/^Export(Named|Default)Declaration$/.test(n.type) && n.declaration) n = n.declaration;
    if (n.id && n.id.name) return n.id.name;
    if (n.type === 'VariableDeclaration') return n.declarations.map((d) => (d.id.type === 'Identifier' ? d.id.name : '')).filter(Boolean).join(',') || '(module)';
    return '(module)';
  };
  const add = (path, how) => found.push({ line: path.node.loc.start.line, name: topName(path), how });
  traverse(ast, {
    UnaryExpression(path) {
      if (path.node.operator === 'typeof' && isChildren(path.node.argument)) add(path, "typeof children");
    },
    MemberExpression(path) {
      const { object, property, computed } = path.node;
      if (!computed && isChildren(object) && property.type === 'Identifier' && TEXT_METHODS.has(property.name)) add(path, `children.${property.name}`);
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'Identifier' && callee.name === 'String' && isChildren(args[0])) add(path, 'String(children)');
      const toArray = (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' && callee.property.name === 'toArray' && isChildren(args[0]));
      if (!toArray) return;
      const parent = path.parentPath;
      if (parent.isMemberExpression() && parent.node.property.name === 'join') { add(path, 'Children.toArray(children).join'); return; }
      if (parent.isVariableDeclarator() && parent.node.id.type === 'Identifier') {
        const b = path.scope.getBinding(parent.node.id.name);
        if (b && b.referencePaths.some((r) => r.parentPath.isMemberExpression() && r.parentPath.node.property.name === 'join')) add(path, 'Children.toArray(children), joined');
      }
    },
  });
  return found;
}
