const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  invalidateVaultFileTreeCache,
  readVaultFileTree,
} = require('../dist-test/electron/vaultFileTree.js');
const { clearAIVaultScanCache } = require('../dist-test/electron/aiVaultScanner.js');
const { scanVaultIndex } = require('../dist-test/electron/vaultIndex.js');

function createLargeVault() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-large-vault-'));
  for (let folderIndex = 0; folderIndex < 40; folderIndex += 1) {
    const folder = path.join(vaultPath, `Area-${String(folderIndex).padStart(2, '0')}`);
    fs.mkdirSync(folder, { recursive: true });
    for (let fileIndex = 0; fileIndex < 50; fileIndex += 1) {
      const id = `${folderIndex}-${fileIndex}`;
      fs.writeFileSync(
        path.join(folder, `Note-${String(fileIndex).padStart(2, '0')}.md`),
        `# Note ${id}\n\n#design [[Note-${String((fileIndex + 1) % 50).padStart(2, '0')}]]\nStatus: todo\n`,
      );
    }
  }

  const hiddenHistory = path.join(vaultPath, '.ars-note', 'live-history');
  fs.mkdirSync(hiddenHistory, { recursive: true });
  for (let index = 0; index < 2_000; index += 1) {
    fs.writeFileSync(path.join(hiddenHistory, `history-${index}.json`), '{"ok":true}');
  }
  return vaultPath;
}

function countTreeFiles(nodes) {
  let count = 0;
  for (const node of nodes) {
    if (node.isDir) count += countTreeFiles(node.children || []);
    else count += 1;
  }
  return count;
}

test('large vault startup scan ignores hidden history and coalesces concurrent tree reads', async (t) => {
  const vaultPath = createLargeVault();
  t.after(() => {
    invalidateVaultFileTreeCache(vaultPath);
    clearAIVaultScanCache(vaultPath);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  const skipDirs = new Set(['node_modules', '.git', 'dist', 'out']);
  const startedAt = Date.now();
  const [first, duplicate] = await Promise.all([
    readVaultFileTree(vaultPath, skipDirs, () => false),
    readVaultFileTree(vaultPath, skipDirs, () => false),
  ]);

  assert.strictEqual(first, duplicate);
  assert.equal(countTreeFiles(first), 2_000);
  assert.equal(first.some((node) => node.name === '.ars-note'), false);
  assert.ok(Date.now() - startedAt < 10_000, 'large vault file tree should be ready within 10 seconds');
});

test('large vault index reuses unchanged documents and reads only a changed file', async (t) => {
  const vaultPath = createLargeVault();
  t.after(() => {
    invalidateVaultFileTreeCache(vaultPath);
    clearAIVaultScanCache(vaultPath);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  const firstStartedAt = Date.now();
  const first = await scanVaultIndex(vaultPath);
  const firstDurationMs = Date.now() - firstStartedAt;
  assert.equal(Object.keys(first.notes).length, 2_000);
  assert.equal(first.scanStats.readCount, 2_000);
  assert.equal(first.notes['Area-00/Note-00.md'].tags.includes('design'), true);
  assert.ok(firstDurationMs < 20_000, 'initial 2,000-note index should complete within 20 seconds');

  const cachedStartedAt = Date.now();
  const cached = await scanVaultIndex(vaultPath);
  const cachedDurationMs = Date.now() - cachedStartedAt;
  assert.equal(cached.scanStats.readCount, 0);
  assert.equal(cached.scanStats.reusedCount, 2_000);
  assert.ok(cachedDurationMs < 5_000, 'unchanged index should be reused within 5 seconds');

  const changedPath = path.join(vaultPath, 'Area-00', 'Note-00.md');
  fs.appendFileSync(changedPath, '\nSummary: changed file with a different size\n');
  const changedStartedAt = Date.now();
  const changed = await scanVaultIndex(vaultPath);
  const changedDurationMs = Date.now() - changedStartedAt;
  assert.equal(changed.scanStats.readCount, 1);
  assert.equal(changed.scanStats.reusedCount, 1_999);
  assert.equal(changed.notes['Area-00/Note-00.md'].metadata.summary, 'changed file with a different size');
  assert.ok(changedDurationMs < 5_000, 'single-file index refresh should complete within 5 seconds');
});
