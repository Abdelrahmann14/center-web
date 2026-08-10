// Create or edit an exam. On create the admin picks a lesson and the name, max
// score and stage auto-fill from it (still editable); on save the name/score are
// written back to the lesson server-side. Creating then hands off to the builder.
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { Field, FormNotice, Modal, Select, inputClass } from "@/components/ui";
import { parseMaxScore, type Exam, type LectureLite } from "./types";

export default function ExamForm({
  initial,
  lectures,
  onSaved,
  onClose,
}: {
  initial?: Exam | null;
  lectures: LectureLite[];
  onSaved: (exam: Exam, isEdit: boolean) => void;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [lectureId, setLectureId] = useState(initial?.lecture_id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [maxScore, setMaxScore] = useState(initial?.max_score != null ? String(initial.max_score) : "");
  const [grade, setGrade] = useState(initial?.grade ?? "");
  const [duration, setDuration] = useState(String(initial?.duration_minutes ?? 30));

  const lectureOptions = useMemo(
    () => lectures.map((l) => ({ value: l.id, label: l.grade ? `${l.name} · ${l.grade}` : l.name })),
    [lectures],
  );

  // Picking a lesson pre-fills the editable fields from it.
  function onPickLecture(id: string) {
    setLectureId(id);
    const lecture = lectures.find((l) => l.id === id);
    if (!lecture) return;
    setName(lecture.exam_name?.trim() || lecture.name);
    setMaxScore(parseMaxScore(lecture.exam_grade));
    setGrade(lecture.grade ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!lectureId) return setError("اختر الحصة المرتبطة.");
    if (!name.trim()) return setError("أدخل اسم الاختبار.");
    const score = Number(maxScore);
    if (!maxScore || Number.isNaN(score) || score <= 0) return setError("أدخل درجة صحيحة أكبر من صفر.");
    const dur = Number(duration);
    if (!duration || Number.isNaN(dur) || dur <= 0) return setError("أدخل مدة صحيحة بالدقائق.");

    setSaving(true);
    try {
      const payload = {
        lecture_id: lectureId,
        name: name.trim(),
        max_score: score,
        duration_minutes: dur,
      };
      const saved = isEdit
        ? await api.put<Exam>(`/exams/${initial!.id}`, payload)
        : await api.post<Exam>("/exams", payload);
      toast(isEdit ? "تم حفظ الاختبار" : "تم إنشاء الاختبار");
      onSaved(saved, isEdit);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={isEdit ? "تعديل الاختبار" : "اختبار جديد"}
      subtitle={isEdit ? undefined : "اختر الحصة وستُملأ البيانات تلقائيًا"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="exam-form"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "حفظ" : "إنشاء ومتابعة"}
          </button>
        </>
      }
    >
      <form id="exam-form" noValidate onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="الحصة المرتبطة">
            <Select
              value={lectureId}
              onChange={onPickLecture}
              options={lectureOptions}
              placeholder="اختر الحصة"
              disabled={isEdit}
            />
          </Field>
        </div>

        <Field label="اسم الاختبار" hint="مثال: اختبار الكناية 1">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={isEdit}
          />
        </Field>

        <Field label="الصف (تلقائي من الحصة)">
          <input className={inputClass} value={grade} readOnly disabled />
        </Field>

        <Field label="الدرجة النهائية">
          <input
            className={inputClass}
            type="number"
            min="1"
            step="0.5"
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            dir="ltr"
          />
        </Field>

        <Field label="مدة الاختبار (دقائق)">
          <input
            className={inputClass}
            type="number"
            min="1"
            step="1"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            dir="ltr"
          />
        </Field>

        {error && (
          <div className="sm:col-span-2">
            <FormNotice message={error} />
          </div>
        )}
      </form>
    </Modal>
  );
}
