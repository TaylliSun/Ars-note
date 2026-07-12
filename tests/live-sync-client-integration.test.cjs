const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const {
  startLiveSync,
  stopLiveSync,
} = require('../dist-electron/liveSync.js');

const API_KEY = 'client-integration-key';
const VAULT_ID = 'vault-client-integration';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitUntil(predicate, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(80);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

function startServer(serverEntry, cwd, port) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd,
    env: {
      ...process.env,
      ARSNOTE_PORT: String(port),
      ARSNOTE_HOST: '127.0.0.1',
      ARS_NOTE_SERVER_API_KEY: API_KEY,
      ARS_NOTE_STORAGE_BACKEND: 'local',
      ARS_NOTE_SERVER_EXPORT_AUTO: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  child.getLogs = () => logs;
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const gracefulExit = once(child, 'exit');
  child.kill();
  await Promise.race([gracefulExit, delay(2000)]);
  if (child.exitCode === null) {
    const forcedExit = once(child, 'exit');
    child.kill('SIGKILL');
    await Promise.race([forcedExit, delay(2000)]);
  }
}

async function serverFiles(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/live-sync/files?vaultId=${VAULT_ID}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!response.ok) throw new Error(`server files HTTP ${response.status}`);
  return (await response.json()).files || [];
}

async function waitForHealth(port, child) {
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${child.getLogs()}`);
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.setTimeout(400, () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    });
  }, 'server did not become healthy');
}

function collectFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  walk(root);
  return files;
}

async function connectVault(vaultPath, port) {
  const statuses = [];
  startLiveSync(vaultPath, {
    enabled: true,
    serverUrl: `http://127.0.0.1:${port}`,
    apiKey: API_KEY,
    vaultId: VAULT_ID,
    connectionMode: 'join',
  }, (channel, data) => {
    if (channel === 'live-sync:status') statuses.push(data);
  }, { serverSafetyVerified: true });
  await waitUntil(
    () => statuses.some((status) => status.connected && status.preflightComplete && status.receivedRemoteSnapshot),
    `client did not finish automatic snapshot reconcile: ${JSON.stringify(statuses.slice(-3))}`,
  );
  return statuses;
}

test('desktop client auto-seeds, adopts server, propagates delete, and removes old local copy', { timeout: 30000 }, async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-client-sync-'));
  const serverDataRoot = path.join(tempRoot, 'server');
  const vaultA = path.join(tempRoot, 'vault-a');
  const vaultB = path.join(tempRoot, 'vault-b');
  fs.mkdirSync(serverDataRoot, { recursive: true });
  fs.mkdirSync(path.join(vaultA, '01_GDD'), { recursive: true });
  fs.mkdirSync(path.join(vaultA, '.ai-memory', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(vaultA, '01_GDD', 'GDD.md'), '# Latest GDD\nA authoritative copy\n', 'utf8');
  fs.writeFileSync(path.join(vaultA, '.ai-memory', 'skills', 'planning.md'), '# Planning Skill\n', 'utf8');

  const port = await getFreePort();
  const serverEntry = path.resolve(__dirname, '..', 'server', 'dist', 'index.js');
  const server = startServer(serverEntry, serverDataRoot, port);
  try {
    await waitForHealth(port, server);

    await connectVault(vaultA, port);
    await waitUntil(async () => {
      const files = await serverFiles(port);
      return files.some((file) => file.relativePath === '01_GDD/GDD.md' && !file.deleted)
        && files.some((file) => file.relativePath === '.ai-memory/skills/planning.md' && !file.deleted);
    }, 'empty server was not seeded automatically');
    await waitUntil(() => fs.existsSync(path.join(vaultA, '.ars-note', 'live-sync-state.json')), 'client A baseline was not written');
    stopLiveSync();

    fs.mkdirSync(path.join(vaultB, '01_GDD'), { recursive: true });
    fs.writeFileSync(path.join(vaultB, '01_GDD', 'GDD.md'), '# Old GDD\nstale local copy\n', 'utf8');
    fs.writeFileSync(path.join(vaultB, 'deleted-long-ago.md'), 'old local file', 'utf8');
    await connectVault(vaultB, port);
    await waitUntil(
      () => fs.readFileSync(path.join(vaultB, '01_GDD', 'GDD.md'), 'utf8').includes('A authoritative copy'),
      'first connection did not adopt the populated server timeline',
    );
    assert.equal(fs.existsSync(path.join(vaultB, 'deleted-long-ago.md')), false);
    const recoveryFiles = collectFiles(path.join(vaultB, '.ars-note', 'sync-recovery'));
    assert.ok(recoveryFiles.length >= 1, 'stale local data should be archived invisibly before server adoption');

    fs.unlinkSync(path.join(vaultB, '01_GDD', 'GDD.md'));
    await waitUntil(async () => {
      const files = await serverFiles(port);
      return files.some((file) => file.relativePath === '01_GDD/GDD.md' && file.deleted);
    }, 'local deletion did not publish an automatic server tombstone');
    stopLiveSync();

    assert.equal(fs.existsSync(path.join(vaultA, '01_GDD', 'GDD.md')), true);
    await connectVault(vaultA, port);
    await waitUntil(
      () => !fs.existsSync(path.join(vaultA, '01_GDD', 'GDD.md')),
      'existing device did not follow the server deletion automatically',
    );
  } catch (error) {
    throw new Error(`${error.message}\nServer logs:\n${server.getLogs()}`);
  } finally {
    stopLiveSync();
    await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
