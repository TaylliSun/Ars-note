/* ── Graph data builder for vault knowledge graph ── */
/* v0.3.4 — Data prep for future Graph View (no visualization) */

import type { VaultIndex, GraphNode, GraphEdge, GraphData, GraphSummary } from '../types';
import { classifyEntry } from './gameWorkspaceScanner';

/**
 * Build graph data from the vault index.
 *
 * Nodes:
 * - One node per note (type: 'note')
 * - One node per unique tag across all notes (type: 'tag')
 * - One node per missing wiki-link target that resolves to nothing (type: 'missing')
 *
 * Edges:
 * - note → note: wiki edge (resolved wiki-links)
 * - note → missing: wiki edge (unresolved wiki-links)
 * - note → tag: tag edge (tags used in a note)
 *
 * Ambiguous wiki-links are skipped with a TODO for future handling.
 * Duplicate edges are deduplicated.
 */
export function buildGraphData(index: VaultIndex): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  /* ── Helper: add node if not already present ── */
  function addNode(node: GraphNode): void {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  }

  /* ── Helper: add edge if not already present ── */
  function addEdge(edge: GraphEdge): void {
    if (!edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  }

  /* ── Build name-based lookup for wiki-link resolution ── */
  const nameToRelPaths = new Map<string, string[]>();
  const titleToRelPaths = new Map<string, string[]>();
  const pathLookup = new Map<string, string>();
  for (const [relPath, entry] of Object.entries(index.notes)) {
    const base = entry.fileName.replace(/\.md$/i, '').toLowerCase();
    if (!nameToRelPaths.has(base)) nameToRelPaths.set(base, []);
    nameToRelPaths.get(base)!.push(relPath);
    const title = entry.title.trim().toLowerCase();
    if (title) {
      if (!titleToRelPaths.has(title)) titleToRelPaths.set(title, []);
      titleToRelPaths.get(title)!.push(relPath);
    }
    pathLookup.set(relPath.replace(/\.md$/i, '').toLowerCase(), relPath);
  }

  /* ── Helper: resolve a wiki-link target within this builder ── */
  function resolveTarget(target: string): { resolved: string | null; ambiguous: boolean; matches: string[] } {
    const norm = target.replace(/\\/g, '/');

    /* Path-based */
    if (norm.includes('/')) {
      const byPath = pathLookup.get(norm.replace(/\.md$/i, '').toLowerCase());
      if (byPath) return { resolved: byPath, ambiguous: false, matches: [byPath] };
      const lastSeg = norm.split('/').pop()?.replace(/\.md$/i, '').toLowerCase() ?? '';
      if (lastSeg) {
        const matches = nameToRelPaths.get(lastSeg);
        if (matches?.length === 1) return { resolved: matches[0], ambiguous: false, matches: [...matches] };
        if (matches && matches.length > 1) return { resolved: null, ambiguous: true, matches: [...matches] };
      }
      return { resolved: null, ambiguous: false, matches: [] };
    }

    /* Name-based */
    const lower = norm.replace(/\.md$/i, '').toLowerCase();
    const matches = nameToRelPaths.get(lower);
    if (matches?.length === 1) return { resolved: matches[0], ambiguous: false, matches: [...matches] };
    if (matches && matches.length > 1) return { resolved: null, ambiguous: true, matches: [...matches] };

    /* Title-based */
    const titleMatches = titleToRelPaths.get(lower) || [];
    if (titleMatches.length === 1) return { resolved: titleMatches[0], ambiguous: false, matches: [...titleMatches] };
    if (titleMatches.length > 1) return { resolved: null, ambiguous: true, matches: [...titleMatches] };

    return { resolved: null, ambiguous: false, matches: [] };
  }

  /* ── Phase 1: Create note nodes ── */
  const noteNeighbors = new Map<string, Set<string>>();
  const addConnection = (from: string, to: string) => {
    if (!noteNeighbors.has(from)) noteNeighbors.set(from, new Set());
    noteNeighbors.get(from)!.add(to);
  };
  for (const [relPath, entry] of Object.entries(index.notes)) {
    for (const linkTarget of entry.wikiLinks) {
      const resolution = resolveTarget(linkTarget);
      const targets = resolution.resolved ? [resolution.resolved] : resolution.matches;
      if (targets.length === 0) {
        addConnection(relPath, `missing:${linkTarget.replace(/\\/g, '/')}`);
        continue;
      }
      for (const targetPath of targets) {
        addConnection(relPath, targetPath);
        addConnection(targetPath, relPath);
      }
    }
  }

  for (const [relPath, entry] of Object.entries(index.notes)) {
    const nodeId = `note:${relPath}`;
    addNode({
      id: nodeId,
      label: entry.title || entry.fileName.replace(/\.md$/i, ''),
      relativePath: relPath,
      type: 'note',
      linkCount: noteNeighbors.get(relPath)?.size || 0,
      tagCount: entry.tags.length,
    });
  }

  /* ── Phase 2: Create tag nodes and tag edges ── */
  for (const [relPath, entry] of Object.entries(index.notes)) {
    const sourceId = `note:${relPath}`;
    for (const tag of entry.tags) {
      const tagId = `tag:${tag}`;
      addNode({
        id: tagId,
        label: `#${tag}`,
        relativePath: '',
        type: 'tag',
        linkCount: 0,
        tagCount: 0,
      });
      const edgeId = `tag:${relPath}->${tag}`;
      addEdge({
        id: edgeId,
        source: sourceId,
        target: tagId,
        type: 'tag',
      });
    }
  }

  /* ── Phase 3: Create wiki edges and missing nodes ── */
  for (const [relPath, entry] of Object.entries(index.notes)) {
    const sourceId = `note:${relPath}`;
    for (const linkTarget of entry.wikiLinks) {
      const { resolved, ambiguous, matches } = resolveTarget(linkTarget);

      if (ambiguous) {
        /* Create edges to all matches */
        for (const matchPath of matches) {
          const targetId = `note:${matchPath}`;
          const edgeId = `wiki:ambig:${relPath}->${matchPath}`;
          addEdge({
            id: edgeId,
            source: sourceId,
            target: targetId,
            type: 'wiki',
            label: linkTarget + ' (ambiguous)',
          });
        }
        continue;
      }

      if (resolved) {
        /* note → note edge */
        const targetId = `note:${resolved}`;
        const edgeId = `wiki:${relPath}->${resolved}`;
        addEdge({
          id: edgeId,
          source: sourceId,
          target: targetId,
          type: 'wiki',
          label: linkTarget,
        });
      } else {
        /* note → missing edge */
        const missingId = `missing:${linkTarget.replace(/\\/g, '/')}`;
        addNode({
          id: missingId,
          label: linkTarget,
          relativePath: '',
          type: 'missing',
          linkCount: 0,
          tagCount: 0,
        });
        const edgeId = `wiki:${relPath}->missing:${linkTarget.replace(/\\/g, '/')}`;
        addEdge({
          id: edgeId,
          source: sourceId,
          target: missingId,
          type: 'wiki',
          label: linkTarget,
        });
      }
    }
  }

  /* ── Phase 4: Upgrade note nodes to gameDoc nodes where applicable ── */
  const GAME_DOC_COLORS: Record<string, string> = {
    gdd: '#f9e2af',
    character: '#f5c2e7',
    item: '#94e2d5',
    quest: '#89b4fa',
    unityTask: '#a6e3a1',
    devlog: '#fab387',
  };
  for (const node of nodes) {
    if (node.type !== 'note') continue;
    const docType = classifyEntry(node.relativePath, node.label);
    if (docType) {
      node.type = 'gameDoc';
      node.gameDocType = docType;
    }
  }

  return { nodes, edges };
}

/**
 * Compute summary statistics from GraphData.
 */
export function computeGraphSummary(data: GraphData): GraphSummary {
  let noteNodes = 0;
  let tagNodes = 0;
  let missingNodes = 0;
  let gameDocNodes = 0;
  const gameDocByType: Record<string, number> = {};
  for (const node of data.nodes) {
    if (node.type === 'note') noteNodes++;
    else if (node.type === 'tag') tagNodes++;
    else if (node.type === 'missing') missingNodes++;
    else if (node.type === 'gameDoc') {
      gameDocNodes++;
      const dt = node.gameDocType || 'unknown';
      gameDocByType[dt] = (gameDocByType[dt] || 0) + 1;
    }
  }
  return {
    totalNodes: data.nodes.length,
    totalEdges: data.edges.length,
    noteNodes,
    tagNodes,
    missingNodes,
    gameDocNodes,
    gameDocByType,
  };
}
