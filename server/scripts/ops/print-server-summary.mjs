#!/usr/bin/env node

/**
 * Ars-note Server Summary (v0.8.6)
 *
 * Prints server configuration summary.
 * NEVER prints secrets (API keys, S3 secrets, MinIO passwords).
 *
 * Usage:
 *   node scripts/ops/print-server-summary.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const DATA_DIR = path.resolve('server-data');
const INDEX_FILE = path.join(DATA_DIR, 'remote-index.json');

function maskSecret(value) {
  if (!value) return '(not set)';
  if (value.length <= 4) return '****';
  return value.substring(0, 2) + '***' + value.substring(value.length - 2);
}

function envStatus(name) {
  const val = process.env[name];
  if (!val) return '(not set)';
  return 'SET';
}

function main() {
  const storageBackend = (process.env.ARS_NOTE_STORAGE_BACKEND || 'local').toLowerCase();
  const apiKeySet = !!process.env.ARS_NOTE_SERVER_API_KEY;
  const port = process.env.ARSNOTE_PORT || '3141';
  const host = process.env.ARSNOTE_HOST || '127.0.0.1';
  const securityMode = (process.env.ARS_NOTE_SECURITY_MODE || 'lan').toLowerCase();
  const trustProxy = process.env.ARS_NOTE_TRUST_PROXY === 'true';
  const requireHttps = securityMode === 'public' || process.env.ARS_NOTE_REQUIRE_HTTPS === 'true';

  console.log('═══════════════════════════════════════');
  console.log('  Ars-note Server Configuration Summary');
  console.log('═══════════════════════════════════════');
  console.log('');

  /* Server info */
  console.log('  Server:');
  console.log(`    Listen:       ${host}:${port}`);
  console.log(`    Storage:      ${storageBackend}`);
  console.log(`    API key:      ${apiKeySet ? 'ENABLED' : 'NOT SET (dev mode)'}`);
  console.log('');

  /* Storage config */
  if (storageBackend === 's3') {
    const endpoint = process.env.ARS_NOTE_S3_ENDPOINT || '';
    const bucket = process.env.ARS_NOTE_S3_BUCKET || '';
    const region = process.env.ARS_NOTE_S3_REGION || 'us-east-1';
    const pathStyle = process.env.ARS_NOTE_S3_FORCE_PATH_STYLE === 'true';

    console.log('  S3 / MinIO:');
    console.log(`    Endpoint:     ${endpoint || '(not set)'}`);
    console.log(`    Bucket:       ${bucket || '(not set)'}`);
    console.log(`    Region:       ${region}`);
    console.log(`    Path style:   ${pathStyle}`);
    console.log(`    Access Key:   ${envStatus('ARS_NOTE_S3_ACCESS_KEY_ID')}`);
    console.log(`    Secret Key:   ${envStatus('ARS_NOTE_S3_SECRET_ACCESS_KEY')}`);

    /* Check completeness */
    const missing = [];
    if (!endpoint) missing.push('ARS_NOTE_S3_ENDPOINT');
    if (!bucket) missing.push('ARS_NOTE_S3_BUCKET');
    if (!process.env.ARS_NOTE_S3_ACCESS_KEY_ID) missing.push('ARS_NOTE_S3_ACCESS_KEY_ID');
    if (!process.env.ARS_NOTE_S3_SECRET_ACCESS_KEY) missing.push('ARS_NOTE_S3_SECRET_ACCESS_KEY');

    if (missing.length > 0) {
      console.log(`    ⚠ MISSING: ${missing.join(', ')}`);
    } else {
      console.log('    ✓ All required S3 env vars set');
    }
    console.log('');
  } else {
    console.log('  Local Storage:');
    console.log(`    Data path:    ${DATA_DIR}`);
    console.log(`    Data exists:  ${fs.existsSync(DATA_DIR) ? 'YES' : 'NO'}`);
    console.log('');
  }

  /* Data summary (local backend only) */
  if (storageBackend === 'local' && fs.existsSync(INDEX_FILE)) {
    try {
      const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
      const vaults = Object.values(index);
      console.log(`  Vault Registry:`);
      console.log(`    Registered vaults: ${vaults.length}`);
      for (const v of vaults) {
        console.log(`      - ${v.vaultId} → ${v.serverVaultId} (${v.vaultName})`);
      }
      console.log('');
    } catch { /* ignore parse errors */ }
  }

  /* Security notes */
  console.log('  Security:');
  console.log(`    API key set:      ${apiKeySet ? 'YES' : 'NO (dev mode — no auth)'}`);
  console.log(`    Mode:             ${securityMode}`);
  console.log(`    HTTPS required:   ${requireHttps ? 'YES' : 'NO'}`);
  console.log(`    Trusted proxy:    ${trustProxy ? 'YES' : 'NO'}`);
  console.log(`    URL credentials:  ${process.env.ARS_NOTE_ALLOW_API_KEY_IN_QUERY === 'true' ? 'LEGACY ENABLED' : 'DISABLED'}`);
  console.log(`    Secrets printed:  NO`);
  console.log('');

  console.log('═══════════════════════════════════════');
}

main();
