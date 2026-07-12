import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalStorageBackend } from '../dist/storage/localStorage.js';

const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');

async function withTempServerData(run) {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-server-test-'));
  process.chdir(tempDir);
  try {
    await run(tempDir);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('local storage commits live files and tombstones durably across restart', async () => {
  await withTempServerData(async (tempDir) => {
    const vaultId = 'vault-atomic';
    const relativePath = '01_GDD/GDD.md';
    const first = Buffer.from('# GDD\nfirst revision\n', 'utf8');
    const storage = new LocalStorageBackend();
    await storage.initialize();
    await storage.registerVault(vaultId, 'Atomic Vault');
    await storage.storeLiveFile(vaultId, relativePath, first, sha256(first), '2026-07-11T01:00:00.000Z', {
      clientId: 'client-a',
      deviceId: 'device-a',
    });

    const liveIndexPath = path.join(tempDir, 'server-data', 'live', vaultId, 'live-index.json');
    const liveIndexBackupPath = `${liveIndexPath}.bak`;
    const liveFilePath = path.join(tempDir, 'server-data', 'live', vaultId, 'files', '01_GDD', 'GDD.md');
    assert.equal(fs.readFileSync(liveFilePath, 'utf8'), first.toString('utf8'));
    assert.ok(fs.existsSync(liveIndexPath));
    assert.ok(fs.existsSync(liveIndexBackupPath));

    const restarted = new LocalStorageBackend();
    await restarted.initialize();
    const restartedFile = await restarted.getLiveFile(vaultId, relativePath);
    assert.equal(Buffer.from(restartedFile.contentBase64, 'base64').toString('utf8'), first.toString('utf8'));
    assert.equal(restartedFile.serverRevision, 1);

    await restarted.deleteLiveFile(vaultId, relativePath, '2026-07-11T01:05:00.000Z', {
      clientId: 'client-a',
      deviceId: 'device-a',
    });
    assert.equal(fs.existsSync(liveFilePath), false);
    const deleted = await restarted.getLiveFile(vaultId, relativePath);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.serverRevision, 2);
    assert.ok(Date.parse(deleted.tombstoneExpiresAt) > Date.parse(deleted.updatedAt));

    const restartedAgain = new LocalStorageBackend();
    await restartedAgain.initialize();
    const deletedAfterRestart = await restartedAgain.getLiveFile(vaultId, relativePath);
    assert.equal(deletedAfterRestart.deleted, true);
    assert.equal(deletedAfterRestart.serverRevision, 2);
  });
});

test('startup restores a corrupt live index from its latest atomic backup', async () => {
  await withTempServerData(async (tempDir) => {
    const vaultId = 'vault-backup';
    const relativePath = 'Doc.md';
    const content = Buffer.from('latest content', 'utf8');
    const storage = new LocalStorageBackend();
    await storage.initialize();
    await storage.storeLiveFile(vaultId, relativePath, content, sha256(content));

    const indexPath = path.join(tempDir, 'server-data', 'live', vaultId, 'live-index.json');
    fs.writeFileSync(indexPath, '{broken-json', 'utf8');

    const recovered = new LocalStorageBackend();
    await recovered.initialize();
    const file = await recovered.getLiveFile(vaultId, relativePath);
    assert.equal(Buffer.from(file.contentBase64, 'base64').toString('utf8'), content.toString('utf8'));
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(indexPath, 'utf8')));
  });
});

test('startup fails closed when both critical index copies are corrupt', async () => {
  await withTempServerData(async (tempDir) => {
    const storage = new LocalStorageBackend();
    await storage.initialize();
    await storage.registerVault('vault-corrupt', 'Corrupt Vault');
    const indexPath = path.join(tempDir, 'server-data', 'remote-index.json');
    fs.writeFileSync(indexPath, '{broken-primary', 'utf8');
    fs.writeFileSync(`${indexPath}.bak`, '{broken-backup', 'utf8');

    const restarted = new LocalStorageBackend();
    await assert.rejects(() => restarted.initialize(), /StorageIndexCorrupt/);
  });
});

test('startup replays an interrupted live update from history journal', async () => {
  await withTempServerData(async (tempDir) => {
    const vaultId = 'vault-journal';
    const relativePath = '02_Worldbuilding/World.md';
    const first = Buffer.from('old world', 'utf8');
    const next = Buffer.from('new world after restart', 'utf8');
    const storage = new LocalStorageBackend();
    await storage.initialize();
    await storage.storeLiveFile(vaultId, relativePath, first, sha256(first), '2026-07-11T02:00:00.000Z');

    const revisionId = '2026-07-11T02-05-00-000Z-test01';
    const historyDir = path.join(tempDir, 'server-data', 'live-history', vaultId, '02_Worldbuilding', 'World.md');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, `${revisionId}.json`), JSON.stringify({
      version: 1,
      revisionId,
      relativePath,
      action: 'update',
      recordedAt: '2026-07-11T02:05:00.000Z',
      updatedAt: '2026-07-11T02:05:00.000Z',
      sha256: sha256(next),
      size: next.length,
      deleted: false,
      serverRevision: 2,
      contentBase64: next.toString('base64'),
    }, null, 2), 'utf8');

    const transactionDir = path.join(tempDir, 'server-data', 'live-transactions', vaultId);
    fs.mkdirSync(transactionDir, { recursive: true });
    fs.writeFileSync(path.join(transactionDir, 'pending-update.json'), JSON.stringify({
      version: 1,
      transactionId: 'pending-update',
      vaultId,
      relativePath,
      action: 'update',
      sha256: sha256(next),
      size: next.length,
      updatedAt: '2026-07-11T02:05:00.000Z',
      serverRevision: 2,
      revisionId,
      clientId: 'client-b',
      deviceId: 'device-b',
    }, null, 2), 'utf8');

    const recovered = new LocalStorageBackend();
    await recovered.initialize();
    const file = await recovered.getLiveFile(vaultId, relativePath);
    assert.equal(Buffer.from(file.contentBase64, 'base64').toString('utf8'), next.toString('utf8'));
    assert.equal(file.serverRevision, 2);
    assert.equal(file.revisionId, revisionId);
    assert.equal(fs.existsSync(path.join(transactionDir, 'pending-update.json')), false);
  });
});

test('empty live files are valid persisted content', async () => {
  await withTempServerData(async () => {
    const storage = new LocalStorageBackend();
    await storage.initialize();
    const empty = Buffer.alloc(0);
    await storage.storeLiveFile('vault-empty', 'Empty.md', empty, sha256(empty));
    const file = await storage.getLiveFile('vault-empty', 'Empty.md');
    assert.equal(file.deleted, false);
    assert.equal(file.size, 0);
    assert.equal(file.contentBase64, '');
  });
});

test('ignored credential files are removed from live storage and history', async () => {
  await withTempServerData(async (tempDir) => {
    const vaultId = 'vault-credential-cleanup';
    const relativePath = '.ai-config.json';
    const secret = Buffer.from('{"apiKey":"must-not-remain"}', 'utf8');
    const storage = new LocalStorageBackend();
    await storage.initialize();
    await storage.storeLiveFile(vaultId, relativePath, secret, sha256(secret));

    const liveFilePath = path.join(tempDir, 'server-data', 'live', vaultId, 'files', relativePath);
    assert.equal(fs.existsSync(liveFilePath), true);

    const removed = await storage.pruneIgnoredLiveFiles(vaultId);
    assert.equal(removed, 1);
    assert.equal(fs.existsSync(liveFilePath), false);
    assert.equal(await storage.getLiveFile(vaultId, relativePath), null);

    const historyRoot = path.join(tempDir, 'server-data', 'live-history', vaultId);
    const remainingHistory = fs.existsSync(historyRoot)
      ? fs.readdirSync(historyRoot, { recursive: true }).filter((entry) => String(entry).endsWith('.json'))
      : [];
    assert.equal(remainingHistory.length, 0);
  });
});
