// A Translate-rewritten text node must not crash React's commit: removing or
// inserting relative to a node the parent no longer owns is skipped, and it is
// reported exactly once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomMutationGuard } from './domMutationGuard.js';

// Just enough of a DOM Node to behave like the browser: both operations throw
// when the node isn't this parent's child.
function makeNodeCtor() {
  class FakeNode {
    constructor() { this.parentNode = null; this.childNodes = []; }
    removeChild(child) {
      const i = this.childNodes.indexOf(child);
      if (i < 0) throw new Error("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.");
      this.childNodes.splice(i, 1);
      child.parentNode = null;
      return child;
    }
    insertBefore(node, ref) {
      if (ref == null) { this.childNodes.push(node); node.parentNode = this; return node; }
      const i = this.childNodes.indexOf(ref);
      if (i < 0) throw new Error("Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.");
      this.childNodes.splice(i, 0, node);
      node.parentNode = this;
      return node;
    }
    appendChild(node) { return this.insertBefore(node, null); }
  }
  return FakeNode;
}

test('removeChild of a node another script moved is skipped, not thrown', () => {
  const Node = makeNodeCtor();
  const seen = [];
  assert.equal(installDomMutationGuard(Node, (op) => seen.push(op)), true);
  const parent = new Node();
  const other = new Node();
  const text = new Node();
  parent.appendChild(text);
  // Translate re-parents React's text node into its own <font> wrapper.
  parent.removeChild(text);
  other.appendChild(text);
  assert.doesNotThrow(() => parent.removeChild(text));
  assert.equal(text.parentNode, other, 'the foreign parent keeps the node');
  assert.deepEqual(seen, ['removeChild']);
});

test('insertBefore a reference node the parent lost is skipped, not thrown', () => {
  const Node = makeNodeCtor();
  const seen = [];
  installDomMutationGuard(Node, (op) => seen.push(op));
  const parent = new Node();
  const ref = new Node();
  const fresh = new Node();
  assert.doesNotThrow(() => parent.insertBefore(fresh, ref));
  assert.deepEqual(seen, ['insertBefore']);
});

test('ordinary operations are untouched, and the report fires once per load', () => {
  const Node = makeNodeCtor();
  const seen = [];
  installDomMutationGuard(Node, (op) => seen.push(op));
  const parent = new Node();
  const a = new Node();
  const b = new Node();
  parent.appendChild(a);
  parent.insertBefore(b, a);
  assert.deepEqual(parent.childNodes, [b, a]);
  assert.equal(parent.removeChild(a), a);
  assert.deepEqual(parent.childNodes, [b]);
  assert.deepEqual(seen, [], 'nothing reported for legitimate calls');
  parent.removeChild(new Node());
  parent.removeChild(new Node());
  parent.insertBefore(new Node(), new Node());
  assert.deepEqual(seen, ['removeChild']);
});

test('installing twice does not wrap the wrapper, and a throwing reporter is contained', () => {
  const Node = makeNodeCtor();
  assert.equal(installDomMutationGuard(Node, () => { throw new Error('reporter down'); }), true);
  assert.equal(installDomMutationGuard(Node, () => {}), false);
  assert.doesNotThrow(() => new Node().removeChild(new Node()));
});

test('a missing Node constructor is a no-op', () => {
  assert.equal(installDomMutationGuard(undefined, () => {}), false);
});
