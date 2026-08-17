// Wires the platform-agnostic SyncEngine into the web app: opens the IndexedDB
// store, points the offline read-fallback at it, runs the engine for the signed-in
// staff account, and exposes its live status plus an offline-write helper to the
// screens. Students never reach this app and a super admin's data is cross-tenant
// (the pull feed is empty for them), so the engine runs only for admin/assistant.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SyncEngine, initialStatus, type StoredMutation, type SyncStatus } from "@center/core";
import { useAuth } from "@/auth/AuthContext";
import { setOfflineRead } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import type { Student } from "@/modules/students/StudentForm";
import { WebSyncStore, type MirroredRegistration, type RegistrationBase } from "./store";
import { HttpSyncTransport } from "./transport";
import { BrowserNetworkMonitor } from "./network";

/** What the user called the refused write, in their own words. */
const REJECTED_AR: Record<string, { upsert: string; delete: string }> = {
  registration: { upsert: "تعذّر حفظ تحضير", delete: "تعذّر حذف تحضير" },
  student: { upsert: "تعذّر حفظ بيانات طالب", delete: "تعذّر حذف طالب" },
  lecture: { upsert: "تعذّر حفظ حصة", delete: "تعذّر حذف حصة" },
  whatsapp_send: { upsert: "تعذّر إرسال رسالة واتساب", delete: "تعذّر إلغاء رسالة" },
  finance_entry: { upsert: "تعذّر حفظ بند في الحسابات", delete: "تعذّر حذف بند من الحسابات" },
  assistant_attendance: { upsert: "تعذّر حفظ حضور المساعدين", delete: "تعذّر حذف حضور المساعدين" },
};

function rejectedLabel(m: StoredMutation): string {
  const entry = REJECTED_AR[m.entity];
  if (!entry) return "تعذّر حفظ تغيير غير متزامن";
  return m.op === "delete" ? entry.delete : entry.upsert;
}

interface RegistrationPayload {
  lecture_id: string;
  student_id: string;
  group_id: string;
  status: string;
  homework_flag: string | null;
}

interface SyncContextValue {
  status: SyncStatus;
  /** True once the engine + store are up (offline writes are accepted). */
  ready: boolean;
  /** Force a sync pass now (e.g. a manual "retry"). No-op while offline. */
  syncNow: () => void;
  /**
   * Record an attendance offline: durably queues it and returns the row shaped
   * like a POST /registrations response. Throws if the engine is not ready yet.
   */
  queueRegistration: (payload: RegistrationPayload, student: Student) => Promise<Record<string, unknown>>;
  /**
   * Add or edit a student offline: durably queues it and returns the optimistic
   * student row. Pass `id` when editing an existing student.
   */
  queueStudent: (
    payload: Record<string, unknown>,
    optimistic: Record<string, unknown>,
    id?: string,
  ) => Promise<Record<string, unknown>>;
  /** Delete a student offline; the row goes now, the server catches up. */
  queueStudentDelete: (id: string) => Promise<void>;
  /**
   * Change an attendance offline - homework flag, exam score, or both. Returns
   * the updated row shaped like the PATCH response, or null when the mirror does
   * not hold that registration AND the caller passed no `base` to rebuild it
   * from.
   */
  queueRegistrationUpdate: (
    id: string,
    patch: { homework_flag?: string | null; exam_score?: number | null },
    base?: RegistrationBase,
  ) => Promise<Record<string, unknown> | null>;
  /** Remove an attendance offline. */
  queueRegistrationDelete: (id: string) => Promise<void>;
  /**
   * Copy registrations a screen just read into the mirror, so they survive a
   * reload with no line. Writes nothing to the outbox - these rows are already
   * on the server - and never overwrites a row the pull feed has delivered.
   */
  mirrorRegistrations: (rows: MirroredRegistration[]) => Promise<void>;
  /** Add or edit a lesson offline; pass `id` when editing. */
  queueLecture: (
    payload: Record<string, unknown>,
    optimistic: Record<string, unknown>,
    id?: string,
  ) => Promise<Record<string, unknown>>;
  /** Delete a lesson offline. */
  queueLectureDelete: (id: string) => Promise<void>;
  /**
   * Ask for a lesson's attendance / absence WhatsApp batch while offline. The
   * request is queued here and performed by the server once the line is back.
   */
  queueWhatsappSend: (payload: WhatsappSendPayload) => Promise<void>;
  /** Add or edit a manual invoice line offline; pass `id` when editing. */
  queueFinanceEntry: (
    payload: Record<string, unknown>,
    id?: string,
  ) => Promise<Record<string, unknown>>;
  /** Delete a manual invoice line offline. */
  queueFinanceEntryDelete: (id: string) => Promise<void>;
  /** Replace one session's assistant tick-list offline. */
  queueAssistantAttendance: (payload: AssistantAttendancePayload) => Promise<void>;
}

export interface AssistantAttendancePayload {
  lecture_id: string;
  group_id: string | null;
  session_date: string;
  user_ids: string[];
}

export interface WhatsappSendPayload {
  origin: "ATTENDANCE" | "ABSENCE";
  lecture_id: string;
  group_id: string;
  by_user?: string | null;
  by_name?: string | null;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // A super admin owns no workspace data (the pull feed is empty for them) and
  // is skipped; every other signed-in account syncs its own workspace, keyed by
  // its id so each owner gets its own local database.
  const owner = user?.role === "super_admin" ? null : user?.id ?? null;

  const [status, setStatus] = useState<SyncStatus>(() => initialStatus(navigator.onLine));
  const engineRef = useRef<SyncEngine | null>(null);
  const storeRef = useRef<Promise<WebSyncStore> | null>(null);
  const registeredOwner = useRef<string | null | undefined>(undefined);
  const [ready, setReady] = useState(false);

  // Register the offline READ fallback DURING RENDER, before any child screen's
  // effect fires its first api.get. Registering it in an effect was too late: a
  // parent's effect runs AFTER its children's, so a screen that mounts while the
  // browser is already offline fired its reads with no fallback yet and stuck on
  // an empty state. The store opens lazily (memoised per owner) and is reused by
  // the engine below. Guarded by owner so it runs once per account, not per render.
  if (registeredOwner.current !== owner) {
    registeredOwner.current = owner;
    if (owner) {
      const storePromise = WebSyncStore.open(owner);
      storeRef.current = storePromise;
      setOfflineRead((path) => storePromise.then((s) => s.resolveRead(path)));
    } else {
      storeRef.current = null;
      setOfflineRead(null);
    }
  }

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    let engine: SyncEngine | null = null;

    (async () => {
      const store = await (storeRef.current ?? WebSyncStore.open(owner));
      if (!alive) return;

      engine = new SyncEngine({
        store,
        transport: new HttpSyncTransport(),
        network: new BrowserNetworkMonitor(),
        onStatus: (s) => {
          if (alive) setStatus(s);
        },
        // A refusal is the end of that write: it is not retried and no server row
        // is coming to replace it. Say what was lost and why, once, right here -
        // the screen that queued it is usually long gone by now.
        onRejected: (mutation, message) => {
          if (alive) toast.error(`${rejectedLabel(mutation)}: ${message}`, { duration: 8000 });
        },
      });
      engineRef.current = engine;
      setReady(true);
      engine.start();
    })();

    return () => {
      alive = false;
      engine?.stop();
      engineRef.current = null;
      setReady(false);
      setStatus(initialStatus(navigator.onLine));
      // offlineRead is owned by the render-time guard above (reset on owner change
      // / logout), NOT cleared here: clearing it on StrictMode's transient unmount
      // would wipe a resolver the next mount does not re-register.
    };
  }, [owner]);

  /**
   * The shape every offline write shares: get the store, do the write, then tell
   * the engine there is something to push. The nudge matters - without it a
   * queued change would sit until the next 30-second heartbeat even if the line
   * was already back.
   */
  const write = useCallback(async function write<T>(
    action: (store: WebSyncStore) => Promise<T>,
  ): Promise<T> {
    const storePromise = storeRef.current;
    const engine = engineRef.current;
    if (!storePromise || !engine) throw new Error("المزامنة غير جاهزة");
    const result = await action(await storePromise);
    await engine.notifyLocalWrite();
    return result;
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({
      status,
      ready,
      syncNow: () => void engineRef.current?.sync(),
      queueRegistration: (payload, student) =>
        write((store) => store.queueRegistration(payload, student)),
      queueStudent: (payload, optimistic, id) =>
        write((store) => store.queueStudent(payload, optimistic, id)),
      queueStudentDelete: (id) => write((store) => store.queueStudentDelete(id)),
      queueRegistrationUpdate: async (id, patch, base) =>
        (await write((store) => store.queueRegistrationUpdate(id, patch, base))) ?? null,
      queueRegistrationDelete: (id) => write((store) => store.queueRegistrationDelete(id)),
      mirrorRegistrations: async (rows) => {
        // Not through `write`: there is nothing to push, so nudging the engine
        // would start a sync pass for no reason on every roster that loads.
        const storePromise = storeRef.current;
        if (!storePromise || rows.length === 0) return;
        await (await storePromise).seedRegistrations(rows);
      },
      queueLecture: (payload, optimistic, id) =>
        write((store) => store.queueLecture(payload, optimistic, id)),
      queueLectureDelete: (id) => write((store) => store.queueLectureDelete(id)),
      queueWhatsappSend: (payload) => write((store) => store.queueWhatsappSend(payload)),
      queueFinanceEntry: (payload, id) => write((store) => store.queueFinanceEntry(payload, id)),
      queueFinanceEntryDelete: (id) => write((store) => store.queueFinanceEntryDelete(id)),
      queueAssistantAttendance: (payload) =>
        write((store) => store.queueAssistantAttendance(payload)),
    }),
    [status, ready, write],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * Sync state + offline-write helpers. Safe to call outside the provider (returns
 * a null-object) so a screen can use it without every screen being wrapped.
 */
export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (ctx) return ctx;
  return {
    status: initialStatus(typeof navigator === "undefined" ? true : navigator.onLine),
    ready: false,
    syncNow: () => {},
    queueRegistration: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueStudent: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueStudentDelete: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueRegistrationUpdate: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueRegistrationDelete: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    mirrorRegistrations: () => Promise.resolve(),
    queueLecture: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueLectureDelete: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueWhatsappSend: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueFinanceEntry: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueFinanceEntryDelete: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
    queueAssistantAttendance: () => Promise.reject(new Error("المزامنة غير مفعّلة")),
  };
}
