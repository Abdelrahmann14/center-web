import { useEffect, useState } from "react";
import { Users, Pencil, Loader2 } from "lucide-react";
import { api, ApiError, getAllPages } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Modal, Field, Select, ConfirmDialog, FormNotice, requiredArabic, inputClass } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { Toggle } from "@/components/Toggle";
import { DeleteButton } from "@/components/DeleteButton";
import { THEAD } from "@/components/tableStyles";
import { FilterBar, type ColField } from "@/components/FilterBar";
import { GENDERS, RELIGIONS, ALL_TRACKS } from "@/lib/tracks";
import { AuditCell } from "@/components/AuditCell";

interface StudentRow {
  id: string;
  name: string;
  grade: string | null;
  serial: number | null;
  active: boolean;
  teacher: string | null;
  phones: string | null;
  parent_phones: string | null;
  registered: boolean;
  gender: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

const PAGE_SIZE = 25;

// Chip filters over the whole dataset (never id / name / phone / dates). The
// search box hits the server; FilterBar paginates whatever the chips match.
const FIELDS: ColField<StudentRow>[] = [
  { key: "teacher", label: "المدرّسون", value: (s) => s.teacher || "—" },
  { key: "grade", label: "الصف", value: (s) => s.grade || "—" },
  { key: "gender", label: "النوع", value: (s) => s.gender || "—" },
  { key: "registered", label: "التطبيق", value: (s) => (s.registered ? "مسجّل" : "غير مسجّل") },
  { key: "status", label: "الحالة", value: (s) => (s.active ? "نشط" : "معطّل") },
];

export default function StudentsAdminPage() {
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StudentRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The whole search result, not one page: the chips filter it and FilterBar
  // paginates what they matched.
  function load() {
    setLoading(true);
    const search = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    getAllPages<StudentRow>(`/super/students${search}`)
      .then(setRows)
      .finally(() => setLoading(false));
  }

  // Debounced reload on search change.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function toggleActive(s: StudentRow) {
    setBusyId(s.id);
    try {
      await api.post(`/super/students/${s.id}/${s.active ? "deactivate" : "activate"}`);
      setRows((list) => list.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)));
      toast.success(s.active ? "تم تعطيل الطالب" : "تم تفعيل الطالب");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تغيير حالة الطالب");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(s: StudentRow) {
    try {
      await api.del(`/super/students/${s.id}`);
      toast.success(`تم حذف "${s.name}" نهائيًا`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الطالب");
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div>
      <FilterBar
        rows={rows}
        fields={FIELDS}
        search={q}
        onSearch={setQ}
        searchPlaceholder="بحث بالاسم أو الرقم التعريفي أو الهاتف..."
        pageSize={PAGE_SIZE}
      >
        {(visibleRows) =>
          loading ? (
            <LoaderBlock />
          ) : (
            <>
              <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-right text-sm">
                  <thead className={THEAD}>
                    <tr>
                      <th className="px-5 py-3 font-medium">#</th>
                      <th className="px-5 py-3 font-medium">اسم الطالب</th>
                      <th className="px-5 py-3 font-medium">المدرّسون</th>
                      <th className="px-5 py-3 font-medium">الصف</th>
                      <th className="px-5 py-3 font-medium">النوع</th>
                      <th className="px-5 py-3 font-medium">هاتف الطالب</th>
                      <th className="px-5 py-3 font-medium">التطبيق</th>
                      <th className="px-5 py-3 font-medium">الحالة</th>
                      <th className="px-5 py-3 font-medium">تاريخ الإنشاء</th>
                      <th className="px-5 py-3 font-medium">تاريخ التحديث</th>
                      <th className="px-5 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleRows.map((s) => (
                      <tr key={s.id} className={s.active ? "" : "bg-slate-50/60"}>
                        <td className="px-5 py-3.5 tabular-nums text-slate-500">{s.serial ?? "..."}</td>
                        <td className="px-5 py-3.5 font-medium text-slate-800">{s.name}</td>
                        <td className="px-5 py-3.5 text-slate-600">{s.teacher ?? "..."}</td>
                        <td className="px-5 py-3.5 text-slate-600">{s.grade ?? "..."}</td>
                        <td className="px-5 py-3.5 text-slate-600">{s.gender ?? "..."}</td>
                        <td className="px-5 py-3.5 text-slate-600" dir="ltr">{s.phones || "..."}</td>
                        <td className="px-5 py-3.5">
                          {s.registered ? (
                            <span className="rounded-lg bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">مسجّل</span>
                          ) : (
                            <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">غير مسجّل</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <Toggle checked={s.active} onChange={() => toggleActive(s)} disabled={busyId === s.id} />
                        </td>
                        <td className="px-5 py-3.5"><AuditCell at={s.created_at} by={s.created_by} /></td>
                        <td className="px-5 py-3.5"><AuditCell at={s.updated_at} by={s.updated_by} /></td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setEditId(s.id)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <DeleteButton onClick={() => setConfirmDelete(s)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-5 py-10 text-center text-slate-400">
                          <Users className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                          {rows.length === 0 ? (q.trim() ? "لا توجد نتائج" : "لا يوجد طلاب") : "لا توجد نتائج"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </FilterBar>

      {editId && <StudentEditModal studentId={editId} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load(); }} />}
      {confirmDelete && (
        <ConfirmDialog
          title="حذف الطالب نهائيًا"
          message={`سيتم حذف "${confirmDelete.name}" وكل سجلاته نهائيًا. لا يمكن التراجع.`}
          confirmLabel="حذف نهائي"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

interface StudentDetail {
  id: string;
  name: string;
  grade: string | null;
  serial: number | null;
  teacher: string | null;
  phones: string | null;
  parent_phones: string | null;
  gender: string | null;
  religion: string | null;
  academic_track: string | null;
  school: string | null;
  city: string | null;
  birth_date: string | null;
  lesson_price: number | null;
  discounted: boolean;
  notes: string | null;
}

const nullSelect = (label: string, values: string[]) => [
  { value: "", label },
  ...values.map((v) => ({ value: v, label: v })),
];

function StudentEditModal({ studentId, onClose, onSaved }: { studentId: string; onClose: () => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [gender, setGender] = useState("");
  const [religion, setReligion] = useState("");
  const [track, setTrack] = useState("");
  const [school, setSchool] = useState("");
  const [city, setCity] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [lessonPrice, setLessonPrice] = useState("");
  const [discounted, setDiscounted] = useState(false);
  const [notes, setNotes] = useState("");
  const [phones, setPhones] = useState("");
  const [parentPhones, setParentPhones] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<StudentDetail>(`/super/students/${studentId}`).then((d) => {
      setDetail(d);
      setName(d.name ?? "");
      setGrade(d.grade ?? "");
      setGender(d.gender ?? "");
      setReligion(d.religion ?? "");
      setTrack(d.academic_track ?? "");
      setSchool(d.school ?? "");
      setCity(d.city ?? "");
      setBirthDate(d.birth_date ?? "");
      setLessonPrice(d.lesson_price != null ? String(d.lesson_price) : "");
      setDiscounted(d.discounted);
      setNotes(d.notes ?? "");
      setPhones(d.phones ?? "");
      setParentPhones(d.parent_phones ?? "");
    });
  }, [studentId]);

  const splitPhones = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.put(`/super/students/${studentId}`, {
        name: name.trim(),
        grade: grade.trim() || null,
        gender: gender || null,
        religion: religion || null,
        academic_track: track || null,
        school: school.trim() || null,
        city: city.trim() || null,
        birth_date: birthDate || null,
        lesson_price: lessonPrice === "" ? null : Number(lessonPrice),
        discounted,
        notes: notes.trim() || null,
        student_phones: splitPhones(phones),
        parent_phones: splitPhones(parentPhones),
      });
      toast.success("تم تحديث بيانات الطالب");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر حفظ الطالب");
      toast.error(err instanceof ApiError ? err.message : "تعذّر حفظ الطالب");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="تعديل الطالب"
      subtitle={detail?.serial != null ? `# ${detail.serial}` : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">إلغاء</button>
          <button type="submit" form="student-edit" disabled={saving || !detail} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            {saving && <Loader2 className="h-5 w-5 animate-spin" />}
            حفظ
          </button>
        </>
      }
    >
      {!detail ? (
        <LoaderBlock />
      ) : (
        <form id="student-edit" onSubmit={submit} className="space-y-4">
          <Field label="الاسم">
            <input value={name} onChange={(e) => setName(e.target.value)} required {...requiredArabic} className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="الصف">
              <input value={grade} onChange={(e) => setGrade(e.target.value)} className={inputClass} />
            </Field>
            <Field label="الشعبة">
              <Select value={track} onChange={setTrack} placeholder="غير محدد" options={nullSelect("غير محدد", ALL_TRACKS)} />
            </Field>
            <Field label="النوع">
              <Select value={gender} onChange={setGender} placeholder="غير محدد" options={nullSelect("غير محدد", GENDERS)} />
            </Field>
            <Field label="الديانة">
              <Select value={religion} onChange={setReligion} placeholder="غير محدد" options={nullSelect("غير محدد", RELIGIONS)} />
            </Field>
            <Field label="المدرسة">
              <input value={school} onChange={(e) => setSchool(e.target.value)} className={inputClass} />
            </Field>
            <Field label="المدينة">
              <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
            </Field>
            <Field label="تاريخ الميلاد">
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputClass} dir="ltr" />
            </Field>
            <Field label="سعر الحصة">
              <input type="number" min={0} step="0.01" value={lessonPrice} onChange={(e) => setLessonPrice(e.target.value)} className={inputClass} dir="ltr" />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <Toggle checked={discounted} onChange={setDiscounted} />
            طالب مُخَفَّض
          </label>
          <Field label="هاتف الطالب" hint="افصل بين الأرقام بفاصلة">
            <input value={phones} onChange={(e) => setPhones(e.target.value)} className={inputClass} dir="ltr" />
          </Field>
          <Field label="هاتف ولي الأمر" hint="افصل بين الأرقام بفاصلة">
            <input value={parentPhones} onChange={(e) => setParentPhones(e.target.value)} className={inputClass} dir="ltr" />
          </Field>
          <Field label="ملاحظات">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} />
          </Field>
          <FormNotice message={error} />
        </form>
      )}
    </Modal>
  );
}
