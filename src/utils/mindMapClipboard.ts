import {
  getMindMapDescendantIds,
  type MindMapLayoutEdge,
  type MindMapLayoutNode,
} from './mindMapLayout';

export interface MindMapClipboardSnapshot<
  TNode extends MindMapLayoutNode = MindMapLayoutNode,
  TEdge extends MindMapLayoutEdge = MindMapLayoutEdge,
> {
  version: 1;
  rootId: string;
  nodes: TNode[];
  edges: TEdge[];
}

export interface MindMapOutlineItem {
  text: string;
  depth: number;
}

export function createMindMapBranchSnapshot<
  TNode extends MindMapLayoutNode,
  TEdge extends MindMapLayoutEdge,
>(
  rootId: string,
  nodes: TNode[],
  edges: TEdge[],
): MindMapClipboardSnapshot<TNode, TEdge> | null {
  if (!nodes.some((node) => node.id === rootId)) return null;
  const branchIds = getMindMapDescendantIds(rootId, nodes, edges);
  branchIds.add(rootId);
  return {
    version: 1,
    rootId,
    nodes: nodes.filter((node) => branchIds.has(node.id)).map((node) => ({ ...node })),
    edges: edges
      .filter((edge) => branchIds.has(edge.fromNode) && branchIds.has(edge.toNode))
      .map((edge) => ({ ...edge })),
  };
}

export function cloneMindMapBranch<
  TNode extends MindMapLayoutNode,
  TEdge extends MindMapLayoutEdge,
>(
  snapshot: MindMapClipboardSnapshot<TNode, TEdge>,
  createId: () => string,
): { rootId: string; nodes: TNode[]; edges: TEdge[] } {
  const idMap = new Map(snapshot.nodes.map((node) => [node.id, createId()]));
  return {
    rootId: idMap.get(snapshot.rootId) || '',
    nodes: snapshot.nodes.map((node) => ({ ...node, id: idMap.get(node.id)! })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      id: createId(),
      fromNode: idMap.get(edge.fromNode)!,
      toNode: idMap.get(edge.toNode)!,
    })),
  };
}

function nodeLabel(node: MindMapLayoutNode & { text?: string; file?: string }): string {
  return String(node.text || node.file || '未命名主题')
    .replace(/^#+\s*/, '')
    .split('\n')[0]
    .trim() || '未命名主题';
}

export function formatMindMapBranchOutline(
  snapshot: MindMapClipboardSnapshot<MindMapLayoutNode & { text?: string; file?: string }>,
): string {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const childrenById = new Map(snapshot.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of snapshot.edges) childrenById.get(edge.fromNode)?.push(edge.toNode);
  const lines: string[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string, depth: number) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) return;
    lines.push(`${'  '.repeat(depth)}- ${nodeLabel(node)}`);
    for (const childId of childrenById.get(nodeId) || []) visit(childId, depth + 1);
  };
  visit(snapshot.rootId, 0);
  return lines.join('\n');
}

export function parseMindMapOutline(text: string, maxItems = 500): MindMapOutlineItem[] {
  const result: MindMapOutlineItem[] = [];
  let previousDepth = 0;
  for (const rawLine of String(text || '').replace(/\r/g, '').split('\n')) {
    if (result.length >= maxItems) break;
    if (!rawLine.trim()) continue;
    const prefix = rawLine.match(/^[\t ]*/)?.[0] || '';
    const indentation = [...prefix].reduce((depth, char) => depth + (char === '\t' ? 2 : 1), 0);
    const content = rawLine.slice(prefix.length)
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+|[•·]\s*)/, '')
      .trim();
    if (!content) continue;
    const requestedDepth = Math.floor(indentation / 2);
    const depth = result.length === 0 ? 0 : Math.min(requestedDepth, previousDepth + 1);
    result.push({ text: content, depth });
    previousDepth = depth;
  }
  return result;
}
