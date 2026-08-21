// The IndexedDB implementation of the engine's SyncStore port, plus the offline
// reads and writes the attendance screen needs. It owns the database, so it is
// the single place that knows the mirror row shapes.
//
// Two extras beyond the bare port:
//   - resolveRead(path): serves the screen's GET requests from the mirror when
//     the network is down, reshaping mirror rows into the exact REST responses
//     the components already expect (so no component has to know it is offline).
//   - queueRegistration(): writes the optimistic mirror row AND its outbox
//     mutation in ONE transaction, so an offline "تحضير" is durable and syncs
//     exactly once.
import type { EntityChange, Mutation, StoredMutation, SyncStore } from "@center/core";
import type { Page } from "@/lib/api";
import type { Student } from "@/modules/students/StudentForm";
import {
  MIRROR_STORES,
  STORES,
  countStore,
  getAll,
  getOne,
  openDatabase,
  txDone,
} from "./db";
import { uuidv7 } from "./uuid";
import { fmtTime } from "@/lib/datetime";
import { foldArabic, matchesStudentSearch, type SearchableStudent } from "@/lib/studentSearch";

type Row = Record<string, unknown>;

interface OutboxRow extends Mutation {
  attempts: number;
  nextRetryAt: number;
}

/**
 * The registration a screen is looking at, as it can describe it without the
 * mirror. Enough to write both the local row and the queued upsert.
 */
export interface RegistrationBase {
  lecture_id: string;
  student_id: string;
  group_id: string | null;
  status?: string;
  homework_flag?: string | null;
  exam_score?: number | null;
  attended_at?: string | null;
  student_name?: string | null;
  student_serial?: number | null;
}

/** A registration a screen holds, with the id the server knows it by. */
export interface MirroredRegistration extends RegistrationBase {
  id: string;
}

/** entity name on the wire -> the mirror store it lands in (others are ignored). */
const ENTITY_STORE: Record<string, string> = {
  student: STORES.students,
  group: STORES.groups,
  lecture: STORES.lectures,
  registration: STORES.registrations,
  attendance: STORES.attendance,
  finance_entry: STORES.financeEntries,
  lesson_attendance: STORES.lessonAttendance,
  assistant: STORES.assistants,
};

/** 0 = Saturday, matching groups.day_of_week and the server's own list. */
const WEEKDAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

/** Whole pounds, always rounded UP - the rule every invoice figure is made by. */
const up = (n: number) => Math.ceil(Number.isFinite(n) ? n : 0);

/**
 * The day a session belongs to, read in the BROWSER's zone. The server derives
 * it in the application's zone for the same reason: a 22:00 lesson filed by a
 * UTC date would land on the next day.
 */
function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `lecture:group:date` - a session has no id, so this is its identity. */
function sessionKey(lectureId: string, groupId: string | null, day: string): string {
  return `${lectureId}:${groupId ?? "none"}:${day}`;
}

/** "الأحد · ٥ م" - the slot the group sits in, matching the server's label. */
function groupLabel(group: Row | undefined): string {
  if (!group) return "بدون مجموعة";
  const day = Number(group.day_of_week ?? -1);
  const name = day >= 0 && day < WEEKDAYS.length ? WEEKDAYS[day] : "";
  return `${name} · ${fmtTime(group.start_time as string | null, "")}`.trim();
}

/** A student row's phones (their own + the parent's) as plain strings. */
function phonesOf(r: Row): string[] {
  const sp = (r.student_phones as string[] | undefined) ?? [];
  const pp = (r.parent_phones as string[] | undefined) ?? [];
  return [...sp, ...pp].map(String);
}

function toPage<T>(content: T[], size: number): Page<T> {
  return {
    content,
    total_elements: content.length,
    total_pages: 1,
    number: 0,
    size,
    first: true,
    last: true,
  };
}

export class WebSyncStore implements SyncStore {
  constructor(private readonly db: IDBDatabase) {}

  static async open(owner: string): Promise<WebSyncStore> {
    return new WebSyncStore(await openDatabase(owner));
  }

  // --- SyncStore port ---------------------------------------------------

  async enqueue(m: Mutation): Promise<void> {
    const row: OutboxRow = { ...m, attempts: 0, nextRetryAt: 0 };
    const tx = this.db.transaction(STORES.outbox, "readwrite");
    tx.objectStore(STORES.outbox).put(row);
    await txDone(tx);
  }

  async dueMutations(limit: number, now: number): Promise<StoredMutation[]> {
    const rows = await getAll<OutboxRow>(this.db, STORES.outbox);
    return rows
      .filter((r) => (r.nextRetryAt ?? 0) <= now)
      .sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)))
      .slice(0, limit)
      .map((r) => ({
        mutationId: r.mutationId,
        entity: r.entity,
        op: r.op,
        rowId: r.rowId,
        baseVersion: r.baseVersion,
        payload: r.payload,
        queuedAt: r.queuedAt,
        attempts: r.attempts ?? 0,
      }));
  }

  async ackMutation(mutationId: string): Promise<void> {
    const tx = this.db.transaction(STORES.outbox, "readwrite");
    tx.objectStore(STORES.outbox).delete(mutationId);
    await txDone(tx);
  }

  /**
   * Undo a refused write's optimistic row.
   *
   * <p>A row this device invented offline (baseVersion 0) never existed anywhere
   * else, so it is simply removed. Anything else - an edit or a delete of a row
   * the server already holds - is undone by dropping the pull cursor: the feed
   * carries only rows that CHANGED, and a refused write changed nothing, so
   * re-seeding from the start is the only way to get the server's truth back.
   */
  async rejectMutation(m: StoredMutation): Promise<void> {
    const storeName = ENTITY_STORE[m.entity];
    if (m.op === "upsert" && m.baseVersion === 0 && storeName) {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(m.rowId);
      await txDone(tx);
      return;
    }
    const tx = this.db.transaction(STORES.meta, "readwrite");
    tx.objectStore(STORES.meta).delete("cursor");
    await txDone(tx);
  }

  async deferMutation(mutationId: string, attempts: number, nextRetryAt: number): Promise<void> {
    const existing = await getOne<OutboxRow>(this.db, STORES.outbox, mutationId);
    if (!existing) return;
    existing.attempts = attempts;
    existing.nextRetryAt = nextRetryAt;
    const tx = this.db.transaction(STORES.outbox, "readwrite");
    tx.objectStore(STORES.outbox).put(existing);
    await txDone(tx);
  }

  async pendingCount(): Promise<number> {
    return countStore(this.db, STORES.outbox);
  }

  /** Apply an authoritative batch in ONE transaction, so a crash never half-writes. */
  async applyChanges(changes: EntityChange[]): Promise<void> {
    const tx = this.db.transaction([...MIRROR_STORES], "readwrite");
    const pending: Promise<void>[] = [];
    for (const c of changes) {
      const storeName = ENTITY_STORE[c.entity];
      if (!storeName) continue; // an entity this client does not mirror
      const store = tx.objectStore(storeName);
      if (c.op === "delete" || !c.row) {
        store.delete(c.rowId);
        continue;
      }
      const row = c.row as Row;
      // Every mirror store is keyed by `id`; the feed always carries it, but
      // fall back to the change's rowId so a malformed row cannot abort the tx.
      if (row.id == null) row.id = c.rowId;
      store.put(row);
      // A registration created offline holds a client-minted id; if the server
      // resolved it onto a row with a DIFFERENT id (the same student was already
      // registered for this lesson+group elsewhere), the authoritative row now
      // arriving must evict the stale optimistic one so the natural key is not
      // duplicated in the mirror. The common case (server kept our id) evicts
      // nothing.
      if (c.entity === "registration") {
        pending.push(evictStaleRegistration(store, row));
      }
      // Same story for an assistant mark queued offline: it was written with a
      // client id, and the server's own row for that session+assistant is a
      // different id, so the queued one has to go or the invoice lists the
      // assistant twice.
      if (c.entity === "lesson_attendance") {
        pending.push(evictStaleAttendance(store, row));
      }
    }
    await Promise.all(pending);
    await txDone(tx);
  }

  async getCursor(): Promise<string | null> {
    const row = await getOne<{ key: string; value: string }>(this.db, STORES.meta, "cursor");
    return row?.value ?? null;
  }

  async setCursor(cursor: string): Promise<void> {
    const tx = this.db.transaction(STORES.meta, "readwrite");
    tx.objectStore(STORES.meta).put({ key: "cursor", value: cursor });
    await txDone(tx);
  }

  // --- Offline reads (served when the network is down) ------------------

  /**
   * Serve a screen's GET from the mirror, reshaped into the exact REST response
   * the component expects. Returns undefined for anything not mirrored, so the
   * caller rethrows the original network error unchanged.
   */
  async resolveRead(path: string): Promise<unknown | undefined> {
    const [rawPath, queryStr] = path.split("?");
    const params = new URLSearchParams(queryStr ?? "");
    switch (rawPath) {
      case "/grades":
        return this.readGrades();
      case "/grades/in-use":
        return this.readGradesInUse();
      case "/groups":
        return getAll<Row>(this.db, STORES.groups);
      case "/lectures":
        return this.readLectures(params);
      case "/registrations":
        return this.readRegistrations(params);
      case "/registrations/groups":
        return this.readLessonGroups(params);
      case "/students":
        return this.readStudents(params);
      case "/students/options":
        return this.readStudentOptions();
      case "/finance/invoices":
        return this.readInvoices(params);
      case "/finance/invoices/attendance":
        return this.readSessionAttendance(params);
      default:
        break;
    }
    // One lesson, as the lesson-group screen loads it.
    const lecture = /^\/lectures\/([^/]+)$/.exec(rawPath);
    if (lecture) return getOne<Row>(this.db, STORES.lectures, lecture[1]);
    // One student's lesson-by-lesson history, as the registration panel loads it.
    const history = /^\/registrations\/history\/([^/]+)$/.exec(rawPath);
    if (history) return this.readHistory(history[1]);
    // Who missed a lesson - the only messaging path the mirror can answer, and
    // it answers it from attendance alone, which is data this app does own.
    const absentees = /^\/messaging\/whatsapp\/lectures\/([^/]+)\/groups\/([^/]+)\/absentees$/
      .exec(rawPath);
    if (absentees) return this.readAbsentees(absentees[1], absentees[2]);
    return undefined;
  }

  /**
   * The groups that sat one lesson, with head counts - the list the Lessons page
   * opens before anyone can reach a group's roster. Without it a disconnected
   * teacher saw "no group attended this lesson" and had no way in at all.
   */
  private async readLessonGroups(params: URLSearchParams): Promise<Row[]> {
    const lectureId = params.get("lecture_id");
    if (!lectureId) return [];
    const regs = (await getAll<Row>(this.db, STORES.registrations)).filter(
      (r) => r.lecture_id === lectureId,
    );
    const byGroup = new Map<string | null, { count: number; attendedAt: string | null }>();
    for (const r of regs) {
      const key = (r.group_id as string | null) ?? null;
      const at = (r.attended_at ?? r.created_at ?? null) as string | null;
      const cur = byGroup.get(key);
      if (!cur) {
        byGroup.set(key, { count: 1, attendedAt: at });
        continue;
      }
      cur.count += 1;
      // The group sat the lesson when its FIRST student was marked present.
      if (at && (cur.attendedAt == null || at < cur.attendedAt)) cur.attendedAt = at;
    }
    return [...byGroup.entries()]
      .map(([groupId, v]) => ({ group_id: groupId, count: v.count, attended_at: v.attendedAt }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * The group's students who missed a lesson: everyone in the group with no
   * registration for it, in ANY group.
   *
   * <p>`sent` is null rather than false - whether the absence message went out is
   * recorded on the server and cannot be known from here, and answering "not
   * sent" would invite sending a second copy of a message the parent already has.
   */
  private async readAbsentees(lectureId: string, groupId: string): Promise<Row[]> {
    const [students, regs] = await Promise.all([
      getAll<Row>(this.db, STORES.students),
      getAll<Row>(this.db, STORES.registrations),
    ]);
    const present = new Set(
      regs.filter((r) => r.lecture_id === lectureId).map((r) => String(r.student_id)),
    );
    return students
      .filter(
        (s) =>
          s.deleted_at == null &&
          s.is_active !== false &&
          String(s.group_id ?? "") === groupId &&
          !present.has(String(s.id)),
      )
      .sort((a, b) => Number(a.serial ?? 0) - Number(b.serial ?? 0))
      .map((s) => ({
        student_id: s.id,
        serial: s.serial ?? null,
        name: s.name ?? "",
        parent_phones: (s.parent_phones as string[] | undefined) ?? [],
        sent: null,
      }));
  }

  /**
   * The Financials page's invoices, DERIVED here exactly as the server derives
   * them: a session is (lesson, group, day), its takings are one line per price
   * with the head count at that price, and the manual lines and the assistants
   * are attached on top.
   *
   * <p>Derived rather than mirrored on purpose. An invoice is not a stored row -
   * it is what the registrations add up to - so a snapshot taken while online
   * would be a photograph of the money that could not answer for a lesson
   * registered five minutes later with no line. Deriving it means the evening's
   * takings appear the moment the attendance is taken, connection or not.
   *
   * <p>Two things it cannot match the server on, both stated rather than hidden:
   * a student the mirror has never seen contributes to the head count with no
   * price (the same bucket a student with no price set falls into), and the
   * group's roster size is counted from the mirror's own students.
   */
  private async readInvoices(params: URLSearchParams): Promise<Row[]> {
    const from = params.get("from");
    const to = params.get("to");
    if (!from || !to) return [];

    const [regs, students, groups, lectures, entries, marks, assistants] = await Promise.all([
      getAll<Row>(this.db, STORES.registrations),
      getAll<Row>(this.db, STORES.students),
      getAll<Row>(this.db, STORES.groups),
      getAll<Row>(this.db, STORES.lectures),
      getAll<Row>(this.db, STORES.financeEntries),
      getAll<Row>(this.db, STORES.lessonAttendance),
      getAll<Row>(this.db, STORES.assistants),
    ]);
    const studentById = new Map(students.map((s) => [String(s.id), s]));
    const groupById = new Map(groups.map((g) => [String(g.id), g]));
    const lectureById = new Map(lectures.map((l) => [String(l.id), l]));
    const assistantName = new Map(assistants.map((a) => [String(a.id), String(a.username ?? "")]));

    // One bucket per session, each holding a head count per price. null is the
    // no-price bucket: a student who attended but adds nothing to the takings.
    interface Bucket {
      lectureId: string;
      groupId: string | null;
      day: string;
      heads: Map<number | null, number>;
    }
    const sessions = new Map<string, Bucket>();
    for (const r of regs) {
      if ((r.status ?? "present") !== "present") continue;
      const at = (r.created_at ?? r.attended_at) as string | null;
      if (!at) continue;
      const day = localDay(at);
      if (!day || day < from || day > to) continue;
      const lectureId = String(r.lecture_id);
      const groupId = (r.group_id as string | null) ?? null;
      const key = sessionKey(lectureId, groupId, day);
      let bucket = sessions.get(key);
      if (!bucket) {
        bucket = { lectureId, groupId, day, heads: new Map() };
        sessions.set(key, bucket);
      }
      const raw = studentById.get(String(r.student_id))?.lesson_price;
      const price = raw == null ? null : Number(raw);
      bucket.heads.set(price, (bucket.heads.get(price) ?? 0) + 1);
    }

    const entriesByKey = new Map<string, Row[]>();
    for (const e of entries) {
      const day = String(e.session_date ?? "");
      if (day < from || day > to) continue;
      const key = sessionKey(String(e.lecture_id), (e.group_id as string | null) ?? null, day);
      const bucket = entriesByKey.get(key);
      if (bucket) bucket.push(e);
      else entriesByKey.set(key, [e]);
    }

    // Keyed by assistant, not by name: a mark queued offline carries a client id
    // and the server's own row for it arrives later, so the same assistant can
    // sit in the mirror twice for one session until the feed catches up.
    const attendeesByKey = new Map<string, Set<string>>();
    for (const mark of marks) {
      const day = String(mark.session_date ?? "");
      if (day < from || day > to) continue;
      if (!assistantName.has(String(mark.user_id))) continue; // since deleted
      const key = sessionKey(String(mark.lecture_id), (mark.group_id as string | null) ?? null, day);
      const bucket = attendeesByKey.get(key);
      if (bucket) bucket.add(String(mark.user_id));
      else attendeesByKey.set(key, new Set([String(mark.user_id)]));
    }

    // The roster size the invoice quotes. Matches the server's @Formula, which
    // counts every ACTIVE student of the group and asks nothing else.
    const rosterSize = new Map<string, number>();
    for (const s of students) {
      if (s.is_active === false || s.group_id == null) continue;
      const id = String(s.group_id);
      rosterSize.set(id, (rosterSize.get(id) ?? 0) + 1);
    }

    const out: Row[] = [];
    for (const [key, bucket] of sessions) {
      const group = bucket.groupId ? groupById.get(bucket.groupId) : undefined;
      const lecture = lectureById.get(bucket.lectureId);
      const official = group?.lesson_price == null ? 0 : Number(group.lesson_price);
      const percentage = group?.center_percentage == null ? 0 : Number(group.center_percentage);

      // Dearest first: the full-price line is the baseline the discounts below
      // it are read against.
      const priced = [...bucket.heads.entries()]
        .filter((e): e is [number, number] => e[0] != null)
        .sort((a, b) => b[0] - a[0]);
      const lines: Row[] = [];
      let gross = 0;
      let attended = 0;
      for (const [price, count] of priced) {
        const subtotal = up(price * count);
        lines.push({ price, count, subtotal, discounted: price < official });
        gross += subtotal;
        attended += count;
      }
      const noPrice = bucket.heads.get(null) ?? 0;
      if (noPrice > 0) {
        lines.push({ price: null, count: noPrice, subtotal: 0, discounted: true });
        attended += noPrice;
      }

      const centerCut = up((gross * percentage) / 100);
      const netAfterCut = gross - centerCut;

      let income = 0;
      let expense = 0;
      const lineItems = (entriesByKey.get(key) ?? [])
        .slice()
        .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
        .map((e) => {
          const amount = up(Number(e.amount ?? 0));
          if (e.kind === "income") income += amount;
          else expense += amount;
          return {
            id: e.id,
            lecture_id: e.lecture_id,
            group_id: e.group_id ?? null,
            session_date: e.session_date,
            kind: e.kind,
            description: e.description ?? "",
            amount,
            version: e.version ?? 0,
          };
        });

      out.push({
        key,
        lecture_id: bucket.lectureId,
        lecture_name: lecture?.name ?? "حصة محذوفة",
        group_id: bucket.groupId,
        group_label: groupLabel(group),
        center_name: group?.center_name ?? null,
        grade: group?.grade ?? lecture?.grade ?? null,
        session_date: bucket.day,
        start_time: group?.start_time ?? null,
        students: group ? rosterSize.get(String(group.id)) ?? 0 : attended,
        attended,
        lesson_price: up(official),
        lines,
        gross,
        percentage,
        center_cut: centerCut,
        net_after_cut: netAfterCut,
        entries: lineItems,
        other_income: income,
        other_expense: expense,
        total: netAfterCut + income - expense,
        attendees: [...(attendeesByKey.get(key) ?? [])]
          .map((id) => assistantName.get(id) ?? "")
          .sort((a, b) => a.localeCompare(b)),
      });
    }

    // Newest day first, earliest slot within a day - the page reads as a diary.
    out.sort((a, b) => {
      const day = String(b.session_date).localeCompare(String(a.session_date));
      if (day !== 0) return day;
      return String(a.start_time ?? "00:00").localeCompare(String(b.start_time ?? "00:00"));
    });
    return out;
  }

  /**
   * The assistant tick-list for one session: every assistant in the workspace,
   * each marked with whether the mirror has them present at it.
   */
  private async readSessionAttendance(params: URLSearchParams): Promise<Row[]> {
    const lectureId = params.get("lecture_id");
    const day = params.get("date");
    const groupId = params.get("group_id");
    if (!lectureId || !day) return [];
    const [assistants, marks] = await Promise.all([
      getAll<Row>(this.db, STORES.assistants),
      getAll<Row>(this.db, STORES.lessonAttendance),
    ]);
    const key = sessionKey(lectureId, groupId, day);
    const present = new Set(
      marks
        .filter(
          (m) =>
            sessionKey(String(m.lecture_id), (m.group_id as string | null) ?? null,
              String(m.session_date ?? "")) === key,
        )
        .map((m) => String(m.user_id)),
    );
    return assistants
      .map((a) => ({
        id: a.id,
        name: a.username ?? "",
        attended: present.has(String(a.id)),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  /**
   * The school / area suggestion lists and the next student code, rebuilt from
   * the mirror. Without this the offline "طالب جديد" form opens with no code and
   * no suggestions, which reads as a broken form rather than a missing network.
   *
   * <p>The code is a GUESS - the real one comes from a database sequence, and two
   * devices offline at once would both propose the same number. That is fine: it
   * is shown as a preview, and the server assigns the authoritative code when the
   * queued student syncs.
   */
  private async readStudentOptions(): Promise<Row> {
    const rows = (await getAll<Row>(this.db, STORES.students)).filter((r) => r.deleted_at == null);
    const distinct = (key: string) =>
      [...new Set(rows.map((r) => String(r[key] ?? "")).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ar"),
      );
    const maxSerial = rows.reduce((max, r) => Math.max(max, Number(r.serial ?? 0)), 0);
    return {
      schools: distinct("school"),
      cities: distinct("city"),
      next_serial: maxSerial + 1,
    };
  }

  /**
   * One student's history across their grade's lessons: attended lessons come
   * from their registrations, and every other lesson of that grade counts as an
   * absence - the same shape the server builds.
   */
  private async readHistory(studentId: string): Promise<Row[]> {
    const [student, regs, lectures] = await Promise.all([
      getOne<Row>(this.db, STORES.students, studentId),
      getAll<Row>(this.db, STORES.registrations),
      getAll<Row>(this.db, STORES.lectures),
    ]);
    const grade = student?.grade ?? null;
    const mine = new Map(
      regs.filter((r) => r.student_id === studentId).map((r) => [String(r.lecture_id), r]),
    );
    return lectures
      .filter((l) => grade == null || l.grade === grade)
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
      .map((l) => {
        const r = mine.get(String(l.id));
        return {
          id: l.id,
          lecture_name: l.name ?? "",
          status: r?.status ?? "absent",
          exam_score: r?.exam_score ?? null,
          exam_grade: l.exam_grade ?? null,
          has_exam: l.has_exam ?? false,
          homework_flag: r?.homework_flag ?? null,
        };
      });
  }

  /** Distinct grade names present in the mirror, shaped like the /grades list. */
  private async readGrades(): Promise<Row[]> {
    const seen = new Set<string>();
    for (const store of [STORES.students, STORES.groups, STORES.lectures]) {
      const rows = await getAll<Row>(this.db, store);
      for (const r of rows) {
        const g = r.grade;
        if (typeof g === "string" && g) seen.add(g);
      }
    }
    return [...seen]
      .sort((a, b) => a.localeCompare(b, "ar"))
      .map((name) => ({ id: name, name, is_active: true, track_kind: null }));
  }

  /**
   * The grades this workspace teaches, offline.
   *
   * <p>Online the server answers from the centers' price lists; the mirror has
   * no centers, so it answers from the groups, which is the same question asked
   * of the data that is here. School order is lost - the grades' sort order is
   * not mirrored - so this falls back to alphabetical.
   */
  private async readGradesInUse(): Promise<Row[]> {
    const rows = await getAll<Row>(this.db, STORES.groups);
    const seen = new Set<string>();
    for (const r of rows) {
      const g = r.grade;
      if (typeof g === "string" && g) seen.add(g);
    }
    return [...seen]
      .sort((a, b) => a.localeCompare(b, "ar"))
      .map((name) => ({ id: name, name, is_active: true, track_kind: null }));
  }

  private async readLectures(params: URLSearchParams): Promise<Page<Row>> {
    const grade = params.get("grade");
    const size = Number(params.get("size") ?? 2000);
    let rows = await getAll<Row>(this.db, STORES.lectures);
    if (grade) rows = rows.filter((r) => r.grade === grade);
    // The screen asks for createdAt,desc so the newest lesson is first.
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return toPage(rows, size);
  }

  private async readRegistrations(params: URLSearchParams): Promise<Page<Row>> {
    const lectureId = params.get("lectureId");
    const groupId = params.get("groupId");
    // The lesson-group screen asks for the students registered under NO group.
    const groupless = params.get("groupless") === "true";
    const size = Number(params.get("size") ?? 2000);
    if (!lectureId) return toPage<Row>([], size);
    const [regs, students] = await Promise.all([
      getAll<Row>(this.db, STORES.registrations),
      getAll<Row>(this.db, STORES.students),
    ]);
    const studentById = new Map(students.map((s) => [String(s.id), s]));
    // total_lessons is a server @Formula (a student's lifetime registration
    // count); recompute it from the mirror so the "طلاب جدد" stat still works.
    const lessonsByStudent = new Map<string, number>();
    for (const r of regs) {
      const sid = String(r.student_id);
      lessonsByStudent.set(sid, (lessonsByStudent.get(sid) ?? 0) + 1);
    }
    const rows = regs
      .filter((r) => r.lecture_id === lectureId)
      .filter((r) => (groupless ? r.group_id == null : !groupId || r.group_id === groupId))
      .map((r) => reconstructRegistration(r, studentById.get(String(r.student_id)), lessonsByStudent));
    return toPage(rows, size);
  }

  private async readStudents(params: URLSearchParams): Promise<Page<Row>> {
    const grade = params.get("grade");
    const size = Number(params.get("size") ?? 8);
    // The attendance screen searches with a typed field (name | serial | phone);
    // the students page uses ONE unified `search` box the backend matches across
    // name, code and phone. Serve both.
    const name = params.get("name");
    const serial = params.get("serial");
    const phone = params.get("phone");
    const search = params.get("search");
    let rows = await getAll<Row>(this.db, STORES.students);
    // The feed carries soft-deleted students so the mirror can stand in for the
    // students page; searches must not surface them.
    rows = rows.filter((r) => r.deleted_at == null);
    if (grade) rows = rows.filter((r) => r.grade === grade);
    if (name) {
      const q = foldArabic(name);
      rows = rows.filter((r) => foldArabic(String(r.name ?? "")).includes(q));
    } else if (serial) {
      rows = rows.filter((r) => String(r.serial ?? "").startsWith(serial.trim()));
    } else if (phone) {
      const p = phone.trim();
      rows = rows.filter((r) => phonesOf(r).some((n) => n.includes(p)));
    } else if (search && search.trim()) {
      // The unified box. Delegated to the shared rule rather than reimplemented
      // here: an offline search that narrowed differently from the online one
      // would be worse than no offline search, because nobody would know which
      // of the two answers to believe.
      rows = rows.filter((r) => matchesStudentSearch(r as SearchableStudent, search));
    }
    rows.sort((a, b) => Number(a.serial ?? 0) - Number(b.serial ?? 0));
    return toPage(rows.slice(0, size), size);
  }

  // --- Offline write ----------------------------------------------------

  /**
   * Record an attendance ("تحضير") offline: writes the optimistic registration
   * mirror row AND its outbox mutation in ONE transaction, then returns the row
   * reshaped exactly like a POST /registrations response so the screen can drop
   * it straight into its list. The queued mutation replays as a `registration`
   * upsert, which on the server also logs the day's attendance and (once) fires
   * the parent WhatsApp message - the same effect as the online path.
   */
  async queueRegistration(
    payload: {
      lecture_id: string;
      student_id: string;
      group_id: string;
      status: string;
      homework_flag: string | null;
    },
    student: Student,
  ): Promise<Row> {
    const rowId = uuidv7();
    const mutationId = uuidv7();
    const now = new Date().toISOString();

    // The narrow feed-shaped mirror row (matches sync's registrationRow), so a
    // later offline re-read reconstructs the same response the server would.
    const mirrorRow: Row = {
      id: rowId,
      lecture_id: payload.lecture_id,
      student_id: payload.student_id,
      group_id: payload.group_id,
      status: payload.status,
      exam_score: null,
      homework_flag: payload.homework_flag,
      created_at: now,
      // The instant the student was actually marked present. created_at will end
      // up being whenever this row finally reached the server, which is not the
      // same thing and is the wrong answer for "وقت الحضور".
      attended_at: now,
      student_name: student.name,
      student_serial: student.serial,
      student_grade: student.grade,
      assigned_group_id: student.group_id,
    };
    const mutation: OutboxRow = {
      mutationId,
      entity: "registration",
      op: "upsert",
      rowId,
      baseVersion: 0,
      payload: {
        id: rowId,
        lecture_id: payload.lecture_id,
        student_id: payload.student_id,
        group_id: payload.group_id,
        status: payload.status,
        homework_flag: payload.homework_flag,
        // Travels with the mutation so the server records when the student
        // arrived, not when the queue drained.
        attended_at: now,
      },
      queuedAt: now,
      attempts: 0,
      nextRetryAt: 0,
    };

    const tx = this.db.transaction([STORES.registrations, STORES.outbox], "readwrite");
    tx.objectStore(STORES.registrations).put(mirrorRow);
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);

    // Reconstruct the full response from the student we already hold in hand.
    const lessons = await this.countStudentLessons(payload.student_id);
    return reconstructRegistration(mirrorRow, student as unknown as Row, new Map([[payload.student_id, lessons]]));
  }

  private async countStudentLessons(studentId: string): Promise<number> {
    const regs = await getAll<Row>(this.db, STORES.registrations);
    return regs.filter((r) => r.student_id === studentId).length;
  }

  /**
   * Add or edit a student offline: writes the optimistic student mirror row AND
   * its outbox mutation in ONE transaction, then returns the stored row. The
   * queued mutation replays as a `student` upsert - the server runs the SAME
   * validation, duplicate detection and id assignment as the online create, and
   * keeps the client's row id, so the record the user saw IS the server's record.
   *
   * @param id  the existing student id when editing; omitted for a new student
   *            (a client id is minted, which the server then honours).
   */
  async queueStudent(
    payload: Record<string, unknown>,
    optimistic: Row,
    id?: string,
  ): Promise<Row> {
    const rowId = id ?? uuidv7();
    const mutationId = uuidv7();
    const now = new Date().toISOString();
    const row: Row = { ...optimistic, id: rowId, deleted_at: null };
    const mutation: OutboxRow = {
      mutationId,
      entity: "student",
      op: "upsert",
      rowId,
      baseVersion: 0,
      payload: { ...payload, id: rowId },
      queuedAt: now,
      attempts: 0,
      nextRetryAt: 0,
    };
    const tx = this.db.transaction([STORES.students, STORES.outbox], "readwrite");
    tx.objectStore(STORES.students).put(row);
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);
    return row;
  }

  /**
   * Change a registration offline - the homework flag, the exam score, or both.
   *
   * <p>The queued mutation is a whole-row upsert rather than the field-level
   * PATCH the online UI uses, because that is the only shape sync speaks. The
   * server resolves it on the natural key (lesson + student + group), so it lands
   * on the same row the device is looking at.
   *
   * @param base what the screen is showing, used when the mirror has never seen
   *        this registration - a lesson registered online minutes ago has not
   *        been pulled yet, and "your grade cannot be saved because a background
   *        feed has not caught up" is not an answer anyone can act on. The
   *        row is written into the mirror from it, so the screen keeps working
   *        offline too. Omit it and a missing row still means "cannot".
   */
  async queueRegistrationUpdate(
    registrationId: string,
    patch: { homework_flag?: string | null; exam_score?: number | null },
    base?: RegistrationBase,
  ): Promise<Row | undefined> {
    const now = new Date().toISOString();
    const existing =
      (await getOne<Row>(this.db, STORES.registrations, registrationId)) ??
      (base
        ? ({
            id: registrationId,
            lecture_id: base.lecture_id,
            student_id: base.student_id,
            group_id: base.group_id,
            status: base.status ?? "present",
            homework_flag: base.homework_flag ?? null,
            exam_score: base.exam_score ?? null,
            created_at: base.attended_at ?? now,
            attended_at: base.attended_at ?? now,
            student_name: base.student_name ?? null,
            student_serial: base.student_serial ?? null,
          } as Row)
        : undefined);
    if (!existing) return undefined;
    const row: Row = { ...existing, ...patch };
    const mutation: OutboxRow = {
      mutationId: uuidv7(),
      entity: "registration",
      op: "upsert",
      rowId: registrationId,
      baseVersion: 0,
      payload: {
        id: registrationId,
        lecture_id: row.lecture_id,
        student_id: row.student_id,
        group_id: row.group_id,
        status: row.status,
        homework_flag: row.homework_flag ?? null,
        exam_score: row.exam_score ?? null,
        attended_at: row.attended_at ?? row.created_at ?? now,
      },
      queuedAt: now,
      attempts: 0,
      nextRetryAt: 0,
    };
    const tx = this.db.transaction([STORES.registrations, STORES.outbox], "readwrite");
    tx.objectStore(STORES.registrations).put(row);
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);

    const student = await getOne<Row>(this.db, STORES.students, String(row.student_id));
    const lessons = await this.countStudentLessons(String(row.student_id));
    return reconstructRegistration(row, student, new Map([[String(row.student_id), lessons]]));
  }

  /**
   * Teach the mirror about registrations it has not pulled yet, WITHOUT queueing
   * anything - these rows already exist on the server, they just arrived through
   * a screen's own request before the change feed's next pass.
   *
   * <p>Only rows the mirror is missing are written. An existing row is left
   * exactly as it is: it came from the feed, which carries more than a screen
   * does, and a screen's narrower copy must never overwrite it.
   */
  async seedRegistrations(rows: MirroredRegistration[]): Promise<void> {
    const missing: Row[] = [];
    for (const r of rows) {
      if (await getOne<Row>(this.db, STORES.registrations, r.id)) continue;
      missing.push({
        id: r.id,
        lecture_id: r.lecture_id,
        student_id: r.student_id,
        group_id: r.group_id,
        status: r.status ?? "present",
        exam_score: r.exam_score ?? null,
        homework_flag: r.homework_flag ?? null,
        created_at: r.attended_at ?? null,
        attended_at: r.attended_at ?? null,
        student_name: r.student_name ?? null,
        student_serial: r.student_serial ?? null,
      });
    }
    if (missing.length === 0) return;
    const tx = this.db.transaction(STORES.registrations, "readwrite");
    const store = tx.objectStore(STORES.registrations);
    for (const row of missing) store.put(row);
    await txDone(tx);
  }

  /** Remove an attendance offline: drop the mirror row and queue the delete. */
  async queueRegistrationDelete(registrationId: string): Promise<void> {
    await this.queueDelete(STORES.registrations, "registration", registrationId);
  }

  /**
   * Delete a student offline. The mirror row is removed rather than marked, so
   * the students page stops showing them at once - the queued delete makes it
   * true on the server, and a delete of a student already gone is a success
   * there, not an error.
   */
  async queueStudentDelete(studentId: string): Promise<void> {
    await this.queueDelete(STORES.students, "student", studentId);
  }

  /** Add or edit a lesson offline, mirroring {@link queueStudent}. */
  async queueLecture(
    payload: Record<string, unknown>,
    optimistic: Row,
    id?: string,
  ): Promise<Row> {
    const rowId = id ?? uuidv7();
    const now = new Date().toISOString();
    const row: Row = { ...optimistic, id: rowId };
    const mutation: OutboxRow = {
      mutationId: uuidv7(),
      entity: "lecture",
      op: "upsert",
      rowId,
      baseVersion: 0,
      payload: { ...payload, id: rowId },
      queuedAt: now,
      attempts: 0,
      nextRetryAt: 0,
    };
    const tx = this.db.transaction([STORES.lectures, STORES.outbox], "readwrite");
    tx.objectStore(STORES.lectures).put(row);
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);
    return row;
  }

  /** Delete a lesson offline. */
  async queueLectureDelete(lectureId: string): Promise<void> {
    await this.queueDelete(STORES.lectures, "lecture", lectureId);
  }

  /**
   * Add or edit a manual invoice line offline, mirroring {@link queueStudent}.
   * The returned row is shaped like the REST response, so the page can drop it
   * straight into the invoice it came from.
   */
  async queueFinanceEntry(payload: Record<string, unknown>, id?: string): Promise<Row> {
    const rowId = id ?? uuidv7();
    const now = new Date().toISOString();
    const existing = id ? await getOne<Row>(this.db, STORES.financeEntries, id) : undefined;
    const row: Row = {
      ...payload,
      id: rowId,
      amount: up(Number(payload.amount ?? 0)),
      // Kept from the row being edited so the invoice keeps its line order; a new
      // line is written now, which puts it last.
      created_at: existing?.created_at ?? now,
      version: existing?.version ?? 0,
    };
    const mutation: OutboxRow = {
      mutationId: uuidv7(),
      entity: "finance_entry",
      op: "upsert",
      rowId,
      baseVersion: 0,
      payload: { ...payload, id: rowId },
      queuedAt: now,
      attempts: 0,
      nextRetryAt: 0,
    };
    const tx = this.db.transaction([STORES.financeEntries, STORES.outbox], "readwrite");
    tx.objectStore(STORES.financeEntries).put(row);
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);
    return row;
  }

  /** Delete a manual invoice line offline. */
  async queueFinanceEntryDelete(entryId: string): Promise<void> {
    await this.queueDelete(STORES.financeEntries, "finance_entry", entryId);
  }

  /**
   * Set which assistants worked one lesson session, offline.
   *
   * <p>The form edits a SET, so this replaces the session's marks wholesale
   * rather than writing one row per tick - the same thing the server does, which
   * is why the queued mutation carries the whole list instead of a row id. It
   * is idempotent for free: replaying the list leaves the same set.
   */
  async queueAssistantAttendance(payload: {
    lecture_id: string;
    group_id: string | null;
    session_date: string;
    user_ids: string[];
  }): Promise<void> {
    const now = new Date().toISOString();
    const key = sessionKey(payload.lecture_id, payload.group_id, payload.session_date);
    const stale = (await getAll<Row>(this.db, STORES.lessonAttendance)).filter(
      (m) =>
        sessionKey(String(m.lecture_id), (m.group_id as string | null) ?? null,
          String(m.session_date ?? "")) === key,
    );
    const mutation: OutboxRow = {
      mutationId: uuidv7(),
      entity: "assistant_attendance",
      op: "upsert",
      rowId: uuidv7(),
      baseVersion: 0,
      payload: { ...payload },
      queuedAt: now,
      attempts: 0,
      nextRetryAt: 0,
    };
    const tx = this.db.transaction([STORES.lessonAttendance, STORES.outbox], "readwrite");
    const marks = tx.objectStore(STORES.lessonAttendance);
    for (const row of stale) marks.delete(String(row.id));
    for (const userId of payload.user_ids) {
      marks.put({
        // A client id: the server mints its own rows for this session, and the
        // feed will replace these the moment the queue drains.
        id: uuidv7(),
        lecture_id: payload.lecture_id,
        group_id: payload.group_id,
        session_date: payload.session_date,
        user_id: userId,
        created_at: now,
      });
    }
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);
  }

  /** The shape every offline delete shares: drop the row, queue the mutation. */
  private async queueDelete(storeName: string, entity: string, rowId: string): Promise<void> {
    const now = new Date().toISOString();
    const mutation: OutboxRow = {
      mutationId: uuidv7(),
      entity,
      op: "delete",
      rowId,
      baseVersion: 0,
      queuedAt: now,
      attempts: 0,
      nextRetryAt: 0,
    };
    const tx = this.db.transaction([storeName, STORES.outbox], "readwrite");
    tx.objectStore(storeName).delete(rowId);
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);
  }

  /**
   * Queue a lesson's attendance / absence WhatsApp batch, asked for while the
   * line was down.
   *
   * <p>Nothing local changes - this writes no mirror row, because a WhatsApp
   * message is not data this app owns. It is a request that leaves the building,
   * and the outbox is how a request survives having nowhere to go yet. On
   * reconnect it replays as a `whatsapp_send` mutation, the server hands it to
   * its own outbox, and the send happens there - so "the browser is back" and
   * "WhatsApp is reachable" stay two separate questions, each answered by
   * whoever can actually answer it.
   *
   * <p>It cannot double-send: the sync ledger drops a re-delivered mutation, and
   * the send itself skips every student already messaged for that lesson.
   */
  async queueWhatsappSend(payload: {
    origin: "ATTENDANCE" | "ABSENCE";
    lecture_id: string;
    group_id: string;
    by_user?: string | null;
    by_name?: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    const mutation: OutboxRow = {
      mutationId: uuidv7(),
      entity: "whatsapp_send",
      op: "upsert",
      rowId: uuidv7(),
      baseVersion: 0,
      payload: { ...payload },
      queuedAt: now,
      attempts: 0,
      nextRetryAt: 0,
    };
    const tx = this.db.transaction(STORES.outbox, "readwrite");
    tx.objectStore(STORES.outbox).put(mutation);
    await txDone(tx);
  }
}

/**
 * Delete any registration mirror row that shares this row's natural key
 * (lecture + student + group) but carries a different id - the losers of a
 * cross-device dedup, so the just-applied authoritative row stands alone.
 * Scans only the student's own registrations via the student_id index.
 */
function evictStaleRegistration(store: IDBObjectStore, row: Row): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.index("student_id").openCursor(IDBKeyRange.only(String(row.student_id)));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const v = cursor.value as Row;
      const sameKey =
        v.lecture_id === row.lecture_id && (v.group_id ?? null) === (row.group_id ?? null);
      if (sameKey && v.id !== row.id) cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("registration dedupe failed"));
  });
}

/**
 * Delete any assistant-attendance row for the same session and assistant that
 * carries a different id - the client-minted copy of a mark the server has now
 * answered for. The store holds one row per assistant per session, so it is
 * small enough to walk without an index.
 */
function evictStaleAttendance(store: IDBObjectStore, row: Row): Promise<void> {
  const key = sessionKey(String(row.lecture_id), (row.group_id as string | null) ?? null,
    String(row.session_date ?? ""));
  return new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const v = cursor.value as Row;
      const sameSession =
        sessionKey(String(v.lecture_id), (v.group_id as string | null) ?? null,
          String(v.session_date ?? "")) === key;
      if (sameSession && String(v.user_id) === String(row.user_id) && v.id !== row.id) {
        cursor.delete();
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("attendance dedupe failed"));
  });
}

/**
 * Join a narrow registration mirror row with its student to rebuild the enriched
 * RegistrationResponse the desk screen renders. Student fields win when present;
 * the row's flattened copies (student_name/serial/grade) are the fallback for a
 * student not yet in the mirror.
 */
function reconstructRegistration(
  r: Row,
  s: Row | undefined,
  lessonsByStudent: Map<string, number>,
): Row {
  const sid = String(r.student_id);
  return {
    id: r.id,
    student_id: r.student_id,
    serial: s?.serial ?? r.student_serial ?? null,
    name: s?.name ?? r.student_name ?? "",
    grade: s?.grade ?? r.student_grade ?? null,
    gender: s?.gender ?? null,
    school: s?.school ?? null,
    city: s?.city ?? null,
    religion: s?.religion ?? null,
    academic_track: s?.academic_track ?? null,
    lesson_price: s?.lesson_price ?? null,
    student_phones: (s?.student_phones as string[] | undefined) ?? [],
    parent_phones: (s?.parent_phones as string[] | undefined) ?? [],
    is_active: s?.is_active ?? true,
    attended_at: r.attended_at ?? r.created_at ?? null,
    // The student's home group vs the group they were registered under.
    assigned_group_id: s?.group_id ?? r.assigned_group_id ?? null,
    registered_group_id: r.group_id ?? null,
    status: r.status ?? "present",
    exam_score: r.exam_score ?? null,
    homework_flag: r.homework_flag ?? null,
    total_lessons: lessonsByStudent.get(sid) ?? 1,
  };
}
