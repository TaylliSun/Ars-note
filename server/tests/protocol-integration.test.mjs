import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const API_KEY = 'integration-sync-key';
const VAULT_ID = 'vault-protocol-integration';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (content) => crypto.createHash('sha256').update(Buffer.from(content)).digest('hex');

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(port, child, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before health check: ${child.exitCode}`);
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.setTimeout(500, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
      });
      if (result.status === 200 && JSON.parse(result.body).ok) return;
    } catch {}
    await delay(80);
  }
  throw new Error('server health check timed out');
}

async function fetchLiveFile(port, relativePath) {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/live-sync/file?vaultId=${encodeURIComponent(VAULT_ID)}&relativePath=${encodeURIComponent(relativePath)}`,
    { headers: { Authorization: `Bearer ${API_KEY}` } },
  );
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || `live file HTTP ${response.status}`);
  return data.file;
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

test('public deployment mode refuses to start without a strong API key', { timeout: 6000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-auth-required-'));
  const serverEntry = path.resolve('dist/index.js');
  const port = await getFreePort();
  const child = spawn(process.execPath, [serverEntry], {
    cwd: tempDir,
    env: {
      ...process.env,
      ARSNOTE_PORT: String(port),
      ARSNOTE_HOST: '127.0.0.1',
      ARS_NOTE_SERVER_API_KEY: '',
      ARS_NOTE_REQUIRE_API_KEY: 'true',
      ARS_NOTE_STORAGE_BACKEND: 'local',
      ARS_NOTE_SERVER_EXPORT_AUTO: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  const [code] = await once(child, 'exit');
  assert.notEqual(code, 0);
  assert.match(logs, /requires ARS_NOTE_SERVER_API_KEY with at least 16 characters/);
});

function createMaskedFrame(payload) {
  const data = Buffer.from(payload, 'utf8');
  const mask = crypto.randomBytes(4);
  const headerSize = data.length < 126 ? 2 : data.length < 65536 ? 4 : 10;
  const frame = Buffer.alloc(headerSize + 4 + data.length);
  frame[0] = 0x81;
  if (data.length < 126) {
    frame[1] = 0x80 | data.length;
  } else if (data.length < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(data.length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(data.length), 2);
  }
  const maskOffset = headerSize;
  mask.copy(frame, maskOffset);
  for (let index = 0; index < data.length; index += 1) {
    frame[maskOffset + 4 + index] = data[index] ^ mask[index % 4];
  }
  return frame;
}

function readFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  return {
    opcode,
    payload: buffer.subarray(offset, offset + length).toString('utf8'),
    consumed: offset + length,
  };
}

class SyncSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.messages = [];
    socket.on('data', (chunk) => this.consume(chunk));
    socket.on('error', (error) => { this.lastSocketError = error; });
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = readFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.consumed);
      if (frame.opcode !== 1) continue;
      const message = JSON.parse(frame.payload);
      this.messages.push(message);
      this.emit('message', message);
    }
  }

  send(message) {
    this.socket.write(createMaskedFrame(JSON.stringify(message)));
  }

  async waitFor(predicate, timeoutMs = 4000) {
    const existing = this.messages.find(predicate);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('message', onMessage);
        reject(new Error(`WebSocket message timeout; received: ${this.messages.map((item) => item.type).join(', ')}`));
      }, timeoutMs);
      const onMessage = (message) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        this.off('message', onMessage);
        resolve(message);
      };
      this.on('message', onMessage);
    });
  }

  close() {
    this.socket.destroy();
  }
}

async function connectClient(port, deviceId) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const query = new URLSearchParams({
      vaultId: VAULT_ID,
      apiKey: API_KEY,
      deviceId,
      deviceName: deviceId,
      appVersion: '1.5.62',
      protocolVersion: '4',
    });
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: `/ws/live-sync?${query}`,
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });
    req.once('upgrade', (_res, socket, head) => {
      const client = new SyncSocket(socket);
      if (head.length > 0) client.consume(head);
      resolve(client);
    });
    req.once('response', (res) => reject(new Error(`WebSocket upgrade failed: ${res.statusCode}`)));
    req.once('error', reject);
    req.end();
  });
}

function changeMessage(snapshot, action, content, base, updatedAt, source = action) {
  const contentBuffer = Buffer.from(content || '', 'utf8');
  return {
    type: 'file-change',
    protocolVersion: 4,
    relativePath: '01_GDD/GDD.md',
    action,
    contentBase64: action === 'delete' ? '' : contentBuffer.toString('base64'),
    sha256: action === 'delete' ? '' : sha256(contentBuffer),
    size: action === 'delete' ? 0 : contentBuffer.length,
    updatedAt,
    clientHasServerSnapshot: true,
    clientPreflightComplete: true,
    clientSnapshotReceivedAt: snapshot.timestamp,
    clientBaselineUpdatedAt: snapshot.timestamp,
    clientConnectionMode: 'join',
    clientMutationSource: source,
    baseSha256: base?.deleted ? '' : (base?.sha256 || ''),
    baseDeleted: !!base?.deleted,
    baseUpdatedAt: base?.updatedAt || '',
    baseSize: base?.size || 0,
    baseServerRevision: base?.serverRevision,
    baseRevisionId: base?.revisionId,
  };
}

test('real server propagates create, offline update, delete, restart tombstone, and stale-write rejection', { timeout: 15000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-protocol-'));
  const serverEntry = path.resolve('dist/index.js');
  const port = await getFreePort();
  let server = startServer(serverEntry, tempDir, port);
  const clients = [];
  try {
    await waitForHealth(port, server);
    const clientA = await connectClient(port, 'desktop-a');
    const clientB = await connectClient(port, 'desktop-b');
    clients.push(clientA, clientB);
    const snapshotA = await clientA.waitFor((message) => message.type === 'live-snapshot');
    await clientB.waitFor((message) => message.type === 'live-snapshot');

    const createdAt = new Date().toISOString();
    clientA.send(changeMessage(snapshotA, 'create', '# GDD\nversion one', null, createdAt, 'create'));
    const createAccepted = await clientA.waitFor((message) => message.type === 'file-accepted' && message.action === 'create');
    const createRemote = await clientB.waitFor((message) => message.type === 'file-change' && message.action === 'create');
    assert.equal(createRemote.sha256, createAccepted.sha256);

    clientB.close();
    const updatedAt = new Date(Date.now() + 20).toISOString();
    clientA.send(changeMessage(snapshotA, 'update', '# GDD\nversion two while B offline', createAccepted, updatedAt, 'update'));
    const updateAccepted = await clientA.waitFor((message) => message.type === 'file-accepted' && message.action === 'update');

    const clientBReconnected = await connectClient(port, 'desktop-b-reconnected');
    clients.push(clientBReconnected);
    const reconnectSnapshot = await clientBReconnected.waitFor((message) => message.type === 'live-snapshot');
    const latest = reconnectSnapshot.files.find((file) => file.relativePath === '01_GDD/GDD.md');
    assert.equal(latest.contentBase64, undefined);
    const latestContent = await fetchLiveFile(port, '01_GDD/GDD.md');
    assert.equal(Buffer.from(latestContent.contentBase64, 'base64').toString('utf8'), '# GDD\nversion two while B offline');
    assert.equal(latest.revisionId, updateAccepted.revisionId);

    const deletedAt = new Date(Date.now() + 40).toISOString();
    clientA.send(changeMessage(snapshotA, 'delete', '', updateAccepted, deletedAt, 'delete'));
    const deleteAccepted = await clientA.waitFor((message) => message.type === 'file-accepted' && message.action === 'delete');
    const deleteRemote = await clientBReconnected.waitFor((message) => message.type === 'file-change' && message.action === 'delete');
    assert.equal(deleteRemote.deleted || deleteRemote.action === 'delete', true);
    assert.ok(deleteAccepted.serverRevision > updateAccepted.serverRevision);

    for (const client of clients.splice(0)) client.close();
    await stopServer(server);
    server = startServer(serverEntry, tempDir, port);
    await waitForHealth(port, server);

    const clientC = await connectClient(port, 'desktop-c-old-copy');
    clients.push(clientC);
    const restartSnapshot = await clientC.waitFor((message) => message.type === 'live-snapshot');
    const tombstone = restartSnapshot.files.find((file) => file.relativePath === '01_GDD/GDD.md');
    assert.equal(tombstone.deleted, true);
    assert.equal(tombstone.serverRevision, deleteAccepted.serverRevision);

    clientC.send(changeMessage(
      restartSnapshot,
      'create',
      '# GDD\nversion one',
      createAccepted,
      createdAt,
      'offline-local',
    ));
    const rejection = await clientC.waitFor((message) => message.type === 'file-rejected');
    assert.match(rejection.reason, /stale-write|deleted-tombstone-resurrection|base-revision-mismatch/);
    assert.equal(rejection.current.deleted, true);
  } catch (error) {
    throw new Error(`${error.message}\nServer logs:\n${server?.getLogs?.() || ''}`);
  } finally {
    for (const client of clients) client.close();
    await stopServer(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
