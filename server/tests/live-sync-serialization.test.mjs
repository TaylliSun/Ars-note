import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  LIVE_SYNC_PROTOCOL_VERSION,
  handleMessage,
  isLiveSyncablePath,
  registerClient,
  unregisterClient,
} from '../dist/routes/liveSync.js';

const digest = (text) => crypto.createHash('sha256').update(Buffer.from(text)).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('credential files are never accepted by live sync', () => {
  assert.equal(isLiveSyncablePath('.ai-config.json'), false);
  assert.equal(isLiveSyncablePath('.ars-note/settings.json'), false);
  assert.equal(isLiveSyncablePath('.ai-memory/skills/team-writing.md'), true);
  assert.equal(isLiveSyncablePath('01_GDD/GDD.md'), true);
});

test('same-Vault concurrent writes are serialized and stale second write is rejected', async () => {
  const vaultId = 'vault-serialized';
  const relativePath = 'GDD.md';
  const baseContent = 'base';
  let current = {
    relativePath,
    sha256: digest(baseContent),
    size: Buffer.byteLength(baseContent),
    updatedAt: '2026-07-11T03:00:00.000Z',
    deleted: false,
    contentBase64: Buffer.from(baseContent).toString('base64'),
    serverRevision: 1,
    revisionId: 'revision-1',
  };
  let revision = 1;
  const sent = [];
  const client = registerClient(vaultId, { send: (value) => sent.push(JSON.parse(value)) }, {
    deviceId: 'device-a',
    deviceName: 'Desktop A',
    appVersion: '1.5.62',
    protocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
  });
  client.lastSnapshotSentAt = '2026-07-11T03:00:01.000Z';

  const storage = {
    async getLiveFile() {
      await delay(10);
      return { ...current };
    },
    async storeLiveFile(_vaultId, _relativePath, content, sha256, updatedAt) {
      await delay(20);
      revision += 1;
      current = {
        relativePath,
        sha256,
        size: content.length,
        updatedAt,
        deleted: false,
        contentBase64: content.toString('base64'),
        serverRevision: revision,
        revisionId: `revision-${revision}`,
      };
    },
    async recordRejectedLiveFile() {
      return { revisionId: 'rejected-1', contentBase64: 'cHJvdGVjdGVk' };
    },
  };

  const makeMessage = (content, timestamp) => ({
    type: 'file-change',
    protocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    relativePath,
    action: 'update',
    contentBase64: Buffer.from(content).toString('base64'),
    sha256: digest(content),
    updatedAt: timestamp,
    clientHasServerSnapshot: true,
    clientPreflightComplete: true,
    clientSnapshotReceivedAt: '2026-07-11T03:00:01.000Z',
    clientBaselineUpdatedAt: '2026-07-11T03:00:00.000Z',
    clientConnectionMode: 'join',
    baseSha256: digest(baseContent),
    baseDeleted: false,
    baseUpdatedAt: '2026-07-11T03:00:00.000Z',
    baseServerRevision: 1,
    baseRevisionId: 'revision-1',
  });

  handleMessage(client, JSON.stringify(makeMessage('first accepted edit', '2026-07-11T03:00:02.000Z')), storage);
  handleMessage(client, JSON.stringify(makeMessage('second stale edit', '2026-07-11T03:00:03.000Z')), storage);
  await delay(180);

  const accepted = sent.filter((message) => message.type === 'file-accepted');
  const rejected = sent.filter((message) => message.type === 'file-rejected');
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /base-(revision|version)-mismatch/);
  assert.equal(Buffer.from(current.contentBase64, 'base64').toString('utf8'), 'first accepted edit');
  assert.equal(current.serverRevision, 2);

  unregisterClient(vaultId, client.clientId);
});
