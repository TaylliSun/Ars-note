import type { GraphEdge, GraphNode } from '../types';

export function normalizeGraphPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

export function resolveCurrentGraphNodeId(nodes: GraphNode[], currentFilePath?: string): string | null {
  const current = normalizeGraphPath(currentFilePath || '');
  if (!current) return null;

  let suffixMatch: GraphNode | null = null;
  for (const node of nodes) {
    if ((node.type !== 'note' && node.type !== 'gameDoc') || !node.relativePath) continue;
    const relative = normalizeGraphPath(node.relativePath);
    if (relative === current) return node.id;
    if (current.endsWith(`/${relative}`)) suffixMatch = node;
  }
  return suffixMatch?.id || null;
}

export function collectGraphNeighborhood(edges: GraphEdge[], rootId: string | null, depth: number): Set<string> {
  if (!rootId) return new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  const visited = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);
  const maxDepth = Math.max(0, Math.floor(depth));
  for (let level = 0; level < maxDepth; level++) {
    const next = new Set<string>();
    for (const nodeId of frontier) {
      for (const neighborId of adjacency.get(nodeId) || []) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        next.add(neighborId);
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return visited;
}

export function collectAdjacentNodeIds(edges: GraphEdge[], nodeId: string | null): Set<string> {
  return collectGraphNeighborhood(edges, nodeId, 1);
}

export function rankGraphNodesForCanvas(nodes: GraphNode[], maxNodes: number, preferredRootId: string | null): GraphNode[] {
  return [...nodes].sort((a, b) => {
    if (a.id === preferredRootId) return -1;
    if (b.id === preferredRootId) return 1;
    if (b.linkCount !== a.linkCount) return b.linkCount - a.linkCount;
    if (a.type === 'gameDoc' && b.type !== 'gameDoc') return -1;
    if (b.type === 'gameDoc' && a.type !== 'gameDoc') return 1;
    return a.label.localeCompare(b.label);
  }).slice(0, Math.max(0, maxNodes));
}

export function injectHiddenSearchMatches(
  baseNodes: GraphNode[],
  eligibleNodes: GraphNode[],
  searchMatchIds: Set<string>,
  maxNodes: number,
  maxInjected = 24,
): GraphNode[] {
  if (searchMatchIds.size === 0) return baseNodes;
  const baseIds = new Set(baseNodes.map((node) => node.id));
  const injectedMatches = eligibleNodes
    .filter((node) => searchMatchIds.has(node.id) && !baseIds.has(node.id))
    .slice(0, Math.max(0, maxInjected));
  if (injectedMatches.length === 0) return baseNodes;
  return baseNodes.slice(0, Math.max(0, maxNodes - injectedMatches.length)).concat(injectedMatches);
}
