import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  Award,
  CalendarX2,
  Check,
  Loader2,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "@/components/icons";
import { THEAD } from "@/components/tableStyles";
import { Pagination } from "@/components/Pagination";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { api, ApiError, isOfflineError, qs, type Page } from "@/lib/api";
import { useCachedGet } from "@/lib/dataCache";
import { useOnline } from "@/lib/useOnline";
import { useWhatsappAction } from "@/lib/useWhatsappAvailability";
import { useSync } from "@/sync/SyncProvider";
import { LoaderBlock } from "@/components/PencilLoader";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/auth/AuthContext";
import { Select, Money, Modal, ConfirmDialog } from "@/components/ui";
import { fmtDateTime } from "@/lib/datetime";
import {
  STUDENT_SEARCH_PLACEHOLDER,
  matchesStudentSearch,
  searchModeLabel,
} from "@/lib/studentSearch";
import { homeworkLabel } from "@/lib/homework";
import { groupLabel, type Group } from "@/modules/students/StudentForm";
import { type Lecture } from "./LectureForm";

interface Reg {
  id: string;
  student_id: string;
  serial: number;
  name: string;
  gender: string | null;
  /** Not shown as a column any more, but still part of what the search matches. */
  school: string | null;
  city: string | null;
  lesson_price: number | null;
  student_phones: string[];
  parent_phones: string[];
  assigned_group_id: string | null;
  registered_group_id: string | null;
  homework_flag: string | null;
  exam_score: number | null;
  total_lessons: number;
  attended_at: string | null;
}

/** One student of this group who missed the lesson entirely. */
interface Absentee {
  student_id: string;
  serial: number | null;
  name: string;
  parent_phones: string[];
  /** null = unknown, which is what "offline" honestly answers. */
  sent: boolean | null;
}

const ROWS_OPTIONS = ["10", "25", "50", "الكل"];
const isOther = (r: Reg) =>
  !!(r.assigned_group_id && r.registered_group_id && r.assigned_group_id !== r.registered_group_id);

const Dash = () => <span className="block text-center text-slate-300">-</span>;

const SENT = "تم الإرسال";
const NOT_SENT = "لم تُرسل";
const SAME_GROUP = "نفس المجموعة";

/** The two message batches sent from this page, spelled as the API spells them. */
type SendKind = "attendance" | "exam-grade";

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * One group's roster within one lesson: the grades are typed here, and the
 * lesson's WhatsApp batches are sent from here.
 *
 * <p>Sending is a two-press action on purpose. The first press does not send
 * anything - it narrows the table to exactly the students the message would go
 * to and relabels the button "إرسال", so the list on screen IS the recipient
 * list. The second press sends it. Absence is the one exception: absentees have
 * no row on this table by definition, so they get a dialog of their own.
 */
export default function LessonGroupPage() {
  const { lectureId, groupId } = useParams<{ lectureId: string; groupId: string }>();
  const { data: lecture } = useCachedGet<Lecture>(lectureId ? `/lectures/${lectureId}` : null);
  const { data: groups } = useCachedGet<Group[]>("/groups");
  const { can } = useAuth();
  const sync = useSync();
  const online = useOnline();
  // The "message sent?" columns and their data only exist for users who may
  // send - everyone else never sees a column or fires the request.
  const canSend = can("NOTIFICATION_SEND");
  // Students registered under no group have no group to message about.
  const groupless = groupId === "none";

  const [rows, setRows] = useState<Reg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [rowsPer, setRowsPer] = useState("25");
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState<Reg | null>(null);

  /**
   * Who has already been messaged about this lesson. null = not known (offline,
   * or the request failed), which the columns say plainly rather than claiming
   * nothing has been sent.
   */
  const [msg, setMsg] = useState<{ attendance: Set<string>; exam: Set<string> } | null>(null);
  const [statusKey, setStatusKey] = useState(0);
  const [armed, setArmed] = useState<SendKind | null>(null);
  const [sending, setSending] = useState<SendKind | null>(null);
  /** The absentee list, loaded BEFORE the dialog opens - see openAbsentees. */
  const [absentees, setAbsentees] = useState<Absentee[] | null>(null);
  const [absentBusy, setAbsentBusy] = useState(false);

  // One ref per rendered exam input, so Enter / arrows can walk the column.
  const examRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusExam = (index: number) => {
    const el = examRefs.current[index];
    if (!el) return;
    el.focus();
    el.select();
  };

  useEffect(() => {
    if (!lectureId || !groupId) return;
    // One group's roster within one lesson is a bounded set, so fetch it whole
    // and keep the stats + pagination client-side. "none" filters to students
    // registered under no group.
    const groupParam = groupless ? { groupless: true } : { groupId };
    api
      .get<Page<Reg>>(`/registrations${qs({ lectureId, ...groupParam, size: 2000 })}`)
      .then((p) => {
        setRows(p.content);
        // Hand the roster to the mirror. The change feed gets here on its own
        // within half a minute, but attendance taken minutes ago and a line that
        // drops right after is the exact case this page has to survive: without
        // this, reloading it offline shows an empty lesson and no grade can be
        // typed at all.
        void sync.mirrorRegistrations(
          p.content.map((r) => ({
            id: r.id,
            lecture_id: lectureId,
            student_id: r.student_id,
            group_id: r.registered_group_id,
            status: "present",
            exam_score: r.exam_score,
            homework_flag: r.homework_flag,
            attended_at: r.attended_at,
            student_name: r.name,
            student_serial: r.serial,
          })),
        );
      })
      .finally(() => setLoading(false));
    // `sync` is a fresh object each render; depending on it would refetch the
    // whole roster on every status tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId, groupId, groupless]);

  useEffect(() => {
    if (!lectureId || !canSend) return;
    let alive = true;
    api
      .get<{ attendance: string[]; exam_grade: string[] }>(
        `/messaging/whatsapp/lectures/${lectureId}/message-status`,
      )
      .then((s) => {
        if (alive) setMsg({ attendance: new Set(s.attendance), exam: new Set(s.exam_grade) });
      })
      .catch(() => {
        if (alive) setMsg(null);
      });
    return () => {
      alive = false;
    };
  }, [lectureId, canSend, statusKey]);

  /** Remove a student from this lesson's attendance - as if never registered. */
  async function removeAttendance(reg: Reg) {
    const done = (queued: boolean) => {
      setRows((prev) => prev.filter((r) => r.id !== reg.id));
      toast.success(
        queued
          ? `تم حذف "${reg.name}" من الحضور - بانتظار المزامنة`
          : `تم حذف "${reg.name}" من الحضور`,
      );
    };
    try {
      if (!online && sync.ready) {
        await sync.queueRegistrationDelete(reg.id);
        done(true);
        return;
      }
      await api.del(`/registrations/${reg.id}`);
      done(false);
    } catch (err) {
      if (isOfflineError(err) && sync.ready) {
        await sync.queueRegistrationDelete(reg.id);
        done(true);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "تعذّر الحذف");
    } finally {
      setConfirmDelete(null);
    }
  }

  const groupById = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g])), [groups]);
  const label = useCallback(
    (id: string | null) => {
      if (!id) return "بدون مجموعة";
      const g = groupById.get(id);
      return g ? groupLabel(g) : "-";
    },
    [groupById],
  );
  const thisGroupLabel = groupless ? "بدون مجموعة" : label(groupId ?? null);

  // Max exam grade parsed from the lecture (e.g. "من 50" -> 50). null = no cap.
  // Authoritative, and false for every lesson saved as "بدون اختبار".
  const hasExam = lecture?.has_exam ?? true;

  const examMax = useMemo(() => {
    const m = lecture?.exam_grade?.match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }, [lecture]);

  const totals = useMemo(() => {
    let male = 0;
    let female = 0;
    let fresh = 0;
    for (const r of rows) {
      if (r.gender === "ذكر") male++;
      else if (r.gender === "أنثى") female++;
      if (r.total_lessons === 1) fresh++;
    }
    return { total: rows.length, male, female, fresh };
  }, [rows]);

  // ── Chip filters, exactly the students page's system ──────────────────
  const colVal = useMemo(() => {
    const messaged = (set: Set<string> | undefined, id: string) =>
      set?.has(id) ? SENT : NOT_SENT;
    return {
      gender: (r: Reg) => r.gender || "—",
      price: (r: Reg) =>
        r.lesson_price == null ? "—" : r.lesson_price === 0 ? "معفي" : String(r.lesson_price),
      homework: (r: Reg) => homeworkLabel(r.homework_flag) || "—",
      origin: (r: Reg) => (isOther(r) ? label(r.assigned_group_id) : SAME_GROUP),
      attendanceMsg: (r: Reg) => messaged(msg?.attendance, r.student_id),
      examMsg: (r: Reg) => messaged(msg?.exam, r.student_id),
    } as const;
  }, [label, msg]);
  type ColKey = keyof typeof colVal;

  // The message chips only mean something when the sent lists actually arrived.
  const FIELDS: { key: ColKey; label: string }[] = [
    { key: "gender", label: "النوع" },
    { key: "price", label: "السعر" },
    { key: "homework", label: "الواجب" },
    { key: "origin", label: "المجموعة الأصلية" },
    ...(canSend && msg
      ? ([
          { key: "attendanceMsg", label: "رسالة الحضور" },
          { key: "examMsg", label: "رسالة الدرجة" },
        ] as const)
      : []),
  ];

  const [colF, setColF] = useState<Partial<Record<ColKey, Set<string>>>>({});
  const [newOnly, setNewOnly] = useState(false);
  const setCol = (k: ColKey, s: Set<string>) => setColF((prev) => ({ ...prev, [k]: s }));

  // Options come from the whole roster, so a value that only appears on a later
  // page is still offered.
  const distinct = useMemo(() => {
    const out = {} as Record<ColKey, string[]>;
    (Object.keys(colVal) as ColKey[]).forEach((k) => {
      out[k] = Array.from(new Set(rows.map(colVal[k]))).sort((a, b) => a.localeCompare(b, "ar"));
    });
    return out;
  }, [rows, colVal]);

  /** The students one batch would actually message: never sent, and eligible. */
  const attendanceTargets = useMemo(
    () => (msg ? rows.filter((r) => !msg.attendance.has(r.student_id)) : []),
    [rows, msg],
  );
  const examTargets = useMemo(
    () => (msg ? rows.filter((r) => r.exam_score != null && !msg.exam.has(r.student_id)) : []),
    [rows, msg],
  );

  const filtered = useMemo(() => {
    let out = rows;
    // An armed button narrows to its own recipients first - that IS the preview.
    if (armed === "attendance") out = attendanceTargets;
    else if (armed === "exam-grade") out = examTargets;
    if (newOnly) out = out.filter((r) => r.total_lessons === 1);
    const keys = Object.keys(colF) as ColKey[];
    return out.filter(
      (r) =>
        matchesStudentSearch(r, search) &&
        keys.every((k) => {
          const set = colF[k];
          return !set || set.size === 0 || set.has(colVal[k](r));
        }),
    );
  }, [rows, armed, attendanceTargets, examTargets, newOnly, colF, colVal, search]);

  // Reset to page 1 whenever what is being shown changes.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, rowsPer, colF, newOnly, armed]);

  const anyChip = Object.values(colF).some((s) => s && s.size > 0) || newOnly;
  const hasFilters = !!search || anyChip;
  function clearFilters() {
    setSearch("");
    setColF({});
    setNewOnly(false);
  }
  function removeTag(k: ColKey, v: string) {
    setColF((prev) => {
      const set = new Set(prev[k]);
      set.delete(v);
      return { ...prev, [k]: set };
    });
  }
  const activeTags = FIELDS.flatMap((f) =>
    Array.from(colF[f.key] ?? []).map((v) => ({ key: f.key, label: f.label, value: v })),
  );

  const perPage = rowsPer === "الكل" ? filtered.length || 1 : Number(rowsPer);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice((current - 1) * perPage, current * perPage);

  function patchExam(id: string, updated: Reg) {
    setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }

  // ── Sending ───────────────────────────────────────────────────────────
  async function send(kind: SendKind) {
    if (sending) return;
    setSending(kind);
    try {
      const res = await api.post<{ sent: number; failed: number; total: number }>(
        `/messaging/whatsapp/lectures/${lectureId}/groups/${groupId}/${kind}`,
      );
      const failed = res.failed > 0 ? `، فشل ${res.failed.toLocaleString("ar-EG")}` : "";
      toast.success(`تم إرسال ${res.sent.toLocaleString("ar-EG")} رسالة${failed}`, {
        title: "تم الإرسال",
      });
      setArmed(null);
      // Re-read who has been messaged, so the columns and the next arm are true.
      setStatusKey((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر الإرسال");
    } finally {
      setSending(null);
    }
  }

  /**
   * Load the absentees, then decide whether there is anything worth showing.
   *
   * <p>An empty dialog is a wasted trip: the answer ("nobody missed this
   * lesson", "they have all been told") fits in a toast, and the list only
   * earns the screen when it has something on it. So the fetch happens here
   * rather than inside the dialog, and the dialog opens already holding it.
   *
   * <p>"send" is stricter than "view": it also stays shut when every absentee
   * has already had the message, because then the button has no work to do.
   */
  async function openAbsentees(mode: "send" | "view") {
    if (absentBusy) return;
    setAbsentBusy(true);
    try {
      const list = await api.get<Absentee[]>(
        `/messaging/whatsapp/lectures/${lectureId}/groups/${groupId}/absentees`,
      );
      if (list.length === 0) {
        toast.info("لا يوجد طلاب غائبون عن هذه الحصة");
        return;
      }
      if (mode === "send" && !list.some((a) => a.sent === false)) {
        toast.info("كل الغائبين استلموا رسالة الغياب بالفعل");
        return;
      }
      setAbsentees(list);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تحميل قائمة الغائبين");
    } finally {
      setAbsentBusy(false);
    }
  }

  /** First press arms and previews; second press sends what is on screen. */
  function armOrSend(kind: SendKind) {
    if (armed === kind) {
      void send(kind);
      return;
    }
    const targets = kind === "attendance" ? attendanceTargets : examTargets;
    if (targets.length === 0) {
      toast.info(
        kind === "attendance"
          ? "كل الحاضرين استلموا رسالة الحضور بالفعل"
          : "لا توجد درجات جديدة بحاجة لإرسال",
      );
      return;
    }
    // Every other filter goes: the send covers all the targets, so the table
    // must show all of them. A leftover search would display four names and
    // then send forty.
    clearFilters();
    setArmed(kind);
  }

  const sendBlocked = !online || !msg;
  const sendHint = !online
    ? "لا يوجد اتصال بالإنترنت"
    : !msg
      ? "تعذّر معرفة من استلم الرسائل"
      : undefined;

  // Each of the three buttons sends a DIFFERENT kind of message, and the three
  // can be on different numbers - so each asks about its own kind rather than
  // sharing one "is WhatsApp on?" answer.
  const waAttendance = useWhatsappAction("attendance");
  const waAbsence = useWhatsappAction("absence");
  const waExam = useWhatsappAction("exam_result");

  if (loading) return <LoaderBlock />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{thisGroupLabel}</h1>
        <Link
          to="/lectures"
          className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <ArrowRight className="h-4 w-4" />
          رجوع
        </Link>
      </div>

      {/* Sticky filter bar - same three rows as the students page. */}
      <div className="sticky top-0 z-20 -mx-4 mt-3 border-b border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6">
        {/* Row 1 - search + the lesson's own send buttons */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative w-full min-w-[200px] flex-1 sm:w-auto">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputMode="search"
              placeholder={STUDENT_SEARCH_PLACEHOLDER}
              aria-label="بحث"
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-9 text-slate-800 shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="مسح البحث"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {searchModeLabel(search) && (
              <span className="pointer-events-none absolute -bottom-4 right-1 text-[11px] text-slate-400">
                {searchModeLabel(search)}
              </span>
            )}
          </div>
          {canSend && !groupless && (
            <>
              <SendButton
                tone="accent"
                icon={<Send className="h-4 w-4" />}
                label="رسائل الحضور"
                armed={armed === "attendance"}
                count={attendanceTargets.length}
                busy={sending === "attendance"}
                disabled={sendBlocked || sending !== null || waAttendance.disabled}
                title={
                  sendHint ??
                  (waAttendance.disabled
                    ? (waAttendance.reason ?? "إرسال واتساب غير متاح")
                    : "عرض من ستصلهم رسالة الحضور ثم إرسالها")
                }
                onClick={() => armOrSend("attendance")}
                onCancel={() => setArmed(null)}
              />
              <button
                type="button"
                onClick={() => void openAbsentees("send")}
                disabled={!online || absentBusy || waAbsence.disabled}
                title={
                  !online
                    ? "لا يوجد اتصال بالإنترنت"
                    : waAbsence.disabled
                      ? (waAbsence.reason ?? "إرسال واتساب غير متاح")
                      : "عرض غائبي المجموعة وإرسال رسائل الغياب"
                }
                className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-rose-300 bg-white px-3.5 text-sm font-medium text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:opacity-50"
              >
                {absentBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarX2 className="h-4 w-4" />
                )}
                رسائل الغياب
              </button>
              <SendButton
                tone="amber"
                icon={<Award className="h-4 w-4" />}
                label="رسائل الدرجات"
                armed={armed === "exam-grade"}
                count={examTargets.length}
                busy={sending === "exam-grade"}
                disabled={sendBlocked || sending !== null || !hasExam || waExam.disabled}
                title={
                  !hasExam
                    ? "هذه الحصة بدون اختبار"
                    : (sendHint ??
                      (waExam.disabled
                        ? (waExam.reason ?? "إرسال واتساب غير متاح")
                        : "عرض من ستصلهم درجته ثم إرسالها"))
                }
                onClick={() => armOrSend("exam-grade")}
                onCancel={() => setArmed(null)}
              />
            </>
          )}
        </div>

        {/* Row 2 - filter chips */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {FIELDS.map((f) => (
            <MultiSelectFilter
              key={f.key}
              label={f.label}
              options={distinct[f.key]}
              selected={colF[f.key] ?? EMPTY_SET}
              onChange={(s) => setCol(f.key, s)}
            />
          ))}
          {/* Stands apart from the chips: it narrows by a fact about the student
              (this is their first lesson ever) rather than a column value. */}
          <button
            type="button"
            onClick={() => setNewOnly((v) => !v)}
            title="الطلاب الذين هذه أول حصة لهم"
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              newOnly
                ? "border-accent bg-accent/10 text-accent"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <Users className="h-4 w-4" />
            جدد
            <span className="text-xs text-slate-400">{totals.fresh.toLocaleString("ar-EG")}</span>
          </button>
          {/* Absentees are not rows in this table, so this one opens a list
              rather than narrowing the one on screen. */}
          {!groupless && (
            <button
              type="button"
              onClick={() => void openAbsentees("view")}
              disabled={absentBusy}
              title="غائبو هذه المجموعة عن هذه الحصة"
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <CalendarX2 className="h-4 w-4" />
              الغائبون
            </button>
          )}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="ms-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
            >
              <X className="h-4 w-4" />
              مسح الكل
            </button>
          )}
        </div>

        {/* Row 3 - active value tags */}
        {activeTags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {activeTags.map((t) => (
              <span
                key={`${t.key}:${t.value}`}
                className="animate-scale-up flex items-center gap-1 rounded-full bg-accent/10 py-1 pe-1 ps-2.5 text-xs font-medium text-accent"
              >
                <span className="text-accent/70">{t.label}:</span>
                {t.value}
                <button
                  onClick={() => removeTag(t.key, t.value)}
                  aria-label={`إزالة ${t.value}`}
                  className="rounded-full p-0.5 transition hover:bg-accent/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Says what the table is showing right now - it matters most while a send
          is armed, because then the table is a recipient list. */}
      {armed && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-slate-700">
          <Send className="h-4 w-4 shrink-0 text-accent" />
          {armed === "attendance"
            ? `هؤلاء من ستصلهم رسالة الحضور (${attendanceTargets.length.toLocaleString("ar-EG")}) - اضغط "إرسال" لإرسالها.`
            : `هؤلاء من ستصلهم درجة الاختبار (${examTargets.length.toLocaleString("ar-EG")}) - اضغط "إرسال" لإرسالها.`}
        </div>
      )}

      {/* Result total + page size */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-y-2 text-sm text-slate-500">
        <span>
          الإجمالي <span className="font-semibold text-slate-700">{filtered.length.toLocaleString("ar-EG")}</span>
          <span className="text-slate-400"> من {totals.total.toLocaleString("ar-EG")}</span>
        </span>
        {/* The same ♂/♀ marks the students page uses, in the same two colours.
            nowrap so the mark never falls onto its own line above its count. */}
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <span className="text-lg leading-none text-sky-600">♂</span>
            ذكور {totals.male.toLocaleString("ar-EG")}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <span className="text-lg leading-none text-pink-500">♀</span>
            إناث {totals.female.toLocaleString("ar-EG")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>عرض</span>
          <div className="w-24">
            <Select
              value={rowsPer}
              onChange={setRowsPer}
              options={ROWS_OPTIONS.map((r) => ({ value: r, label: r }))}
            />
          </div>
        </div>
      </div>

      {/* No horizontal scroll: percentage columns (the same widths the students
          page uses for the shared ones) and wrapping free-text cells. */}
      <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Bigger type than a dense grid would normally take, so the widths
            below are generous and the frame scrolls sideways on a narrow screen
            rather than squeezing a value out of sight. */}
        <table className="w-full min-w-[1120px] table-fixed text-right text-sm">
          <colgroup>
            <col className="w-[3.5%]" />
            <col className="w-[13%]" />
            {/* Phones are always 11 digits - pinned, not shared. */}
            <col className="w-[112px]" />
            <col className="w-[112px]" />
            <col className="w-[5%]" />
            <col className="w-[7%]" />
            <col className="w-[6%]" />
            <col className="w-[7%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
            <col className="w-[7.5%]" />
            {canSend && <col className="w-[7%]" />}
            {canSend && <col className="w-[7%]" />}
            <col className="w-[5%]" />
          </colgroup>
          <thead className={`${THEAD} text-xs font-medium`}>
            <tr>
              <th className="px-2 py-2.5">#</th>
              <th className="px-2 py-2.5">الاسم</th>
              <th className="px-2 py-2.5">رقم الطالب</th>
              <th className="px-2 py-2.5">رقم ولي الأمر</th>
              <th className="px-2 py-2.5">النوع</th>
              <th className="px-2 py-2.5">المنطقة السكنية</th>
              <th className="px-2 py-2.5">السعر</th>
              <th className="px-2 py-2.5">الواجب</th>
              <th className="px-2 py-2.5">المجموعة الأصلية</th>
              <th className="px-2 py-2.5">وقت الحضور</th>
              <th className="px-2 py-2.5">
                {!hasExam ? "الاختبار" : `الاختبار${examMax != null ? ` (من ${examMax})` : ""}`}
              </th>
              {canSend && <th className="px-2 py-2.5">رسالة الحضور</th>}
              {canSend && <th className="px-2 py-2.5">رسالة الدرجة</th>}
              <th className="px-2 py-2.5 text-center">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map((r, i) => (
              <tr key={r.id} className="h-14 transition hover:bg-slate-50/60">
                <td className="px-2 font-medium text-slate-400">{r.serial}</td>
                <td className="px-2 font-medium leading-snug break-words text-slate-800">{r.name}</td>
                <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                  {r.student_phones.length ? (
                    r.student_phones.map((p) => <span key={p} className="block truncate">{p}</span>)
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                  {r.parent_phones.length ? (
                    r.parent_phones.map((p) => <span key={p} className="block truncate">{p}</span>)
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-2 text-slate-600">{r.gender || <Dash />}</td>
                <td className="px-2 leading-snug break-words text-slate-600">{r.city || <Dash />}</td>
                <td className="px-2 text-slate-600">
                  {r.lesson_price != null ? <Money value={r.lesson_price} /> : <Dash />}
                </td>
                <td className="px-2 leading-snug text-slate-700">
                  {homeworkLabel(r.homework_flag) || <Dash />}
                </td>
                <td className="px-2 leading-snug break-words">
                  {isOther(r) ? (
                    <span className="font-medium text-rose-700">{label(r.assigned_group_id)}</span>
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-2 text-slate-600" dir="ltr">
                  {r.attended_at ? fmtDateTime(r.attended_at) : <Dash />}
                </td>
                <td className="px-2">
                  {/* The lesson says it has no exam, so the cell states that
                      instead of offering a box for a mark that cannot exist. */}
                  {!hasExam ? (
                    <span className="text-xs text-slate-400">بدون اختبار</span>
                  ) : (
                    <ExamCell
                      reg={r}
                      lectureId={lectureId ?? ""}
                      max={examMax}
                      onSaved={(u) => patchExam(r.id, u)}
                      inputRef={(el) => {
                        examRefs.current[i] = el;
                      }}
                      onMove={(step) => focusExam(i + step)}
                    />
                  )}
                </td>
                {/* These two carry a status word, not data - kept one step
                    smaller so "تم الإرسال" stays on one line. */}
                {canSend && (
                  <td className="px-2 text-xs">
                    <SentMark sent={msg ? msg.attendance.has(r.student_id) : null} />
                  </td>
                )}
                {canSend && (
                  <td className="px-2 text-xs">
                    {/* A grade that was never entered cannot have been sent. */}
                    {r.exam_score == null ? (
                      <Dash />
                    ) : (
                      <SentMark sent={msg ? msg.exam.has(r.student_id) : null} />
                    )}
                  </td>
                )}
                <td className="px-2 text-center">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(r)}
                    title="حذف الطالب من الحضور"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 transition hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={12 + (canSend ? 2 : 0)} className="px-4 py-12 text-center text-slate-400">
                  {rows.length === 0 ? "لا يوجد طلاب في هذه المجموعة" : "لا توجد نتائج مطابقة"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination current={current} totalPages={totalPages} onChange={setPage} />

      {absentees && lectureId && groupId && (
        <AbsenteesModal
          lectureId={lectureId}
          groupId={groupId}
          groupName={thisGroupLabel}
          initial={absentees}
          canSend={canSend && online}
          onClose={() => setAbsentees(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="حذف من الحضور"
          message={`سيتم حذف "${confirmDelete.name}" من حضور هذه الحصة نهائيًا، كأنه لم يحضرها. هل تريد المتابعة؟`}
          confirmLabel="حذف"
          danger
          onConfirm={() => removeAttendance(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/** Sent / not yet / unknown, in one cell. */
function SentMark({ sent }: { sent: boolean | null }) {
  if (sent == null) {
    return (
      <span className="text-slate-300" title="غير معروف بدون اتصال">
        -
      </span>
    );
  }
  return sent ? (
    <span className="inline-flex items-center gap-1 font-medium text-green-700">
      <Check className="h-3.5 w-3.5 shrink-0" />
      {SENT}
    </span>
  ) : (
    <span className="text-slate-400">{NOT_SENT}</span>
  );
}

const SEND_TONES = {
  accent: {
    idle: "border-accent/40 bg-white text-accent hover:bg-accent/10",
    armed: "border-accent bg-accent text-white hover:bg-accent-hover",
  },
  amber: {
    idle: "border-amber-400 bg-white text-amber-700 hover:bg-amber-50",
    armed: "border-amber-500 bg-amber-500 text-white hover:bg-amber-600",
  },
} as const;

/**
 * A send button with two states. Idle it says what it would send; armed it says
 * "إرسال (n)" and the table beside it is already showing those n students, so
 * the second press is a confirmation of something visible rather than a promise.
 */
function SendButton({
  tone,
  icon,
  label,
  armed,
  count,
  busy,
  disabled,
  title,
  onClick,
  onCancel,
}: {
  tone: keyof typeof SEND_TONES;
  icon: React.ReactNode;
  label: string;
  armed: boolean;
  count: number;
  busy: boolean;
  disabled: boolean;
  title?: string;
  onClick: () => void;
  onCancel: () => void;
}) {
  const t = SEND_TONES[tone];
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium shadow-sm transition disabled:opacity-50 ${
          armed ? `${t.armed} rounded-e-none` : t.idle
        }`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {armed ? `إرسال (${count.toLocaleString("ar-EG")})` : label}
      </button>
      {armed && (
        <button
          type="button"
          onClick={onCancel}
          title="إلغاء"
          aria-label="إلغاء الإرسال"
          className={`flex h-11 items-center rounded-xl rounded-s-none border border-s-0 px-2 shadow-sm transition ${t.armed}`}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * The group's absentees for this lesson - the students who sat it with NO group,
 * not merely with this one. They have no row on the roster (that is what being
 * absent means), so this is where they are listed and where their message is
 * sent from.
 */
function AbsenteesModal({
  lectureId,
  groupId,
  groupName,
  initial,
  canSend,
  onClose,
}: {
  lectureId: string;
  groupId: string;
  groupName: string;
  /** Already loaded by the caller, which is what decided this was worth opening. */
  initial: Absentee[];
  canSend: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Absentee[] | null>(initial);
  const [busy, setBusy] = useState(false);

  // Only a KNOWN "not sent" is a target: offline the flag is null, and sending
  // then would risk a second copy of a message the parent already has.
  const pending = (rows ?? []).filter((r) => r.sent === false).length;

  async function send() {
    setBusy(true);
    try {
      const res = await api.post<{ sent: number; failed: number; total: number }>(
        `/messaging/whatsapp/lectures/${lectureId}/groups/${groupId}/absence`,
      );
      const failed = res.failed > 0 ? `، فشل ${res.failed.toLocaleString("ar-EG")}` : "";
      toast.success(`تم إرسال ${res.sent.toLocaleString("ar-EG")} رسالة${failed}`, {
        title: "تم الإرسال",
      });
      // Stay open with the list refreshed: it is now the receipt for what just
      // went out, one line per parent. A failed refresh keeps the old list
      // rather than blanking a dialog whose send actually succeeded.
      const fresh = await api
        .get<Absentee[]>(`/messaging/whatsapp/lectures/${lectureId}/groups/${groupId}/absentees`)
        .catch(() => null);
      if (fresh) setRows(fresh);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر الإرسال");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={`غائبو ${groupName}`}
      subtitle={rows ? `${rows.length.toLocaleString("ar-EG")} طالب لم يحضر هذه الحصة` : undefined}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={send}
          disabled={!canSend || busy || pending === 0}
          title={canSend ? undefined : "لا يوجد اتصال بالإنترنت"}
          className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          إرسال رسائل الغياب ({pending.toLocaleString("ar-EG")})
        </button>
      }
    >
      {rows === null ? (
        <LoaderBlock />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400">
          لا يوجد غائبون - حضر كل طلاب المجموعة
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-right text-sm">
            <thead className={`${THEAD} text-xs font-medium`}>
              <tr>
                <th className="px-3 py-2.5 w-14">#</th>
                <th className="px-3 py-2.5">الاسم</th>
                <th className="px-3 py-2.5 w-32">رقم ولي الأمر</th>
                <th className="px-3 py-2.5 w-28">رسالة الغياب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.student_id} className="h-11">
                  <td className="px-3 font-medium text-slate-400">{r.serial ?? "-"}</td>
                  <td className="px-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-3 tabular-nums text-slate-600" dir="ltr">
                    {r.parent_phones.length ? r.parent_phones[0] : <Dash />}
                  </td>
                  <td className="px-3 text-xs">
                    <SentMark sent={r.sent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/**
 * The one editable cell in the table. Enter and the up/down arrows walk the
 * column so a whole group's grades can be typed without touching the mouse:
 * moving focus fires the blur that saves the value being left behind.
 */
function ExamCell({
  reg,
  lectureId,
  max,
  onSaved,
  inputRef,
  onMove,
}: {
  reg: Reg;
  /** From the route: the offline queue needs it, the row itself does not carry it. */
  lectureId: string;
  max: number | null;
  onSaved: (updated: Reg) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  onMove: (step: number) => void;
}) {
  const sync = useSync();
  const online = useOnline();
  const [value, setValue] = useState(reg.exam_score != null ? String(reg.exam_score) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const raw = value.trim();
    const next = raw === "" ? null : Number(raw);
    const current = reg.exam_score;
    if (next === current) return;
    if (next != null && (isNaN(next) || next < 0)) {
      setValue(current != null ? String(current) : "");
      return toast.error("الدرجة لا يمكن أن تكون أقل من صفر");
    }
    if (next != null && max != null && next > max) {
      setValue(current != null ? String(current) : "");
      return toast.error(`الدرجة لا يمكن أن تتجاوز ${max}`);
    }
    // Offline the grade is written to the mirror and queued; the server applies
    // it, and re-checks it against the lesson's maximum, when the line is back.
    // Writing (next), correcting (next != current) and clearing (next === null)
    // are the same queued upsert - a cleared mark travels as an explicit null,
    // so the server clears it too rather than keeping the old number.
    const queueIt = async () => {
      const row = await sync.queueRegistrationUpdate(
        reg.id,
        { exam_score: next },
        {
          lecture_id: lectureId,
          student_id: reg.student_id,
          group_id: reg.registered_group_id,
          status: "present",
          homework_flag: reg.homework_flag,
          attended_at: reg.attended_at,
          student_name: reg.name,
          student_serial: reg.serial,
        },
      );
      if (!row) return false;
      onSaved(row as unknown as Reg);
      toast.success(
        next == null ? "تم مسح الدرجة - بانتظار المزامنة" : "تم حفظ الدرجة - بانتظار المزامنة",
      );
      return true;
    };
    setSaving(true);
    try {
      if (!online && sync.ready && (await queueIt())) return;
      const updated = await api.patch<Reg>(`/registrations/${reg.id}/exam`, { exam_score: next });
      onSaved(updated);
      toast.success(next == null ? "تم مسح الدرجة" : "تم حفظ الدرجة");
    } catch (err) {
      if (isOfflineError(err) && sync.ready && (await queueIt())) return;
      setValue(current != null ? String(current) : "");
      toast.error(err instanceof ApiError ? err.message : "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={max ?? undefined}
        step="0.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          // The arrows would otherwise nudge the number itself.
          if (e.key === "Enter" || e.key === "ArrowDown") {
            e.preventDefault();
            onMove(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onMove(-1);
          }
        }}
        placeholder="-"
        className="w-full rounded-lg border border-slate-300 px-1 py-1.5 text-center text-slate-800 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
    </div>
  );
}
