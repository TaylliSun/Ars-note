const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canReparentMindMapNode,
  createMindMapIndex,
  getMindMapDropPlacement,
  getMindMapChildCount,
  getMindMapNavigationTarget,
  getMindMapParentId,
  getMindMapVisibleNodeIds,
  hasExceededMindMapDragThreshold,
  layoutMindMapNodes,
  normalizeMindMapEdges,
  reorderMindMapSiblingEdges,
  sanitizeMindMapEdges,
} = require('../dist-test/src/utils/mindMapLayout.js');

function node(id, width = 240, height = 80) {
  return { id, type: 'text', x: 0, y: 0, width, height, text: id };
}

function edge(fromNode, toNode) {
  return { id: `${fromNode}-${toNode}`, fromNode, toNode };
}

test('mind map layout balances first-level branches around the center topic', () => {
  const nodes = [node('root'), node('a'), node('b'), node('a1')];
  const edges = [edge('root', 'a'), edge('root', 'b'), edge('a', 'a1')];
  const laidOut = layoutMindMapNodes(nodes, edges);
  const byId = new Map(laidOut.map((item) => [item.id, item]));

  assert.ok(byId.get('a').x > byId.get('root').x);
  assert.ok(byId.get('a1').x > byId.get('a').x);
  assert.ok(byId.get('b').x < byId.get('root').x);
  assert.equal(byId.get('a').branchSide, 'right');
  assert.equal(byId.get('b').branchSide, 'left');
});

test('collapsed branches remain stored but are hidden from the visible set', () => {
  const nodes = [{ ...node('root'), collapsed: true }, node('child'), node('grandchild')];
  const edges = [edge('root', 'child'), edge('child', 'grandchild')];
  const visible = getMindMapVisibleNodeIds(nodes, edges);

  assert.equal(visible.has('root'), true);
  assert.equal(visible.has('child'), false);
  assert.equal(visible.has('grandchild'), false);
  assert.equal(getMindMapChildCount('root', nodes, edges), 1);
  assert.equal(getMindMapParentId('child', nodes, edges), 'root');
});

test('mind map edges use consistent horizontal anchors', () => {
  const [normalized] = normalizeMindMapEdges([{ ...edge('root', 'child'), fromSide: 'bottom', toSide: 'top' }]);
  assert.equal(normalized.fromSide, 'right');
  assert.equal(normalized.toSide, 'left');
});

test('left branches reverse edge anchors and preserve their direction', () => {
  const nodes = [node('root'), { ...node('left'), branchSide: 'left' }];
  const edges = [edge('root', 'left')];
  const laidOut = layoutMindMapNodes(nodes, edges);
  const [normalized] = normalizeMindMapEdges(edges, laidOut);
  assert.equal(normalized.fromSide, 'left');
  assert.equal(normalized.toSide, 'right');
});

test('reparent guard rejects cycles while allowing a move to another branch', () => {
  const nodes = [node('root'), node('a'), node('a1'), node('b')];
  const edges = [edge('root', 'a'), edge('a', 'a1'), edge('root', 'b')];
  assert.equal(canReparentMindMapNode('a', 'a1', nodes, edges), false);
  assert.equal(canReparentMindMapNode('a1', 'b', nodes, edges), true);
  assert.equal(canReparentMindMapNode('a', 'a', nodes, edges), false);
});

test('malformed cycles and duplicate parents are removed before layout', () => {
  const nodes = [node('a'), node('b'), node('c')];
  const edges = [edge('a', 'b'), edge('b', 'a'), edge('c', 'b'), edge('a', 'a')];
  const safe = sanitizeMindMapEdges(nodes, edges);
  assert.deepEqual(safe.map((item) => `${item.fromNode}>${item.toNode}`), ['a>b']);
  assert.doesNotThrow(() => layoutMindMapNodes(nodes, safe));
});

test('click movement stays a click until the drag threshold is crossed', () => {
  assert.equal(hasExceededMindMapDragThreshold(10, 10, 14, 13), false);
  assert.equal(hasExceededMindMapDragThreshold(10, 10, 16, 10), true);
});

test('drop zones distinguish sibling insertion from child reparenting', () => {
  assert.equal(getMindMapDropPlacement(105, 100, 100, true), 'before');
  assert.equal(getMindMapDropPlacement(150, 100, 100, true), 'child');
  assert.equal(getMindMapDropPlacement(195, 100, 100, true), 'after');
  assert.equal(getMindMapDropPlacement(105, 100, 100, false), 'child');
});

test('arrow navigation follows visible tree relationships instead of moving coordinates', () => {
  const nodes = [
    node('root'),
    { ...node('left'), branchSide: 'left' },
    { ...node('right'), branchSide: 'right' },
    { ...node('right2'), branchSide: 'right' },
    { ...node('child'), branchSide: 'right' },
  ];
  const edges = [edge('root', 'left'), edge('root', 'right'), edge('root', 'right2'), edge('right', 'child')];
  assert.equal(getMindMapNavigationTarget('root', 'left', nodes, edges), 'left');
  assert.equal(getMindMapNavigationTarget('root', 'right', nodes, edges), 'right');
  assert.equal(getMindMapNavigationTarget('right', 'left', nodes, edges), 'root');
  assert.equal(getMindMapNavigationTarget('right', 'right', nodes, edges), 'child');
  assert.equal(getMindMapNavigationTarget('right', 'up', nodes, edges), null);
  assert.equal(getMindMapNavigationTarget('right', 'down', nodes, edges), 'right2');
});

test('sibling reorder changes only the selected branch order', () => {
  const nodes = [node('root'), node('a'), node('b'), node('c'), node('nested')];
  const edges = [edge('root', 'a'), edge('a', 'nested'), edge('root', 'b'), edge('root', 'c')];
  const reordered = reorderMindMapSiblingEdges('b', -1, nodes, edges);
  const index = createMindMapIndex(nodes, reordered);
  assert.deepEqual(index.childrenById.get('root'), ['b', 'a', 'c']);
  assert.deepEqual(index.childrenById.get('a'), ['nested']);
});

test('large broad maps build one reusable index and normalize within a linear-time budget', () => {
  const childCount = 2500;
  const nodes = [node('root'), ...Array.from({ length: childCount }, (_, index) => node(`n${index}`))];
  const edges = Array.from({ length: childCount }, (_, index) => edge('root', `n${index}`));
  const startedAt = performance.now();
  const index = createMindMapIndex(nodes, edges);
  const normalized = normalizeMindMapEdges(edges, nodes);
  const elapsed = performance.now() - startedAt;
  assert.equal(index.childrenById.get('root').length, childCount);
  assert.equal(normalized.length, childCount);
  assert.ok(elapsed < 1500, `large mind map indexing took ${elapsed.toFixed(1)}ms`);
});

test('deep maps lay out iteratively without overflowing the JavaScript call stack', () => {
  const depth = 5000;
  const nodes = Array.from({ length: depth }, (_, index) => node(`n${index}`));
  const edges = Array.from({ length: depth - 1 }, (_, index) => edge(`n${index}`, `n${index + 1}`));
  const startedAt = performance.now();
  const laidOut = layoutMindMapNodes(nodes, edges);
  const elapsed = performance.now() - startedAt;
  assert.equal(laidOut.length, depth);
  assert.equal(getMindMapVisibleNodeIds(nodes, edges).size, depth);
  assert.ok(Number.isFinite(laidOut[depth - 1].x));
  assert.ok(elapsed < 1500, `deep mind map layout took ${elapsed.toFixed(1)}ms`);
});
