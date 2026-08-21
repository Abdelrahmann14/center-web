import { useCallback, useEffect, useState } from "react";
import { Info, Loader2 } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Select, inputClass } from "@/components/ui";
import type { CloudTemplate } from "./CloudTemplates";

interface TypeTemplate {
  code: string;
  label: string;
  template_id: string | null;
  template_name: string | null;
  template_status: string | null;
  url_button_value: string | null;
  /** True when it comes from the platform's own mapping rather than this account's. */
  inherited: boolean;
}

/**
 * Which approved template carries each kind of message on the official account.
 *
 * <p>Only official numbers need this. A Green number sends the message text as
 * the teacher wrote it; Meta will not let a business start a conversation with
 * anything but a template it has reviewed, so every message type that might go
 * out on an official number needs one named here or it cannot be sent at all.
 *
 * <p>Set once for the platform and every teacher inherits it - one approved
 * template written once serves all of them. A teacher who needs different wording
 * gets a row of their own that shadows it, and the screen says which of the two
 * is in force rather than showing an ambiguous blank.
 *
 * @param adminId the teacher this mapping belongs to, or null for the platform's
 */
export function useTypeTemplates(adminId?: string | null) {
  const [rows, setRows] = useState<TypeTemplate[] | null>(null);
  const [templates, setTemplates] = useState<CloudTemplate[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const query = adminId ? `?adminId=${adminId}` : "";

  const load = useCallback(() => {
    api
      .get<TypeTemplate[]>(`/super/whatsapp/cloud/message-types${query}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [query]);

  useEffect(() => {
    load();
    api
      .get<CloudTemplate[]>("/super/whatsapp/cloud/templates?approvedOnly=true")
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [load]);

  const assign = useCallback(
    async (code: string, templateId: string | null, urlButtonValue: string | null) => {
      setSaving(code);
      try {
        setRows(
          await api.put<TypeTemplate[]>(`/super/whatsapp/cloud/message-types/${code}${query}`, {
            template_id: templateId,
            url_button_value: urlButtonValue,
          }),
        );
        toast.success("تم الحفظ");
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "تعذّر الحفظ");
      } finally {
        setSaving(null);
      }
    },
    [query],
  );

  const options = [
    { value: "", label: adminId ? "— قالب المنصة —" : "— بدون قالب —" },
    ...templates.map((t) => ({
      value: t.id,
      label: `${t.label || t.name}${t.header_format === "DOCUMENT" ? " (يحمل ملف)" : ""}`,
    })),
  ];

  return { rows, templates, options, assign, saving, scoped: !!adminId };
}

type TypeTemplates = ReturnType<typeof useTypeTemplates>;

/**
 * The template picker for one message type.
 *
 * <p>Built to be dropped into the row that already picks the NUMBER for that
 * type, because the two are one decision made twice: a type sent from an
 * official number without a template is not sent at all. Listing the types twice
 * on one screen - once to choose a number, once to choose a template - is what
 * made the old screen unreadable.
 */
export function TypeTemplatePicker({
  code,
  state,
}: {
  code: string;
  state: TypeTemplates;
}) {
  const row = state.rows?.find((r) => r.code === code);
  const busy = state.saving === code;

  // An inherited row's select shows the platform's choice but stores nothing of
  // its own, so picking the SAME template here has to be possible - it is how a
  // teacher pins the current wording before the platform changes it under them.
  const value = !row || row.inherited ? "" : (row.template_id ?? "");
  const chosen = state.templates.find((t) => t.id === row?.template_id);

  const [button, setButton] = useState(row?.url_button_value ?? "");
  useEffect(() => setButton(row?.url_button_value ?? ""), [row?.url_button_value]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
        <div className="min-w-0 flex-1">
          <Select
            value={value}
            onChange={(v) => state.assign(code, v || null, button.trim() || null)}
            options={state.options}
            disabled={busy}
            emptyLabel="لا توجد قوالب معتمدة"
          />
        </div>
      </div>

      {/* Only templates that carry a contact button have anywhere to put a
          number, so the box appears with the button and not before it. */}
      {chosen?.has_url_button && (
        <input
          value={button}
          onChange={(e) => setButton(e.target.value)}
          onBlur={() => {
            const next = button.trim() || null;
            if (row?.template_id && !row.inherited && next !== row.url_button_value) {
              state.assign(code, row.template_id, next);
            }
          }}
          dir="ltr"
          placeholder="رقم زر التواصل"
          className={`${inputClass} py-2 text-sm`}
        />
      )}

      {row?.inherited && row.template_name && (
        <p className="text-[11px] text-slate-400">
          قالب المنصة: <span dir="ltr">{row.template_name}</span>
        </p>
      )}
      {row?.template_status && row.template_status !== "APPROVED" && (
        <p className="text-[11px] font-medium text-rose-600">
          القالب لم يعُد معتمداً — لن تُرسَل هذه الرسائل من رقم رسمي.
        </p>
      )}
    </div>
  );
}

/**
 * The platform's own type-to-template mapping, as a screen of its own.
 *
 * <p>Used where there is no list of message types to hang the pickers off - the
 * platform WhatsApp page. On a teacher's page the picker rides inside the row
 * that chooses the number instead, so the types are listed once.
 */
export function MessageTypeTemplates({ adminId }: { adminId?: string | null }) {
  const state = useTypeTemplates(adminId);

  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-bold text-slate-800">قالب كل نوع رسالة</h3>
      <p className="mt-0.5 text-xs leading-5 text-slate-400">
        يُستخدم عند الإرسال من رقم رسمي فقط. الأرقام غير الرسمية ترسل نص الرسالة كما هو. كل مدرّس
        يرث هذه القوالب ما لم يُعطَ قالباً خاصاً من صفحته.
      </p>

      {state.rows !== null && state.templates.length === 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          لا توجد قوالب معتمدة بعد. أضِف القوالب وحدّث حالتها أولاً.
        </div>
      )}

      <div className="mt-4 space-y-2">
        {state.rows === null ? (
          <p className="text-xs text-slate-400">جارٍ التحميل…</p>
        ) : (
          state.rows.map((r) => (
            <div
              key={r.code}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-100 px-3.5 py-3 transition hover:bg-slate-200/60"
            >
              <span className="font-semibold text-slate-800">{r.label}</span>
              <div className="w-full sm:w-72">
                <TypeTemplatePicker code={r.code} state={state} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
