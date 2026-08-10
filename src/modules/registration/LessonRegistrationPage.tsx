import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { THEAD } from "@/components/tableStyles";
import { api, ApiError, qs, type Page } from "@/lib/api";
import {
  Select,
  Modal,
  Field,
  FieldError,
  ConfirmDialog,
  inputClass,
  type SelectOption,
} from "@/components/ui";
import { GENDERS, RELIGIONS, TRACK_OPTIONS } from "@/lib/tracks";
import { LoaderBlock } from "@/components/PencilLoader";
import { useToast } from "@/components/Toast";
import { useCachedGet, invalidate } from "@/lib/dataCache";
import { useDebounced } from "@/lib/useDebounced";
import { usePageState } from "@/lib/pageState";
import {
  type Student,
  type Grade,
  type Group,
  groupLabel,
  digitsOnly,
  MIN_DIGITS,
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
  /** Null when the homework had no issue - the card then says nothing about it. */
  homework_flag: string | null;
}

const STATUS_AR: Record<string, string> = { present: "حاضر", absent: "غائب", removed: "مطرود" };
const HW_OPTIONS = [
  { value: "واجب ناقص", label: "واجب ناقص" },
  { value: "واجب غير معمول", label: "واجب غير معمول" },
  { value: "واجب منقول", label: "واجب منقول" },
];
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

/** Leading 0 = phone, any other digit = student code, letters = name. */
const searchMode = (term: string): "phone" | "serial" | "name" =>
  term.startsWith("0") ? "phone" : /^\d/.test(term) ? "serial" : "name";

const searchParam = (term: string) => {
  const mode = searchMode(term);
  return mode === "phone" ? { phone: term } : mode === "serial" ? { serial: term } : { name: term };
};

export default function LessonRegistrationPage() {
  const toast = useToast();

  const gradesQ = useCachedGet<Grade[]>("/grades");
  const groupsQ = useCachedGet<Group[]>("/groups");
  const grades = gradesQ.data ?? [];
  const groups = groupsQ.data ?? [];
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
  // Which suggestion the arrow keys are sitting on.
  const [highlight, setHighlight] = useState(0);
  const matchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Quick-edit mode for the selected student's panel, and its autosave spinner.
  const [editing, setEditing] = useState(false);
  const [savingStudent, setSavingStudent] = useState(false);
  const [confirmUnregister, setConfirmUnregister] = useState(false);

  const [gradeLectures, setGradeLectures] = useState<Lecture[]>([]);
  const [matches, setMatches] = useState<Student[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [registering, setRegistering] = useState(false);
  const [registrations, setRegistrations] = useState<Registration[]>([]);

  const selectedId = selected?.id ?? null;
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const label = (id: string | null | undefined) => {
    const g = id ? groupById.get(id) : undefined;
    return g ? groupLabel(g) : "-";
  };

  const gradeGroups = groups.filter((g) => g.grade === grade && g.is_active);
  const lessonReady = !!(grade && groupId && lectureId);
  // If the student is already registered in this lesson, editing only saves the
  // homework flag (button becomes حفظ) instead of re-registering.
  const existingReg = selectedId
    ? registrations.find((r) => r.student_id === selectedId) ?? null
    : null;

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
  }, [lectureId]);

  useEffect(() => {
    if (!selectedId) {
      setHistory([]);
      return;
    }
    api.get<HistoryItem[]>(`/registrations/history/${selectedId}`).then(setHistory).catch(() => {});
  }, [selectedId]);

  // The homework state is sticky: whatever is picked keeps applying to every
  // student registered after it, until the dropdown is changed. Only a student
  // who ALREADY has a registration overrides it, with their own saved value.
  useEffect(() => {
    const reg = selectedId ? registrations.find((r) => r.student_id === selectedId) : null;
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
    setEditing(false);
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
    setEditing(false);
  }

  async function selectFromSearch() {
    if (!q) return;
    // A code must match exactly; a name or a phone takes the best hit.
    const exactCode = searchMode(q) === "serial";
    // Enter should resolve against the freshest results, so query directly
    // rather than trust whatever the debounced dropdown last showed.
    const found = await api
      .get<Page<Student>>(studentQuery(q))
      .then((p) =>
        exactCode ? p.content.find((s) => String(s.serial) === q) ?? null : p.content[0] ?? null
      )
      .catch(() => null);
    if (!found) return toast("لا يوجد طالب مطابق في هذا الصف", "error");
    pickStudent(found);
  }

  /**
   * Quick edit from the panel: one changed field at a time, saved the moment the
   * control is left. Saves the caller a trip to the students page. The duplicate
   * phone guard is only bypassed when this edit did not touch the phones - a
   * sibling sharing a number must not block editing the school.
   */
  async function patchStudent(patch: Partial<Student>): Promise<string | null> {
    if (!selected) return null;
    const touchesPhones = patch.student_phones !== undefined || patch.parent_phones !== undefined;
    const next = { ...selected, ...patch };
    if (JSON.stringify(next) === JSON.stringify(selected)) return null;

    setSavingStudent(true);
    try {
      const saved = await api.put<Student>(`/students/${selected.id}`, {
        name: next.name,
        grade: next.grade,
        school: next.school,
        city: next.city,
        gender: next.gender,
        group_id: next.group_id,
        student_phones: next.student_phones,
        parent_phones: next.parent_phones,
        religion: next.religion,
        academic_track: next.academic_track,
        lesson_price: next.lesson_price,
        notes: next.notes,
        is_active: next.is_active,
        block_reason: next.is_active ? null : next.block_reason,
        allow_duplicate_phone: !touchesPhones,
      });
      setSelected(saved);
      invalidate("/students");
      toast("تم حفظ التعديل");
      return null;
    } catch (err) {
      // Returned, not toasted: the caller paints it on the field that failed.
      return err instanceof ApiError ? err.message : "تعذّر حفظ التعديل";
    } finally {
      setSavingStudent(false);
    }
  }

  /** Wipes the student's attendance in THIS lesson - as if never registered. */
  async function unregisterSelected() {
    if (!existingReg) return;
    setRegistering(true);
    try {
      await api.del(`/registrations/${existingReg.id}`);
      setRegistrations((prev) => prev.filter((r) => r.id !== existingReg.id));
      invalidate("/groups");
      // The panel empties out - the student is no longer part of this lesson.
      clearStudent();
      toast("تم حذف الطالب من هذه الحصة");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "تعذّر الحذف", "error");
    } finally {
      setRegistering(false);
      setConfirmUnregister(false);
    }
  }

  async function registerSelected() {
    if (!selected || registering || !lessonReady) return;
    setRegistering(true);
    try {
      const reg = await api.post<Registration>("/registrations", {
        lecture_id: lectureId,
        student_id: selected.id,
        group_id: groupId,
        status: "present",
        homework_flag: hwFlag || null,
      });
      setRegistrations((prev) => [reg, ...prev]);
      invalidate("/groups");
      toast(`تم تسجيل "${selected.name}"`);
      clearStudent();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "تعذّر التسجيل", "error");
    } finally {
      setRegistering(false);
    }
  }

  // Register a new student, OR (if already registered) save only the homework flag.
  async function onPrimary() {
    if (!selected || registering) return;
    if (!existingReg) return registerSelected();
    setRegistering(true);
    try {
      const upd = await api.patch<Registration>(`/registrations/${existingReg.id}/homework`, {
        homework_flag: hwFlag || null,
      });
      setRegistrations((prev) => prev.map((r) => (r.id === upd.id ? upd : r)));
      toast("تم حفظ حالة الواجب");
      clearStudent();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "تعذّر الحفظ", "error");
    } finally {
      setRegistering(false);
    }
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
    const male = registrations.filter((r) => r.gender === "ذكر");
    const female = registrations.filter((r) => r.gender === "أنثى");
    const news = registrations.filter((r) => r.total_lessons === 1);
    const other = registrations.filter(
      (r) => r.assigned_group_id && r.registered_group_id && r.assigned_group_id !== r.registered_group_id
    );
    return { male, female, news, other };
  }, [registrations]);

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
          {/* Bare search field: no card around it. */}
          <div className="relative mt-6">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(sanitizeSearch(e.target.value));
                setSearchOpen(true);
                if (selectedId) setSelected(null);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={onSearchKeyDown}
              autoFocus
              inputMode="text"
              placeholder="ابحث بالاسم أو الكود"
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

          <StudentPanel
            student={selected}
            groupLabelFor={label}
            differentGroup={differentGroup}
            registering={registering}
            isEdit={!!existingReg}
            hwFlag={hwFlag}
            onHwChange={setHwFlag}
            onPrimary={onPrimary}
            // The lesson being registered is not history yet.
            history={history.filter((h) => h.id !== lectureId)}
            grades={grades}
            groups={groups}
            editing={editing}
            savingStudent={savingStudent}
            onToggleEdit={() => setEditing((e) => !e)}
            onPatch={patchStudent}
            onUnregister={existingReg ? () => setConfirmUnregister(true) : undefined}
          />
        </>
      )}

      {/* ── Live statistics (each metric a box; two are clickable) ── */}
      {lessonReady && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatBox icon={<Users className="h-4 w-4" />} label="إجمالي المسجّلين" value={registrations.length} />
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
  grades,
  groups,
  editing,
  savingStudent,
  onToggleEdit,
  onPatch,
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
  grades: Grade[];
  groups: Group[];
  editing: boolean;
  savingStudent: boolean;
  onToggleEdit: () => void;
  onPatch: (patch: Partial<Student>) => void;
  /** Only set when the student is already registered in THIS lesson. */
  onUnregister?: () => void;
}) {
  // Only the groups of the student's own grade, plus whichever one they are
  // already in (even if it was since deactivated).
  const gradeGroups = groups.filter(
    (g) => (g.grade === student?.grade && g.is_active) || g.id === student?.group_id
  );
  const trackOptions = student?.grade
    ? TRACK_OPTIONS[grades.find((g) => g.name === student.grade)?.track_kind ?? "none"] ?? []
    : [];

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800">بيانات الطالب</h2>
          {savingStudent && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          {editing && !savingStudent && (
            <span className="text-xs text-slate-400">التعديلات تُحفظ تلقائياً</span>
          )}
        </div>
        {student && (
          <div className="flex items-center gap-2">
            <div className="w-44">
              <Select value={hwFlag} onChange={onHwChange} placeholder="حالة الواجب" options={HW_OPTIONS} />
            </div>
            {/* Edit the data right here instead of going to the students page. */}
            <button
              onClick={onToggleEdit}
              title={editing ? "إنهاء التعديل" : "تعديل بيانات الطالب"}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                editing
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-slate-300 text-slate-500 hover:border-accent hover:text-accent"
              }`}
            >
              {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
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
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
            >
              {registering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                <Check className="h-4 w-4" />
              ) : (
                <ClipboardCheck className="h-4 w-4" />
              )}
              {isEdit ? "حفظ" : "تسجيل (Enter)"}
            </button>
          </div>
        )}
      </div>

      {student && !student.is_active && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <Ban className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            هذا الطالب محظور
            {student.block_reason ? <> - السبب: {student.block_reason}</> : null}
          </span>
        </div>
      )}

      {differentGroup && student && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          هذا الطالب من مجموعة أخرى - مجموعته الأصلية: <b>{groupLabelFor(student.group_id)}</b>
        </div>
      )}

      {/* Fields always visible - blank ("-") until a student is searched. In
          edit mode each one becomes a control that saves as soon as it is left. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="col-span-2 sm:col-span-3 lg:col-span-5">
          <FieldLabel>الاسم بالكامل</FieldLabel>
          <div className="flex items-stretch gap-2">
            {editing && student ? (
              <EditableText
                label=""
                bare
                value={student.name}
                editing
                validate={(v) =>
                  !v.trim() ? "مطلوب" : /[^ء-ي\s]/.test(v.trim()) ? "بالحروف العربية فقط" : null
                }
                onSave={(v) => onPatch({ name: v.trim() })}
                className="flex-1"
              />
            ) : (
              <div className="flex min-h-[42px] flex-1 items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                <span className={student ? "" : "text-slate-400"}>{student?.name ?? "-"}</span>
              </div>
            )}
            {student && (
              <span className="flex shrink-0 items-center rounded-xl bg-rose-600 px-3 text-sm font-bold text-white">
                {student.serial}
              </span>
            )}
          </div>
        </div>

        <EditableText
          label="المدرسة"
          value={student?.school}
          editing={editing && !!student}
          onSave={(v) => onPatch({ school: v })}
        />
        <EditableText
          label="المدينة"
          value={student?.city}
          editing={editing && !!student}
          onSave={(v) => onPatch({ city: v })}
        />
        <EditableSelect
          label="الصف"
          value={student?.grade}
          editing={editing && !!student}
          options={grades.map((g) => ({ value: g.name, label: g.name }))}
          validate={(v) => (v ? null : "مطلوب")}
          // A new grade can invalidate the track, so clear it with the change.
          onSave={(v) => onPatch({ grade: v, academic_track: null })}
        />
        <EditableSelect
          label="الشعبة"
          value={student?.academic_track}
          editing={editing && !!student && trackOptions.length > 0}
          options={trackOptions.map((t) => ({ value: t, label: t }))}
          onSave={(v) => onPatch({ academic_track: v || null })}
        />
        <EditableSelect
          label="المجموعة"
          display={student ? groupLabelFor(student.group_id) : null}
          value={student?.group_id}
          editing={editing && !!student}
          options={gradeGroups.map((g) => ({ value: g.id, label: groupLabel(g) }))}
          onSave={(v) => onPatch({ group_id: v || null })}
        />
        <EditableSelect
          label="النوع"
          value={student?.gender}
          editing={editing && !!student}
          options={GENDERS.map((g) => ({ value: g, label: g }))}
          onSave={(v) => onPatch({ gender: v || null })}
        />
        <EditableSelect
          label="الديانة"
          value={student?.religion}
          editing={editing && !!student}
          options={RELIGIONS.map((r) => ({ value: r, label: r }))}
          onSave={(v) => onPatch({ religion: v || null })}
        />
        {editing && student ? (
          <EditableText
            label="سعر الحصة"
            value={student.lesson_price == null ? "" : String(student.lesson_price)}
            editing
            numeric
            validate={(v) => {
              if (v.trim() === "") return null;
              const n = Number(v);
              if (isNaN(n) || n < 0) return "رقم غير صالح";
              const centerPrice = groups.find((g) => g.id === student.group_id)?.lesson_price ?? null;
              return centerPrice != null && n > centerPrice
                ? "لا يمكن أن يكون السعر أعلى من سعر السنتر"
                : null;
            }}
            onSave={(v) => onPatch({ lesson_price: v.trim() === "" ? null : Number(v) })}
          />
        ) : (
          <PriceField student={student} />
        )}
        <EditablePhones
          label="هاتف الطالب"
          phones={student?.student_phones}
          editing={editing && !!student}
          onSave={(list) => onPatch({ student_phones: list })}
        />
        <EditablePhones
          label="هاتف ولي الأمر"
          phones={student?.parent_phones}
          editing={editing && !!student}
          onSave={(list) => onPatch({ parent_phones: list })}
        />
        <div>
          <FieldLabel>الحالة</FieldLabel>
          {editing && student ? (
            <Select
              value={student.is_active ? "active" : "blocked"}
              onChange={(v) => onPatch({ is_active: v === "active" })}
              options={[
                { value: "active", label: "نشط" },
                { value: "blocked", label: "محظور" },
              ]}
            />
          ) : (
            <ValueBox tone={student ? (student.is_active ? "green" : "red") : undefined}>
              {student ? (student.is_active ? "نشط" : "غير نشط") : <span className="text-slate-400">-</span>}
            </ValueBox>
          )}
        </div>
        <div className="col-span-2 sm:col-span-3 lg:col-span-5">
          <EditableText
            label="ملاحظات"
            value={student?.notes}
            editing={editing && !!student}
            onSave={(v) => onPatch({ notes: v.trim() || null })}
          />
        </div>
      </div>

      <HistoryStrip history={history} />
    </div>
  );
}

/** How many lesson cards fit in one view before the arrows are needed. */
const HISTORY_PER_VIEW = 5;

/**
 * The student's earlier lessons in the order they were created, oldest first.
 * Paged with arrows rather than a scrollbar, so a long history never turns the
 * panel into a horizontal scroller.
 */
function HistoryStrip({ history }: { history: HistoryItem[] }) {
  const [start, setStart] = useState(0);
  const maxStart = Math.max(0, history.length - HISTORY_PER_VIEW);

  // A shorter history (another student, or one just unregistered) must not
  // leave the window past the end.
  useEffect(() => {
    setStart((s) => Math.min(s, Math.max(0, history.length - HISTORY_PER_VIEW)));
  }, [history.length]);

  const shown = history.slice(start, start + HISTORY_PER_VIEW);
  const blanks = HISTORY_PER_VIEW - shown.length;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-700">سجل الحصص السابقة</div>
        {history.length > HISTORY_PER_VIEW && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>
              {start + 1}-{start + shown.length} من {history.length}
            </span>
            {/* RTL: the right chevron walks back toward the older lessons. */}
            <button
              type="button"
              onClick={() => setStart((s) => Math.max(0, s - 1))}
              disabled={start === 0}
              aria-label="السابق"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setStart((s) => Math.min(maxStart, s + 1))}
              disabled={start >= maxStart}
              aria-label="التالي"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((h) => {
          const present = h.status === "present";
          const sat = present && h.exam_score != null;
          return (
            <div
              key={h.id}
              // Absent reads like a blocked row in the students table; attended
              // splits on whether the exam was actually taken.
              className={`rounded-xl border p-3 ${
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
                <span className="text-slate-600">{STATUS_AR[h.status] ?? h.status}</span>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                الاختبار:{" "}
                {!present
                  ? "-"
                  : sat
                    ? `${h.exam_score}${h.exam_grade ? ` / ${h.exam_grade}` : ""}`
                    : "لم يُختبر"}
              </div>
              {/* Nothing is said about the homework unless there was an issue. */}
              {h.homework_flag && (
                <div className="mt-1.5 inline-block rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                  {h.homework_flag}
                </div>
              )}
            </div>
          );
        })}
        {Array.from({ length: blanks }).map((_, i) => (
          <div
            key={`blank-${i}`}
            className="flex flex-col justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3 text-slate-300"
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

/**
 * Every quick-edit control validates itself and paints its own error bubble.
 * A field is independent: one bad value never blocks or hides another's, and
 * nothing is toasted - the message sits on the input that caused it.
 *
 * `onSave` returns the server's message when the write is rejected, so the same
 * bubble carries both the local rule and the server's answer.
 */
const errorRing = "border-rose-400 focus:border-rose-400 focus:ring-rose-200";

/**
 * Holds a control's draft text and validates it on EVERY keystroke, so a bad
 * value is called out while it is being typed rather than after the field is
 * left. The save still happens on blur, and only when the draft is valid; the
 * server's own answer then replaces the bubble's message.
 */
function useDraftField<T>(
  value: string,
  parse: (raw: string) => T,
  validate: (raw: string) => string | null,
  onSave: (parsed: T) => Promise<string | null> | void
) {
  const [draft, setDraft] = useState(value);
  const [serverError, setServerError] = useState<string | null>(null);

  // An autosave elsewhere (or a different student) refreshes the box.
  useEffect(() => {
    setDraft(value);
    setServerError(null);
  }, [value]);

  const liveError = validate(draft);

  return {
    draft,
    // The typed-in rule wins while it stands; otherwise show what the server said.
    error: liveError ?? serverError,
    onChange(raw: string) {
      setDraft(raw);
      // The old rejection was about the old text - drop it as soon as it changes.
      setServerError(null);
    },
    async onBlur() {
      if (liveError) return;
      const err = await onSave(parse(draft));
      setServerError(err ?? null);
    },
  };
}

/** A read-only Info box that turns into a self-validating input in edit mode. */
function EditableText({
  label,
  value,
  editing,
  numeric,
  validate,
  onSave,
  bare = false,
  className = "",
}: {
  label: string;
  value: string | null | undefined;
  editing: boolean;
  numeric?: boolean;
  validate?: (value: string) => string | null;
  onSave: (value: string) => Promise<string | null> | void;
  /** Drops the label row - for a field that already has one above it. */
  bare?: boolean;
  className?: string;
}) {
  const field = useDraftField(
    value ?? "",
    (raw) => raw,
    (raw) => validate?.(raw) ?? null,
    onSave
  );
  if (!editing) return <Info label={label} value={value} />;
  return (
    <div className={className}>
      {!bare && <FieldLabel>{label}</FieldLabel>}
      <div className="relative">
        <FieldError message={field.error} />
        <input
          value={field.draft}
          type={numeric ? "number" : "text"}
          min={numeric ? 0 : undefined}
          step={numeric ? "0.01" : undefined}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
          className={`${inputClass} ${field.error ? errorRing : ""}`}
        />
      </div>
    </div>
  );
}

/** Same, for the fields that pick from a list. */
function EditableSelect({
  label,
  value,
  display,
  editing,
  options,
  validate,
  onSave,
}: {
  label: string;
  value: string | null | undefined;
  /** What the read-only box shows, when it differs from the raw value (groups). */
  display?: string | null;
  editing: boolean;
  options: SelectOption[];
  validate?: (value: string) => string | null;
  onSave: (value: string) => Promise<string | null> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!editing) return <Info label={label} value={display !== undefined ? display : value} />;
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <FieldError message={error} />
        <Select
          value={value ?? ""}
          // A pick is a complete value, so it is checked and saved at once.
          onChange={async (v) => {
            const local = validate?.(v) ?? null;
            if (local) return setError(local);
            setError(null);
            setError((await onSave(v)) ?? null);
          }}
          placeholder="غير محدد"
          options={options}
        />
      </div>
    </div>
  );
}

/** Phone list as one comma-separated box while editing. */
function EditablePhones({
  label,
  phones,
  editing,
  onSave,
}: {
  label: string;
  phones: string[] | undefined;
  editing: boolean;
  onSave: (phones: string[]) => Promise<string | null> | void;
}) {
  const field = useDraftField(
    (phones ?? []).join("، "),
    splitPhones,
    (raw) => phonesError(splitPhones(raw)),
    onSave
  );
  if (!editing) return <PhonesField label={label} phones={phones} />;
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <FieldError message={field.error} />
        <input
          value={field.draft}
          dir="ltr"
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
          className={`${inputClass} ${field.error ? errorRing : ""}`}
        />
      </div>
    </div>
  );
}

const splitPhones = (raw: string) =>
  raw
    .split(/[,،\s]+/)
    .map(digitsOnly)
    .filter(Boolean);

/** One shared rule set, so the panel and the students form agree. */
function phonesError(list: string[]): string | null {
  if (list.length === 0) return "مطلوب رقم واحد على الأقل";
  if (list.some((p) => p.length !== MIN_DIGITS)) return `${MIN_DIGITS} أرقام`;
  if (new Set(list).size !== list.length) return "رقم مكرر";
  return null;
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
          <table className="w-full text-right text-sm">
            <thead className={`${THEAD} text-xs font-medium`}>
              <tr>
                <th className="whitespace-nowrap px-4 py-2.5">#</th>
                <th className="whitespace-nowrap px-4 py-2.5">الاسم</th>
                <th className="whitespace-nowrap px-4 py-2.5">النوع</th>
                <th className="whitespace-nowrap px-4 py-2.5">الصف</th>
                <th className="whitespace-nowrap px-4 py-2.5">المدرسة</th>
                <th className="whitespace-nowrap px-4 py-2.5">المدينة</th>
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
