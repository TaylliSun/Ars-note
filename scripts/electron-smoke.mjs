import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedExecutable = path.join(root, 'release', 'win-unpacked', 'Ars-note.exe');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(label, probe, timeoutMs = 20_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out')), 10_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket connection failed'));
      }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed');
    }
    return response.result?.value;
  }

  close() {
    this.socket.close();
  }
}

function createSmokeVault(tempRoot) {
  const userData = path.join(tempRoot, 'user-data');
  const vaultPath = path.join(tempRoot, 'SmokeVault');
  const arsNoteDir = path.join(vaultPath, '.ars-note');
  fs.mkdirSync(arsNoteDir, { recursive: true });
  fs.writeFileSync(path.join(arsNoteDir, 'vault.json'), JSON.stringify({
    appName: 'Ars-note',
    vaultId: 'smoke-test-vault',
    name: 'SmokeVault',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appVersion: 'smoke',
  }, null, 2));
  fs.writeFileSync(path.join(arsNoteDir, 'settings.json'), JSON.stringify({
    theme: 'dark',
    fontSize: 14,
    autoSave: true,
    autoSaveDelay: 100,
  }, null, 2));
  fs.writeFileSync(path.join(vaultPath, '00_Index.md'), '# Smoke Vault\n\nDesktop smoke test.\n');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'recent-vaults.json'), JSON.stringify([vaultPath], null, 2));
  return { userData, vaultPath };
}

async function run() {
  if (!fs.existsSync(packagedExecutable)) {
    throw new Error(`Packaged Ars-note executable not found: ${packagedExecutable}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-desktop-smoke-'));
  const { userData, vaultPath } = createSmokeVault(tempRoot);
  const port = await reservePort();
  const logs = [];
  const startedAt = Date.now();
  const childEnv = { ...process.env, ARS_NOTE_SMOKE_TEST: '1' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(packagedExecutable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--disable-gpu',
  ], {
    cwd: path.dirname(packagedExecutable),
    env: childEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  let cdp;
  try {
    const target = await waitFor('Electron renderer target', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return null;
      const targets = await response.json();
      return targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    }, 25_000);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Runtime.enable');

    await waitFor('welcome screen', () => cdp.evaluate(`Boolean(document.querySelector('.welcome-screen .recent-item'))`));
    const welcomeMs = Date.now() - startedAt;
    await cdp.evaluate(`document.querySelector('.welcome-screen .recent-item')?.click(); true`);

    await waitFor('opened vault workspace', () => cdp.evaluate(`Boolean(document.querySelector('.main-content'))`));
    const workspaceMs = Date.now() - startedAt;
    const editorAlreadyOpen = await cdp.evaluate(`Boolean(document.querySelector('.cm-editor .cm-content'))`);
    if (!editorAlreadyOpen) {
      await waitFor('00_Index.md open action', () => cdp.evaluate(`(() => {
        const welcomeAction = document.querySelector('.editor-welcome-btn-primary');
        if (welcomeAction) {
          welcomeAction.click();
          return true;
        }
        const fileAction = [...document.querySelectorAll('button, [role="button"]')]
          .find((element) => (element.textContent || '').includes('00_Index.md'));
        if (!fileAction) return false;
        fileAction.click();
        return true;
      })()`));
    }
    await waitFor('Markdown editor', () => cdp.evaluate(`Boolean(document.querySelector('.cm-editor .cm-content'))`));

    const marker = `ARS_NOTE_SMOKE_${Date.now()}`;
    await cdp.evaluate(`(() => {
      const editor = document.querySelector('.cm-editor .cm-content');
      if (!editor) return false;
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    })()`);
    await cdp.send('Input.insertText', { text: `\n${marker}` });
    await waitFor('editor autosave', () => cdp.evaluate(`window.arsnote.readFile(${JSON.stringify(path.join(vaultPath, '00_Index.md'))}).then((text) => text.includes(${JSON.stringify(marker)}))`), 15_000);

    const totalMs = Date.now() - startedAt;
    console.log(`Desktop smoke passed: welcome=${welcomeMs}ms workspace=${workspaceMs}ms edit+save=${totalMs}ms`);
  } catch (error) {
    let rendererState = '';
    if (cdp) {
      try {
        rendererState = await cdp.evaluate(`JSON.stringify({
          text: (document.body.innerText || '').slice(0, 1600),
          classes: [...document.querySelectorAll('[class]')].slice(0, 80).map((element) => element.className),
        })`);
      } catch {
        rendererState = '';
      }
    }
    const recentLogs = logs.join('').trim().split(/\r?\n/).slice(-20).join('\n');
    throw new Error(`${error.message}${rendererState ? `\nRenderer state:\n${rendererState}` : ''}${recentLogs ? `\nElectron logs:\n${recentLogs}` : ''}`);
  } finally {
    if (cdp) {
      try {
        await cdp.evaluate(`window.arsnote.windowClose()`);
      } catch {
        // Fall back to terminating the isolated smoke process.
      }
      cdp.close();
    }
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (child.exitCode === null) child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
