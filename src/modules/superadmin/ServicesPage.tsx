import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Save,
  Plus,
  LogOut,
  CheckCircle2,
  Smartphone,
  MessageCircle,
  QrCode,
  Trash2,
  Search,
  X,
  Wifi,
  WifiOff,
  Link2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { Modal, Field, FormNotice, inputClass, requiredArabic } from "@/components/ui";

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

const SERVICE_TABS = [{ key: "whatsapp", label: "واتساب", icon: MessageCircle }] as const;

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

export function WhatsappService({ apiBase }: { apiBase: string }) {
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
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800">أرقام واتساب</h2>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
        >
          <Plus className="h-5 w-5" />
          إضافة رقم
        </button>
      </div>

      {numbers.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <Smartphone className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="font-semibold text-slate-600">لا توجد أرقام مرتبطة بعد</p>
          <p className="mt-1 text-sm text-slate-400">أضف أول رقم واتساب لبدء إرسال الرسائل من المنصّة.</p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {numbers.map((n) => (
            <NumberCard
              key={n.id}
              apiBase={apiBase}
              number={n}
              numbers={numbers}
              resps={resps}
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
  onLink,
  onChanged,
}: {
  apiBase: string;
  number: WaNumber;
  numbers: WaNumber[];
  resps: Responsibility[];
  onLink: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [picking, setPicking] = useState(false);

  const title = number.label || (number.phone ? `+${number.phone}` : number.instance_id);
  const mine = resps.filter((r) => r.instance_id === number.id);
  const available = resps.filter((r) => r.instance_id === null);
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

  async function assign(code: string, instanceId: string | null) {
    try {
      await api.put(`${apiBase}/responsibilities/${code}`, { instance_id: instanceId });
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تحديث المسؤولية");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${number.connected ? "bg-green-50" : "bg-slate-100"}`}>
            {number.connected ? <Wifi className="h-5 w-5 text-green-600" /> : <WifiOff className="h-5 w-5 text-slate-400" />}
          </div>
          <div>
            <p className="font-bold text-slate-800" dir="auto">{title}</p>
            <p className="text-xs text-slate-400" dir="ltr">Instance {number.instance_id}</p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            number.connected ? "bg-green-50 text-green-700" : "bg-rose-50 text-rose-600"
          }`}
        >
          {number.connected ? "متصل" : "غير متصل"}
        </span>
      </div>

      {/* Connection actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
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
        <button
          onClick={() => setConfirmRemove(true)}
          disabled={busy}
          className="mr-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          إزالة
        </button>
      </div>

      {/* Responsibilities */}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">المسؤوليات</p>
          <button
            onClick={() => setPicking((p) => !p)}
            className="flex items-center gap-1 text-xs font-medium text-accent transition hover:text-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            إضافة مسؤولية
          </button>
        </div>

        {mine.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">لا مسؤوليات مُسندة لهذا الرقم.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mine.map((r) => (
              <span key={r.code} className="flex items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-xs text-accent" title={r.description}>
                {r.label}
                <button onClick={() => assign(r.code, null)} className="rounded-full p-0.5 transition hover:bg-accent/20" aria-label="إزالة">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {picking && (
          <ResponsibilityPicker
            available={available}
            onPick={(code) => {
              assign(code, number.id);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
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
    </div>
  );
}

function ResponsibilityPicker({
  available,
  onPick,
  onClose,
}: {
  available: Responsibility[];
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = available.filter(
    (r) => r.label.includes(q) || r.description.includes(q) || r.code.includes(q.toLowerCase()),
  );

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث عن مسؤولية…"
          className="w-full bg-transparent text-sm outline-none"
        />
        <button onClick={onClose} className="rounded p-0.5 text-slate-400 hover:text-slate-600" aria-label="إغلاق">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 max-h-52 overflow-auto">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-400">
            لا توجد مسؤوليات متاحة. كل المسؤوليات إمّا مُسندة لأرقام أخرى أو لا تطابق البحث.
          </p>
        ) : (
          filtered.map((r) => (
            <button
              key={r.code}
              onClick={() => onPick(r.code)}
              className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-right transition hover:bg-white"
            >
              <span className="text-sm font-medium text-slate-700">{r.label}</span>
              <span className="text-xs text-slate-400">{r.description}</span>
            </button>
          ))
        )}
      </div>
    </div>
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!instanceId.trim() || !apiToken.trim()) return setError("أدخل الـ Instance ID والـ API Token");
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
      <form id="add-wa-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm leading-6 text-slate-500">
          أدخل بيانات الـ Instance من Green API. بعد الإضافة ستظهر شاشة رمز QR لمسحه وربط الرقم مباشرةً.
        </p>
        <Field label="اسم الرقم (اختياري)" hint="اسم يساعدك على تمييز الرقم، مثل: الرقم الأساسي">
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Instance ID" hint="مثال: 1101xxxxxx">
          <input value={instanceId} onChange={(e) => setInstanceId(e.target.value)} required {...requiredArabic} dir="ltr" className={inputClass} />
        </Field>
        <Field label="API Token" hint="عشرون حرفًا كما يظهر في لوحة Green API">
          <input value={apiToken} onChange={(e) => setApiToken(e.target.value)} required {...requiredArabic} dir="ltr" className={inputClass} />
        </Field>
        <FormNotice message={error} />
      </form>
    </Modal>
  );
}

function QrModal({
  apiBase,
  number,
  onClose,
  onConnected,
}: {
  apiBase: string;
  number: WaNumber;
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [note, setNote] = useState("جارٍ تجهيز رمز QR…");
  const stop = useRef(false);

  useEffect(() => {
    stop.current = false;
    let qrTimer: ReturnType<typeof setTimeout>;
    let stateTimer: ReturnType<typeof setInterval>;

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
  }, [number.id, onConnected]);

  const title = number.label || number.instance_id;

  return (
    <Modal
      title="ربط رقم واتساب"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
          إغلاق
        </button>
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
          ) : (
            <Loader2 className="h-10 w-10 animate-spin text-slate-300" />
          )}
        </div>
        <p className="max-w-sm text-center text-sm leading-6 text-slate-500">{note}</p>
      </div>
    </Modal>
  );
}
