import { useEffect, useState } from "react";
import { HeartHandshake, Pencil, Loader2, Plus } from "lucide-react";
import { api, ApiError, getAllPages } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Modal, Field, ConfirmDialog, FormNotice, requiredArabic, inputClass } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { Toggle } from "@/components/Toggle";
import { DeleteButton } from "@/components/DeleteButton";
import { THEAD } from "@/components/tableStyles";
import { FilterBar, type ColField } from "@/components/FilterBar";
import { AuditCell } from "@/components/AuditCell";

interface ParentRow {
  id: string;
  name: string;
  phone: string;
  serial: number | null;
  active: boolean;
  student_count: number;
  registered: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

const arNum = (n: number) => n.toLocaleString("ar-EG");

const PAGE_SIZE = 25;

// Chip filters over the whole dataset (never id / name / phone / dates).
const FIELDS: ColField<ParentRow>[] = [
  { key: "students", label: "الأبناء", value: (p) => arNum(p.student_count) },
  { key: "status", label: "الحالة", value: (p) => (p.active ? "نشط" : "معطّل") },
];

export default function ParentsAdminPage() {
  const [rows, setRows] = useState<ParentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<ParentRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ParentRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The whole search result, not one page: the chips filter it and FilterBar
  // paginates what they matched.
  function load() {
    setLoading(true);
    const q = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    getAllPages<ParentRow>(`/super/parents${q}`)
      .then(setRows)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function toggleActive(p: ParentRow) {
    setBusyId(p.id);
    try {
      await api.post(`/super/parents/${p.id}/${p.active ? "deactivate" : "activate"}`);
      setRows((list) => list.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)));
      toast.success(p.active ? "تم تعطيل ولي الأمر" : "تم تفعيل ولي الأمر");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تغيير حالة ولي الأمر");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(p: ParentRow) {
    try {
      await api.del(`/super/parents/${p.id}`);
      toast.success(`تم حذف "${p.name}" نهائيًا`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف ولي الأمر");
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div>
      <FilterBar
        rows={rows}
        fields={FIELDS}
        search={query}
        onSearch={setQuery}
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
                      <th className="px-5 py-3 font-medium">اسم ولي الأمر</th>
                      <th className="px-5 py-3 font-medium">الهاتف</th>
                      <th className="px-5 py-3 font-medium">الأبناء</th>
                      <th className="px-5 py-3 font-medium">التطبيق</th>
                      <th className="px-5 py-3 font-medium">الحالة</th>
                      <th className="px-5 py-3 font-medium">تاريخ الإنشاء</th>
                      <th className="px-5 py-3 font-medium">تاريخ التحديث</th>
                      <th className="px-5 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleRows.map((p) => (
                      <tr key={p.id} className={p.active ? "" : "bg-slate-50/60"}>
                        <td className="px-5 py-3.5 font-medium text-slate-800">{p.name}</td>
                        <td className="px-5 py-3.5 tabular-nums text-slate-600" dir="ltr">{p.phone}</td>
                        <td className="px-5 py-3.5 tabular-nums text-slate-700">{arNum(p.student_count)}</td>
                        <td className="px-5 py-3.5">
                          <span className="rounded-lg bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">مسجّل</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <Toggle checked={p.active} onChange={() => toggleActive(p)} disabled={busyId === p.id} />
                        </td>
                        <td className="px-5 py-3.5"><AuditCell at={p.created_at} by={p.created_by} /></td>
                        <td className="px-5 py-3.5"><AuditCell at={p.updated_at} by={p.updated_by} /></td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setEdit(p)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <DeleteButton onClick={() => setConfirmDelete(p)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                          <HeartHandshake className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                          {rows.length === 0 ? (query.trim() ? "لا توجد نتائج" : "لا يوجد أولياء أمور") : "لا توجد نتائج"}
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

      {edit && <ParentEditModal parent={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {confirmDelete && (
        <ConfirmDialog
          title="حذف ولي الأمر نهائيًا"
          message={`سيتم حذف "${confirmDelete.name}" وحسابه وروابطه نهائيًا. لا يمكن التراجع.`}
          confirmLabel="حذف نهائي"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function ParentEditModal({ parent, onClose, onSaved }: { parent: ParentRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(parent.name);
  const [phone, setPhone] = useState(parent.phone);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.put(`/super/parents/${parent.id}`, { name: name.trim(), phone: phone.trim() });
      toast.success("تم تحديث بيانات ولي الأمر");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر حفظ ولي الأمر");
      toast.error(err instanceof ApiError ? err.message : "تعذّر حفظ ولي الأمر");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="تعديل ولي الأمر"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">إلغاء</button>
          <button type="submit" form="parent-edit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="parent-edit" onSubmit={submit} className="space-y-4">
        <Field label="الاسم">
          <input value={name} onChange={(e) => setName(e.target.value)} required {...requiredArabic} className={inputClass} />
        </Field>
        <Field label="الهاتف">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required {...requiredArabic} className={inputClass} dir="ltr" />
        </Field>
        <FormNotice message={error} />
      </form>
    </Modal>
  );
}
