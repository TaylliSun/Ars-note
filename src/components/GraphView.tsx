/* ──────────────────────────────────────────────────────
   GraphView.tsx — Obsidian-like Force-Directed Knowledge Graph
   v2.0.0 — Live physics simulation, node dragging, spring/bouncy feel
   ────────────────────────────────────────────────────── */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { GraphData, GraphSummary, GraphNode } from '../types';
import { useI18n } from '../i18n';
import { collectAdjacentNodeIds, collectGraphNeighborhood, injectHiddenSearchMatches, rankGraphNodesForCanvas, resolveCurrentGraphNodeId } from '../utils/graphInteraction';
import { CloseIcon, LocateIcon, MaximizeIcon, SearchIcon, SettingsIcon } from './icons/ArsIcons';

interface GraphViewProps {
  graphData: GraphData;
  graphSummary: GraphSummary;
  onOpenFile: (relativePath: string) => void;
  onTagClick: (tag: string) => void;
  onCreateMissingNote: (target: string) => void;
  currentFilePath?: string;
  vaultIndex?: { notes: Record<string, { tags: string[]; metadata?: { status?: string; priority?: string; owner?: string } }> } | null;
}

/* ── Constants ── */

const MAX_LABEL = 18;
const MAX_RENDER_NODES = 150;
const SVG_W = 800;
const SVG_H = 600;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.2;

/* Physics tuning — smooth, organic, Obsidian-like feel */
const REPULSION = 820;        // base repulsion (scales with node count)
const DAMPING = 0.82;         // lower = faster energy loss
const CENTER_PULL = 0.006;    // gentle center gravity
const SPRING_STIFFNESS = 0.04; // soft springs — allows stretch/bounce
const DRAG_SPRING = 0.18;     // dragged nodes follow smoothly without launching
const VELOCITY_CAP = 8;        // moderate max speed — prevents jerky jumps
const FPS = 30;                // target frame rate for simulation
const SPRING_LIMIT = Math.min(SPRING_STIFFNESS, 0.024);
const VELOCITY_LIMIT = Math.min(VELOCITY_CAP, 3.8);
const SETTLE_SPEED = 0.035;
const FRAME_MS = 1000 / FPS;
const STABLE_REPULSION = Math.min(REPULSION, 620);
const STABLE_DAMPING = Math.min(DAMPING, 0.72);
const STABLE_CENTER_PULL = Math.min(CENTER_PULL, 0.004);
const STABLE_SPRING_LIMIT = Math.min(SPRING_LIMIT, 0.018);
const STABLE_DRAG_SPRING = Math.min(DRAG_SPRING, 0.1);
const STABLE_VELOCITY_LIMIT = Math.min(VELOCITY_LIMIT, 2.4);
const STABLE_SETTLE_SPEED = Math.max(SETTLE_SPEED, 0.08);

const NODE_COLORS: Record<string, string> = {
  note: '#2f8cff',
  tag: '#4ade80',
  missing: '#f87171',
  gameDoc: '#fbbf24',
  gdd: '#fbbf24',
  character: '#c084fc',
  item: '#34d399',
  quest: '#60a5fa',
  unityTask: '#4ade80',
  devlog: '#fb923c',
};

function nodeColor(node: GraphNode): string {
  if (node.type === 'gameDoc' && node.gameDocType) {
    return NODE_COLORS[node.gameDocType] || NODE_COLORS.gameDoc;
  }
  return NODE_COLORS[node.type] || '#cdd6f4';
}

function nodeRadius(node: GraphNode): number {
  const base = node.type === 'tag' ? 5 : node.type === 'missing' ? 4 : 6;
  const bonus = Math.min(Math.sqrt(Math.max(node.linkCount, node.tagCount, 1)) * 1.5, 10);
  return base + bonus;
}

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL) return label;
  return label.substring(0, MAX_LABEL - 1) + '…';
}

/* ── Live physics node ── */

interface PhysicsNode {
  node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean; // true while being dragged
}

/* ── Component ── */

type GraphMode = 'global' | 'local';
type LocalDepth = 1 | 2 | 3;

const GraphView: React.FC<GraphViewProps> = ({
  graphData, graphSummary, onOpenFile, onTagClick, onCreateMissingNote,
  currentFilePath, vaultIndex,
}) => {
  const { t } = useI18n();
  const [graphMode, setGraphMode] = useState<GraphMode>('global');
  const [localDepth, setLocalDepth] = useState<LocalDepth>(2);
  const [showTags, setShowTags] = useState(true);
  const [showMissing, setShowMissing] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showGameDocs, setShowGameDocs] = useState(true);
  const [showGameDocsOnly, setShowGameDocsOnly] = useState(false);
  const [showIsolated, setShowIsolated] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [localRootOverride, setLocalRootOverride] = useState<string | null>(null);
  const [repulsionScale, setRepulsionScale] = useState(1);
  const [linkDistance, setLinkDistance] = useState(110);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [tick, setTick] = useState(0); // force re-render from animation loop
  const [physicsPaused, setPhysicsPaused] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const physicsRef = useRef<PhysicsNode[]>([]);
  const physicsPausedRef = useRef(false);
  const repulsionScaleRef = useRef(1);
  const linkDistanceRef = useRef(110);
  const settledFramesRef = useRef(0);
  const dragRef = useRef<{
    nodeId: string | null;
    offsetX: number;
    offsetY: number;
    mouseX: number;
    mouseY: number;
  }>({ nodeId: null, offsetX: 0, offsetY: 0, mouseX: 0, mouseY: 0 });
  const panDragRef = useRef<{ active: boolean; startX: number; startY: number; panStartX: number; panStartY: number }>({
    active: false, startX: 0, startY: 0, panStartX: 0, panStartY: 0,
  });
  const animFrameRef = useRef<number>(0);
  const edgesRef = useRef<Array<{ source: string; target: string; type: string; id: string }>>([]);

  useEffect(() => {
    physicsPausedRef.current = physicsPaused;
  }, [physicsPaused]);

  useEffect(() => {
    repulsionScaleRef.current = repulsionScale;
    settledFramesRef.current = 0;
    physicsPausedRef.current = false;
    setPhysicsPaused(false);
  }, [repulsionScale]);

  useEffect(() => {
    linkDistanceRef.current = linkDistance;
    settledFramesRef.current = 0;
    physicsPausedRef.current = false;
    setPhysicsPaused(false);
  }, [linkDistance]);

  /* ── Build connected set for isolated detection ── */
  const connectedNodeIds = useMemo(() => {
    const connected = new Set<string>();
    for (const edge of graphData.edges) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    return connected;
  }, [graphData.edges]);

  const currentGraphNodeId = useMemo(
    () => resolveCurrentGraphNodeId(graphData.nodes, currentFilePath),
    [graphData.nodes, currentFilePath],
  );
  const localRootNodeId = useMemo(() => {
    if (localRootOverride && graphData.nodes.some((node) => node.id === localRootOverride)) return localRootOverride;
    return currentGraphNodeId;
  }, [currentGraphNodeId, graphData.nodes, localRootOverride]);
  const localRootNode = useMemo(
    () => graphData.nodes.find((node) => node.id === localRootNodeId) || null,
    [graphData.nodes, localRootNodeId],
  );
  const localNeighborIds = useMemo(
    () => graphMode === 'local' ? collectGraphNeighborhood(graphData.edges, localRootNodeId, localDepth) : new Set<string>(),
    [graphData.edges, graphMode, localDepth, localRootNodeId],
  );

  const eligibleNodes = useMemo(() => {
    let nodes = graphData.nodes;
    if (graphMode === 'local' && localRootNodeId) {
      nodes = nodes.filter((n) => localNeighborIds.has(n.id));
    }
    nodes = nodes.filter((n) => {
      if (n.type === 'tag' && !showTags) return false;
      if (n.type === 'missing' && !showMissing) return false;
      if (n.type === 'note' && !showNotes) return false;
      if (n.type === 'gameDoc' && !showGameDocs) return false;
      if (showGameDocsOnly && n.type !== 'gameDoc') return false;
      if (!showIsolated && !connectedNodeIds.has(n.id)) return false;
      return true;
    });
    return nodes;
  }, [graphData, graphMode, localRootNodeId, showTags, showMissing, showNotes, showGameDocs, showGameDocsOnly, showIsolated, localNeighborIds, connectedNodeIds]);

  const searchMatchIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return new Set<string>();
    return new Set(eligibleNodes.filter((node) => (
      node.label.toLowerCase().includes(query) || node.relativePath.toLowerCase().includes(query)
    )).map((node) => node.id));
  }, [eligibleNodes, searchQuery]);

  const baseFilteredNodes = useMemo(() => {
    const preferredRootId = graphMode === 'local' ? localRootNodeId : currentGraphNodeId;
    return rankGraphNodesForCanvas(eligibleNodes, MAX_RENDER_NODES, preferredRootId);
  }, [currentGraphNodeId, eligibleNodes, graphMode, localRootNodeId]);

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim() || searchMatchIds.size === 0) return baseFilteredNodes;
    return injectHiddenSearchMatches(baseFilteredNodes, eligibleNodes, searchMatchIds, MAX_RENDER_NODES);
  }, [baseFilteredNodes, eligibleNodes, searchMatchIds, searchQuery]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  useEffect(() => {
    if (selectedNode && !filteredNodeIds.has(selectedNode.id)) setSelectedNode(null);
    if (hoveredNode && !filteredNodeIds.has(hoveredNode)) setHoveredNode(null);
  }, [filteredNodeIds, hoveredNode, selectedNode]);

  const visibleNodeEdges = useMemo(() => {
    return graphData.edges.filter((e) =>
      filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );
  }, [graphData.edges, filteredNodeIds]);

  const filteredEdges = useMemo(
    () => showEdges ? visibleNodeEdges : [],
    [showEdges, visibleNodeEdges],
  );

  const focusNodeId = hoveredNode || selectedNode?.id || null;
  const focusNeighborhood = useMemo(
    () => collectAdjacentNodeIds(visibleNodeEdges, focusNodeId),
    [visibleNodeEdges, focusNodeId],
  );

  const bidirectionalSet = useMemo(() => {
    const edgeKeys = new Set<string>();
    const bidi = new Set<string>();
    for (const e of filteredEdges) {
      edgeKeys.add(e.source + '→' + e.target);
    }
    for (const e of filteredEdges) {
      const reverse = e.target + '→' + e.source;
      if (edgeKeys.has(reverse)) {
        bidi.add(e.source + '→' + e.target);
        bidi.add(e.target + '→' + e.source);
      }
    }
    return bidi;
  }, [filteredEdges]);

  const isLarge = graphData.nodes.length > MAX_RENDER_NODES;

  /* ── Initialize or update physics nodes when data changes ── */
  useEffect(() => {
    const cx = SVG_W / 2;
    const cy = SVG_H / 2;
    const oldMap = new Map<string, PhysicsNode>();
    for (const pn of physicsRef.current) oldMap.set(pn.node.id, pn);

    const newNodes: PhysicsNode[] = filteredNodes.map((n, i) => {
      const existing = oldMap.get(n.id);
      if (existing) {
        // Keep position from running simulation
        return { ...existing, node: n };
      }
      // New node: place in circle
      const angle = (2 * Math.PI * i) / Math.max(filteredNodes.length, 1);
      const spread = Math.min(SVG_W, SVG_H) * 0.3;
      return {
        node: n,
        x: cx + spread * Math.cos(angle) + (Math.random() - 0.5) * 30,
        y: cy + spread * Math.sin(angle) + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        pinned: false,
      };
    });
    physicsRef.current = newNodes;
    edgesRef.current = filteredEdges;
    settledFramesRef.current = 0;
    physicsPausedRef.current = false;
    setPhysicsPaused(false);
  }, [filteredNodes, filteredEdges]);

  /* ── Live physics simulation loop ── */
  useEffect(() => {
    let running = true;
    let lastTime = 0;
    const cx = SVG_W / 2;
    const cy = SVG_H / 2;

    const step = (timestamp: number) => {
      if (!running) return;

      // Throttle to target FPS
      const delta = timestamp - lastTime;
      if (delta < FRAME_MS) {
        animFrameRef.current = requestAnimationFrame(step);
        return;
      }
      lastTime = timestamp;

      const nodes = physicsRef.current;
      const edges = edgesRef.current;
      if (nodes.length === 0) {
        animFrameRef.current = requestAnimationFrame(step);
        return;
      }
      if (physicsPausedRef.current && !dragRef.current.nodeId) {
        animFrameRef.current = requestAnimationFrame(step);
        return;
      }

      const n = nodes.length;

      // Adaptive parameters — scale with node count
      const repulsion = STABLE_REPULSION * repulsionScaleRef.current * Math.max(1, Math.sqrt(n / 24));
      const idealLen = linkDistanceRef.current;
      const springK = STABLE_SPRING_LIMIT;

      const nodeMap = new Map<string, PhysicsNode>();
      for (const pn of nodes) nodeMap.set(pn.node.id, pn);
      const simEdges = edges
        .map((e) => ({ src: nodeMap.get(e.source), tgt: nodeMap.get(e.target) }))
        .filter((e): e is { src: PhysicsNode; tgt: PhysicsNode } => !!e.src && !!e.tgt);

      // 1. Gentle center pull
      for (const pn of nodes) {
        if (pn.pinned) continue;
        pn.vx += (cx - pn.x) * STABLE_CENTER_PULL;
        pn.vy += (cy - pn.y) * STABLE_CENTER_PULL;
      }

      // 2. Node-to-node repulsion (adaptive)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = Math.max(dx * dx + dy * dy, 100);
          const dist = Math.sqrt(distSq);
          // Soft repulsion: strong when close, fades at distance
          const force = repulsion / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (!a.pinned) { a.vx += fx; a.vy += fy; }
          if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
        }
      }

      // 3. Edge springs — soft, stretchy
      for (const { src, tgt } of simEdges) {
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.1) continue;
        const displacement = dist - idealLen;
        // Smooth spring: apply force proportional to stretch
        const force = displacement * springK;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!src.pinned) { src.vx += fx; src.vy += fy; }
        if (!tgt.pinned) { tgt.vx -= fx; tgt.vy -= fy; }
      }

      // 4. Dragged node — spring follow
      const drag = dragRef.current;
      if (drag.nodeId) {
        const pn = nodeMap.get(drag.nodeId);
        if (pn) {
          const dx = drag.mouseX - pn.x;
          const dy = drag.mouseY - pn.y;
          pn.vx = dx * STABLE_DRAG_SPRING;
          pn.vy = dy * STABLE_DRAG_SPRING;
          pn.x = drag.mouseX;
          pn.y = drag.mouseY;
        }
      }

      // 5. Integrate with damping, then settle tiny velocities to stop jitter.
      let hasMovement = false;
      for (const pn of nodes) {
        if (pn.pinned) continue;
        const speed = Math.sqrt(pn.vx * pn.vx + pn.vy * pn.vy);
        if (speed > STABLE_VELOCITY_LIMIT) {
          pn.vx = (pn.vx / speed) * STABLE_VELOCITY_LIMIT;
          pn.vy = (pn.vy / speed) * STABLE_VELOCITY_LIMIT;
        }
        pn.vx *= STABLE_DAMPING;
        pn.vy *= STABLE_DAMPING;
        const dampedSpeed = Math.sqrt(pn.vx * pn.vx + pn.vy * pn.vy);
        if (dampedSpeed < STABLE_SETTLE_SPEED) {
          pn.vx = 0;
          pn.vy = 0;
        } else {
          hasMovement = true;
        }
        pn.x += pn.vx;
        pn.y += pn.vy;
        // Soft boundary
        const margin = 50;
        if (pn.x < margin) pn.vx += (margin - pn.x) * 0.03;
        if (pn.x > SVG_W - margin) pn.vx += (SVG_W - margin - pn.x) * 0.03;
        if (pn.y < margin) pn.vy += (margin - pn.y) * 0.03;
        if (pn.y > SVG_H - margin) pn.vy += (SVG_H - margin - pn.y) * 0.03;
      }

      if (hasMovement || dragRef.current.nodeId || panDragRef.current.active) {
        settledFramesRef.current = 0;
        setTick((t) => t + 1);
      } else {
        settledFramesRef.current += 1;
        if (settledFramesRef.current > 10 && !physicsPausedRef.current) {
          for (const pn of nodes) {
            pn.vx = 0;
            pn.vy = 0;
          }
          physicsPausedRef.current = true;
          setPhysicsPaused(true);
        }
      }
      animFrameRef.current = requestAnimationFrame(step);
    };

    animFrameRef.current = requestAnimationFrame(step);
    return () => { running = false; cancelAnimationFrame(animFrameRef.current); };
  }, []);

  /* ── Build lookup map from physics nodes ── */
  const simNodeMap = useMemo(() => {
    const m = new Map<string, PhysicsNode>();
    for (const pn of physicsRef.current) m.set(pn.node.id, pn);
    return m;
    // tick ensures this re-computes every frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, filteredNodes]);

  /* ── Zoom / Pan helpers ── */
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM)), []);
  const handleResetView = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);
  const handleTogglePhysics = useCallback(() => {
    setPhysicsPaused((paused) => {
      const next = !paused;
      physicsPausedRef.current = next;
      if (!next) settledFramesRef.current = 0;
      return next;
    });
  }, []);

  const handleFitToView = useCallback(() => {
    const nodes = physicsRef.current;
    if (nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pn of nodes) {
      const r = nodeRadius(pn.node);
      if (pn.x - r < minX) minX = pn.x - r;
      if (pn.y - r < minY) minY = pn.y - r;
      if (pn.x + r > maxX) maxX = pn.x + r;
      if (pn.y + r > maxY) maxY = pn.y + r;
    }
    const graphW = maxX - minX || 1;
    const graphH = maxY - minY || 1;
    const newZoom = Math.min(SVG_W / graphW, SVG_H / graphH) * 0.85;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom)));
    setPanX(SVG_W / 2 - cx * newZoom);
    setPanY(SVG_H / 2 - cy * newZoom);
  }, []);

  const centerNodeById = useCallback((nodeId: string, minimumZoom = 1.25) => {
    const pn = simNodeMap.get(nodeId);
    if (!pn) return;
    const newZoom = Math.max(zoom, minimumZoom);
    setPanX(SVG_W / 2 - pn.x * newZoom);
    setPanY(SVG_H / 2 - pn.y * newZoom);
    setZoom(newZoom);
  }, [simNodeMap, zoom]);

  const handleCenterCurrentNote = useCallback(() => {
    if (currentGraphNodeId) centerNodeById(currentGraphNodeId);
  }, [centerNodeById, currentGraphNodeId]);

  const handleUseAsLocalRoot = useCallback((node: GraphNode) => {
    setLocalRootOverride(node.id);
    setGraphMode('local');
    setSelectedNode(node);
    setSearchQuery('');
    requestAnimationFrame(() => centerNodeById(node.id, 1.1));
  }, [centerNodeById]);

  /* ── Convert screen coords to SVG coords ── */
  const screenToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = SVG_W / rect.width;
    const scaleY = SVG_H / rect.height;
    const x = (clientX - rect.left) * scaleX / zoom - panX / zoom;
    const y = (clientY - rect.top) * scaleY / zoom - panY / zoom;
    return { x, y };
  }, [zoom, panX, panY]);

  /* ── Node drag (mouse) ── */
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const pn = simNodeMap.get(nodeId);
    if (!pn) return;
    physicsPausedRef.current = false;
    setPhysicsPaused(false);
    const svgPos = screenToSvg(e.clientX, e.clientY);
    dragRef.current = {
      nodeId,
      offsetX: pn.x - svgPos.x,
      offsetY: pn.y - svgPos.y,
      mouseX: pn.x,
      mouseY: pn.y,
    };
    pn.pinned = true;
    pn.vx = 0;
    pn.vy = 0;
  }, [simNodeMap, screenToSvg]);

  /* ── Background pan ── */
  const handleBgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    panDragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      panStartX: panX,
      panStartY: panY,
    };
  }, [panX, panY]);

  const handleGlobalMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (drag.nodeId) {
      const svgPos = screenToSvg(e.clientX, e.clientY);
      drag.mouseX = svgPos.x + drag.offsetX;
      drag.mouseY = svgPos.y + drag.offsetY;
      return;
    }
    const pan = panDragRef.current;
    if (pan.active) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scale = SVG_W / rect.width;
      setPanX(pan.panStartX + (e.clientX - pan.startX) * scale);
      setPanY(pan.panStartY + (e.clientY - pan.startY) * scale);
    }
  }, [screenToSvg]);

  const handleGlobalMouseUp = useCallback(() => {
    const drag = dragRef.current;
    if (drag.nodeId) {
      const pn = simNodeMap.get(drag.nodeId);
      if (pn) {
        pn.pinned = false;
        // Give it a little velocity from the last drag direction for bouncy feel
        // (velocity is already being set by the spring in the simulation)
      }
      drag.nodeId = null;
    }
    panDragRef.current.active = false;
  }, [simNodeMap]);

  /* ── Wheel zoom ── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
    const svg = svgRef.current;
    if (!svg || nextZoom === zoom) return;
    const rect = svg.getBoundingClientRect();
    const screenX = (e.clientX - rect.left) * (SVG_W / rect.width);
    const screenY = (e.clientY - rect.top) * (SVG_H / rect.height);
    const worldX = (screenX - panX) / zoom;
    const worldY = (screenY - panY) / zoom;
    setPanX(screenX - worldX * nextZoom);
    setPanY(screenY - worldY * nextZoom);
    setZoom(nextZoom);
  }, [panX, panY, zoom]);

  /* ── Node click (select) ── */
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      return;
    }
    if (e.key !== 'Enter') return;
    const match = filteredNodes.find((node) => searchMatchIds.has(node.id));
    if (!match) return;
    setSelectedNode(match);
    centerNodeById(match.id);
  }, [centerNodeById, filteredNodes, searchMatchIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectedNode(null);
      setOptionsOpen(false);
      setLegendOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleOpenFromDetail = useCallback((node: GraphNode) => {
    if ((node.type === 'note' || node.type === 'gameDoc') && node.relativePath) {
      onOpenFile(node.relativePath);
    } else if (node.type === 'tag') {
      const tagName = node.label.startsWith('#') ? node.label.substring(1) : node.label;
      onTagClick(tagName);
    } else if (node.type === 'missing') {
      onCreateMissingNote(node.label);
    }
  }, [onOpenFile, onTagClick, onCreateMissingNote]);

  /* ── Lookup node metadata from vault index ── */
  const getNodeMetadata = useCallback((node: GraphNode): { tags: string[]; status?: string; priority?: string; owner?: string } => {
    if (!vaultIndex || (node.type !== 'note' && node.type !== 'gameDoc') || !node.relativePath) {
      return { tags: [] };
    }
    const entry = vaultIndex.notes[node.relativePath];
    if (!entry) return { tags: [] };
    return {
      tags: entry.tags || [],
      status: entry.metadata?.status,
      priority: entry.metadata?.priority,
      owner: entry.metadata?.owner,
    };
  }, [vaultIndex]);

  /* ── Empty state ── */
  if (graphData.nodes.length === 0) {
    return (
      <div className="graph-panel graph-panel-v2">
        <div className="graph-empty-state">
          <div className="graph-empty-icon">{'◎'}</div>
          <div className="graph-empty-title">{t.graphEmptyTitle || 'No graph data yet'}</div>
          <div className="graph-empty-desc">{t.graphEmptyDesc || 'Create notes with [[wiki-links]] and #tags to build your knowledge graph.'}</div>
          <div className="graph-empty-tips">
            <div className="graph-empty-tip">{'• Use [[note-name]] to link notes together'}</div>
            <div className="graph-empty-tip">{'• Add #tags to organize your notes'}</div>
            <div className="graph-empty-tip">{'• The graph updates automatically as you write'}</div>
          </div>
        </div>
      </div>
    );
  }

  const legendItems = [
    { color: NODE_COLORS.note, label: t.noteNodes || 'Notes' },
    { color: NODE_COLORS.tag, label: t.tagNodes || 'Tags' },
    { color: NODE_COLORS.missing, label: t.missingNodes || 'Missing' },
    { color: NODE_COLORS.gdd, label: t.gdd || 'GDD' },
    { color: NODE_COLORS.character, label: t.character || 'Character' },
    { color: NODE_COLORS.item, label: t.item || 'Item' },
    { color: NODE_COLORS.quest, label: t.quest || 'Quest' },
    { color: NODE_COLORS.unityTask, label: t.unityTask || 'Unity Task' },
    { color: NODE_COLORS.devlog, label: t.devlog || 'Devlog' },
  ];

  const typeLabel = (type: string): string => {
    switch (type) {
      case 'note': return t.note || 'Note';
      case 'tag': return t.tag || 'Tag';
      case 'missing': return t.missing || 'Missing';
      case 'gameDoc': return t.gameDoc || 'Game Doc';
      default: return type;
    }
  };

  const viewBox = `${-panX / zoom} ${-panY / zoom} ${SVG_W / zoom} ${SVG_H / zoom}`;

  const nodes = physicsRef.current;
  const isNodeDrag = dragRef.current.nodeId !== null;
  const isPanDrag = panDragRef.current.active;

  return (
    <div className="graph-panel graph-panel-v2">
      <div className="graph-toolbar-v2 graph-toolbar-v3">
        <div className="graph-toolbar-row">
          <div className="graph-mode-toggle">
            <button className={'graph-mode-btn' + (graphMode === 'global' ? ' active' : '')} onClick={() => setGraphMode('global')}>
              {t.globalGraph || 'Global'}
            </button>
            <button className={'graph-mode-btn' + (graphMode === 'local' ? ' active' : '')} onClick={() => setGraphMode('local')} disabled={!localRootNodeId}>
              {t.localGraph || 'Local'}
            </button>
          </div>
          {graphMode === 'local' && localRootNode && (
            <div className="graph-depth-toggle" aria-label="Local graph depth">
              <span className="graph-depth-label" title={localRootNode.label}>深度</span>
              {[1, 2, 3].map((depth) => (
                <button
                  key={depth}
                  className={'graph-depth-btn' + (localDepth === depth ? ' active' : '')}
                  onClick={() => setLocalDepth(depth as LocalDepth)}
                  title={`Show nodes ${depth} link${depth > 1 ? 's' : ''} away from the current note`}
                >
                  {depth}
                </button>
              ))}
            </div>
          )}
          <div className="graph-control-buttons">
            <button className="graph-ctrl-btn" onClick={handleZoomIn} title={t.zoomIn || 'Zoom In'}>+</button>
            <button className="graph-ctrl-btn" onClick={handleZoomOut} title={t.zoomOut || 'Zoom Out'}>{'−'}</button>
            <button className="graph-ctrl-btn" onClick={handleResetView} title={t.resetView || 'Reset'}>{'↺'}</button>
            <button className="graph-ctrl-btn" onClick={handleFitToView} title={t.fitToView || 'Fit'}><MaximizeIcon size={14} /></button>
            {currentFilePath && (
              <button className="graph-ctrl-btn" onClick={handleCenterCurrentNote} title={t.centerCurrentNote || '定位当前笔记'} aria-label="定位当前笔记"><LocateIcon size={14} /></button>
            )}
            <button
              className={'graph-ctrl-btn graph-physics-toggle' + (physicsPaused ? ' active' : '')}
              onClick={handleTogglePhysics}
              title={physicsPaused ? '继续自动布局' : '暂停自动布局'}
              aria-label={physicsPaused ? '继续自动布局' : '暂停自动布局'}
            >
              {physicsPaused ? '▶' : 'Ⅱ'}
            </button>
            <button className={'graph-ctrl-btn' + (optionsOpen ? ' active' : '')} onClick={() => setOptionsOpen((open) => !open)} title="图谱选项" aria-label="图谱选项">
              <SettingsIcon size={14} />
            </button>
          </div>
        </div>
        <div className="graph-search-shell">
          <SearchIcon size={14} />
          <input className="graph-search-input" type="text" placeholder="搜索节点，Enter 定位" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={handleSearchKeyDown} />
          {searchQuery && <span className="graph-search-count">{searchMatchIds.size}</span>}
          {searchQuery && <button className="graph-search-clear" onClick={() => setSearchQuery('')} title="清除搜索" aria-label="清除图谱搜索"><CloseIcon size={12} /></button>}
        </div>
        {optionsOpen && <div className="graph-filters graph-options-popover">
          <label className="graph-filter-toggle"><input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} /><span>{t.showNotes || 'Notes'}</span></label>
          <label className="graph-filter-toggle"><input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} /><span>{t.showTags || 'Tags'}</span></label>
          <label className="graph-filter-toggle"><input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} /><span>{t.filterMissingNotes || 'Missing'}</span></label>
          <label className="graph-filter-toggle"><input type="checkbox" checked={showGameDocs} onChange={(e) => setShowGameDocs(e.target.checked)} /><span>{t.showGameDocs || 'Game Docs'}</span></label>
          <label className="graph-filter-toggle"><input type="checkbox" checked={showGameDocsOnly} onChange={(e) => setShowGameDocsOnly(e.target.checked)} /><span>{t.showGameDocsOnly || 'Game Docs Only'}</span></label>
          <label className="graph-filter-toggle"><input type="checkbox" checked={showIsolated} onChange={(e) => setShowIsolated(e.target.checked)} /><span>{t.showIsolatedNodes || 'Isolated'}</span></label>
          <label className="graph-filter-toggle"><input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} /><span>{t.showEdges || 'Edges'}</span></label>
          <div className="graph-force-controls">
            <label><span>节点斥力 <b>{repulsionScale.toFixed(1)}×</b></span><input type="range" min="0.5" max="2.2" step="0.1" value={repulsionScale} onChange={(e) => setRepulsionScale(Number(e.target.value))} /></label>
            <label><span>连接距离 <b>{linkDistance}</b></span><input type="range" min="70" max="200" step="5" value={linkDistance} onChange={(e) => setLinkDistance(Number(e.target.value))} /></label>
          </div>
        </div>}
      </div>
      <div className="graph-stats-bar">
        <span className="graph-stat-chip">{filteredNodes.length}/{graphSummary.totalNodes} nodes</span>
        <span className="graph-stat-chip">{filteredEdges.length} edges</span>
        {graphMode === 'local' && localRootNode && <span className="graph-stat-chip local-depth-chip">{localRootNode.label} · 深度 {localDepth}</span>}
        {graphSummary.gameDocNodes > 0 && <span className="graph-stat-chip game-doc-chip">{graphSummary.gameDocNodes} game docs</span>}
        {isLarge && <span className="graph-stat-chip warning-chip">{t.graphLarge || 'Large graph — showing first ' + MAX_RENDER_NODES}</span>}
        <span className="graph-stat-chip zoom-chip">{Math.round(zoom * 100)}%</span>
        <span className={'graph-stat-chip physics-chip ' + (physicsPaused ? 'paused' : 'running')}>{physicsPaused ? '已稳定' : '物理中'}</span>
      </div>
      <div className="graph-canvas-v2">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={viewBox}
          xmlns="http://www.w3.org/2000/svg"
          className="graph-svg-v2"
          onMouseDown={handleBgMouseDown}
          onMouseMove={handleGlobalMouseMove}
          onMouseUp={handleGlobalMouseUp}
          onMouseLeave={handleGlobalMouseUp}
          onWheel={handleWheel}
          onClick={() => setSelectedNode(null)}
          style={{ cursor: isNodeDrag ? 'grabbing' : isPanDrag ? 'grabbing' : 'grab' }}
        >
          {/* ── SVG Defs: Arrow markers ── */}
          <defs>
            <marker id="arrow-wiki" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,3 L0,6 Z" fill="rgba(47,140,255,0.6)" />
            </marker>
            <marker id="arrow-wiki-hover" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,3 L0,6 Z" fill="rgba(47,140,255,0.9)" />
            </marker>
            <marker id="arrow-tag" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,3 L0,6 Z" fill="rgba(74,222,128,0.6)" />
            </marker>
            <marker id="arrow-tag-hover" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,3 L0,6 Z" fill="rgba(74,222,128,0.9)" />
            </marker>
            <marker id="arrow-start-wiki" viewBox="0 0 10 6" refX="0" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M10,0 L0,3 L10,6 Z" fill="rgba(47,140,255,0.6)" />
            </marker>
            <marker id="arrow-start-wiki-hover" viewBox="0 0 10 6" refX="0" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M10,0 L0,3 L10,6 Z" fill="rgba(47,140,255,0.9)" />
            </marker>
            <marker id="arrow-start-tag" viewBox="0 0 10 6" refX="0" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M10,0 L0,3 L10,6 Z" fill="rgba(74,222,128,0.6)" />
            </marker>
            <marker id="arrow-start-tag-hover" viewBox="0 0 10 6" refX="0" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M10,0 L0,3 L10,6 Z" fill="rgba(74,222,128,0.9)" />
            </marker>
          </defs>
          {/* ── Edges: smooth curves ── */}
          {showEdges && filteredEdges.map((edge) => {
            const src = simNodeMap.get(edge.source);
            const tgt = simNodeMap.get(edge.target);
            if (!src || !tgt) return null;
            const hl = focusNodeId === edge.source || focusNodeId === edge.target;
            const searchRelated = !searchQuery.trim() || searchMatchIds.has(edge.source) || searchMatchIds.has(edge.target);
            const edgeOpacity = searchQuery.trim()
              ? (searchRelated ? 0.9 : 0.06)
              : focusNodeId
                ? (hl ? 1 : 0.08)
                : 1;
            const isBidi = bidirectionalSet.has(edge.source + '→' + edge.target);
            const isTag = edge.type === 'tag';
            const baseStroke = isTag
              ? (hl ? 'rgba(74,222,128,0.6)' : 'rgba(74,222,128,0.12)')
              : (hl ? 'rgba(47,140,255,0.5)' : 'rgba(47,140,255,0.1)');

            const dx = tgt.x - src.x;
            const dy = tgt.y - src.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const srcR = nodeRadius(src.node) + 3;
            const tgtR = nodeRadius(tgt.node) + 3;
            const x1 = src.x + dx * (srcR / Math.max(dist, 1));
            const y1 = src.y + dy * (srcR / Math.max(dist, 1));
            const x2 = tgt.x - dx * (tgtR / Math.max(dist, 1));
            const y2 = tgt.y - dy * (tgtR / Math.max(dist, 1));

            // Bezier curve control point — subtle bend for visual softness
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            // Offset perpendicular to the edge for a gentle curve
            const perpX = -(y2 - y1) * 0.06;
            const perpY = (x2 - x1) * 0.06;
            const cx1 = midX + perpX;
            const cy1 = midY + perpY;
            const pathD = `M${x1},${y1} Q${cx1},${cy1} ${x2},${y2}`;

            const markerEnd = isTag
              ? (hl ? 'url(#arrow-tag-hover)' : 'url(#arrow-tag)')
              : (hl ? 'url(#arrow-wiki-hover)' : 'url(#arrow-wiki)');
            const markerStart = isBidi
              ? (isTag
                ? (hl ? 'url(#arrow-start-tag-hover)' : 'url(#arrow-start-tag)')
                : (hl ? 'url(#arrow-start-wiki-hover)' : 'url(#arrow-start-wiki)'))
              : undefined;

            return (
              <path key={edge.id} d={pathD}
                className={'graph-edge-v2 ' + (isTag ? 'edge-tag' : 'edge-wiki') + (isBidi ? ' edge-bidi' : '') + (hl ? ' edge-hover' : '')}
                stroke={baseStroke}
                strokeWidth={hl ? 1.5 : 0.8}
                fill="none"
                markerEnd={markerEnd}
                markerStart={markerStart}
                opacity={edgeOpacity}
              />
            );
          })}
          {/* ── Nodes (draggable) ── */}
          {nodes.map((pn) => {
            const r = nodeRadius(pn.node);
            const fill = nodeColor(pn.node);
            const isHov = hoveredNode === pn.node.id;
            const isSel = selectedNode?.id === pn.node.id;
            const isMiss = pn.node.type === 'missing';
            const isGD = pn.node.type === 'gameDoc';
            const searchActive = Boolean(searchQuery.trim());
            const searchMatch = searchMatchIds.has(pn.node.id);
            const inFocusNeighborhood = !focusNodeId || focusNeighborhood.has(pn.node.id);
            const nodeOpacity = searchActive
              ? (searchMatch ? 1 : 0.1)
              : focusNodeId
                ? (pn.node.id === focusNodeId ? 1 : inFocusNeighborhood ? 0.72 : 0.1)
                : 1;
            return (
              <g key={pn.node.id}
                className={'graph-node-g ' + pn.node.type + (isHov ? ' hovered' : '') + (isSel ? ' selected' : '')}
                onClick={(e) => { e.stopPropagation(); handleNodeClick(pn.node); }}
                onDoubleClick={(e) => { e.stopPropagation(); handleOpenFromDetail(pn.node); }}
                onMouseDown={(e) => handleNodeMouseDown(e, pn.node.id)}
                onMouseEnter={() => setHoveredNode(pn.node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'pointer', opacity: nodeOpacity }}
              >
                {(isHov || isSel) && <circle cx={pn.x} cy={pn.y} r={r + 8} fill={fill} opacity={0.15} />}
                <circle cx={pn.x} cy={pn.y} r={r} fill={fill} opacity={isMiss ? 0.5 : 0.9} stroke={isSel ? '#fff' : isHov ? '#ddd' : fill} strokeWidth={isSel ? 2.5 : isHov ? 2 : 1} />
                {isMiss && <circle cx={pn.x} cy={pn.y} r={r + 3} fill="none" stroke={fill} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />}
                {isGD && pn.node.gameDocType && <circle cx={pn.x} cy={pn.y} r={r + 3} fill="none" stroke={fill} strokeWidth={1.5} opacity={0.4} />}
                <text x={pn.x} y={pn.y - r - 5} textAnchor="middle" className="graph-label-v2" fill={isHov || isSel ? '#fff' : fill} fontSize={isHov || isSel ? 11 : 9} fontWeight={isGD ? 600 : 400}>
                  {truncateLabel(pn.node.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="graph-legend-wrap">
        <button className={'graph-legend-toggle' + (legendOpen ? ' active' : '')} onClick={() => setLegendOpen((open) => !open)}>图例</button>
        {legendOpen && <div className="graph-legend-v2">
          {legendItems.map((item) => (
            <div key={item.label} className="graph-legend-item-v2">
              <span className="graph-legend-dot-v2" style={{ background: item.color }} />
              <span className="graph-legend-label">{item.label}</span>
            </div>
          ))}
        </div>}
      </div>

      {/* ── Node Detail Panel ── */}
      {selectedNode && (
        <div className="graph-detail-panel">
          <div className="graph-detail-header">
            <span className="graph-detail-title">{selectedNode.label}</span>
            <button className="graph-detail-close" onClick={() => setSelectedNode(null)}>{'✕'}</button>
          </div>
          <div className="graph-detail-body">
            <div className="graph-detail-row">
              <span className="graph-detail-label">{t.nodeType || 'Type'}</span>
              <span className={'graph-detail-value node-type-badge ' + selectedNode.type}>{typeLabel(selectedNode.type)}</span>
            </div>
            {selectedNode.gameDocType && (
              <div className="graph-detail-row">
                <span className="graph-detail-label">{t.gameDocType || 'Doc Type'}</span>
                <span className="graph-detail-value">{selectedNode.gameDocType}</span>
              </div>
            )}
            {selectedNode.relativePath && (
              <div className="graph-detail-row">
                <span className="graph-detail-label">{t.filePath || 'Path'}</span>
                <span className="graph-detail-value graph-detail-path">{selectedNode.relativePath}</span>
              </div>
            )}
            <div className="graph-detail-row">
              <span className="graph-detail-label">{t.linkCount || 'Links'}</span>
              <span className="graph-detail-value">{selectedNode.linkCount}</span>
            </div>
            <div className="graph-detail-row">
              <span className="graph-detail-label">{t.tagCount || 'Tags'}</span>
              <span className="graph-detail-value">{selectedNode.tagCount}</span>
            </div>
            {(() => {
              const meta = getNodeMetadata(selectedNode);
              return (
                <>
                  {meta.tags.length > 0 && (
                    <div className="graph-detail-row graph-detail-tags">
                      <span className="graph-detail-label">{t.tags || 'Tags'}</span>
                      <div className="graph-detail-tag-list">
                        {meta.tags.map((tag) => (
                          <span key={tag} className="graph-detail-tag" onClick={() => onTagClick(tag)}>#{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {meta.status && (
                    <div className="graph-detail-row">
                      <span className="graph-detail-label">{t.status || 'Status'}</span>
                      <span className="graph-detail-value">{meta.status}</span>
                    </div>
                  )}
                  {meta.priority && (
                    <div className="graph-detail-row">
                      <span className="graph-detail-label">{t.priority || 'Priority'}</span>
                      <span className="graph-detail-value">{meta.priority}</span>
                    </div>
                  )}
                  {meta.owner && (
                    <div className="graph-detail-row">
                      <span className="graph-detail-label">{t.owner || 'Owner'}</span>
                      <span className="graph-detail-value">{meta.owner}</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          <div className="graph-detail-actions">
            {(selectedNode.type === 'note' || selectedNode.type === 'gameDoc') && selectedNode.relativePath && (
              <button className="graph-detail-btn primary" onClick={() => handleOpenFromDetail(selectedNode)}>
                {t.openNote || 'Open Note'}
              </button>
            )}
            {selectedNode.type === 'missing' && (
              <button className="graph-detail-btn primary" onClick={() => handleOpenFromDetail(selectedNode)}>
                {t.createMissingNote || 'Create Missing Note'}
              </button>
            )}
            {selectedNode.type === 'tag' && (
              <button className="graph-detail-btn primary" onClick={() => handleOpenFromDetail(selectedNode)}>
                {t.openTagNotes || 'Show Notes with Tag'}
              </button>
            )}
            <button className="graph-detail-btn" onClick={() => handleUseAsLocalRoot(selectedNode)}>
              以此为中心
            </button>
            <button className="graph-detail-btn" onClick={() => setSelectedNode(null)}>
              {t.close || 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GraphView;
