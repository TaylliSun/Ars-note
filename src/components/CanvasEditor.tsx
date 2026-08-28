/* ── Canvas Editor (v2.1.0) ── */
/* Ars-note visual Canvas workspace */
/* Smooth dragging, momentum panning, pinch-zoom, snap-to-grid */

import React, { useDeferredValue, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  canReparentMindMapNode,
  createMindMapIndex,
  getMindMapAncestorIds,
  getMindMapBranchSide,
  getMindMapChildrenIds,
  getMindMapChildCount,
  getMindMapDescendantIds,
  getMindMapDropPlacement,
  getMindMapNavigationTarget,
  getMindMapParentId,
  getMindMapRootIds,
  getMindMapVisibleNodeIds,
  layoutMindMapNodes,
  normalizeMindMapEdges,
  reorderMindMapSiblingEdges,
  sanitizeMindMapEdges,
  hasExceededMindMapDragThreshold,
  type MindMapCanvasMode,
  type MindMapDropPlacement,
} from '../utils/mindMapLayout';
import {
  cloneMindMapBranch,
  createMindMapBranchSnapshot,
  formatMindMapBranchOutline,
  parseMindMapOutline,
  type MindMapClipboardSnapshot,
} from '../utils/mindMapClipboard';

/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */

interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  collapsed?: boolean;
  branchSide?: 'left' | 'right';
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toNode: string;
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  color?: string;
  label?: string;
}

type CanvasSide = NonNullable<CanvasEdge['fromSide']>;
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
type CanvasSnapshot = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selected: string | null;
  selectedEdge: string | null;
  canvasMode: MindMapCanvasMode;
};
type CanvasMindMapClipboard = {
  snapshot: MindMapClipboardSnapshot<CanvasNode, CanvasEdge>;
  plainText: string;
};
type SaveCanvasOptions = { history?: boolean; immediate?: boolean; historySnapshot?: CanvasSnapshot | null; preserveRedo?: boolean };
type ContextMenuState = { x: number; y: number; nodeId: string | null; edgeId?: string | null } | null;
type MindMapDropHint = { targetId: string; placement: MindMapDropPlacement };
type CanvasQualityLevel = 'good' | 'warn' | 'bad';

interface CanvasQualitySummary {
  score: number;
  level: CanvasQualityLevel;
  issueCount: number;
  overlapCount: number;
  denseCardCount: number;
  missingGroup: boolean;
  missingLegend: boolean;
  sparseConnections: boolean;
  issues: string[];
  recommendations: string[];
  tooltip: string;
}

let sharedMindMapClipboard: CanvasMindMapClipboard | null = null;

/* ═══════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════ */

const CARD_COLORS: Record<string, string> = {
  '1': '#e03131', '2': '#e8590c', '3': '#fab005',
  '4': '#2f9e44', '5': '#1098ad', '6': '#7c5cff',
};
const COLOR_BG: Record<string, string> = {
  '1': 'color-mix(in srgb, #e03131 10%, var(--bg-card))', '2': 'color-mix(in srgb, #e8590c 10%, var(--bg-card))', '3': 'color-mix(in srgb, #fab005 12%, var(--bg-card))',
  '4': 'color-mix(in srgb, #2f9e44 10%, var(--bg-card))', '5': 'color-mix(in srgb, #1098ad 10%, var(--bg-card))', '6': 'color-mix(in srgb, #7c5cff 11%, var(--bg-card))',
};
const DEFAULT_CARD_W = 260;
const DEFAULT_CARD_H = 140;
const MIN_CARD_W = 120;
const MIN_CARD_H = 60;
const GRID_SIZE = 20;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;
const CANVAS_LAYOUT_VERSION = 3;
const RESIZE_HANDLES: ResizeDirection[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MAX_HISTORY = 80;
const READABLE_CARD_MAX_LINES = 11;
const READABLE_CARD_MAX_HEIGHT = 340;
const READABLE_CARD_MIN_WIDTH = 340;
const READABLE_CARD_MAX_WIDTH = 560;
const AUTO_LAYOUT_START_X = 80;
const AUTO_LAYOUT_START_Y = 80;
const AUTO_LAYOUT_MAX_COLUMNS = 3;
const AUTO_LAYOUT_COLUMN_GAP = 84;
const AUTO_LAYOUT_ROW_GAP = 34;
const AUTO_LAYOUT_GROUP_WIDTH = 560;
const AUTO_LAYOUT_GROUP_HEADER = 92;
const AUTO_LAYOUT_GROUP_PADDING = 36;
const MIND_MAP_SHORTCUTS = [
  ['Tab', '新建子主题'],
  ['Enter', '新建同级主题'],
  ['Shift + Tab', '提升到上一层'],
  ['方向键', '沿导图结构导航'],
  ['Alt + ↑ / ↓', '调整同级顺序'],
  ['Alt + ← / →', '切换一级分支左右侧'],
  ['Ctrl + C / X / V', '复制、剪切或粘贴分支'],
  ['Ctrl + F', '搜索并定位主题'],
  ['Space', '折叠或展开分支'],
  ['F2', '编辑当前主题'],
  ['Delete', '删除整个分支'],
  ['Esc', '取消编辑或关闭浮层'],
] as const;

/* ═══════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════ */

let _id = Date.now();
function uid(): string { return (++_id).toString(36) + Math.random().toString(36).slice(2, 6); }

function cloneNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map(node => ({ ...node }));
}

function cloneEdges(edges: CanvasEdge[]): CanvasEdge[] {
  return edges.map(edge => ({ ...edge }));
}

function serializeCanvas(nodes: CanvasNode[], edges: CanvasEdge[], canvasMode: MindMapCanvasMode): string {
  return JSON.stringify({ layoutVersion: CANVAS_LAYOUT_VERSION, mode: canvasMode, nodes, edges });
}

function snapshotEquals(a: CanvasSnapshot, b: CanvasSnapshot): boolean {
  return serializeCanvas(a.nodes, a.edges, a.canvasMode) === serializeCanvas(b.nodes, b.edges, b.canvasMode);
}

function estimateCardTextLines(text: string, width: number): number {
  const maxUnits = Math.max(12, Math.floor(Math.max(120, width - 28) / 7.4));
  let lines = 0;
  for (const rawLine of String(text || '').split('\n')) {
    if (!rawLine.trim()) {
      lines++;
      continue;
    }
    let units = 0;
    let lineCount = 1;
    for (const ch of rawLine) {
      const nextUnits = /[\u4e00-\u9fff]/.test(ch) ? 1.08 : /\s/.test(ch) ? 0.35 : /[A-Z0-9]/.test(ch) ? 0.68 : 0.58;
      if (units + nextUnits > maxUnits && units > 0) {
        lineCount++;
        units = nextUnits;
      } else {
        units += nextUnits;
      }
    }
    lines += lineCount;
  }
  return Math.max(1, lines);
}

function mindMapNodeSize(text: string, isRoot = false): { width: number; height: number } {
  const lines = String(text || '').split('\n');
  const longestUnits = lines.reduce((max, line) => {
    const units = [...line].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1 : 0.58), 0);
    return Math.max(max, units);
  }, 0);
  const minWidth = isRoot ? 240 : 180;
  const maxWidth = 360;
  const width = Math.max(minWidth, Math.min(maxWidth, Math.round(54 + longestUnits * 8.2)));
  const visualLines = estimateCardTextLines(text, width);
  const minHeight = isRoot ? 68 : 56;
  const maxHeight = isRoot ? 140 : 220;
  return {
    width,
    height: Math.max(minHeight, Math.min(maxHeight, 30 + visualLines * 20)),
  };
}

function sizeMindMapNodesToContent(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  const childIds = new Set(edges.map((edge) => edge.toNode));
  return nodes.map((node) => {
    if (node.type !== 'text') return node;
    return { ...node, ...mindMapNodeSize(node.text || '', !childIds.has(node.id)) };
  });
}

function splitReadableCanvasLine(rawLine: string, width: number, maxLines: number): string[] {
  const maxUnits = Math.max(24, Math.floor(Math.max(120, width - 28) / 7.4) * maxLines);
  const parts: string[] = [];
  let current = '';
  let units = 0;

  for (const ch of String(rawLine || '')) {
    const nextUnits = /[\u4e00-\u9fff]/.test(ch) ? 1.08 : /\s/.test(ch) ? 0.35 : /[A-Z0-9]/.test(ch) ? 0.68 : 0.58;
    if (units + nextUnits > maxUnits && current.trim()) {
      parts.push(current.trimEnd());
      current = ch.trimStart();
      units = nextUnits;
    } else {
      current += ch;
      units += nextUnits;
    }
  }

  if (current.trim()) parts.push(current.trimEnd());
  return parts.length > 0 ? parts : [rawLine];
}

function splitTextIntoReadableChunks(text: string, width: number, maxLines = READABLE_CARD_MAX_LINES): string[] {
  const source = String(text || '').trim();
  if (!source) return [''];
  if (estimateCardTextLines(source, width) <= maxLines) return [source];

  const chunks: string[] = [];
  let current: string[] = [];

  for (const rawLine of source.split('\n')) {
    const lineParts = estimateCardTextLines(rawLine, width) > maxLines
      ? splitReadableCanvasLine(rawLine, width, maxLines)
      : [rawLine];

    for (const linePart of lineParts) {
      const candidate = [...current, linePart].join('\n').trim();
      if (current.length > 0 && estimateCardTextLines(candidate, width) > maxLines) {
        chunks.push(current.join('\n').trimEnd());
        current = [];
      }
      current.push(linePart);
    }
  }

  if (current.length > 0) chunks.push(current.join('\n').trimEnd());
  return chunks.filter(chunk => chunk.trim()).slice(0, 36);
}

function isDisplayCanvasLabel(node: CanvasNode): boolean {
  const id = String(node.id || '').toLowerCase();
  const text = String(node.text || '').trim();
  return id.includes('label') || (/^#{1,3}\s+/.test(text) && !text.includes('\n') && text.length <= 90);
}

function findDisplayContainingGroup(node: CanvasNode, groups: CanvasNode[]): CanvasNode | null {
  let best: CanvasNode | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const group of groups) {
    const inside = node.x >= group.x - 4
      && node.y >= group.y - 4
      && node.x + node.width <= group.x + group.width + 12
      && node.y <= group.y + group.height + 600;
    if (!inside) continue;

    const area = group.width * group.height;
    if (area < bestArea) {
      best = group;
      bestArea = area;
    }
  }

  return best;
}

function fitNodeForReadableLayout(node: CanvasNode, preferredWidth?: number): CanvasNode {
  if (node.type === 'group') {
    return {
      ...node,
      width: Math.max(420, Math.min(720, Number(node.width) || AUTO_LAYOUT_GROUP_WIDTH)),
      height: Math.max(180, Number(node.height) || 260),
    };
  }

  if (node.type === 'file') {
    return {
      ...node,
      width: Math.max(260, Math.min(420, preferredWidth || Number(node.width) || 300)),
      height: Math.max(96, Math.min(140, Number(node.height) || 104)),
    };
  }

  const base = preferredWidth ? { ...node, width: preferredWidth } : node;
  const size = readableTextCardSize(base);
  return { ...node, width: size.width, height: size.height };
}

function packLooseCanvasNodes(
  items: CanvasNode[],
  options: { startX: number; startY: number; columns?: number; cardWidth?: number },
): void {
  if (items.length === 0) return;
  const sorted = [...items].sort((a, b) => a.x - b.x || a.y - b.y);
  const columns = Math.max(1, Math.min(options.columns || AUTO_LAYOUT_MAX_COLUMNS, items.length));
  const columnWidth = Math.max(360, options.cardWidth || READABLE_CARD_MIN_WIDTH);
  const columnY = Array.from({ length: columns }, () => options.startY);

  sorted.forEach((node, index) => {
    const col = columns === 1 ? 0 : index % columns;
    const fitted = fitNodeForReadableLayout(node, columnWidth);
    Object.assign(node, fitted, {
      x: snap(options.startX + col * (columnWidth + AUTO_LAYOUT_COLUMN_GAP), GRID_SIZE),
      y: snap(columnY[col], GRID_SIZE),
    });
    columnY[col] += node.height + AUTO_LAYOUT_ROW_GAP;
  });
}

function canvasRectsOverlap(a: CanvasNode, b: CanvasNode, gap = 8): boolean {
  return a.x < b.x + b.width + gap
    && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap
    && a.y + a.height + gap > b.y;
}

function needsSafetyCanvasReflow(nodes: CanvasNode[]): boolean {
  const groups = nodes.filter((node) => node.type === 'group');
  const nonGroups = nodes.filter((node) => node.type !== 'group');

  for (let i = 0; i < nonGroups.length; i++) {
    for (let j = i + 1; j < nonGroups.length; j++) {
      if (canvasRectsOverlap(nonGroups[i], nonGroups[j], 12)) return true;
    }
  }

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (canvasRectsOverlap(groups[i], groups[j], 20)) return true;
    }
  }

  for (const node of nonGroups) {
    const containing = findDisplayContainingGroup(node, groups);
    for (const group of groups) {
      if (containing?.id === group.id) continue;
      if (canvasRectsOverlap(node, group, 12)) return true;
    }
  }

  return false;
}

function analyzeCanvasQualityForDisplay(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasQualitySummary {
  const textCards = nodes.filter((node) => node.type === 'text');
  const groups = nodes.filter((node) => node.type === 'group');
  const nonGroups = nodes.filter((node) => node.type !== 'group');
  const joinedText = textCards.map((node) => String(node.text || '')).join('\n').toLowerCase();
  let overlapCount = 0;

  for (let i = 0; i < nonGroups.length; i++) {
    for (let j = i + 1; j < nonGroups.length; j++) {
      if (canvasRectsOverlap(nonGroups[i], nonGroups[j], 12)) overlapCount++;
    }
  }

  const denseCardCount = textCards.filter((node) => {
    const lines = estimateCardTextLines(node.text || '', node.width || DEFAULT_CARD_W);
    return lines > READABLE_CARD_MAX_LINES || String(node.text || '').length > 900;
  }).length;
  const missingGroup = nodes.length >= 6 && groups.length < 2;
  const missingLegend = nodes.length >= 6 && !/legend|status|priority|p0|p1|p2|图例|状态|优先级/.test(joinedText);
  const sparseConnections = textCards.length >= 5 && edges.length < Math.max(1, Math.floor(textCards.length / 3));
  const issues: string[] = [];
  const recommendations: string[] = [];
  if (overlapCount > 0) {
    issues.push(`${overlapCount} overlapping card area${overlapCount === 1 ? '' : 's'} detected.`);
    recommendations.push('Run Auto layout to separate cards and rebuild readable spacing.');
  }
  if (denseCardCount > 0) {
    issues.push(`${denseCardCount} text card${denseCardCount === 1 ? '' : 's'} may be too dense to read at a glance.`);
    recommendations.push('Use Split on long cards, or ask AI to create shorter board cards.');
  }
  if (missingGroup) {
    issues.push('The board has many cards but not enough group lanes.');
    recommendations.push('Use Group frames to separate phases, systems, or priority lanes.');
  }
  if (missingLegend) {
    issues.push('No clear legend or status card was found.');
    recommendations.push('Add a compact legend for P0/P1/P2, status colors, or delivery stages.');
  }
  if (sparseConnections) {
    issues.push('The board has few links compared with the number of cards.');
    recommendations.push('Connect related cards so the flow is easier to follow.');
  }
  const issueCount = issues.length === 0 ? 0 : overlapCount + denseCardCount + (missingGroup ? 1 : 0) + (missingLegend ? 1 : 0) + (sparseConnections ? 1 : 0);
  const score = Math.max(0, Math.min(100,
    100
    - overlapCount * 12
    - denseCardCount * 8
    - (missingGroup ? 12 : 0)
    - (missingLegend ? 8 : 0)
    - (sparseConnections ? 10 : 0)
  ));
  const level: CanvasQualityLevel = score >= 82 && issueCount === 0 ? 'good' : score >= 60 ? 'warn' : 'bad';
  const tips: string[] = [];
  if (overlapCount > 0) tips.push(`${overlapCount} overlap risk`);
  if (denseCardCount > 0) tips.push(`${denseCardCount} dense card${denseCardCount === 1 ? '' : 's'}`);
  if (missingGroup) tips.push('needs lanes');
  if (missingLegend) tips.push('needs legend');
  if (sparseConnections) tips.push('needs more links');

  return {
    score,
    level,
    issueCount,
    overlapCount,
    denseCardCount,
    missingGroup,
    missingLegend,
    sparseConnections,
    issues,
    recommendations: Array.from(new Set(recommendations)).slice(0, 4),
    tooltip: tips.length
      ? `Canvas quality ${score}/100: ${tips.join(', ')}. Click for details.`
      : `Canvas quality ${score}/100: looks clean. Click for details.`,
  };
}

function reflowCanvasNodesForDisplay(inputNodes: CanvasNode[], force = false): CanvasNode[] {
  const nodes = inputNodes.map((node) => ({ ...node }));
  if (!force && !needsSafetyCanvasReflow(nodes)) return nodes;

  const groups = nodes.filter((node) => node.type === 'group');
  const labels = nodes.filter((node) => node.type !== 'group' && isDisplayCanvasLabel(node));
  const regularItems = nodes.filter((node) => node.type !== 'group' && !isDisplayCanvasLabel(node));
  const groupedItems = new Map<string, CanvasNode[]>();
  const looseItems: CanvasNode[] = [];

  for (const node of regularItems) {
    const group = findDisplayContainingGroup(node, groups);
    if (!group) {
      looseItems.push(node);
      continue;
    }
    const items = groupedItems.get(group.id) || [];
    items.push(node);
    groupedItems.set(group.id, items);
  }

  if (labels.length > 0) {
    let labelX = AUTO_LAYOUT_START_X;
    let labelY = 24;
    const labelMaxX = AUTO_LAYOUT_START_X + AUTO_LAYOUT_MAX_COLUMNS * (AUTO_LAYOUT_GROUP_WIDTH + AUTO_LAYOUT_COLUMN_GAP);
    labels
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .forEach((node) => {
        const fitted = fitNodeForReadableLayout(node);
        Object.assign(node, fitted);
        if (labelX + node.width > labelMaxX) {
          labelX = AUTO_LAYOUT_START_X;
          labelY += 104;
        }
        node.x = snap(labelX, GRID_SIZE);
        node.y = snap(labelY, GRID_SIZE);
        labelX += node.width + 28;
      });
  }

  if (groups.length > 0) {
    const startY: number = labels.length > 0 ? 140 : AUTO_LAYOUT_START_Y;
    const columns = Math.max(1, Math.min(AUTO_LAYOUT_MAX_COLUMNS, groups.length));
    const columnY: number[] = Array.from({ length: columns }, () => startY);

    groups
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .forEach((group) => {
        const col = columnY.indexOf(Math.min(...columnY));
        const groupX = AUTO_LAYOUT_START_X + col * (AUTO_LAYOUT_GROUP_WIDTH + AUTO_LAYOUT_COLUMN_GAP);
        group.x = snap(groupX, GRID_SIZE);
        group.y = snap(columnY[col], GRID_SIZE);
        group.width = Math.max(AUTO_LAYOUT_GROUP_WIDTH, Math.min(720, group.width || AUTO_LAYOUT_GROUP_WIDTH));

        const items = (groupedItems.get(group.id) || []).sort((a, b) => a.y - b.y || a.x - b.x);
        let cursor = group.y + AUTO_LAYOUT_GROUP_HEADER;
        for (const node of items) {
          const innerWidth = Math.max(260, group.width - AUTO_LAYOUT_GROUP_PADDING * 2);
          const fitted = fitNodeForReadableLayout(node, innerWidth);
          Object.assign(node, fitted, {
            x: snap(group.x + AUTO_LAYOUT_GROUP_PADDING, GRID_SIZE),
            y: snap(cursor, GRID_SIZE),
            width: innerWidth,
          });
          cursor = node.y + node.height + 28;
        }

        group.height = Math.max(220, cursor - group.y + AUTO_LAYOUT_GROUP_PADDING);
        columnY[col] = group.y + group.height + 62;
      });

    const looseStartY = Math.max(...columnY, startY) + (looseItems.length > 0 ? 24 : 0);
    packLooseCanvasNodes(looseItems, {
      startX: AUTO_LAYOUT_START_X,
      startY: looseStartY,
      columns: Math.min(AUTO_LAYOUT_MAX_COLUMNS, Math.max(1, looseItems.length)),
      cardWidth: 380,
    });
  } else {
    packLooseCanvasNodes(regularItems, {
      startX: AUTO_LAYOUT_START_X,
      startY: labels.length > 0 ? 140 : AUTO_LAYOUT_START_Y,
      columns: Math.min(AUTO_LAYOUT_MAX_COLUMNS, Math.max(1, regularItems.length)),
      cardWidth: 380,
    });
  }

  return nodes;
}

function layoutCanvasNodesByEdges(inputNodes: CanvasNode[], edges: CanvasEdge[], selectedIds?: Set<string>): CanvasNode[] {
  const nodes = inputNodes.map((node) => ({ ...node }));
  const targetIds = selectedIds && selectedIds.size > 1
    ? selectedIds
    : new Set(nodes.filter(node => node.type !== 'group').map(node => node.id));
  const movableNodes = nodes.filter(node => targetIds.has(node.id) && node.type !== 'group');
  if (movableNodes.length === 0) return reflowCanvasNodesForDisplay(nodes);

  const movableIdSet = new Set(movableNodes.map(node => node.id));
  const relevantEdges = edges.filter(edge => movableIdSet.has(edge.fromNode) && movableIdSet.has(edge.toNode));
  const rank = new Map<string, number>();
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, CanvasEdge[]>();

  for (const node of movableNodes) {
    rank.set(node.id, 0);
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of relevantEdges) {
    indegree.set(edge.toNode, (indegree.get(edge.toNode) || 0) + 1);
    outgoing.get(edge.fromNode)?.push(edge);
  }

  const queue = movableNodes.filter(node => (indegree.get(node.id) || 0) === 0).map(node => node.id);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited.add(current);
    const currentRank = rank.get(current) || 0;
    for (const edge of outgoing.get(current) || []) {
      rank.set(edge.toNode, Math.max(rank.get(edge.toNode) || 0, currentRank + 1));
      indegree.set(edge.toNode, Math.max(0, (indegree.get(edge.toNode) || 0) - 1));
      if ((indegree.get(edge.toNode) || 0) === 0 && !visited.has(edge.toNode)) {
        queue.push(edge.toNode);
      }
    }
  }

  const baseX = Math.min(...movableNodes.map(node => node.x));
  const baseY = Math.min(...movableNodes.map(node => node.y));
  const columns = new Map<number, CanvasNode[]>();
  for (const node of movableNodes) {
    const col = rank.get(node.id) || 0;
    const items = columns.get(col) || [];
    items.push(node);
    columns.set(col, items);
  }

  const positioned = new Map<string, { x: number; y: number }>();
  const colGap = 440;
  for (const [col, items] of columns.entries()) {
    const sorted = items.sort((a, b) => a.y - b.y || a.x - b.x);
    let cursorY = baseY;
    for (const node of sorted) {
      const fitted = fitNodeForReadableLayout(node, 380);
      Object.assign(node, fitted);
      positioned.set(node.id, {
        x: snap(baseX + col * colGap, GRID_SIZE),
        y: snap(cursorY, GRID_SIZE),
      });
      cursorY += Math.max(node.height, MIN_CARD_H) + 72;
    }
  }

  for (const node of nodes) {
    const pos = positioned.get(node.id);
    if (pos) Object.assign(node, pos);
  }

  return reflowCanvasNodesForDisplay(nodes, true);
}

function fitCanvasNodesForDisplay(nodes: CanvasNode[]): CanvasNode[] {
  const fitted = nodes.map((node) => {
    if (node.type !== 'text') return node;
    const text = String(node.text || '');
    const width = Math.max(300, Math.min(620, Number(node.width) || DEFAULT_CARD_W));
    const neededHeight = Math.ceil(estimateCardTextLines(text, width) * 19 + 44);
    const height = Math.max(Number(node.height) || 0, Math.max(MIN_CARD_H, Math.min(900, neededHeight)));
    if (width === node.width && height === node.height) return node;
    return { ...node, width, height };
  });
  return reflowCanvasNodesForDisplay(fitted);
}

function readableTextCardSize(node: CanvasNode): { width: number; height: number } {
  const text = String(node.text || '');
  const labelLike = isDisplayCanvasLabel(node);
  const baseWidth = Number(node.width) || DEFAULT_CARD_W;
  const width = labelLike
    ? Math.max(260, Math.min(READABLE_CARD_MAX_WIDTH, baseWidth))
    : Math.max(READABLE_CARD_MIN_WIDTH, Math.min(READABLE_CARD_MAX_WIDTH, baseWidth < READABLE_CARD_MIN_WIDTH && text.length > 160 ? READABLE_CARD_MIN_WIDTH : baseWidth));
  const lines = estimateCardTextLines(text, width);
  const neededHeight = Math.ceil(lines * 19 + 46);
  const minHeight = labelLike ? 56 : 118;
  const maxHeight = labelLike ? 96 : READABLE_CARD_MAX_HEIGHT;
  return {
    width,
    height: Math.max(minHeight, Math.min(maxHeight, neededHeight)),
  };
}

function normalizeCanvasDataForDisplay(rawNodes: CanvasNode[], rawEdges: CanvasEdge[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nextNodes: CanvasNode[] = [];
  const continuationEdges: CanvasEdge[] = [];
  const firstPartById = new Map<string, string>();
  const lastPartById = new Map<string, string>();

  rawNodes.forEach((node, index) => {
    if (!node || node.type !== 'text') {
      nextNodes.push({ ...node });
      return;
    }

    const baseNode = { ...node, id: String(node.id || `node_${index + 1}`) };
    const size = readableTextCardSize(baseNode);
    const chunks = isDisplayCanvasLabel(baseNode)
      ? [String(baseNode.text || '')]
      : splitTextIntoReadableChunks(baseNode.text || '', size.width);
    let y = Number(baseNode.y) || 0;
    let previousId = '';

    chunks.forEach((chunk, partIndex) => {
      const partId = partIndex === 0 ? baseNode.id : `${baseNode.id}_part_${partIndex + 1}`;
      const partNode: CanvasNode = {
        ...baseNode,
        id: partId,
        y,
        width: size.width,
        height: readableTextCardSize({ ...baseNode, text: chunk, width: size.width }).height,
        text: chunk,
      };
      nextNodes.push(partNode);

      if (partIndex === 0) {
        firstPartById.set(baseNode.id, partId);
      } else {
        continuationEdges.push({
          id: `edge_${baseNode.id}_part_${partIndex}`,
          fromNode: previousId,
          fromSide: 'bottom',
          toNode: partId,
          toSide: 'top',
          color: baseNode.color,
        });
      }

      previousId = partId;
      y += partNode.height + 28;
    });

    lastPartById.set(baseNode.id, previousId || baseNode.id);
  });

  const remappedEdges = rawEdges.map((edge) => ({
    ...edge,
    fromNode: lastPartById.get(String(edge.fromNode || '')) || edge.fromNode,
    toNode: firstPartById.get(String(edge.toNode || '')) || edge.toNode,
  }));

  return {
    nodes: reflowCanvasNodesForDisplay(nextNodes),
    edges: [...remappedEdges, ...continuationEdges],
  };
}

function snap(val: number, grid: number): number {
  return Math.round(val / grid) * grid;
}

function connPoint(n: CanvasNode, side: CanvasSide | string): { x: number; y: number } {
  switch (side) {
    case 'top': return { x: n.x + n.width / 2, y: n.y };
    case 'bottom': return { x: n.x + n.width / 2, y: n.y + n.height };
    case 'left': return { x: n.x, y: n.y + n.height / 2 };
    default: return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

function autoSides(from: CanvasNode, to: CanvasNode): { fs: CanvasSide; ts: CanvasSide } {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? { fs: 'right', ts: 'left' } : { fs: 'left', ts: 'right' };
  }
  return dy > 0 ? { fs: 'bottom', ts: 'top' } : { fs: 'top', ts: 'bottom' };
}

/* Simple markdown → HTML renderer for canvas card content */
function renderCardMarkdown(text: string): string {
  if (!text) return '<span style="color:#4b5563">双击编辑...</span>';

  let html = text
    /* Escape HTML entities */
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    /* Headings: # H1 → styled heading */
    .replace(/^### (.+)$/gm, '<div class="cv-md-h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="cv-md-h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="cv-md-h1">$1</div>')
    /* Bold */
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    /* Italic */
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    /* Inline code */
    .replace(/`([^`]+)`/g, '<code class="cv-md-code">$1</code>')
    /* Wiki links */
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="cv-md-wiki">$1</span>')
    /* Links */
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="cv-md-link" title="$2">$1</a>')
    /* Horizontal rule */
    .replace(/^---$/gm, '<hr class="cv-md-hr"/>')
    /* Unordered list items */
    .replace(/^[-*] (.+)$/gm, '<div class="cv-md-li">• $1</div>')
    /* Ordered list items */
    .replace(/^\d+\. (.+)$/gm, (match, content) => {
      return `<div class="cv-md-li">${match.split('.')[0]}. ${content}</div>`;
    });

  /* Line breaks → actual newlines */
  html = html.replace(/\n/g, '<br/>');

  return html;
}

function edgePath(from: CanvasNode, to: CanvasNode, fs: string, ts: string): string {
  const p1 = connPoint(from, fs);
  const p2 = connPoint(to, ts);
  const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  const off = Math.max(40, dist * 0.25);
  const c1 = { ...p1 }, c2 = { ...p2 };
  if (fs === 'right') c1.x += off; else if (fs === 'left') c1.x -= off;
  else if (fs === 'bottom') c1.y += off; else c1.y -= off;
  if (ts === 'right') c2.x += off; else if (ts === 'left') c2.x -= off;
  else if (ts === 'bottom') c2.y += off; else c2.y -= off;
  return `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
}

/* ═══════════════════════════════════════════════════════
   Props
   ═══════════════════════════════════════════════════════ */

interface CanvasEditorProps {
  content: string;
  onChange: (json: string) => void;
  onSave?: () => void;
  vaultPath?: string;
  fileName?: string;
  onOpenFile?: (path: string) => void;
}

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */

export default function CanvasEditor({ content, onChange, onSave, fileName, onOpenFile }: CanvasEditorProps) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [qualityPanelOpen, setQualityPanelOpen] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [canvasMode, setCanvasMode] = useState<MindMapCanvasMode>('free');
  const [mindMapOutlineOpen, setMindMapOutlineOpen] = useState(false);
  const [mindMapSearchOpen, setMindMapSearchOpen] = useState(false);
  const [mindMapHelpOpen, setMindMapHelpOpen] = useState(false);
  const [mindMapSearchQuery, setMindMapSearchQuery] = useState('');
  const [mindMapSearchIndex, setMindMapSearchIndex] = useState(0);
  const [mindMapNotice, setMindMapNotice] = useState('');

  /* Refs for imperative drag state — no re-renders during drag */
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const selectedRef = useRef<string | null>(null);
  const selectedEdgeRef = useRef<string | null>(null);
  const editingRef = useRef<string | null>(null);

  /* Drag state refs */
  const modeRef = useRef<'idle' | 'pan' | 'press-node' | 'drag' | 'resize' | 'connect' | 'select-box'>('idle');
  const dragInfoRef = useRef<{ nodeId: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const resizeInfoRef = useRef<{
    nodeId: string;
    direction: ResizeDirection;
    startX: number;
    startY: number;
    nodeX: number;
    nodeY: number;
    nodeW: number;
    nodeH: number;
  } | null>(null);
  const panStartRef = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null);
  const connInfoRef = useRef<{ fromId: string; fromSide: string; curX: number; curY: number } | null>(null);
  const selectBoxRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const multiSelectRef = useRef<Set<string>>(new Set());
  const animFrameRef = useRef<number>(0);
  const tempLineRef = useRef<{ fromId: string; fromSide: string; x1: number; y1: number; x2: number; y2: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hasLoadedValidContentRef = useRef(false);
  const undoStackRef = useRef<CanvasSnapshot[]>([]);
  const redoStackRef = useRef<CanvasSnapshot[]>([]);
  const interactionStartSnapshotRef = useRef<CanvasSnapshot | null>(null);
  const editStartSnapshotRef = useRef<CanvasSnapshot | null>(null);
  const lastSerializedRef = useRef('');
  const canvasModeRef = useRef<MindMapCanvasMode>('free');
  const mindMapDropTargetRef = useRef<MindMapDropHint | null>(null);
  const mindMapDragTargetsRef = useRef<CanvasNode[]>([]);
  const lastMindMapAutoFitKeyRef = useRef('');
  const mindMapSearchInputRef = useRef<HTMLInputElement>(null);
  const mindMapNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Keep refs in sync */
  nodesRef.current = nodes;
  edgesRef.current = edges;
  panRef.current = pan;
  zoomRef.current = zoom;
  selectedRef.current = selected;
  selectedEdgeRef.current = selectedEdge;
  editingRef.current = editing;
  canvasModeRef.current = canvasMode;

  const showMindMapNotice = useCallback((message: string) => {
    setMindMapNotice(message);
    if (mindMapNoticeTimerRef.current) clearTimeout(mindMapNoticeTimerRef.current);
    mindMapNoticeTimerRef.current = setTimeout(() => setMindMapNotice(''), 2200);
  }, []);

  const makeSnapshot = useCallback((): CanvasSnapshot => ({
    nodes: cloneNodes(nodesRef.current),
    edges: cloneEdges(edgesRef.current),
    selected: selectedRef.current,
    selectedEdge: selectedEdgeRef.current,
    canvasMode: canvasModeRef.current,
  }), []);

  const pushHistory = useCallback((snapshot: CanvasSnapshot) => {
    const current = makeSnapshot();
    if (snapshotEquals(snapshot, current)) return;
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistoryTick(tick => tick + 1);
  }, [makeSnapshot]);

  const persistCanvas = useCallback((n: CanvasNode[], e: CanvasEdge[], immediate = false) => {
    const serialized = serializeCanvas(n, e, canvasModeRef.current);
    lastSerializedRef.current = serialized;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (immediate) {
      onChange(serialized);
      return;
    }
    debounceRef.current = setTimeout(() => {
      onChange(serialized);
    }, 300);
  }, [onChange]);

  const applyCanvasSnapshot = useCallback((snapshot: CanvasSnapshot, persist = true) => {
    const nextNodes = cloneNodes(snapshot.nodes);
    const nextEdges = cloneEdges(snapshot.edges);
    setNodes(nextNodes);
    setEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setSelected(snapshot.selected);
    selectedRef.current = snapshot.selected;
    setSelectedEdge(snapshot.selectedEdge);
    selectedEdgeRef.current = snapshot.selectedEdge;
    setEditing(null);
    editingRef.current = null;
    setCanvasMode(snapshot.canvasMode);
    canvasModeRef.current = snapshot.canvasMode;
    multiSelectRef.current.clear();
    if (persist) persistCanvas(nextNodes, nextEdges, true);
  }, [persistCanvas]);

  /* ── Parse content ── */
  useEffect(() => {
    if (!content.trim()) {
      setNodes([]);
      setEdges([]);
      nodesRef.current = [];
      edgesRef.current = [];
      setCanvasMode('free');
      canvasModeRef.current = 'free';
      hasLoadedValidContentRef.current = true;
      return;
    }

    try {
      const data = JSON.parse(content);
      const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
      const parsedEdges = Array.isArray(data.edges) ? data.edges : [];
      const parsedMode: MindMapCanvasMode = data.mode === 'mindmap' ? 'mindmap' : 'free';
      const normalizedBase = normalizeCanvasDataForDisplay(rawNodes, parsedEdges);
      const normalized = parsedMode === 'mindmap'
        ? (() => {
          const contentSizedNodes = sizeMindMapNodesToContent(normalizedBase.nodes, normalizedBase.edges);
          const safeEdges = sanitizeMindMapEdges(contentSizedNodes, normalizedBase.edges);
          const mindMapNodes = layoutMindMapNodes(contentSizedNodes, safeEdges);
          return { nodes: mindMapNodes, edges: normalizeMindMapEdges(safeEdges, mindMapNodes) };
        })()
        : normalizedBase;
      setNodes(normalized.nodes);
      setEdges(normalized.edges);
      setCanvasMode(parsedMode);
      nodesRef.current = normalized.nodes;
      edgesRef.current = normalized.edges;
      canvasModeRef.current = parsedMode;
      hasLoadedValidContentRef.current = true;
    } catch {
      if (!hasLoadedValidContentRef.current) {
        const recovered = normalizeCanvasDataForDisplay([{
          id: 'recovered_source',
          type: 'text',
          x: 80,
          y: 80,
          width: 560,
          height: 180,
          color: '6',
          text: content.trim() || '# Recovered Canvas\n\nThis file was not valid Canvas JSON, so Ars-note opened the source text as an editable card.',
        }], []);
        setNodes(recovered.nodes);
        setEdges(recovered.edges);
        nodesRef.current = recovered.nodes;
        edgesRef.current = recovered.edges;
        setCanvasMode('free');
        canvasModeRef.current = 'free';
      }
    }
  }, [content]);

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    interactionStartSnapshotRef.current = null;
    editStartSnapshotRef.current = null;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    setContextMenu(null);
    setQualityPanelOpen(false);
    setHistoryTick(tick => tick + 1);
  }, [fileName]);

  useEffect(() => {
    if (nodes.length === 0) setQualityPanelOpen(false);
  }, [nodes.length]);

  /* ── Serialize (debounced) ── */
  const saveCanvas = useCallback((n: CanvasNode[], e: CanvasEdge[], options: SaveCanvasOptions = {}) => {
    const shouldRecordHistory = options.history !== false;
    const previousSnapshot = options.historySnapshot ?? makeSnapshot();
    if (shouldRecordHistory) pushHistory(previousSnapshot);
    else if (!options.preserveRedo && redoStackRef.current.length > 0) {
      redoStackRef.current = [];
      setHistoryTick(tick => tick + 1);
    }
    setNodes(n); setEdges(e);
    nodesRef.current = n;
    edgesRef.current = e;
    persistCanvas(n, e, options.immediate);
  }, [makeSnapshot, persistCanvas, pushHistory]);

  const finishTextEditing = useCallback((commit: boolean) => {
    if (!editingRef.current) return;
    const startSnapshot = editStartSnapshotRef.current;
    setEditing(null);
    editingRef.current = null;
    editStartSnapshotRef.current = null;

    if (!commit && startSnapshot) {
      applyCanvasSnapshot(startSnapshot);
      return;
    }
    if (canvasModeRef.current === 'mindmap') {
      const safeEdges = sanitizeMindMapEdges(nodesRef.current, edgesRef.current);
      const laidOut = layoutMindMapNodes(nodesRef.current, safeEdges);
      const normalizedEdges = normalizeMindMapEdges(safeEdges, laidOut);
      setNodes(laidOut);
      setEdges(normalizedEdges);
      nodesRef.current = laidOut;
      edgesRef.current = normalizedEdges;
    }
    if (startSnapshot) pushHistory(startSnapshot);
    persistCanvas(nodesRef.current, edgesRef.current, true);
  }, [applyCanvasSnapshot, persistCanvas, pushHistory]);

  const beginTextEditing = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node || node.type !== 'text') return;
    if (editingRef.current) finishTextEditing(true);
    if (editingRef.current !== nodeId) editStartSnapshotRef.current = makeSnapshot();
    multiSelectRef.current.clear();
    multiSelectRef.current.add(nodeId);
    setSelected(nodeId);
    selectedRef.current = nodeId;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    setEditing(nodeId);
    editingRef.current = nodeId;
  }, [finishTextEditing, makeSnapshot]);

  const undoCanvas = useCallback(() => {
    if (editingRef.current) finishTextEditing(true);
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(makeSnapshot());
    applyCanvasSnapshot(previous);
    setHistoryTick(tick => tick + 1);
  }, [applyCanvasSnapshot, finishTextEditing, makeSnapshot]);

  const redoCanvas = useCallback(() => {
    if (editingRef.current) finishTextEditing(true);
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(makeSnapshot());
    applyCanvasSnapshot(next);
    setHistoryTick(tick => tick + 1);
  }, [applyCanvasSnapshot, finishTextEditing, makeSnapshot]);

  /* ── Screen → Canvas coordinate ── */
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - panRef.current.y) / zoomRef.current,
    };
  }, []);

  /* ── Apply transform directly to DOM (no React re-render) ── */
  const applyTransform = useCallback(() => {
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`;
    }
  }, []);

  /* ── Update temp connection line in SVG ── */
  const updateTempLine = useCallback((x1: number, y1: number, x2: number, y2: number, fromSide: string) => {
    const svg = svgRef.current;
    if (!svg) return;
    let path = svg.querySelector('.temp-conn') as SVGPathElement | null;
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'temp-conn');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#7c5cff');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('opacity', '0.5');
      path.setAttribute('stroke-dasharray', '6 4');
      svg.appendChild(path);
    }
    /* Simple bezier for temp line */
    const off = Math.max(30, Math.abs(x2 - x1) * 0.3);
    let c1x = x1, c1y = y1, c2x = x2, c2y = y2;
    if (fromSide === 'right') c1x += off;
    else if (fromSide === 'left') c1x -= off;
    else if (fromSide === 'bottom') c1y += off;
    else c1y -= off;
    path.setAttribute('d', `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`);
  }, []);

  const removeTempLine = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const path = svg.querySelector('.temp-conn');
    if (path) path.remove();
  }, []);

  /* ── Move a card's DOM element directly (no re-render) ── */
  const moveCardDOM = useCallback((nodeId: string, x: number, y: number) => {
    const el = viewportRef.current?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null;
    if (el) {
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }
  }, []);

  const setMindMapDropTarget = useCallback((hint: MindMapDropHint | null) => {
    const current = mindMapDropTargetRef.current;
    if (current?.targetId === hint?.targetId && current?.placement === hint?.placement) return;
    if (current) {
      viewportRef.current?.querySelector(`[data-node-id="${current.targetId}"]`)?.classList.remove(
        'mindmap-drop-target',
        'mindmap-drop-before',
        'mindmap-drop-after',
      );
    }
    mindMapDropTargetRef.current = hint;
    if (hint) {
      const className = hint.placement === 'child' ? 'mindmap-drop-target' : `mindmap-drop-${hint.placement}`;
      viewportRef.current?.querySelector(`[data-node-id="${hint.targetId}"]`)?.classList.add(className);
    }
  }, []);

  /* ── Resize a card's DOM element directly ── */
  const resizeCardDOM = useCallback((nodeId: string, x: number, y: number, w: number, h: number) => {
    const el = viewportRef.current?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null;
    if (el) {
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    }
  }, []);

  /* ── Pointer down on viewport ── */
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    setContextMenu(null);

    /* Middle mouse or Space+left → pan */
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      modeRef.current = 'pan';
      panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
      return;
    }

    /* Left click on empty canvas → deselect + selection box */
    if (e.button === 0 && (target === viewportRef.current || target.classList.contains('canvas-content') || target.classList.contains('canvas-grid'))) {
      if (editingRef.current) finishTextEditing(true);
      setSelected(null);
      setSelectedEdge(null);
      setEditing(null);
      selectedRef.current = null;
      selectedEdgeRef.current = null;
      editingRef.current = null;
      multiSelectRef.current.clear();

      /* Start selection box */
      const pos = screenToCanvas(e.clientX, e.clientY);
      modeRef.current = 'select-box';
      selectBoxRef.current = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, [finishTextEditing, screenToCanvas]);

  /* ── Pointer move (global, captured) ── */
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    let mode = modeRef.current;

    if (mode === 'press-node' && dragInfoRef.current) {
      if (!hasExceededMindMapDragThreshold(
        dragInfoRef.current.startX,
        dragInfoRef.current.startY,
        e.clientX,
        e.clientY,
      )) return;
      modeRef.current = 'drag';
      mode = 'drag';
    }

    if (mode === 'pan' && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      panRef.current = {
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      };
      applyTransform();
      return;
    }

    if (mode === 'drag' && dragInfoRef.current) {
      const dx = (e.clientX - dragInfoRef.current.startX) / zoomRef.current;
      const dy = (e.clientY - dragInfoRef.current.startY) / zoomRef.current;
      const newX = snap(dragInfoRef.current.nodeX + dx, GRID_SIZE);
      const newY = snap(dragInfoRef.current.nodeY + dy, GRID_SIZE);
      /* Move all selected cards */
      const origDeltaX = dragInfoRef.current.nodeX;
      const origDeltaY = dragInfoRef.current.nodeY;
      const newNodes = nodesRef.current.map(n => {
        if (n.id === dragInfoRef.current!.nodeId) {
          moveCardDOM(n.id, newX, newY);
          return { ...n, x: newX, y: newY };
        }
        if (multiSelectRef.current.has(n.id)) {
          const movedX = snap(n.x + (newX - origDeltaX), GRID_SIZE);
          const movedY = snap(n.y + (newY - origDeltaY), GRID_SIZE);
          moveCardDOM(n.id, movedX, movedY);
          return { ...n, x: movedX, y: movedY };
        }
        return n;
      });
      nodesRef.current = newNodes;
      if (canvasModeRef.current === 'mindmap') {
        const pointer = screenToCanvas(e.clientX, e.clientY);
        const draggedId = dragInfoRef.current.nodeId;
        const target = mindMapDragTargetsRef.current.find((node) => node.id !== draggedId
          && pointer.x >= node.x && pointer.x <= node.x + node.width
          && pointer.y >= node.y && pointer.y <= node.y + node.height
        );
        if (!target) {
          setMindMapDropTarget(null);
        } else {
          const targetParentId = getMindMapParentId(target.id, nodesRef.current, edgesRef.current);
          const placement = getMindMapDropPlacement(pointer.y, target.y, target.height, Boolean(targetParentId));
          const candidateParentId = placement === 'child' ? target.id : targetParentId;
          setMindMapDropTarget(candidateParentId
            && canReparentMindMapNode(draggedId, candidateParentId, nodesRef.current, edgesRef.current)
            ? { targetId: target.id, placement }
            : null);
        }
      }
      return;
    }

    if (mode === 'resize' && resizeInfoRef.current) {
      const info = resizeInfoRef.current;
      const dx = (e.clientX - info.startX) / zoomRef.current;
      const dy = (e.clientY - info.startY) / zoomRef.current;
      const right = info.nodeX + info.nodeW;
      const bottom = info.nodeY + info.nodeH;

      let newX = info.nodeX;
      let newY = info.nodeY;
      let newW = info.nodeW;
      let newH = info.nodeH;

      if (info.direction.includes('e')) {
        newW = Math.max(MIN_CARD_W, snap(info.nodeW + dx, GRID_SIZE));
      }
      if (info.direction.includes('s')) {
        newH = Math.max(MIN_CARD_H, snap(info.nodeH + dy, GRID_SIZE));
      }
      if (info.direction.includes('w')) {
        newW = Math.max(MIN_CARD_W, snap(info.nodeW - dx, GRID_SIZE));
        newX = snap(right - newW, GRID_SIZE);
      }
      if (info.direction.includes('n')) {
        newH = Math.max(MIN_CARD_H, snap(info.nodeH - dy, GRID_SIZE));
        newY = snap(bottom - newH, GRID_SIZE);
      }

      resizeCardDOM(info.nodeId, newX, newY, newW, newH);
      const newNodes = nodesRef.current.map(n =>
        n.id === info.nodeId ? { ...n, x: newX, y: newY, width: newW, height: newH } : n
      );
      nodesRef.current = newNodes;
      return;
    }

    if (mode === 'connect' && connInfoRef.current) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      const fromNode = nodesRef.current.find(n => n.id === connInfoRef.current!.fromId);
      if (fromNode) {
        const pt = connPoint(fromNode, connInfoRef.current.fromSide);
        updateTempLine(pt.x, pt.y, pos.x, pos.y, connInfoRef.current.fromSide);
      }
      return;
    }

    if (mode === 'select-box' && selectBoxRef.current) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      selectBoxRef.current.endX = pos.x;
      selectBoxRef.current.endY = pos.y;
      /* Highlight intersecting nodes */
      const box = selectBoxRef.current;
      const minX = Math.min(box.startX, box.endX);
      const maxX = Math.max(box.startX, box.endX);
      const minY = Math.min(box.startY, box.endY);
      const maxY = Math.max(box.startY, box.endY);
      const newSelected = new Set<string>();
      for (const n of nodesRef.current) {
        if (n.x + n.width > minX && n.x < maxX && n.y + n.height > minY && n.y < maxY) {
          newSelected.add(n.id);
        }
      }
      multiSelectRef.current = newSelected;
      /* Update selection box visual */
      const selectEl = viewportRef.current?.querySelector('.canvas-select-box') as HTMLElement | null;
      if (selectEl) {
        selectEl.style.display = 'block';
        selectEl.style.left = minX + 'px';
        selectEl.style.top = minY + 'px';
        selectEl.style.width = (maxX - minX) + 'px';
        selectEl.style.height = (maxY - minY) + 'px';
      }
    }
  }, [applyTransform, screenToCanvas, moveCardDOM, resizeCardDOM, setMindMapDropTarget, updateTempLine]);

  /* ── Pointer up ── */
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const mode = modeRef.current;

    if (mode === 'press-node') {
      dragInfoRef.current = null;
      mindMapDragTargetsRef.current = [];
      interactionStartSnapshotRef.current = null;
      modeRef.current = 'idle';
      return;
    }

    if (mode === 'pan') {
      setPan({ ...panRef.current });
      modeRef.current = 'idle';
      if (viewportRef.current) viewportRef.current.style.cursor = '';
      return;
    }

    if (mode === 'drag' && canvasModeRef.current === 'mindmap') {
      const draggedId = dragInfoRef.current?.nodeId || null;
      const dropHint = mindMapDropTargetRef.current;
      setMindMapDropTarget(null);
      let nextNodes = [...nodesRef.current];
      let nextEdges = [...edgesRef.current];
      if (draggedId && dropHint) {
        const targetId = dropHint.targetId;
        const targetNode = nextNodes.find((node) => node.id === targetId);
        const targetParentId = getMindMapParentId(targetId, nextNodes, nextEdges);
        const parentId = dropHint.placement === 'child' ? targetId : targetParentId;
        if (parentId && canReparentMindMapNode(draggedId, parentId, nextNodes, nextEdges)) {
          const parentNode = nextNodes.find((node) => node.id === parentId);
          const targetSide = getMindMapBranchSide(
            dropHint.placement === 'child' ? parentId : targetId,
            nextNodes,
            nextEdges,
          ) || (screenToCanvas(e.clientX, e.clientY).x < (parentNode ? parentNode.x + parentNode.width / 2 : 0) ? 'left' : 'right');
          const oldIncoming = nextEdges.find((edge) => edge.toNode === draggedId);
          nextEdges = nextEdges.filter((edge) => edge.toNode !== draggedId);
          const newEdge: CanvasEdge = {
            id: oldIncoming?.id || `mindmap_${parentId}_${draggedId}_${uid()}`,
            fromNode: parentId,
            toNode: draggedId,
            fromSide: targetSide,
            toSide: targetSide === 'left' ? 'right' : 'left',
          };
          if (dropHint.placement === 'child') {
            nextEdges.push(newEdge);
          } else {
            const targetEdgeIndex = nextEdges.findIndex((edge) => edge.toNode === targetId);
            const insertIndex = targetEdgeIndex < 0
              ? nextEdges.length
              : targetEdgeIndex + (dropHint.placement === 'after' ? 1 : 0);
            nextEdges.splice(insertIndex, 0, newEdge);
          }
          nextNodes = nextNodes.map((node) => node.id === draggedId
          ? { ...node, branchSide: targetSide }
            : node.id === parentId && node.collapsed ? { ...node, collapsed: false } : node);
        }
      }
      nextEdges = sanitizeMindMapEdges(nextNodes, nextEdges);
      nextNodes = layoutMindMapNodes(nextNodes, nextEdges);
      nextEdges = normalizeMindMapEdges(nextEdges, nextNodes);
      saveCanvas(nextNodes, nextEdges, {
        historySnapshot: interactionStartSnapshotRef.current,
        immediate: true,
      });
      interactionStartSnapshotRef.current = null;
      dragInfoRef.current = null;
      mindMapDragTargetsRef.current = [];
      modeRef.current = 'idle';
      return;
    }

    if (mode === 'drag' || mode === 'resize') {
      saveCanvas([...nodesRef.current], edgesRef.current, {
        historySnapshot: interactionStartSnapshotRef.current,
        immediate: true,
      });
      interactionStartSnapshotRef.current = null;
      mindMapDragTargetsRef.current = [];
      modeRef.current = 'idle';
      return;
    }

    if (mode === 'connect') {
      removeTempLine();
      if (connInfoRef.current) {
        const pos = screenToCanvas(e.clientX, e.clientY);
        const { fromId } = connInfoRef.current;
        const target = nodesRef.current.find(n => n.id !== fromId &&
          pos.x >= n.x && pos.x <= n.x + n.width &&
          pos.y >= n.y && pos.y <= n.y + n.height);
        if (target) {
          const from = nodesRef.current.find(n => n.id === fromId)!;
          const sides = autoSides(from, target);
          const newEdge: CanvasEdge = {
            id: uid(), fromNode: fromId, fromSide: sides.fs,
            toNode: target.id, toSide: sides.ts,
          };
          const newEdges = [...edgesRef.current, newEdge];
          saveCanvas(nodesRef.current, newEdges);
        }
        connInfoRef.current = null;
      }
      modeRef.current = 'idle';
      return;
    }

    if (mode === 'select-box') {
      /* Hide selection box */
      const selectEl = viewportRef.current?.querySelector('.canvas-select-box') as HTMLElement | null;
      if (selectEl) selectEl.style.display = 'none';
      if (multiSelectRef.current.size > 0) {
        /* Select the first one as primary */
        const first = multiSelectRef.current.values().next().value;
        setSelected(first as string);
        selectedRef.current = first as string;
        setSelectedEdge(null);
        selectedEdgeRef.current = null;
      }
      modeRef.current = 'idle';
      return;
    }

    modeRef.current = 'idle';
  }, [removeTempLine, saveCanvas, screenToCanvas, setMindMapDropTarget]);

  /* ── Trackpad-style pan; Ctrl/Cmd + wheel zooms around the pointer ── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (!e.ctrlKey && !e.metaKey) {
      panRef.current = {
        x: panRef.current.x - (e.shiftKey && Math.abs(e.deltaX) < 1 ? e.deltaY : e.deltaX),
        y: panRef.current.y - (e.shiftKey ? 0 : e.deltaY),
      };
      applyTransform();
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(() => setPan({ ...panRef.current }));
      return;
    }

    const factor = e.deltaY > 0 ? (1 - ZOOM_STEP) : (1 + ZOOM_STEP);
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * factor));
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    panRef.current = {
      x: mx - (mx - panRef.current.x) * (newZoom / zoomRef.current),
      y: my - (my - panRef.current.y) * (newZoom / zoomRef.current),
    };
    zoomRef.current = newZoom;
    applyTransform();

    /* Batch state update */
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(() => {
      setPan({ ...panRef.current });
      setZoom(zoomRef.current);
    });
  }, [applyTransform]);

  /* ── Double-click to create card ── */
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target !== viewportRef.current && !target.classList.contains('canvas-content') && !target.classList.contains('canvas-grid')) return;

    const pos = screenToCanvas(e.clientX, e.clientY);
    const newNode: CanvasNode = {
      id: uid(), type: 'text',
      x: snap(pos.x - DEFAULT_CARD_W / 2, GRID_SIZE),
      y: snap(pos.y - DEFAULT_CARD_H / 2, GRID_SIZE),
      width: DEFAULT_CARD_W, height: DEFAULT_CARD_H,
      text: '',
    };
    saveCanvas([...nodesRef.current, newNode], edgesRef.current);
    setSelected(newNode.id);
    selectedRef.current = newNode.id;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    setEditing(newNode.id);
    editingRef.current = newNode.id;
  }, [screenToCanvas, saveCanvas]);

  /* ── Card interactions ── */
  const startDrag = useCallback((e: React.PointerEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node) return;

    if (editingRef.current && editingRef.current !== nodeId) finishTextEditing(true);

    /* Structured maps use one primary selection; free canvas keeps multi-select. */
    if (canvasModeRef.current === 'mindmap' || !multiSelectRef.current.has(nodeId)) {
      multiSelectRef.current.clear();
    }
    multiSelectRef.current.add(nodeId);

    setSelected(nodeId);
    selectedRef.current = nodeId;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    setEditing(null);
    editingRef.current = null;

    modeRef.current = 'press-node';
    interactionStartSnapshotRef.current = makeSnapshot();
    if (canvasModeRef.current === 'mindmap') {
      const visibleIds = getMindMapVisibleNodeIds(nodesRef.current, edgesRef.current);
      const unavailableIds = getMindMapDescendantIds(nodeId, nodesRef.current, edgesRef.current);
      unavailableIds.add(nodeId);
      mindMapDragTargetsRef.current = nodesRef.current.filter((candidate) => (
        visibleIds.has(candidate.id) && !unavailableIds.has(candidate.id)
      ));
    } else {
      mindMapDragTargetsRef.current = [];
    }
    dragInfoRef.current = {
      nodeId, startX: e.clientX, startY: e.clientY,
      nodeX: node.x, nodeY: node.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [finishTextEditing, makeSnapshot]);

  const startResize = useCallback((e: React.PointerEvent, nodeId: string, direction: ResizeDirection) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node) return;
    setSelected(nodeId);
    selectedRef.current = nodeId;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    setEditing(null);
    editingRef.current = null;
    modeRef.current = 'resize';
    interactionStartSnapshotRef.current = makeSnapshot();
    resizeInfoRef.current = {
      nodeId,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
      nodeW: node.width,
      nodeH: node.height,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [makeSnapshot]);

  const startConnect = useCallback((e: React.PointerEvent, nodeId: string, side: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    modeRef.current = 'connect';
    connInfoRef.current = { fromId: nodeId, fromSide: side, curX: 0, curY: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleCardDoubleClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (node?.type === 'file' && onOpenFile) {
      onOpenFile(node.file || '');
      return;
    }
    if (node?.type === 'text') {
      beginTextEditing(nodeId);
    }
  }, [beginTextEditing, onOpenFile]);

  const handleTextEdit = useCallback((nodeId: string, text: string) => {
    const newNodes = nodesRef.current.map((node) => {
      if (node.id !== nodeId) return node;
      if (canvasModeRef.current !== 'mindmap') return { ...node, text };
      const size = mindMapNodeSize(text, !getMindMapParentId(nodeId, nodesRef.current, edgesRef.current));
      return {
        ...node,
        text,
        width: size.width,
        height: size.height,
      };
    });
    setNodes(newNodes);
    nodesRef.current = newNodes;
    persistCanvas(newNodes, edgesRef.current);
  }, [persistCanvas]);

  /* ── Toolbar actions ── */
  const getActiveSelection = useCallback(() => {
    const ids = new Set<string>(multiSelectRef.current);
    if (selectedRef.current) ids.add(selectedRef.current);
    return ids;
  }, []);

  const deleteSelectedNodes = useCallback(() => {
    if (editingRef.current) return;
    const toDelete = getActiveSelection();
    if (toDelete.size === 0) return;
    const newNodes = nodesRef.current.filter(n => !toDelete.has(n.id));
    const newEdges = edgesRef.current.filter(ed => !toDelete.has(ed.fromNode) && !toDelete.has(ed.toNode));
    multiSelectRef.current.clear();
    saveCanvas(newNodes, newEdges);
    setSelected(null);
    selectedRef.current = null;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
  }, [getActiveSelection, saveCanvas]);

  const duplicateSelectedNodes = useCallback(() => {
    const selectedIds = getActiveSelection();
    if (selectedIds.size === 0) return;

    const idMap = new Map<string, string>();
    const selectedNodes = nodesRef.current.filter(n => selectedIds.has(n.id));
    const copiedNodes = selectedNodes.map((node) => {
      const nextId = uid();
      idMap.set(node.id, nextId);
      return {
        ...node,
        id: nextId,
        x: snap(node.x + GRID_SIZE * 2, GRID_SIZE),
        y: snap(node.y + GRID_SIZE * 2, GRID_SIZE),
      };
    });
    const copiedEdges = edgesRef.current
      .filter(edge => selectedIds.has(edge.fromNode) && selectedIds.has(edge.toNode))
      .map(edge => ({
        ...edge,
        id: uid(),
        fromNode: idMap.get(edge.fromNode)!,
        toNode: idMap.get(edge.toNode)!,
      }));

    multiSelectRef.current = new Set(copiedNodes.map(node => node.id));
    const first = copiedNodes[0]?.id || null;
    setSelected(first);
    selectedRef.current = first;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    saveCanvas([...nodesRef.current, ...copiedNodes], [...edgesRef.current, ...copiedEdges]);
  }, [getActiveSelection, saveCanvas]);

  const updateNode = useCallback((nodeId: string, patch: Partial<CanvasNode>, options: SaveCanvasOptions = {}) => {
    const newNodes = nodesRef.current.map(n => n.id === nodeId ? { ...n, ...patch } : n);
    saveCanvas(newNodes, edgesRef.current, options);
  }, [saveCanvas]);

  const updateEdge = useCallback((edgeId: string, patch: Partial<CanvasEdge>, options: SaveCanvasOptions = {}) => {
    const newEdges = edgesRef.current.map(edge => edge.id === edgeId ? { ...edge, ...patch } : edge);
    saveCanvas(nodesRef.current, newEdges, options);
  }, [saveCanvas]);

  const fitTextNodeToContent = useCallback((nodeId: string | null) => {
    if (!nodeId) return;
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node || node.type !== 'text') return;
    const size = readableTextCardSize({
      ...node,
      width: Math.max(READABLE_CARD_MIN_WIDTH, Math.min(READABLE_CARD_MAX_WIDTH, node.width || DEFAULT_CARD_W)),
    });
    updateNode(node.id, size);
  }, [updateNode]);

  const splitTextNodeIntoReadableCards = useCallback((nodeId: string | null) => {
    if (!nodeId) return;
    const nodeIndex = nodesRef.current.findIndex(n => n.id === nodeId);
    const node = nodeIndex >= 0 ? nodesRef.current[nodeIndex] : null;
    if (!node || node.type !== 'text') return;

    const width = Math.max(READABLE_CARD_MIN_WIDTH, Math.min(READABLE_CARD_MAX_WIDTH, node.width || DEFAULT_CARD_W));
    const chunks = splitTextIntoReadableChunks(node.text || '', width);
    if (chunks.length <= 1) {
      fitTextNodeToContent(node.id);
      return;
    }

    let y = node.y;
    const partNodes = chunks.map((chunk, index) => {
      const partNode: CanvasNode = {
        ...node,
        id: index === 0 ? node.id : `${node.id}_part_${index + 1}_${uid()}`,
        y,
        width,
        text: chunk,
      };
      partNode.height = readableTextCardSize(partNode).height;
      y += partNode.height + 28;
      return partNode;
    });
    const lastPartId = partNodes[partNodes.length - 1]?.id || node.id;
    const existingEdges = edgesRef.current.map(edge =>
      edge.fromNode === node.id ? { ...edge, fromNode: lastPartId } : edge
    );
    const continuationEdges = partNodes.slice(1).map((part, index): CanvasEdge => ({
      id: `edge_${node.id}_manual_part_${index + 1}_${uid()}`,
      fromNode: partNodes[index].id,
      fromSide: 'bottom',
      toNode: part.id,
      toSide: 'top',
      color: node.color,
    }));
    const nextNodes = [
      ...nodesRef.current.slice(0, nodeIndex),
      ...partNodes,
      ...nodesRef.current.slice(nodeIndex + 1),
    ];
    saveCanvas(reflowCanvasNodesForDisplay(nextNodes), [...existingEdges, ...continuationEdges]);
    setSelected(node.id);
    selectedRef.current = node.id;
  }, [fitTextNodeToContent, saveCanvas]);

  const deleteSelectedEdge = useCallback(() => {
    const edgeId = selectedEdgeRef.current;
    if (!edgeId) return;
    const newEdges = edgesRef.current.filter(edge => edge.id !== edgeId);
    saveCanvas(nodesRef.current, newEdges);
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
  }, [saveCanvas]);

  const reorderSelectedNodes = useCallback((direction: 'front' | 'back') => {
    const selectedIds = getActiveSelection();
    if (selectedIds.size === 0) return;
    const selectedNodes = nodesRef.current.filter(n => selectedIds.has(n.id));
    const otherNodes = nodesRef.current.filter(n => !selectedIds.has(n.id));
    const newNodes = direction === 'front'
      ? [...otherNodes, ...selectedNodes]
      : [...selectedNodes, ...otherNodes];
    saveCanvas(newNodes, edgesRef.current);
  }, [getActiveSelection, saveCanvas]);

  const selectEdge = useCallback((edgeId: string) => {
    setSelectedEdge(edgeId);
    selectedEdgeRef.current = edgeId;
    setSelected(null);
    selectedRef.current = null;
    setEditing(null);
    editingRef.current = null;
    multiSelectRef.current.clear();
  }, []);

  const openContextMenu = useCallback((e: React.MouseEvent, nodeId: string | null = null, edgeId: string | null = null) => {
    e.preventDefault();
    e.stopPropagation();
    if (nodeId) {
      setSelected(nodeId);
      selectedRef.current = nodeId;
      setSelectedEdge(null);
      selectedEdgeRef.current = null;
      if (!multiSelectRef.current.has(nodeId)) {
        multiSelectRef.current.clear();
        multiSelectRef.current.add(nodeId);
      }
    } else if (edgeId) {
      selectEdge(edgeId);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, edgeId });
  }, [selectEdge]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const addTextCard = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 - panRef.current.x) / zoomRef.current : 200;
    const cy = rect ? (rect.height / 2 - panRef.current.y) / zoomRef.current : 200;
    const newNode: CanvasNode = {
      id: uid(), type: 'text',
      x: snap(cx - DEFAULT_CARD_W / 2, GRID_SIZE),
      y: snap(cy - DEFAULT_CARD_H / 2, GRID_SIZE),
      width: DEFAULT_CARD_W, height: DEFAULT_CARD_H, text: '',
    };
    saveCanvas([...nodesRef.current, newNode], edgesRef.current);
    setSelected(newNode.id);
    selectedRef.current = newNode.id;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    setEditing(newNode.id);
  }, [saveCanvas]);

  const addFileCard = useCallback(() => {
    const name = prompt('输入文件名 (相对路径，如 notes/设计文档.md):');
    if (!name) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 - panRef.current.x) / zoomRef.current : 200;
    const cy = rect ? (rect.height / 2 - panRef.current.y) / zoomRef.current : 200;
    const newNode: CanvasNode = {
      id: uid(), type: 'file',
      x: snap(cx - DEFAULT_CARD_W / 2, GRID_SIZE),
      y: snap(cy - DEFAULT_CARD_H / 2, GRID_SIZE),
      width: DEFAULT_CARD_W, height: 100,
      file: name,
    };
    saveCanvas([...nodesRef.current, newNode], edgesRef.current);
  }, [saveCanvas]);

  const addGroupCard = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 - panRef.current.x) / zoomRef.current : 260;
    const cy = rect ? (rect.height / 2 - panRef.current.y) / zoomRef.current : 220;
    const newNode: CanvasNode = {
      id: uid(),
      type: 'group',
      x: snap(cx - 260, GRID_SIZE),
      y: snap(cy - 170, GRID_SIZE),
      width: 520,
      height: 340,
      text: 'Group',
    };
    saveCanvas([...nodesRef.current, newNode], edgesRef.current);
    setSelected(newNode.id);
    selectedRef.current = newNode.id;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
  }, [saveCanvas]);

  const fitToContent = useCallback(() => {
    const visibleIds = canvasModeRef.current === 'mindmap'
      ? getMindMapVisibleNodeIds(nodesRef.current, edgesRef.current)
      : null;
    const fitNodes = visibleIds
      ? nodesRef.current.filter((node) => visibleIds.has(node.id))
      : nodesRef.current;
    if (fitNodes.length === 0) {
      setZoom(1); zoomRef.current = 1;
      setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
      applyTransform();
      return;
    }
    const padding = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of fitNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const newZoom = Math.max(MIN_ZOOM, Math.min(2, Math.min(rect.width / contentW, rect.height / contentH)));
    const newPan = {
      x: (rect.width - contentW * newZoom) / 2 - (minX - padding) * newZoom,
      y: (rect.height - contentH * newZoom) / 2 - (minY - padding) * newZoom,
    };
    setZoom(newZoom); zoomRef.current = newZoom;
    setPan(newPan); panRef.current = newPan;
    applyTransform();
  }, [applyTransform]);

  const revealMindMapNode = useCallback((nodeId: string, center = false) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!node || !rect) return;
    const margin = 88;
    const left = panRef.current.x + node.x * zoomRef.current;
    const top = panRef.current.y + node.y * zoomRef.current;
    const right = left + node.width * zoomRef.current;
    const bottom = top + node.height * zoomRef.current;
    let nextX = panRef.current.x;
    let nextY = panRef.current.y;
    if (center) {
      nextX = rect.width / 2 - (node.x + node.width / 2) * zoomRef.current;
      nextY = rect.height / 2 - (node.y + node.height / 2) * zoomRef.current;
    } else {
      if (left < margin) nextX += margin - left;
      else if (right > rect.width - margin) nextX -= right - (rect.width - margin);
      if (top < margin) nextY += margin - top;
      else if (bottom > rect.height - margin) nextY -= bottom - (rect.height - margin);
    }
    if (nextX === panRef.current.x && nextY === panRef.current.y) return;
    const nextPan = { x: nextX, y: nextY };
    panRef.current = nextPan;
    setPan(nextPan);
    applyTransform();
  }, [applyTransform]);

  const selectMindMapNode = useCallback((nodeId: string, center = false) => {
    if (!nodesRef.current.some((node) => node.id === nodeId)) return;
    if (editingRef.current) finishTextEditing(true);
    multiSelectRef.current.clear();
    multiSelectRef.current.add(nodeId);
    setSelected(nodeId);
    selectedRef.current = nodeId;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    requestAnimationFrame(() => revealMindMapNode(nodeId, center));
  }, [finishTextEditing, revealMindMapNode]);

  useEffect(() => {
    if (canvasMode !== 'mindmap' || nodes.length === 0) return;
    const key = `${fileName || 'canvas'}:${canvasMode}`;
    if (lastMindMapAutoFitKeyRef.current === key) return;
    lastMindMapAutoFitKeyRef.current = key;
    const frame = requestAnimationFrame(() => fitToContent());
    return () => cancelAnimationFrame(frame);
  }, [canvasMode, fileName, fitToContent, nodes.length]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || canvasMode !== 'mindmap' || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (selectedRef.current) revealMindMapNode(selectedRef.current);
      });
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [canvasMode, revealMindMapNode]);

  const autoLayoutCanvas = useCallback(() => {
    if (canvasModeRef.current === 'mindmap') {
      const contentSizedNodes = sizeMindMapNodesToContent(nodesRef.current, edgesRef.current);
      const safeEdges = sanitizeMindMapEdges(contentSizedNodes, edgesRef.current);
      const newNodes = layoutMindMapNodes(contentSizedNodes, safeEdges);
      const newEdges = normalizeMindMapEdges(safeEdges, newNodes);
      saveCanvas(newNodes, newEdges);
      return;
    }
    const selectedIds = getActiveSelection();
    const newNodes = layoutCanvasNodesByEdges(nodesRef.current, edgesRef.current, selectedIds);
    saveCanvas(newNodes, edgesRef.current);
  }, [getActiveSelection, saveCanvas]);

  const selectAndEditNode = useCallback((nodeId: string) => {
    beginTextEditing(nodeId);
    requestAnimationFrame(() => revealMindMapNode(nodeId));
  }, [beginTextEditing, revealMindMapNode]);

  const addMindMapNode = useCallback((relationship: 'child' | 'sibling', preferredSide?: 'left' | 'right') => {
    const selectedId = selectedRef.current;
    let selectedNode = selectedId ? nodesRef.current.find((node) => node.id === selectedId) : null;
    if (!selectedNode && nodesRef.current.length > 0) {
      const firstRootId = getMindMapRootIds(nodesRef.current, edgesRef.current)[0];
      selectedNode = nodesRef.current.find((node) => node.id === firstRootId) || null;
    }
    const selectedParentId = selectedNode
      ? getMindMapParentId(selectedNode.id, nodesRef.current, edgesRef.current)
      : null;
    const parentId = relationship === 'child'
      ? selectedNode?.id || null
      : selectedNode ? selectedParentId || selectedNode.id : null;
    const anchorNode = parentId ? nodesRef.current.find((node) => node.id === parentId) : selectedNode;
    const selectedSide = selectedNode
      ? getMindMapBranchSide(selectedNode.id, nodesRef.current, edgesRef.current)
      : null;
    const rootChildren = parentId && !getMindMapParentId(parentId, nodesRef.current, edgesRef.current)
      ? getMindMapChildrenIds(parentId, nodesRef.current, edgesRef.current)
      : [];
    const rightCount = rootChildren.filter((id) => getMindMapBranchSide(id, nodesRef.current, edgesRef.current) === 'right').length;
    const leftCount = rootChildren.filter((id) => getMindMapBranchSide(id, nodesRef.current, edgesRef.current) === 'left').length;
    const branchSide = preferredSide || selectedSide || (rightCount <= leftCount ? 'right' : 'left');
    const newNode: CanvasNode = {
      id: uid(),
      type: 'text',
      x: (anchorNode?.x || 80) + (anchorNode?.width || DEFAULT_CARD_W) + 120,
      y: (anchorNode?.y || 80) + 120,
      width: 280,
      height: 86,
      text: parentId ? (relationship === 'child' ? '新子主题' : '新主题') : '中心主题',
      color: parentId ? undefined : '6',
      branchSide: parentId ? branchSide : undefined,
    };
    const nextNodes = nodesRef.current
      .map((node) => node.id === parentId && node.collapsed ? { ...node, collapsed: false } : node)
      .concat(newNode);
    const rawEdges = sanitizeMindMapEdges(nextNodes, parentId
      ? [...edgesRef.current, {
        id: `mindmap_${parentId}_${newNode.id}`,
        fromNode: parentId,
        fromSide: branchSide,
        toNode: newNode.id,
        toSide: branchSide === 'left' ? 'right' : 'left',
      } as CanvasEdge]
      : edgesRef.current);
    const laidOut = layoutMindMapNodes(nextNodes, rawEdges);
    const nextEdges = normalizeMindMapEdges(rawEdges, laidOut);
    saveCanvas(laidOut, nextEdges);
    selectAndEditNode(newNode.id);
  }, [saveCanvas, selectAndEditNode]);

  const toggleMindMapBranch = useCallback((nodeId: string | null) => {
    if (!nodeId || getMindMapChildCount(nodeId, nodesRef.current, edgesRef.current) === 0) return;
    const node = nodesRef.current.find((item) => item.id === nodeId);
    const willCollapse = !node?.collapsed;
    const descendants = willCollapse
      ? getMindMapDescendantIds(nodeId, nodesRef.current, edgesRef.current)
      : new Set<string>();
    const nextNodes = nodesRef.current.map((node) => node.id === nodeId
      ? { ...node, collapsed: !node.collapsed }
      : node);
    const safeEdges = sanitizeMindMapEdges(nextNodes, edgesRef.current);
    const laidOut = layoutMindMapNodes(nextNodes, safeEdges);
    saveCanvas(laidOut, normalizeMindMapEdges(safeEdges, laidOut));
    if (selectedRef.current && descendants.has(selectedRef.current)) selectMindMapNode(nodeId);
    else requestAnimationFrame(() => revealMindMapNode(nodeId));
  }, [revealMindMapNode, saveCanvas, selectMindMapNode]);

  const deleteMindMapBranch = useCallback((nodeId: string | null = selectedRef.current) => {
    if (!nodeId) return;
    const parentId = getMindMapParentId(nodeId, nodesRef.current, edgesRef.current);
    const toDelete = getMindMapDescendantIds(nodeId, nodesRef.current, edgesRef.current);
    toDelete.add(nodeId);
    const nextNodes = nodesRef.current.filter((node) => !toDelete.has(node.id));
    const safeEdges = sanitizeMindMapEdges(
      nextNodes,
      edgesRef.current.filter((edge) => !toDelete.has(edge.fromNode) && !toDelete.has(edge.toNode)),
    );
    const laidOut = layoutMindMapNodes(nextNodes, safeEdges);
    saveCanvas(laidOut, normalizeMindMapEdges(safeEdges, laidOut));
    const fallbackId = parentId && nextNodes.some((node) => node.id === parentId)
      ? parentId
      : getMindMapRootIds(nextNodes, safeEdges)[0] || null;
    if (fallbackId) selectMindMapNode(fallbackId);
    else {
      multiSelectRef.current.clear();
      setSelected(null);
      selectedRef.current = null;
    }
  }, [saveCanvas, selectMindMapNode]);

  const deleteMindMapNodePreserveChildren = useCallback((nodeId: string | null = selectedRef.current) => {
    if (!nodeId) return;
    const parentId = getMindMapParentId(nodeId, nodesRef.current, edgesRef.current);
    const childIds = getMindMapChildrenIds(nodeId, nodesRef.current, edgesRef.current);
    const nextNodes = nodesRef.current.filter((node) => node.id !== nodeId);
    let nextEdges = edgesRef.current.filter((edge) => edge.fromNode !== nodeId && edge.toNode !== nodeId);
    if (parentId) {
      const parentSide = getMindMapBranchSide(nodeId, nodesRef.current, edgesRef.current) || 'right';
      const originalIncomingIndex = edgesRef.current.findIndex((edge) => edge.toNode === nodeId);
      const promotedEdges = childIds.map((childId) => ({
        id: `mindmap_${parentId}_${childId}_${uid()}`,
        fromNode: parentId,
        toNode: childId,
        fromSide: parentSide,
        toSide: parentSide === 'left' ? 'right' as const : 'left' as const,
      }));
      nextEdges.splice(Math.min(Math.max(0, originalIncomingIndex), nextEdges.length), 0, ...promotedEdges);
    }
    const safeEdges = sanitizeMindMapEdges(nextNodes, nextEdges);
    const laidOut = layoutMindMapNodes(nextNodes, safeEdges);
    saveCanvas(laidOut, normalizeMindMapEdges(safeEdges, laidOut));
    const fallbackId = parentId || childIds[0] || getMindMapRootIds(nextNodes, safeEdges)[0] || null;
    if (fallbackId) selectMindMapNode(fallbackId);
    else {
      setSelected(null);
      selectedRef.current = null;
    }
  }, [saveCanvas, selectMindMapNode]);

  const duplicateMindMapBranch = useCallback((nodeId: string | null = selectedRef.current) => {
    if (!nodeId) return;
    const parentId = getMindMapParentId(nodeId, nodesRef.current, edgesRef.current);
    if (!parentId) return;
    const branchIds = getMindMapDescendantIds(nodeId, nodesRef.current, edgesRef.current);
    branchIds.add(nodeId);
    const idMap = new Map<string, string>();
    for (const id of branchIds) idMap.set(id, uid());
    const copiedNodes = nodesRef.current
      .filter((node) => branchIds.has(node.id))
      .map((node) => ({ ...node, id: idMap.get(node.id)! }));
    const copiedEdges = edgesRef.current
      .filter((edge) => branchIds.has(edge.fromNode) && branchIds.has(edge.toNode))
      .map((edge) => ({
        ...edge,
        id: uid(),
        fromNode: idMap.get(edge.fromNode)!,
        toNode: idMap.get(edge.toNode)!,
      }));
    const copiedRootId = idMap.get(nodeId)!;
    const side = getMindMapBranchSide(nodeId, nodesRef.current, edgesRef.current) || 'right';
    const incomingEdge: CanvasEdge = {
      id: `mindmap_${parentId}_${copiedRootId}_${uid()}`,
      fromNode: parentId,
      toNode: copiedRootId,
      fromSide: side,
      toSide: side === 'left' ? 'right' : 'left',
    };
    const originalIncomingIndex = edgesRef.current.findIndex((edge) => edge.toNode === nodeId);
    const nextEdges = [...edgesRef.current];
    nextEdges.splice(originalIncomingIndex < 0 ? nextEdges.length : originalIncomingIndex + 1, 0, incomingEdge);
    nextEdges.push(...copiedEdges);
    const nextNodes = [...nodesRef.current, ...copiedNodes];
    const safeEdges = sanitizeMindMapEdges(nextNodes, nextEdges);
    const laidOut = layoutMindMapNodes(nextNodes, safeEdges);
    saveCanvas(laidOut, normalizeMindMapEdges(safeEdges, laidOut));
    selectMindMapNode(copiedRootId);
  }, [saveCanvas, selectMindMapNode]);

  const promoteMindMapNode = useCallback((nodeId: string | null = selectedRef.current) => {
    if (!nodeId) return false;
    const parentId = getMindMapParentId(nodeId, nodesRef.current, edgesRef.current);
    const grandParentId = parentId
      ? getMindMapParentId(parentId, nodesRef.current, edgesRef.current)
      : null;
    if (!parentId || !grandParentId) return false;
    const side = getMindMapBranchSide(parentId, nodesRef.current, edgesRef.current) || 'right';
    const oldIncoming = edgesRef.current.find((edge) => edge.toNode === nodeId);
    const nextEdges = edgesRef.current.filter((edge) => edge.toNode !== nodeId);
    const parentIncomingIndex = nextEdges.findIndex((edge) => edge.toNode === parentId);
    const insertIndex = parentIncomingIndex < 0
      ? nextEdges.length
      : Math.min(parentIncomingIndex + 1, nextEdges.length);
    nextEdges.splice(insertIndex, 0, {
      id: oldIncoming?.id || `mindmap_${grandParentId}_${nodeId}_${uid()}`,
      fromNode: grandParentId,
      toNode: nodeId,
      fromSide: side,
      toSide: side === 'left' ? 'right' : 'left',
    });
    const safeEdges = sanitizeMindMapEdges(nodesRef.current, nextEdges);
    const laidOut = layoutMindMapNodes(nodesRef.current, safeEdges);
    saveCanvas(laidOut, normalizeMindMapEdges(safeEdges, laidOut));
    selectMindMapNode(nodeId);
    return true;
  }, [saveCanvas, selectMindMapNode]);

  const resolveMindMapPasteSide = useCallback((parentId: string): 'left' | 'right' => {
    const parentParentId = getMindMapParentId(parentId, nodesRef.current, edgesRef.current);
    if (parentParentId) return getMindMapBranchSide(parentId, nodesRef.current, edgesRef.current) || 'right';
    const children = getMindMapChildrenIds(parentId, nodesRef.current, edgesRef.current);
    const leftCount = children.filter((id) => getMindMapBranchSide(id, nodesRef.current, edgesRef.current) === 'left').length;
    const rightCount = children.length - leftCount;
    return rightCount <= leftCount ? 'right' : 'left';
  }, []);

  const copyMindMapBranch = useCallback(async (cut = false, nodeId: string | null = selectedRef.current) => {
    if (!nodeId) {
      showMindMapNotice('请先选择一个主题');
      return;
    }
    if (cut && !getMindMapParentId(nodeId, nodesRef.current, edgesRef.current)) {
      showMindMapNotice('中心主题不能剪切');
      return;
    }
    const snapshot = createMindMapBranchSnapshot(nodeId, nodesRef.current, edgesRef.current);
    if (!snapshot) return;
    const plainText = formatMindMapBranchOutline(snapshot);
    sharedMindMapClipboard = { snapshot, plainText };
    try {
      await navigator.clipboard?.writeText(plainText);
    } catch {
      // The in-app clipboard remains available when system permission is denied.
    }
    showMindMapNotice(`${cut ? '已剪切' : '已复制'} ${snapshot.nodes.length} 个主题`);
    if (cut) deleteMindMapBranch(nodeId);
  }, [deleteMindMapBranch, showMindMapNotice]);

  const pasteMindMapBranch = useCallback(async () => {
    const targetId = selectedRef.current
      || getMindMapRootIds(nodesRef.current, edgesRef.current)[0]
      || null;
    if (!targetId) {
      showMindMapNotice('请先创建中心主题');
      return;
    }

    let systemText = '';
    try {
      systemText = await navigator.clipboard?.readText() || '';
    } catch {
      // Fall back to the in-app structured clipboard.
    }
    const useStructuredClipboard = Boolean(
      sharedMindMapClipboard
      && (!systemText.trim() || systemText === sharedMindMapClipboard.plainText),
    );
    const side = resolveMindMapPasteSide(targetId);
    let addedNodes: CanvasNode[] = [];
    let addedEdges: CanvasEdge[] = [];
    let pastedRootId = '';

    if (useStructuredClipboard && sharedMindMapClipboard) {
      const cloned = cloneMindMapBranch(sharedMindMapClipboard.snapshot, uid);
      pastedRootId = cloned.rootId;
      addedNodes = cloned.nodes.map((node) => node.id === pastedRootId
        ? { ...node, branchSide: side }
        : node);
      addedEdges = [{
        id: `mindmap_${targetId}_${pastedRootId}_${uid()}`,
        fromNode: targetId,
        toNode: pastedRootId,
        fromSide: side,
        toSide: side === 'left' ? 'right' : 'left',
      }, ...cloned.edges];
    } else {
      const outlineItems = parseMindMapOutline(systemText);
      if (outlineItems.length === 0) {
        showMindMapNotice('剪贴板中没有可粘贴的主题');
        return;
      }
      const parentAtDepth = new Map<number, string>();
      for (const item of outlineItems) {
        const nodeId = uid();
        const parentId = item.depth === 0 ? targetId : parentAtDepth.get(item.depth - 1) || targetId;
        const size = mindMapNodeSize(item.text);
        addedNodes.push({
          id: nodeId,
          type: 'text',
          x: 0,
          y: 0,
          width: size.width,
          height: size.height,
          text: item.text,
          branchSide: side,
        });
        addedEdges.push({
          id: `mindmap_${parentId}_${nodeId}_${uid()}`,
          fromNode: parentId,
          toNode: nodeId,
          fromSide: side,
          toSide: side === 'left' ? 'right' : 'left',
        });
        parentAtDepth.set(item.depth, nodeId);
        for (const depth of [...parentAtDepth.keys()]) {
          if (depth > item.depth) parentAtDepth.delete(depth);
        }
        if (!pastedRootId) pastedRootId = nodeId;
      }
    }

    const nextNodes = nodesRef.current
      .map((node) => node.id === targetId && node.collapsed ? { ...node, collapsed: false } : node)
      .concat(addedNodes);
    const safeEdges = sanitizeMindMapEdges(nextNodes, [...edgesRef.current, ...addedEdges]);
    const laidOut = layoutMindMapNodes(nextNodes, safeEdges);
    saveCanvas(laidOut, normalizeMindMapEdges(safeEdges, laidOut));
    selectMindMapNode(pastedRootId);
    showMindMapNotice(`已粘贴 ${addedNodes.length} 个主题`);
  }, [resolveMindMapPasteSide, saveCanvas, selectMindMapNode, showMindMapNotice]);

  const reorderMindMapSibling = useCallback((direction: -1 | 1, nodeId: string | null = selectedRef.current) => {
    if (!nodeId) return;
    const reorderedEdges = reorderMindMapSiblingEdges(nodeId, direction, nodesRef.current, edgesRef.current);
    if (reorderedEdges === edgesRef.current) {
      showMindMapNotice(direction < 0 ? '已经是当前分支第一项' : '已经是当前分支最后一项');
      return;
    }
    const laidOut = layoutMindMapNodes(nodesRef.current, reorderedEdges);
    saveCanvas(laidOut, normalizeMindMapEdges(reorderedEdges, laidOut));
    selectMindMapNode(nodeId);
  }, [saveCanvas, selectMindMapNode, showMindMapNotice]);

  const moveMindMapBranchSide = useCallback((side: 'left' | 'right', nodeId: string | null = selectedRef.current) => {
    if (!nodeId) return;
    const parentId = getMindMapParentId(nodeId, nodesRef.current, edgesRef.current);
    if (!parentId || getMindMapParentId(parentId, nodesRef.current, edgesRef.current)) {
      showMindMapNotice('只有一级分支可以直接切换左右侧');
      return;
    }
    if (getMindMapBranchSide(nodeId, nodesRef.current, edgesRef.current) === side) return;
    const nextNodes = nodesRef.current.map((node) => node.id === nodeId ? { ...node, branchSide: side } : node);
    const laidOut = layoutMindMapNodes(nextNodes, edgesRef.current);
    saveCanvas(laidOut, normalizeMindMapEdges(edgesRef.current, laidOut));
    selectMindMapNode(nodeId);
    showMindMapNotice(`分支已移到${side === 'left' ? '左' : '右'}侧`);
  }, [saveCanvas, selectMindMapNode, showMindMapNotice]);

  const changeCanvasMode = useCallback((nextMode: MindMapCanvasMode) => {
    if (canvasModeRef.current === nextMode) return;
    const historySnapshot = makeSnapshot();
    canvasModeRef.current = nextMode;
    setCanvasMode(nextMode);
    if (nextMode === 'free') lastMindMapAutoFitKeyRef.current = '';
    let nextNodes = cloneNodes(nodesRef.current);
    let nextEdges = cloneEdges(edgesRef.current);
    if (nextMode === 'mindmap') {
      setQualityPanelOpen(false);
      if (nextNodes.filter((node) => node.type !== 'group').length === 0) {
        nextNodes.push({
          id: uid(),
          type: 'text',
          x: 120,
          y: 120,
          width: 300,
          height: 92,
          text: '中心主题',
          color: '6',
        });
      }
      nextNodes = sizeMindMapNodesToContent(nextNodes, nextEdges);
      nextEdges = sanitizeMindMapEdges(nextNodes, nextEdges);
      nextNodes = layoutMindMapNodes(nextNodes, nextEdges);
      nextEdges = normalizeMindMapEdges(nextEdges, nextNodes);
    }
    saveCanvas(nextNodes, nextEdges, { historySnapshot, immediate: true });
  }, [makeSnapshot, saveCanvas]);

  const openMindMapSearch = useCallback(() => {
    setMindMapHelpOpen(false);
    setMindMapSearchOpen(true);
    requestAnimationFrame(() => mindMapSearchInputRef.current?.focus());
  }, []);

  const closeMindMapSearch = useCallback(() => {
    setMindMapSearchOpen(false);
    setMindMapSearchIndex(0);
  }, []);

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
        e.preventDefault();
        if (e.shiftKey) redoCanvas();
        else undoCanvas();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
        e.preventDefault();
        redoCanvas();
        return;
      }
      if (canvasModeRef.current === 'mindmap' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openMindMapSearch();
        return;
      }
      if (mindMapSearchOpen && e.key === 'Escape') {
        e.preventDefault();
        closeMindMapSearch();
        return;
      }
      if (mindMapHelpOpen && e.key === 'Escape') {
        e.preventDefault();
        setMindMapHelpOpen(false);
        return;
      }
      const target = e.target as HTMLElement;
      const isTextInput = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || target?.isContentEditable;
      if (canvasModeRef.current === 'mindmap' && !isTextInput && (e.ctrlKey || e.metaKey)) {
        const key = e.key.toLowerCase();
        if (key === 'c' && selectedRef.current) {
          e.preventDefault();
          void copyMindMapBranch(false);
          return;
        }
        if (key === 'x' && selectedRef.current) {
          e.preventDefault();
          void copyMindMapBranch(true);
          return;
        }
        if (key === 'v') {
          e.preventDefault();
          void pasteMindMapBranch();
          return;
        }
      }
      if (canvasModeRef.current === 'mindmap' && !isTextInput && e.altKey && !e.ctrlKey && !e.metaKey && selectedRef.current) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          reorderMindMapSibling(e.key === 'ArrowUp' ? -1 : 1);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          moveMindMapBranchSide(e.key === 'ArrowLeft' ? 'left' : 'right');
          return;
        }
      }
      if (canvasModeRef.current === 'mindmap' && !isTextInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) promoteMindMapNode();
          else addMindMapNode('child');
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          addMindMapNode('sibling');
          return;
        }
        if (e.key === 'F2' && selectedRef.current) {
          e.preventDefault();
          beginTextEditing(selectedRef.current);
          return;
        }
        if (e.key === ' ' && selectedRef.current) {
          e.preventDefault();
          toggleMindMapBranch(selectedRef.current);
          return;
        }
        if (selectedRef.current && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          const direction = e.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right';
          const nextId = getMindMapNavigationTarget(
            selectedRef.current,
            direction,
            nodesRef.current,
            edgesRef.current,
          );
          if (nextId) selectMindMapNode(nextId);
          return;
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editingRef.current) return;
        if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
        if (selectedEdgeRef.current) {
          deleteSelectedEdge();
          return;
        }
        if (!selectedRef.current) return;
        if (canvasModeRef.current === 'mindmap') {
          e.preventDefault();
          if (e.altKey) deleteMindMapNodePreserveChildren();
          else deleteMindMapBranch();
        } else deleteSelectedNodes();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (editingRef.current || !selectedRef.current) return;
        if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
        e.preventDefault();
        if (canvasModeRef.current === 'mindmap') duplicateMindMapBranch();
        else duplicateSelectedNodes();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave?.();
      }
      if (e.key === 'Escape') {
        if (editingRef.current) {
          finishTextEditing(false);
          return;
        }
        setSelected(null); selectedRef.current = null;
        setSelectedEdge(null); selectedEdgeRef.current = null;
        multiSelectRef.current.clear();
      }
      /* Arrow keys to nudge selected cards */
      if (canvasModeRef.current === 'free' && selectedRef.current && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (editingRef.current) return;
        if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
        e.preventDefault();
        const step = e.shiftKey ? GRID_SIZE * 2 : GRID_SIZE;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const newNodes = nodesRef.current.map(n =>
          (n.id === selectedRef.current || multiSelectRef.current.has(n.id))
            ? { ...n, x: n.x + dx, y: n.y + dy } : n
        );
        saveCanvas(newNodes, edgesRef.current);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addMindMapNode, beginTextEditing, closeMindMapSearch, copyMindMapBranch, deleteMindMapBranch, deleteMindMapNodePreserveChildren, deleteSelectedEdge, deleteSelectedNodes, duplicateMindMapBranch, duplicateSelectedNodes, finishTextEditing, mindMapHelpOpen, mindMapSearchOpen, moveMindMapBranchSide, onSave, openMindMapSearch, pasteMindMapBranch, promoteMindMapNode, redoCanvas, reorderMindMapSibling, saveCanvas, selectMindMapNode, toggleMindMapBranch, undoCanvas]);

  /* ── Cleanup ── */
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (mindMapNoticeTimerRef.current) clearTimeout(mindMapNoticeTimerRef.current);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  /* ── Get card color styles ── */
  const getCardColor = useCallback((node: CanvasNode) => {
    if (!node.color || !CARD_COLORS[node.color]) return { border: 'var(--border)', bg: 'var(--bg-card)' };
    return { border: CARD_COLORS[node.color], bg: COLOR_BG[node.color] };
  }, []);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const mindMapIndexData = useMemo(() => canvasMode === 'mindmap'
    ? createMindMapIndex(nodes, edges)
    : null, [canvasMode, edges, nodes]);
  const visibleNodeIds = useMemo(() => mindMapIndexData?.visibleNodeIds
    || new Set(nodes.map((node) => node.id)), [mindMapIndexData, nodes]);
  const deferredMindMapSearchQuery = useDeferredValue(mindMapSearchQuery.trim().toLocaleLowerCase());
  const mindMapSearchMatches = useMemo(() => {
    if (canvasMode !== 'mindmap' || !deferredMindMapSearchQuery) return [] as CanvasNode[];
    return nodes.filter((node) => String(node.text || node.file || '')
      .toLocaleLowerCase()
      .includes(deferredMindMapSearchQuery));
  }, [canvasMode, deferredMindMapSearchQuery, nodes]);
  const mindMapOutlineRows = useMemo(() => {
    if (!mindMapIndexData) return [] as Array<{ id: string; depth: number }>;
    const rows: Array<{ id: string; depth: number }> = [];
    const visited = new Set<string>();
    const visit = (id: string, depth: number) => {
      if (visited.has(id)) return;
      visited.add(id);
      rows.push({ id, depth });
      const node = nodeById.get(id);
      if (!node?.collapsed) {
        for (const childId of mindMapIndexData.childrenById.get(id) || []) visit(childId, depth + 1);
      }
    };
    for (const rootId of mindMapIndexData.roots) visit(rootId, 0);
    return rows;
  }, [mindMapIndexData, nodeById]);

  const focusMindMapNode = useCallback((nodeId: string) => {
    selectMindMapNode(nodeId, true);
  }, [selectMindMapNode]);

  const revealMindMapSearchResult = useCallback((nodeId: string) => {
    const ancestorIds = new Set(getMindMapAncestorIds(nodeId, nodesRef.current, edgesRef.current));
    const needsExpansion = nodesRef.current.some((node) => ancestorIds.has(node.id) && node.collapsed);
    if (needsExpansion) {
      const expandedNodes = nodesRef.current.map((node) => ancestorIds.has(node.id) && node.collapsed
        ? { ...node, collapsed: false }
        : node);
      const safeEdges = sanitizeMindMapEdges(expandedNodes, edgesRef.current);
      const laidOut = layoutMindMapNodes(expandedNodes, safeEdges);
      saveCanvas(laidOut, normalizeMindMapEdges(safeEdges, laidOut), {
        history: false,
        immediate: true,
        preserveRedo: true,
      });
    }
    requestAnimationFrame(() => selectMindMapNode(nodeId, true));
  }, [saveCanvas, selectMindMapNode]);

  const stepMindMapSearch = useCallback((direction: 1 | -1) => {
    if (mindMapSearchMatches.length === 0) return;
    setMindMapSearchIndex((current) => (
      (current + direction + mindMapSearchMatches.length) % mindMapSearchMatches.length
    ));
  }, [mindMapSearchMatches.length]);

  useEffect(() => {
    setMindMapSearchIndex(0);
  }, [deferredMindMapSearchQuery]);

  const activeMindMapSearchId = mindMapSearchMatches[mindMapSearchIndex]?.id || null;
  const mindMapSearchMatchIds = useMemo(
    () => new Set(mindMapSearchMatches.map((node) => node.id)),
    [mindMapSearchMatches],
  );

  useEffect(() => {
    if (!mindMapSearchOpen || !activeMindMapSearchId) return;
    revealMindMapSearchResult(activeMindMapSearchId);
  }, [activeMindMapSearchId, mindMapSearchOpen, revealMindMapSearchResult]);

  /* ── Memoized edges SVG ── */
  const edgesSvg = useMemo(() => {
    return edges.map(edge => {
      if (!visibleNodeIds.has(edge.fromNode) || !visibleNodeIds.has(edge.toNode)) return null;
      const from = nodeById.get(edge.fromNode);
      const to = nodeById.get(edge.toNode);
      if (!from || !to) return null;
      const sides = edge.fromSide ? { fs: edge.fromSide, ts: edge.toSide || 'left' } : autoSides(from, to);
      const d = edgePath(from, to, sides.fs, sides.ts);
      const isSelectedEdge = selectedEdge === edge.id;
      const labelX = (from.x + from.width / 2 + to.x + to.width / 2) / 2;
      const labelY = (from.y + from.height / 2 + to.y + to.height / 2) / 2;
      const stroke = edge.color ? CARD_COLORS[edge.color] || '#7c5cff' : '#7c5cff';
      return (
        <g key={edge.id} className={`canvas-edge${isSelectedEdge ? ' selected' : ''}${canvasMode === 'mindmap' ? ' mindmap-edge' : ''}`}>
          <path
            className="canvas-edge-hit"
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            onPointerDown={(e) => {
              e.stopPropagation();
              selectEdge(edge.id);
            }}
            onContextMenu={(e) => openContextMenu(e, null, edge.id)}
          />
          <path
            className="canvas-edge-visible"
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={isSelectedEdge ? 3 : canvasMode === 'mindmap' ? 2.2 : 1.7}
            opacity={isSelectedEdge ? 0.95 : canvasMode === 'mindmap' ? 0.82 : 0.65}
            markerEnd={canvasMode === 'mindmap' ? undefined : 'url(#arrowhead)'}
          />
          {edge.label && (
            <text
              className="canvas-edge-label"
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {edge.label}
            </text>
          )}
        </g>
      );
    });
  }, [canvasMode, edges, nodeById, openContextMenu, selectEdge, selectedEdge, visibleNodeIds]);

  const selectedNode = selected ? nodeById.get(selected) || null : null;
  const selectedEdgeObj = selectedEdge ? edges.find(edge => edge.id === selectedEdge) || null : null;
  const selectedEdgeFrom = selectedEdgeObj ? nodeById.get(selectedEdgeObj.fromNode) || null : null;
  const selectedEdgeTo = selectedEdgeObj ? nodeById.get(selectedEdgeObj.toNode) || null : null;
  const contextNode = contextMenu?.nodeId ? nodeById.get(contextMenu.nodeId) || null : null;
  const canUndo = historyTick >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyTick >= 0 && redoStackRef.current.length > 0;
  const canvasQuality = useMemo(() => analyzeCanvasQualityForDisplay(nodes, edges), [nodes, edges]);

  /* ═══════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════ */

  return (
    <div className={`canvas-editor canvas-mode-${canvasMode}`}>
      {/* Title bar */}
      <div className="editor-titlebar">
        <span className="editor-titlebar-name">
          <span style={{ color: '#7c5cff', marginRight: 6 }}>⬡</span>
          {fileName || 'Canvas'}
        </span>
        <span className="editor-titlebar-right" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {canvasMode === 'mindmap' ? '思维导图' : '自由画布'} · {visibleNodeIds.size} 个节点 · {edges.length} 条连接
        </span>
      </div>

      {/* Toolbar */}
      <div className="canvas-toolbar">
        <button className="canvas-tool-btn canvas-tool-btn-wide" title="Undo (Ctrl+Z)" onClick={undoCanvas} disabled={!canUndo}>
          Undo
        </button>
        <button className="canvas-tool-btn canvas-tool-btn-wide" title="Redo (Ctrl+Y)" onClick={redoCanvas} disabled={!canRedo}>
          Redo
        </button>
        <div className="canvas-tool-sep" />
        <div className="canvas-mode-switch" role="tablist" aria-label="画布模式">
          <button type="button" role="tab" aria-selected={canvasMode === 'free'} className={canvasMode === 'free' ? 'active' : ''} onClick={() => changeCanvasMode('free')}>
            自由画布
          </button>
          <button type="button" role="tab" aria-selected={canvasMode === 'mindmap'} className={canvasMode === 'mindmap' ? 'active' : ''} onClick={() => changeCanvasMode('mindmap')}>
            思维导图
          </button>
        </div>
        <div className="canvas-tool-sep" />
        {canvasMode === 'mindmap' ? (
          <>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="添加子主题 (Tab)" onClick={() => addMindMapNode('child')}>
              + 子主题
            </button>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="添加同级主题 (Enter)" onClick={() => addMindMapNode('sibling')}>
              + 同级
            </button>
            <button
              className="canvas-tool-btn canvas-tool-btn-wide"
              title="折叠或展开当前分支 (Space)"
              onClick={() => toggleMindMapBranch(selectedRef.current)}
              disabled={!selectedNode || (mindMapIndexData?.childrenById.get(selectedNode.id)?.length || 0) === 0}
            >
              {selectedNode?.collapsed ? '展开' : '折叠'}
            </button>
            <button className={`canvas-tool-btn canvas-tool-btn-wide${mindMapOutlineOpen ? ' active' : ''}`} title="打开或关闭导图大纲" onClick={() => setMindMapOutlineOpen((open) => !open)}>
              大纲
            </button>
            <button className={`canvas-tool-btn canvas-tool-btn-wide${mindMapSearchOpen ? ' active' : ''}`} title="搜索主题 (Ctrl+F)" onClick={openMindMapSearch}>
              搜索
            </button>
            <button
              className={`canvas-tool-btn${mindMapHelpOpen ? ' active' : ''}`}
              title="思维导图快捷键"
              aria-label="打开思维导图快捷键帮助"
              aria-expanded={mindMapHelpOpen}
              onClick={() => {
                setMindMapSearchOpen(false);
                setMindMapHelpOpen((open) => !open);
              }}
            >?</button>
          </>
        ) : (
          <>
            <button className="canvas-tool-btn" title="添加文本卡片（双击空白处）" onClick={addTextCard}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            </button>
            <button className="canvas-tool-btn" title="添加文件卡片" onClick={addFileCard}>
              <span style={{ fontSize: 13 }}>F</span>
            </button>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="添加分组框" onClick={addGroupCard}>
              分组
            </button>
          </>
        )}
        {canvasMode === 'mindmap' ? (
          <>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="复制整个分支 (Ctrl+C)" onClick={() => void copyMindMapBranch(false)} disabled={!selected}>
              复制
            </button>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="粘贴为当前主题的子分支 (Ctrl+V)" onClick={() => void pasteMindMapBranch()} disabled={nodes.length === 0}>
              粘贴
            </button>
            <button className="canvas-tool-btn" title="同级上移 (Alt+↑)" onClick={() => reorderMindMapSibling(-1)} disabled={!selected} aria-label="同级上移">↑</button>
            <button className="canvas-tool-btn" title="同级下移 (Alt+↓)" onClick={() => reorderMindMapSibling(1)} disabled={!selected} aria-label="同级下移">↓</button>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="删除整个分支 (Delete)" onClick={() => deleteMindMapBranch()} disabled={!selected}>
              删除
            </button>
          </>
        ) : (
          <>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="Duplicate selected cards (Ctrl+D)" onClick={duplicateSelectedNodes} disabled={!selected}>
              Duplicate
            </button>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="Delete selection" onClick={() => selectedEdge ? deleteSelectedEdge() : deleteSelectedNodes()} disabled={!selected && !selectedEdge}>
              Delete
            </button>
          </>
        )}
        <button className="canvas-tool-btn canvas-tool-btn-wide" title={canvasMode === 'mindmap' ? '一键整理导图' : '自动排列卡片'} onClick={autoLayoutCanvas} disabled={nodes.length === 0}>
          {canvasMode === 'mindmap' ? '整理' : '布局'}
        </button>
        {canvasMode === 'free' && (
          <>
            <button
              className={`canvas-quality-chip canvas-quality-${canvasQuality.level}`}
              title={canvasQuality.tooltip}
              onClick={() => setQualityPanelOpen(open => !open)}
              disabled={nodes.length === 0}
              aria-expanded={qualityPanelOpen}
              aria-controls="canvas-quality-panel"
            >
              <span className="canvas-quality-dot" />
              <span>Quality {canvasQuality.score}</span>
              {canvasQuality.issueCount > 0 && <span className="canvas-quality-issues">{canvasQuality.issueCount}</span>}
            </button>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="Fit selected text card" onClick={() => fitTextNodeToContent(selectedRef.current)} disabled={!selectedNode || selectedNode.type !== 'text'}>
              Fit
            </button>
            <button className="canvas-tool-btn canvas-tool-btn-wide" title="Split selected long text card" onClick={() => splitTextNodeIntoReadableCards(selectedRef.current)} disabled={!selectedNode || selectedNode.type !== 'text'}>
              Split
            </button>
          </>
        )}
        <div className="canvas-tool-sep" />
        <button className="canvas-tool-btn" title="缩小" onClick={() => {
          const z = Math.max(MIN_ZOOM, zoomRef.current * (1 - ZOOM_STEP));
          setZoom(z); zoomRef.current = z;
          applyTransform();
        }}>
          <span style={{ fontSize: 13 }}>−</span>
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 40, textAlign: 'center', cursor: 'pointer' }}
          onClick={fitToContent}
          title="适应视图">
          {Math.round(zoom * 100)}%
        </span>
        <button className="canvas-tool-btn" title="放大" onClick={() => {
          const z = Math.min(MAX_ZOOM, zoomRef.current * (1 + ZOOM_STEP));
          setZoom(z); zoomRef.current = z;
          applyTransform();
        }}>
          <span style={{ fontSize: 13 }}>+</span>
        </button>
        <button className="canvas-tool-btn" title="适应内容" onClick={fitToContent}>
          <span style={{ fontSize: 11 }}>⊞</span>
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {canvasMode === 'mindmap'
            ? '方向键导航 · Tab 子主题 · Enter 同级 · Shift+Tab 提升 · Esc 取消编辑'
            : '双击创建 · 滚轮平移 · Ctrl+滚轮缩放 · Alt 拖动画布'}
        </span>
      </div>

      {canvasMode === 'mindmap' && mindMapSearchOpen && (
        <div className="canvas-mindmap-search" role="search" aria-label="搜索思维导图主题">
          <span className="canvas-mindmap-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={mindMapSearchInputRef}
            value={mindMapSearchQuery}
            onChange={(event) => setMindMapSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                stepMindMapSearch(event.shiftKey ? -1 : 1);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeMindMapSearch();
              }
            }}
            placeholder="搜索主题内容..."
            aria-label="搜索主题内容"
          />
          <span className="canvas-mindmap-search-count" aria-live="polite">
            {mindMapSearchQuery.trim()
              ? `${mindMapSearchMatches.length ? Math.min(mindMapSearchIndex + 1, mindMapSearchMatches.length) : 0}/${mindMapSearchMatches.length}`
              : `${nodes.length} 个主题`}
          </span>
          <button type="button" title="上一个 (Shift+Enter)" disabled={mindMapSearchMatches.length === 0} onClick={() => stepMindMapSearch(-1)}>↑</button>
          <button type="button" title="下一个 (Enter)" disabled={mindMapSearchMatches.length === 0} onClick={() => stepMindMapSearch(1)}>↓</button>
          <button type="button" title="关闭 (Esc)" onClick={closeMindMapSearch}>×</button>
        </div>
      )}

      {canvasMode === 'mindmap' && mindMapHelpOpen && (
        <aside className="canvas-mindmap-help" role="dialog" aria-label="思维导图快捷键">
          <header>
            <div>
              <strong>快捷操作</strong>
              <span>保持双手在键盘上完成建图</span>
            </div>
            <button type="button" aria-label="关闭快捷键帮助" onClick={() => setMindMapHelpOpen(false)}>×</button>
          </header>
          <div className="canvas-mindmap-help-list">
            {MIND_MAP_SHORTCUTS.map(([keys, label]) => (
              <div key={keys}>
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
        </aside>
      )}

      {canvasMode === 'mindmap' && mindMapNotice && (
        <div className="canvas-mindmap-notice" role="status" aria-live="polite">{mindMapNotice}</div>
      )}

      {canvasMode === 'free' && qualityPanelOpen && nodes.length > 0 && (
        <div
          id="canvas-quality-panel"
          className={`canvas-quality-panel canvas-quality-panel-${canvasQuality.level}`}
          role="dialog"
          aria-label="Canvas quality details"
        >
          <div className="canvas-quality-panel-head">
            <div>
              <div className="canvas-quality-panel-kicker">Canvas Review</div>
              <div className="canvas-quality-panel-title">Quality {canvasQuality.score}/100</div>
            </div>
            <button
              className="canvas-quality-panel-close"
              type="button"
              aria-label="Close canvas quality details"
              onClick={() => setQualityPanelOpen(false)}
            >
              x
            </button>
          </div>
          <div className="canvas-quality-meter" aria-hidden="true">
            <span style={{ width: `${canvasQuality.score}%` }} />
          </div>
          <div className="canvas-quality-panel-body">
            {canvasQuality.issues.length > 0 ? (
              canvasQuality.issues.map((issue) => (
                <div className="canvas-quality-row" key={issue}>
                  <span className="canvas-quality-row-dot" />
                  <span>{issue}</span>
                </div>
              ))
            ) : (
              <div className="canvas-quality-row canvas-quality-row-clean">
                <span className="canvas-quality-row-dot" />
                <span>No obvious overlap, dense-card, or structure issues found.</span>
              </div>
            )}
          </div>
          {canvasQuality.recommendations.length > 0 && (
            <div className="canvas-quality-recommendations">
              {canvasQuality.recommendations.map((tip) => (
                <span key={tip}>{tip}</span>
              ))}
            </div>
          )}
          <div className="canvas-quality-actions">
            <button
              type="button"
              className="canvas-quality-action-primary"
              onClick={() => {
                autoLayoutCanvas();
                setQualityPanelOpen(false);
              }}
            >
              Auto layout
            </button>
            <button
              type="button"
              className="canvas-quality-action-secondary"
              onClick={() => {
                fitToContent();
                setQualityPanelOpen(false);
              }}
            >
              Fit view
            </button>
          </div>
        </div>
      )}

      {canvasMode === 'mindmap' && mindMapOutlineOpen && (
        <aside className="canvas-mindmap-outline" aria-label="思维导图大纲">
          <div className="canvas-mindmap-outline-head">
            <div>
              <span>导图大纲</span>
              <small>{mindMapOutlineRows.length} 个主题</small>
            </div>
            <button type="button" aria-label="关闭导图大纲" onClick={() => setMindMapOutlineOpen(false)}>×</button>
          </div>
          <div className="canvas-mindmap-outline-list">
            {mindMapOutlineRows.map(({ id, depth }) => {
              const node = nodeById.get(id);
              if (!node) return null;
              const childCount = mindMapIndexData?.childrenById.get(id)?.length || 0;
              return (
                <div
                  key={id}
                  className={`canvas-mindmap-outline-row${selected === id ? ' active' : ''}`}
                  style={{ paddingLeft: 12 + depth * 17 }}
                >
                  <button
                    type="button"
                    className="canvas-mindmap-outline-mark"
                    disabled={childCount === 0}
                    aria-label={childCount > 0 ? (node.collapsed ? '展开分支' : '折叠分支') : '无子主题'}
                    onClick={() => toggleMindMapBranch(id)}
                  >{childCount > 0 ? (node.collapsed ? '›' : '⌄') : '·'}</button>
                  <button type="button" onClick={() => focusMindMapNode(id)}>
                    {String(node.text || node.file || '未命名主题').replace(/^#+\s*/, '').split('\n')[0]}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Canvas viewport */}
      <div
        ref={viewportRef}
        className="canvas-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => openContextMenu(e, null)}
      >
        <div
          ref={contentRef}
          className="canvas-content"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        >
          {/* Grid background */}
          <div className="canvas-grid" />

          {/* Selection box */}
          <div className="canvas-select-box" style={{ display: 'none' }} />

          {/* SVG edges */}
          <svg ref={svgRef} className="canvas-svg"
            style={{ position: 'absolute', top: 0, left: 0, width: '10000px', height: '10000px', pointerEvents: 'none' }}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#7c5cff" opacity="0.6" />
              </marker>
            </defs>
            {edgesSvg}
          </svg>

          {/* Cards */}
          {nodes.filter((node) => visibleNodeIds.has(node.id)).map(node => {
            const colors = getCardColor(node);
            const isSelected = selected === node.id || multiSelectRef.current.has(node.id);
            const isEditing = editing === node.id;
            const isMindMapRoot = canvasMode === 'mindmap' && !mindMapIndexData?.parentById.has(node.id);
            const mindMapSide = mindMapIndexData?.branchSideById.get(node.id) || null;
            const mindMapChildCount = mindMapIndexData?.childrenById.get(node.id)?.length || 0;
            const isSearchMatch = mindMapSearchMatchIds.has(node.id);
            const isActiveSearchMatch = activeMindMapSearchId === node.id;
            return (
              <div
                key={node.id}
                data-node-id={node.id}
                role={canvasMode === 'mindmap' ? 'button' : undefined}
                tabIndex={canvasMode === 'mindmap' ? 0 : undefined}
                aria-label={canvasMode === 'mindmap' ? String(node.text || node.file || '未命名主题').split('\n')[0] : undefined}
                aria-pressed={canvasMode === 'mindmap' ? isSelected : undefined}
                aria-expanded={canvasMode === 'mindmap' && mindMapChildCount > 0 ? !node.collapsed : undefined}
                className={`canvas-card${isSelected ? ' selected' : ''}${node.type === 'group' ? ' group-card' : ''}${canvasMode === 'mindmap' ? ' mindmap-card' : ''}${isMindMapRoot ? ' mindmap-root' : ''}${isSearchMatch ? ' mindmap-search-match' : ''}${isActiveSearchMatch ? ' mindmap-search-active' : ''}`}
                style={{
                  left: node.x, top: node.y,
                  width: node.width, height: node.height,
                  borderColor: isSelected ? '#7c5cff' : colors.border,
                  backgroundColor: node.type === 'group' || isMindMapRoot ? undefined : colors.bg,
                  willChange: 'transform',
                }}
                onPointerDown={(e) => startDrag(e, node.id)}
                onFocus={(e) => {
                  if (canvasMode === 'mindmap' && e.target === e.currentTarget && selectedRef.current !== node.id) {
                    selectMindMapNode(node.id);
                  }
                }}
                onDoubleClick={(e) => handleCardDoubleClick(e, node.id)}
                onContextMenu={(e) => openContextMenu(e, node.id)}
              >
                {/* File card */}
                {node.type === 'file' && (
                  <div className="canvas-card-file">
                    <span style={{ fontSize: 18, marginRight: 8 }}>📝</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6' }}>
                        {node.file?.split('/').pop()?.replace('.md', '') || 'Untitled'}
                      </div>
                      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                        {node.file}
                      </div>
                    </div>
                  </div>
                )}

                {/* Group frame */}
                {node.type === 'group' && (
                  <div className="canvas-group-label">
                    {node.text || 'Group'}
                  </div>
                )}

                {/* Text card */}
                {node.type === 'text' && (
                  isEditing ? (
                    <textarea
                      className="canvas-card-editor"
                      value={node.text || ''}
                      onChange={(e) => handleTextEdit(node.id, e.target.value)}
                      autoFocus
                      placeholder="输入内容..."
                      onPointerDown={(e) => e.stopPropagation()}
                      onBlur={() => {
                        if (editingRef.current === node.id) finishTextEditing(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          finishTextEditing(false);
                          return;
                        }
                        if (canvasMode === 'mindmap' && e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                          e.preventDefault();
                          e.stopPropagation();
                          finishTextEditing(true);
                          promoteMindMapNode(node.id);
                          requestAnimationFrame(() => beginTextEditing(node.id));
                          return;
                        }
                        if (canvasMode !== 'mindmap' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          e.stopPropagation();
                          finishTextEditing(true);
                          addMindMapNode(e.key === 'Tab' ? 'child' : 'sibling');
                        }
                      }}
                    />
                  ) : (
                    <div className="canvas-card-content"
                      dangerouslySetInnerHTML={{ __html: renderCardMarkdown(node.text || '') }}
                    />
                  )
                )}

                {canvasMode === 'mindmap' && mindMapChildCount > 0 && (
                  <button
                    type="button"
                    className={`canvas-mindmap-collapse side-${mindMapSide || 'right'}`}
                    title={node.collapsed ? '展开分支' : '折叠分支'}
                    aria-label={node.collapsed ? '展开分支' : '折叠分支'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMindMapBranch(node.id);
                    }}
                  >
                    {node.collapsed ? mindMapChildCount : '−'}
                  </button>
                )}

                {canvasMode === 'mindmap' && !isEditing && (
                  isMindMapRoot ? (
                    <>
                      <button
                        type="button"
                        className="canvas-mindmap-add side-left"
                        title="在左侧添加分支"
                        aria-label="在左侧添加分支"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); selectMindMapNode(node.id); addMindMapNode('child', 'left'); }}
                      >+</button>
                      <button
                        type="button"
                        className="canvas-mindmap-add side-right"
                        title="在右侧添加分支"
                        aria-label="在右侧添加分支"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); selectMindMapNode(node.id); addMindMapNode('child', 'right'); }}
                      >+</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={`canvas-mindmap-add side-${mindMapSide || 'right'}`}
                      title="添加子主题"
                      aria-label="添加子主题"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); selectMindMapNode(node.id); addMindMapNode('child'); }}
                    >+</button>
                  )
                )}

                {/* Connection points */}
                {canvasMode === 'free' && ['top', 'right', 'bottom', 'left'].map(side => {
                  const pos = {
                    top: { top: -5, left: '50%', transform: 'translateX(-50%)' },
                    bottom: { bottom: -5, left: '50%', transform: 'translateX(-50%)' },
                    left: { left: -5, top: '50%', transform: 'translateY(-50%)' },
                    right: { right: -5, top: '50%', transform: 'translateY(-50%)' },
                  }[side]!;
                  return (
                    <div key={side} className="canvas-conn-point" style={pos as any}
                      onPointerDown={(e) => startConnect(e, node.id, side)}
                    />
                  );
                })}

                {/* Color dots (shown when selected) */}
                {isSelected && canvasMode === 'free' && (
                  <div className="canvas-card-colors">
                    {Object.entries(CARD_COLORS).map(([key, color]) => (
                      <div key={key} className="canvas-color-dot"
                        style={{ background: color, outline: node.color === key ? '2px solid var(--text-main)' : 'none' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const newNodes = nodesRef.current.map(n =>
                            n.id === node.id ? { ...n, color: n.color === key ? undefined : key } : n
                          );
                          saveCanvas(newNodes, edgesRef.current);
                        }}
                      />
                    ))}
                  </div>
                )}

                {isSelected && (
                  <div className="canvas-card-size-badge">
                    {Math.round(node.width)} x {Math.round(node.height)}
                  </div>
                )}

                {/* Resize handles */}
                {isSelected && canvasMode === 'free' && RESIZE_HANDLES.map(direction => (
                  <div
                    key={direction}
                    className={`canvas-resize-handle handle-${direction}`}
                    onPointerDown={(e) => startResize(e, node.id, direction)}
                  />
                ))}
              </div>
            );
          })}

          {canvasMode === 'mindmap' && selectedNode && visibleNodeIds.has(selectedNode.id) && (
            <div
              className="canvas-mindmap-floating-toolbar"
              style={{ left: selectedNode.x + selectedNode.width / 2, top: selectedNode.y - 10 }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button type="button" onClick={() => beginTextEditing(selectedNode.id)}>编辑</button>
              <button type="button" title="复制整个分支 (Ctrl+C)" onClick={() => void copyMindMapBranch(false, selectedNode.id)}>复制</button>
              {mindMapIndexData?.parentById.has(selectedNode.id) ? (
                <>
                  <button type="button" onClick={() => addMindMapNode('sibling')}>同级</button>
                  <button type="button" title="同级上移 (Alt+↑)" onClick={() => reorderMindMapSibling(-1, selectedNode.id)}>↑</button>
                  <button type="button" title="同级下移 (Alt+↓)" onClick={() => reorderMindMapSibling(1, selectedNode.id)}>↓</button>
                  {!mindMapIndexData.parentById.has(mindMapIndexData.parentById.get(selectedNode.id)!) && (
                    <button
                      type="button"
                      title={mindMapIndexData.branchSideById.get(selectedNode.id) === 'left' ? '移到右侧 (Alt+→)' : '移到左侧 (Alt+←)'}
                      onClick={() => moveMindMapBranchSide(mindMapIndexData.branchSideById.get(selectedNode.id) === 'left' ? 'right' : 'left', selectedNode.id)}
                    >{mindMapIndexData.branchSideById.get(selectedNode.id) === 'left' ? '移右' : '移左'}</button>
                  )}
                </>
              ) : (
                <>
                  <button type="button" onClick={() => addMindMapNode('child', 'left')}>左分支</button>
                  <button type="button" onClick={() => addMindMapNode('child', 'right')}>右分支</button>
                </>
              )}
              <button type="button" onClick={() => addMindMapNode('child')}>子主题</button>
              {(mindMapIndexData?.childrenById.get(selectedNode.id)?.length || 0) > 0 && (
                <button type="button" onClick={() => toggleMindMapBranch(selectedNode.id)}>{selectedNode.collapsed ? '展开' : '折叠'}</button>
              )}
              <span className="canvas-mindmap-floating-sep" />
              {Object.entries(CARD_COLORS).slice(0, 6).map(([key, color]) => (
                <button
                  type="button"
                  key={key}
                  className="canvas-mindmap-color"
                  aria-label={`设置颜色 ${key}`}
                  style={{ background: color }}
                  onClick={() => updateNode(selectedNode.id, { color: key })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedNode && canvasMode === 'free' && (
        <aside className="canvas-properties-panel" onPointerDown={(e) => e.stopPropagation()}>
          <div className="canvas-properties-header">
            <div>
              <div className="canvas-properties-kicker">Selection</div>
              <strong>{selectedNode.type === 'group' ? 'Group frame' : selectedNode.type === 'file' ? 'File card' : 'Text card'}</strong>
            </div>
            <button className="canvas-panel-close" onClick={() => { setSelected(null); selectedRef.current = null; }}>x</button>
          </div>

          <div className="canvas-properties-grid">
            <label>
              X
              <input type="number" value={Math.round(selectedNode.x)} onChange={(e) => updateNode(selectedNode.id, { x: snap(Number(e.target.value) || 0, GRID_SIZE) }, { history: false })} />
            </label>
            <label>
              Y
              <input type="number" value={Math.round(selectedNode.y)} onChange={(e) => updateNode(selectedNode.id, { y: snap(Number(e.target.value) || 0, GRID_SIZE) }, { history: false })} />
            </label>
            <label>
              W
              <input type="number" min={MIN_CARD_W} value={Math.round(selectedNode.width)} onChange={(e) => updateNode(selectedNode.id, { width: Math.max(MIN_CARD_W, snap(Number(e.target.value) || MIN_CARD_W, GRID_SIZE)) }, { history: false })} />
            </label>
            <label>
              H
              <input type="number" min={MIN_CARD_H} value={Math.round(selectedNode.height)} onChange={(e) => updateNode(selectedNode.id, { height: Math.max(MIN_CARD_H, snap(Number(e.target.value) || MIN_CARD_H, GRID_SIZE)) }, { history: false })} />
            </label>
          </div>

          <div className="canvas-property-block">
            <span>Color</span>
            <div className="canvas-property-colors">
              <button className={!selectedNode.color ? 'active' : ''} onClick={() => updateNode(selectedNode.id, { color: undefined })}>Default</button>
              {Object.entries(CARD_COLORS).map(([key, color]) => (
                <button
                  key={key}
                  className={selectedNode.color === key ? 'active' : ''}
                  style={{ ['--swatch' as any]: color }}
                  onClick={() => updateNode(selectedNode.id, { color: key })}
                  aria-label={`Set color ${key}`}
                />
              ))}
            </div>
          </div>

          {selectedNode.type === 'group' && (
            <label className="canvas-property-block">
              Title
              <input value={selectedNode.text || ''} onChange={(e) => updateNode(selectedNode.id, { text: e.target.value }, { history: false })} />
            </label>
          )}

          {selectedNode.type === 'file' && (
            <label className="canvas-property-block">
              File path
              <input value={selectedNode.file || ''} onChange={(e) => updateNode(selectedNode.id, { file: e.target.value }, { history: false })} />
            </label>
          )}

          {selectedNode.type === 'text' && (
            <>
              <div className="canvas-property-actions">
                <button onClick={() => fitTextNodeToContent(selectedNode.id)}>Fit text</button>
                <button onClick={() => splitTextNodeIntoReadableCards(selectedNode.id)}>Split long card</button>
              </div>
              <div className="canvas-size-hint">
                Drag edges or corner dots to resize. Use Fit/Split when generated text feels cramped.
              </div>
              <label className="canvas-property-block">
                Content
                <textarea value={selectedNode.text || ''} onChange={(e) => updateNode(selectedNode.id, { text: e.target.value }, { history: false })} />
              </label>
            </>
          )}
        </aside>
      )}

      {selectedEdgeObj && (
        <aside className="canvas-properties-panel" onPointerDown={(e) => e.stopPropagation()}>
          <div className="canvas-properties-header">
            <div>
              <div className="canvas-properties-kicker">Connection</div>
              <strong>Edge</strong>
            </div>
            <button className="canvas-panel-close" onClick={() => { setSelectedEdge(null); selectedEdgeRef.current = null; }}>x</button>
          </div>

          <div className="canvas-edge-summary">
            <span>{selectedEdgeFrom?.text?.split('\n')[0]?.replace(/^#+\s*/, '') || selectedEdgeFrom?.file?.split('/').pop() || 'Card'}</span>
            <span>→</span>
            <span>{selectedEdgeTo?.text?.split('\n')[0]?.replace(/^#+\s*/, '') || selectedEdgeTo?.file?.split('/').pop() || 'Card'}</span>
          </div>

          <label className="canvas-property-block">
            Label
            <input value={selectedEdgeObj.label || ''} onChange={(e) => updateEdge(selectedEdgeObj.id, { label: e.target.value }, { history: false })} />
          </label>

          <div className="canvas-property-block">
            <span>Color</span>
            <div className="canvas-property-colors">
              <button className={!selectedEdgeObj.color ? 'active' : ''} onClick={() => updateEdge(selectedEdgeObj.id, { color: undefined })}>Default</button>
              {Object.entries(CARD_COLORS).map(([key, color]) => (
                <button
                  key={key}
                  className={selectedEdgeObj.color === key ? 'active' : ''}
                  style={{ ['--swatch' as any]: color }}
                  onClick={() => updateEdge(selectedEdgeObj.id, { color: key })}
                  aria-label={`Set edge color ${key}`}
                />
              ))}
            </div>
          </div>

          <button className="canvas-property-danger" onClick={deleteSelectedEdge}>
            Delete connection
          </button>
        </aside>
      )}

      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.edgeId ? (
            <>
              <button onClick={() => { selectEdge(contextMenu.edgeId!); closeContextMenu(); }}>Select connection</button>
              <div className="canvas-context-colors">
                {Object.entries(CARD_COLORS).map(([key, color]) => (
                  <span
                    key={key}
                    style={{ background: color }}
                    onClick={() => {
                      if (contextMenu.edgeId) updateEdge(contextMenu.edgeId, { color: key });
                      closeContextMenu();
                    }}
                  />
                ))}
              </div>
              <button className="danger" onClick={() => {
                if (contextMenu.edgeId) {
                  setSelectedEdge(contextMenu.edgeId);
                  selectedEdgeRef.current = contextMenu.edgeId;
                  const newEdges = edgesRef.current.filter(edge => edge.id !== contextMenu.edgeId);
                  saveCanvas(nodesRef.current, newEdges);
                  setSelectedEdge(null);
                  selectedEdgeRef.current = null;
                }
                closeContextMenu();
              }}>
                Delete connection
              </button>
            </>
          ) : contextMenu.nodeId ? (
            <>
              {(canvasMode === 'free' || getMindMapParentId(contextMenu.nodeId, nodes, edges)) && (
                <button onClick={() => {
                  if (canvasMode === 'mindmap') duplicateMindMapBranch(contextMenu.nodeId);
                  else duplicateSelectedNodes();
                  closeContextMenu();
                }}>{canvasMode === 'mindmap' ? '复制整个分支' : 'Duplicate'}</button>
              )}
              {canvasMode === 'free' && (
                <>
                  <button onClick={() => { reorderSelectedNodes('front'); closeContextMenu(); }}>Bring to front</button>
                  <button onClick={() => { reorderSelectedNodes('back'); closeContextMenu(); }}>Send to back</button>
                </>
              )}
              <button onClick={() => {
                const node = nodesRef.current.find(n => n.id === contextMenu.nodeId);
                if (node?.type === 'text') beginTextEditing(node.id);
                closeContextMenu();
              }}>
                {canvasMode === 'mindmap' ? '编辑主题' : 'Edit'}
              </button>
              {canvasMode === 'mindmap' && (
                <>
                  <button onClick={() => { void copyMindMapBranch(false, contextMenu.nodeId); closeContextMenu(); }}>复制分支</button>
                  <button onClick={() => { void copyMindMapBranch(true, contextMenu.nodeId); closeContextMenu(); }}>剪切分支</button>
                  <button onClick={() => { selectMindMapNode(contextMenu.nodeId!); void pasteMindMapBranch(); closeContextMenu(); }}>粘贴为子分支</button>
                  <button onClick={() => { reorderMindMapSibling(-1, contextMenu.nodeId); closeContextMenu(); }}>同级上移</button>
                  <button onClick={() => { reorderMindMapSibling(1, contextMenu.nodeId); closeContextMenu(); }}>同级下移</button>
                </>
              )}
              {canvasMode === 'free' && contextNode?.type === 'text' && (
                <>
                  <button onClick={() => { fitTextNodeToContent(contextMenu.nodeId); closeContextMenu(); }}>Fit text</button>
                  <button onClick={() => { splitTextNodeIntoReadableCards(contextMenu.nodeId); closeContextMenu(); }}>Split long card</button>
                </>
              )}
              <div className="canvas-context-colors">
                {Object.entries(CARD_COLORS).map(([key, color]) => (
                  <span
                    key={key}
                    style={{ background: color }}
                    onClick={() => {
                      if (contextMenu.nodeId) updateNode(contextMenu.nodeId, { color: key });
                      closeContextMenu();
                    }}
                  />
                ))}
              </div>
              {canvasMode === 'mindmap' ? (
                <>
                  <button className="danger" onClick={() => { deleteMindMapBranch(contextMenu.nodeId); closeContextMenu(); }}>删除整个分支</button>
                  <button onClick={() => { deleteMindMapNodePreserveChildren(contextMenu.nodeId); closeContextMenu(); }}>仅删除此节点并保留子级</button>
                </>
              ) : (
                <button className="danger" onClick={() => { deleteSelectedNodes(); closeContextMenu(); }}>Delete</button>
              )}
            </>
          ) : (
            <>
              <button onClick={() => { addTextCard(); closeContextMenu(); }}>New text card</button>
              <button onClick={() => { addGroupCard(); closeContextMenu(); }}>New group</button>
              <button onClick={() => { autoLayoutCanvas(); closeContextMenu(); }}>Auto layout</button>
              <button onClick={() => { fitToContent(); closeContextMenu(); }}>Fit to content</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
