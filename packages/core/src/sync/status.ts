// The sync status surfaced to the UI as a subtle indicator.

export type SyncPhase =
  /** Everything is up to date and nothing is queued. */
  | "synced"
  /** A push/pull pass is in flight. */
  | "syncing"
  /** No connection; writes are queued locally and will sync on reconnect. */
  | "offline"
  /** The last pass failed; it will retry with backoff. */
  | "error";

export interface SyncStatus {
  phase: SyncPhase;
  online: boolean;
  /** Outbox size - "pending N" in the badge. */
  pending: number;
  /** Epoch ms of the last fully successful pass, or null. */
  lastSyncedAt: number | null;
  /** Last error message, or null. */
  lastError: string | null;
}

export function initialStatus(online: boolean): SyncStatus {
  return {
    phase: online ? "synced" : "offline",
    online,
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
  };
}
