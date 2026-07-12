/* ── Markdown tag & wiki-link parsing utilities ── */

import type { ParsedTag, WikiLink, NoteIndexEntry, VaultIndex, BacklinkEntry } from '../types';

/* ── Tag Parsing ── */

/**
 * Parse #tags from markdown content.
 *
 * Rules:
 * - `#tag` — recognized (letters, digits, hyphens, underscores, forward slashes)
 * - `#game-design` — recognized
 * - `#worldbuilding/location` — recognized
 * - `# Heading` — NOT a tag (heading, space after #)
 * - `## Heading` — NOT a tag
 * - URL fragments like `https://example.com/page#section` — NOT a tag
 * - Inside code blocks ```...``` — NOT a tag
 * - Inside inline code `#tag` — NOT a tag
 */
export function parseTags(content: string): ParsedTag[] {
  const tags: ParsedTag[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* Track fenced code block state */
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    /* Skip heading lines: `# Title` or `## Title`, etc. */
    if (/^\s{0,3}#{1,6}\s/.test(line)) continue;

    /* Strip inline code segments — replace `...` with spaces to avoid false matches */
    const stripped = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));

    /* Find tags: preceded by start-of-line or whitespace, NOT preceded by / (URL fragment) */
    /* Regex: (?:^|(?<=\s))#([a-zA-Z0-9_\-\/]+) but JS doesn't support lookbehind everywhere */
    /* Use capture approach: find all #tag candidates */
    const tagRegex = /(?:^|\s)#([a-zA-Z0-9_\-\/]+)/g;
    let match: RegExpExecArray | null;
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(stripped)) !== null) {
      const name = match[1];
      if (name.length === 0) continue;
      tags.push({ name: name.toLowerCase(), line: i + 1 });
    }
  }
  return tags;
}

/* ── Wiki-Link Parsing ── */

/**
 * Parse [[wiki-links]] from markdown content.
 *
 * Supports:
 * - `[[Page Name]]`
 * - `[[Page Name|Alias]]`
 * - `[[Folder/Page Name]]`
 * - `[[Page Name#Heading]]` — heading stripped from target
 *
 * Does NOT parse inside fenced code blocks.
 */
export function parseWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* Track fenced code block state */
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    /* Strip inline code */
    const stripped = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));

    /* Match [[target]] or [[target|alias]] */
    const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(stripped)) !== null) {
      let target = match[1].trim();
      /* Strip heading anchor: [[Page#Heading]] -> Page */
      const hashIdx = target.indexOf('#');
      if (hashIdx > 0) {
        target = target.substring(0, hashIdx).trim();
      }
      if (target.length > 0) {
        links.push({ target, line: i + 1 });
      }
    }
  }
  return links;
}

/* ── Title extraction ── */

/**
 * Extract the first H1 heading from content, or fall back to fileName without extension.
 */
export function extractTitle(content: string, fileName: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) return h1Match[1].trim();
  }
  return fileName.replace(/\.md$/i, '');
}

/* ── Index entry builder ── */

/**
 * Build a NoteIndexEntry from file info and content.
 */
export function buildNoteEntry(
  filePath: string,
  relativePath: string,
  fileName: string,
  content: string,
): NoteIndexEntry {
  const tags = parseTags(content);
  const wikiLinks = parseWikiLinks(content);
  const uniqueTags = [...new Set(tags.map((t) => t.name))];
  const uniqueLinks = [...new Set(wikiLinks.map((l) => l.target))];

  return {
    filePath,
    relativePath,
    fileName,
    title: extractTitle(content, fileName),
    tags: uniqueTags,
    wikiLinks: uniqueLinks,
  };
}

/* ── Path utilities ── */

/**
 * Normalize a path to use forward slashes.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Given a wiki-link target, resolve it against the vault index.
 *
 * Matching strategies (in order):
 * 1. Path-based: `[[01_GDD/GDD]]` matches `01_GDD/GDD.md` by relativePath
 * 2. Name-based: `[[GDD]]` matches any file named `GDD.md` (case-insensitive)
 * 3. Name with .md: `[[GDD.md]]` matches `GDD.md`
 * 4. Title-based: `[[Game Design Document]]` matches a note with that H1 title
 *
 * Returns:
 * - `{ type: 'resolved', relativePaths: [string] }` — one or more matches
 * - `{ type: 'ambiguous', relativePaths: [string] }` — multiple name matches in different folders
 * - `{ type: 'missing' }` — no match found
 */
export type ResolveResult =
  | { type: 'resolved'; relativePath: string }
  | { type: 'ambiguous'; relativePaths: string[] }
  | { type: 'missing' };

export function resolveWikiLink(target: string, index: VaultIndex): ResolveResult {
  const normalizedTarget = target.replace(/\\/g, '/');

  /* 1. Path-based match: target contains `/` — try to match relativePath */
  if (normalizedTarget.includes('/')) {
    const candidates: string[] = [];
    for (const [relPath, entry] of Object.entries(index.notes)) {
      /* Match 01_GDD/GDD against 01_GDD/GDD.md */
      if (relPath === normalizedTarget || relPath === normalizedTarget + '.md') {
        return { type: 'resolved', relativePath: relPath };
      }
      /* Case-insensitive path match */
      if (relPath.toLowerCase() === normalizedTarget.toLowerCase()
        || relPath.toLowerCase() === normalizedTarget.toLowerCase() + '.md') {
        return { type: 'resolved', relativePath: relPath };
      }
    }
    /* No path match — fall through to name-based on the last segment */
    const lastSegment = normalizedTarget.split('/').pop() ?? '';
    if (lastSegment) {
      const nameResults = findByName(lastSegment, index);
      if (nameResults.length === 1) return { type: 'resolved', relativePath: nameResults[0] };
      if (nameResults.length > 1) return { type: 'ambiguous', relativePaths: nameResults };
    }
    return { type: 'missing' };
  }

  /* 2. Name-based match (no `/` in target) */
  const nameResults = findByName(normalizedTarget, index);
  if (nameResults.length === 1) return { type: 'resolved', relativePath: nameResults[0] };
  if (nameResults.length > 1) return { type: 'ambiguous', relativePaths: nameResults };

  /* 3. Title-based match */
  const lowerTarget = normalizedTarget.toLowerCase();
  const titleResults: string[] = [];
  for (const [relPath, entry] of Object.entries(index.notes)) {
    if (entry.title.toLowerCase() === lowerTarget) {
      titleResults.push(relPath);
    }
  }
  if (titleResults.length === 1) return { type: 'resolved', relativePath: titleResults[0] };
  if (titleResults.length > 1) return { type: 'ambiguous', relativePaths: titleResults };

  return { type: 'missing' };
}

/** Helper: find files by name (without path, without .md extension), case-insensitive */
function findByName(target: string, index: VaultIndex): string[] {
  const lowerTarget = target.toLowerCase().replace(/\.md$/i, '');
  const results: string[] = [];
  for (const [relPath, entry] of Object.entries(index.notes)) {
    const baseName = entry.fileName.replace(/\.md$/i, '').toLowerCase();
    if (baseName === lowerTarget) {
      results.push(relPath);
    }
  }
  return results;
}

/* ── Backlink / outgoing link finding ── */

/**
 * Find all backlinks pointing TO a given note.
 */
export function findBacklinksForNote(
  targetRelativePath: string,
  index: VaultIndex,
): BacklinkEntry[] {
  const results: BacklinkEntry[] = [];
  const normalizedTarget = normalizePath(targetRelativePath);

  for (const [relPath, entry] of Object.entries(index.notes)) {
    if (normalizePath(relPath) === normalizedTarget) continue;
    if (entry.wikiLinks.length === 0) continue;

    for (const linkTarget of entry.wikiLinks) {
      const resolved = resolveWikiLink(linkTarget, index);
      if (resolved.type === 'resolved' && resolved.relativePath === normalizedTarget) {
        results.push({
          filePath: entry.filePath,
          relativePath: entry.relativePath,
          fileName: entry.fileName,
          title: entry.title,
          line: 0,
          snippet: `[[${linkTarget}]]`,
        });
        break; /* One entry per source file */
      }
    }
  }
  return results;
}

/**
 * Find all outgoing links FROM a given note.
 * Resolves each wiki-link target to an actual file (or marks as missing/ambiguous).
 */
export function findOutgoingLinks(
  sourceRelativePath: string,
  index: VaultIndex,
): BacklinkEntry[] {
  const sourceEntry = index.notes[normalizePath(sourceRelativePath)];
  if (!sourceEntry || sourceEntry.wikiLinks.length === 0) return [];

  const results: BacklinkEntry[] = [];
  for (const linkTarget of sourceEntry.wikiLinks) {
    const resolved = resolveWikiLink(linkTarget, index);
    if (resolved.type === 'resolved') {
      const targetEntry = index.notes[resolved.relativePath];
      results.push({
        filePath: targetEntry.filePath,
        relativePath: targetEntry.relativePath,
        fileName: targetEntry.fileName,
        title: targetEntry.title,
        line: 0,
        snippet: '',
      });
    } else if (resolved.type === 'ambiguous') {
      /* For ambiguous links, show first match path but mark as ambiguous */
      const firstPath = resolved.relativePaths[0];
      const firstEntry = index.notes[firstPath];
      results.push({
        filePath: firstEntry.filePath,
        relativePath: firstEntry.relativePath,
        fileName: firstEntry.fileName,
        title: firstEntry.title,
        line: 0,
        snippet: `ambiguous:${resolved.relativePaths.length}`,
      });
    } else {
      results.push({
        filePath: '',
        relativePath: '',
        fileName: linkTarget,
        title: linkTarget,
        line: 0,
        snippet: '',
      });
    }
  }
  return results;
}
