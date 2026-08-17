import { useState } from "react";
import { Plus, Loader2 } from "@/components/icons";
import { api, ApiError, isOfflineError } from "@/lib/api";
import { useOnline } from "@/lib/useOnline";
import { useSync } from "@/sync/SyncProvider";
import { Modal, Field, Select, FieldError, FormNotice, inputClass } from "@/components/ui";
import { useToast } from "@/components/Toast";

export interface Grade {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Lecture {
  id: string;
  name: string;
  grade: string | null;
  exam_name: string | null;
  exam_grade: string | null;
  /** False = this lesson has no exam; both exam fields are then null. */
  has_exam: boolean;
  homework: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export function LectureForm({
  initial,
  grades,
  onClose,
  onSaved,
}: {
  initial?: Lecture;
  grades: Grade[];
  onClose: () => void;
  onSaved: (l: Lecture, isEdit: boolean) => void;
}) {
  const isEdit = initial !== undefined;
  const toast = useToast();
  const sync = useSync();
  const online = useOnline();

  const [name, setName] = useState(initial?.name ?? "");
  const [grade, setGrade] = useState(initial?.grade ?? "");
  const [examName, setExamName] = useState(initial?.exam_name ?? "");
  const [examGrade, setExamGrade] = useState(initial?.exam_grade ?? "");
  // A lesson states whether it has an exam. Everything downstream reads this:
  // the score column on the group sheet, the history card on the next lesson,
  // and the student's report all stop expecting a mark that was never set.
  const [hasExam, setHasExam] = useState(initial ? initial.has_exam : false);
  const [homework, setHomework] = useState(initial?.homework ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  /** Fields the user has entered and left. Drives the on-blur validation. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Two kinds of error, revealed at different moments - the same rule the
  // student form follows.
  //
  // A CONTENT error (an exam mark that is not a positive number) appears as soon
  // as the user leaves that field, beside the field they just filled.
  //
  // "مطلوب" waits for Save. This form used to reveal it as soon as focus reached
  // ANY later field, so tabbing from the name to the grade flagged the grade as
  // missing before the user had a chance to choose one.
  const touch = (key: string) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));
  const showContent = (key: string) => touched[key] === true || attempted;
  const req = (v: string) => (attempted && !v.trim() ? "مطلوب" : null);

  // With an exam, the maximum mark is what makes a score enterable at all, so it
  // is required. Without one the field is not on screen and never checked.
  const examGradeErrorRaw = !hasExam
    ? null
    : !examGrade.trim()
      ? attempted
        ? "مطلوب"
        : null
      : isNaN(Number(examGrade)) || Number(examGrade) <= 0
        ? "درجة الاختبار يجب أن تكون رقماً موجباً"
        : null;
  const examGradeError = showContent("examGrade") ? examGradeErrorRaw : null;

  const activeGrades = grades.filter((g) => g.is_active || g.name === initial?.grade);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAttempted(true);
    // The exam-mark error is shown on its own field rather than as a form-level
    // notice, so submitting just stops here and lets that field speak.
    if (!name.trim() || !grade || examGradeErrorRaw || (hasExam && !examGrade.trim())) return;

    const payload = {
      name: name.trim(),
      grade,
      has_exam: hasExam,
      exam_name: hasExam ? examName.trim() || null : null,
      exam_grade: hasExam ? examGrade.trim() || null : null,
      homework: homework.trim() || null,
    };

    /**
     * Save the lesson into the mirror and queue it. The queued mutation replays
     * through the SAME service the online call reaches, so the offline path
     * cannot drift from it on validation or on the row id - the lesson the user
     * is now looking at IS the lesson the server will hold.
     */
    const saveOffline = async () => {
      const now = new Date().toISOString();
      const optimistic = {
        id: initial?.id ?? "",
        ...payload,
        created_at: initial?.created_at ?? now,
        created_by: initial?.created_by ?? null,
        updated_at: now,
        updated_by: initial?.updated_by ?? null,
      };
      const row = (await sync.queueLecture(
        payload,
        optimistic,
        isEdit ? initial.id : undefined,
      )) as unknown as Lecture;
      onSaved(row, isEdit);
      toast(
        `${isEdit ? "تم تحديث" : "تمت إضافة"} حصة "${row.name}" - بانتظار المزامنة عند عودة الاتصال`,
      );
      onClose();
    };

    setSaving(true);
    try {
      if (!online && sync.ready) {
        await saveOffline();
        return;
      }
      const saved = isEdit
        ? await api.put<Lecture>(`/lectures/${initial.id}`, payload)
        : await api.post<Lecture>("/lectures", payload);
      onSaved(saved, isEdit);
      toast(isEdit ? `تم تحديث حصة "${saved.name}"` : `تمت إضافة حصة "${saved.name}"`);
      onClose();
    } catch (err) {
      // A transport failure means the request never reached the server; a real
      // server error (a duplicate name, a bad grade) is surfaced as before.
      if (isOfflineError(err) && sync.ready) {
        try {
          await saveOffline();
          return;
        } catch {
          setError("تعذّر حفظ الحصة دون اتصال");
          return;
        }
      }
      setError(err instanceof ApiError ? err.message : "تعذّر حفظ الحصة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={isEdit ? "تعديل حصة" : "حصة جديدة"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="lecture-form"
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="lecture-form" noValidate onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="اسم الحصة">
            <div className="relative">
              <FieldError message={req(name)} />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className={inputClass}
              />
            </div>
          </Field>
        </div>

        <Field label="الصف">
          <div className="relative">
            <FieldError message={req(grade)} />
            <Select
              value={grade}
              onChange={setGrade}
              placeholder="اختر الصف"
              options={activeGrades.map((g) => ({ value: g.name, label: g.name }))}
            />
          </div>
        </Field>

        <Field label="الاختبار" hint="هل لهذه الحصة اختبار؟">
          <Select
            value={hasExam ? "yes" : "no"}
            onChange={(v) => setHasExam(v === "yes")}
            placeholder=""
            options={[
              { value: "no", label: "بدون اختبار" },
              { value: "yes", label: "باختبار" },
            ]}
          />
        </Field>

        {/* Both exam fields hang off the choice above - a lesson with no exam
            has nothing to name and no mark to cap. */}
        {hasExam && (
          <>
            <Field label="اسم الاختبار">
              <input
                type="text"
                value={examName}
                onChange={(e) => setExamName(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="درجة الاختبار (النهاية العظمى)" hint="مثال: 50">
              <FieldError message={examGradeError} />
              <input
                type="number"
                min="1"
                step="0.5"
                value={examGrade}
                onChange={(e) => setExamGrade(e.target.value)}
                onBlur={() => touch("examGrade")}
                className={`${inputClass} ${examGradeError ? "border-rose-400 focus:border-rose-400 focus:ring-rose-200" : ""}`}
              />
            </Field>
          </>
        )}

        <div className="sm:col-span-2">
          <Field label="واجب الحصة">
            <textarea
              value={homework}
              onChange={(e) => setHomework(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>
        </div>

        {error && (
          <div className="sm:col-span-2">
            <FormNotice message={error} />
          </div>
        )}
      </form>
    </Modal>
  );
}
