const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cloneMindMapBranch,
  createMindMapBranchSnapshot,
  formatMindMapBranchOutline,
  parseMindMapOutline,
} = require('../dist-test/src/utils/mindMapClipboard.js');

function node(id, text) {
  return { id, type: 'text', x: 0, y: 0, width: 220, height: 70, text };
}

function edge(fromNode, toNode) {
  return { id: `${fromNode}-${toNode}`, fromNode, toNode };
}

test('branch clipboard keeps descendants but excludes unrelated siblings', () => {
  const nodes = [node('root', '项目'), node('a', '系统'), node('a1', '规则'), node('b', '美术')];
  const edges = [edge('root', 'a'), edge('a', 'a1'), edge('root', 'b')];
  const snapshot = createMindMapBranchSnapshot('a', nodes, edges);
  assert.ok(snapshot);
  assert.deepEqual(snapshot.nodes.map((item) => item.id), ['a', 'a1']);
  assert.deepEqual(snapshot.edges.map((item) => item.id), ['a-a1']);
  assert.equal(formatMindMapBranchOutline(snapshot), '- 系统\n  - 规则');
});

test('cloning a branch gives every node and edge a fresh identity', () => {
  const snapshot = createMindMapBranchSnapshot(
    'a',
    [node('a', '系统'), node('a1', '规则')],
    [edge('a', 'a1')],
  );
  let id = 0;
  const cloned = cloneMindMapBranch(snapshot, () => `copy-${++id}`);
  assert.equal(cloned.rootId, 'copy-1');
  assert.deepEqual(cloned.nodes.map((item) => item.id), ['copy-1', 'copy-2']);
  assert.equal(cloned.edges[0].fromNode, 'copy-1');
  assert.equal(cloned.edges[0].toNode, 'copy-2');
  assert.notEqual(cloned.edges[0].id, 'a-a1');
});

test('plain text outlines become a bounded normalized hierarchy', () => {
  const parsed = parseMindMapOutline('1. 系统\n  - 战斗\n      - 伤害公式\n  - 成长\n- 表现');
  assert.deepEqual(parsed, [
    { text: '系统', depth: 0 },
    { text: '战斗', depth: 1 },
    { text: '伤害公式', depth: 2 },
    { text: '成长', depth: 1 },
    { text: '表现', depth: 0 },
  ]);
  assert.equal(parseMindMapOutline('a\nb\nc', 2).length, 2);
});
