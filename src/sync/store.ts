// The IndexedDB implementation of the engine's SyncStore port, plus the reads
// and writes the offline attendance page needs. Mirrors the mobile store; the
// engine driving both is identical (in @center/core).
import type { EntityChange, Mutation, StoredMutation, SyncStore } from "@center/core";
import { STORES, openSyncDb, reqP, txDone } from "./idb";
import { localDateIso, uuidv7 } from "./uuid";
import { fmtTime } from "@/lib/datetime";

interface OutboxRecord extends Mutation {
  attempts: number;
  next_retry_at: number;
}

export interface RosterStudent {
  id: string;
  serial: number | null;
  name: string;
  group_id: string | null;
}

export interface RosterGroup {
  groupId: string;
  groupName: string;
  students: RosterStudent[];
}

// 0 = Saturday .. 6 = Friday, matching the backend's day order.
const ARABIC_DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function groupLabel(g: Record<string, unknown>): string {
  const dow = g.day_of_week == null ? null : Number(g.day_of_week);
  const day = dow != null ? ARABIC_DAYS[dow] ?? "" : "";
  const time = fmtTime(String(g.start_time ?? "").slice(0, 5), "");
  const parts = [day, time].filter(Boolean).join(" ");
  const center = g.center_name ? String(g.center_name) : "";
  return center ? `${parts} - ${center}` : parts || "مجموعة";
}

export class WebSyncStore implements SyncStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(owner: string): Promise<WebSyncStore> {
    return new WebSyncStore(await openSyncDb(owner));
  }

  // --- SyncStore port ---------------------------------------------------

  async enqueue(m: Mutation): Promise<void> {
    const tx = this.db.transaction(STORES.outbox, "readwrite");
    const rec: OutboxRecord = { ...m, attempts: 0, next_retry_at: 0 };
    tx.objectStore(STORES.outbox).put(rec);
    await txDone(tx);
  }

  async dueMutations(limit: number, now: number): Promise<StoredMutation[]> {
    const tx = this.db.transaction(STORES.outbox, "readonly");
    const all = (await reqP(tx.objectStore(STORES.outbox).getAll())) as OutboxRecord[];
    return all
      .filter((r) => r.next_retry_at <= now)
      .sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({
        mutationId: r.mutationId,
        entity: r.entity,
        op: r.op,
        rowId: r.rowId,
        baseVersion: r.baseVersion,
        payload: r.payload,
        queuedAt: r.queuedAt,
        attempts: r.attempts,
      }));
  }

  async ackMutation(mutationId: string): Promise<void> {
    const tx = this.db.transaction(STORES.outbox, "readwrite");
    tx.objectStore(STORES.outbox).delete(mutationId);
    await txDone(tx);
  }

  async deferMutation(mutationId: string, attempts: number, nextRetryAt: number): Promise<void> {
    const tx = this.db.transaction(STORES.outbox, "readwrite");
    const store = tx.objectStore(STORES.outbox);
    const rec = (await reqP(store.get(mutationId))) as OutboxRecord | undefined;
    if (rec) {
      rec.attempts = attempts;
      rec.next_retry_at = nextRetryAt;
      store.put(rec);
    }
    await txDone(tx);
  }

  async pendingCount(): Promise<number> {
    const tx = this.db.transaction(STORES.outbox, "readonly");
    return reqP(tx.objectStore(STORES.outbox).count());
  }

  async applyChanges(changes: EntityChange[]): Promise<void> {
    const tx = this.db.transaction(
      [STORES.students, STORES.attendance, STORES.groups],
      "readwrite",
    );
    const students = tx.objectStore(STORES.students);
    const attendance = tx.objectStore(STORES.attendance);
    const groups = tx.objectStore(STORES.groups);
    for (const c of changes) {
      if (c.entity === "student") {
        if (c.op === "delete" || !c.row) students.delete(c.rowId);
        else students.put(c.row);
      } else if (c.entity === "group") {
        if (c.op === "delete" || !c.row) groups.delete(c.rowId);
        else groups.put(c.row);
      } else if (c.entity === "attendance") {
        if (c.op === "delete" || !c.row) {
          attendance.delete(c.rowId);
          continue;
        }
        const r = c.row as Record<string, unknown>;
        // Replace any local row for the same day so the server's authoritative
        // id wins after a cross-device dedup.
        const key = await reqP(
          attendance
            .index("daily")
            .getKey([String(r.group_id), String(r.student_id), String(r.attended_on)]),
        );
        if (key !== undefined && key !== null) attendance.delete(key as IDBValidKey);
        attendance.put({ ...r, pending: 0 });
      }
    }
    await txDone(tx);
  }

  async getCursor(): Promise<string | null> {
    const tx = this.db.transaction(STORES.meta, "readonly");
    const rec = (await reqP(tx.objectStore(STORES.meta).get("cursor"))) as
      | { key: string; value: string }
      | undefined;
    return rec?.value ?? null;
  }

  async setCursor(cursor: string): Promise<void> {
    const tx = this.db.transaction(STORES.meta, "readwrite");
    tx.objectStore(STORES.meta).put({ key: "cursor", value: cursor });
    await txDone(tx);
  }

  // --- Feature reads/writes for the attendance page ---------------------

  async rosterByGroup(): Promise<RosterGroup[]> {
    const tx = this.db.transaction([STORES.students, STORES.groups], "readonly");
    const all = (await reqP(tx.objectStore(STORES.students).getAll())) as Record<string, unknown>[];
    const groupRows = (await reqP(tx.objectStore(STORES.groups).getAll())) as Record<string, unknown>[];
    const labels = new Map(groupRows.map((g) => [String(g.id), groupLabel(g)]));

    const byGroup = new Map<string, RosterStudent[]>();
    for (const s of all) {
      if (s.deleted_at || s.active === false || !s.group_id) continue;
      const gid = String(s.group_id);
      const list = byGroup.get(gid) ?? [];
      list.push({
        id: String(s.id),
        serial: s.serial == null ? null : Number(s.serial),
        name: String(s.name ?? ""),
        group_id: gid,
      });
      byGroup.set(gid, list);
    }
    return [...byGroup.entries()].map(([groupId, students]) => ({
      groupId,
      groupName: labels.get(groupId) ?? `مجموعة ${groupId.slice(0, 8)}`,
      students: students.sort((a, b) => a.name.localeCompare(b.name, "ar")),
    }));
  }

  async presentTodayIds(): Promise<Set<string>> {
    const today = localDateIso();
    const tx = this.db.transaction(STORES.attendance, "readonly");
    const rows = (await reqP(
      tx.objectStore(STORES.attendance).index("attended_on").getAll(today),
    )) as Record<string, unknown>[];
    return new Set(rows.map((r) => String(r.student_id)));
  }

  /** Mark present today: local row + outbox mutation in ONE transaction. */
  async markAttendance(groupId: string, studentId: string): Promise<void> {
    const today = localDateIso();
    const check = this.db.transaction(STORES.attendance, "readonly");
    const existingKey = await reqP(
      check.objectStore(STORES.attendance).index("daily").getKey([groupId, studentId, today]),
    );
    if (existingKey !== undefined && existingKey !== null) return;

    const id = uuidv7();
    const mutationId = uuidv7();
    const createdAt = new Date().toISOString();
    const tx = this.db.transaction([STORES.attendance, STORES.outbox], "readwrite");
    tx.objectStore(STORES.attendance).put({
      id,
      group_id: groupId,
      student_id: studentId,
      attended_on: today,
      created_at: createdAt,
      pending: 1,
    });
    const mutation: OutboxRecord = {
      mutationId,
      entity: "attendance",
      op: "upsert",
      rowId: id,
      baseVersion: 0,
      payload: { id, group_id: groupId, student_id: studentId, attended_on: today },
      queuedAt: createdAt,
      attempts: 0,
      next_retry_at: 0,
    };
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);
  }
}
