import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Search,
  Loader2,
  Ban,
  AlertTriangle,
  Users,
  UserPlus,
  ArrowRightLeft,
  ClipboardCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Copy,
  Check,
  Camera,
  Percent,
} from "@/components/icons";
import { THEAD } from "@/components/tableStyles";
import { api, ApiError, isOfflineError, qs, type Page } from "@/lib/api";
import { useSync } from "@/sync/SyncProvider";
import { useOnline } from "@/lib/useOnline";
import { useBarcodeScanner } from "@/lib/useBarcodeScanner";
import { CameraScanner, cameraScanSupported } from "@/components/CameraScanner";
import { searchMode } from "@/lib/studentSearch";
import { homeworkLabel } from "@/lib/homework";
import {
  Select,
  Modal,
  Field,
  ConfirmDialog,
  inputClass,
} from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { useToast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { WhatsappLogo } from "@/components/WhatsappLogo";
import { useAuth } from "@/auth/AuthContext";
import { useCachedGet, invalidate } from "@/lib/dataCache";
import { useDebounced } from "@/lib/useDebounced";
import { usePageState } from "@/lib/pageState";
import {
  StudentForm,
  type Student,
  type StudentOptions,
  type Grade,
  type Group,
  groupLabel,
} from "@/modules/students/StudentForm";

interface Lecture { id: string; name: string; grade: string | null }
// Registrations arrive enriched with the student fields the panels render, so
// the page never loads the full (paginated) student list.
interface Registration {
  id: string; student_id: string; serial: number; name: string; grade: string | null;
  gender: string | null; school: string | null; city: string | null; religion: string | null;
  academic_track: string | null; lesson_price: number | null; student_phones: string[];
  is_active: boolean;
  assigned_group_id: string | null; registered_group_id: string | null;
  status: string; exam_score: number | null; homework_flag: string | null; total_lessons: number;
}
interface HistoryItem {
  id: string;
  lecture_name: string;
  status: string;
  exam_score: number | null;
  /** The lesson's maximum mark, free text ("50", "من 50"). */
  exam_grade: string | null;
  /** False = the lesson had no exam, so a missing score is not a miss. */
  has_exam: boolean;
  /** Null when the homework had no issue - the card then says nothing about it. */
  homework_flag: string | null;
}

const STATUS_AR: Record<string, string> = { present: "حاضر", absent: "غائب", removed: "مطرود" };
// The value is what the database stores; the label drops the "واجب" the field
// itself already says.
const HW_OPTIONS = ["واجب ناقص", "واجب غير معمول", "واجب منقول"].map((value) => ({
  value,
  label: homeworkLabel(value),
}));
const K = (s: string) => `lessonReg.${s}`;

/**
 * The search box takes Arabic letters and English digits only - nothing else can
 * be typed into it, so the three modes below always hold.
 */
const ALLOWED = /[^ؠ-ي٠-٩\s0-9]/g;
const sanitizeSearch = (raw: string) =>
  // Arabic-Indic digits are folded to ASCII rather than dropped, so a numeric
  // keypad set to Arabic still searches.
  raw.replace(ALLOWED, "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/**
 * Leading 0 = phone, any other digit = student code, letters = name - the same
 * rule the students page and the server apply, imported rather than restated so
 * the three can never drift.
 */
const searchParam = (term: string) => {
  const mode = searchMode(term);
  return mode === "phone" ? { phone: term } : mode === "code" ? { serial: term } : { name: term };
};

export default function LessonRegistrationPage() {
  const toast = useToast();
  const { can } = useAuth();
  const sync = useSync();
  const online = useOnline();

  const gradesQ = useCachedGet<Grade[]>("/grades");
  const groupsQ = useCachedGet<Group[]>("/groups");
  // The full student form (opened by the edit button) needs the school/city
  // suggestions and next serial. Not part of `loading` - the page shows without
  // it, and it is only read once the edit modal opens.
  const optionsQ = useCachedGet<StudentOptions>("/students/options");
  const grades = gradesQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const options = optionsQ.data ?? null;
  const loading = gradesQ.loading || groupsQ.loading;

  const [grade, setGrade] = usePageState(K("grade"), "");
  const [groupId, setGroupId] = usePageState(K("groupId"), "");
  const [lectureId, setLectureId] = usePageState(K("lectureId"), "");
  // Student search + selection are NOT persisted - the info panel starts empty
  // on every visit and only fills after the user searches.
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);
  const [detail, setDetail] = useState<null | "new" | "other">(null);
  const [hwFlag, setHwFlag] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Only where the browser can actually decode a frame - see CameraScanner.
  const [canScanWithCamera] = useState(cameraScanSupported);
  // Which suggestion the arrow keys are sitting on.
  const [highlight, setHighlight] = useState(0);
  const matchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Editing the selected student opens the SAME full student form used
  // everywhere else, so the rules and the save-only validation are identical.
  const [editOpen, setEditOpen] = useState(false);
  // Bumped after an edit so the lesson's attendee rows reload with the new data.
  const [regReloadKey, setRegReloadKey] = useState(0);
  const [confirmUnregister, setConfirmUnregister] = useState(false);
  // Set when the picked student already attended this lesson in another group,
  // and the user has to confirm a repeat attendance before it is added here.
  const [confirmRepeat, setConfirmRepeat] = useState(false);
  // Set when auto-send is on but the parent's number is not on WhatsApp (or the
  // student has none): the user is warned before the attendance is committed.
  const [waWarn, setWaWarn] = useState<{ status: string; detail: string | null } | null>(null);

  const [gradeLectures, setGradeLectures] = useState<Lecture[]>([]);
  const [matches, setMatches] = useState<Student[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [registering, setRegistering] = useState(false);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  // Per (group, lecture): send the attendance WhatsApp message automatically the
  // moment a student here is marked present. Off by default; teachers can also send
  // the messages later from the Lessons page.
  const canSend = can("NOTIFICATION_SEND");
  const [autoAttendance, setAutoAttendance] = useState(false);

  useEffect(() => {
    if (!(groupId && lectureId && canSend)) {
      setAutoAttendance(false);
      return;
    }
    let alive = true;
    api
      .get<{ enabled: boolean }>(`/messaging/whatsapp/lectures/${lectureId}/groups/${groupId}/attendance-optin`)
      .then((r) => {
        if (alive) setAutoAttendance(r.enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [groupId, lectureId, canSend]);

  async function toggleAutoAttendance(next: boolean) {
    setAutoAttendance(next); // optimistic
    try {
      await api.put(`/messaging/whatsapp/lectures/${lectureId}/groups/${groupId}/attendance-optin`, {
        enabled: next,
      });
    } catch (err) {
      setAutoAttendance(!next);
      toast(err instanceof ApiError ? err.message : "تعذّر حفظ الإعداد", "error");
    }
  }

  const selectedId = selected?.id ?? null;
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const label = (id: string | null | undefined) => {
    const g = id ? groupById.get(id) : undefined;
    return g ? groupLabel(g) : "-";
  };

  const gradeGroups = groups.filter((g) => g.grade === grade && g.is_active);
  const lessonReady = !!(grade && groupId && lectureId);
  // The selected student's registration IN THIS group's session: the primary
  // button then only saves homework (becomes حفظ) and the delete button removes
  // this attendance.
  const sameGroupReg = selectedId
    ? registrations.find((r) => r.student_id === selectedId && r.registered_group_id === groupId) ?? null
    : null;
  // The student already attended this lesson, but under a DIFFERENT group. Adding
  // them here is a repeat/makeup attendance, allowed only after confirmation.
  const otherGroupReg =
    selectedId && !sameGroupReg
      ? registrations.find((r) => r.student_id === selectedId && r.registered_group_id !== groupId) ?? null
      : null;

  // The "previous lessons" strip shows only lessons created BEFORE the one being
  // registered - lessons that come after it are not part of the student's past.
  // history is oldest-first by lesson creation date, so take everything up to the
  // current lesson's position.
  const previousHistory = useMemo(() => {
    const idx = history.findIndex((h) => h.id === lectureId);
    return idx === -1 ? history.filter((h) => h.id !== lectureId) : history.slice(0, idx);
  }, [history, lectureId]);

  // Lessons of the chosen grade feed the lesson dropdown. A grade has few
  // lessons, so fetch them whole rather than page.
  useEffect(() => {
    if (!grade) {
      setGradeLectures([]);
      return;
    }
    api
      .get<Page<Lecture>>(`/lectures${qs({ grade, size: 2000, sort: "createdAt,desc" })}`)
      .then((p) => setGradeLectures(p.content))
      .catch(() => {});
  }, [grade]);

  useEffect(() => {
    if (!lectureId) {
      setRegistrations([]);
      return;
    }
    // A single lesson's attendees are a bounded set - fetch whole, compute the
    // live stats client-side.
    api
      .get<Page<Registration>>(`/registrations${qs({ lectureId, size: 2000 })}`)
      .then((p) => setRegistrations(p.content))
      .catch(() => {});
  }, [lectureId, regReloadKey]);

  useEffect(() => {
    if (!selectedId) {
      setHistory([]);
      return;
    }
    api.get<HistoryItem[]>(`/registrations/history/${selectedId}`).then(setHistory).catch(() => {});
  }, [selectedId]);

  // One-time preselect from a dashboard "today's lesson" click, carried in the
  // navigation state. A clicked session gives a grade + group (not a specific
  // lesson), so we seed those two and, when the grade turns out to hold a single
  // lesson, pick it too - otherwise the user still chooses the الحصة.
  const location = useLocation();
  const seededRef = useRef(false);
  const pickLectureRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const p = location.state as { grade?: string; groupId?: string; lectureId?: string } | null;
    if (!p || (!p.grade && !p.groupId)) return;
    if (p.grade) setGrade(p.grade);
    if (p.groupId) setGroupId(p.groupId);
    if (p.lectureId) setLectureId(p.lectureId);
    else if (p.grade) pickLectureRef.current = true;
    // Drop the one-shot state so a re-render or back-nav does not re-seed it.
    window.history.replaceState({}, document.title);
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Completes the preselect: once the grade's lessons load, auto-pick the only
  // one if there is exactly one.
  useEffect(() => {
    if (!pickLectureRef.current || gradeLectures.length === 0) return;
    if (gradeLectures.length === 1) setLectureId(gradeLectures[0].id);
    pickLectureRef.current = false;
  }, [gradeLectures, setLectureId]);

  // The homework state is sticky: whatever is picked keeps applying to every
  // student registered after it, until the dropdown is changed. Only a student
  // who ALREADY has a registration overrides it, with their own saved value.
  useEffect(() => {
    // Only a registration in THIS group's session overrides the sticky homework
    // value; attending fresh (or as a repeat from another group) keeps it.
    const reg = selectedId
      ? registrations.find((r) => r.student_id === selectedId && r.registered_group_id === groupId)
      : null;
    if (reg) setHwFlag(reg.homework_flag ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);


  function onGradeChange(v: string) {
    setGrade(v);
    setGroupId("");
    setLectureId("");
    clearStudent();
  }
  // Everything about the student goes, but NOT the homework state - it is meant
  // to carry over to the next student registered.
  function clearStudent() {
    setSelected(null);
    setHistory([]);
    setSearch("");
    setMatches([]);
  }

  // ── Smart student search (only students of the lesson's grade), server-side ──
  const q = search.trim();
  const debouncedQ = useDebounced(q);

  const studentQuery = (term: string) =>
    `/students${qs({
      grade,
      ...searchParam(term),
      size: 8,
      sort: "serial,asc",
    })}`;

  useEffect(() => {
    // Only search while the dropdown is open, so re-filling the box after a pick
    // doesn't fire a needless request.
    if (!debouncedQ || !grade || !searchOpen) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    api
      .get<Page<Student>>(studentQuery(debouncedQ))
      .then((p) => !cancelled && setMatches(p.content))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, grade, searchOpen]);

  // A fresh result set starts at the top; the highlighted row stays in view.
  useEffect(() => setHighlight(0), [matches]);
  useEffect(() => {
    matchRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function pickStudent(s: Student) {
    setSelected(s);
    setSearch(s.name);
    setSearchOpen(false);
  }

  /**
   * Resolves a search term (name, phone, or code) to a single student of the
   * lesson's grade and selects them. Shared by the Enter key and the barcode
   * scanner - a scan is just the student's code arriving as text.
   */
  async function resolveAndSelect(term: string) {
    const t = term.trim();
    if (!t || !grade) return;
    // A code must match exactly; a name or a phone takes the best hit.
    const exactCode = searchMode(t) === "code";
    // Resolve against the freshest results, so we never trust whatever the
    // debounced dropdown last showed.
    const found = await api
      .get<Page<Student>>(studentQuery(t))
      .then((p) =>
        exactCode ? p.content.find((s) => String(s.serial) === t) ?? null : p.content[0] ?? null
      )
      .catch(() => null);
    if (!found) return toast("لا يوجد طالب مطابق في هذا الصف", "error");
    pickStudent(found);
  }

  function selectFromSearch() {
    return resolveAndSelect(q);
  }

  // A hardware barcode scanner types the student's code + Enter. When focus is
  // in the search box the box resolves it; this covers the case where focus has
  // drifted. Off while a modal is open so a scan can't select behind it.
  useBarcodeScanner(
    (code) => {
      setSearch(code);
      setSearchOpen(false);
      resolveAndSelect(code);
    },
    lessonReady && !editOpen,
  );

  /**
   * The phone's own camera, for a desk that does not have a scanner attached.
   * The decoded code takes exactly the same path a scanned one does.
   */
  function onCameraScan(code: string) {
    const digits = code.replace(/\D/g, "") || code;
    setSearch(digits);
    setSearchOpen(false);
    void resolveAndSelect(digits);
  }

  /** After the full student form saves, refresh the panel and the attendee rows. */
  function onStudentSaved(saved: Student) {
    setSelected(saved);
    setEditOpen(false);
    invalidate("/students");
    // Keep the lesson's attendee rows (name / price / ...) in step with the edit.
    setRegReloadKey((k) => k + 1);
  }

  /** Wipes the student's attendance in THIS group's session - as if never registered. */
  async function unregisterSelected() {
    if (!sameGroupReg) return;
    const regId = sameGroupReg.id;
    const done = (queued: boolean) => {
      setRegistrations((prev) => prev.filter((r) => r.id !== regId));
      invalidate("/groups");
      // The panel empties out - the student is no longer part of this lesson.
      clearStudent();
      toast(queued ? "تم حذف الطالب من الحصة - بانتظار المزامنة" : "تم حذف الطالب من هذه الحصة");
    };
    setRegistering(true);
    try {
      if (!online && sync.ready) {
        await sync.queueRegistrationDelete(regId);
        done(true);
        return;
      }
      await api.del(`/registrations/${regId}`);
      done(false);
    } catch (err) {
      if (isOfflineError(err) && sync.ready) {
        await sync.queueRegistrationDelete(regId);
        done(true);
        return;
      }
      toast(err instanceof ApiError ? err.message : "تعذّر الحذف", "error");
    } finally {
      setRegistering(false);
      setConfirmUnregister(false);
    }
  }

  async function registerSelected() {
    if (!selected || registering || !lessonReady) return;
    // Auto-send on: the attendance message must reach the parent, so verify the
    // number is on WhatsApp BEFORE committing. Not on WhatsApp / no number ->
    // warn and let the user decide; could-not-verify (offline / API down) ->
    // attend anyway and say why, so a service outage never blocks attendance.
    // Offline the parent-WhatsApp check cannot run (and nothing is sent anyway),
    // so skip it and let the attendance queue straight away.
    if (autoAttendance && canSend && online) {
      setRegistering(true);
      let status = "UNKNOWN";
      let detail: string | null = null;
      try {
        const res = await api.get<{ status: string; detail: string | null }>(
          `/messaging/whatsapp/students/${selected.id}/parent-whatsapp`
        );
        status = res.status;
        detail = res.detail;
      } catch (err) {
        status = "UNKNOWN";
        detail = err instanceof ApiError ? err.message : "تعذّر الاتصال للتحقق من واتساب";
      } finally {
        setRegistering(false);
      }
      if (status === "OFF" || status === "NO_PHONE") {
        setWaWarn({ status, detail });
        return;
      }
      if (status === "UNKNOWN") {
        toast(detail ?? "تعذّر التحقق من واتساب", "error");
      }
    }
    await doRegister();
  }

  /** Commits the attendance. Split out so the WhatsApp warning dialog can resume
   *  it after the user chooses to attend without sending. */
  async function doRegister() {
    if (!selected) return;
    const student = selected;
    const payload = {
      lecture_id: lectureId,
      student_id: student.id,
      group_id: groupId,
      status: "present",
      homework_flag: hwFlag || null,
    };
    /** Shows the queued attendance and clears the picker, as a live one would. */
    const queued = async () => {
      const reg = (await sync.queueRegistration(payload, student)) as unknown as Registration;
      setRegistrations((prev) => [reg, ...prev]);
      toast(`تم تسجيل "${student.name}" - بانتظار المزامنة عند عودة الاتصال`);
      clearStudent();
    };
    setRegistering(true);
    try {
      // Offline, queue without asking the server first - same order the delete and
      // homework writes use. The request would fail anyway, and a backend that can
      // still be reached while ITS database cannot answers 403 for every guarded
      // endpoint, which reads as a refusal and loses the attendance.
      if (!online && sync.ready) {
        await queued();
        return;
      }
      const reg = await api.post<Registration>("/registrations", payload);
      setRegistrations((prev) => [reg, ...prev]);
      invalidate("/groups");
      toast(`تم تسجيل "${student.name}"`);
      clearStudent();
    } catch (err) {
      // A transport failure means the request never reached the server. Queue the
      // attendance durably and show it at once - it replays (and sends the parent
      // WhatsApp) the moment the connection returns. A real server error (blocked
      // student, duplicate, ...) is surfaced as before.
      if (isOfflineError(err) && sync.ready) {
        try {
          await queued();
        } catch {
          toast("تعذّر حفظ التسجيل دون اتصال", "error");
        }
      } else {
        toast(err instanceof ApiError ? err.message : "تعذّر التسجيل", "error");
      }
    } finally {
      setRegistering(false);
    }
  }

  /** Save only the homework flag on the student's THIS-group registration. */
  async function saveHomework() {
    if (!sameGroupReg) return;
    const regId = sameGroupReg.id;
    const apply = (upd: Registration, queued: boolean) => {
      setRegistrations((prev) => prev.map((r) => (r.id === upd.id ? upd : r)));
      toast(queued ? "تم حفظ حالة الواجب - بانتظار المزامنة" : "تم حفظ حالة الواجب");
      clearStudent();
    };
    // Offline the change is written to the mirror and queued as a whole-row
    // registration upsert - the only shape sync speaks - which the server lands
    // on the same row by its natural key.
    const queueIt = async () => {
      const row = await sync.queueRegistrationUpdate(regId, { homework_flag: hwFlag || null });
      if (!row) return false;
      apply(row as unknown as Registration, true);
      return true;
    };
    setRegistering(true);
    try {
      if (!online && sync.ready) {
        if (await queueIt()) return;
      }
      const upd = await api.patch<Registration>(`/registrations/${regId}/homework`, {
        homework_flag: hwFlag || null,
      });
      apply(upd, false);
    } catch (err) {
      if (isOfflineError(err) && sync.ready && (await queueIt())) return;
      toast(err instanceof ApiError ? err.message : "تعذّر الحفظ", "error");
    } finally {
      setRegistering(false);
    }
  }

  // Primary action: save homework if already in this session; otherwise register.
  // A student who attended in another group needs a confirmation before the
  // repeat attendance is added here.
  function onPrimary() {
    if (!selected || registering) return;
    if (sameGroupReg) return void saveHomework();
    if (otherGroupReg) return setConfirmRepeat(true);
    return void registerSelected();
  }

  const listOpen = searchOpen && matches.length > 0;

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") return setSearchOpen(false);

    // Arrows walk the suggestions; Enter takes whichever one is highlighted.
    if (listOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      return setHighlight((h) => Math.min(matches.length - 1, Math.max(0, h + step)));
    }

    if (e.key !== "Enter") return;
    e.preventDefault();
    if (listOpen && matches[highlight]) return pickStudent(matches[highlight]);
    if (selected && !searchOpen) onPrimary();
    else selectFromSearch();
  }

  const stats = useMemo(() => {
    // One lesson can be taught to several groups, but each box is about THIS
    // group's session - so scope every metric to attendees registered in the
    // selected group, not the whole lesson.
    const scoped = registrations.filter((r) => r.registered_group_id === groupId);
    const male = scoped.filter((r) => r.gender === "ذكر");
    const female = scoped.filter((r) => r.gender === "أنثى");
    const news = scoped.filter((r) => r.total_lessons === 1);
    const other = scoped.filter(
      (r) => r.assigned_group_id && r.registered_group_id && r.assigned_group_id !== r.registered_group_id
    );
    return { total: scoped.length, male, female, news, other };
  }, [registrations, groupId]);

  const differentGroup = !!(selected && selected.group_id && selected.group_id !== groupId);

  if (loading) return <LoaderBlock />;

  return (
    <div>
      {/* ── Lesson information ── The system floating-label field, same as the
          student form, so every control on the page is one size. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="الصف">
          <Select
            value={grade}
            onChange={onGradeChange}
            placeholder="اختر الصف"
            options={grades.map((g) => ({ value: g.name, label: g.name }))}
          />
        </Field>
        <Field label="المجموعة">
          <Select
            value={groupId}
            onChange={(v) => {
              setGroupId(v);
              clearStudent();
            }}
            disabled={!grade}
            placeholder="اختر المجموعة"
            options={gradeGroups.map((g) => ({ value: g.id, label: groupLabel(g) }))}
          />
        </Field>
        <Field label="الحصة">
          <Select
            value={lectureId}
            onChange={(v) => {
              setLectureId(v);
              clearStudent();
            }}
            disabled={!grade}
            placeholder="اختر الحصة"
            emptyLabel="لا يوجد حصص متاحة لهذا الصف"
            options={gradeLectures.map((l) => ({ value: l.id, label: l.name }))}
          />
        </Field>
      </div>

      {/* ── Student search ── */}
      {!lessonReady ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400">
          اختر الصف والمجموعة والحصة لبدء التسجيل
        </div>
      ) : (
        <>
          {/* Bare search field, with the per (group + lesson) WhatsApp auto-send
              switch sitting beside it: the green logo says what the toggle does,
              so it needs no label. On = the attendance message goes to each
              parent the moment the student is marked present. */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="relative w-full min-w-[200px] flex-1 sm:w-auto">
              <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(sanitizeSearch(e.target.value));
                  setSearchOpen(true);
                  if (selectedId) setSelected(null);
                }}
                // A student is already picked: focusing the box (an accidental
                // click) must not reopen the list showing that same student.
                // Typing clears the selection and searches fresh.
                onFocus={() => { if (!selectedId) setSearchOpen(true); }}
                onKeyDown={onSearchKeyDown}
                autoFocus
                inputMode="text"
                placeholder="ابحث باسم الطالب أو الكود أو الرقم أو مسح الباركود"
                // inputClass with room on the right for the magnifier.
                className={`${inputClass} pr-11`}
              />
              {searchOpen && matches.length > 0 && (
                <div className="absolute z-40 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-fade-in">
                  {matches.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      ref={(el) => {
                        matchRefs.current[i] = el;
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pickStudent(s)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-right text-sm text-slate-700 transition ${
                        i === highlight ? "bg-accent/10" : "hover:bg-slate-100"
                      }`}
                    >
                      <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-xs font-bold text-accent">
                        {s.serial}
                      </span>
                      <span className="font-medium text-slate-800">{s.name}</span>
                      <span className="mr-auto text-xs text-slate-400">{label(s.group_id)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {canScanWithCamera && (
              <button
                type="button"
                onClick={() => setScanning(true)}
                title="مسح باركود الطالب بكاميرا الهاتف"
                aria-label="مسح باركود بالكاميرا"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50"
              >
                <Camera className="h-5 w-5" />
              </button>
            )}
            {canSend && (
              <label
                title={
                  online
                    ? "إرسال رسالة الحضور تلقائيًا إلى واتساب ولي الأمر فور تسجيل الحضور"
                    : "إرسال واتساب غير متاح دون اتصال بالإنترنت"
                }
                className="flex shrink-0 items-center gap-2"
              >
                <WhatsappLogo className="h-6 w-6" />
                {/* Sending needs the network, so the auto-send switch is locked
                    off-line - attendance itself still queues and syncs later. */}
                <Toggle
                  checked={autoAttendance && online}
                  onChange={toggleAutoAttendance}
                  disabled={!online}
                  title={online ? undefined : "لا يوجد اتصال بالإنترنت"}
                />
              </label>
            )}
          </div>

          {/* Key to the alert-flag colours a picked student can raise, kept by
              the search so the meaning is known before a flag appears. Each dot
              matches its flag's colour. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-700" />
              محظور
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-purple-500" />
              من مجموعة أخرى
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500" />
              حضر الحصة بالفعل
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500" />
              مُخفَّض / معفي
            </span>
          </div>

          <StudentPanel
            student={selected}
            groupLabelFor={label}
            differentGroup={differentGroup}
            registering={registering}
            isEdit={!!sameGroupReg}
            hwFlag={hwFlag}
            onHwChange={setHwFlag}
            onPrimary={onPrimary}
            history={previousHistory}
            alreadyAttendedGroup={otherGroupReg ? label(otherGroupReg.registered_group_id) : null}
            onEdit={() => setEditOpen(true)}
            onUnregister={sameGroupReg ? () => setConfirmUnregister(true) : undefined}
          />
        </>
      )}

      {/* ── Live statistics (each metric a box; two are clickable) ── */}
      {lessonReady && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatBox icon={<Users className="h-4 w-4" />} label="إجمالي المسجّلين" value={stats.total} />
          <StatBox label="ذكور" value={stats.male.length} />
          <StatBox label="إناث" value={stats.female.length} />
          <StatBox
            icon={<UserPlus className="h-4 w-4" />}
            label="طلاب جدد"
            value={stats.news.length}
            onClick={() => setDetail("new")}
          />
          <StatBox
            icon={<ArrowRightLeft className="h-4 w-4" />}
            label="من مجموعة أخرى"
            value={stats.other.length}
            onClick={() => setDetail("other")}
          />
        </div>
      )}

      {detail && (
        <StatDetailModal
          kind={detail}
          rows={detail === "new" ? stats.news : stats.other}
          groupLabelFor={label}
          onClose={() => setDetail(null)}
        />
      )}

      {confirmUnregister && selected && (
        <ConfirmDialog
          title="حذف الطالب من الحصة"
          message={`سيتم حذف تسجيل "${selected.name}" في هذه الحصة نهائياً، كأنه لم يُسجَّل بها.`}
          confirmLabel="حذف"
          danger
          onConfirm={unregisterSelected}
          onClose={() => setConfirmUnregister(false)}
        />
      )}

      {/* Repeat attendance: the student already sat this lesson with another
          group; adding them here is a second, deliberate attendance. */}
      {confirmRepeat && selected && otherGroupReg && (
        <ConfirmDialog
          title="تسجيل الطالب مرة أخرى"
          message={`"${selected.name}" حضر هذه الحصة بالفعل في مجموعة: ${label(
            otherGroupReg.registered_group_id
          )}. هل تريد إضافته لهذه المجموعة أيضاً؟`}
          confirmLabel="نعم، أضِفه"
          onConfirm={() => {
            setConfirmRepeat(false);
            registerSelected();
          }}
          onClose={() => setConfirmRepeat(false)}
        />
      )}

      {/* Auto-send is on but the attendance message cannot reach the parent -
          confirm attending without it, or cancel to fix the number first. */}
      {waWarn && selected && (
        <ConfirmDialog
          title={waWarn.status === "NO_PHONE" ? "لا يوجد رقم لولي الأمر" : "ولي الأمر ليس على واتساب"}
          message={
            waWarn.status === "NO_PHONE"
              ? `لا يوجد رقم مسجّل لولي أمر "${selected.name}"، لن تصله رسالة الحضور. هل تريد تحضيره بدون إرسال؟`
              : `رقم ولي أمر "${selected.name}" غير مسجّل على واتساب، لن تصله رسالة الحضور. هل تريد تحضيره بدون إرسال؟`
          }
          confirmLabel="تحضير بدون إرسال"
          onConfirm={() => {
            setWaWarn(null);
            void doRegister();
          }}
          onClose={() => setWaWarn(null)}
        />
      )}

      {/* The full student form - identical rules and save-only validation to
          the students page, so editing here behaves exactly the same. */}
      {editOpen && selected && options && (
        <StudentForm
          initial={selected}
          grades={grades}
          groups={groups}
          options={options}
          onClose={() => setEditOpen(false)}
          onSaved={(saved) => onStudentSaved(saved)}
        />
      )}

      {scanning && (
        <CameraScanner onScan={onCameraScan} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}

// ── Always-present student info panel, styled like the Student form ──
function StudentPanel({
  student,
  groupLabelFor,
  differentGroup,
  registering,
  isEdit,
  hwFlag,
  onHwChange,
  onPrimary,
  history,
  alreadyAttendedGroup,
  onEdit,
  onUnregister,
}: {
  student: Student | null;
  groupLabelFor: (id: string | null | undefined) => string;
  differentGroup: boolean;
  registering: boolean;
  isEdit: boolean;
  hwFlag: string;
  onHwChange: (v: string) => void;
  onPrimary: () => void;
  history: HistoryItem[];
  /** The group's label when the student already attended this lesson elsewhere. */
  alreadyAttendedGroup?: string | null;
  /** Opens the full student form - the SAME one used on the students page. */
  onEdit: () => void;
  /** Only set when the student is already registered in THIS group's session. */
  onUnregister?: () => void;
}) {

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Status flags for the picked student, sized to their own text and kept
            on the same row as the action buttons. Several sit side by side and
            wrap only when the row fills. The "from another group" flag carries
            just the origin group's name; the arrow icon says the rest. */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* Blocked: a heavy blood-red solid so it stops the eye. The flag only
              alerts - the actual reason is shown among the data fields below. */}
          {student && !student.is_active && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-red-800 bg-red-700 px-3 py-1.5 font-semibold text-white">
              <Ban className="h-4 w-4 shrink-0" />
              محظور
            </span>
          )}
          {student && differentGroup && (
            <span
              title="طالب من مجموعة أخرى - هذه مجموعته الأصلية"
              className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-purple-300 bg-purple-50 px-3 py-1.5 font-medium text-purple-700"
            >
              <ArrowRightLeft className="h-4 w-4 shrink-0" />
              {groupLabelFor(student.group_id)}
            </span>
          )}
          {/* Already attended this lesson in another group; adding here is a
              repeat, confirmed on the primary button. */}
          {student && alreadyAttendedGroup && (
            <span
              title="حضر هذه الحصة بالفعل - يمكن إضافته لهذه المجموعة بعد التأكيد"
              className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-blue-300 bg-blue-50 px-3 py-1.5 font-medium text-blue-700"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              حضر في: {alreadyAttendedGroup}
            </span>
          )}
          {/* Money flag: any student under the centre price - discounted or fully
              exempt - so a fee problem is visible at a glance. The reason itself
              is shown among the data, beside the price box. Orange. */}
          {student?.is_discounted && (
            <span
              title="سعر مخفّض عن سعر السنتر - السبب ضمن البيانات بجانب السعر"
              className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-orange-300 bg-orange-50 px-3 py-1.5 font-medium text-orange-700"
            >
              <Percent className="h-4 w-4 shrink-0" />
              {student.lesson_price === 0 ? "معفي" : "مُخفَّض"}
            </span>
          )}
        </div>

        {student && (
          // Wraps, and the homework picker takes the whole line on a phone. Held
          // on one row these four controls came to well over a phone's width, so
          // the row stretched the panel past the screen: "حفظ" ended up outside
          // the card and the page picked up a sideways scroll that carried every
          // other field out with it.
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="w-full sm:w-44">
              <Select value={hwFlag} onChange={onHwChange} placeholder="حالة الواجب" options={HW_OPTIONS} />
            </div>
            {/* Opens the full student form instead of an inline editor, so the
                rules and save-only validation match the students page exactly. */}
            <button
              onClick={onEdit}
              title="تعديل بيانات الطالب"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 text-slate-500 transition hover:border-accent hover:text-accent"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {/* Only a student already registered in this lesson can be removed. */}
            {onUnregister && (
              <button
                onClick={onUnregister}
                disabled={registering}
                title="حذف الطالب من هذه الحصة"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-300 text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onPrimary}
              // A blocked student cannot attend; the server refuses too, this
              // just says so before the click.
              disabled={registering || (!isEdit && !student.is_active)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-60 sm:flex-none"
            >
              {registering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                <Check className="h-4 w-4" />
              ) : (
                <ClipboardCheck className="h-4 w-4" />
              )}
              {isEdit ? "حفظ" : "تحضير"}
            </button>
          </div>
        )}
      </div>

      {/* Read-only view of the student's data. Editing goes through the full
          form (the pencil button); nothing is edited inline here anymore. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="col-span-2 sm:col-span-3 lg:col-span-5">
          <FieldLabel>الاسم بالكامل</FieldLabel>
          <div className="flex items-stretch gap-2">
            <div className="flex min-h-[42px] flex-1 items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
              <span className={student ? "" : "text-slate-400"}>{student?.name ?? "-"}</span>
            </div>
            {student && (
              <span className="flex shrink-0 items-center rounded-xl bg-rose-600 px-3 text-sm font-bold text-white">
                {student.serial}
              </span>
            )}
          </div>
        </div>

        <Info label="المدرسة" value={student?.school} />
        <Info label="المنطقة السكنية" value={student?.city} />
        <Info label="الصف" value={student?.grade} />
        <Info label="الشعبة" value={student?.academic_track} />
        <Info label="المجموعة" value={student ? groupLabelFor(student.group_id) : null} />
        <Info label="النوع" value={student?.gender} />
        <Info label="الديانة" value={student?.religion} />
        <PriceField student={student} />
        {/* The fee-problem reason sits right beside the price box, for any
            student under the centre price - discounted or fully exempt. */}
        {student?.is_discounted && student.discount_reason && (
          <Info
            label={student.lesson_price === 0 ? "سبب الإعفاء" : "سبب الخصم"}
            value={student.discount_reason}
          />
        )}
        <PhonesField label="هاتف الطالب" phones={student?.student_phones} />
        <PhonesField label="هاتف ولي الأمر" phones={student?.parent_phones} />
        <div>
          <FieldLabel>الحالة</FieldLabel>
          <ValueBox tone={student ? (student.is_active ? "green" : "red") : undefined}>
            {student ? (student.is_active ? "نشط" : "غير نشط") : <span className="text-slate-400">-</span>}
          </ValueBox>
        </div>
        {/* A blocked student shows why, among the data - not on the alert flag. */}
        {student && !student.is_active && student.block_reason && (
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <Info label="سبب الحظر" value={student.block_reason} />
          </div>
        )}
        <div className="col-span-2 sm:col-span-3 lg:col-span-5">
          <Info label="ملاحظات" value={student?.notes} />
        </div>
      </div>

      <HistoryStrip history={history} />
    </div>
  );
}

/** How many lesson cards fit one view - the step the arrows take. */
const HISTORY_PER_VIEW = 5;

/**
 * Every card is this size whether it carries a lesson or is an empty filler, so
 * nothing resizes while the strip slides past. Two per view on a phone, three
 * on a tablet, five on a desktop - the gaps between them come out of the width.
 */
const HISTORY_CARD =
  "h-[124px] w-[calc((100%-0.75rem)/2)] shrink-0 snap-start overflow-hidden sm:w-[calc((100%-1.5rem)/3)] lg:w-[calc((100%-3rem)/5)]";

/**
 * The student's earlier lessons in the order they were created, oldest first,
 * on a strip that scrolls sideways: the wheel or a drag moves it, the arrows
 * move it a viewful at a time, and it opens parked on the newest lesson - the
 * one being registered follows on from that, not from the first lesson of term.
 */
function HistoryStrip({ history }: { history: HistoryItem[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Which cards the strip is actually showing, watched rather than computed:
  // scrollLeft means three different things in an RTL box depending on the
  // browser, and an observer needs none of them.
  const [first, setFirst] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const root = trackRef.current;
    if (!root || history.length === 0) return;
    const shown = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.index);
          if (e.isIntersecting) shown.add(i);
          else shown.delete(i);
        }
        const list = [...shown].sort((a, b) => a - b);
        setFirst(list[0] ?? 0);
        setCount(list.length);
      },
      { root, threshold: 0.6 },
    );
    for (const el of cardRefs.current) {
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [history.length]);

  // Open on the newest lesson. A negative offset lands on the far end of the
  // strip under every RTL scroll model there is: the browsers that count from
  // zero at the right clamp it to their minimum, the ones that count the other
  // way clamp it to zero - both are the left edge, which is where the newest
  // lesson sits.
  useEffect(() => {
    // A shorter history leaves detached cards behind in the ref list, and the
    // arrows would then scroll to a node no longer on the page.
    cardRefs.current.length = history.length;
    const el = trackRef.current;
    if (el) el.scrollLeft = -el.scrollWidth;
  }, [history]);

  /**
   * Slides a viewful toward the older lessons ("back") or the newer ones. Both
   * land a card on the leading edge, which is where the snap points are, so the
   * strip glides to a stop instead of being pulled back into line.
   */
  function page(dir: "back" | "forward") {
    const target =
      dir === "back"
        ? Math.max(0, first - HISTORY_PER_VIEW)
        : Math.min(history.length - 1, first + count);
    cardRefs.current[target]?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }

  const blanks = Math.max(0, HISTORY_PER_VIEW - history.length);

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-700">سجل الحصص السابقة</div>
        {history.length > HISTORY_PER_VIEW && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {/* RTL: the right chevron walks back toward the older lessons. */}
            <button
              type="button"
              onClick={() => page("back")}
              disabled={first === 0}
              aria-label="السابق"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => page("forward")}
              disabled={first + count >= history.length}
              aria-label="التالي"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Key to the card colours below - swatches carry the same fill the cards
          use, so it reads as a direct sample. */}
      {history.length > 0 && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green-100 ring-1 ring-green-400" />
            حاضر
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-100 ring-1 ring-amber-400" />
            حاضر ولم يُختبر
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-rose-100 ring-1 ring-rose-400" />
            غائب
          </span>
        </div>
      )}

      {/* The scrollbar underneath is the second way to move: the wheel and a
          drag work on it as well as the arrows above. */}
      <div
        ref={trackRef}
        className="scrollbar-thin flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
      >
        {history.map((h, i) => {
          const present = h.status === "present";
          // A lesson with no exam is not an un-sat exam: attending it is the
          // whole of it, so it reads as a full attendance, not a half one.
          const sat = present && (!h.has_exam || h.exam_score != null);
          return (
            <div
              key={h.id}
              data-index={i}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              // Absent reads like a blocked row in the students table; attended
              // splits on whether the exam was actually taken.
              className={`rounded-xl border p-3 ${HISTORY_CARD} ${
                !present
                  ? "border-rose-200 bg-rose-100"
                  : sat
                    ? "border-green-200 bg-green-100"
                    : "border-amber-200 bg-amber-100"
              }`}
            >
              <div className="truncate font-medium text-slate-800" title={h.lecture_name}>
                {h.lecture_name}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    present ? "bg-green-500" : h.status === "removed" ? "bg-rose-500" : "bg-slate-300"
                  }`}
                />
                <span className="truncate text-slate-600">{STATUS_AR[h.status] ?? h.status}</span>
              </div>
              {/* Every line is held to one: a card that wrapped would be a card
                  that changed height mid-slide. */}
              <div className="mt-1 truncate text-xs text-slate-600">
                الاختبار:{" "}
                {!h.has_exam
                  ? "بدون اختبار"
                  : !present
                    ? "-"
                    : h.exam_score != null
                      ? `${h.exam_score}${h.exam_grade ? ` / ${h.exam_grade}` : ""}`
                      : "لم يُختبر"}
              </div>
              {/* Nothing is said about the homework unless there was an issue. */}
              {h.homework_flag && (
                <div className="mt-1.5 inline-block max-w-full truncate rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                  {h.homework_flag}
                </div>
              )}
            </div>
          );
        })}
        {Array.from({ length: blanks }).map((_, i) => (
          <div
            key={`blank-${i}`}
            className={`flex flex-col justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3 text-slate-300 ${HISTORY_CARD}`}
          >
            <div className="font-medium">-</div>
            <div className="text-xs">-</div>
            <div className="text-xs">الاختبار: -</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-sm font-semibold text-slate-700">{children}</div>;
}

function ValueBox({
  children,
  ltr,
  tone,
}: {
  children: React.ReactNode;
  ltr?: boolean;
  tone?: "green" | "red";
}) {
  const t =
    tone === "green"
      ? "border-green-300 bg-green-50 text-green-700"
      : tone === "red"
        ? "border-rose-300 bg-rose-50 text-rose-700"
        : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <div
      dir={ltr ? "ltr" : undefined}
      className={`min-h-[42px] rounded-xl border px-4 py-2.5 ${ltr ? "text-right" : ""} ${t}`}
    >
      {children}
    </div>
  );
}

function Info({ label, value, ltr }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  const empty = value == null || value === "";
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <ValueBox ltr={ltr}>
        <span className={empty ? "text-slate-400" : ""}>{empty ? "-" : value}</span>
      </ValueBox>
    </div>
  );
}

// Phone field. Single number → box + copy. Multiple → dropdown list, each row
// with its own copy button.
function PhonesField({ label, phones }: { label: string; phones?: string[] | null }) {
  const list = phones?.filter(Boolean) ?? [];
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  async function copy(p: string) {
    try {
      await navigator.clipboard.writeText(p);
      toast("تم نسخ الرقم");
    } catch {
      toast("تعذّر النسخ", "error");
    }
  }

  if (list.length === 0) {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <ValueBox ltr>
          <span className="text-slate-400">-</span>
        </ValueBox>
      </div>
    );
  }

  if (list.length === 1) {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <div className="flex items-stretch gap-2">
          <div
            dir="ltr"
            className="flex min-h-[42px] flex-1 items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-right text-slate-800"
          >
            {list[0]}
          </div>
          <button
            type="button"
            onClick={() => copy(list[0])}
            title="نسخ"
            className="flex shrink-0 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-400 transition hover:text-accent"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <FieldLabel>{label}</FieldLabel>
      <button
        type="button"
        dir="ltr"
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-[42px] w-full items-center justify-between rounded-xl border bg-slate-50 px-4 py-2.5 text-right text-slate-800 transition ${
          open ? "border-accent ring-2 ring-accent/20" : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <span>{list[0]}</span>
        <span className="flex items-center gap-1.5 text-slate-400">
          <span className="rounded-md bg-slate-200 px-1.5 text-xs text-slate-600">{list.length}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-fade-in">
          {list.map((p, i) => (
            <div
              key={i}
              dir="ltr"
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-right transition hover:bg-slate-100"
            >
              <span className="text-sm text-slate-700">{p}</span>
              <button
                type="button"
                onClick={() => copy(p)}
                title="نسخ"
                className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-accent"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Price box with a solid bar on the left 25%: red when free (0), dark-yellow when
// discounted, nothing otherwise.
function PriceField({ student }: { student: Student | null }) {
  const has = student?.lesson_price != null;
  const stripe =
    student == null ? null : student.lesson_price === 0 ? "red" : student.is_discounted ? "amber" : null;
  return (
    <div>
      <FieldLabel>سعر الحصة</FieldLabel>
      <div className="relative min-h-[42px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
        {stripe && (
          <span
            className={`absolute left-0 top-0 h-full w-1/4 ${
              stripe === "red" ? "bg-rose-600" : "bg-amber-600"
            }`}
          />
        )}
        <span className={`relative ${has ? "" : "text-slate-400"}`}>{has ? student!.lesson_price : "-"}</span>
      </div>
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`rounded-2xl border bg-white p-4 text-right shadow-sm transition ${
        clickable
          ? "cursor-pointer border-slate-200 hover:border-accent hover:shadow-md"
          : "cursor-default border-slate-200"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {clickable && <div className="mt-0.5 text-[11px] font-medium text-accent">اضغط للتفاصيل</div>}
    </button>
  );
}

function StatDetailModal({
  kind,
  rows,
  groupLabelFor,
  onClose,
}: {
  kind: "new" | "other";
  rows: Registration[];
  groupLabelFor: (id: string | null | undefined) => string;
  onClose: () => void;
}) {
  const isOther = kind === "other";
  const title = isOther ? "طلاب من مجموعة أخرى" : "طلاب جدد (أول حصة)";
  const cell = "whitespace-nowrap px-4 py-2.5 text-slate-600";
  const dash = (v: React.ReactNode) => (v == null || v === "" ? "-" : v);
  return (
    <Modal
      size="3xl"
      title={title}
      subtitle={`${rows.length} طالب`}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
        >
          إغلاق
        </button>
      }
    >
      {rows.length === 0 ? (
        <div className="py-8 text-center text-slate-400">لا يوجد</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 scrollbar-thin">
          <table className="w-full min-w-[820px] text-right text-sm">
            <thead className={`${THEAD} text-xs font-medium`}>
              <tr>
                <th className="whitespace-nowrap px-4 py-2.5">#</th>
                <th className="whitespace-nowrap px-4 py-2.5">الاسم</th>
                <th className="whitespace-nowrap px-4 py-2.5">النوع</th>
                <th className="whitespace-nowrap px-4 py-2.5">الصف</th>
                <th className="whitespace-nowrap px-4 py-2.5">المدرسة</th>
                <th className="whitespace-nowrap px-4 py-2.5">المنطقة السكنية</th>
                <th className="whitespace-nowrap px-4 py-2.5">الديانة</th>
                <th className="whitespace-nowrap px-4 py-2.5">المجموعة الأصلية</th>
                {isOther && <th className="whitespace-nowrap px-4 py-2.5">المجموعة المسجّلة</th>}
                <th className="whitespace-nowrap px-4 py-2.5">الهاتف</th>
                <th className="whitespace-nowrap px-4 py-2.5">السعر</th>
                <th className="whitespace-nowrap px-4 py-2.5">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${cell} font-medium text-slate-400`}>{r.serial}</td>
                  <td className={`${cell} font-medium text-slate-800`}>{r.name}</td>
                  <td className={cell}>{dash(r.gender)}</td>
                  <td className={cell}>{dash(r.grade)}</td>
                  <td className={cell}>{dash(r.school)}</td>
                  <td className={cell}>{dash(r.city)}</td>
                  <td className={cell}>{dash(r.religion)}</td>
                  <td className={cell}>{groupLabelFor(r.assigned_group_id)}</td>
                  {isOther && <td className={cell}>{groupLabelFor(r.registered_group_id)}</td>}
                  <td className={cell} dir="ltr">
                    {dash(r.student_phones?.join("، "))}
                  </td>
                  <td className={cell}>{r.lesson_price != null ? r.lesson_price : "-"}</td>
                  <td className={cell}>{r.is_active ? "نشط" : "غير نشط"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
