/* ── Canvas Editor (v2.0.0) ── */
/* Obsidian Canvas-like visual workspace for Ars-note */
/* Smooth dragging, momentum panning, pinch-zoom, snap-to-grid */

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';

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
type CanvasSnapshot = { nodes: CanvasNode[]; edges: CanvasEdge[]; selected: string | null; selectedEdge: string | null };
type SaveCanvasOptions = { history?: boolean; immediate?: boolean; historySnapshot?: CanvasSnapshot | null };
type ContextMenuState = { x: number; y: number; nodeId: string | null; edgeId?: string | null } | null;
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
const CANVAS_LAYOUT_VERSION = 2;
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

function serializeCanvas(nodes: CanvasNode[], edges: CanvasEdge[]): string {
  return JSON.stringify({ layoutVersion: CANVAS_LAYOUT_VERSION, nodes, edges });
}

function snapshotEquals(a: CanvasSnapshot, b: CanvasSnapshot): boolean {
  return serializeCanvas(a.nodes, a.edges) === serializeCanvas(b.nodes, b.edges);
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
  const modeRef = useRef<'idle' | 'pan' | 'drag' | 'resize' | 'connect' | 'select-box'>('idle');
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
  const lastSerializedRef = useRef('');

  /* Keep refs in sync */
  nodesRef.current = nodes;
  edgesRef.current = edges;
  panRef.current = pan;
  zoomRef.current = zoom;
  selectedRef.current = selected;
  selectedEdgeRef.current = selectedEdge;
  editingRef.current = editing;

  const makeSnapshot = useCallback((): CanvasSnapshot => ({
    nodes: cloneNodes(nodesRef.current),
    edges: cloneEdges(edgesRef.current),
    selected: selectedRef.current,
    selectedEdge: selectedEdgeRef.current,
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
    const serialized = serializeCanvas(n, e);
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
      hasLoadedValidContentRef.current = true;
      return;
    }

    try {
      const data = JSON.parse(content);
      const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
      const parsedEdges = Array.isArray(data.edges) ? data.edges : [];
      const normalized = normalizeCanvasDataForDisplay(rawNodes, parsedEdges);
      setNodes(normalized.nodes);
      setEdges(normalized.edges);
      nodesRef.current = normalized.nodes;
      edgesRef.current = normalized.edges;
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
      }
    }
  }, [content]);

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    interactionStartSnapshotRef.current = null;
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
    else if (redoStackRef.current.length > 0) {
      redoStackRef.current = [];
      setHistoryTick(tick => tick + 1);
    }
    setNodes(n); setEdges(e);
    nodesRef.current = n;
    edgesRef.current = e;
    persistCanvas(n, e, options.immediate);
  }, [makeSnapshot, persistCanvas, pushHistory]);

  const undoCanvas = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(makeSnapshot());
    applyCanvasSnapshot(previous);
    setHistoryTick(tick => tick + 1);
  }, [applyCanvasSnapshot, makeSnapshot]);

  const redoCanvas = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(makeSnapshot());
    applyCanvasSnapshot(next);
    setHistoryTick(tick => tick + 1);
  }, [applyCanvasSnapshot, makeSnapshot]);

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
  }, [screenToCanvas]);

  /* ── Pointer move (global, captured) ── */
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const mode = modeRef.current;

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
  }, [applyTransform, screenToCanvas, moveCardDOM, resizeCardDOM, updateTempLine]);

  /* ── Pointer up ── */
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const mode = modeRef.current;

    if (mode === 'pan') {
      setPan({ ...panRef.current });
      modeRef.current = 'idle';
      if (viewportRef.current) viewportRef.current.style.cursor = '';
      return;
    }

    if (mode === 'drag' || mode === 'resize') {
      saveCanvas([...nodesRef.current], edgesRef.current, {
        historySnapshot: interactionStartSnapshotRef.current,
        immediate: true,
      });
      interactionStartSnapshotRef.current = null;
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
  }, [screenToCanvas, saveCanvas, removeTempLine]);

  /* ── Zoom (wheel) with smooth center-point zoom ── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

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

    /* If not in multi-select, clear it */
    if (!multiSelectRef.current.has(nodeId)) {
      multiSelectRef.current.clear();
    }
    multiSelectRef.current.add(nodeId);

    setSelected(nodeId);
    selectedRef.current = nodeId;
    setSelectedEdge(null);
    selectedEdgeRef.current = null;
    setEditing(null);
    editingRef.current = null;

    modeRef.current = 'drag';
    interactionStartSnapshotRef.current = makeSnapshot();
    dragInfoRef.current = {
      nodeId, startX: e.clientX, startY: e.clientY,
      nodeX: node.x, nodeY: node.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [makeSnapshot]);

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
      setEditing(nodeId);
      editingRef.current = nodeId;
    }
  }, [onOpenFile]);

  const handleTextEdit = useCallback((nodeId: string, text: string) => {
    const newNodes = nodesRef.current.map(n => n.id === nodeId ? { ...n, text } : n);
    nodesRef.current = newNodes;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(JSON.stringify({ layoutVersion: CANVAS_LAYOUT_VERSION, nodes: newNodes, edges: edgesRef.current }));
    }, 400);
  }, [onChange]);

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
    if (nodesRef.current.length === 0) {
      setZoom(1); zoomRef.current = 1;
      setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
      applyTransform();
      return;
    }
    const padding = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodesRef.current) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const newZoom = Math.min(2, Math.min(rect.width / contentW, rect.height / contentH));
    const newPan = {
      x: (rect.width - contentW * newZoom) / 2 - (minX - padding) * newZoom,
      y: (rect.height - contentH * newZoom) / 2 - (minY - padding) * newZoom,
    };
    setZoom(newZoom); zoomRef.current = newZoom;
    setPan(newPan); panRef.current = newPan;
    applyTransform();
  }, [applyTransform]);

  const autoLayoutCanvas = useCallback(() => {
    const selectedIds = getActiveSelection();
    const newNodes = layoutCanvasNodesByEdges(nodesRef.current, edgesRef.current, selectedIds);
    saveCanvas(newNodes, edgesRef.current);
  }, [getActiveSelection, saveCanvas]);

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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editingRef.current) return;
        if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
        if (selectedEdgeRef.current) {
          deleteSelectedEdge();
          return;
        }
        if (!selectedRef.current) return;
        deleteSelectedNodes();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (editingRef.current || !selectedRef.current) return;
        if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
        e.preventDefault();
        duplicateSelectedNodes();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave?.();
      }
      if (e.key === 'Escape') {
        setEditing(null); editingRef.current = null;
        setSelected(null); selectedRef.current = null;
        setSelectedEdge(null); selectedEdgeRef.current = null;
        multiSelectRef.current.clear();
      }
      /* Arrow keys to nudge selected cards */
      if (selectedRef.current && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
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
  }, [deleteSelectedEdge, deleteSelectedNodes, duplicateSelectedNodes, onSave, redoCanvas, saveCanvas, undoCanvas]);

  /* ── Cleanup ── */
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  /* ── Get card color styles ── */
  const getCardColor = useCallback((node: CanvasNode) => {
    if (!node.color || !CARD_COLORS[node.color]) return { border: 'var(--border)', bg: 'var(--bg-card)' };
    return { border: CARD_COLORS[node.color], bg: COLOR_BG[node.color] };
  }, []);

  /* ── Memoized edges SVG ── */
  const edgesSvg = useMemo(() => {
    return edges.map(edge => {
      const from = nodes.find(n => n.id === edge.fromNode);
      const to = nodes.find(n => n.id === edge.toNode);
      if (!from || !to) return null;
      const sides = edge.fromSide ? { fs: edge.fromSide, ts: edge.toSide || 'left' } : autoSides(from, to);
      const d = edgePath(from, to, sides.fs, sides.ts);
      const isSelectedEdge = selectedEdge === edge.id;
      const labelX = (from.x + from.width / 2 + to.x + to.width / 2) / 2;
      const labelY = (from.y + from.height / 2 + to.y + to.height / 2) / 2;
      const stroke = edge.color ? CARD_COLORS[edge.color] || '#7c5cff' : '#7c5cff';
      return (
        <g key={edge.id} className={`canvas-edge${isSelectedEdge ? ' selected' : ''}`}>
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
            strokeWidth={isSelectedEdge ? 3 : 1.7}
            opacity={isSelectedEdge ? 0.95 : 0.65}
            markerEnd="url(#arrowhead)"
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
  }, [nodes, edges, openContextMenu, selectEdge, selectedEdge]);

  const selectedNode = selected ? nodes.find(node => node.id === selected) || null : null;
  const selectedEdgeObj = selectedEdge ? edges.find(edge => edge.id === selectedEdge) || null : null;
  const selectedEdgeFrom = selectedEdgeObj ? nodes.find(node => node.id === selectedEdgeObj.fromNode) || null : null;
  const selectedEdgeTo = selectedEdgeObj ? nodes.find(node => node.id === selectedEdgeObj.toNode) || null : null;
  const contextNode = contextMenu?.nodeId ? nodes.find(node => node.id === contextMenu.nodeId) || null : null;
  const canUndo = historyTick >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyTick >= 0 && redoStackRef.current.length > 0;
  const canvasQuality = useMemo(() => analyzeCanvasQualityForDisplay(nodes, edges), [nodes, edges]);

  /* ═══════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════ */

  return (
    <div className="canvas-editor">
      {/* Title bar */}
      <div className="editor-titlebar">
        <span className="editor-titlebar-name">
          <span style={{ color: '#7c5cff', marginRight: 6 }}>⬡</span>
          {fileName || 'Canvas'}
        </span>
        <span className="editor-titlebar-right" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {nodes.length} cards · {edges.length} links
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
        <button className="canvas-tool-btn" title="添加文本卡片 (双击空白处)" onClick={addTextCard}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
        </button>
        <button className="canvas-tool-btn" title="添加文件卡片" onClick={addFileCard}>
          <span style={{ fontSize: 13 }}>📄</span>
        </button>
        <button className="canvas-tool-btn canvas-tool-btn-wide" title="Add group frame" onClick={addGroupCard}>
          Group
        </button>
        <button className="canvas-tool-btn canvas-tool-btn-wide" title="Duplicate selected cards (Ctrl+D)" onClick={duplicateSelectedNodes} disabled={!selected}>
          Duplicate
        </button>
        <button className="canvas-tool-btn canvas-tool-btn-wide" title="Delete selection" onClick={() => selectedEdge ? deleteSelectedEdge() : deleteSelectedNodes()} disabled={!selected && !selectedEdge}>
          Delete
        </button>
        <button className="canvas-tool-btn canvas-tool-btn-wide" title="Auto layout cards" onClick={autoLayoutCanvas} disabled={nodes.length === 0}>
          Layout
        </button>
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
          双击创建 · Alt+拖拽平移 · 滚轮缩放 · 方向键微调
        </span>
      </div>

      {qualityPanelOpen && nodes.length > 0 && (
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
          {nodes.map(node => {
            const colors = getCardColor(node);
            const isSelected = selected === node.id || multiSelectRef.current.has(node.id);
            const isEditing = editing === node.id;
            return (
              <div
                key={node.id}
                data-node-id={node.id}
                className={`canvas-card${isSelected ? ' selected' : ''}${node.type === 'group' ? ' group-card' : ''}`}
                style={{
                  left: node.x, top: node.y,
                  width: node.width, height: node.height,
                  borderColor: isSelected ? '#7c5cff' : colors.border,
                  backgroundColor: node.type === 'group' ? 'transparent' : colors.bg,
                  willChange: 'transform',
                }}
                onPointerDown={(e) => startDrag(e, node.id)}
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
                    />
                  ) : (
                    <div className="canvas-card-content"
                      dangerouslySetInnerHTML={{ __html: renderCardMarkdown(node.text || '') }}
                    />
                  )
                )}

                {/* Connection points */}
                {['top', 'right', 'bottom', 'left'].map(side => {
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
                {isSelected && (
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
                {isSelected && RESIZE_HANDLES.map(direction => (
                  <div
                    key={direction}
                    className={`canvas-resize-handle handle-${direction}`}
                    onPointerDown={(e) => startResize(e, node.id, direction)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {selectedNode && (
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
              <button onClick={() => { duplicateSelectedNodes(); closeContextMenu(); }}>Duplicate</button>
              <button onClick={() => { reorderSelectedNodes('front'); closeContextMenu(); }}>Bring to front</button>
              <button onClick={() => { reorderSelectedNodes('back'); closeContextMenu(); }}>Send to back</button>
              <button onClick={() => {
                const node = nodesRef.current.find(n => n.id === contextMenu.nodeId);
                if (node?.type === 'text') {
                  setEditing(node.id);
                  editingRef.current = node.id;
                }
                closeContextMenu();
              }}>
                Edit
              </button>
              {contextNode?.type === 'text' && (
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
              <button className="danger" onClick={() => { deleteSelectedNodes(); closeContextMenu(); }}>Delete</button>
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
