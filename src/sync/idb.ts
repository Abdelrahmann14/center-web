// A tiny promise wrapper over IndexedDB - the browser's durable local store
// (SQLite would need WASM + OPFS + cross-origin-isolation headers; IndexedDB is
// universally available and enough for the sync mirror).
//
// The database is named per workspace owner so a super admin switching act-as
// workspaces never mixes one tenant's local data into another.

export const STORES = {
  outbox: "outbox",
  meta: "meta",
  students: "students",
  attendance: "attendance",
  groups: "groups",
} as const;

export function openSyncDb(owner: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v2 added the groups store; onupgradeneeded is additive and guarded, so it
    // runs cleanly whether opening fresh or upgrading a v1 database.
    const req = indexedDB.open(`psycho-sync-${owner}`, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.outbox)) {
        db.createObjectStore(STORES.outbox, { keyPath: "mutation_id" });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORES.students)) {
        const s = db.createObjectStore(STORES.students, { keyPath: "id" });
        s.createIndex("group_id", "group_id");
      }
      if (!db.objectStoreNames.contains(STORES.attendance)) {
        const s = db.createObjectStore(STORES.attendance, { keyPath: "id" });
        s.createIndex("daily", ["group_id", "student_id", "attended_on"], { unique: true });
        s.createIndex("attended_on", "attended_on");
      }
      if (!db.objectStoreNames.contains(STORES.groups)) {
        db.createObjectStore(STORES.groups, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Await one IndexedDB request. */
export function reqP<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Await a transaction's completion (so multi-store writes are atomic). */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
