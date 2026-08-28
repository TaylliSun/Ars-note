#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(serverRoot, 'dist', 'index.js');
const smokeEntry = path.join(serverRoot, 'scripts', 'smoke-test-selfhosted.mjs');
const apiKey = 'ars-note-isolated-smoke-key-2026-strong';

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(endpoint, serverLogs) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/health`);
      const body = await response.json();
      if (response.ok && body.ok) return;
    } catch {
      // The process may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Temporary sync server did not become ready.\n${serverLogs.join('').slice(-4_000)}`);
}

function runSmoke(endpoint) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [smokeEntry, endpoint, apiKey], {
      cwd: serverRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Self-hosted smoke exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`));
    });
  });
}

async function main() {
  if (!fs.existsSync(serverEntry)) {
    throw new Error('Server build is missing. Run npm run build before the isolated smoke test.');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-server-smoke-'));
  const port = await reservePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const serverLogs = [];
  const server = spawn(process.execPath, [serverEntry], {
    cwd: tempRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ARSNOTE_PORT: String(port),
      ARSNOTE_HOST: '127.0.0.1',
      ARS_NOTE_SERVER_API_KEY: apiKey,
      ARS_NOTE_REQUIRE_API_KEY: 'true',
      ARS_NOTE_STORAGE_BACKEND: 'local',
      ARS_NOTE_SERVER_EXPORT_AUTO: 'false',
    },
  });
  server.stdout.on('data', (chunk) => serverLogs.push(String(chunk)));
  server.stderr.on('data', (chunk) => serverLogs.push(String(chunk)));

  try {
    await waitForHealth(endpoint, serverLogs);
    await runSmoke(endpoint);
  } finally {
    if (server.exitCode === null) server.kill();
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_500)),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');

    const resolvedTemp = path.resolve(tempRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    const relative = path.relative(resolvedSystemTemp, resolvedTemp);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to clean an unexpected smoke directory: ${resolvedTemp}`);
    }
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
