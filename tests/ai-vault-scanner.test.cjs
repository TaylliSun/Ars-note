const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  clearAIVaultScanCache,
  scanAndIndexVault,
} = require('../dist-test/electron/aiVaultScanner.js');

test('AI vault scanner reuses unchanged Markdown and refreshes changed files', async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-ai-scan-'));
  t.after(() => {
    clearAIVaultScanCache(vault);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(vault, '01_GDD'), { recursive: true });
  fs.mkdirSync(path.join(vault, '.ai-memory'), { recursive: true });
  fs.writeFileSync(path.join(vault, '01_GDD', 'GDD.md'), '# Game Design\n\n#core\nFirst draft.', 'utf8');
  fs.writeFileSync(path.join(vault, 'README.md'), '# Project Readme\n', 'utf8');
  fs.writeFileSync(path.join(vault, '.ai-memory', 'hidden.md'), '# Hidden\n', 'utf8');
  fs.writeFileSync(path.join(vault, 'asset.bin'), Buffer.alloc(1024));

  const first = await scanAndIndexVault(vault);
  assert.equal(first.fileEntries.length, 2);
  assert.deepEqual(first.stats, { readCount: 2, reusedCount: 0 });
  assert.match(first.indexText, /01_GDD\/GDD\.md/);
  assert.doesNotMatch(first.indexText, /hidden\.md/);

  const second = await scanAndIndexVault(vault);
  assert.deepEqual(second.stats, { readCount: 0, reusedCount: 2 });

  fs.writeFileSync(path.join(vault, '01_GDD', 'GDD.md'), '# Game Design Updated\n\n#core\nSecond draft with more text.', 'utf8');
  const third = await scanAndIndexVault(vault);
  assert.deepEqual(third.stats, { readCount: 1, reusedCount: 1 });
  assert.equal(third.fileEntries.find((entry) => entry.relPath === '01_GDD/GDD.md').title, 'Game Design Updated');

  fs.unlinkSync(path.join(vault, 'README.md'));
  const fourth = await scanAndIndexVault(vault);
  assert.equal(fourth.fileEntries.length, 1);
  assert.deepEqual(fourth.stats, { readCount: 0, reusedCount: 1 });
});
