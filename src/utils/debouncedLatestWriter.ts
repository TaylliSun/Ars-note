export interface DebouncedLatestWriter<T> {
  schedule: (value: T, delayMs?: number) => void;
  flush: () => Promise<void>;
  cancel: () => void;
  hasPending: () => boolean;
}

export function createDebouncedLatestWriter<T>(
  write: (value: T) => Promise<void>,
  defaultDelayMs = 450,
  onScheduledError: (error: unknown) => void = () => {},
): DebouncedLatestWriter<T> {
  const EMPTY = Symbol('empty');
  let pending: T | typeof EMPTY = EMPTY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let cancelled = false;

  const clearScheduledTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const drain = (): Promise<void> => {
    if (cancelled) return Promise.resolve();
    if (running) return running;

    const operation = (async () => {
      while (!cancelled && pending !== EMPTY) {
        const value = pending as T;
        pending = EMPTY;
        try {
          await write(value);
        } catch (error) {
          if (pending === EMPTY) pending = value;
          throw error;
        }
      }
      if (pending === EMPTY) clearScheduledTimer();
    })();
    running = operation;
    operation.then(
      () => { if (running === operation) running = null; },
      () => { if (running === operation) running = null; },
    );
    return operation;
  };

  const scheduleDrain = (delayMs: number) => {
    clearScheduledTimer();
    timer = setTimeout(() => {
      timer = null;
      void drain().catch(onScheduledError);
    }, Math.max(0, delayMs));
  };

  return {
    schedule: (value, delayMs = defaultDelayMs) => {
      if (cancelled) return;
      pending = value;
      scheduleDrain(delayMs);
    },
    flush: async () => {
      if (cancelled) return;
      clearScheduledTimer();
      while (!cancelled && (pending !== EMPTY || running)) {
        clearScheduledTimer();
        if (running) await running;
        else await drain();
      }
      clearScheduledTimer();
    },
    cancel: () => {
      cancelled = true;
      pending = EMPTY;
      clearScheduledTimer();
    },
    hasPending: () => pending !== EMPTY || !!timer || !!running,
  };
}
