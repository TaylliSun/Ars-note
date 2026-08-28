import * as fs from 'fs';
import * as path from 'path';

export interface VaultFileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: VaultFileTreeNode[];
}

interface VaultFileTreeCacheEntry {
  expiresAt: number;
  tree: VaultFileTreeNode[];
}

const CACHE_TTL_MS = 2_000;
const MAX_CACHED_VAULTS = 4;
const cache = new Map<string, VaultFileTreeCacheEntry>();
const inFlight = new Map<string, Promise<VaultFileTreeNode[]>>();

function updateCache(vaultPath: string, tree: VaultFileTreeNode[]): void {
  cache.delete(vaultPath);
  cache.set(vaultPath, { expiresAt: Date.now() + CACHE_TTL_MS, tree });
  while (cache.size > MAX_CACHED_VAULTS) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') break;
    cache.delete(oldest);
  }
}

export async function readVaultFileTree(
  vaultPath: string,
  skipDirs: ReadonlySet<string>,
  isConflictArtifactName: (name: string) => boolean,
  force = false,
): Promise<VaultFileTreeNode[]> {
  const resolvedVault = path.resolve(vaultPath);
  const cached = cache.get(resolvedVault);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.tree;

  const pending = inFlight.get(resolvedVault);
  if (pending) return pending;

  const operation = (async () => {
    async function readDirectory(directory: string): Promise<VaultFileTreeNode[]> {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch {
        return [];
      }

      entries.sort((left, right) => {
        if (left.isDirectory() && !right.isDirectory()) return -1;
        if (!left.isDirectory() && right.isDirectory()) return 1;
        return left.name.localeCompare(right.name);
      });

      const result: VaultFileTreeNode[] = [];
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        if (isConflictArtifactName(entry.name)) continue;
        if (entry.name.startsWith('.') || skipDirs.has(entry.name)) continue;

        const fullPath = path.join(directory, entry.name);
        const isDir = entry.isDirectory();
        result.push({
          name: entry.name,
          path: fullPath,
          isDir,
          children: isDir ? await readDirectory(fullPath) : [],
        });
      }
      return result;
    }

    const tree = await readDirectory(resolvedVault);
    updateCache(resolvedVault, tree);
    return tree;
  })();

  inFlight.set(resolvedVault, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(resolvedVault) === operation) inFlight.delete(resolvedVault);
  }
}

export function invalidateVaultFileTreeCache(vaultPath?: string): void {
  if (vaultPath) {
    cache.delete(path.resolve(vaultPath));
    return;
  }
  cache.clear();
}
