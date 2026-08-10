import { useEffect, useState } from "react";
import { DeleteButton } from "@/components/DeleteButton";
import {
  Plus,
  Users2,
  Loader2,
  Pencil,
  ShieldCheck,
  User as UserIcon,
  KeyRound,
} from "lucide-react";
import { LoginNameField } from "@/components/LoginNameField";
import { localPartOf } from "@/lib/useEmailAvailability";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { type Role } from "@/auth/AuthContext";
import { Modal, Field, ConfirmDialog, FormNotice, requiredArabic, inputClass } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { AuditCell } from "@/components/AuditCell";
import { useUsernameAvailability } from "@/lib/useUsernameAvailability";

interface Assistant {
  id: string;
  username: string;
  email: string;
  phone: string | null;
  role: Role;
  created_at: string;
  /** Arabic names of the permissions the admin granted this assistant. */
  permissions: string[];
}

export default function UsersPage() {
  const [rows, setRows] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<Assistant | null>(null);
  const [permsFor, setPermsFor] = useState<Assistant | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Assistant | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Assistant[]>("/users"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(u: Assistant) {
    try {
      await api.del(`/users/${u.id}`);
      setRows((list) => list.filter((x) => x.id !== u.id));
      toast.success(`تم حذف "${u.username}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف المساعد");
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
        >
          <Plus className="h-5 w-5" />
          مساعد جديد
        </button>
      </div>

      {loading ? (
        <LoaderBlock />
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className={THEAD}>
              <tr>
                <th className="px-5 py-3 font-medium">اسم المساعد</th>
                <th className="px-5 py-3 font-medium">اسم الدخول</th>
                <th className="px-5 py-3 font-medium">الهاتف</th>
                <th className="px-5 py-3 font-medium">النوع</th>
                <th className="px-5 py-3 font-medium">الصلاحيات</th>
                <th className="px-5 py-3 font-medium">تاريخ الإنشاء</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="px-5 py-3.5 font-medium text-slate-800">{u.username}</td>
                  <td className="px-5 py-3.5 text-slate-600" dir="ltr">{u.email}</td>
                  <td className="px-5 py-3.5 tabular-nums text-slate-600" dir="ltr">
                    {u.phone || "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    {u.role === "admin" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
                        <ShieldCheck className="h-3.5 w-3.5" /> مدير
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        <UserIcon className="h-3.5 w-3.5" /> مساعد
                      </span>
                    )}
                  </td>
                  {/* What this assistant may actually do, straight from the grants. */}
                  <td className="px-5 py-3.5">
                    {u.role === "admin" ? (
                      <span className="text-xs text-slate-400">كل الصلاحيات</span>
                    ) : u.permissions.length === 0 ? (
                      <span className="text-xs text-slate-400">لا توجد صلاحيات</span>
                    ) : (
                      <div className="flex max-w-md flex-wrap gap-1.5">
                        {u.permissions.map((p) => (
                          <span
                            key={p}
                            className="rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <AuditCell at={u.created_at} />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setEditUser(u)}
                        title="تعديل الحساب"
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {u.role !== "admin" && (
                        <button
                          onClick={() => setPermsFor(u)}
                          title="الصلاحيات"
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                      )}
                      {u.role !== "admin" && <DeleteButton onClick={() => setConfirmDelete(u)} />}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    <Users2 className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                    لا يوجد مساعدون
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <UserForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {editUser && (
        <UserForm
          initial={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            setEditUser(null);
            load();
          }}
        />
      )}

      {permsFor && <PermissionsModal user={permsFor} onClose={() => setPermsFor(null)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="حذف المساعد"
          message={`هل أنت متأكد من حذف "${confirmDelete.username}"؟`}
          confirmLabel="حذف"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function UserForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Assistant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = initial !== undefined;
  const [username, setUsername] = useState(initial?.username ?? "");
  const [loginName, setLoginName] = useState(localPartOf(initial?.email));
  const [nameTaken, setNameTaken] = useState(false);
  const [phone, setPhone] = useState(initial?.phone ?? "");
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
        await api.put(`/users/${initial.id}`, {
          username: username.trim(),
          email: loginName,
          phone: phone.trim() || null,
          ...(password ? { password } : {}),
        });
      } else {
        await api.post("/users", {
          username: username.trim(),
          email: loginName,
          phone: phone.trim() || null,
          password,
        });
      }
      toast.success(isEdit ? "تم تحديث بيانات المساعد" : "تمت إضافة المساعد");
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 409
        ? "اسم المساعد مستخدم بالفعل"
        : err instanceof Error ? err.message : "تعذّر حفظ المساعد";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "تعديل الحساب" : "مساعد جديد"}
      subtitle={isEdit ? "عدّل الاسم أو كلمة المرور" : "أنشئ حساب دخول لمساعد جديد"}
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
            form="user-form"
            disabled={saving || taken || nameTaken}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isEdit ? (
              <Pencil className="h-5 w-5" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
            حفظ
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="اسم المساعد">
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
          role="user"
          currentValue={localPartOf(initial?.email)}
          onTakenChange={setNameTaken}
        />

        <Field label="رقم الهاتف" hint="اختياري">
          <input
            type="tel"
            inputMode="numeric"
            dir="ltr"
            maxLength={20}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            className={inputClass}
          />
        </Field>

        <Field
          label="كلمة المرور"
          hint={isEdit ? "اتركها فارغة للإبقاء على كلمة المرور الحالية" : undefined}
        >
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

interface PermAction {
  id: string;
  code: string;
  action: string;
  name_ar: string;
}
interface PermModule {
  code: string;
  name_ar: string;
  description_ar: string | null;
  category: string;
  permissions: PermAction[];
}

/**
 * The grouped-checkbox permission editor. Only the modules the admin themselves
 * can assign (admin-managed and currently enabled) appear - so an assistant can
 * never be granted a capability the admin does not hold.
 */
function PermissionsModal({ user, onClose }: { user: Assistant; onClose: () => void }) {
  const [catalog, setCatalog] = useState<PermModule[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api.get<PermModule[]>("/permissions/catalog"),
      api.get<string[]>(`/users/${user.id}/permissions`),
    ])
      .then(([cat, codes]) => {
        setCatalog(cat);
        setSelected(new Set(codes));
      })
      .finally(() => setLoading(false));
  }, [user.id]);

  function toggle(code: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleModule(m: PermModule, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      m.permissions.forEach((p) => (on ? next.add(p.code) : next.delete(p.code)));
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.put(`/users/${user.id}/permissions`, { codes: [...selected] });
      toast.success("تم حفظ الصلاحيات");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "تعذّر حفظ الصلاحيات";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="الصلاحيات"
      subtitle={`تحديد ما يمكن للمساعد فعله: ${user.username}`}
      size="lg"
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
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      {loading ? (
        <LoaderBlock />
      ) : catalog.length === 0 ? (
        <p className="py-8 text-center text-slate-400">لا توجد صلاحيات متاحة للمنح</p>
      ) : (
        <div className="space-y-4">
          {catalog.map((m) => {
            const all = m.permissions.every((p) => selected.has(p.code));
            return (
              <div key={m.code} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800">{m.name_ar}</div>
                  <button
                    type="button"
                    onClick={() => toggleModule(m, !all)}
                    className="text-xs font-medium text-accent transition hover:text-accent-hover"
                  >
                    {all ? "إلغاء الكل" : "تحديد الكل"}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {m.permissions.map((p) => (
                    <label
                      key={p.code}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-sm transition hover:border-accent/40"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(p.code)}
                        onChange={() => toggle(p.code)}
                        className="h-4 w-4 accent-accent"
                      />
                      <span className="text-slate-700">{p.name_ar}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <FormNotice message={error} />
        </div>
      )}
    </Modal>
  );
}
