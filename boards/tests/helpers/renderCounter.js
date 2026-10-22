// Counts how often named React components re-render, from outside the app.
//
// Installs a stand-in for the React DevTools hook before the page loads, so
// React hands it every commit. A component that rendered in a commit carries a
// fresh list of hooks; one that React skipped keeps the list it had. So a
// component re-rendered whenever its fiber's hook list changed since the last
// commit we saw. (Only components with hooks can be counted this way, and
// mounting doesn't count.) Walks the whole fiber tree on every commit: fine
// for a spec that counts, too slow for one that times.
//
//   await countRenders(page);              // before page.goto
//   await resetRenders(page);
//   …type…
//   const n = await renders(page);         // { DocToolbar: 0, … }
export async function countRenders(page) {
  await page.addInitScript(() => {
    const counts = {};
    const seen = new WeakMap();
    window.__soleilRenders = counts;
    const nameOf = (t) => (typeof t === 'function' ? (t.displayName || t.name)
      : (t && typeof t === 'object' ? (t.displayName || t.type?.name || t.render?.name) : null)) || null;
    const visit = (root) => {
      const stack = [root];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        const name = nameOf(f.type);
        if (name && f.memoizedState) {
          const prev = seen.has(f) ? seen.get(f) : (f.alternate && seen.has(f.alternate) ? seen.get(f.alternate) : undefined);
          if (prev !== undefined && prev !== f.memoizedState) counts[name] = (counts[name] || 0) + 1;
          seen.set(f, f.memoizedState);
          if (f.alternate) seen.set(f.alternate, f.memoizedState);
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      isDisabled: false,
      inject() { return 1; },
      checkDCE() {},
      onScheduleFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onCommitFiberRoot(_id, root) { visit(root.current); },
    };
  });
}

export const resetRenders = (page) => page.evaluate(() => {
  for (const k of Object.keys(window.__soleilRenders)) delete window.__soleilRenders[k];
});

export const renders = (page) => page.evaluate(() => ({ ...window.__soleilRenders }));
