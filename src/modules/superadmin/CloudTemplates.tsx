import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Users,
} from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Field, Modal, MultiSelect, Select, Switch, inputClass } from "@/components/ui";

export interface CloudTemplate {
  id: string;
  meta_template_id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body_text: string | null;
  header_format: string;
  /** The wording of a TEXT header; a {{1}} in it is what makes a header variable required. */
  header_text: string | null;
  body_params: number;
  has_url_button: boolean;
  label: string | null;
  header_var: string | null;
  var_keys: (string | null)[];
  shared_all: boolean;
  admin_ids: string[];
  rejected_reason: string | null;
}

interface SystemVariable {
  key: string;
  label: string;
  description: string;
  group: string;
  example: string;
}

interface AdminRow {
  id: string;
  username: string;
}

const STATUS_AR: Record<string, { label: string; className: string }> = {
  APPROVED: { label: "معتمد", className: "bg-green-50 text-green-700" },
  PENDING: { label: "تحت المراجعة", className: "bg-amber-50 text-amber-700" },
  REJECTED: { label: "مرفوض", className: "bg-rose-50 text-rose-700" },
  PAUSED: { label: "موقوف", className: "bg-slate-100 text-slate-600" },
  DISABLED: { label: "معطّل", className: "bg-slate-100 text-slate-600" },
};

const HEADER_AR: Record<string, string> = {
  NONE: "بدون رأس",
  TEXT: "رأس نصي",
  IMAGE: "رأس صورة",
  DOCUMENT: "رأس ملف",
  VIDEO: "رأس فيديو",
};

/**
 * The message templates that live on the official WhatsApp account, and the
 * three decisions Meta knows nothing about.
 *
 * <p>Meta owns the template itself: it is written and reviewed inside WhatsApp
 * Manager, and its review is what decides whether the template exists at all. So
 * nothing here edits one. What this screen adds is the part Meta cannot supply -
 * a template's placeholders are numbered, not named, and <code>{{2}}</code> says
 * nothing about whether it is a lesson name or an attendance time. Someone has
 * to say, once, and that mapping is what lets the system fill a template
 * correctly for every student.
 */
export function CloudTemplates() {
  const [rows, setRows] = useState<CloudTemplate[] | null>(null);
  const [variables, setVariables] = useState<SystemVariable[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CloudTemplate | null>(null);

  const load = useCallback(
    () =>
      api
        .get<CloudTemplate[]>("/super/whatsapp/cloud/templates")
        .then(setRows)
        .catch(() => setRows([])),
    [],
  );

  useEffect(() => {
    load();
    api
      .get<SystemVariable[]>("/super/whatsapp/cloud/variables")
      .then(setVariables)
      .catch(() => setVariables([]));
    api
      .get<AdminRow[]>("/super/admins")
      .then(setAdmins)
      .catch(() => setAdmins([]));
  }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      setRows(await api.post<CloudTemplate[]>("/super/whatsapp/cloud/templates/sync", {}));
      toast.success("تم تحديث القوالب");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تحديث القوالب");
    } finally {
      setSyncing(false);
    }
  }

  function replace(updated: CloudTemplate) {
    setRows((list) => (list ?? []).map((t) => (t.id === updated.id ? updated : t)));
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-slate-800">قوالب واتساب</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-400">
            تُكتب وتُراجَع داخل WhatsApp Manager. أضِف القالب هنا برقم التعريف، ثم حدّد ماذا يملأ كل
            متغيّر فيه ومن يستطيع استخدامه.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            تحديث الكل
          </button>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            إضافة برقم التعريف
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rows === null ? (
          <p className="text-xs text-slate-400">جارٍ التحميل…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-400">
            لا توجد قوالب بعد. أنشئ القالب في WhatsApp Manager ثم أضفه هنا برقم التعريف.
          </p>
        ) : (
          rows.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              variables={variables}
              onEdit={() => setEditing(t)}
            />
          ))
        )}
      </div>

      {adding && (
        <ImportModal
          onClose={() => setAdding(false)}
          onAdded={async (created) => {
            setAdding(false);
            await load();
            // Straight into the mapping: a template with no mapping sends dashes
            // where the values belong, so adding one is only half the job.
            setEditing(created);
          }}
        />
      )}

      {editing && (
        <MappingModal
          template={editing}
          variables={variables}
          admins={admins}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            replace(updated);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TemplateRow({
  template: t,
  variables,
  onEdit,
}: {
  template: CloudTemplate;
  variables: SystemVariable[];
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = STATUS_AR[t.status] ?? { label: t.status, className: "bg-slate-100 text-slate-600" };
  const mapped = t.var_keys.filter(Boolean).length;
  const complete = mapped >= t.body_params;

  return (
    <div className="overflow-hidden rounded-xl bg-slate-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-right transition hover:bg-slate-200/60"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium text-slate-800" dir="auto">
              {t.label || t.name}
            </span>
            {t.body_params > 0 && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  complete ? "bg-white text-slate-500" : "bg-amber-100 text-amber-700"
                }`}
              >
                {complete ? `${t.body_params} متغيّر مربوط` : `${mapped} من ${t.body_params} مربوط`}
              </span>
            )}
            {!t.shared_all && (
              <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                <Users className="h-3 w-3" />
                {t.admin_ids.length} حساب
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span dir="ltr">{t.name}</span>
            <span>·</span>
            <span dir="ltr">{t.language}</span>
            <span>·</span>
            <span>{t.category}</span>
            <span>·</span>
            <span>{HEADER_AR[t.header_format] ?? t.header_format}</span>
            {t.has_url_button && (
              <>
                <span>·</span>
                <span>زر رابط</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
            {status.label}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 px-4 py-3">
          {t.body_text && (
            <p
              className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600"
              dir="auto"
            >
              {t.body_text}
            </p>
          )}

          {t.body_params > 0 && (
            <div className="space-y-1">
              {Array.from({ length: t.body_params }, (_, i) => {
                const key = t.var_keys[i] ?? null;
                const v = variables.find((x) => x.key === key);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono text-slate-500" dir="ltr">{`{{${i + 1}}}`}</span>
                    <span className={v ? "text-slate-700" : "text-amber-600"}>
                      {v ? v.label : "غير مربوط"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {t.rejected_reason && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              سبب الرفض: {t.rejected_reason}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              تعديل الربط والصلاحيات
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (created: CloudTemplate) => void;
}) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id.trim()) return;
    setSaving(true);
    try {
      const created = await api.post<CloudTemplate>("/super/whatsapp/cloud/templates/import", {
        meta_template_id: id.trim(),
        label: label.trim() || null,
      });
      toast.success("تمت إضافة القالب");
      onAdded(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر إضافة القالب");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="إضافة قالب برقم التعريف"
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
            form="import-template-form"
            disabled={saving || !id.trim()}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            جلب القالب
          </button>
        </>
      }
    >
      <form id="import-template-form" onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          افتح القالب في WhatsApp Manager وانسخ رقم التعريف (Template ID) الظاهر في صفحته. سيقرأ
          النظام نص القالب ومتغيّراته من واتساب مباشرةً.
        </div>
        <Field label="رقم تعريف القالب" hint="أرقام فقط، مثل: 1234567890123456">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            dir="ltr"
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label="اسم مختصر (اختياري)" hint="اسم عربي يسهّل تمييزه، مثل: رسالة الحضور">
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </Field>
      </form>
    </Modal>
  );
}

/**
 * The mapping editor: one row per placeholder, each pointing at a system
 * variable chosen from a list. Deliberately a picker rather than a text field -
 * a typed key would be stored happily and render as nothing at send time, and
 * the person reading the message would blame the template.
 */
function MappingModal({
  template: t,
  variables,
  admins,
  onClose,
  onSaved,
}: {
  template: CloudTemplate;
  variables: SystemVariable[];
  admins: AdminRow[];
  onClose: () => void;
  onSaved: (updated: CloudTemplate) => void;
}) {
  const [label, setLabel] = useState(t.label ?? "");
  const [headerVar, setHeaderVar] = useState(t.header_var ?? "");
  const [keys, setKeys] = useState<string[]>(() =>
    Array.from({ length: t.body_params }, (_, i) => t.var_keys[i] ?? ""),
  );
  const [sharedAll, setSharedAll] = useState(t.shared_all);
  const [adminIds, setAdminIds] = useState<string[]>(t.admin_ids);
  const [saving, setSaving] = useState(false);

  const options = [
    { value: "", label: "— بدون —" },
    ...variables.map((v) => ({ value: v.key, label: `${v.label} — ${v.example}` })),
  ];

  // The FORMAT does not say whether the header takes a value - only a placeholder
  // in its wording does. Meta counts the header's parameters separately from the
  // body's and rejects the send on either mismatch, so a static header must be
  // offered no variable and a dynamic one must be given something.
  const headerTakesVar =
    t.header_format === "TEXT" && /\{\{\s*1\s*}}/.test(t.header_text ?? "");

  async function save() {
    setSaving(true);
    try {
      const updated = await api.put<CloudTemplate>(
        `/super/whatsapp/cloud/templates/${t.id}/mapping`,
        {
          label: label.trim() || null,
          header_var: headerTakesVar ? headerVar || null : null,
          var_keys: keys,
          shared_all: sharedAll,
          admin_ids: sharedAll ? [] : adminIds,
        },
      );
      toast.success("تم حفظ الربط");
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حفظ الربط");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t.label || t.name}
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
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {(t.header_text || t.body_text) && (
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-6 text-slate-600">
            {/* The header is shown as its own line, bold, because that is how it
                reaches the reader - and because a header with {{1}} in it is the
                reason the field below exists. */}
            {t.header_text && (
              <p className="whitespace-pre-wrap font-bold text-slate-700" dir="auto">
                {t.header_text}
              </p>
            )}
            {t.body_text && (
              <p className={`whitespace-pre-wrap ${t.header_text ? "mt-1.5" : ""}`} dir="auto">
                {t.body_text}
              </p>
            )}
          </div>
        )}

        <Field label="اسم مختصر" hint="الاسم الذي يظهر في شاشات النظام">
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </Field>

        {headerTakesVar && (
          <Field
            label="متغيّر الرأس"
            hint={
              headerVar
                ? "ما يملأ {{1}} في رأس القالب"
                : "رأس هذا القالب يحتوي {{1}} — بدون متغيّر ستصل الرسالة بشرطة مكانه"
            }
          >
            <Select value={headerVar} onChange={setHeaderVar} options={options} />
          </Field>
        )}

        {t.body_params > 0 ? (
          <div>
            <p className="text-sm font-medium text-slate-700">ربط المتغيّرات</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-400">
              القالب يستخدم أرقاماً بدل الأسماء. حدّد ماذا يملأ كل رقم عند الإرسال.
            </p>
            <div className="mt-3 space-y-2.5">
              {keys.map((key, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span
                    className="w-12 shrink-0 rounded-lg bg-slate-100 py-1.5 text-center font-mono text-xs text-slate-500"
                    dir="ltr"
                  >{`{{${i + 1}}}`}</span>
                  <span className="shrink-0 text-slate-300">←</span>
                  <div className="min-w-0 flex-1">
                    <Select
                      value={key}
                      onChange={(v) =>
                        setKeys((list) => list.map((x, j) => (j === i ? v : x)))
                      }
                      options={options}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            هذا القالب لا يحتوي على متغيّرات، فنصه يُرسَل كما هو.
          </p>
        )}

        {t.header_format === "DOCUMENT" && (
          <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            رأس هذا القالب من نوع ملف، والنظام يرفق الملف تلقائياً (كارت الباركود أو ملف التقرير) عند
            الإرسال.
          </p>
        )}

        {t.has_url_button && (
          <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            القالب يحتوي على زر رابط واتساب. الرقم المستخدم فيه يُحدَّد عند ربط القالب بنوع الرسالة،
            وافتراضياً هو الرقم الذي أرسل الرسالة.
          </p>
        )}

        <div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800">متاح لكل الحسابات</div>
              <div className="mt-0.5 text-[11px] leading-4 text-slate-400">
                أغلقه لتحديد الحسابات التي تستطيع استخدام هذا القالب فقط.
              </div>
            </div>
            <Switch checked={sharedAll} onChange={() => setSharedAll((v) => !v)} />
          </div>

          {!sharedAll && (
            <div className="mt-3">
              <Field plain label="الحسابات المسموح لها">
                <MultiSelect
                  value={adminIds}
                  onChange={setAdminIds}
                  options={admins.map((a) => ({ value: a.id, label: a.username }))}
                  placeholder="اختر الحسابات..."
                />
              </Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
