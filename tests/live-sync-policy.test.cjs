const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canSendLiveWriteAfterPreflight,
  getJoinSnapshotAuthorityDecision,
  shouldGuardDestructiveTruncation,
} = require('../dist-electron/liveSync.js');

test('existing device reconciles a stale global baseline per file', () => {
  const decision = getJoinSnapshotAuthorityDecision({
    connectionMode: 'join',
    baselineFileCount: 20,
    remoteFileCount: 25,
    baselineUpdatedAt: '2026-07-10T00:00:00.000Z',
    remoteMaxUpdatedAt: '2026-07-11T00:00:00.000Z',
    hasPreviousFileBaseline: true,
  });

  assert.equal(decision.staleBaselineAgainstRemote, true);
  assert.equal(decision.mode, 'normal-join');
  assert.equal(decision.serverAuthoritativeAdoption, false);
  assert.equal(decision.adoptLocalOnlyToRecovery, false);
  assert.equal(decision.blockAutomaticLocalOnlyUpload, false);
});

test('first connection to a populated server adopts server timeline automatically', () => {
  const decision = getJoinSnapshotAuthorityDecision({
    connectionMode: 'join',
    baselineFileCount: 0,
    remoteFileCount: 25,
    baselineUpdatedAt: '',
    remoteMaxUpdatedAt: '2026-07-11T00:00:00.000Z',
    hasPreviousFileBaseline: false,
  });

  assert.equal(decision.mode, 'first-connect-server-authority');
  assert.equal(decision.serverAuthoritativeAdoption, true);
  assert.equal(decision.adoptLocalOnlyToRecovery, true);
});

test('uploads stay closed until the server snapshot is reconciled', () => {
  assert.equal(canSendLiveWriteAfterPreflight({
    connected: true,
    socketReady: true,
    receivedRemoteSnapshot: false,
    preflightComplete: false,
    uploadFrozen: false,
  }), false);
  assert.equal(canSendLiveWriteAfterPreflight({
    connected: true,
    socketReady: true,
    receivedRemoteSnapshot: true,
    preflightComplete: true,
    uploadFrozen: false,
  }), true);
});

test('large-to-tiny text rewrites remain recoverable without disabling normal writes', () => {
  assert.equal(shouldGuardDestructiveTruncation({
    action: 'update',
    relativePath: '01_GDD/GDD.md',
    previousSize: 64 * 1024,
    newSize: 512,
  }), true);
  assert.equal(shouldGuardDestructiveTruncation({
    action: 'update',
    relativePath: '01_GDD/GDD.md',
    previousSize: 64 * 1024,
    newSize: 48 * 1024,
  }), false);
});
