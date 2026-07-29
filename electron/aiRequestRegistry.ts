export type AIRequestAbortReason = 'cancelled' | 'timeout' | null;

interface AIRequestEntry {
  controller: AbortController;
  reason: AIRequestAbortReason;
  timeout: ReturnType<typeof setTimeout>;
}

export interface AIRequestHandle {
  signal: AbortSignal;
  getAbortReason: () => AIRequestAbortReason;
  dispose: () => void;
}

export class AIRequestRegistry {
  private readonly requests = new Map<string, AIRequestEntry>();

  private buildKey(clientId: number, requestId: string): string {
    return `${clientId}:${requestId}`;
  }

  begin(clientId: number, requestId: string, timeoutMs = 300_000): AIRequestHandle {
    const key = this.buildKey(clientId, requestId);
    const previous = this.requests.get(key);
    if (previous) {
      clearTimeout(previous.timeout);
      previous.reason = 'cancelled';
      previous.controller.abort();
    }

    const controller = new AbortController();
    let entry: AIRequestEntry;
    const timeout = setTimeout(() => {
      if (entry.controller.signal.aborted) return;
      entry.reason = 'timeout';
      entry.controller.abort();
    }, timeoutMs);
    entry = { controller, reason: null, timeout };
    this.requests.set(key, entry);

    return {
      signal: entry.controller.signal,
      getAbortReason: () => entry.reason,
      dispose: () => {
        if (this.requests.get(key) !== entry) return;
        clearTimeout(entry.timeout);
        this.requests.delete(key);
      },
    };
  }

  cancel(clientId: number, requestId: string): boolean {
    const entry = this.requests.get(this.buildKey(clientId, requestId));
    if (!entry || entry.controller.signal.aborted) return false;
    entry.reason = 'cancelled';
    entry.controller.abort();
    return true;
  }

  get activeCount(): number {
    return this.requests.size;
  }
}
