import { scanAndIndexVault, type VaultFileEntry } from './aiVaultScanner';

function parseTags(lines: string[]): string[] {
  const tags = new Set<string>();
  const tagRegex = /(?:^|\s)#([a-zA-Z0-9_\-/]+)/g;
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || /^\s{0,3}#{1,6}\s/.test(line)) continue;
    const stripped = line.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
    tagRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(stripped)) !== null) {
      if (match[1]) tags.add(match[1].toLowerCase());
    }
  }
  return [...tags];
}

function parseWikiLinks(lines: string[]): string[] {
  const links = new Set<string>();
  const wikiRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const stripped = line.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
    wikiRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = wikiRegex.exec(stripped)) !== null) {
      const target = match[1].split('#')[0].trim();
      if (target) links.add(target);
    }
  }
  return [...links];
}

function parseMetadata(lines: string[]): Record<string, string> | undefined {
  const metadata: Record<string, string> = {};
  const patterns: Array<[RegExp, string]> = [
    [/^- \*\*Status\*\*:\s*(.+)$/i, 'status'],
    [/^- \*\*Priority\*\*:\s*(.+)$/i, 'priority'],
    [/^- \*\*(?:Owner|Assignee)\*\*:\s*(.+)$/i, 'owner'],
    [/^- \*\*Updated\*\*:\s*(.+)$/i, 'updatedAt'],
    [/^- \*\*Summary\*\*:\s*(.+)$/i, 'summary'],
    [/^Status:\s*(.+)$/i, 'status'],
    [/^Priority:\s*(.+)$/i, 'priority'],
    [/^(?:Owner|Assignee):\s*(.+)$/i, 'owner'],
    [/^Updated:\s*(.+)$/i, 'updatedAt'],
    [/^Summary:\s*(.+)$/i, 'summary'],
    [/^状态[：:]\s*(.+)$/, 'status'],
    [/^优先级[：:]\s*(.+)$/, 'priority'],
    [/^负责人[：:]\s*(.+)$/, 'owner'],
    [/^更新[：:]\s*(.+)$/, 'updatedAt'],
    [/^摘要[：:]\s*(.+)$/, 'summary'],
  ];

  for (const line of lines) {
    for (const [pattern, key] of patterns) {
      if (metadata[key]) continue;
      const match = line.match(pattern);
      if (match?.[1]) metadata[key] = match[1].trim();
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function toIndexedNote(entry: VaultFileEntry): any {
  const lines = entry.content.split('\n');
  return {
    filePath: entry.fullPath,
    relativePath: entry.relPath,
    fileName: entry.relPath.split('/').pop() || entry.relPath,
    title: entry.title,
    tags: parseTags(lines),
    wikiLinks: parseWikiLinks(lines),
    metadata: parseMetadata(lines),
  };
}

export async function scanVaultIndex(vaultPath: string): Promise<any> {
  const scan = await scanAndIndexVault(vaultPath);
  const notes: Record<string, any> = {};
  for (const entry of scan.fileEntries) notes[entry.relPath] = toIndexedNote(entry);
  return {
    notes,
    updatedAt: new Date().toISOString(),
    scanStats: scan.stats,
  };
}
