type Job = () => Promise<void>;

/**
 * In-process job queue with bounded concurrency.
 *
 * Audits are long (30-90s) and browser-bound, so the constraint is Chromium
 * instances, not HTTP workers. When this needs to become a separate service,
 * only `enqueue` changes.
 */
class JobQueue {
  private queue: { id: string; job: Job }[] = [];
  private running = 0;
  private concurrency: number;

  constructor(concurrency = Number(process.env.AUDIT_CONCURRENCY ?? 2)) {
    this.concurrency = Math.max(1, concurrency);
  }

  enqueue(id: string, job: Job) {
    this.queue.push({ id, job });
    queueMicrotask(() => this.drain());
  }

  get depth() { return this.queue.length; }

  private drain() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.running++;
      next
        .job()
        .catch((err) => {
          console.error(`[queue] job ${next.id} failed`, err);
        })
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }
}

// Survives Next.js dev-mode module reloads.
const globalForQueue = globalThis as unknown as { __brandAuditQueue?: JobQueue };
export const jobQueue = globalForQueue.__brandAuditQueue ?? new JobQueue();
globalForQueue.__brandAuditQueue = jobQueue;
