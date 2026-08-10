// The platform-agnostic sync engine. It owns the control flow only; all I/O is
// delegated to injected ports (SyncStore, SyncTransport, NetworkMonitor). One
// pass = drain the outbox (push) then apply the server feed (pull). Passes are
// single-flight so concurrent triggers can never race, and a pass that fails on
// the network leaves the outbox intact for the next attempt.
import type { Clock, NetworkMonitor, StoredMutation, SyncStore, SyncTransport } from "./ports";
import type { Mutation } from "./protocol";
import { initialStatus, type SyncStatus } from "./status";

export interface SyncEngineOptions {
  store: SyncStore;
  transport: SyncTransport;
  network: NetworkMonitor;
  clock?: Clock;
  /** Mutations per push request. */
  pushBatch?: number;
  /** Changes per pull page. */
  pullBatch?: number;
  /** First retry delay; doubles per attempt up to {@link maxBackoffMs}. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Notified on every status transition, for the UI badge. */
  onStatus?: (status: SyncStatus) => void;
}

const DEFAULTS = {
  pushBatch: 50,
  pullBatch: 200,
  baseBackoffMs: 2000,
  maxBackoffMs: 5 * 60 * 1000,
};

export class SyncEngine {
  private readonly store: SyncStore;
  private readonly transport: SyncTransport;
  private readonly network: NetworkMonitor;
  private readonly clock: Clock;
  private readonly cfg: typeof DEFAULTS;
  private readonly onStatus?: (status: SyncStatus) => void;

  // Single-flight: `running` is the mutex; `queued` remembers that a trigger
  // arrived mid-pass so exactly one more pass runs after the current one.
  private running = false;
  private queued = false;
  private started = false;
  private unsubscribe: (() => void) | null = null;
  private status: SyncStatus;

  constructor(opts: SyncEngineOptions) {
    this.store = opts.store;
    this.transport = opts.transport;
    this.network = opts.network;
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.cfg = {
      pushBatch: opts.pushBatch ?? DEFAULTS.pushBatch,
      pullBatch: opts.pullBatch ?? DEFAULTS.pullBatch,
      baseBackoffMs: opts.baseBackoffMs ?? DEFAULTS.baseBackoffMs,
      maxBackoffMs: opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
    };
    this.onStatus = opts.onStatus;
    this.status = initialStatus(this.network.isOnline());
  }

  /** Begin watching connectivity and run an initial sync. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.network.subscribe((online) => {
      this.patch({ online, phase: online ? this.status.phase : "offline" });
      if (online) void this.sync();
    });
    void this.sync();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.started = false;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Queue a local write and kick a sync. The write is durable before we return. */
  async enqueue(mutation: Mutation): Promise<void> {
    await this.store.enqueue(mutation);
    this.patch({ pending: await this.store.pendingCount() });
    void this.sync();
  }

  /**
   * Run one sync pass, guaranteeing single-flight. A call during an active pass
   * sets `queued` so one further pass runs afterwards - collapsing a burst of
   * triggers into at most one pending pass.
   */
  async sync(): Promise<void> {
    if (!this.network.isOnline()) {
      this.patch({ phase: "offline" });
      return;
    }
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    this.patch({ phase: "syncing", lastError: null });
    try {
      await this.pushDrain();
      await this.pullDrain();
      this.patch({
        phase: "synced",
        lastSyncedAt: this.clock.now(),
        pending: await this.store.pendingCount(),
      });
    } catch (err) {
      this.patch({
        phase: this.network.isOnline() ? "error" : "offline",
        lastError: err instanceof Error ? err.message : String(err),
        pending: await this.store.pendingCount().catch(() => this.status.pending),
      });
    } finally {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        void this.sync();
      }
    }
  }

  /** Push the outbox in batches until nothing is due. Throws on a network error. */
  private async pushDrain(): Promise<void> {
    for (;;) {
      const due = await this.store.dueMutations(this.cfg.pushBatch, this.clock.now());
      if (due.length === 0) return;

      const res = await this.transport.push({ mutations: due.map(stripAttempts) });
      const byId = new Map(due.map((m) => [m.mutationId, m]));

      for (const r of res.results) {
        // applied / duplicate / conflict all mean "done, drop it": the server is
        // authoritative and the pull that follows brings the winning row down.
        // Only an outright rejection is dropped with its reason surfaced.
        if (r.outcome === "rejected") {
          this.patch({ lastError: r.message ?? "rejected" });
        }
        await this.store.ackMutation(r.mutationId);
        byId.delete(r.mutationId);
      }

      // Anything the server did not answer for is deferred with backoff so a
      // partial response never loses a mutation.
      for (const m of byId.values()) {
        await this.defer(m);
      }
    }
  }

  /** Pull the change-feed page by page until caught up. Throws on a network error. */
  private async pullDrain(): Promise<void> {
    let cursor = await this.store.getCursor();
    for (;;) {
      const resp = await this.transport.pull(cursor, this.cfg.pullBatch);
      if (resp.changes.length > 0) {
        await this.store.applyChanges(resp.changes);
      }
      await this.store.setCursor(resp.cursor);
      cursor = resp.cursor;
      if (!resp.hasMore) return;
    }
  }

  private async defer(m: StoredMutation): Promise<void> {
    const attempts = m.attempts + 1;
    const backoff = Math.min(
      this.cfg.maxBackoffMs,
      this.cfg.baseBackoffMs * 2 ** (attempts - 1),
    );
    // Full jitter, so a fleet reconnecting at once does not thundering-herd.
    const jittered = Math.round(backoff * (0.5 + Math.random() * 0.5));
    await this.store.deferMutation(m.mutationId, attempts, this.clock.now() + jittered);
  }

  private patch(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    this.onStatus?.(this.status);
  }
}

function stripAttempts(m: StoredMutation): Mutation {
  const { attempts: _attempts, ...mutation } = m;
  return mutation;
}
