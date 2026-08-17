// The local IndexedDB database backing the offline sync store: the outbox, the
// pull cursor (meta), and the mirror tables the attendance screen reads while
// offline. IndexedDB is used rather than a SQLite-over-WASM build so the whole
// feature adds ZERO dependencies and no extra bundle weight - the app already
// ships nothing for offline, and Chrome's IndexedDB is durable and transactional,
// which is all the engine's SyncStore port needs.
//
// The database is named PER WORKSPACE OWNER, so a super admin switching act-as
// workspaces (or two staff sharing a browser) never mixes one tenant's local
// data into another - each owner gets its own store, and switching back finds it
// intact rather than wiped.
//
// Rows are stored in the SAME snake_case shape the server's /api/sync feed sends
// (which matches the REST *Response DTOs), so a mirrored row can be handed to the
// existing screens unchanged - see store.ts.

const DB_PREFIX = "center-offline-";
// 2 added the three stores the Financials screen needs. Bumping the version is
// what runs the upgrade below on a browser that already holds a v1 database.
const DB_VERSION = 2;

/** The outbox and cursor/owner store, plus one mirror store per synced entity. */
export const STORES = {
  outbox: "outbox",
  meta: "meta",
  students: "students",
  groups: "groups",
  lectures: "lectures",
  registrations: "registrations",
  attendance: "attendance",
  financeEntries: "finance_entries",
  /** One assistant marked present at one lesson session. */
  lessonAttendance: "lesson_attendance",
  /** The workspace's assistants - names for the attendance form. */
  assistants: "assistants",
} as const;

/** Every mirror store an authoritative pull can write - excludes outbox/meta. */
export const MIRROR_STORES = [
  STORES.students,
  STORES.groups,
  STORES.lectures,
  STORES.registrations,
  STORES.attendance,
  STORES.financeEntries,
  STORES.lessonAttendance,
  STORES.assistants,
] as const;

// One open promise per owner, so repeated opens (and React StrictMode's
// double-mount) reuse the same connection.
const dbPromises = new Map<string, Promise<IDBDatabase>>();

/** Every store the code expects to be able to open a transaction on. */
const ALL_STORES: readonly string[] = [STORES.outbox, STORES.meta, STORES.registrations, ...MIRROR_STORES];

export function openDatabase(owner: string): Promise<IDBDatabase> {
  const existing = dbPromises.get(owner);
  if (existing) return existing;
  // Open at the declared version, then CHECK. A database can carry the right
  // version number and still be missing stores - an upgrade that was interrupted,
  // a tab that kept an older connection alive through a hot reload - and every
  // later transaction then dies with "one of the specified object stores was not
  // found", which stops sync dead and reads like a broken app rather than a
  // database that needs one more upgrade. Reopening at the next version runs the
  // creation code again and heals it.
  const promise = rawOpen(owner, DB_VERSION).then(async (db) => {
    const missing = ALL_STORES.filter((name) => !db.objectStoreNames.contains(name));
    if (missing.length === 0) return db;
    const next = db.version + 1;
    db.close();
    return rawOpen(owner, next);
  });
  dbPromises.set(owner, promise);
  return promise.catch((err) => {
    dbPromises.delete(owner);
    throw err;
  });
}

function rawOpen(owner: string, version: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_PREFIX + owner, version);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // The outbox is keyed by the idempotency key; retry bookkeeping lives on
      // the row itself (attempts + next_retry_at), no index needed - the outbox
      // is tiny (only unsynced writes).
      if (!db.objectStoreNames.contains(STORES.outbox)) {
        db.createObjectStore(STORES.outbox, { keyPath: "mutationId" });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
      // Every mirror row carries its own server id.
      for (const name of [
        STORES.students,
        STORES.groups,
        STORES.lectures,
        STORES.attendance,
        STORES.financeEntries,
        STORES.lessonAttendance,
        STORES.assistants,
      ]) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      }
      // Registrations are read back filtered by lesson, so index that column.
      if (!db.objectStoreNames.contains(STORES.registrations)) {
        const reg = db.createObjectStore(STORES.registrations, { keyPath: "id" });
        reg.createIndex("lecture_id", "lecture_id", { unique: false });
        reg.createIndex("student_id", "student_id", { unique: false });
      }
      // A store added by an upgrade starts EMPTY, and the change feed only ever
      // sends what changed after the saved cursor - so without this the new
      // stores would stay empty until each row happened to be edited. Dropping
      // the cursor replays the whole feed once; every other store is written
      // with the same rows it already holds, which costs one sync and changes
      // nothing. The outbox is untouched: queued writes are not re-pullable.
      if (event.oldVersion > 0) {
        req.transaction?.objectStore(STORES.meta).delete("cursor");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading to a newer version cannot proceed while this
      // connection is open. Close it rather than deadlock both tabs; this tab's
      // reads then fail loudly instead of hanging, and a reload picks up the
      // new version.
      db.onversionchange = () => {
        db.close();
        dbPromises.delete(owner);
      };
      resolve(db);
    };
    // The mirror image of the above: THIS open is waiting on a connection some
    // other tab still holds. Left unhandled the promise never settles, the sync
    // engine never starts, and the screen shows no reason for it.
    req.onblocked = () =>
      reject(new Error("قاعدة البيانات المحلية مفتوحة في نافذة أخرى - أغلق باقي النوافذ ثم أعد التحميل"));
    req.onerror = () => reject(req.error ?? new Error("فشل فتح قاعدة البيانات المحلية"));
  });
}

/** Wrap an IDBRequest as a promise. */
export function reqP<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** Resolve once a whole transaction commits (so a multi-store apply is atomic). */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Read every row of a store. Mirror stores are bounded (one tenant's data). */
export function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return reqP(db.transaction(store, "readonly").objectStore(store).getAll() as IDBRequest<T[]>);
}

export function getOne<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return reqP(db.transaction(store, "readonly").objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export function countStore(db: IDBDatabase, store: string): Promise<number> {
  return reqP(db.transaction(store, "readonly").objectStore(store).count());
}
