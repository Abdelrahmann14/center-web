// The ports the SyncEngine depends on. Everything platform-specific lives behind
// these interfaces so the engine itself is pure and identical on mobile
// (expo-sqlite) and web (wa-sqlite / IndexedDB).
import type {
  EntityChange,
  Mutation,
  PullResponse,
  PushRequest,
  PushResponse,
} from "./protocol";

/** A queued mutation as read back from durable storage, with retry bookkeeping. */
export interface StoredMutation extends Mutation {
  attempts: number;
}

/**
 * Durable local storage: the outbox, the pull cursor, and the local mirror
 * tables. Implementations wrap a real SQLite database and MUST make
 * {@link applyChanges} atomic (one transaction) so a crash mid-apply never
 * leaves a half-written batch.
 */
export interface SyncStore {
  /** Append a mutation to the outbox and optimistically write the local row. */
  enqueue(mutation: Mutation): Promise<void>;

  /** Oldest pending mutations whose next-retry time has arrived, up to `limit`. */
  dueMutations(limit: number, now: number): Promise<StoredMutation[]>;

  /** Remove a mutation once the server has accepted (or deduped) it. */
  ackMutation(mutationId: string): Promise<void>;

  /** Record a failed attempt and when to retry it next (exponential backoff). */
  deferMutation(mutationId: string, attempts: number, nextRetryAt: number): Promise<void>;

  /** Pending outbox size, for the status badge. */
  pendingCount(): Promise<number>;

  /** Apply authoritative server changes into the mirror tables, transactionally. */
  applyChanges(changes: EntityChange[]): Promise<void>;

  /** The last pull cursor, or null before the first successful pull. */
  getCursor(): Promise<string | null>;
  setCursor(cursor: string): Promise<void>;
}

/** The network calls to the Spring /api/sync endpoints. */
export interface SyncTransport {
  push(req: PushRequest): Promise<PushResponse>;
  pull(since: string | null, limit: number): Promise<PullResponse>;
}

/** Platform connectivity. */
export interface NetworkMonitor {
  isOnline(): boolean;
  /** Subscribe to transitions; returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface Clock {
  now(): number;
}

/** The engine surfaces one method call per network round trip through here. */
export type { EntityChange, Mutation, PullResponse, PushRequest, PushResponse };
