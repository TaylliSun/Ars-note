import type { AIDesignQualityReport } from '../types';
import {
  DesignQualityAuditCache,
  type DesignQualityAuditRequest,
} from './designQualityAuditCache';

interface AuditWorkerResponse {
  id: number;
  ok: boolean;
  report?: AIDesignQualityReport;
  error?: string;
}

interface PendingAudit {
  resolve: (report: AIDesignQualityReport) => void;
  reject: (reason: Error) => void;
  timeout: number;
}

const WORKER_TIMEOUT_MS = 15_000;
const auditCache = new DesignQualityAuditCache(12);
const pendingAudits = new Map<number, PendingAudit>();
let auditWorker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;

function disableWorker(reason: Error): void {
  workerUnavailable = true;
  auditWorker?.terminate();
  auditWorker = null;
  for (const pending of pendingAudits.values()) {
    window.clearTimeout(pending.timeout);
    pending.reject(reason);
  }
  pendingAudits.clear();
}

function getAuditWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') return null;
  if (auditWorker) return auditWorker;

  try {
    auditWorker = new Worker(new URL('../workers/designQualityWorker.ts', import.meta.url), {
      type: 'module',
      name: 'ars-note-design-quality',
    });
    auditWorker.addEventListener('message', (event: MessageEvent<AuditWorkerResponse>) => {
      const response = event.data;
      const pending = pendingAudits.get(response.id);
      if (!pending) return;
      pendingAudits.delete(response.id);
      window.clearTimeout(pending.timeout);
      if (response.ok && response.report) pending.resolve(response.report);
      else pending.reject(new Error(response.error || 'Design quality worker failed'));
    });
    auditWorker.addEventListener('error', (event) => {
      disableWorker(new Error(event.message || 'Design quality worker crashed'));
    });
    auditWorker.addEventListener('messageerror', () => {
      disableWorker(new Error('Design quality worker returned an unreadable response'));
    });
    return auditWorker;
  } catch (reason) {
    disableWorker(reason instanceof Error ? reason : new Error(String(reason)));
    return null;
  }
}

function runInWorker(request: DesignQualityAuditRequest): Promise<AIDesignQualityReport> {
  const worker = getAuditWorker();
  if (!worker) return Promise.reject(new Error('Design quality worker is unavailable'));

  const id = nextRequestId;
  nextRequestId += 1;
  return new Promise<AIDesignQualityReport>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (!pendingAudits.has(id)) return;
      disableWorker(new Error('Design quality worker timed out'));
    }, WORKER_TIMEOUT_MS);
    pendingAudits.set(id, { resolve, reject, timeout });
    worker.postMessage({ id, request });
  });
}

async function runAudit(request: DesignQualityAuditRequest): Promise<AIDesignQualityReport> {
  try {
    return await runInWorker(request);
  } catch {
    return window.arsnote.aiAuditDesignDocument(
      request.filePath,
      request.content,
      request.options,
    );
  }
}

export function requestDesignQualityAudit(
  request: DesignQualityAuditRequest,
  options: { force?: boolean } = {},
): Promise<AIDesignQualityReport> {
  return auditCache.request(request, runAudit, options);
}

export function clearDesignQualityAuditCache(): void {
  auditCache.clear();
}
