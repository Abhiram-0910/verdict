/**
 * capture/queue.ts
 *
 * In-process single-concurrency job queue.
 *
 * Render.com free tier has a 512 MB RAM ceiling. A single Playwright
 * Chromium instance uses ~80–300 MB depending on page complexity. This
 * queue ensures only one capture job runs at a time — never a pool of
 * concurrent browsers.
 *
 * Jobs are processed in FIFO order. A new job is rejected only if it
 * explicitly rejects — the queue itself never drops jobs.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Job<T = any> = () => Promise<T>;

interface QueueEntry {
  job: Job;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (value: any) => void;
  reject: (reason: unknown) => void;
}

let isRunning = false;
const pending: QueueEntry[] = [];

function tick(): void {
  if (isRunning || pending.length === 0) return;
  isRunning = true;

  const entry = pending.shift()!;

  entry.job().then(
    (result) => {
      entry.resolve(result);
      isRunning = false;
      tick();
    },
    (err: unknown) => {
      entry.reject(err);
      isRunning = false;
      tick();
    },
  );
}

/**
 * Enqueue a job. Returns a Promise that resolves (or rejects) when the
 * job eventually runs. Jobs are never dropped — they wait indefinitely.
 */
export function enqueue<T>(job: Job<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push({ job, resolve, reject });
    tick();
  });
}

/**
 * Total jobs currently waiting or running. Exposed for health-check
 * endpoints — do not use for concurrency control.
 */
export function queueDepth(): number {
  return pending.length + (isRunning ? 1 : 0);
}
