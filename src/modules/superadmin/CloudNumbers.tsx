import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
} from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { Field, inputClass, Modal, Select } from "@/components/ui";
import { toast } from "@/components/ui/toast";

/** One number on the official (Meta) WhatsApp account. */
interface CloudNum {
  id: string;
  label: string | null;
  owner_admin_id: string | null;
  phone_number_id: string;
  phone: string | null;
  display_name: string | null;
  connected: boolean;
  state: string | null;
  quality_rating: string | null;
  code_verification_status: string | null;
}

const QUALITY_AR: Record<string, string> = {
  GREEN: "جودة ممتازة",
  YELLOW: "جودة متوسطة",
  RED: "جودة منخفضة",
};

/**
 * Provisioning one teacher's number on the OFFICIAL WhatsApp account.
 *
 * <p>The flow is deliberately one-sided: the super admin takes every step from
 * this screen, and the teacher's only part is reading back the verification code
 * Meta sends to their phone. That is why the code and the PIN are inputs here and
 * never anything the teacher sees.
 */
export function AdminCloudNumbers({ adminId }: { adminId: string }) {
  const [nums, setNums] = useState<CloudNum[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);

  function load() {
    return api
      .get<CloudNum[]>("/super/whatsapp/cloud/numbers")
      .then((all) => setNums(all.filter((n) => n.owner_admin_id === adminId)))
      .catch(() => setNums([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId]);

  async function refresh() {
    setRefreshing(true);
    try {
      await api.post("/super/whatsapp/cloud/numbers/refresh", {});
      await load();
      toast.success("تم تحديث حالة الأرقام");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر التحديث");
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Adopts numbers that already live on the Meta account. A number added in
   * WhatsApp Manager cannot be added again from here - Meta rejects it as a
   * duplicate - so importing is the only way to bring it under the app.
   */
  async function importExisting() {
    setImporting(true);
    try {
      const adopted = await api.post<CloudNum[]>(
        `/super/whatsapp/cloud/numbers/import?adminId=${adminId}`,
        {},
      );
      await load();
      toast.success(
        adopted.length === 0 ? "لا توجد أرقام جديدة لاستيرادها" : `تم استيراد ${adopted.length} رقم`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر الاستيراد");
    } finally {
      setImporting(false);
    }
  }

  return (
    // No surface of its own: this is one lane inside the numbers section, and a
    // border here would put a box inside a box.
    <div>
      <div className="flex items-center justify-end gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            title="تحديث الحالة"
            className="rounded-lg border border-slate-300 p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-60"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={importExisting}
            disabled={importing}
            title="استيراد الأرقام الموجودة على حساب Meta"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "استيراد"}
          </button>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            إضافة
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {nums === null ? (
          <p className="text-xs text-slate-400">جارٍ التحميل…</p>
        ) : nums.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-400">لا توجد أرقام لهذا المدرّس.</p>
        ) : (
          nums.map((n) => <CloudNumberRow key={n.id} num={n} onChanged={load} />)
        )}
      </div>

      {adding && (
        <AddCloudNumberModal
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

/**
 * One number, showing only the step it is actually on. A number moves
 * pending → verified → authorized, and each step is a single button, so a form
 * for a step that cannot be taken yet is never on screen.
 */
function CloudNumberRow({ num, onChanged }: { num: CloudNum; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [testing, setTesting] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تنفيذ الخطوة");
    } finally {
      setBusy(false);
    }
  }

  const verified = num.state === "verified" || num.connected;

  return (
    <div className="rounded-xl bg-slate-100 px-3.5 py-2.5 transition hover:bg-slate-200/60">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-800" dir="auto">
            {num.label || num.display_name || "رقم بدون اسم"}
          </div>
          <div className="text-[11px] text-slate-400" dir="ltr">
            {num.phone || num.phone_number_id}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {num.quality_rating && (
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
              {QUALITY_AR[num.quality_rating] || num.quality_rating}
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              num.connected
                ? "bg-green-100 text-green-700"
                : verified
                  ? "bg-amber-100 text-amber-700"
                  : "bg-white text-slate-500"
            }`}
          >
            {num.connected ? "يعمل" : verified ? "بانتظار التفعيل" : "بانتظار التحقق"}
          </span>
          {num.connected && (
            <button
              onClick={() => setTesting(true)}
              className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              إرسال تجريبي
            </button>
          )}
          <button
            onClick={() =>
              run(() => api.del(`/super/whatsapp/cloud/numbers/${num.id}`), "تمت إزالة الرقم")
            }
            disabled={busy}
            title="إزالة"
            className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-100 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!num.connected && (
        <div className="mt-2.5 border-t border-slate-200 pt-2.5">
          {!verified ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() =>
                  run(async () => {
                    await api.post(`/super/whatsapp/cloud/numbers/${num.id}/request-code`, {
                      method: "SMS",
                    });
                    setCodeSent(true);
                  }, "أُرسل الكود إلى الرقم")
                }
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                إرسال الكود برسالة
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    await api.post(`/super/whatsapp/cloud/numbers/${num.id}/request-code`, {
                      method: "VOICE",
                    });
                    setCodeSent(true);
                  }, "سيتصل واتساب بالرقم ليملي الكود")
                }
                disabled={busy}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              >
                بمكالمة بدلاً من رسالة
              </button>
              {codeSent && (
                <div className="flex items-center gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="كود التحقق"
                    dir="ltr"
                    inputMode="numeric"
                    className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-sm"
                  />
                  <button
                    onClick={() =>
                      run(
                        () => api.post(`/super/whatsapp/cloud/numbers/${num.id}/verify`, { code }),
                        "تم تأكيد الرقم",
                      )
                    }
                    disabled={busy || code.length !== 6}
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    تأكيد
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">
                اختر رقماً سرياً من ٦ أرقام لتفعيل الرقم، واحتفظ به — لن تستطيع إعادة تسجيل الرقم
                بدونه.
              </span>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="PIN"
                dir="ltr"
                inputMode="numeric"
                className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-sm"
              />
              <button
                onClick={() =>
                  run(
                    () => api.post(`/super/whatsapp/cloud/numbers/${num.id}/register`, { pin }),
                    "الرقم أصبح جاهزاً للإرسال",
                  )
                }
                disabled={busy || pin.length !== 6}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                تفعيل
              </button>
            </div>
          )}
        </div>
      )}

      {testing && <TestSendModal numberId={num.id} onClose={() => setTesting(false)} />}
    </div>
  );
}

interface ApprovedTemplate {
  name: string;
  language: string;
  body_params: number;
  header_format: string;
  header_text: string | null;
}

/**
 * Sends one approved template from this number, to a number of your choosing.
 *
 * <p>This is the check that matters: the dashboard's own test only proves someone
 * can message the number, while this proves the SYSTEM can start a conversation -
 * which is the thing that needs a valid token, a registered number, an approved
 * template and a paid account all at once.
 */
function TestSendModal({ numberId, onClose }: { numberId: string; onClose: () => void }) {
  const [templates, setTemplates] = useState<ApprovedTemplate[] | null>(null);
  const [picked, setPicked] = useState("");
  const [to, setTo] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [headerParam, setHeaderParam] = useState("");
  const [buttonParam, setButtonParam] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .get<ApprovedTemplate[]>("/super/whatsapp/cloud/templates?approvedOnly=true")
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  // Templates are keyed by name AND language: the same name exists once per
  // language, and a send has to name both.
  const key = (t: ApprovedTemplate) => `${t.name}|${t.language}`;
  const chosen = templates?.find((t) => key(t) === picked) ?? null;

  // A TEXT header with {{1}} is a component of its own: Meta counts its
  // parameters apart from the body's, so a test send that skips it fails on the
  // header before the body is even read.
  const headerTakesVar =
    chosen?.header_format === "TEXT" && /\{\{\s*1\s*}}/.test(chosen.header_text ?? "");

  async function send() {
    if (!chosen) return;
    setSending(true);
    setResult(null);
    try {
      const res = await api.post<{ sent: boolean; message_id: string | null; failure_reason: string | null }>(
        `/super/whatsapp/cloud/numbers/${numberId}/test-send`,
        {
          to: to.trim(),
          template_name: chosen.name,
          language: chosen.language,
          params: params.slice(0, chosen.body_params),
          header_param: headerTakesVar ? headerParam.trim() || "-" : null,
          url_button_param: buttonParam.trim() || null,
        },
      );
      setResult(
        res.sent
          ? { sent: true, text: `تم القبول من واتساب — ${res.message_id ?? ""}` }
          : { sent: false, text: res.failure_reason ?? "فشل الإرسال" },
      );
    } catch (err) {
      setResult({
        sent: false,
        text: err instanceof ApiError ? err.message : "تعذّر الإرسال",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      title="إرسال تجريبي"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            إغلاق
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !chosen || to.trim().length < 8}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            إرسال
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="رقم المستلم" hint="بأي صيغة — 01xxxxxxxxx أو 201xxxxxxxxx">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.replace(/\D/g, "").slice(0, 15))}
            dir="ltr"
            inputMode="numeric"
            className={inputClass}
          />
        </Field>

        <Field label="القالب" hint="القوالب المعتمدة فقط">
          <Select
            value={picked}
            onChange={(v) => {
              setPicked(v);
              setParams([]);
              setHeaderParam("");
              setResult(null);
            }}
            options={(templates ?? []).map((t) => ({
              value: key(t),
              label: `${t.name} · ${t.language}`,
            }))}
            emptyLabel="لا توجد قوالب معتمدة — أنشئها في WhatsApp Manager"
          />
        </Field>

        {chosen && chosen.header_format === "DOCUMENT" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
            هذا القالب رأسه ملف. الإرسال التجريبي يرسل النص فقط بدون الملف، وقد ترفضه واتساب لهذا
            السبب — جرّب قالباً بدون رأس ملف للتأكد من الإعداد.
          </p>
        )}

        {headerTakesVar && (
          <Field label="قيمة الرأس" hint="ما يملأ {{1}} في رأس القالب">
            <input
              value={headerParam}
              onChange={(e) => setHeaderParam(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}

        {chosen && chosen.body_params > 0 && (
          <div className="space-y-2">
            {Array.from({ length: chosen.body_params }, (_, i) => (
              <Field key={i} label={`القيمة ${i + 1}`}>
                <input
                  value={params[i] ?? ""}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  className={inputClass}
                />
              </Field>
            ))}
          </div>
        )}

        {chosen && (
          <Field
            label="رقم زر التواصل (اختياري)"
            hint="للقوالب التي زرّها ديناميكي — الرقم بصيغة 201xxxxxxxxx"
          >
            <input
              value={buttonParam}
              onChange={(e) => setButtonParam(e.target.value.replace(/\D/g, "").slice(0, 15))}
              dir="ltr"
              inputMode="numeric"
              className={inputClass}
            />
          </Field>
        )}

        {result && (
          <p
            className={`rounded-lg px-3 py-2 text-sm leading-6 ${
              result.sent ? "bg-green-50 text-green-700" : "bg-rose-50 text-rose-700"
            }`}
            dir="auto"
          >
            {result.text}
          </p>
        )}
      </div>
    </Modal>
  );
}

function AddCloudNumberModal({
  adminId,
  onClose,
  onAdded,
}: {
  adminId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [countryCode, setCountryCode] = useState("20");
  const [localNumber, setLocalNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!localNumber.trim() || !displayName.trim()) {
      setError("الرقم والاسم الظاهر مطلوبان");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/super/whatsapp/cloud/numbers?adminId=${adminId}`, {
        country_code: countryCode.trim(),
        // Meta wants the national number without its leading zero.
        local_number: localNumber.trim().replace(/^0+/, ""),
        display_name: displayName.trim(),
        label: label.trim() || null,
      });
      toast.success("تمت إضافة الرقم — أرسل كود التحقق الآن");
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
      title="إضافة رقم واتساب"
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
            form="add-cloud-wa-form"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="add-cloud-wa-form" onSubmit={submit} className="space-y-4">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
          يجب أن يكون الرقم غير مسجّل على تطبيق واتساب. إن كان مستخدماً، احذف الحساب من التطبيق
          أولاً وإلا سيُرفض التسجيل.
        </p>
        <div className="grid grid-cols-[5rem_1fr] gap-3">
          <Field label="كود الدولة">
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              dir="ltr"
              className={inputClass}
            />
          </Field>
          <Field label="الرقم" hint="بدون الصفر في البداية">
            <input
              value={localNumber}
              onChange={(e) => setLocalNumber(e.target.value.replace(/\D/g, "").slice(0, 15))}
              dir="ltr"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="الاسم الظاهر للمستلمين" hint="تراجعه Meta، ويظهر للطلاب وأولياء الأمور">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            className={inputClass}
          />
        </Field>
        <Field label="اسم الرقم داخل النظام (اختياري)">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            className={inputClass}
          />
        </Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </form>
    </Modal>
  );
}
