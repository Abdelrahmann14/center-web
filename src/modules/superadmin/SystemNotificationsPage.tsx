import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Search, X, BellRing, MessageSquareText, History, Check, Save, Plus, Pencil, Users, Clock } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Avatar } from "@/components/Avatar";
import { Toggle } from "@/components/Toggle";
import { DeleteButton } from "@/components/DeleteButton";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { Select, Field, Modal, ConfirmDialog, FormNotice, inputClass } from "@/components/ui";
import { fmtDateTime } from "@/lib/datetime";
import { AuditCell } from "@/components/AuditCell";

type Tab = "notifications" | "messages";

const CATEGORIES = [
  { key: "MUSLIMS", label: "المسلمون" },
  { key: "CHRISTIANS", label: "المسيحيون" },
  { key: "MALE_STUDENTS", label: "الطلاب الذكور" },
  { key: "FEMALE_STUDENTS", label: "الطالبات" },
];

const ROLE_AR: Record<string, string> = { admin: "مدرّس", user: "مساعد", student: "طالب", parent: "ولي أمر" };

interface UserHit { id: string; username: string; role: string; photo: string | null }
interface Teacher { id: string; username: string }
interface OutgoingRow {
  id: string; channel: string; sender: string; title: string | null; body: string;
  audience: string | null; recipients: number; whatsapp_sent: number; created_at: string;
}
interface Template {
  code: string; name: string; channel: string; title: string | null; body: string;
  variables: string | null; enabled: boolean; system: boolean;
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
}

export default function SystemNotificationsPage() {
  const [tab, setTab] = useState<Tab>("notifications");

  return (
    <div>
      <div className="mb-5 flex gap-2">
        <TabButton active={tab === "notifications"} onClick={() => setTab("notifications")} icon={<Send className="h-4 w-4" />}>
          الإشعارات
        </TabButton>
        <TabButton active={tab === "messages"} onClick={() => setTab("messages")} icon={<MessageSquareText className="h-4 w-4" />}>
          الرسائل
        </TabButton>
      </div>

      {tab === "notifications" ? <NotificationsTab /> : <MessagesTab />}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
        active ? "bg-dark text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Notifications composer + history ──────────────────────────────────────

function NotificationsTab() {
  const [composing, setComposing] = useState(false);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [grades, setGrades] = useState<string[]>([]);
  const [pickedGrades, setPickedGrades] = useState<Set<string>>(new Set());
  // Teachers (= admins) are never a recipient audience; the list only feeds the
  // "students of a given teacher" picker below.
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [usersOn, setUsersOn] = useState(false);
  const [picked, setPicked] = useState<UserHit[]>([]);
  const [studentsTeacherOn, setStudentsTeacherOn] = useState(false);
  const [studentsTeacherId, setStudentsTeacherId] = useState("");
  const [whatsapp, setWhatsapp] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<OutgoingRow[]>([]);
  const [confirmDel, setConfirmDel] = useState<OutgoingRow | null>(null);

  useEffect(() => {
    api.get<Teacher[]>("/super/admins").then(setTeachers).catch(() => {});
    api.get<string[]>("/super/student-grades").then(setGrades).catch(() => {});
    loadHistory();
  }, []);

  function loadHistory() {
    api.get<OutgoingRow[]>("/super/outgoing").then(setHistory).catch(() => {});
  }

  const toggleIn = (set: Set<string>, key: string) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  const hasRecipient =
    cats.size > 0 ||
    pickedGrades.size > 0 ||
    (studentsTeacherOn && studentsTeacherId) ||
    (usersOn && picked.length > 0);

  function resetForm() {
    setCats(new Set());
    setPickedGrades(new Set());
    setUsersOn(false);
    setPicked([]);
    setStudentsTeacherOn(false);
    setStudentsTeacherId("");
    setWhatsapp(false);
    setTitle("");
    setBody("");
    setError("");
  }

  async function send() {
    setError("");
    if (!hasRecipient) return setError("اختر فئة مستلمين واحدة على الأقل");
    if (!title.trim() || !body.trim()) return setError("العنوان والنص مطلوبان");
    setSending(true);
    try {
      const res = await api.post<{ sent: number; whatsapp_sent: number }>("/super/notifications", {
        categories: [...cats],
        grades: [...pickedGrades],
        teacher_id: null,
        students_of_teacher_id: studentsTeacherOn ? studentsTeacherId || null : null,
        user_ids: usersOn ? picked.map((u) => u.id) : null,
        whatsapp,
        title: title.trim(),
        body: body.trim(),
      });
      const wa = res.whatsapp_sent > 0 ? ` (${res.whatsapp_sent.toLocaleString("ar-EG")} عبر واتساب)` : "";
      toast.success(`تم الإرسال إلى ${res.sent.toLocaleString("ar-EG")} مستخدم${wa}`, { title: "تم إرسال الإشعار" });
      resetForm();
      loadHistory();
      setComposing(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "تعذّر إرسال الإشعار";
      setError(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(r: OutgoingRow) {
    try {
      await api.del(`/super/outgoing/${r.id}`);
      toast.success("تم حذف الإشعار من جميع المستلمين");
      loadHistory();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الإشعار");
    } finally {
      setConfirmDel(null);
    }
  }

  const stepBadge = (n: number) => (
    <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/10 text-[11px] font-bold text-accent">{n}</span>
  );

  return (
    <>
      <div>
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={() => {
              resetForm();
              setComposing(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
          >
            <Send className="h-5 w-5" />
            إرسال إشعار
          </button>
          <div className="flex items-center gap-2 text-slate-700">
            <h2 className="text-lg font-bold text-slate-800">سجل الإشعارات</h2>
            <History className="h-5 w-5 text-accent" />
          </div>
        </div>

        {history.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400">
            لا يوجد سجل بعد
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {history.map((r) => {
              const wa = r.channel === "whatsapp";
              return (
                <div
                  key={r.id}
                  className="group relative flex gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                >
                  <span className={`absolute inset-y-0 right-0 w-1 ${wa ? "bg-green-500" : "bg-accent"}`} />
                  <div
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                      wa ? "bg-green-50 text-green-600" : "bg-accent/10 text-accent"
                    }`}
                  >
                    {wa ? <MessageSquareText className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate font-semibold text-slate-800">{r.title || r.body}</h3>
                      <div className="-mt-1 -ml-1 shrink-0 opacity-0 transition group-hover:opacity-100">
                        <DeleteButton onClick={() => setConfirmDel(r)} />
                      </div>
                    </div>

                    {r.title && r.body && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{r.body}</p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.audience && (
                        <span className="truncate rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                          {r.audience}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                        <Users className="h-3.5 w-3.5" />
                        {r.recipients.toLocaleString("ar-EG")}
                      </span>
                      {r.whatsapp_sent > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
                          <MessageSquareText className="h-3.5 w-3.5" />
                          {r.whatsapp_sent.toLocaleString("ar-EG")}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400" dir="ltr">
                        <Clock className="h-3.5 w-3.5" />
                        {fmtDateTime(r.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {composing && (
        <Modal
          title="إرسال إشعار"
          size="2xl"
          onClose={() => setComposing(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
              >
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                إرسال
              </button>
            </>
          }
        >
          <div className="space-y-6">
            {/* Step 1 — recipients */}
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                {stepBadge(1)} المستلمون
              </p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <Chip key={c.key} active={cats.has(c.key)} onClick={() => setCats((s) => toggleIn(s, c.key))}>
                    {c.label}
                  </Chip>
                ))}
                <Chip active={studentsTeacherOn} onClick={() => setStudentsTeacherOn((v) => !v)}>طلاب مدرّس محدد</Chip>
                <Chip active={usersOn} onClick={() => setUsersOn((v) => !v)}>طالب أو ولي أمر محدد</Chip>
              </div>

              {studentsTeacherOn && (
                <Field label="طلاب المدرّس">
                  <Select value={studentsTeacherId} onChange={setStudentsTeacherId} options={teachers.map((t) => ({ value: t.id, label: t.username }))} placeholder="اختر المدرّس" />
                </Field>
              )}
              {usersOn && <UserPicker picked={picked} onChange={setPicked} />}

              {grades.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">الصفوف</p>
                  <div className="flex flex-wrap gap-2">
                    {grades.map((g) => (
                      <Chip key={g} active={pickedGrades.has(g)} onClick={() => setPickedGrades((s) => toggleIn(s, g))}>
                        {g}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Step 2 — content */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                {stepBadge(2)} المحتوى
              </p>
              <Field label="العنوان">
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} dir="auto" className={inputClass} />
              </Field>
              <Field label="النص">
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} maxLength={2000} dir="auto" className={`${inputClass} resize-y`} />
              </Field>
              <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-700">
                <Toggle checked={whatsapp} onChange={setWhatsapp} />
                الإرسال عبر واتساب (لمن لديه رقم هاتف)
              </label>
            </div>

            {/* Sender name — inline, no label, below the inputs. */}
            <div className="border-t border-slate-100 pt-4">
              <SenderNameInline />
            </div>

            <FormNotice message={error} />
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="حذف الإشعار"
          message={`سيتم حذف "${confirmDel.title || confirmDel.body}" من سجلك ومن صناديق كل المستلمين نهائيًا.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => handleDelete(confirmDel)}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
        active ? "border-accent bg-accent text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {active && <Check className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/**
 * Sender name shown as plain text with a pencil; clicking it edits inline and
 * clicking away (blur) auto-saves. No label - the super admin knows what it is.
 */
function SenderNameInline() {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const savedRef = useRef("");

  useEffect(() => {
    api.get<{ name: string }>("/super/settings/sender-name")
      .then((r) => {
        setName(r.name);
        savedRef.current = r.name;
      })
      .catch(() => {});
  }, []);

  async function commit() {
    setEditing(false);
    const v = draft.trim();
    if (!v || v === savedRef.current) {
      return;
    }
    setName(v);
    savedRef.current = v;
    try {
      await api.put("/super/settings/sender-name", { name: v });
      toast.success("تم حفظ اسم المُرسِل");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حفظ اسم المُرسِل");
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        maxLength={60}
        dir="auto"
        className={`${inputClass} max-w-xs`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      className="group inline-flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-slate-50"
    >
      <span className="font-medium text-slate-800">{name || "—"}</span>
      <Pencil className="h-4 w-4 text-slate-400 transition group-hover:text-accent" />
    </button>
  );
}

// ── Messages (templates table + CRUD) ─────────────────────────────────────

function MessagesTab() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api.get<Template[]>("/super/templates").then(setTemplates).catch(() => setTemplates([]));
  }
  useEffect(load, []);

  async function toggleEnabled(t: Template) {
    setBusy(t.code);
    try {
      await api.post(`/super/templates/${t.code}/${t.enabled ? "disable" : "enable"}`);
      setTemplates((list) => list?.map((x) => (x.code === t.code ? { ...x, enabled: !x.enabled } : x)) ?? null);
      toast.success(t.enabled ? "تم تعطيل الرسالة" : "تم تفعيل الرسالة");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تغيير حالة الرسالة");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(t: Template) {
    try {
      await api.del(`/super/templates/${t.code}`);
      toast.success(`تم حذف "${t.name}"`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الرسالة");
    } finally {
      setConfirmDelete(null);
    }
  }

  const rows = (templates ?? []).filter(
    (t) =>
      (!search.trim() || t.name.includes(search.trim())) &&
      (!channel || t.channel === channel) &&
      (!status || (status === "on" ? t.enabled : !t.enabled))
  );

  if (!templates) return <LoaderBlock />;

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        الرسائل التلقائية التي يرسلها النظام (رموز التحقق، إعادة تعيين كلمة المرور، تأكيدات الربط) بالإضافة إلى رسائلك المخصّصة. التعديل يُطبَّق فورًا.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم" className={`${inputClass} pr-9`} />
        </div>
        <div className="w-40">
          <Select value={channel} onChange={setChannel} placeholder="كل القنوات" options={[{ value: "", label: "كل القنوات" }, { value: "notification", label: "إشعار" }, { value: "whatsapp", label: "واتساب" }]} />
        </div>
        <div className="w-36">
          <Select value={status} onChange={setStatus} placeholder="الحالة" options={[{ value: "", label: "الكل" }, { value: "on", label: "مُفعّل" }, { value: "off", label: "معطّل" }]} />
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
        >
          <Plus className="h-5 w-5" />
          رسالة جديدة
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-right text-sm">
          <thead className={THEAD}>
            <tr>
              <th className="px-5 py-3 font-medium">الاسم</th>
              <th className="px-5 py-3 font-medium">القناة</th>
              <th className="px-5 py-3 font-medium">النوع</th>
              <th className="px-5 py-3 font-medium">مُفعّلة</th>
              <th className="px-5 py-3 font-medium">تاريخ الإنشاء</th>
              <th className="px-5 py-3 font-medium">تاريخ التحديث</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => (
              <tr key={t.code} className={t.enabled ? "" : "bg-slate-50/60"}>
                <td className="px-5 py-3.5 font-medium text-slate-800">{t.name}</td>
                <td className="px-5 py-3.5">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${t.channel === "whatsapp" ? "bg-green-50 text-green-700" : "bg-accent/10 text-accent"}`}>
                    {t.channel === "whatsapp" ? "واتساب" : "إشعار"}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-xs text-slate-500">{t.system ? "نظام" : "مخصّصة"}</td>
                <td className="px-5 py-3.5">
                  <Toggle checked={t.enabled} onChange={() => toggleEnabled(t)} disabled={busy === t.code} />
                </td>
                <td className="px-5 py-3.5"><AuditCell at={t.created_at} by={t.created_by} /></td>
                <td className="px-5 py-3.5"><AuditCell at={t.updated_at} by={t.updated_by} /></td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => setEdit(t)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent">
                      <Pencil className="h-4 w-4" />
                    </button>
                    {!t.system && <DeleteButton onClick={() => setConfirmDelete(t)} />}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                  <MessageSquareText className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                  لا توجد رسائل
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(edit || creating) && (
        <TemplateModal
          template={edit}
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
          title="حذف الرسالة"
          message={`سيتم حذف "${confirmDelete.name}" نهائيًا.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function TemplateModal({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = template !== null;
  const [name, setName] = useState(template?.name ?? "");
  const [channel, setChannel] = useState(template?.channel ?? "notification");
  const [title, setTitle] = useState(template?.title ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Whether a title field applies: notification channel; and for system edits, only
  // when the seeded template already carries one (WhatsApp-only templates have none).
  const showTitle = isEdit ? template!.title !== null : channel === "notification";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!body.trim() || (!isEdit && !name.trim())) return setError("الاسم والنص مطلوبان");
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/super/templates/${template!.code}`, { title: showTitle ? title.trim() : null, body: body.trim() });
      } else {
        await api.post("/super/templates", { name: name.trim(), channel, title: showTitle ? title.trim() : null, body: body.trim() });
      }
      toast.success(isEdit ? "تم تحديث الرسالة" : "تمت إضافة الرسالة");
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "تعذّر الحفظ";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? template!.name : "رسالة جديدة"}
      subtitle={isEdit ? "عدّل نص الرسالة، واكتب @ لإدراج متغيّر" : "أنشئ قالب رسالة مخصّصًا"}
      size="2xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">إلغاء</button>
          <button type="submit" form="template-form" disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="template-form" onSubmit={submit} className="space-y-4">
        {!isEdit && (
          <>
            <Field label="الاسم">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={inputClass} dir="auto" />
            </Field>
            <Field label="القناة">
              <Select value={channel} onChange={setChannel} options={[{ value: "notification", label: "إشعار" }, { value: "whatsapp", label: "واتساب" }]} />
            </Field>
          </>
        )}
        {showTitle && (
          <Field label="العنوان">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} dir="auto" className={inputClass} />
          </Field>
        )}
        <Field label="النص">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={2000} dir="auto" className={`${inputClass} resize-y`} />
        </Field>
        <FormNotice message={error} />
      </form>
    </Modal>
  );
}

// ── Shared user picker ────────────────────────────────────────────────────

function UserPicker({ picked, onChange }: { picked: UserHit[]; onChange: (u: UserHit[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.get<UserHit[]>(`/super/users/search?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function add(u: UserHit) {
    if (!picked.some((x) => x.id === u.id)) onChange([...picked, u]);
    setQ("");
    setHits([]);
  }

  return (
    <Field plain label="طالب أو ولي أمر محدد">
      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {picked.map((u) => (
            <span key={u.id} className="flex items-center gap-1.5 rounded-full bg-accent/10 py-1 pe-1 ps-3 text-sm text-accent">
              {u.username}
              <button onClick={() => onChange(picked.filter((x) => x.id !== u.id))} className="rounded-full p-0.5 hover:bg-accent/20">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم" className={`${inputClass} pr-9`} />
        {hits.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {hits.map((u) => (
              <button key={u.id} onClick={() => add(u)} className="flex w-full items-center gap-3 px-3 py-2 text-right transition hover:bg-slate-50">
                <Avatar photo={u.photo} name={u.username} size="sm" />
                <span className="flex-1 text-sm text-slate-800">{u.username}</span>
                <span className="text-xs text-slate-400">{ROLE_AR[u.role] ?? u.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
