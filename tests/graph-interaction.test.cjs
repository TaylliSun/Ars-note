const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectGraphNeighborhood,
  injectHiddenSearchMatches,
  rankGraphNodesForCanvas,
  resolveCurrentGraphNodeId,
} = require('../dist-test/src/utils/graphInteraction.js');
const { buildGraphData } = require('../dist-test/src/utils/graphBuilder.js');

const nodes = [
  { id: 'note:01_GDD/GDD.md', label: 'GDD', relativePath: '01_GDD/GDD.md', type: 'gameDoc', linkCount: 1, tagCount: 0 },
  { id: 'note:02_World/World.md', label: 'World', relativePath: '02_World/World.md', type: 'note', linkCount: 2, tagCount: 0 },
];

test('current graph node resolves from either relative or Windows absolute paths', () => {
  assert.equal(resolveCurrentGraphNodeId(nodes, '01_GDD/GDD.md'), 'note:01_GDD/GDD.md');
  assert.equal(resolveCurrentGraphNodeId(nodes, 'D:\\Vault\\01_GDD\\GDD.md'), 'note:01_GDD/GDD.md');
});

test('local graph neighborhood follows the requested link depth', () => {
  const edges = [
    { id: 'a-b', source: 'a', target: 'b', type: 'wiki' },
    { id: 'b-c', source: 'b', target: 'c', type: 'wiki' },
    { id: 'c-d', source: 'c', target: 'd', type: 'wiki' },
  ];
  assert.deepEqual([...collectGraphNeighborhood(edges, 'a', 1)].sort(), ['a', 'b']);
  assert.deepEqual([...collectGraphNeighborhood(edges, 'a', 2)].sort(), ['a', 'b', 'c']);
});

test('large graphs keep the current note visible and inject hidden search matches', () => {
  const manyNodes = Array.from({ length: 180 }, (_, index) => ({
    id: `note:${index}.md`,
    label: index === 179 ? 'Hidden Target' : `Note ${index}`,
    relativePath: `${index}.md`,
    type: 'note',
    linkCount: index,
    tagCount: 0,
  }));
  const base = rankGraphNodesForCanvas(manyNodes, 150, 'note:0.md');
  assert.equal(base[0].id, 'note:0.md');
  assert.equal(base.some((node) => node.id === 'note:179.md'), true);

  const hiddenNode = manyNodes.find((node) => !base.some((baseNode) => baseNode.id === node.id));
  const withSearch = injectHiddenSearchMatches(base, manyNodes, new Set([hiddenNode.id]), 150);
  assert.equal(withSearch.length, 150);
  assert.equal(withSearch.some((node) => node.id === hiddenNode.id), true);
});

test('graph builder resolves ambiguous path links and computes bidirectional degree', () => {
  const note = (relativePath, title, wikiLinks = []) => ({
    filePath: `D:/Vault/${relativePath}`,
    relativePath,
    fileName: relativePath.split('/').pop(),
    title,
    tags: [],
    wikiLinks,
  });
  const graph = buildGraphData({
    updatedAt: '2026-07-10T00:00:00.000Z',
    notes: {
      'Start.md': note('Start.md', 'Start', ['Folder/Duplicate']),
      'A/Duplicate.md': note('A/Duplicate.md', 'Duplicate A'),
      'B/Duplicate.md': note('B/Duplicate.md', 'Duplicate B'),
    },
  });
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.nodes.find((node) => node.relativePath === 'Start.md').linkCount, 2);
  assert.equal(graph.nodes.find((node) => node.relativePath === 'A/Duplicate.md').linkCount, 1);
});
