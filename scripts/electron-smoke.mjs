import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedExecutable = process.env.ARS_NOTE_SMOKE_EXECUTABLE
  ? path.resolve(process.env.ARS_NOTE_SMOKE_EXECUTABLE)
  : path.join(root, 'release', 'win-unpacked', 'Ars-note.exe');

function readPositiveBudget(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

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

async function startFakeAIProvider() {
  const requests = [];
  const server = http.createServer((request, response) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const lastUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
      const prompt = String(lastUserMessage?.content || '');
      requests.push({
        url: request.url || '',
        authorization: request.headers.authorization || '',
        prompt,
      });

      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      if (request.headers.authorization !== 'Bearer smoke-secret') {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      if (prompt.includes('AI_CANCEL_SMOKE')) {
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, 5_000)),
          new Promise((resolve) => response.once('close', resolve)),
        ]);
        if (response.destroyed || response.writableEnded) return;
      }

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        id: 'ars-note-smoke-response',
        model: 'smoke-model',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: prompt.includes('AI_CANCEL_SMOKE') ? 'TOO_LATE' : 'AI_SMOKE_REPLY',
          },
        }],
      }));
    })().catch((error) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
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
  const largeDocumentSmoke = process.env.ARS_NOTE_LARGE_DOCUMENT_SMOKE === '1';
  const smokeDocumentPath = process.env.ARS_NOTE_SMOKE_DOCUMENT;
  const indexContent = largeDocumentSmoke
    ? Array.from({ length: 120 }, (_, sectionIndex) => {
      const rows = Array.from({ length: 8 }, (_, rowIndex) => (
        `| ${sectionIndex + 1}.${rowIndex + 1} | **System rule ${sectionIndex}-${rowIndex}** | [[Design-${rowIndex}]] | Long planning detail ${'content '.repeat(8)} |`
      ));
      return [
        `## System section ${sectionIndex + 1}`,
        '',
        '| ID | Rule | Owner | Detail |',
        '| --- | --- | --- | --- |',
        ...rows,
        '',
        `> Planning note ${sectionIndex + 1}: ${'constraint '.repeat(12)}`,
        '',
      ].join('\n');
    }).join('\n')
    : '# Smoke Vault\n\nDesktop smoke test.\n';
  fs.writeFileSync(path.join(vaultPath, '00_Index.md'), indexContent);
  const targetDocumentPath = smokeDocumentPath
    ? path.join(vaultPath, 'LargePlan.md')
    : path.join(vaultPath, '00_Index.md');
  if (smokeDocumentPath) {
    fs.writeFileSync(targetDocumentPath, fs.readFileSync(path.resolve(smokeDocumentPath), 'utf8'));
  }
  if (process.env.ARS_NOTE_LARGE_VAULT_SMOKE === '1') {
    for (let folderIndex = 0; folderIndex < 40; folderIndex += 1) {
      const folder = path.join(vaultPath, `Area-${String(folderIndex).padStart(2, '0')}`);
      fs.mkdirSync(folder, { recursive: true });
      for (let fileIndex = 0; fileIndex < 50; fileIndex += 1) {
        fs.writeFileSync(
          path.join(folder, `Note-${String(fileIndex).padStart(2, '0')}.md`),
          `# Large Vault Note ${folderIndex}-${fileIndex}\n\n#design [[00_Index]]\n`,
        );
      }
    }

    const liveHistory = path.join(arsNoteDir, 'live-history');
    fs.mkdirSync(liveHistory, { recursive: true });
    for (let index = 0; index < 2_000; index += 1) {
      fs.writeFileSync(path.join(liveHistory, `history-${index}.json`), '{"ok":true}');
    }

    const aiHistory = path.join(vaultPath, '.ai-memory', 'history');
    fs.mkdirSync(aiHistory, { recursive: true });
    const messages = Array.from({ length: 240 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Large history message ${index} ${'context '.repeat(40)}`,
      createdAt: new Date(Date.now() - (240 - index) * 1_000).toISOString(),
    }));
    fs.writeFileSync(path.join(aiHistory, 'current-session.json'), JSON.stringify({
      messages,
      savedAt: new Date().toISOString(),
    }));
  }
  if (process.env.ARS_NOTE_VISUAL_WORKSPACE_SMOKE === '1') {
    fs.writeFileSync(path.join(vaultPath, 'Design-A.md'), '# Design A\n\n#system [[Design-B]] [[00_Index]]\n');
    fs.writeFileSync(path.join(vaultPath, 'Design-B.md'), '# Design B\n\n#feature [[Design-A]]\n');
    fs.writeFileSync(path.join(vaultPath, 'Visual.canvas'), JSON.stringify({
      layoutVersion: 3,
      mode: 'mindmap',
      nodes: [
        { id: 'root', type: 'text', x: 1500, y: 120, width: 280, height: 80, text: 'Smoke roadmap', color: '6' },
        { id: 'branch-a', type: 'text', x: 1900, y: 80, width: 240, height: 72, text: 'Alpha branch', branchSide: 'right' },
        { id: 'branch-c', type: 'text', x: 1900, y: 200, width: 240, height: 72, text: 'Gamma branch', branchSide: 'right' },
        { id: 'branch-b', type: 'text', x: 1100, y: 140, width: 240, height: 72, text: 'Beta branch', branchSide: 'left' },
      ],
      edges: [
        { id: 'root-a', fromNode: 'root', toNode: 'branch-a', fromSide: 'right', toSide: 'left' },
        { id: 'root-c', fromNode: 'root', toNode: 'branch-c', fromSide: 'right', toSide: 'left' },
        { id: 'root-b', fromNode: 'root', toNode: 'branch-b', fromSide: 'left', toSide: 'right' },
      ],
    }, null, 2));
  }
  if (process.env.ARS_NOTE_TEAM_SMOKE === '1') {
    const teamDir = path.join(vaultPath, '.ars-team');
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, 'retired-command-center.md'),
      '---\ntype: ars-team-command-center\n---\n\n# Retired Team Command Center\n\nPreserve this customized content during migration.\n',
    );
  }
  if (process.env.ARS_NOTE_EXCALIDRAW_SMOKE === '1') {
    const now = Date.now();
    fs.writeFileSync(path.join(vaultPath, 'Prototype.excalidraw'), JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'ars-note-smoke',
      elements: [{
        id: 'smoke-frame',
        type: 'rectangle',
        x: 120,
        y: 100,
        width: 360,
        height: 220,
        angle: 0,
        strokeColor: '#8b9dc3',
        backgroundColor: '#20283a',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: { type: 3 },
        seed: 101,
        version: 1,
        versionNonce: 102,
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
      }],
      appState: { viewBackgroundColor: '#111827', theme: 'dark' },
      files: {},
    }, null, 2));
  }
  if (process.env.ARS_NOTE_SYNC_RECOVERY_SMOKE === '1') {
    fs.writeFileSync(path.join(vaultPath, 'Conflict.md'), '# Conflict\n\nLocal version\n');
    fs.writeFileSync(path.join(vaultPath, 'Conflict.md.conflict-1001'), '# Conflict\n\nRemote version\n');
  }
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'recent-vaults.json'), JSON.stringify([vaultPath], null, 2));
  return { userData, vaultPath, targetDocumentPath };
}

async function run() {
  if (!fs.existsSync(packagedExecutable)) {
    throw new Error(`Packaged Ars-note executable not found: ${packagedExecutable}`);
  }

  const largeDocumentSmoke = process.env.ARS_NOTE_LARGE_DOCUMENT_SMOKE === '1';
  const backupSmoke = process.env.ARS_NOTE_BACKUP_SMOKE === '1';
  const visualWorkspaceSmoke = process.env.ARS_NOTE_VISUAL_WORKSPACE_SMOKE === '1';
  const aiSmoke = process.env.ARS_NOTE_AI_SMOKE === '1';
  const syncRecoverySmoke = process.env.ARS_NOTE_SYNC_RECOVERY_SMOKE === '1';
  const responsiveSmoke = process.env.ARS_NOTE_RESPONSIVE_SMOKE === '1';
  const exportSmoke = process.env.ARS_NOTE_EXPORT_SMOKE === '1';
  const excalidrawSmoke = process.env.ARS_NOTE_EXCALIDRAW_SMOKE === '1';
  const teamSmoke = process.env.ARS_NOTE_TEAM_SMOKE === '1';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-desktop-smoke-'));
  const { userData, vaultPath, targetDocumentPath } = createSmokeVault(tempRoot);
  const fakeAIProvider = aiSmoke ? await startFakeAIProvider() : null;
  const port = await reservePort();
  const logs = [];
  const startedAt = Date.now();
  const childEnv = { ...process.env, ARS_NOTE_SMOKE_TEST: '1' };
  const pdfSmokeOutput = path.join(tempRoot, 'smoke-export.pdf');
  if (exportSmoke) childEnv.ARS_NOTE_PDF_SMOKE_OUTPUT = pdfSmokeOutput;
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
    const assertArsNoteProductIdentity = async (label) => {
      const leakedText = await cdp.evaluate(`(() => {
        const retiredProductName = String.fromCharCode(79, 98, 115, 105, 100, 105, 97, 110);
        const match = (document.body.innerText || '').match(new RegExp(retiredProductName, 'gi'));
        return match ? match.slice(0, 5) : [];
      })()`);
      if (Array.isArray(leakedText) && leakedText.length > 0) {
        throw new Error(`${label} exposed a legacy product identity: ${leakedText.join(', ')}`);
      }
    };
    await cdp.evaluate(`(() => {
      window.__arsNoteLongTasks = [];
      if (typeof PerformanceObserver === 'undefined') return false;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__arsNoteLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      try { observer.observe({ type: 'longtask', buffered: true }); } catch { return false; }
      window.__arsNoteLongTaskObserver = observer;
      return true;
    })()`);

    await waitFor('welcome screen', () => cdp.evaluate(`Boolean(document.querySelector('.welcome-screen .recent-item'))`));
    const welcomeMs = Date.now() - startedAt;
    await cdp.evaluate(`document.querySelector('.welcome-screen .recent-item')?.click(); true`);

    await waitFor('opened vault workspace', () => cdp.evaluate(`Boolean(document.querySelector('.main-content'))`));
    await assertArsNoteProductIdentity('Vault workspace');
    const workspaceMs = Date.now() - startedAt;
    const initialDocumentOpenStartedAt = Date.now();
    await waitFor('document opening feedback', () => cdp.evaluate(`Boolean(
      performance.getEntriesByName('ars-note:document-opening-visible').length
    )`), 15_000, 20);
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
    await waitFor('Markdown editor', () => cdp.evaluate(`Boolean(document.querySelector('.cm-editor .cm-content'))`), 60_000);
    await waitFor('document opening feedback dismissed', () => cdp.evaluate(`Boolean(
      document.querySelector('.cm-editor .cm-content')
      && !document.querySelector('.document-opening-overlay')
    )`), 60_000, 20);
    const initialEditorMs = Date.now() - startedAt;
    const initialDocumentReadyMs = Date.now() - initialDocumentOpenStartedAt;
    let documentSwitchMs = 0;
    if (process.env.ARS_NOTE_SMOKE_DOCUMENT) {
      const switchStartedAt = Date.now();
      await waitFor('LargePlan.md open action', () => cdp.evaluate(`(() => {
        const fileAction = [...document.querySelectorAll('.tree-item')]
          .find((element) => (element.textContent || '').includes('LargePlan.md'));
        if (!(fileAction instanceof HTMLElement)) return false;
        fileAction.click();
        return true;
      })()`));
      await waitFor('LargePlan.md editor', () => cdp.evaluate(`Boolean(
        document.querySelector('.editor-titlebar')?.textContent?.includes('LargePlan.md')
      )`), 60_000);
      documentSwitchMs = Date.now() - switchStartedAt;
    }
    if (largeDocumentSmoke || process.env.ARS_NOTE_SMOKE_DOCUMENT) {
      await waitFor('large document progressive load', () => cdp.evaluate(`Boolean(
        document.querySelector('.cm-editor .cm-content')
        && !document.querySelector('.editor-loading-large-document')
      )`), 60_000);
    }
    const editorMs = Date.now() - startedAt;

    if (largeDocumentSmoke) {
      await cdp.evaluate(`(() => {
        const scroller = document.querySelector('.cm-scroller');
        if (!(scroller instanceof HTMLElement)) return false;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
        return true;
      })()`);
      await waitFor('bottom live preview viewport', () => cdp.evaluate(`Boolean(
        document.querySelector('.cm-content')?.textContent?.includes('System section 120')
      )`), 15_000);
      await cdp.evaluate(`(() => {
        const scroller = document.querySelector('.cm-scroller');
        if (!(scroller instanceof HTMLElement)) return false;
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll'));
        return true;
      })()`);
      await waitFor('top live preview viewport', () => cdp.evaluate(`Boolean(
        document.querySelector('.cm-content')?.textContent?.includes('System section 1')
      )`), 15_000);

      const tableMarker = ` TABLE_CELL_${Date.now()}`;
      const cellPoint = await cdp.evaluate(`(() => {
        const cell = document.querySelector('.cm-lp-table-cell-ready');
        if (!(cell instanceof HTMLElement)) return null;
        const rect = cell.getBoundingClientRect();
        const x = rect.left + Math.min(rect.width / 2, 48);
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (!(hit instanceof Element) || hit.closest('.cm-lp-table-cell-ready') !== cell) return null;
        return { x, y };
      })()`);
      if (!cellPoint) throw new Error('Rendered table cell failed coordinate hit testing');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cellPoint.x, y: cellPoint.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cellPoint.x, y: cellPoint.y, button: 'left', clickCount: 1 });
      const activatedCell = await waitFor('table cell coordinate activation', () => cdp.evaluate(`Boolean(
        document.querySelector('.cm-lp-table-cell-editable')?.isContentEditable
      )`));
      if (!activatedCell) throw new Error('Rendered table cell did not enter edit mode');
      await cdp.send('Input.insertText', { text: tableMarker });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await waitFor('table cell autosave', () => cdp.evaluate(`window.arsnote.readFile(${JSON.stringify(targetDocumentPath)}).then((text) => text.includes(${JSON.stringify(tableMarker)}))`), 15_000);
      const tableReturnedToPreview = await cdp.evaluate(`!document.querySelector('.cm-lp-table-cell-editable')`);
      if (!tableReturnedToPreview) throw new Error('Rendered table cell did not leave edit mode');
    }

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
    await waitFor('editor autosave', () => cdp.evaluate(`window.arsnote.readFile(${JSON.stringify(targetDocumentPath)}).then((text) => text.includes(${JSON.stringify(marker)}))`), 15_000);

    if (excalidrawSmoke) {
      const excalidrawPath = path.join(vaultPath, 'Prototype.excalidraw');
      const countSceneElements = () => {
        const scene = JSON.parse(fs.readFileSync(excalidrawPath, 'utf8'));
        return Array.isArray(scene.elements) ? scene.elements.filter((element) => !element?.isDeleted).length : 0;
      };
      const drawRectangle = async (offset) => {
        const xRatio = [0.28, 0.52, 0.72][offset] || 0.28;
        const yRatio = [0.38, 0.58, 0.34][offset] || 0.38;
        const toolPoint = await cdp.evaluate(`(() => {
          const button = document.querySelector('[data-testid="rectangle"]')
            || [...document.querySelectorAll('button, [role="button"]')].find((element) => /rectangle|矩形/i.test(
              [element.getAttribute('aria-label'), element.getAttribute('title')].filter(Boolean).join(' ')
            ));
          if (!(button instanceof HTMLElement)) return null;
          const rect = button.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        const point = await cdp.evaluate(`(() => {
          const canvas = document.querySelector('.excalidraw-host canvas.excalidraw__canvas')
            || document.querySelector('.excalidraw-host .excalidraw canvas');
          if (!(canvas instanceof HTMLCanvasElement)) return null;
          const rect = canvas.getBoundingClientRect();
          return {
            x: rect.left + Math.min(rect.width - 160, Math.max(160, rect.width * ${xRatio})),
            y: rect.top + Math.min(rect.height - 120, Math.max(120, rect.height * ${yRatio})),
          };
        })()`);
        if (!point) throw new Error('Excalidraw canvas was not available for pointer input');
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, pointerType: 'mouse' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
        if (toolPoint) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: toolPoint.x, y: toolPoint.y, pointerType: 'mouse' });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: toolPoint.x, y: toolPoint.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toolPoint.x, y: toolPoint.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
        } else {
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
        }
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
        await new Promise((resolve) => setTimeout(resolve, 60));
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 56, y: point.y + 36, button: 'left', buttons: 1, pointerType: 'mouse' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 112, y: point.y + 72, button: 'left', buttons: 1, pointerType: 'mouse' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 112, y: point.y + 72, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
      };

      await waitFor('Prototype.excalidraw open action', () => cdp.evaluate(`(() => {
        const fileAction = [...document.querySelectorAll('.tree-item')]
          .find((element) => (element.textContent || '').includes('Prototype.excalidraw'));
        if (!(fileAction instanceof HTMLElement)) return false;
        fileAction.click();
        return true;
      })()`));
      await waitFor('Excalidraw editor', () => cdp.evaluate(`Boolean(
        document.querySelector('.excalidraw-host canvas')
        && document.querySelector('.editor-titlebar')?.textContent?.includes('Prototype.excalidraw')
      )`), 30_000);
      await new Promise((resolve) => setTimeout(resolve, 800));
      const initialElementCount = countSceneElements();

      await drawRectangle(0);
      await waitFor('Excalidraw debounced autosave', () => countSceneElements() >= initialElementCount + 1, 15_000);

      await drawRectangle(1);
      await new Promise((resolve) => setTimeout(resolve, 40));
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 });
      await waitFor('Excalidraw Ctrl+S flush', () => countSceneElements() >= initialElementCount + 2, 15_000);

      await drawRectangle(2);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const switchedImmediately = await cdp.evaluate(`(() => {
        const fileAction = [...document.querySelectorAll('.tree-item')]
          .find((element) => (element.textContent || '').includes('00_Index.md'));
        if (!(fileAction instanceof HTMLElement)) return false;
        fileAction.click();
        return true;
      })()`);
      if (!switchedImmediately) throw new Error('Could not switch away from Excalidraw during the pending save window');
      await waitFor('Markdown editor after Excalidraw switch', () => cdp.evaluate(`Boolean(
        document.querySelector('.cm-editor .cm-content')
        && document.querySelector('.editor-titlebar')?.textContent?.includes('00_Index.md')
      )`), 30_000);
      await waitFor('Excalidraw unmount flush', () => countSceneElements() >= initialElementCount + 3, 15_000);
      const savedScene = JSON.parse(fs.readFileSync(excalidrawPath, 'utf8'));
      if (savedScene.type !== 'excalidraw' || savedScene.source !== 'ars-note' || !savedScene.files || typeof savedScene.files !== 'object') {
        throw new Error('Excalidraw save did not preserve the document envelope');
      }
    }

    if (teamSmoke) {
      const taskMarker = `TEAM_SMOKE_${Date.now()}`;
      const schedulePath = path.join(vaultPath, '.ars-team', 'schedule.json');
      await waitFor('team workspace navigation', () => cdp.evaluate(`(() => {
        const button = document.querySelector('.sidebar-rail-btn[title="Ars-note 团队工作台"]');
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`));
      await waitFor('team workspace panel', () => cdp.evaluate(`Boolean(document.querySelector('.team-schedule-panel .team-new-task-card'))`), 30_000);
      await assertArsNoteProductIdentity('Team workspace');
      const bootstrapResult = await cdp.evaluate(`window.arsnote.bootstrapTeamWorkspace(${JSON.stringify(vaultPath)}, { limit: 48 })`);
      if (!bootstrapResult?.productionDocs?.paths?.includes('.ars-team/team-command-center.md')) {
        throw new Error('Team workspace bootstrap did not generate the canonical command center');
      }
      const supersededCommandCenterPath = path.join(vaultPath, '.ars-team', 'retired-command-center.md');
      const canonicalCommandCenterPath = path.join(vaultPath, '.ars-team', 'team-command-center.md');
      const migrationArchiveDir = path.join(vaultPath, '.ars-team', 'legacy');
      await waitFor('superseded team command center migration', () => {
        if (fs.existsSync(supersededCommandCenterPath) || !fs.existsSync(canonicalCommandCenterPath) || !fs.existsSync(migrationArchiveDir)) return false;
        return fs.readdirSync(migrationArchiveDir).some((name) => {
          const content = fs.readFileSync(path.join(migrationArchiveDir, name), 'utf8');
          return content.includes('Preserve this customized content during migration.');
        });
      }, 15_000);
      const taskEntered = await cdp.evaluate(`(() => {
        const input = document.querySelector('.team-new-task-main input[placeholder^="任务名称"]');
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(taskMarker)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      if (!taskEntered) throw new Error('Team workspace task input was not interactive');
      await cdp.evaluate(`document.querySelector('.team-add-task-btn')?.click(); true`);
      await waitFor('team task persisted', () => {
        if (!fs.existsSync(schedulePath)) return false;
        try {
          const schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
          return Array.isArray(schedule.tasks) && schedule.tasks.some((task) => task.title === taskMarker);
        } catch {
          return false;
        }
      }, 15_000);
      await waitFor('team task visible', () => cdp.evaluate(`document.querySelector('.team-schedule-panel')?.textContent?.includes(${JSON.stringify(taskMarker)}) === true`));
      await cdp.evaluate(`([...document.querySelectorAll('.team-view-tabs button')].find((button) => (button.textContent || '').trim() === '任务表'))?.click(); true`);
      await waitFor('team table view', () => cdp.evaluate(`Boolean(
        document.querySelector('.team-schedule-table')
        && [...document.querySelectorAll('.team-schedule-table input')].some((input) => input.value === ${JSON.stringify(taskMarker)})
      )`));
      await cdp.evaluate(`([...document.querySelectorAll('.team-view-tabs button')].find((button) => (button.textContent || '').trim() === '看板'))?.click(); true`);
      await waitFor('team board view', () => cdp.evaluate(`Boolean(
        document.querySelector('.team-board-view')
        && document.querySelector('.team-board-view')?.textContent?.includes(${JSON.stringify(taskMarker)})
      )`));

      await cdp.evaluate(`([...document.querySelectorAll('.tree-item')].find((element) => (element.textContent || '').includes('00_Index.md')))?.click(); true`);
      await waitFor('team workspace dismissed', () => cdp.evaluate(`!document.querySelector('.team-schedule-panel')`));
      await cdp.evaluate(`document.querySelector('.sidebar-rail-btn[title="Ars-note 团队工作台"]')?.click(); true`);
      await waitFor('team task restored after reopen', () => cdp.evaluate(`document.querySelector('.team-schedule-panel')?.textContent?.includes(${JSON.stringify(taskMarker)}) === true`), 30_000);
    }

    if (exportSmoke) {
      const exportHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{color:#153252}table{border-collapse:collapse}th,td{border:1px solid #5b7ca8;padding:8px}.accent{color:#c2415d}</style></head><body><h1>Ars-note PDF Smoke</h1><table><thead><tr><th>System</th><th>Status</th></tr></thead><tbody><tr><td>Core loop</td><td class="accent">Ready</td></tr></tbody></table></body></html>';
      const exportResult = await cdp.evaluate(`window.arsnote.exportPdf(${JSON.stringify(exportHtml)}, '../unsafe:name.md')`);
      if (!exportResult?.ok || path.resolve(exportResult.path || '') !== path.resolve(pdfSmokeOutput)) {
        throw new Error(`PDF export did not return the isolated smoke output: ${JSON.stringify(exportResult)}`);
      }
      const pdfBytes = fs.readFileSync(pdfSmokeOutput);
      if (pdfBytes.length < 1_000 || pdfBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('PDF export did not produce a valid PDF payload');
      }
    }

    if (responsiveSmoke) {
      for (const viewport of [
        { width: 900, height: 640 },
        { width: 1180, height: 720 },
        { width: 1920, height: 1080 },
      ]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await cdp.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        const layout = await cdp.evaluate(`(() => {
          const rectOf = (selector) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) return null;
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          };
          return {
            innerWidth,
            innerHeight,
            scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
            app: rectOf('.app-layout'),
            main: rectOf('.main-content'),
            sidebar: rectOf('.sidebar'),
            rail: rectOf('.sidebar-rail'),
            editor: rectOf('.editor-area'),
            rightPanel: rectOf('.right-panel-wrapper:not(.collapsed)'),
          };
        })()`);
        const tolerance = 2;
        if (layout.innerWidth !== viewport.width || layout.innerHeight !== viewport.height) {
          throw new Error(`Responsive viewport did not apply at ${viewport.width}x${viewport.height}`);
        }
        if (!layout.app || !layout.main || !layout.sidebar || !layout.rail || !layout.editor) {
          throw new Error(`Responsive shell lost a required region at ${viewport.width}x${viewport.height}`);
        }
        if (layout.scrollWidth > layout.innerWidth + tolerance || layout.scrollHeight > layout.innerHeight + tolerance) {
          throw new Error(`Responsive shell caused global overflow at ${viewport.width}x${viewport.height}: ${layout.scrollWidth}x${layout.scrollHeight}`);
        }
        if (layout.editor.width < 420 || layout.editor.left < -tolerance || layout.editor.right > layout.innerWidth + tolerance) {
          throw new Error(`Responsive editor became clipped or too narrow at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout.editor)}`);
        }
        if (layout.rail.width < 36 || layout.rail.right > layout.innerWidth + tolerance) {
          throw new Error(`Responsive navigation rail became unusable at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout.rail)}`);
        }
        if (layout.rightPanel && (layout.rightPanel.left < -tolerance || layout.rightPanel.right > layout.innerWidth + tolerance)) {
          throw new Error(`Responsive right panel escaped the viewport at ${viewport.width}x${viewport.height}: ${JSON.stringify(layout.rightPanel)}`);
        }
      }
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    }

    if (syncRecoverySmoke) {
      const initialConflicts = await cdp.evaluate(`window.arsnote.scanSyncConflicts(${JSON.stringify(vaultPath)})`);
      const initialConflict = initialConflicts?.files?.find((file) => file.relativePath === 'Conflict.md.conflict-1001');
      if (initialConflicts?.count !== 1 || !initialConflict) throw new Error('Sync conflict scan did not find the live conflict artifact');
      const conflictPreview = await cdp.evaluate(`window.arsnote.previewSyncConflict(${JSON.stringify(vaultPath)}, 'Conflict.md.conflict-1001')`);
      if (!conflictPreview?.baseContent?.includes('Local version') || !conflictPreview.conflictContent?.includes('Remote version')) {
        throw new Error('Sync conflict preview did not preserve both versions');
      }
      const mergeDraft = await cdp.evaluate(`window.arsnote.createConflictMergeDraft(${JSON.stringify(vaultPath)}, 'Conflict.md.conflict-1001')`);
      if (!mergeDraft?.draftPath || !fs.existsSync(mergeDraft.draftPath)) throw new Error('Sync conflict merge draft was not created');
      const mergedContent = '# Conflict\n\nMerged local and remote version\n';
      const mergeResult = await cdp.evaluate(`window.arsnote.saveConflictMergeResult(${JSON.stringify(vaultPath)}, 'Conflict.md.conflict-1001', ${JSON.stringify(mergedContent)}, true)`);
      if (!mergeResult?.ok || fs.existsSync(path.join(vaultPath, 'Conflict.md.conflict-1001'))) throw new Error('Sync conflict merge did not remove the resolved artifact');
      if (fs.readFileSync(path.join(vaultPath, 'Conflict.md'), 'utf8') !== mergedContent) throw new Error('Sync conflict merge did not save the reviewed content');

      fs.writeFileSync(path.join(vaultPath, 'Conflict.md.conflict-1002'), '# Conflict\n\nSecond remote copy\n');
      const cleanupResult = await cdp.evaluate(`window.arsnote.cleanupSyncConflicts(${JSON.stringify(vaultPath)})`);
      if (!cleanupResult?.ok || cleanupResult.archivedCount !== 1) throw new Error('Sync conflict cleanup did not archive the remaining artifact');
      if (fs.existsSync(path.join(vaultPath, 'Conflict.md.conflict-1002'))) throw new Error('Sync conflict cleanup left the artifact beside the canonical note');
      const archiveRoot = path.join(vaultPath, cleanupResult.archiveRelativePath);
      if (!fs.existsSync(archiveRoot) || !fs.readFileSync(path.join(vaultPath, 'Conflict.md'), 'utf8').includes('Merged local and remote')) {
        throw new Error('Sync conflict cleanup did not preserve its recovery archive or canonical note');
      }
      const traversalConflictRejected = await cdp.evaluate(`window.arsnote.previewSyncConflict(${JSON.stringify(vaultPath)}, '../outside.md.conflict-1').then(() => false, () => true)`);
      if (!traversalConflictRejected) throw new Error('Sync conflict preview accepted a path traversal');
    }

    if (backupSmoke) {
      const backup = await cdp.evaluate(`window.arsnote.exportVaultBackup(${JSON.stringify(vaultPath)}, { skipIfUnchanged: true, keepLatest: 3 })`);
      if (!backup?.backupPath || backup.skipped) throw new Error('Initial backup export did not create a backup');
      const verification = await cdp.evaluate(`window.arsnote.verifyVaultBackup(${JSON.stringify(vaultPath)}, ${JSON.stringify(backup.backupPath)})`);
      if (!verification?.valid || verification.checkedFileCount < 1) throw new Error('Exported backup failed integrity verification');

      const beforeMutation = fs.readFileSync(targetDocumentPath, 'utf8');
      const postBackupMarker = `POST_BACKUP_${Date.now()}`;
      await cdp.evaluate(`window.arsnote.writeFile(${JSON.stringify(targetDocumentPath)}, ${JSON.stringify(`${beforeMutation}\n${postBackupMarker}`)})`);
      const fullRestore = await cdp.evaluate(`window.arsnote.restoreVaultBackup(${JSON.stringify(vaultPath)}, ${JSON.stringify(backup.backupPath)})`);
      if (!fullRestore?.restoredTo || path.resolve(fullRestore.restoredTo) === path.resolve(vaultPath)) {
        throw new Error('Full backup restore did not create an isolated sibling Vault');
      }
      const restoredDocumentPath = path.join(fullRestore.restoredTo, path.relative(vaultPath, targetDocumentPath));
      const originalAfterRestore = fs.readFileSync(targetDocumentPath, 'utf8');
      const restoredContent = fs.readFileSync(restoredDocumentPath, 'utf8');
      if (!originalAfterRestore.includes(postBackupMarker)) throw new Error('Full restore unexpectedly overwrote the active Vault');
      if (!restoredContent.includes(marker) || restoredContent.includes(postBackupMarker)) throw new Error('Restored Vault content does not match the backup snapshot');

      await cdp.evaluate(`window.arsnote.restoreVaultBackupFile(${JSON.stringify(vaultPath)}, ${JSON.stringify(backup.backupPath)}, ${JSON.stringify(path.relative(vaultPath, targetDocumentPath).replace(/\\/g, '/'))})`);
      if (fs.readFileSync(targetDocumentPath, 'utf8').includes(postBackupMarker)) throw new Error('Single-file backup restore did not restore the selected version');
      const traversalRejected = await cdp.evaluate(`window.arsnote.restoreVaultBackupFile(${JSON.stringify(vaultPath)}, ${JSON.stringify(backup.backupPath)}, '../outside.md').then(() => false, () => true)`);
      if (!traversalRejected) throw new Error('Backup file restore accepted a path traversal');
      const outsideDeleteRejected = await cdp.evaluate(`window.arsnote.deleteVaultBackup(${JSON.stringify(vaultPath)}, ${JSON.stringify(vaultPath)}).then(() => false, () => true)`);
      if (!outsideDeleteRejected) throw new Error('Backup deletion accepted a path outside the backup directory');

      const unchanged = await cdp.evaluate(`window.arsnote.exportVaultBackup(${JSON.stringify(vaultPath)}, { skipIfUnchanged: true, keepLatest: 3 })`);
      if (!unchanged?.skipped || unchanged.backupId !== backup.backupId) throw new Error('Unchanged Vault created a duplicate backup');
      await cdp.evaluate(`window.arsnote.deleteVaultBackup(${JSON.stringify(vaultPath)}, ${JSON.stringify(backup.backupPath)})`);
      if (fs.existsSync(backup.backupPath)) throw new Error('Backup delete returned without removing the backup folder');
    }

    if (visualWorkspaceSmoke) {
      await waitFor('mind map canvas open action', () => cdp.evaluate(`(() => {
        const fileAction = [...document.querySelectorAll('.tree-item')]
          .find((element) => (element.textContent || '').includes('Visual.canvas'));
        if (!(fileAction instanceof HTMLElement)) return false;
        fileAction.click();
        return true;
      })()`));
      await waitFor('mind map canvas workspace', () => cdp.evaluate(`Boolean(
        document.querySelector('.canvas-editor.canvas-mode-mindmap')
        && document.querySelectorAll('.canvas-card.mindmap-card').length === 4
        && !document.querySelector('.document-opening-overlay')
      )`), 20_000);

      await cdp.evaluate(`([...document.querySelectorAll('.canvas-toolbar button')].find((button) => (button.title || '').includes('导图大纲')))?.click(); true`);
      await waitFor('docked mind map outline', () => cdp.evaluate(`(() => {
        const outline = document.querySelector('.canvas-mindmap-outline');
        const viewport = document.querySelector('.canvas-viewport');
        if (!(outline instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return false;
        if (window.innerWidth <= 1100) return true;
        return outline.getBoundingClientRect().right <= viewport.getBoundingClientRect().left + 1;
      })()`));

      const alphaPoint = await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('.canvas-card.mindmap-card')]
          .find((element) => element.getAttribute('aria-label') === 'Alpha branch');
        if (!(card instanceof HTMLElement)) return null;
        const rect = card.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return document.elementFromPoint(x, y)?.closest('.canvas-card') === card ? { x, y } : null;
      })()`);
      if (!alphaPoint) throw new Error('Mind map card failed coordinate hit testing');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: alphaPoint.x, y: alphaPoint.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: alphaPoint.x, y: alphaPoint.y, button: 'left', clickCount: 1 });
      await waitFor('intended mind map card selection', () => cdp.evaluate(`document.querySelector('.canvas-card[aria-label="Alpha branch"]')?.getAttribute('aria-pressed') === 'true'`));

      await cdp.evaluate(`([...document.querySelectorAll('.canvas-toolbar button')].find((button) => (button.title || '').includes('搜索主题')))?.click(); true`);
      await waitFor('mind map search panel', () => cdp.evaluate(`Boolean(document.querySelector('.canvas-mindmap-search input'))`));
      await cdp.evaluate(`document.querySelector('.canvas-mindmap-search input')?.focus(); true`);
      await cdp.send('Input.insertText', { text: 'Alpha branch' });
      await waitFor('mind map search result', () => cdp.evaluate(`Boolean(
        document.querySelector('.canvas-card.mindmap-search-active[aria-label="Alpha branch"]')
        && document.querySelector('.canvas-mindmap-search-count')?.textContent?.includes('1/1')
      )`));
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await waitFor('mind map search dismissed', () => cdp.evaluate(`!document.querySelector('.canvas-mindmap-search')`));

      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await waitFor('mind map child creation', () => cdp.evaluate(`Boolean(
        document.querySelectorAll('.canvas-card.mindmap-card').length === 5
        && document.querySelector('.canvas-card-editor')
      )`));
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await cdp.send('Input.insertText', { text: 'Smoke generated child' });
      await cdp.evaluate(`([...document.querySelectorAll('.canvas-toolbar button')].find((button) => (button.textContent || '').trim() === '整理'))?.click(); true`);
      const canvasPath = path.join(vaultPath, 'Visual.canvas');
      await waitFor('mind map structural autosave', () => cdp.evaluate(`window.arsnote.readFile(${JSON.stringify(canvasPath)}).then((text) => text.includes('Smoke generated child'))`), 15_000);

      const selectedAlphaAgain = await cdp.evaluate(`(() => {
        const card = document.querySelector('.canvas-card[aria-label="Alpha branch"]');
        if (!(card instanceof HTMLElement)) return false;
        card.focus();
        return true;
      })()`);
      if (!selectedAlphaAgain) throw new Error('Mind map branch disappeared after adding a child');
      await cdp.evaluate(`document.querySelector('.canvas-card[aria-label="Alpha branch"]')?.dispatchEvent(new FocusEvent('focus', { bubbles: true })); true`);
      await cdp.evaluate(`document.querySelector('.canvas-toolbar button[aria-label="更多导图操作"]')?.click(); true`);
      await waitFor('mind map more menu', () => cdp.evaluate(`Boolean(document.querySelector('.canvas-more-popover[role="menu"]'))`));
      await cdp.evaluate(`document.querySelector('.canvas-more-popover button[aria-label="同级下移"]')?.click(); true`);
      await waitFor('mind map sibling reorder', () => cdp.evaluate(`window.arsnote.readFile(${JSON.stringify(canvasPath)}).then((text) => {
        const data = JSON.parse(text);
        return data.edges.findIndex((edge) => edge.id === 'root-c') < data.edges.findIndex((edge) => edge.id === 'root-a');
      })`), 15_000);

      await waitFor('knowledge graph navigation', () => cdp.evaluate(`(() => {
        const button = [...document.querySelectorAll('.sidebar-rail-btn')]
          .find((element) => /graph|图谱/i.test(element.getAttribute('title') || ''));
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      })()`));
      await waitFor('knowledge graph render', () => cdp.evaluate(`Boolean(
        document.querySelector('.graph-panel-v2 .graph-svg-v2')
        && document.querySelectorAll('.graph-node-g').length >= 3
      )`), 20_000);
      await cdp.evaluate(`document.querySelector('.graph-search-input')?.focus(); true`);
      await cdp.send('Input.insertText', { text: 'Design-A' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await waitFor('knowledge graph search selection', () => cdp.evaluate(`Boolean(
        document.querySelector('.graph-detail-title')?.textContent?.includes('Design A')
        && document.querySelector('.graph-detail-path')?.textContent?.includes('Design-A.md')
      )`));
      await cdp.evaluate(`document.querySelector('.graph-physics-toggle')?.click(); true`);
      await waitFor('knowledge graph physics pause', () => cdp.evaluate(`document.querySelector('.graph-stats-bar .physics-chip')?.classList.contains('paused') === true`));
    }

    if (aiSmoke && fakeAIProvider) {
      await cdp.evaluate(`window.arsnote.setAIRuntimeConfig(${JSON.stringify(vaultPath)}, {
        provider: 'openai-compatible',
        baseUrl: ${JSON.stringify(fakeAIProvider.baseUrl)},
        model: 'smoke-model',
        apiKey: 'smoke-secret'
      })`);
      const aiRuntimeConfigPath = path.join(userData, 'ai-runtime-configs.json');
      await waitFor('protected AI credential persistence', () => fs.existsSync(aiRuntimeConfigPath));
      const persistedAIConfig = fs.readFileSync(aiRuntimeConfigPath, 'utf8');
      if (persistedAIConfig.includes('smoke-secret') || !persistedAIConfig.includes('ars-note-safe:v1:')) {
        throw new Error('AI runtime credential was not protected by OS-backed encryption on disk');
      }
      const aiStatus = await cdp.evaluate(`window.arsnote.getAIRuntimeStatus(${JSON.stringify(vaultPath)})`);
      if (!aiStatus?.hasConfig || !aiStatus.hasApiKey) throw new Error('AI runtime credentials were not available after configuration');
      const aiConnection = await cdp.evaluate(`window.arsnote.testAIConnection(${JSON.stringify(vaultPath)})`);
      if (!aiConnection?.ok || aiConnection.model !== 'smoke-model') throw new Error('AI provider connection test failed');
      const aiResult = await cdp.evaluate(`window.arsnote.sendAIChat(${JSON.stringify(vaultPath)}, [
        { role: 'system', content: 'You are Ars-note.' },
        { role: 'user', content: 'AI_SMOKE_REQUEST' }
      ], { controlMode: 'readonly', requestId: 'ai-smoke-success' })`);
      if (!aiResult?.ok || aiResult.content !== 'AI_SMOKE_REPLY') throw new Error('AI chat did not return the provider response');
      await cdp.evaluate(`window.arsnote.aiSaveConversation(${JSON.stringify(vaultPath)}, [
        { role: 'user', content: 'AI_SMOKE_REQUEST' },
        { role: 'assistant', content: 'AI_SMOKE_REPLY' }
      ])`);
      const restoredConversation = await cdp.evaluate(`window.arsnote.aiLoadLatestConversation(${JSON.stringify(vaultPath)})`);
      if (!Array.isArray(restoredConversation) || !restoredConversation.some((message) => message.content === 'AI_SMOKE_REPLY')) {
        throw new Error('AI conversation was not restored from Vault history');
      }

      await cdp.evaluate(`(() => {
        window.__arsNoteCancelSmoke = window.arsnote.sendAIChat(${JSON.stringify(vaultPath)}, [
          { role: 'system', content: 'You are Ars-note.' },
          { role: 'user', content: 'AI_CANCEL_SMOKE' }
        ], { controlMode: 'readonly', requestId: 'ai-smoke-cancel' });
        return true;
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const cancelAccepted = await cdp.evaluate(`window.arsnote.cancelAIChat('ai-smoke-cancel')`);
      const cancelledResult = await cdp.evaluate(`window.__arsNoteCancelSmoke`);
      if (!cancelAccepted?.ok || !cancelledResult?.cancelled) throw new Error('AI cancellation did not abort the active request');
      if (fakeAIProvider.requests.length < 3 || fakeAIProvider.requests.some((request) => request.authorization !== 'Bearer smoke-secret')) {
        throw new Error('AI provider requests did not consistently use the protected authorization header');
      }
      await cdp.evaluate(`window.arsnote.clearAIRuntimeConfig(${JSON.stringify(vaultPath)})`);
      const clearedAIStatus = await cdp.evaluate(`window.arsnote.getAIRuntimeStatus(${JSON.stringify(vaultPath)})`);
      if (clearedAIStatus?.hasConfig) throw new Error('AI runtime credentials were not cleared');
    }

    await waitFor('backup workspace navigation', () => cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('.sidebar-rail-btn')]
        .find((element) => {
          const title = element.getAttribute('title') || '';
          return title === 'Backup' || title.includes('备份');
        });
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`));
    await waitFor('backup lazy workspace', () => cdp.evaluate(`Boolean(
      document.querySelector('.right-panel-content .backup-panel')
      && document.querySelector('.backup-retention-card')
    )`), 15_000);
    await waitFor('settings workspace navigation', () => cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('.sidebar-rail-btn')]
        .find((element) => {
          const title = element.getAttribute('title') || '';
          return title === 'Settings' || title.includes('设置');
        });
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`));
    await waitFor('settings lazy workspace', () => cdp.evaluate(`Boolean(
      document.querySelector('.app-layout.settings-modal-open .settings-panel')
      && document.querySelector('.ars-settings-sidebar')
    )`), 15_000);
    await assertArsNoteProductIdentity('Settings workspace');
    await cdp.evaluate(`document.querySelector('.ars-settings-back')?.click(); true`);
    await waitFor('settings workspace dismissed', () => cdp.evaluate(`!document.querySelector('.app-layout.settings-modal-open')`));
    await waitFor('balance lab navigation', () => cdp.evaluate(`(() => {
      const button = document.querySelector('.sidebar-rail-btn[title="数值实验室"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`));
    await waitFor('balance lab workspace', () => cdp.evaluate(`Boolean(
      document.querySelector('.balance-lab')
      && document.querySelectorAll('.balance-model-tabs button').length === 4
      && document.querySelectorAll('.balance-metrics article').length === 4
      && document.querySelector('.balance-chart path')
    )`), 15_000);
    const balanceCombatReady = await cdp.evaluate(`(() => {
      const combatTab = [...document.querySelectorAll('.balance-model-tabs button')]
        .find((button) => (button.textContent || '').includes('战斗伤害'));
      if (!(combatTab instanceof HTMLElement)) return false;
      combatTab.click();
      return Boolean(document.querySelector('.balance-controls-panel'));
    })()`);
    if (!balanceCombatReady) throw new Error('Balance Lab combat model failed to render');
    await cdp.evaluate(`document.querySelector('.balance-save-row button')?.click(); true`);
    const balanceScenarioPath = path.join(vaultPath, '.ars-team', 'balance-lab.json');
    await waitFor('balance lab Vault persistence', () => cdp.evaluate(`window.arsnote.readFile(${JSON.stringify(balanceScenarioPath)}).then((text) => {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed.scenarios) && parsed.scenarios.some((scenario) => scenario.kind === 'combat');
    }).catch(() => false)`), 15_000);
    await cdp.evaluate(`([...document.querySelectorAll('.balance-analysis-tabs button')].find((button) => (button.textContent || '').includes('敏感性')))?.click(); true`);
    await waitFor('balance sensitivity analysis', () => cdp.evaluate(`Boolean(
      document.querySelector('.balance-analysis-options .balance-sensitivity-level')
      && document.querySelector('.balance-chart path')
      && document.querySelectorAll('.balance-table-card tbody tr').length >= 5
    )`), 15_000);
    await cdp.evaluate(`([...document.querySelectorAll('.balance-analysis-tabs button')].find((button) => (button.textContent || '').includes('方案对比')))?.click(); true`);
    await waitFor('balance comparison selector', () => cdp.evaluate(`Boolean(document.querySelector('.balance-compare-picker button'))`), 15_000);
    await cdp.evaluate(`document.querySelector('.balance-compare-picker button')?.click(); true`);
    await waitFor('balance comparison chart', () => cdp.evaluate(`Boolean(
      document.querySelectorAll('.balance-comparison-chart .balance-chart > path').length >= 2
      && document.querySelectorAll('.balance-table-card tbody tr').length >= 2
    )`), 15_000);
    await cdp.evaluate(`document.querySelector('.balance-lab-header .balance-icon-btn:last-child')?.click(); true`);
    await waitFor('balance lab dismissed', () => cdp.evaluate(`!document.querySelector('.balance-lab')`));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const longTaskSummary = await cdp.evaluate(`(() => {
      const entries = Array.isArray(window.__arsNoteLongTasks) ? window.__arsNoteLongTasks : [];
      return {
        count: entries.length,
        max: entries.reduce((value, entry) => Math.max(value, entry.duration || 0), 0),
        total: entries.reduce((value, entry) => value + (entry.duration || 0), 0),
      };
    })()`);
    const editorMeasureSummary = await cdp.evaluate(`(() => {
      const names = [
        'ars-note:live-preview-decorations',
        'ars-note:editor-state-create',
        'ars-note:editor-view-mount',
        'ars-note:editor-external-update',
        'ars-note:editor-document-switch',
        'ars-note:editor-document-chunk',
        'ars-note:editor-progressive-load',
      ];
      return Object.fromEntries(names.map((name) => {
        const entries = performance.getEntriesByName(name);
        return [name, {
          count: entries.length,
          max: entries.reduce((value, entry) => Math.max(value, entry.duration || 0), 0),
          total: entries.reduce((value, entry) => value + (entry.duration || 0), 0),
        }];
      }));
    })()`);

    const performanceBudget = {
      documentReadyMs: readPositiveBudget('ARS_NOTE_MAX_LARGE_DOCUMENT_READY_MS', 25_000),
      maxLongTaskMs: readPositiveBudget('ARS_NOTE_MAX_LONG_TASK_MS', 5_000),
    };
    const measuredDocumentReadyMs = documentSwitchMs || initialDocumentReadyMs;
    if ((largeDocumentSmoke || process.env.ARS_NOTE_SMOKE_DOCUMENT) && measuredDocumentReadyMs > performanceBudget.documentReadyMs) {
      throw new Error(`Large document became ready in ${measuredDocumentReadyMs}ms, above the ${performanceBudget.documentReadyMs}ms release budget`);
    }
    if ((largeDocumentSmoke || process.env.ARS_NOTE_SMOKE_DOCUMENT) && longTaskSummary.max > performanceBudget.maxLongTaskMs) {
      throw new Error(`Renderer long task reached ${Math.round(longTaskSummary.max)}ms, above the ${performanceBudget.maxLongTaskMs}ms release budget`);
    }

    const totalMs = Date.now() - startedAt;
    const mode = [
      process.env.ARS_NOTE_LARGE_VAULT_SMOKE === '1' ? 'large-vault' : '',
      largeDocumentSmoke ? 'large-document' : '',
      responsiveSmoke ? 'responsive' : '',
      exportSmoke ? 'export' : '',
    ].filter(Boolean).join('+');
    console.log(`Desktop ${mode ? `${mode} ` : ''}smoke passed: welcome=${welcomeMs}ms workspace=${workspaceMs}ms initialEditor=${initialEditorMs}ms documentReady=${measuredDocumentReadyMs}ms switch=${documentSwitchMs}ms editor=${editorMs}ms edit+save=${totalMs}ms longTasks=${longTaskSummary.count} maxLongTask=${Math.round(longTaskSummary.max)}ms totalLongTask=${Math.round(longTaskSummary.total)}ms`);
    if (largeDocumentSmoke || process.env.ARS_NOTE_SMOKE_DOCUMENT) {
      console.log(`Large document budgets: ready<=${performanceBudget.documentReadyMs}ms maxLongTask<=${performanceBudget.maxLongTaskMs}ms`);
    }
    console.log(`Editor performance measures: ${JSON.stringify(editorMeasureSummary)}`);
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
    if (fakeAIProvider) await fakeAIProvider.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
