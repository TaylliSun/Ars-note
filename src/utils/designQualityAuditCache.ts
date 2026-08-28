import type { AIDesignQualityReport } from '../types';

export interface DesignQualityAuditOptions {
  totalCharacterCount?: number;
  sampled?: boolean;
}

export interface DesignQualityAuditRequest {
  filePath: string;
  content: string;
  options?: DesignQualityAuditOptions;
}

export interface DesignQualityAuditCacheStats {
  hits: number;
  joins: number;
  runs: number;
  entries: number;
  inFlight: number;
}

export type DesignQualityAuditRunner = (
  request: DesignQualityAuditRequest,
) => Promise<AIDesignQualityReport>;

function normalizePath(filePath: string): string {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function fingerprint(content: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
    second ^= second >>> 13;
  }

  return `${content.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

export function createDesignQualityAuditKey(request: DesignQualityAuditRequest): string {
  const totalCharacterCount = Math.max(
    request.content.length,
    Number(request.options?.totalCharacterCount || 0),
  );
  return [
    normalizePath(request.filePath),
    totalCharacterCount,
    request.options?.sampled ? 'sampled' : 'full',
    fingerprint(request.content),
  ].join('\u0000');
}

export class DesignQualityAuditCache {
  private readonly completed = new Map<string, AIDesignQualityReport>();
  private readonly pending = new Map<string, Promise<AIDesignQualityReport>>();
  private hits = 0;
  private joins = 0;
  private runs = 0;

  constructor(private readonly maxEntries = 12) {}

  request(
    request: DesignQualityAuditRequest,
    runner: DesignQualityAuditRunner,
    options: { force?: boolean } = {},
  ): Promise<AIDesignQualityReport> {
    const key = createDesignQualityAuditKey(request);
    if (options.force) this.completed.delete(key);

    const cached = this.completed.get(key);
    if (cached) {
      this.hits += 1;
      this.completed.delete(key);
      this.completed.set(key, cached);
      return Promise.resolve(cached);
    }

    const active = this.pending.get(key);
    if (active) {
      this.joins += 1;
      return active;
    }

    this.runs += 1;
    const execution = Promise.resolve()
      .then(() => runner(request))
      .then((report) => {
        this.completed.delete(key);
        this.completed.set(key, report);
        while (this.completed.size > Math.max(1, this.maxEntries)) {
          const oldest = this.completed.keys().next().value as string | undefined;
          if (!oldest) break;
          this.completed.delete(oldest);
        }
        return report;
      })
      .finally(() => {
        if (this.pending.get(key) === execution) this.pending.delete(key);
      });

    this.pending.set(key, execution);
    return execution;
  }

  clear(): void {
    this.completed.clear();
  }

  getStats(): DesignQualityAuditCacheStats {
    return {
      hits: this.hits,
      joins: this.joins,
      runs: this.runs,
      entries: this.completed.size,
      inFlight: this.pending.size,
    };
  }
}
