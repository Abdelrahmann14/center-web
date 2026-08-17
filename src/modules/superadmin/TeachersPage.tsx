import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Loader2, Pencil, Users, Users2, GraduationCap, ChevronLeft } from "@/components/icons";
import { DeleteButton } from "@/components/DeleteButton";
import { Toggle } from "@/components/Toggle";
import { LoginNameField } from "@/components/LoginNameField";
import { localPartOf } from "@/lib/useEmailAvailability";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Avatar } from "@/components/Avatar";
import { Modal, Field, ConfirmDialog, FormNotice, requiredArabic, inputClass } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { FilterBar, type ColField } from "@/components/FilterBar";
import { useUsernameAvailability } from "@/lib/useUsernameAvailability";
import { AuditCell } from "@/components/AuditCell";

export interface AdminSummary {
  id: string;
  username: string;
  email: string;
  /** WhatsApp number invoices are sent to; null until it is set. */
  phone: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  student_count: number;
  assistant_count: number;
  photo: string | null;
}

const arNum = (n: number) => n.toLocaleString("ar-EG");

// Chip filters over the loaded list (never id / name / dates).
const FIELDS: ColField<AdminSummary>[] = [
  { key: "status", label: "الحالة", value: (a) => (a.active ? "نشط" : "معطّل") },
];

export default function TeachersPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editAdmin, setEditAdmin] = useState<AdminSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // Client-side name search feeds the chip bar its rows.
  const searched = useMemo(() => {
    const t = q.trim();
    return t ? rows.filter((a) => a.username.includes(t)) : rows;
  }, [rows, q]);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<AdminSummary[]>("/super/admins"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(a: AdminSummary) {
    setBusyId(a.id);
    try {
      await api.post(`/super/admins/${a.id}/${a.active ? "deactivate" : "activate"}`);
      setRows((list) => list.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)));
      toast.success(a.active ? "تم تعطيل المدرّس" : "تم تفعيل المدرّس");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تغيير حالة المدرّس");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(a: AdminSummary) {
    try {
      await api.del(`/super/admins/${a.id}`);
      setRows((list) => list.filter((x) => x.id !== a.id));
      toast.success(`تم حذف "${a.username}" نهائيًا`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف المدرّس");
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-end gap-4">
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
        >
          <Plus className="h-5 w-5" />
          إضافة مستخدم
        </button>
      </div>

      <FilterBar
        rows={searched}
        fields={FIELDS}
        search={q}
        onSearch={setQ}
        searchPlaceholder="بحث باسم المدرّس..."
      >
        {(visibleRows) =>
          loading ? (
            <LoaderBlock />
          ) : (
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-right text-sm">
                <thead className={THEAD}>
                  <tr>
                    <th className="px-5 py-3 font-medium">اسم المدرّس</th>
                    <th className="px-5 py-3 font-medium">الطلاب</th>
                    <th className="px-5 py-3 font-medium">المساعدون</th>
                    <th className="px-5 py-3 font-medium">الحالة</th>
                    <th className="px-5 py-3 font-medium">تاريخ الإنشاء</th>
                    <th className="px-5 py-3 font-medium">تاريخ التحديث</th>
                    <th className="px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => navigate(`/teachers/${a.id}`)}
                      className={`cursor-pointer transition hover:bg-slate-50 ${a.active ? "" : "bg-slate-50/60"}`}
                    >
                      <td className="px-5 py-3.5 font-medium text-slate-800">
                        <div className="flex items-center gap-3">
                          <Avatar photo={a.photo} name={a.username} />
                          {a.username}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 tabular-nums text-slate-700">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-4 w-4 text-slate-400" />
                          {arNum(a.student_count)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 tabular-nums text-slate-700">
                        <span className="inline-flex items-center gap-1.5">
                          <Users2 className="h-4 w-4 text-slate-400" />
                          {arNum(a.assistant_count)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <Toggle checked={a.active} onChange={() => toggleActive(a)} disabled={busyId === a.id} />
                      </td>
                      <td className="px-5 py-3.5"><AuditCell at={a.created_at} by={a.created_by} /></td>
                      <td className="px-5 py-3.5"><AuditCell at={a.updated_at} by={a.updated_by} /></td>
                      <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setEditAdmin(a)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <DeleteButton onClick={() => setConfirmDelete(a)} label="حذف نهائي" />
                          <ChevronLeft className="h-4 w-4 text-slate-300" />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                        <GraduationCap className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                        {rows.length === 0 ? "لا يوجد مدرّسون بعد" : "لا توجد نتائج"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        }
      </FilterBar>

      {showForm && (
        <AdminForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      )}
      {editAdmin && (
        <AdminForm initial={editAdmin} onClose={() => setEditAdmin(null)} onSaved={() => { setEditAdmin(null); load(); }} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="حذف المدرّس نهائيًا"
          message={`سيتم حذف "${confirmDelete.username}" وكل مساحة عمله (${arNum(confirmDelete.student_count)} طالب و${arNum(confirmDelete.assistant_count)} مساعد) نهائيًا. لا يمكن التراجع.`}
          confirmLabel="حذف نهائي"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export function AdminForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: AdminSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = initial !== undefined;
  const [username, setUsername] = useState(initial?.username ?? "");
  const [loginName, setLoginName] = useState(localPartOf(initial?.email));
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [nameTaken, setNameTaken] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const availability = useUsernameAvailability(username, initial?.username);
  const taken = availability === "taken";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/super/admins/${initial.id}`, {
          username: username.trim(),
          email: loginName,
          phone: phone.trim(),
          ...(password ? { password } : {}),
        });
      } else {
        await api.post("/super/admins", {
          username: username.trim(),
          email: loginName,
          phone: phone.trim(),
          password,
        });
      }
      toast.success(isEdit ? "تم تحديث بيانات المدرّس" : "تمت إضافة المدرّس");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("اسم المدرّس مستخدم بالفعل");
      } else {
        setError(err instanceof Error ? err.message : "تعذّر حفظ المدرّس");
        toast.error(err instanceof Error ? err.message : "تعذّر حفظ المدرّس");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "تعديل المدرّس" : "مستخدم جديد"}
      subtitle={isEdit ? "عدّل الاسم أو كلمة المرور" : "أنشئ حساب مدرّس بمساحة عمل مستقلة"}
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
            form="admin-form"
            disabled={saving || taken || nameTaken}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : isEdit ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="admin-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="اسم المدرّس">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            {...requiredArabic}
            autoFocus
            className={inputClass}
          />
          {availability === "checking" && <p className="mt-1 text-xs text-slate-400">جارٍ التحقق…</p>}
          {availability === "available" && <p className="mt-1 text-xs text-green-600">الاسم متاح</p>}
          {taken && <p className="mt-1 text-xs text-rose-600">الاسم مستخدم بالفعل</p>}
        </Field>

        <LoginNameField
          value={loginName}
          onChange={setLoginName}
          role="admin"
          currentValue={localPartOf(initial?.email)}
          onTakenChange={setNameTaken}
        />

        {/* The number the teacher's own invoices are sent to. Optional, but the
            Financials screen has nowhere to deliver until it is filled in. */}
        <Field label="رقم واتساب المدرّس" hint="بالكود الدولي، مثال: 201001234567">
          <input
            type="tel"
            inputMode="numeric"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
            className={`${inputClass} text-left`}
          />
        </Field>

        <Field label="كلمة المرور" hint={isEdit ? "اتركها فارغة للإبقاء على كلمة المرور الحالية" : undefined}>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!isEdit}
            {...requiredArabic}
            minLength={4}
            className={inputClass}
            placeholder={isEdit ? "••••••" : undefined}
          />
        </Field>

        <FormNotice message={error} />
      </form>
    </Modal>
  );
}
