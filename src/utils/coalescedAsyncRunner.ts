export interface CoalescedAsyncRunner {
  runNow: () => Promise<void>;
  schedule: (delayMs?: number) => void;
  cancel: () => void;
  isPending: () => boolean;
}

export function createCoalescedAsyncRunner(
  task: () => Promise<void>,
  defaultDelayMs = 750,
  onScheduledError: (error: unknown) => void = () => {},
): CoalescedAsyncRunner {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let rerunRequested = false;
  let cancelled = false;

  const clearScheduledTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const execute = (): Promise<void> => {
    if (cancelled) return Promise.resolve();
    if (running) {
      rerunRequested = true;
      return running;
    }

    const operation = (async () => {
      do {
        rerunRequested = false;
        await task();
      } while (rerunRequested && !cancelled);
    })();
    running = operation;
    operation.then(
      () => { if (running === operation) running = null; },
      () => {
        rerunRequested = false;
        if (running === operation) running = null;
      },
    );
    return operation;
  };

  return {
    runNow: () => {
      clearScheduledTimer();
      return execute();
    },
    schedule: (delayMs = defaultDelayMs) => {
      if (cancelled) return;
      clearScheduledTimer();
      timer = setTimeout(() => {
        timer = null;
        void execute().catch(onScheduledError);
      }, Math.max(0, delayMs));
    },
    cancel: () => {
      cancelled = true;
      rerunRequested = false;
      clearScheduledTimer();
    },
    isPending: () => !!timer || !!running || rerunRequested,
  };
}
