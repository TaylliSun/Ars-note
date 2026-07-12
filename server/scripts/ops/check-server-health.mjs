#!/usr/bin/env node

/**
 * Ars-note Server Health Check (v0.8.6)
 *
 * Tests server health, API key validity, and basic functionality.
 * Does NOT upload any test files.
 *
 * Usage:
 *   node scripts/ops/check-server-health.mjs <endpoint> [apiKey]
 *
 * Example:
 *   node scripts/ops/check-server-health.mjs http://localhost:8787 my-key
 */

const ENDPOINT = process.argv[2];
const API_KEY = process.argv[3] || '';

if (!ENDPOINT) {
  console.error('Usage: node scripts/ops/check-server-health.mjs <endpoint> [apiKey]');
  process.exit(1);
}

const BASE = ENDPOINT.replace(/\/+$/, '');
let ok = true;

async function check(label, fn) {
  try {
    const result = await fn();
    const status = result ? '  OK' : '  FAIL';
    console.log(`  ${label.padEnd(40)} ${status}`);
    if (!result) ok = false;
    return result;
  } catch (e) {
    console.log(`  ${label.padEnd(40)} FAIL — ${e.message}`);
    ok = false;
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Ars-note Server Health Check');
  console.log(`  Endpoint: ${BASE}`);
  console.log(`  API Key:  ${API_KEY ? '***provided***' : '(none)'}`);
  console.log('═══════════════════════════════════════');
  console.log('');

  /* 1. Health endpoint */
  await check('GET /health (server reachable)', async () => {
    const res = await fetch(BASE + '/health');
    const data = await res.json();
    return data.ok === true;
  });

  /* 2. Server version */
  await check('Server version reported', async () => {
    const res = await fetch(BASE + '/health');
    const data = await res.json();
    console.log(`      version: ${data.version || 'unknown'}`);
    return !!data.version;
  });

  /* Remaining checks require API key */
  if (!API_KEY) {
    console.log('');
    console.log('  (No API key provided — skipping auth checks)');
    console.log('  Provide an API key as the second argument to test authenticated endpoints.');
    console.log('');
    console.log(ok ? '═══════════════════════════════════════' : '═══════════════════════════════════════');
    console.log(ok ? '  Overall: OK' : '  Overall: ISSUES DETECTED');
    console.log('═══════════════════════════════════════');
    process.exit(ok ? 0 : 1);
  }

  const headers = { 'Authorization': 'Bearer ' + API_KEY };

  /* 3. API key valid */
  await check('API key authentication', async () => {
    const res = await fetch(BASE + '/api/vaults/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ vaultId: '__health_check_test__', vaultName: 'Health Check' }),
    });
    const data = await res.json();
    return data.ok === true;
  });

  /* 4. List backups works */
  await check('GET /api/backups/list', async () => {
    const res = await fetch(BASE + '/api/backups/list?vaultId=__health_check_test__', { headers });
    const data = await res.json();
    return data.ok === true;
  });

  /* 5. Unauthenticated request rejected */
  await check('Unauthenticated request rejected', async () => {
    const res = await fetch(BASE + '/api/backups/list?vaultId=test', {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return data.ok === false;
  });

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(ok ? '  Overall: OK' : '  Overall: ISSUES DETECTED');
  console.log('═══════════════════════════════════════');

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(2);
});
