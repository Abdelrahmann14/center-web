import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Users, Users2, Loader2, Plus, Trash2, Save } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { PhotoUpload } from "@/components/PhotoUpload";
import { Switch, Modal, Field, inputClass } from "@/components/ui";
import { toast } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";

interface AdminSummary {
  id: string;
  username: string;
  email: string;
  /** WhatsApp number invoices are sent to; null until it is set. */
  phone: string | null;
  active: boolean;
  student_count: number;
  assistant_count: number;
  photo: string | null;
  whatsapp_enabled: boolean;
}
interface AdminModule {
  code: string;
  name_ar: string;
  description_ar: string | null;
  category: string;
  enabled: boolean;
}
const arNum = (n: number) => n.toLocaleString("ar-EG");

export default function TeacherDetailPage() {
  const { adminId } = useParams();
  const navigate = useNavigate();
  const [teacher, setTeacher] = useState<AdminSummary | null>(null);
  const [modules, setModules] = useState<AdminModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);

  useEffect(() => {
    if (!adminId) return;
    Promise.all([
      api.get<AdminSummary>(`/super/admins/${adminId}`),
      api.get<AdminModule[]>(`/super/admins/${adminId}/modules`),
    ])
      .then(([t, m]) => {
        setTeacher(t);
        setModules(m);
      })
      .finally(() => setLoading(false));
  }, [adminId]);

  async function toggleModule(m: AdminModule) {
    setBusyCode(m.code);
    try {
      await api.put(`/super/admins/${adminId}/modules/${m.code}`, { enabled: !m.enabled });
      setModules((list) => list.map((x) => (x.code === m.code ? { ...x, enabled: !x.enabled } : x)));
    } finally {
      setBusyCode(null);
    }
  }

  async function toggleWhatsapp() {
    if (!teacher) return;
    setWaBusy(true);
    try {
      await api.put(`/super/admins/${adminId}/whatsapp-sync`, { enabled: !teacher.whatsapp_enabled });
      setTeacher((t) => (t ? { ...t, whatsapp_enabled: !t.whatsapp_enabled } : t));
    } finally {
      setWaBusy(false);
    }
  }

  if (loading) return <LoaderBlock />;
  if (!teacher) return <div className="text-slate-400">المدرّس غير موجود</div>;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("/users")}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"
      >
        <ArrowRight className="h-4 w-4" />
        رجوع للمدرّسين
      </button>

      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PhotoUpload
            userId={teacher.id}
            name={teacher.username}
            photo={teacher.photo}
            onChange={(photo) => setTeacher((t) => (t ? { ...t, photo } : t))}
          />
          <div className="text-left">
            <h1 className="text-xl font-bold text-slate-800">{teacher.username}</h1>
            <p className="text-sm text-slate-500" dir="ltr">{teacher.email}</p>
            {/* Invoices are delivered here, so an unset number is worth saying. */}
            <p className="text-sm text-slate-500" dir="ltr">
              {teacher.phone ? `+${teacher.phone}` : <span dir="rtl">لا يوجد رقم واتساب</span>}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-md">
          <Stat icon={<Users className="h-4 w-4" />} label="الطلاب" value={arNum(teacher.student_count)} />
          <Stat icon={<Users2 className="h-4 w-4" />} label="المساعدون" value={arNum(teacher.assistant_count)} />
        </div>
      </div>

      {/* Integrations */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-bold text-slate-800">التكاملات</h2>
        {/* Google Contacts is not here on purpose: it is free to run, so every
            teacher has it. WhatsApp is the only integration with a real per-admin
            cost, and so the only one with a switch. */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="font-semibold text-slate-800">أرقام واتساب</div>
            <div className="mt-0.5 text-xs text-slate-400">
              يسمح لهذا المدرّس بربط أرقام واتساب وإرسال رسائل النظام من أرقامه الخاصة.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {waBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <Switch checked={teacher.whatsapp_enabled} onChange={toggleWhatsapp} disabled={waBusy} />
          </div>
        </div>
        {/* Provisioning: the super admin holds the Green API credentials and
            enters them per number here. The teacher only scans the QR and names
            each number on their own Services page. */}
        {teacher.whatsapp_enabled && <AdminWhatsappNumbers adminId={teacher.id} />}
      </div>

      {/* Module toggles */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold text-slate-800">شاشات النظام</h2>
        <p className="mb-4 mt-1 text-xs text-slate-400">
          كل شاشة مفعّلة للمدرّس افتراضياً. إغلاق أي شاشة يخفيها عنه وعن مساعديه.
        </p>
        <div className="space-y-2">
          {modules.map((m) => (
            <div key={m.code} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800">{m.name_ar}</div>
                {m.description_ar && <div className="mt-0.5 truncate text-xs text-slate-400">{m.description_ar}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {busyCode === m.code && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                <Switch checked={m.enabled} onChange={() => toggleModule(m)} disabled={busyCode === m.code} />
              </div>
            </div>
          ))}
          {modules.length === 0 && <p className="text-sm text-slate-400">لا توجد وحدات</p>}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-slate-800">{value}</div>
    </div>
  );
}

interface WaNum {
  id: string;
  label: string | null;
  connected: boolean;
  state: string | null;
  phone: string | null;
  instance_id: string;
}

/**
 * The super admin's provisioning list for one teacher's WhatsApp numbers. Adding
 * a number means entering its Green API credentials (instance id + token); the
 * teacher then sees a card to scan the QR and rename it, never the credentials.
 */
function AdminWhatsappNumbers({ adminId }: { adminId: string }) {
  const [nums, setNums] = useState<WaNum[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  function load() {
    return api
      .get<WaNum[]>(`/super/admins/${adminId}/whatsapp`)
      .then(setNums)
      .catch(() => setNums([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId]);

  async function remove(id: string) {
    setRemoving(id);
    try {
      await api.del(`/super/admins/${adminId}/whatsapp/${id}`);
      await load();
      toast.success("تمت إزالة الرقم");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر إزالة الرقم");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-700">أرقام واتساب الخاصة بالمدرّس</div>
          <p className="mt-0.5 text-xs text-slate-400">
            أدخل بيانات Green API (Instance ID و API Token) لكل رقم. سيظهر للمدرّس رمز QR ليمسحه
            ويربط الرقم، ويستطيع تسميته فقط.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          إضافة
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {nums === null ? (
          <p className="text-xs text-slate-400">جارٍ التحميل…</p>
        ) : nums.length === 0 ? (
          <p className="text-xs text-slate-400">لا توجد أرقام مضافة بعد.</p>
        ) : (
          nums.map((n) => (
            <div
              key={n.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800" dir="auto">
                  {n.label || (n.phone ? `+${n.phone}` : "رقم بدون اسم")}
                </div>
                <div className="text-[11px] text-slate-400" dir="ltr">
                  Instance {n.instance_id}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    n.connected ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {n.connected ? "متصل" : "بانتظار الربط"}
                </span>
                <button
                  onClick={() => remove(n.id)}
                  disabled={removing === n.id}
                  title="إزالة"
                  className="rounded-md p-1 text-rose-500 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  {removing === n.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {adding && (
        <AddAdminNumberModal
          adminId={adminId}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AddAdminNumberModal({
  adminId,
  onClose,
  onAdded,
}: {
  adminId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [instanceId, setInstanceId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!instanceId.trim() || !apiToken.trim()) {
      setError("Instance ID و API Token مطلوبان");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/super/admins/${adminId}/whatsapp`, {
        instance_id: instanceId.trim(),
        api_token: apiToken.trim(),
        label: label.trim() || null,
      });
      toast.success("تمت إضافة الرقم");
      onAdded();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "تعذّر إضافة الرقم";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="إضافة رقم واتساب للمدرّس"
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
            form="add-admin-wa-form"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="add-admin-wa-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm leading-6 text-slate-500">
          هذه البيانات من لوحة Green API. لن يراها المدرّس، وكل رقم تضيفه هنا يظهر عنده كبطاقة
          جديدة لمسح رمز QR وربطه.
        </p>
        <Field label="اسم الرقم (اختياري)" hint="اسم يميّز الرقم في لوحة المدرّس">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} className={inputClass} />
        </Field>
        <Field label="Instance ID" hint="مثال: 1101xxxxxx">
          <input value={instanceId} onChange={(e) => setInstanceId(e.target.value)} dir="ltr" className={inputClass} />
        </Field>
        <Field label="API Token" hint="كما يظهر في لوحة Green API">
          <input value={apiToken} onChange={(e) => setApiToken(e.target.value)} dir="ltr" className={inputClass} />
        </Field>
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}
      </form>
    </Modal>
  );
}
