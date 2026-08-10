import { useEffect, useState } from "react";
import {
  Send, Loader2, Search, X, BellRing, MessageSquareText, History, Check, Save, Plus, Pencil, Users, Clock,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Toggle } from "@/components/Toggle";
import { DeleteButton } from "@/components/DeleteButton";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { Select, Field, Modal, ConfirmDialog, FormNotice, inputClass } from "@/components/ui";
import { RELIGIONS, GENDERS, ALL_TRACKS } from "@/lib/tracks";
import { groupLabel, type Grade, type Group } from "@/modules/students/StudentForm";
import { fmtDateTime } from "@/lib/datetime";
import { AuditCell } from "@/components/AuditCell";

type Tab = "notifications" | "messages";


interface Hit { id: string; name: string; detail: string }
interface OutgoingRow {
  id: string; channel: string; sender: string; title: string | null; body: string;
  audience: string | null; recipients: number; whatsapp_sent: number; created_at: string;
}
interface Template {
  code: string; name: string; channel: string; title: string | null; body: string;
  variables: string | null; enabled: boolean; system: boolean;
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
}

export default function AdminMessagingPage() {
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

      <div key={tab} className="animate-fade-in">
        {tab === "notifications" ? <NotificationsTab /> : <MessagesTab />}
      </div>
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

// ── Notifications composer + history ──────────────────────────────────────

function NotificationsTab() {
  const [composing, setComposing] = useState(false);
  const [religions, setReligions] = useState<Set<string>>(new Set());
  const [genders, setGenders] = useState<Set<string>>(new Set());
  const [grades, setGrades] = useState<Grade[]>([]);
  const [pickedGrades, setPickedGrades] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<Group[]>([]);
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set());
  const [track, setTrack] = useState("");
  const [students, setStudents] = useState<Hit[]>([]);
  const [parents, setParents] = useState<Hit[]>([]);
  const [whatsapp, setWhatsapp] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<OutgoingRow[]>([]);
  const [confirmDel, setConfirmDel] = useState<OutgoingRow | null>(null);

  useEffect(() => {
    api.get<Grade[]>("/grades").then(setGrades).catch(() => {});
    api.get<Group[]>("/groups").then(setGroups).catch(() => {});
    loadHistory();
  }, []);

  function loadHistory() {
    api.get<OutgoingRow[]>("/messaging/outgoing").then(setHistory).catch(() => {});
  }

  const toggleIn = (set: Set<string>, key: string) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  const hasRecipient =
    religions.size > 0 || genders.size > 0 || pickedGrades.size > 0 || pickedGroups.size > 0 ||
    !!track || students.length > 0 || parents.length > 0;

  function resetForm() {
    setReligions(new Set());
    setGenders(new Set());
    setPickedGrades(new Set());
    setPickedGroups(new Set());
    setTrack("");
    setStudents([]);
    setParents([]);
    setWhatsapp(false);
    setTitle("");
    setBody("");
    setError("");
  }

  async function send() {
    setError("");
    if (!hasRecipient) return setError("اختر معيار مستلمين واحدًا على الأقل");
    if (!title.trim() || !body.trim()) return setError("العنوان والنص مطلوبان");
    setSending(true);
    try {
      const res = await api.post<{ sent: number; whatsapp_sent: number }>("/messaging/notifications", {
        student_ids: students.map((s) => s.id),
        parent_ids: parents.map((p) => p.id),
        grades: [...pickedGrades],
        group_ids: [...pickedGroups],
        genders: [...genders],
        religions: [...religions],
        academic_track: track || null,
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
      await api.del(`/messaging/outgoing/${r.id}`);
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
            onClick={() => { resetForm(); setComposing(true); }}
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
                <div key={r.id} className="group relative flex gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
                  <span className={`absolute inset-y-0 right-0 w-1 ${wa ? "bg-green-500" : "bg-accent"}`} />
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${wa ? "bg-green-50 text-green-600" : "bg-accent/10 text-accent"}`}>
                    {wa ? <MessageSquareText className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate font-semibold text-slate-800">{r.title || r.body}</h3>
                      <div className="-mt-1 -ml-1 shrink-0 opacity-0 transition group-hover:opacity-100">
                        <DeleteButton onClick={() => setConfirmDel(r)} />
                      </div>
                    </div>
                    {r.title && r.body && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{r.body}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.audience && (
                        <span className="truncate rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">{r.audience}</span>
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
              <button type="button" onClick={() => setComposing(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
                إلغاء
              </button>
              <button type="button" onClick={send} disabled={sending} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                إرسال
              </button>
            </>
          }
        >
          <div className="space-y-6">
            {/* Step 1 — recipients */}
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">{stepBadge(1)} المستلمون</p>

              <div className="flex flex-wrap gap-2">
                {RELIGIONS.map((r) => (
                  <Chip key={r} active={religions.has(r)} onClick={() => setReligions((s) => toggleIn(s, r))}>{r === "مسلم" ? "المسلمون" : "المسيحيون"}</Chip>
                ))}
                {GENDERS.map((g) => (
                  <Chip key={g} active={genders.has(g)} onClick={() => setGenders((s) => toggleIn(s, g))}>{g === "ذكر" ? "الذكور" : "الإناث"}</Chip>
                ))}
              </div>

              {grades.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">الصفوف</p>
                  <div className="flex flex-wrap gap-2">
                    {grades.map((g) => (
                      <Chip key={g.id} active={pickedGrades.has(g.name)} onClick={() => setPickedGrades((s) => toggleIn(s, g.name))}>{g.name}</Chip>
                    ))}
                  </div>
                </div>
              )}

              {groups.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">المجموعات</p>
                  <div className="flex flex-wrap gap-2">
                    {groups.map((g) => (
                      <Chip key={g.id} active={pickedGroups.has(g.id)} onClick={() => setPickedGroups((s) => toggleIn(s, g.id))}>{groupLabel(g)}</Chip>
                    ))}
                  </div>
                </div>
              )}

              <Field label="الشعبة (اختياري)">
                <Select value={track} onChange={setTrack} placeholder="كل الشعب" options={[{ value: "", label: "كل الشعب" }, ...ALL_TRACKS.map((t) => ({ value: t, label: t }))]} />
              </Field>

              <HitPicker label="طلاب محددون" endpoint="/messaging/students/search" picked={students} onChange={setStudents} />
              <HitPicker label="أولياء أمور محددون" endpoint="/messaging/parents/search" picked={parents} onChange={setParents} />
            </div>

            {/* Step 2 — content */}
            <div className="space-y-4 border-t border-slate-100 pt-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">{stepBadge(2)} المحتوى</p>
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

// ── Recipient picker (students / parents) ─────────────────────────────────

function HitPicker({ label, endpoint, picked, onChange }: { label: string; endpoint: string; picked: Hit[]; onChange: (h: Hit[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => {
      api.get<Hit[]>(`${endpoint}?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, endpoint]);

  function add(h: Hit) {
    if (!picked.some((x) => x.id === h.id)) onChange([...picked, h]);
    setQ("");
    setHits([]);
  }

  return (
    <Field plain label={label}>
      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {picked.map((h) => (
            <span key={h.id} className="flex items-center gap-1.5 rounded-full bg-accent/10 py-1 pe-1 ps-3 text-sm text-accent">
              {h.name}
              <button onClick={() => onChange(picked.filter((x) => x.id !== h.id))} className="rounded-full p-0.5 hover:bg-accent/20">
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
            {hits.map((h) => (
              <button key={h.id} onClick={() => add(h)} className="flex w-full items-center gap-3 px-3 py-2 text-right transition hover:bg-slate-50">
                <span className="flex-1 text-sm text-slate-800">{h.name}</span>
                <span className="text-xs text-slate-400">{h.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

// ── Messages (own templates + read-only system templates) ─────────────────

function MessagesTab() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [edit, setEdit] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api.get<Template[]>("/messaging/templates").then(setTemplates).catch(() => setTemplates([]));
  }
  useEffect(load, []);

  async function toggleEnabled(t: Template) {
    setBusy(t.code);
    try {
      await api.post(`/messaging/templates/${t.code}/${t.enabled ? "disable" : "enable"}`);
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
      await api.del(`/messaging/templates/${t.code}`);
      toast.success(`تم حذف "${t.name}"`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الرسالة");
    } finally {
      setConfirmDelete(null);
    }
  }

  if (!templates) return <LoaderBlock />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800">الرسائل</h2>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover">
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
              <th className="px-5 py-3 font-medium">تاريخ التحديث</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {templates.map((t) => (
              <tr key={t.code} className={t.enabled ? "" : "bg-slate-50/60"}>
                <td className="px-5 py-3.5 font-medium text-slate-800">{t.name}</td>
                <td className="px-5 py-3.5">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${t.channel === "whatsapp" ? "bg-green-50 text-green-700" : "bg-accent/10 text-accent"}`}>
                    {t.channel === "whatsapp" ? "واتساب" : "إشعار"}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-xs text-slate-500">{t.system ? "نظام" : "مخصّصة"}</td>
                <td className="px-5 py-3.5">
                  {t.system ? (
                    <span className="text-xs text-slate-400">{t.enabled ? "مُفعّلة" : "معطّلة"}</span>
                  ) : (
                    <Toggle checked={t.enabled} onChange={() => toggleEnabled(t)} disabled={busy === t.code} />
                  )}
                </td>
                <td className="px-5 py-3.5"><AuditCell at={t.updated_at} by={t.updated_by} /></td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => setEdit(t)} title={t.system ? "عرض" : "تعديل"} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent">
                      <Pencil className="h-4 w-4" />
                    </button>
                    {!t.system && <DeleteButton onClick={() => setConfirmDelete(t)} />}
                  </div>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
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
          onClose={() => { setEdit(null); setCreating(false); }}
          onSaved={() => { setEdit(null); setCreating(false); load(); }}
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
  const readOnly = template?.system ?? false;
  const [name, setName] = useState(template?.name ?? "");
  const [channel, setChannel] = useState(template?.channel ?? "notification");
  const [title, setTitle] = useState(template?.title ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const showTitle = isEdit ? template!.title !== null : channel === "notification";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return onClose();
    setError("");
    if (!body.trim() || (!isEdit && !name.trim())) return setError("الاسم والنص مطلوبان");
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/messaging/templates/${template!.code}`, { title: showTitle ? title.trim() : null, body: body.trim() });
      } else {
        await api.post("/messaging/templates", { name: name.trim(), channel, title: showTitle ? title.trim() : null, body: body.trim() });
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
      subtitle={readOnly ? "رسالة نظام تلقائية — للعرض فقط" : isEdit ? "عدّل نص الرسالة، واكتب @ لإدراج متغيّر" : "أنشئ قالب رسالة مخصّصًا"}
      size="2xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
            {readOnly ? "إغلاق" : "إلغاء"}
          </button>
          {!readOnly && (
            <button type="submit" form="admin-template-form" disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              حفظ
            </button>
          )}
        </>
      }
    >
      <form id="admin-template-form" onSubmit={submit} className="space-y-4">
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
