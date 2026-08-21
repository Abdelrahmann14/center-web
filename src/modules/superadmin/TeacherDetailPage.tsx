import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Loader2, Pencil, Power, Save, Trash2 } from "@/components/icons";
import { AdminCloudNumbers } from "./CloudNumbers";
import { TypeTemplatePicker, useTypeTemplates } from "./MessageTypeTemplates";
import { WhatsappMessageTypes } from "@/modules/services/WhatsappMessageTypes";
import { api, ApiError } from "@/lib/api";
import { PhotoUpload } from "@/components/PhotoUpload";
import { ConfirmDialog, Field, FormNotice, inputClass, Modal, Switch } from "@/components/ui";
import { LoginNameField } from "@/components/LoginNameField";
import { localPartOf } from "@/lib/useEmailAvailability";
import { toast } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { fmtDateTime } from "@/lib/datetime";

interface AdminSummary {
  id: string;
  username: string;
  email: string;
  /** WhatsApp number invoices are sent to; null until it is set. */
  phone: string | null;
  /** Public contact number message templates print; not the personal one. */
  office_phone: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
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

/**
 * One teacher's workspace, as the platform operator sees it.
 *
 * <p>Two rules hold the layout together, and both were learned the hard way.
 *
 * <p>The first is that nothing on this page is a card inside a card. A section is
 * a white card, and everything within it is a tinted line - never a second
 * bordered surface. Panels that carry their own card elsewhere are asked for
 * their flat form here, so the eye counts one edge instead of four.
 *
 * <p>The second is that the page is fluid, like every other screen in the
 * console. Sections run the full width and pack their contents into a grid that
 * grows with the viewport, so a wide monitor buys denser information rather than
 * two empty margins.
 *
 * <p>Color carries state and nothing else: an open screen is tinted with the
 * accent, a closed one stays grey, so the module grid can be read at arm's
 * length without reading a single word.
 */
export default function TeacherDetailPage() {
  const { adminId } = useParams();
  const navigate = useNavigate();
  const [teacher, setTeacher] = useState<AdminSummary | null>(null);
  const [modules, setModules] = useState<AdminModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmActive, setConfirmActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تغيير الشاشة");
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
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تغيير حالة واتساب");
    } finally {
      setWaBusy(false);
    }
  }

  async function setActive(next: boolean) {
    try {
      await api.post(`/super/admins/${adminId}/${next ? "activate" : "deactivate"}`, {});
      setTeacher((t) => (t ? { ...t, active: next } : t));
      toast.success(next ? "الحساب يعمل الآن" : "تم إيقاف الحساب");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تغيير حالة الحساب");
    }
  }

  async function remove() {
    try {
      await api.del(`/super/admins/${adminId}`);
      toast.success("تم حذف المدرّس ومساحة عمله");
      navigate("/users", { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف المدرّس");
    }
  }

  if (loading) return <LoaderBlock />;
  if (!teacher) return <div className="text-slate-400">المدرّس غير موجود</div>;

  const enabledModules = modules.filter((m) => m.enabled).length;

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate("/users")}
        className="flex items-center gap-1.5 rounded-lg py-1 text-sm font-medium text-slate-500 transition hover:text-slate-900"
      >
        <ArrowRight className="h-4 w-4" />
        رجوع للمدرّسين
      </button>

      {/* Identity band. The only dark surface on the page, and the only place a
          number appears: who this is and how big the workspace is, read in one
          line across the full width instead of a row of stat boxes. */}
      <section className="overflow-hidden rounded-2xl bg-dark text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-5 p-5 sm:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <PhotoUpload
              userId={teacher.id}
              name={teacher.username}
              photo={teacher.photo}
              onChange={(photo) => setTeacher((t) => (t ? { ...t, photo } : t))}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold">{teacher.username}</h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    teacher.active
                      ? "bg-green-400/15 text-green-300"
                      : "bg-rose-400/15 text-rose-300"
                  }`}
                >
                  {teacher.active ? "يعمل" : "موقوف"}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-white/55" dir="ltr">
                {teacher.email}
              </p>
              <p className="truncate text-sm text-white/55" dir="ltr">
                {teacher.phone ? `+${teacher.phone}` : <span dir="rtl">لا يوجد رقم واتساب</span>}
              </p>
              {teacher.office_phone && (
                <p className="truncate text-xs text-white/40">
                  مكتب <span dir="ltr">+{teacher.office_phone}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <Vital label="الطلاب" value={arNum(teacher.student_count)} />
            <Vital label="المساعدون" value={arNum(teacher.assistant_count)} />
            <Vital
              label="الشاشات المفتوحة"
              value={`${arNum(enabledModules)} / ${arNum(modules.length)}`}
            />
            <Vital label="واتساب" value={teacher.whatsapp_enabled ? "مفعّل" : "مغلق"} />
          </div>

          {/* White on the dark band: one weight for every action here, and the
              highest contrast the surface allows. */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
            >
              <Pencil className="h-4 w-4" />
              تعديل البيانات
            </button>
            <button
              onClick={() => setConfirmActive(true)}
              className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
            >
              <Power className="h-4 w-4" />
              {teacher.active ? "إيقاف الحساب" : "تشغيل الحساب"}
            </button>
          </div>
        </div>

        {/* When only ever one person operates the console, naming them adds no
            information - the dates do. */}
        <p className="border-t border-white/10 px-5 py-2.5 text-[11px] text-white/40 sm:px-6">
          أُنشئ {fmtDateTime(teacher.created_at)}
          {teacher.updated_at ? ` · آخر تعديل ${fmtDateTime(teacher.updated_at)}` : ""}
        </p>
      </section>

      {/* Screens. A field of tinted tiles rather than a list: the accent means
          open and grey means closed, so the shape of the grid answers "what can
          this teacher see" before a single label is read. */}
      <Section
        title="الشاشات"
        aside={<Count>{`${arNum(enabledModules)} / ${arNum(modules.length)}`}</Count>}
      >
        {modules.length === 0 ? (
          <Empty>لا توجد شاشات</Empty>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5">
            {modules.map((m) => (
              <div
                key={m.code}
                className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 transition ${
                  m.enabled
                    ? "bg-accent/10 hover:bg-accent/20"
                    : "bg-slate-100 hover:bg-slate-200/70"
                }`}
              >
                <div
                  className={`min-w-0 truncate text-sm font-semibold ${
                    m.enabled ? "text-slate-800" : "text-slate-500"
                  }`}
                >
                  {m.name_ar}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {busyCode === m.code && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                  <Switch
                    checked={m.enabled}
                    onChange={() => toggleModule(m)}
                    disabled={busyCode === m.code}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* WhatsApp numbers. The master switch rides in the section header because
          it gates everything below it - putting it in a row of its own made it
          look like one more setting among the numbers. */}
      <Section
        title="أرقام واتساب"
        aside={
          <div className="flex items-center gap-2">
            {waBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <span className="text-xs font-medium text-slate-500">
              {teacher.whatsapp_enabled ? "مفعّل" : "مغلق"}
            </span>
            <Switch checked={teacher.whatsapp_enabled} onChange={toggleWhatsapp} disabled={waBusy} />
          </div>
        }
      >
        {teacher.whatsapp_enabled ? (
          <AdminCloudNumbers adminId={teacher.id} />
        ) : (
          <Empty>واتساب مغلق</Empty>
        )}
      </Section>

      {teacher.whatsapp_enabled && (
        /* One list of message types, carrying both decisions per row. It used to
           be two lists of the SAME types - one to pick the number, one to pick
           the template - which read as duplicated content and hid the fact that
           the two choices only make sense together. */
        <Section title="أنواع الرسائل">
          <MessageTypes adminId={teacher.id} />
        </Section>
      )}


      {/* Deleting takes the workspace with it, so it lives on its own, last, and
          nowhere near the switches. */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50/50 p-5 sm:p-6">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-rose-700">حذف المدرّس نهائياً</h2>
          <p className="mt-0.5 text-xs text-rose-600/80">يحذف كل بياناته. لا يمكن التراجع.</p>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
        >
          <Trash2 className="h-4 w-4" />
          حذف المدرّس
        </button>
      </section>

      {editing && (
        <EditTeacherModal
          teacher={teacher}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setTeacher(next);
            setEditing(false);
          }}
        />
      )}

      {confirmActive && (
        <ConfirmDialog
          title={teacher.active ? "إيقاف الحساب" : "تشغيل الحساب"}
          message={
            teacher.active
              ? "لن يستطيع المدرّس ولا مساعدوه تسجيل الدخول حتى تشغّل الحساب مرة أخرى. البيانات تبقى كما هي."
              : "سيستطيع المدرّس ومساعدوه تسجيل الدخول مرة أخرى."
          }
          confirmLabel={teacher.active ? "إيقاف الحساب" : "تشغيل الحساب"}
          danger={teacher.active}
          onConfirm={() => setActive(!teacher.active)}
          onClose={() => setConfirmActive(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="حذف المدرّس نهائياً"
          message={`سيُحذف ${teacher.username} وكل بيانات مساحة عمله. لا يمكن التراجع عن هذا.`}
          confirmLabel="حذف نهائياً"
          danger
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

/**
 * The message types with both of their settings on one row.
 *
 * <p>The template mapping is loaded once here and handed to each row, so the
 * types are fetched and listed a single time no matter how many decisions hang
 * off them.
 */
function MessageTypes({ adminId }: { adminId: string }) {
  const templates = useTypeTemplates(adminId);
  return (
    <WhatsappMessageTypes
      apiBase={`/super/admins/${adminId}/whatsapp`}
      flat
      renderTemplate={(code) => <TypeTemplatePicker code={code} state={templates} />}
    />
  );
}

/** One number in the identity band. Value first, label under it. */
function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="mt-0.5 text-[11px] text-white/45">{label}</div>
    </div>
  );
}

/**
 * A top-level block. The page has exactly one of these depths: nothing inside a
 * section is allowed to draw a border of its own.
 */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400">{children}</p>;
}

function EditTeacherModal({
  teacher,
  onClose,
  onSaved,
}: {
  teacher: AdminSummary;
  onClose: () => void;
  onSaved: (next: AdminSummary) => void;
}) {
  const [username, setUsername] = useState(teacher.username);
  // The server owns the domain and validates only the part before it, so that is
  // what the field edits and what the request carries. Sending the whole address
  // failed validation on the "@" itself.
  const [loginName, setLoginName] = useState(localPartOf(teacher.email));
  const [nameTaken, setNameTaken] = useState(false);
  const [phone, setPhone] = useState(teacher.phone ?? "");
  const [officePhone, setOfficePhone] = useState(teacher.office_phone ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !loginName.trim()) {
      setError("الاسم واسم المستخدم مطلوبان");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const next = await api.put<AdminSummary>(`/super/admins/${teacher.id}`, {
        username: username.trim(),
        email: loginName,
        phone: phone.replace(/\D/g, "") || null,
        office_phone: officePhone.replace(/\D/g, "") || null,
        // An empty box means "leave the current password alone".
        password: password.trim() || null,
      });
      toast.success("تم حفظ البيانات");
      onSaved({ ...teacher, ...next });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "تعذّر حفظ البيانات";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="تعديل بيانات المدرّس"
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
            form="edit-teacher-form"
            disabled={saving || nameTaken}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="edit-teacher-form" onSubmit={submit} className="space-y-4">
        <Field label="اسم المدرّس">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={60}
            className={inputClass}
          />
        </Field>
        <LoginNameField
          value={loginName}
          onChange={setLoginName}
          role="admin"
          currentValue={localPartOf(teacher.email)}
          onTakenChange={setNameTaken}
        />
        <Field label="رقم واتساب" hint="تصل عليه الفواتير. بالصيغة الدولية بدون علامة زائد.">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 20))}
            dir="ltr"
            className={inputClass}
          />
        </Field>
        <Field label="رقم مكتب المدرّس" hint="يظهر داخل الرسائل ليتواصل عليه أولياء الأمور.">
          <input
            value={officePhone}
            onChange={(e) => setOfficePhone(e.target.value.replace(/\D/g, "").slice(0, 20))}
            dir="ltr"
            className={inputClass}
          />
        </Field>
        <Field label="كلمة مرور جديدة" hint="اتركها فارغة إن كنت لا تريد تغييرها.">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            dir="ltr"
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <FormNotice message={error} />
      </form>
    </Modal>
  );
}
