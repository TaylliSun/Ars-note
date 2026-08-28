const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLiveSyncRendererHint,
  isLiveSyncRendererHintForVault,
  isSameLiveSyncTarget,
} = require('../dist-test/src/utils/liveSyncVaultScope.js');

test('renderer sync hints stay scoped to one Vault path', () => {
  const hint = createLiveSyncRendererHint('D:\\Projects\\ProjectA', {
    serverUrl: 'http://nas:8787/',
    vaultId: 'vault-a',
    connectionMode: 'join',
  });

  assert.equal(isLiveSyncRendererHintForVault(hint, 'd:/projects/projecta/', 'vault-a'), true);
  assert.equal(isLiveSyncRendererHintForVault(hint, 'D:\\Projects\\ProjectB', 'vault-b'), false);
  assert.equal(isLiveSyncRendererHintForVault(hint, 'D:\\Projects\\ProjectA', 'vault-b'), false);
});

test('legacy pathless hints require the exact Vault ID', () => {
  const legacyHint = { serverUrl: 'http://nas:8787', vaultId: 'vault-a' };

  assert.equal(isLiveSyncRendererHintForVault(legacyHint, 'D:\\Projects\\ProjectA', 'vault-a'), true);
  assert.equal(isLiveSyncRendererHintForVault(legacyHint, 'D:\\Projects\\ProjectB', 'vault-b'), false);
  assert.equal(isLiveSyncRendererHintForVault({ serverUrl: 'http://nas:8787' }, 'D:\\Projects\\ProjectB'), false);
});

test('an existing connection is reusable only for the same server and Vault ID', () => {
  const current = { connected: true, serverUrl: 'http://nas:8787/', vaultId: 'vault-a' };

  assert.equal(isSameLiveSyncTarget(current, { serverUrl: 'http://NAS:8787', vaultId: 'vault-a' }), true);
  assert.equal(isSameLiveSyncTarget(current, { serverUrl: 'http://nas:8787', vaultId: 'vault-b' }), false);
  assert.equal(isSameLiveSyncTarget(current, { serverUrl: 'http://other:8787', vaultId: 'vault-a' }), false);
});
