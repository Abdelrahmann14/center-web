import { useCallback, useEffect, useState } from "react";
import {
  Award,
  Barcode,
  CalendarX2,
  ClipboardCheck,
  FileChartColumn,
  Info,
  Loader2,
  Megaphone,
  TriangleAlert,
} from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { Select } from "@/components/ui";
import { refreshWhatsapp } from "@/lib/useWhatsappAvailability";

interface WaNumber {
  id: string;
  label: string | null;
  connected: boolean;
  phone: string | null;
  display_name: string | null;
}

interface MessageType {
  code: string;
  label: string;
  description: string;
  carries_file: boolean;
  instance_id: string | null;
  effective_instance_id: string | null;
  number_label: string | null;
  template_id: string | null;
  template_name: string | null;
  ready: boolean;
  blocked_reason: string | null;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  attendance: ClipboardCheck,
  absence: CalendarX2,
  exam_result: Award,
  report: FileChartColumn,
  barcode: Barcode,
  broadcast: Megaphone,
};

function numberName(n: WaNumber): string {
  if (n.label && n.label.trim()) return n.label;
  if (n.display_name && n.display_name.trim()) return n.display_name;
  if (n.phone) return `+${n.phone}`;
  return "رقم واتساب";
}

/**
 * Which number is responsible for each kind of message.
 *
 * <p>The whole point of the screen is one sentence a teacher can act on: "رسالة
 * الحضور تخرج من الرقم ده". A message type belongs to exactly one number - the
 * database key enforces it, so choosing a different number MOVES the type rather
 * than adding a second owner - and the row says plainly what will happen if
 * nothing is chosen, because a type left alone still sends through whatever is
 * connected instead of quietly doing nothing.
 *
 * @param apiBase "/services/whatsapp" for a teacher, the super-admin path otherwise
 * @param flat drops the card so this can sit inside one without nesting surfaces
 * @param renderTemplate slot for the official template picker, drawn inside the
 *                       row it belongs to. Choosing a number and choosing the
 *                       template it sends is one decision about one message
 *                       type; splitting them across two lists of the same types
 *                       is what made the old screen unreadable.
 */
export function WhatsappMessageTypes({
  apiBase,
  templatesPath,
  flat = false,
  renderTemplate,
}: {
  apiBase: string;
  /** When set, the approved templates this account may use are listed below. */
  templatesPath?: string;
  flat?: boolean;
  renderTemplate?: (code: string) => React.ReactNode;
}) {
  const [types, setTypes] = useState<MessageType[] | null>(null);
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ts, ns] = await Promise.all([
      api.get<MessageType[]>(`${apiBase}/responsibilities`).catch(() => [] as MessageType[]),
      api.get<WaNumber[]>(apiBase).catch(() => [] as WaNumber[]),
    ]);
    setTypes(ts);
    setNumbers(ns);
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(code: string, instanceId: string | null) {
    setSaving(code);
    try {
      const fresh = await api.put<MessageType[]>(`${apiBase}/responsibilities/${code}`, {
        instance_id: instanceId,
      });
      setTypes(fresh);
      // Every send button in the app reads availability; it just changed.
      refreshWhatsapp();
      toast.success("تم الحفظ");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر الحفظ");
    } finally {
      setSaving(null);
    }
  }

  if (!types) return <LoaderBlock />;

  const connected = numbers.filter((n) => n.connected);

  return (
    // Embedded, the section around it already draws the surface; on its own it
    // has to draw its own.
    <div className={flat ? "" : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"}>
      {!flat && (
        <>
          <h3 className="font-bold text-slate-800">أنواع الرسائل والأرقام المسؤولة عنها</h3>
          <p className="mt-0.5 text-sm leading-6 text-slate-500">
            اختر الرقم الذي يرسل كل نوع. النوع الواحد يخرج من رقم واحد فقط، ولو غيّرت الرقم ينتقل
            النوع كله إليه.
          </p>
        </>
      )}

      {connected.length === 0 ? (
        <div
          className={`flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700 ${
            flat ? "mb-4" : "mt-4"
          }`}
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          لا يوجد رقم واتساب يعمل. باقي النظام يعمل بشكل طبيعي، لكن أزرار الإرسال عبر واتساب ستكون
          غير متاحة حتى يتم تفعيل رقم.
        </div>
      ) : connected.length === 1 && !flat ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          يوجد رقم واحد يعمل ({numberName(connected[0])})، فكل الرسائل تخرج منه تلقائياً. عند تفعيل
          رقم ثانٍ ستتمكن من توزيع الأنواع بينهما.
        </div>
      ) : null}

      <div className={flat ? "space-y-2.5" : "mt-4 space-y-2.5"}>
        {types.map((t) => (
          <TypeRow
            key={t.code}
            type={t}
            numbers={connected}
            busy={saving === t.code}
            single={connected.length === 1}
            dense={flat}
            templateSlot={renderTemplate?.(t.code)}
            onAssign={(id) => assign(t.code, id)}
          />
        ))}
      </div>

      {templatesPath && <AvailableTemplates path={templatesPath} />}
    </div>
  );
}

interface AvailableTemplate {
  id: string;
  name: string;
  label: string | null;
  language: string;
  body_text: string | null;
  header_format: string;
}

/**
 * The approved templates this account has been given.
 *
 * <p>Read-only, and shown only because the alternative is worse: the message a
 * parent receives is the template's text, not the text on the الرسائل page, and
 * a teacher who cannot see the template has no way to know what was actually
 * sent in their name.
 */
function AvailableTemplates({ path }: { path: string }) {
  const [rows, setRows] = useState<AvailableTemplate[] | null>(null);

  useEffect(() => {
    api
      .get<AvailableTemplate[]>(path)
      .then(setRows)
      .catch(() => setRows([]));
  }, [path]);

  if (rows === null || rows.length === 0) return null;

  return (
    <div className="mt-6 border-t border-slate-100 pt-4">
      <h4 className="text-sm font-semibold text-slate-700">القوالب المتاحة لحسابك</h4>
      <p className="mt-0.5 text-xs leading-5 text-slate-400">
        هذا هو النص الذي يصل فعلياً إلى ولي الأمر. تُكتب وتُعتمَد من الإدارة.
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((t) => (
          <div key={t.id} className="rounded-xl bg-slate-100 px-3.5 py-2.5 transition hover:bg-slate-200/60">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-slate-800" dir="auto">
                {t.label || t.name}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500" dir="ltr">
                {t.language}
              </span>
              {t.header_format === "DOCUMENT" && (
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                  يحمل ملف
                </span>
              )}
            </div>
            {t.body_text && (
              <p
                className="mt-1.5 whitespace-pre-wrap rounded-lg bg-slate-50 px-2.5 py-2 text-xs leading-6 text-slate-600"
                dir="auto"
              >
                {t.body_text}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TypeRow({
  type,
  numbers,
  busy,
  single,
  dense,
  templateSlot,
  onAssign,
}: {
  type: MessageType;
  numbers: WaNumber[];
  busy: boolean;
  single: boolean;
  /** Console view: the operator knows what رسالة الحضور is, so drop the prose. */
  dense?: boolean;
  templateSlot?: React.ReactNode;
  onAssign: (instanceId: string | null) => void;
}) {
  const Icon = ICONS[type.code] ?? Megaphone;
  const options = [
    { value: "", label: single ? "تلقائي (الرقم الوحيد)" : "تلقائي (أول رقم يعمل)" },
    ...numbers.map((n) => ({ value: n.id, label: numberName(n) })),
  ];

  return (
    <div
      className={`rounded-xl p-3.5 transition ${
        type.ready ? "bg-slate-100 hover:bg-slate-200/60" : "bg-amber-50 hover:bg-amber-100/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              type.ready ? "bg-white text-slate-500" : "bg-amber-100 text-amber-600"
            }`}
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-slate-800">{type.label}</span>
              {type.carries_file && (
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                  يحمل ملف
                </span>
              )}
            </div>
            {!dense && (
              <p className="mt-0.5 text-xs leading-5 text-slate-500">{type.description}</p>
            )}
          </div>
        </div>

        {/* Both decisions, labelled, side by side: an unlabelled pair of
            dropdowns is unreadable the moment there are two of them. */}
        <div
          className={`grid w-full shrink-0 gap-3 ${
            templateSlot ? "sm:w-[34rem] sm:grid-cols-2" : "sm:w-64"
          }`}
        >
          <Control label="الرقم المسؤول">
            <div className="flex items-center gap-2">
              {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
              <div className="min-w-0 flex-1">
                <Select
                  value={type.instance_id ?? ""}
                  onChange={(v) => onAssign(v || null)}
                  options={options}
                  disabled={busy || numbers.length === 0}
                  emptyLabel="لا توجد أرقام تعمل"
                />
              </div>
            </div>
          </Control>
          {templateSlot && <Control label="القالب الرسمي">{templateSlot}</Control>}
        </div>
      </div>

      {/* What will actually happen, in one line - the choice above is only half
          the story when nothing was chosen or the official number lacks a template. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200/70 pt-2.5 text-xs">
        {type.ready ? (
          <span className="text-slate-500">
            تُرسَل من:{" "}
            <span className="font-medium text-slate-700" dir="auto">
              {type.number_label}
            </span>
            {!type.instance_id && <span className="text-slate-400"> (تلقائي)</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-amber-700">
            <TriangleAlert className="h-3.5 w-3.5" />
            {type.blocked_reason}
          </span>
        )}
        {!templateSlot && type.template_name && (
          <span className="text-slate-400">
            القالب: <span dir="ltr">{type.template_name}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** A control with its name above it, so a row of two reads as two questions. */
function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium text-slate-500">{label}</div>
      {children}
    </div>
  );
}
