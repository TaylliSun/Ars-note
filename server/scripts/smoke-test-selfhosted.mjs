#!/usr/bin/env node

/**
 * Ars-note Self-hosted Sync Server — Smoke Test (v0.8.5)
 *
 * Usage:
 *   node scripts/smoke-test-selfhosted.mjs <endpoint> <apiKey>
 *
 * Example:
 *   node scripts/smoke-test-selfhosted.mjs http://localhost:8787 my-secret-key
 *
 * Tests all 7 API endpoints plus:
 *   - Auth rejection (no key, wrong key)
 *   - Path traversal blocking
 *   - Round-trip content verification
 *   - Duplicate backup rejection
 */

const ENDPOINT = process.argv[2];
const API_KEY = process.argv[3];

if (!ENDPOINT || !API_KEY) {
  console.error('Usage: node smoke-test-selfhosted.mjs <endpoint> <apiKey>');
  console.error('  endpoint: e.g. http://localhost:8787');
  console.error('  apiKey:   the ARS_NOTE_SERVER_API_KEY value');
  process.exit(1);
}

const BASE = ENDPOINT.replace(/\/+$/, '');
const VAULT_ID = 'smoke-vault-' + Date.now();
const BACKUP_ID = 'smoke-backup-' + Date.now();
const TEST_CONTENT = 'Ars-note smoke test content @ ' + new Date().toISOString();
const VAULT_NAME = 'Smoke Test Vault';

let passed = 0;
let failed = 0;

function assert(testName, condition, detail = '') {
  if (condition) {
    console.log(`  ${passed + failed + 1}. ${testName.padEnd(28)} PASS`);
    passed++;
  } else {
    console.log(`  ${passed + failed + 1}. ${testName.padEnd(28)} FAIL${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function api(method, path, body = null, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json();
  return { status: res.status, data };
}

async function apiWithKey(method, path, body = null) {
  return api(method, path, body, { 'Authorization': 'Bearer ' + API_KEY });
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Ars-note Self-hosted Smoke Test');
  console.log(`  Endpoint: ${BASE}`);
  console.log('═══════════════════════════════════════');

  /* 1. Health check */
  try {
    const { data } = await api('GET', '/health');
    assert('GET /health', data.ok === true, `ok=${data.ok}`);
  } catch (e) {
    assert('GET /health', false, e.message);
  }

  /* 2. No key → 401 */
  try {
    const { data } = await api('POST', '/api/vaults/register', { vaultId: 'x', vaultName: 'x' });
    assert('No key → 401', data.ok === false, `ok=${data.ok}`);
  } catch (e) {
    assert('No key → 401', false, e.message);
  }

  /* 3. Wrong key → 401 */
  try {
    const { data } = await api('POST', '/api/vaults/register', { vaultId: 'x', vaultName: 'x' }, { 'Authorization': 'Bearer wrong-key' });
    assert('Wrong key → 401', data.ok === false, `ok=${data.ok}`);
  } catch (e) {
    assert('Wrong key → 401', false, e.message);
  }

  /* 4. Register vault */
  try {
    const { data } = await apiWithKey('POST', '/api/vaults/register', { vaultId: VAULT_ID, vaultName: VAULT_NAME });
    assert('Register vault', data.ok === true && data.serverVaultId, `ok=${data.ok}`);
  } catch (e) {
    assert('Register vault', false, e.message);
  }

  /* 5. Upload metadata */
  const testContentBuf = Buffer.from(TEST_CONTENT);
  const crypto = await import('node:crypto');
  const manifestHash = crypto.createHash('sha256').update('smoke-test-manifest').digest('hex');
  try {
    const { data } = await apiWithKey('POST', '/api/backups/upload-metadata', {
      vaultId: VAULT_ID,
      backupId: BACKUP_ID,
      manifestHash,
      fileCount: 1,
      totalSize: testContentBuf.length,
      manifest: { files: [{ relativePath: 'smoke-test.md', sha256: crypto.createHash('sha256').update(testContentBuf).digest('hex'), size: testContentBuf.length }] },
    });
    assert('Upload metadata', data.ok === true, `ok=${data.ok}`);
  } catch (e) {
    assert('Upload metadata', false, e.message);
  }

  /* 6. Upload file */
  const contentBase64 = testContentBuf.toString('base64');
  const fileSha = crypto.createHash('sha256').update(testContentBuf).digest('hex');
  try {
    const { data } = await apiWithKey('POST', '/api/backups/upload-file', {
      vaultId: VAULT_ID,
      backupId: BACKUP_ID,
      relativePath: 'smoke-test.md',
      contentBase64,
      sha256: fileSha,
      size: testContentBuf.length,
    });
    assert('Upload file', data.ok === true && data.sha256 === fileSha, `ok=${data.ok}`);
  } catch (e) {
    assert('Upload file', false, e.message);
  }

  /* 7. List backups */
  try {
    const { data } = await apiWithKey('GET', `/api/backups/list?vaultId=${encodeURIComponent(VAULT_ID)}`);
    assert('List backups', data.ok === true && Array.isArray(data.backups) && data.backups.length >= 1, `count=${data.backups?.length}`);
  } catch (e) {
    assert('List backups', false, e.message);
  }

  /* 8. Get manifest */
  try {
    const { data } = await apiWithKey('GET', `/api/backups/manifest?vaultId=${encodeURIComponent(VAULT_ID)}&backupId=${encodeURIComponent(BACKUP_ID)}`);
    assert('Get manifest', data.ok === true && data.manifestHash === manifestHash, `ok=${data.ok}`);
  } catch (e) {
    assert('Get manifest', false, e.message);
  }

  /* 9. Download file */
  let downloadedContent = '';
  try {
    const { data } = await apiWithKey('GET', `/api/backups/download-file?vaultId=${encodeURIComponent(VAULT_ID)}&backupId=${encodeURIComponent(BACKUP_ID)}&relativePath=smoke-test.md`);
    downloadedContent = Buffer.from(data.contentBase64 || '', 'base64').toString('utf-8');
    assert('Download file', data.ok === true && data.sha256 === fileSha, `ok=${data.ok}`);
  } catch (e) {
    assert('Download file', false, e.message);
  }

  /* 10. Round-trip verify */
  assert('Round-trip verify', downloadedContent === TEST_CONTENT, `match=${downloadedContent === TEST_CONTENT}`);

  /* 11. Path traversal blocked */
  try {
    const { data } = await apiWithKey('GET', `/api/backups/download-file?vaultId=${encodeURIComponent(VAULT_ID)}&backupId=${encodeURIComponent(BACKUP_ID)}&relativePath=../../../etc/passwd`);
    assert('Path traversal blocked', data.ok === false, `ok=${data.ok}`);
  } catch (e) {
    assert('Path traversal blocked', false, e.message);
  }

  /* 12. Duplicate backup rejected */
  try {
    const { data } = await apiWithKey('POST', '/api/backups/upload-metadata', {
      vaultId: VAULT_ID,
      backupId: BACKUP_ID,
      manifestHash: 'dup-test',
      fileCount: 0,
      totalSize: 0,
    });
    assert('Duplicate rejected', data.ok === false, `ok=${data.ok}`);
  } catch (e) {
    assert('Duplicate rejected', false, e.message);
  }

  /* Summary */
  const total = passed + failed;
  console.log('═══════════════════════════════════════');
  if (failed === 0) {
    console.log(`  ${passed}/${total} PASSED ✓`);
  } else {
    console.log(`  ${passed}/${total} PASSED, ${failed} FAILED`);
  }
  console.log('═══════════════════════════════════════');

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exitCode = 2;
});
