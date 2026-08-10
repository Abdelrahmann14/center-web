// The wire contract for offline sync, shared by every client and the Spring
// /api/sync endpoints. Two directions:
//   push  - drain the local outbox of offline writes up to the server
//   pull  - fetch the authoritative change-feed since a cursor (incremental)
// The server is the source of truth: conflicts are resolved server-side and the
// winning row comes back, so clients never diverge.
import type { ISODateTime, UUID } from "../types/common";

export type SyncOp = "upsert" | "delete";

/**
 * One local change queued for the server. New rows carry a CLIENT-generated
 * UUID as {@link rowId} so an offline insert has a stable identity and replaying
 * the same {@link mutationId} is a guaranteed no-op (idempotency).
 */
export interface Mutation<T = unknown> {
  /** Idempotency key - the server records it and ignores a second delivery. */
  mutationId: UUID;
  entity: string;
  op: SyncOp;
  /** Stable row id (client-generated for offline inserts). */
  rowId: UUID;
  /**
   * Optimistic-concurrency token the client last saw for this row; 0 for a row
   * created offline. The server compares it to decide the last-write-wins race.
   */
  baseVersion: number;
  /** Full row payload in the snake_case server contract. Omitted for a delete. */
  payload?: T;
  /** Client wall-clock when queued. A tie-breaker only - never trusted for LWW. */
  queuedAt: ISODateTime;
}

export interface PushRequest {
  mutations: Mutation[];
}

export type MutationOutcome =
  /** Written; {@link MutationResult.row} is the new authoritative row. */
  | "applied"
  /** Already applied on a previous delivery - safe to drop from the outbox. */
  | "duplicate"
  /** The server row was newer (server wins); the winning row is returned. */
  | "conflict"
  /** Refused (validation/permission); {@link MutationResult.message} says why. */
  | "rejected";

export interface MutationResult<T = unknown> {
  mutationId: UUID;
  rowId: UUID;
  outcome: MutationOutcome;
  /** The authoritative row after apply, or the winning row on a conflict. */
  row?: T;
  version?: number;
  /** Arabic user-facing reason, when rejected. */
  message?: string;
}

export interface PushResponse {
  results: MutationResult[];
}

/** One authoritative change from the server feed. */
export interface EntityChange<T = unknown> {
  entity: string;
  op: SyncOp;
  rowId: UUID;
  version: number;
  /**
   * The row body. Present for an upsert; for a soft delete the row is still sent
   * carrying its {@code deleted_at}, so a hard-delete op with no row is rare.
   */
  row?: T;
}

export interface PullResponse {
  changes: EntityChange[];
  /** Opaque monotonic cursor to echo back on the next pull. */
  cursor: string;
  /** More changes remain past this page - pull again immediately. */
  hasMore: boolean;
}

/**
 * How a write race is settled. Default is server-authoritative last-write-wins;
 * append-only entities (e.g. attendance) use {@code idempotent-insert} - a
 * replay collapses onto the existing row instead of racing.
 */
export type ConflictStrategy = "last-write-wins" | "server-wins" | "idempotent-insert";
