import { useEffect, useMemo, useState } from "react";
import { Plus, Loader2, Pencil, GraduationCap, Save } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Toggle } from "@/components/Toggle";
import { DeleteButton } from "@/components/DeleteButton";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { FilterBar, type ColField } from "@/components/FilterBar";
import { Modal, Field, Select, ConfirmDialog, FormNotice, requiredArabic, inputClass } from "@/components/ui";
import { AuditCell } from "@/components/AuditCell";

interface Grade {
  id: string;
  name: string;
  is_active: boolean;
  track_kind: string;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

const TRACK_KIND_OPTIONS = [
  { value: "none", label: "بدون شعب" },
  { value: "g11", label: "أولى ثانوي (علمي/أدبي)" },
  { value: "g12", label: "ثالثة ثانوي (علمي علوم/رياضة/أدبي)" },
];
const trackKindLabel = (k: string) => TRACK_KIND_OPTIONS.find((o) => o.value === k)?.label ?? "-";

export default function GradesAdminPage() {
  const [rows, setRows] = useState<Grade[] | null>(null);
  const [edit, setEdit] = useState<Grade | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Grade | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  function load() {
    api.get<Grade[]>("/grades").then(setRows).catch(() => setRows([]));
  }
  useEffect(load, []);

  // Client-side name search feeds the chip bar its rows.
  const searched = useMemo(() => {
    const t = q.trim();
    return t ? (rows ?? []).filter((g) => g.name.includes(t)) : rows ?? [];
  }, [rows, q]);

  const FIELDS: ColField<Grade>[] = [
    { key: "track_kind", label: "الشعب", value: (g) => trackKindLabel(g.track_kind) },
    { key: "status", label: "الحالة", value: (g) => (g.is_active ? "مُفعّل" : "مُعطّل") },
  ];

  async function toggleActive(g: Grade) {
    setBusy(g.id);
    try {
      const upd = await api.put<Grade>(`/grades/${g.id}`, {
        name: g.name,
        track_kind: g.track_kind,
        is_active: !g.is_active,
      });
      setRows((list) => list?.map((x) => (x.id === g.id ? upd : x)) ?? null);
      toast.success(g.is_active ? "تم تعطيل الصف" : "تم تفعيل الصف");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تغيير حالة الصف");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(g: Grade) {
    try {
      await api.del(`/grades/${g.id}`);
      toast.success(`تم حذف "${g.name}"`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الصف");
    } finally {
      setConfirmDelete(null);
    }
  }

  if (!rows) return <LoaderBlock />;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-accent" />
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
        >
          <Plus className="h-5 w-5" />
          صف جديد
        </button>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-slate-500">
        القائمة العامة للصفوف على مستوى النظام. كل المدرّسين يستخدمون هذه القائمة، ولا يمكنهم تعديلها.
      </p>

      <FilterBar
        rows={searched}
        fields={FIELDS}
        search={q}
        onSearch={setQ}
        searchPlaceholder="بحث باسم الصف..."
      >
        {(visibleRows) => (
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-right text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className="px-5 py-3 font-medium">اسم الصف</th>
                  <th className="px-5 py-3 font-medium">الشعب</th>
                  <th className="px-5 py-3 font-medium">مُفعّل</th>
                  <th className="px-5 py-3 font-medium">تاريخ الإنشاء</th>
                  <th className="px-5 py-3 font-medium">تاريخ التحديث</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((g) => (
                  <tr key={g.id} className={g.is_active ? "" : "bg-slate-50/60"}>
                    <td className="px-5 py-3.5 font-medium text-slate-800">{g.name}</td>
                    <td className="px-5 py-3.5 text-slate-600">{trackKindLabel(g.track_kind)}</td>
                    <td className="px-5 py-3.5">
                      <Toggle checked={g.is_active} onChange={() => toggleActive(g)} disabled={busy === g.id} />
                    </td>
                    <td className="px-5 py-3.5"><AuditCell at={g.created_at} by={g.created_by} /></td>
                    <td className="px-5 py-3.5"><AuditCell at={g.updated_at} by={g.updated_by} /></td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setEdit(g)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <DeleteButton onClick={() => setConfirmDelete(g)} />
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                      <GraduationCap className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                      {rows.length === 0 ? "لا توجد صفوف بعد" : "لا توجد نتائج"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </FilterBar>

      {(edit || creating) && (
        <GradeForm
          grade={edit}
          onClose={() => {
            setEdit(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEdit(null);
            setCreating(false);
            load();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="حذف الصف"
          message={`سيتم حذف "${confirmDelete.name}" من القائمة العامة نهائيًا.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function GradeForm({ grade, onClose, onSaved }: { grade: Grade | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = grade !== null;
  const [name, setName] = useState(grade?.name ?? "");
  const [kind, setKind] = useState<string>(grade?.track_kind ?? "none");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("أدخل اسم الصف");
    setSaving(true);
    try {
      const payload = { name: name.trim(), track_kind: kind, is_active: grade?.is_active ?? true };
      if (isEdit) {
        await api.put(`/grades/${grade.id}`, payload);
      } else {
        await api.post("/grades", payload);
      }
      toast.success(isEdit ? "تم تحديث الصف" : "تمت إضافة الصف");
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "تعذّر حفظ الصف";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "تعديل صف" : "صف جديد"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
            إلغاء
          </button>
          <button type="submit" form="grade-admin-form" disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="grade-admin-form" onSubmit={submit} className="space-y-4">
        <Field label="اسم الصف" hint="مثال: الصف الأول الثانوي">
          <input value={name} onChange={(e) => setName(e.target.value)} required {...requiredArabic} autoFocus className={inputClass} />
        </Field>
        <Field label="الشعب" hint="تحدد خيارات الشعبة عند إضافة الطالب">
          <Select value={kind} onChange={setKind} options={TRACK_KIND_OPTIONS} />
        </Field>
        <FormNotice message={error} />
      </form>
    </Modal>
  );
}
