import * as fs from 'fs';
import * as path from 'path';

export interface VaultFileEntry {
  relPath: string;
  fullPath: string;
  title: string;
  tags: string[];
  content: string;
  searchContent: string;
}

export interface VaultScanResult {
  indexText: string;
  fileEntries: VaultFileEntry[];
  stats: {
    readCount: number;
    reusedCount: number;
  };
}

interface CachedVaultFile {
  mtimeMs: number;
  size: number;
  entry: VaultFileEntry;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '__pycache__', '.ars-note', '.ai-memory']);
const MAX_CACHED_VAULTS = 4;
const vaultScanCache = new Map<string, Map<string, CachedVaultFile>>();

function buildFileEntry(relPath: string, fullPath: string, raw: string): VaultFileEntry {
  const h1Match = raw.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : path.basename(relPath, '.md');
  const tags = [...new Set(raw.match(/(?:^|\s)#[a-zA-Z0-9_\u4e00-\u9fff][\w\u4e00-\u9fff-]*/g) || [])]
    .map((tag) => tag.trim())
    .slice(0, 5);
  return {
    relPath,
    fullPath,
    title,
    tags,
    content: raw,
    searchContent: raw.toLowerCase(),
  };
}

function updateVaultCache(resolvedVault: string, files: Map<string, CachedVaultFile>): void {
  vaultScanCache.delete(resolvedVault);
  vaultScanCache.set(resolvedVault, files);
  while (vaultScanCache.size > MAX_CACHED_VAULTS) {
    const oldest = vaultScanCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    vaultScanCache.delete(oldest);
  }
}

export async function scanAndIndexVault(vaultPath: string): Promise<VaultScanResult> {
  const resolvedVault = path.resolve(vaultPath);
  const previous = vaultScanCache.get(resolvedVault) || new Map<string, CachedVaultFile>();
  const next = new Map<string, CachedVaultFile>();
  const fileEntries: VaultFileEntry[] = [];
  let readCount = 0;
  let reusedCount = 0;

  async function walk(directory: string, prefix: string): Promise<void> {
    let items: fs.Dirent[];
    try {
      items = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((left, right) => left.name.localeCompare(right.name));

    for (const item of items) {
      if (SKIP_DIRS.has(item.name) || item.name.startsWith('.')) continue;
      const fullPath = path.join(directory, item.name);
      const relPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        await walk(fullPath, relPath);
        continue;
      }
      if (!item.isFile() || !item.name.toLowerCase().endsWith('.md')) continue;

      try {
        const stat = await fs.promises.stat(fullPath);
        const cached = previous.get(relPath);
        let entry: VaultFileEntry;
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          entry = cached.entry;
          reusedCount += 1;
        } else {
          const raw = await fs.promises.readFile(fullPath, 'utf-8');
          entry = buildFileEntry(relPath, fullPath, raw);
          readCount += 1;
        }
        next.set(relPath, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
        fileEntries.push(entry);
      } catch {
        // Ignore files that disappear or become unreadable during the scan.
      }
    }
  }

  await walk(resolvedVault, '');
  updateVaultCache(resolvedVault, next);

  const indexLines = fileEntries.map((entry) => {
    const tagText = entry.tags.length > 0 ? ` ${entry.tags.join(' ')}` : '';
    return `${entry.relPath} \u2014 "${entry.title.slice(0, 60)}"${tagText}`;
  });
  let indexText = '';
  if (indexLines.length > 0) {
    const capped = indexLines.slice(0, 200);
    indexText = `=== VAULT FILE INDEX (${capped.length} files) ===\n`;
    indexText += 'Use read_file(path) to read any file listed below.\n';
    indexText += capped.join('\n');
    if (indexLines.length > 200) indexText += `\n... and ${indexLines.length - 200} more files`;
  }

  return { indexText, fileEntries, stats: { readCount, reusedCount } };
}

export function clearAIVaultScanCache(vaultPath?: string): void {
  if (vaultPath) {
    vaultScanCache.delete(path.resolve(vaultPath));
    return;
  }
  vaultScanCache.clear();
}
