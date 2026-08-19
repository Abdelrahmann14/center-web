import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Save,
  Plus,
  Pencil,
  LogOut,
  CheckCircle2,
  XCircle,
  Smartphone,
  MessageCircle,
  QrCode,
  Trash2,
  Link2,
  Clock,
  RotateCcw,
  ListChecks,
  History,
} from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { Modal, Field, FieldError, FormNotice, inputClass } from "@/components/ui";
import { WhatsappLogo } from "@/components/WhatsappLogo";

interface WaNumber {
  id: string;
  label: string | null;
  connected: boolean;
  state: string | null;
  phone: string | null;
  instance_id: string;
}

interface Responsibility {
  code: string;
  label: string;
  description: string;
  instance_id: string | null;
}

/** One message still waiting to leave the instance (Green API showMessagesQueue). */
interface QueueItem {
  chatId?: string;
  typeMessage?: string;
  textMessage?: string;
  caption?: string;
  body?: string;
  message?: string;
}

/** A sent-message log row (mirror of the "الرسائل" history table). */
interface LogRow {
  id: string;
  recipient_name: string | null;
  phone: string | null;
  body: string;
  status: string;
  created_at: string;
}

const SERVICE_TABS = [{ key: "whatsapp", label: "واتساب", icon: MessageCircle }] as const;

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function ServicesPage({ apiBase = "/super/services/whatsapp" }: { apiBase?: string }) {
  const [tab] = useState<(typeof SERVICE_TABS)[number]["key"]>("whatsapp");

  return (
    <div>
      <div className="mt-5 flex w-fit flex-wrap gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
        {SERVICE_TABS.map((t) => (
          <button
            key={t.key}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t.key ? "bg-dark text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">{tab === "whatsapp" && <WhatsappService apiBase={apiBase} />}</div>
    </div>
  );
}

/**
 * @param managed  the ADMIN's own view: the super admin provisions the numbers,
 *                 so there is no add/remove here and the Green API instance id is
 *                 hidden - the admin only names a number and scans its QR.
 */
export function WhatsappService({ apiBase, managed = false }: { apiBase: string; managed?: boolean }) {
  const [numbers, setNumbers] = useState<WaNumber[] | null>(null);
  const [resps, setResps] = useState<Responsibility[]>([]);
  const [adding, setAdding] = useState(false);
  const [linkId, setLinkId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nums, rs] = await Promise.all([
      api.get<WaNumber[]>(apiBase).catch(() => [] as WaNumber[]),
      api.get<Responsibility[]>(`${apiBase}/responsibilities`).catch(() => [] as Responsibility[]),
    ]);
    setNumbers(nums);
    setResps(rs);
    return nums;
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  if (!numbers) return <LoaderBlock />;

  const linkingNumber = numbers.find((n) => n.id === linkId) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <WhatsappLogo className="h-6 w-6" />
          </span>
          <h2 className="text-lg font-bold text-slate-800">أرقام واتساب</h2>
        </div>
        {/* The admin cannot add numbers - the super admin provisions them. */}
        {!managed && (
          <button
            onClick={() => setAdding(true)}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
          >
            <Plus className="h-5 w-5" />
            إضافة رقم
          </button>
        )}
      </div>

      {numbers.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <Smartphone className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="font-semibold text-slate-600">لا توجد أرقام مرتبطة بعد</p>
          <p className="mt-1 text-sm text-slate-400">
            {managed
              ? "لم تُضِف الإدارة أي رقم لحسابك بعد. تواصل معها لإضافة رقم واتساب."
              : "أضف أول رقم واتساب لبدء إرسال الرسائل من المنصّة."}
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {numbers.map((n) => (
            <NumberCard
              key={n.id}
              apiBase={apiBase}
              number={n}
              numbers={numbers}
              resps={resps}
              managed={managed}
              onLink={() => setLinkId(n.id)}
              onChanged={load}
            />
          ))}
        </div>
      )}

      {adding && (
        <AddNumberModal
          apiBase={apiBase}
          onClose={() => setAdding(false)}
          onAdded={async (created) => {
            setAdding(false);
            await load();
            setLinkId(created.id); // jump straight to the QR to link it
          }}
        />
      )}

      {linkingNumber && (
        <QrModal
          apiBase={apiBase}
          number={linkingNumber}
          managed={managed}
          onClose={() => setLinkId(null)}
          onConnected={async () => {
            await load();
            setLinkId(null);
            toast.success("تم ربط الرقم بنجاح");
          }}
        />
      )}
    </div>
  );
}

function NumberCard({
  apiBase,
  number,
  numbers,
  resps,
  managed = false,
  onLink,
  onChanged,
}: {
  apiBase: string;
  number: WaNumber;
  numbers: WaNumber[];
  resps: Responsibility[];
  managed?: boolean;
  onLink: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);

  // Send delay (Green API account setting, per number). Loaded lazily from the
  // instance so it reflects whatever is actually in force.
  const [delay, setDelay] = useState<number | null>(null);
  const [delayInput, setDelayInput] = useState("");
  const [delayReady, setDelayReady] = useState(false);
  const [savingDelay, setSavingDelay] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ delay_seconds: number }>(`${apiBase}/${number.id}/delay`)
      .then((r) => {
        if (!alive) return;
        setDelay(r.delay_seconds);
        setDelayInput(String(r.delay_seconds));
      })
      // The read can fail while Green API reboots the instance; leave the field
      // editable (not stuck) so a value can still be typed and saved by hand.
      .catch(() => {})
      .finally(() => alive && setDelayReady(true));
    return () => {
      alive = false;
    };
  }, [apiBase, number.id]);

  async function saveDelay() {
    const seconds = Number(delayInput);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
      toast.error("أدخل مدة بين ثانية واحدة و600 ثانية");
      return;
    }
    setSavingDelay(true);
    try {
      const r = await api.put<{ delay_seconds: number }>(`${apiBase}/${number.id}/delay`, {
        delay_seconds: seconds,
      });
      setDelay(r.delay_seconds);
      setDelayInput(String(r.delay_seconds));
      toast.success("تم حفظ مدة التأخير");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حفظ التأخير");
    } finally {
      setSavingDelay(false);
    }
  }
  const delaySeconds = Number(delayInput);
  const delayValid = Number.isInteger(delaySeconds) && delaySeconds >= 1 && delaySeconds <= 600;
  const delayDirty = delayInput !== "" && delaySeconds !== delay;

  // Outgoing queue (Green API showMessagesQueue), loaded on mount, refreshable.
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      setQueue(await api.get<QueueItem[]>(`${apiBase}/${number.id}/queue`));
    } catch {
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, [apiBase, number.id]);
  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // Recent messages the system actually sent (the shared "الرسائل" log). Failing
  // to load it (e.g. no permission) just leaves the section empty.
  const [sent, setSent] = useState<LogRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<{ content: LogRow[] }>("/messaging/whatsapp/log?size=8&sort=createdAt,desc")
      .then((r) => alive && setSent(r.content ?? []))
      .catch(() => alive && setSent([]));
    return () => {
      alive = false;
    };
  }, []);

  // Never the phone: it already shows next to the "فصل" button when connected,
  // so putting it here too just printed the same number twice.
  const title = number.label || "رقم واتساب";
  const mine = resps.filter((r) => r.instance_id === number.id);
  const otherConnected = numbers.filter((n) => n.id !== number.id && n.connected).length;

  async function logout() {
    setBusy(true);
    try {
      await api.post(`${apiBase}/${number.id}/logout`);
      toast.success("تم فصل الرقم");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر فصل الرقم");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.del(`${apiBase}/${number.id}`);
      toast.success("تمت إزالة الرقم");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر إزالة الرقم");
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  }

  async function rename(label: string) {
    await api.put(`${apiBase}/${number.id}/label`, { label: label.trim() || null });
    await onChanged();
    setRenaming(false);
    toast.success("تم حفظ الاسم");
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${number.connected ? "bg-green-50" : "bg-slate-100"}`}>
            <WhatsappLogo className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-bold text-slate-800" dir="auto">{title}</p>
              {/* Naming a number is how you tell several apart, so it is always
                  available - the admin renames, the super admin adjusts. */}
              <button
                onClick={() => setRenaming(true)}
                title="إعادة تسمية"
                className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* The Green API instance id is an implementation detail the admin
                does not need (and should not manage), so it is hidden there. */}
            {!managed && (
              <p className="text-xs text-slate-400" dir="ltr">Instance {number.instance_id}</p>
            )}
          </div>
        </div>
        {/* Removing a number is provisioning - the super admin's job, not the
            admin's (who only links and renames). */}
        {!managed && (
          <button
            onClick={() => setConfirmRemove(true)}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            إزالة
          </button>
        )}
      </div>

      {/* Connection actions - separated from the header by a light divider. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        {number.connected ? (
          <>
            {number.phone && (
              <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-600" dir="ltr">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                +{number.phone}
              </span>
            )}
            <button
              onClick={logout}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              فصل
            </button>
          </>
        ) : (
          <button
            onClick={onLink}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
          >
            <QrCode className="h-4 w-4" />
            ربط الرقم (مسح QR)
          </button>
        )}
      </div>

      {/* Send delay + outgoing queue, side by side on wide screens. */}
      <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
        {/* Send delay - the pause Green API leaves between outgoing messages. */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Clock className="h-4 w-4 text-slate-400" />
            التأخير بين الرسائل
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            المدة التي ينتظرها Green API بين كل رسالة والتالية. يعيد تشغيل الرقم عند الحفظ وتسري خلال
            دقائق.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={600}
              inputMode="numeric"
              value={delayInput}
              onChange={(e) => setDelayInput(e.target.value)}
              disabled={!delayReady}
              placeholder="—"
              className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            />
            <span className="text-sm text-slate-500">ثانية</span>
            <button
              type="button"
              onClick={saveDelay}
              disabled={savingDelay || !delayReady || !delayValid || !delayDirty}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              {savingDelay ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              حفظ
            </button>
          </div>
        </div>

        {/* Outgoing queue (what is still waiting to be sent on Green API). */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <ListChecks className="h-4 w-4 text-slate-400" />
              طابور الإرسال
              {queue && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {queue.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={loadQueue}
              disabled={queueLoading}
              title="تحديث"
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-60"
            >
              <RotateCcw className={`h-4 w-4 ${queueLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            عدد الرسائل التي ما زالت تنتظر الإرسال من هذا الرقم على Green API. نص كل
            رسالة موجود في سجل «الرسائل».
          </p>
          <div className="mt-2">
            {queue === null ? (
              <p className="text-xs text-slate-400">جارٍ التحميل…</p>
            ) : (
              <p className="text-sm text-slate-600">
                <span className="text-2xl font-bold text-slate-800">{queue.length}</span>{" "}
                رسالة في انتظار الإرسال
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Recent messages the system actually sent out. */}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <History className="h-4 w-4 text-slate-400" />
          آخر الرسائل الصادرة من النظام
        </div>
        <div className="mt-2 space-y-1.5">
          {sent === null ? (
            <p className="text-xs text-slate-400">جارٍ التحميل…</p>
          ) : sent.length === 0 ? (
            <p className="text-xs text-slate-400">لا توجد رسائل صادرة بعد.</p>
          ) : (
            sent.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2"
              >
                {m.status === "SENT" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-700" dir="auto">
                      {m.recipient_name || m.phone || "—"}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">{fmtWhen(m.created_at)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500" dir="auto" title={m.body}>
                    {m.body}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {confirmRemove && (
        <Modal
          title="إزالة الرقم"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded-xl bg-rose-600 px-5 py-2.5 font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {busy ? "جارٍ الإزالة…" : "إزالة الرقم"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm leading-6 text-slate-600">
            <p>
              سيتم إزالة الرقم (<span className="font-semibold text-slate-800" dir="auto">{title}</span>) من المنصّة.
            </p>
            {mine.length > 0 && otherConnected > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700">
                سيتم تحويل {mine.length} من مسؤولياته تلقائيًا إلى رقم آخر متصل.
              </p>
            )}
            {otherConnected === 0 && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">
                لا يوجد رقم احتياطي متصل. بعد الإزالة لن تُرسَل رسائل واتساب، وسيكتفي النظام بإشعارات
                التطبيق فقط حتى يتم ربط رقم آخر.
              </p>
            )}
          </div>
        </Modal>
      )}

      {renaming && (
        <RenameModal
          current={number.label}
          onClose={() => setRenaming(false)}
          onSave={rename}
        />
      )}
    </div>
  );
}

function RenameModal({
  current,
  onClose,
  onSave,
}: {
  current: string | null;
  onClose: () => void;
  onSave: (label: string) => Promise<void>;
}) {
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(value);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حفظ الاسم");
      setSaving(false);
    }
  }

  return (
    <Modal
      title="اسم الرقم"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
            إلغاء
          </button>
          <button type="submit" form="rename-wa-form" disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="rename-wa-form" onSubmit={submit} className="space-y-3">
        <p className="text-sm leading-6 text-slate-500">
          اسم يساعدك على تمييز الرقم عن غيره، مثل: الرقم الأساسي، رقم الحجز.
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          autoFocus
          placeholder="اسم الرقم"
          className={inputClass}
        />
      </form>
    </Modal>
  );
}

function AddNumberModal({
  apiBase,
  onClose,
  onAdded,
}: {
  apiBase: string;
  onClose: () => void;
  onAdded: (created: WaNumber) => void;
}) {
  const [instanceId, setInstanceId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [label, setLabel] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const instanceErr = attempted && !instanceId.trim() ? "مطلوب" : null;
  const tokenErr = attempted && !apiToken.trim() ? "مطلوب" : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAttempted(true);
    if (!instanceId.trim() || !apiToken.trim()) return;
    setSaving(true);
    try {
      const created = await api.post<WaNumber>(apiBase, {
        instance_id: instanceId.trim(),
        api_token: apiToken.trim(),
        label: label.trim() || null,
      });
      toast.success("تمت إضافة الرقم");
      onAdded(created);
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
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
            إلغاء
          </button>
          <button type="submit" form="add-wa-form" disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            إضافة ومتابعة الربط
          </button>
        </>
      }
    >
      <form id="add-wa-form" onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm leading-6 text-slate-500">
          أدخل بيانات الـ Instance من Green API. بعد الإضافة ستظهر شاشة رمز QR لمسحه وربط الرقم مباشرةً.
        </p>
        <Field label="اسم الرقم (اختياري)" hint="اسم يساعدك على تمييز الرقم، مثل: الرقم الأساسي">
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Instance ID" hint="مثال: 1101xxxxxx">
          <div className="relative">
            <FieldError message={instanceErr} />
            <input value={instanceId} onChange={(e) => setInstanceId(e.target.value)} dir="ltr" className={inputClass} />
          </div>
        </Field>
        <Field label="API Token" hint="عشرون حرفًا كما يظهر في لوحة Green API">
          <div className="relative">
            <FieldError message={tokenErr} />
            <input value={apiToken} onChange={(e) => setApiToken(e.target.value)} dir="ltr" className={inputClass} />
          </div>
        </Field>
        <FormNotice message={error} />
      </form>
    </Modal>
  );
}

function QrModal({
  apiBase,
  number,
  managed = false,
  onClose,
  onConnected,
}: {
  apiBase: string;
  number: WaNumber;
  managed?: boolean;
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [note, setNote] = useState("جارٍ تجهيز رمز QR…");
  const [expired, setExpired] = useState(false);
  // Bumping this restarts the effect below, which is how "حاول مرة أخرى" works.
  const [attempt, setAttempt] = useState(0);
  const stop = useRef(false);

  useEffect(() => {
    stop.current = false;
    setExpired(false);
    let qrTimer: ReturnType<typeof setTimeout>;
    let stateTimer: ReturnType<typeof setInterval>;
    // Both loops below poll indefinitely, and BOTH reach Green API through the
    // server: one QR fetch a second plus a number-state read every three
    // seconds. A modal left open on a forgotten tab was therefore an
    // open-ended request generator - thousands of third-party calls an hour for
    // a scan that either happens in the first minute or does not happen. Linking
    // is an attended action, so the session gets a deadline and a retry.
    const deadline = Date.now() + 3 * 60 * 1000;

    function expire() {
      stop.current = true;
      clearTimeout(qrTimer);
      clearInterval(stateTimer);
      setQr(null);
      setExpired(true);
      setNote("انتهت مهلة الربط. اضغط «حاول مرة أخرى» لطلب رمز جديد.");
    }

    async function finish() {
      if (stop.current) return;
      stop.current = true;
      clearTimeout(qrTimer);
      clearInterval(stateTimer);
      await onConnected();
    }

    // Green API refreshes the QR ~every 20s; poll once a second so it stays live.
    async function pollQr() {
      if (stop.current) return;
      if (Date.now() > deadline) {
        expire();
        return;
      }
      try {
        const res = await api.get<{ type: string; message: string }>(`${apiBase}/${number.id}/qr`);
        if (stop.current) return;
        if (res.type === "qrCode") {
          setQr(`data:image/png;base64,${res.message}`);
          setNote("افتح واتساب على هاتفك ← الإعدادات ← الأجهزة المرتبطة ← ربط جهاز، ثم امسح الرمز.");
        } else if (res.type === "alreadyLogged") {
          await finish();
          return;
        } else {
          setNote(res.message || "تعذّر جلب الرمز، جارٍ إعادة المحاولة…");
        }
      } catch {
        setNote("تعذّر الاتصال بالخدمة، جارٍ إعادة المحاولة…");
      }
      qrTimer = setTimeout(pollQr, 1000);
    }

    async function pollState() {
      if (stop.current) return;
      try {
        const list = await api.get<WaNumber[]>(apiBase);
        const me = list.find((n) => n.id === number.id);
        if (me?.connected) await finish();
      } catch {
        /* transient */
      }
    }

    pollQr();
    stateTimer = setInterval(pollState, 3000);
    return () => {
      stop.current = true;
      clearTimeout(qrTimer);
      clearInterval(stateTimer);
    };
  }, [apiBase, number.id, onConnected, attempt]);

  const title = number.label || (managed ? "رقم واتساب" : number.instance_id);

  return (
    <Modal
      title="ربط رقم واتساب"
      onClose={onClose}
      footer={
        <>
          {expired && (
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-xl bg-slate-900 px-4 py-2.5 font-medium text-white transition hover:bg-slate-800">
              حاول مرة أخرى
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
            إغلاق
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <p className="flex items-center gap-1.5 text-sm text-slate-500" dir="auto">
          <Link2 className="h-4 w-4" />
          {title}
        </p>
        <div className="flex h-64 w-64 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50">
          {qr ? (
            <img src={qr} alt="رمز QR" className="h-60 w-60 rounded-lg" />
          ) : expired ? (
            <QrCode className="h-10 w-10 text-slate-300" />
          ) : (
            <Loader2 className="h-10 w-10 animate-spin text-slate-300" />
          )}
        </div>
        <p className="max-w-sm text-center text-sm leading-6 text-slate-500">{note}</p>
      </div>
    </Modal>
  );
}
