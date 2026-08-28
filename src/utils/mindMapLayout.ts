export type MindMapCanvasMode = 'free' | 'mindmap';

export interface MindMapLayoutNode {
  id: string;
  type: 'text' | 'file' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed?: boolean;
  branchSide?: 'left' | 'right';
}

export interface MindMapLayoutEdge {
  id: string;
  fromNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toNode: string;
  toSide?: 'top' | 'right' | 'bottom' | 'left';
}

const NODE_MIN_WIDTH = 180;
const NODE_MAX_WIDTH = 360;
const NODE_MIN_HEIGHT = 56;
const NODE_MAX_HEIGHT = 220;
const COLUMN_GAP = 92;
const SIBLING_GAP = 28;
const ROOT_GAP = 140;

interface MindMapHierarchy {
  nodeById: Map<string, MindMapLayoutNode>;
  childrenById: Map<string, string[]>;
  parentById: Map<string, string>;
  roots: string[];
}

export interface MindMapIndex {
  nodeById: Map<string, MindMapLayoutNode>;
  childrenById: Map<string, string[]>;
  parentById: Map<string, string>;
  roots: string[];
  branchSideById: Map<string, 'left' | 'right'>;
  visibleNodeIds: Set<string>;
}

export type MindMapNavigationDirection = 'up' | 'down' | 'left' | 'right';
export type MindMapDropPlacement = 'child' | 'before' | 'after';

export function hasExceededMindMapDragThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold = 6,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= threshold;
}

export function getMindMapDropPlacement(
  pointerY: number,
  nodeTop: number,
  nodeHeight: number,
  canReorder: boolean,
): MindMapDropPlacement {
  if (!canReorder) return 'child';
  const ratio = (pointerY - nodeTop) / Math.max(1, nodeHeight);
  if (ratio < 0.26) return 'before';
  if (ratio > 0.74) return 'after';
  return 'child';
}

function createCycleDetector(nodeIds: Iterable<string>): (fromId: string, toId: string) => boolean {
  const componentById = new Map<string, string>();
  for (const nodeId of nodeIds) componentById.set(nodeId, nodeId);

  const findRoot = (nodeId: string): string => {
    let rootId = nodeId;
    while (componentById.get(rootId) !== rootId) {
      rootId = componentById.get(rootId) || rootId;
    }
    let currentId = nodeId;
    while (componentById.get(currentId) !== currentId) {
      const parentId = componentById.get(currentId) || rootId;
      componentById.set(currentId, rootId);
      currentId = parentId;
    }
    return rootId;
  };

  return (fromId: string, toId: string) => {
    const fromRoot = findRoot(fromId);
    const toRoot = findRoot(toId);
    if (fromRoot === toRoot) return true;
    componentById.set(toRoot, fromRoot);
    return false;
  };
}

function buildHierarchy(nodes: MindMapLayoutNode[], edges: MindMapLayoutEdge[]): MindMapHierarchy {
  const layoutNodes = nodes.filter((node) => node.type !== 'group');
  const nodeById = new Map(layoutNodes.map((node) => [node.id, node]));
  const childrenById = new Map(layoutNodes.map((node) => [node.id, [] as string[]]));
  const parentById = new Map<string, string>();
  const createsCycle = createCycleDetector(nodeById.keys());

  for (const edge of edges) {
    if (!nodeById.has(edge.fromNode) || !nodeById.has(edge.toNode)) continue;
    if (edge.fromNode === edge.toNode || parentById.has(edge.toNode)) continue;
    if (createsCycle(edge.fromNode, edge.toNode)) continue;
    parentById.set(edge.toNode, edge.fromNode);
    childrenById.get(edge.fromNode)?.push(edge.toNode);
  }

  const roots = layoutNodes
    .filter((node) => !parentById.has(node.id))
    .map((node) => node.id);

  // A malformed cyclic canvas still needs a stable entry point.
  if (roots.length === 0 && layoutNodes.length > 0) roots.push(layoutNodes[0].id);
  return { nodeById, childrenById, parentById, roots };
}

function getVisibleNodeIdsFromHierarchy(hierarchy: MindMapHierarchy): Set<string> {
  const visible = new Set<string>();
  const stack = [...hierarchy.roots].reverse();
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (visible.has(nodeId)) continue;
    visible.add(nodeId);
    const node = hierarchy.nodeById.get(nodeId);
    if (!node || node.collapsed) continue;
    const children = hierarchy.childrenById.get(nodeId) || [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return visible;
}

export function createMindMapIndex(
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): MindMapIndex {
  const hierarchy = buildHierarchy(nodes, edges);
  const branchSideById = new Map<string, 'left' | 'right'>();
  const visited = new Set<string>();
  const stack: Array<{ nodeId: string; side: 'left' | 'right' }> = [];
  for (let rootIndex = hierarchy.roots.length - 1; rootIndex >= 0; rootIndex -= 1) {
    const children = hierarchy.childrenById.get(hierarchy.roots[rootIndex]) || [];
    for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
      const childId = children[childIndex];
      stack.push({ nodeId: childId, side: hierarchy.nodeById.get(childId)?.branchSide || 'right' });
    }
  }
  while (stack.length > 0) {
    const { nodeId, side } = stack.pop()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    branchSideById.set(nodeId, side);
    const children = hierarchy.childrenById.get(nodeId) || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ nodeId: children[index], side });
    }
  }
  return {
    ...hierarchy,
    branchSideById,
    visibleNodeIds: getVisibleNodeIdsFromHierarchy(hierarchy),
  };
}

export function sanitizeMindMapEdges<T extends MindMapLayoutEdge>(
  nodes: MindMapLayoutNode[],
  edges: T[],
): T[] {
  const nodeIds = new Set(nodes.filter((node) => node.type !== 'group').map((node) => node.id));
  const parentById = new Map<string, string>();
  const pairs = new Set<string>();
  const safeEdges: T[] = [];
  const createsCycle = createCycleDetector(nodeIds);

  for (const edge of edges) {
    if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) continue;
    if (edge.fromNode === edge.toNode || parentById.has(edge.toNode)) continue;
    const pairKey = `${edge.fromNode}\u0000${edge.toNode}`;
    if (pairs.has(pairKey) || createsCycle(edge.fromNode, edge.toNode)) continue;
    pairs.add(pairKey);
    parentById.set(edge.toNode, edge.fromNode);
    safeEdges.push(edge);
  }

  return safeEdges;
}

export function getMindMapParentId(
  nodeId: string,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): string | null {
  return buildHierarchy(nodes, edges).parentById.get(nodeId) || null;
}

export function getMindMapChildCount(
  nodeId: string,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): number {
  return buildHierarchy(nodes, edges).childrenById.get(nodeId)?.length || 0;
}

export function getMindMapChildrenIds(
  nodeId: string,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): string[] {
  return [...(buildHierarchy(nodes, edges).childrenById.get(nodeId) || [])];
}

export function getMindMapRootIds(
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): string[] {
  return [...buildHierarchy(nodes, edges).roots];
}

export function getMindMapDescendantIds(
  nodeId: string,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): Set<string> {
  const hierarchy = buildHierarchy(nodes, edges);
  const descendants = new Set<string>();
  const stack = [...(hierarchy.childrenById.get(nodeId) || [])].reverse();
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (descendants.has(currentId)) continue;
    descendants.add(currentId);
    const children = hierarchy.childrenById.get(currentId) || [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return descendants;
}

export function getMindMapAncestorIds(
  nodeId: string,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): string[] {
  const { parentById } = buildHierarchy(nodes, edges);
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let currentId = parentById.get(nodeId);
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    ancestors.push(currentId);
    currentId = parentById.get(currentId);
  }
  return ancestors;
}

export function canReparentMindMapNode(
  nodeId: string,
  targetParentId: string,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): boolean {
  if (nodeId === targetParentId) return false;
  if (!nodes.some((node) => node.id === nodeId) || !nodes.some((node) => node.id === targetParentId)) return false;
  return !getMindMapDescendantIds(nodeId, nodes, edges).has(targetParentId);
}

export function reorderMindMapSiblingEdges<T extends MindMapLayoutEdge>(
  nodeId: string,
  direction: -1 | 1,
  nodes: MindMapLayoutNode[],
  edges: T[],
): T[] {
  const hierarchy = buildHierarchy(nodes, edges);
  const parentId = hierarchy.parentById.get(nodeId);
  if (!parentId) return edges;
  const side = hierarchy.nodeById.get(nodeId)?.branchSide || 'right';
  const siblings = (hierarchy.childrenById.get(parentId) || []).filter((id) => {
    if (hierarchy.parentById.has(parentId)) return true;
    return (hierarchy.nodeById.get(id)?.branchSide || 'right') === side;
  });
  const currentIndex = siblings.indexOf(nodeId);
  const targetId = siblings[currentIndex + direction];
  if (currentIndex < 0 || !targetId) return edges;
  const currentEdgeIndex = edges.findIndex((edge) => edge.toNode === nodeId);
  const targetEdgeIndex = edges.findIndex((edge) => edge.toNode === targetId);
  if (currentEdgeIndex < 0 || targetEdgeIndex < 0) return edges;
  const nextEdges = [...edges];
  [nextEdges[currentEdgeIndex], nextEdges[targetEdgeIndex]] = [nextEdges[targetEdgeIndex], nextEdges[currentEdgeIndex]];
  return nextEdges;
}

export function getMindMapBranchSide(
  nodeId: string,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): 'left' | 'right' | null {
  const index = createMindMapIndex(nodes, edges);
  if (!index.parentById.has(nodeId)) return null;
  return index.branchSideById.get(nodeId) || 'right';
}

export function getMindMapNavigationTarget(
  nodeId: string,
  direction: MindMapNavigationDirection,
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): string | null {
  const hierarchy = createMindMapIndex(nodes, edges);
  const visibleIds = hierarchy.visibleNodeIds;
  const node = hierarchy.nodeById.get(nodeId);
  if (!node || !visibleIds.has(nodeId)) return null;

  const parentId = hierarchy.parentById.get(nodeId) || null;
  if (direction === 'up' || direction === 'down') {
    let siblings = (parentId
      ? hierarchy.childrenById.get(parentId) || []
      : hierarchy.roots).filter((id) => visibleIds.has(id));
    if (parentId && !hierarchy.parentById.has(parentId)) {
      const side = node.branchSide || 'right';
      siblings = siblings.filter((id) => (hierarchy.nodeById.get(id)?.branchSide || 'right') === side);
    }
    const index = siblings.indexOf(nodeId);
    if (index < 0) return null;
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    return siblings[nextIndex] || null;
  }

  if (!parentId) {
    const requestedSide = direction === 'left' ? 'left' : 'right';
    return (hierarchy.childrenById.get(nodeId) || []).find((childId) => (
      visibleIds.has(childId)
      && (hierarchy.nodeById.get(childId)?.branchSide || 'right') === requestedSide
    )) || null;
  }

  const side = hierarchy.branchSideById.get(nodeId) || 'right';
  const movingInward = (side === 'right' && direction === 'left')
    || (side === 'left' && direction === 'right');
  if (movingInward) return parentId;

  return (hierarchy.childrenById.get(nodeId) || []).find((childId) => visibleIds.has(childId)) || null;
}

export function getMindMapVisibleNodeIds(
  nodes: MindMapLayoutNode[],
  edges: MindMapLayoutEdge[],
): Set<string> {
  return getVisibleNodeIdsFromHierarchy(buildHierarchy(nodes, edges));
}

export function normalizeMindMapEdges<T extends MindMapLayoutEdge>(
  edges: T[],
  nodes: MindMapLayoutNode[] = [],
): T[] {
  const index = createMindMapIndex(nodes, edges);
  return edges.map((edge) => ({
    ...edge,
    fromSide: index.branchSideById.get(edge.toNode) === 'left' ? 'left' : 'right',
    toSide: index.branchSideById.get(edge.toNode) === 'left' ? 'right' : 'left',
  }));
}

export function layoutMindMapNodes<T extends MindMapLayoutNode>(nodes: T[], edges: MindMapLayoutEdge[]): T[] {
  if (nodes.length === 0) return [];
  const hierarchy = buildHierarchy(nodes, edges);
  const visibleIds = getVisibleNodeIdsFromHierarchy(hierarchy);
  const nextNodes = nodes.map((node) => ({ ...node })) as T[];
  const nextById = new Map(nextNodes.map((node) => [node.id, node]));
  const rootX = 1500;
  const startY = 120;

  const traversalOrder: string[] = [];
  const traversed = new Set<string>();
  const traversalStack = [...hierarchy.roots].reverse();
  while (traversalStack.length > 0) {
    const nodeId = traversalStack.pop()!;
    if (traversed.has(nodeId) || !visibleIds.has(nodeId)) continue;
    traversed.add(nodeId);
    traversalOrder.push(nodeId);
    const node = hierarchy.nodeById.get(nodeId);
    if (!node || node.collapsed) continue;
    const children = hierarchy.childrenById.get(nodeId) || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (visibleIds.has(children[index])) traversalStack.push(children[index]);
    }
  }

  const heightMemo = new Map<string, number>();
  for (let index = traversalOrder.length - 1; index >= 0; index -= 1) {
    const nodeId = traversalOrder[index];
    const node = hierarchy.nodeById.get(nodeId);
    if (!node) continue;
    const ownHeight = Math.max(NODE_MIN_HEIGHT, Number(node.height) || NODE_MIN_HEIGHT);
    const children = node.collapsed
      ? []
      : (hierarchy.childrenById.get(nodeId) || []).filter((id) => visibleIds.has(id));
    const childrenHeight = children.reduce((sum, childId) => sum + (heightMemo.get(childId) || NODE_MIN_HEIGHT), 0)
      + Math.max(0, children.length - 1) * SIBLING_GAP;
    heightMemo.set(nodeId, Math.max(ownHeight, childrenHeight));
  }
  const subtreeHeight = (nodeId: string) => heightMemo.get(nodeId) || NODE_MIN_HEIGHT;

  const placed = new Set<string>();
  const placeSide = (ids: string[], side: 'left' | 'right', parentId: string, initialTop: number) => {
    const firstLevelTasks: Array<{ nodeId: string; parentId: string; top: number }> = [];
    let firstLevelTop = initialTop;
    for (const nodeId of ids) {
      firstLevelTasks.push({ nodeId, parentId, top: firstLevelTop });
      firstLevelTop += subtreeHeight(nodeId) + SIBLING_GAP;
    }
    const tasks = firstLevelTasks.reverse();
    while (tasks.length > 0) {
      const task = tasks.pop()!;
      if (placed.has(task.nodeId)) continue;
      const node = nextById.get(task.nodeId);
      const parent = nextById.get(task.parentId);
      if (!node || !parent) continue;
      placed.add(task.nodeId);
      const span = subtreeHeight(task.nodeId);
      node.width = Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, Number(node.width) || NODE_MIN_WIDTH));
      node.height = Math.max(NODE_MIN_HEIGHT, Math.min(NODE_MAX_HEIGHT, Number(node.height) || NODE_MIN_HEIGHT));
      node.branchSide = side;
      node.x = side === 'right'
        ? parent.x + parent.width + COLUMN_GAP
        : parent.x - COLUMN_GAP - node.width;
      node.y = task.top + (span - node.height) / 2;

      if (node.collapsed) continue;
      const childTasks: Array<{ nodeId: string; parentId: string; top: number }> = [];
      let childTop = task.top;
      for (const childId of hierarchy.childrenById.get(task.nodeId) || []) {
        if (!visibleIds.has(childId)) continue;
        childTasks.push({ nodeId: childId, parentId: task.nodeId, top: childTop });
        childTop += subtreeHeight(childId) + SIBLING_GAP;
      }
      for (let index = childTasks.length - 1; index >= 0; index -= 1) tasks.push(childTasks[index]);
    }
  };

  let rootTop = startY;
  for (const rootId of hierarchy.roots) {
    const root = nextById.get(rootId);
    if (!root) continue;
    placed.add(rootId);
    root.width = Math.max(240, Math.min(NODE_MAX_WIDTH, Number(root.width) || 280));
    root.height = Math.max(68, Math.min(140, Number(root.height) || 68));
    delete root.branchSide;
    root.x = rootX;

    const rootChildren = root.collapsed
      ? []
      : (hierarchy.childrenById.get(rootId) || []).filter((id) => visibleIds.has(id));
    const leftChildren: string[] = [];
    const rightChildren: string[] = [];
    let leftWeight = 0;
    let rightWeight = 0;
    for (const childId of rootChildren) {
      const child = nextById.get(childId);
      const weight = subtreeHeight(childId);
      const requested = child?.branchSide;
      const side = requested || (rightWeight <= leftWeight ? 'right' : 'left');
      if (side === 'left') {
        leftChildren.push(childId);
        leftWeight += weight + SIBLING_GAP;
      } else {
        rightChildren.push(childId);
        rightWeight += weight + SIBLING_GAP;
      }
    }

    const sideHeight = (ids: string[]) => ids.reduce((sum, id) => sum + subtreeHeight(id), 0)
      + Math.max(0, ids.length - 1) * SIBLING_GAP;
    const leftHeight = sideHeight(leftChildren);
    const rightHeight = sideHeight(rightChildren);
    const rootSpan = Math.max(root.height, leftHeight, rightHeight);
    root.y = rootTop + (rootSpan - root.height) / 2;

    placeSide(leftChildren, 'left', rootId, rootTop + (rootSpan - leftHeight) / 2);
    placeSide(rightChildren, 'right', rootId, rootTop + (rootSpan - rightHeight) / 2);
    rootTop += rootSpan + ROOT_GAP;
  }

  return nextNodes;
}
