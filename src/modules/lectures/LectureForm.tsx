import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
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

  const [name, setName] = useState(initial?.name ?? "");
  const [grade, setGrade] = useState(initial?.grade ?? "");
  const [examName, setExamName] = useState(initial?.exam_name ?? "");
  const [examGrade, setExamGrade] = useState(initial?.exam_grade ?? "");
  const [homework, setHomework] = useState(initial?.homework ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [reached, setReached] = useState(0);

  const O = { name: 1, grade: 2, examName: 3, examGrade: 4, homework: 5 };
  const reach = (o: number) => setReached((r) => (o > r ? o : r));
  const showFor = (o: number) => attempted || reached > o;
  const req = (o: number, v: string) => (showFor(o) && !v.trim() ? "مطلوب" : null);

  const activeGrades = grades.filter((g) => g.is_active || g.name === initial?.grade);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAttempted(true);
    if (!name.trim() || !grade) return;

    const eg = examGrade.trim();
    if (eg && (isNaN(Number(eg)) || Number(eg) <= 0)) {
      setError("درجة الاختبار يجب أن تكون رقماً موجباً");
      return;
    }

    const payload = {
      name: name.trim(),
      grade,
      exam_name: examName.trim() || null,
      exam_grade: examGrade.trim() || null,
      homework: homework.trim() || null,
    };

    setSaving(true);
    try {
      const saved = isEdit
        ? await api.put<Lecture>(`/lectures/${initial.id}`, payload)
        : await api.post<Lecture>("/lectures", payload);
      onSaved(saved, isEdit);
      toast(isEdit ? `تم تحديث حصة "${saved.name}"` : `تمت إضافة حصة "${saved.name}"`);
      onClose();
    } catch (err) {
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
              <FieldError message={req(O.name, name)} />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={() => reach(O.name)}
                autoFocus
                className={inputClass}
              />
            </div>
          </Field>
        </div>

        <Field label="الصف">
          <div className="relative">
            <FieldError message={req(O.grade, grade)} />
            <Select
              value={grade}
              onChange={setGrade}
              onFocus={() => reach(O.grade)}
              placeholder="اختر الصف"
              options={activeGrades.map((g) => ({ value: g.name, label: g.name }))}
            />
          </div>
        </Field>

        <Field label="اسم الاختبار">
          <input
            type="text"
            value={examName}
            onChange={(e) => setExamName(e.target.value)}
            onFocus={() => reach(O.examName)}
            className={inputClass}
          />
        </Field>

        <Field label="درجة الاختبار (النهاية العظمى)" hint="مثال: 50">
          <input
            type="number"
            min="1"
            step="0.5"
            value={examGrade}
            onChange={(e) => setExamGrade(e.target.value)}
            onFocus={() => reach(O.examGrade)}
            className={inputClass}
          />
        </Field>

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
