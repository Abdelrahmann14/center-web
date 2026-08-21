import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Loader2,
  Send,
  UserPlus,
  Users,
} from "@/components/icons";
import { api } from "@/lib/api";
import { LoaderBlock } from "@/components/PencilLoader";
import { WhatsappLogo } from "@/components/WhatsappLogo";

function numberName(n: WaNumber): string {
  if (n.label && n.label.trim()) return n.label;
  if (n.display_name && n.display_name.trim()) return n.display_name;
  if (n.phone) return `+${n.phone}`;
  return "رقم واتساب";
}

interface WaNumber {
  id: string;
  label: string | null;
  display_name: string | null;
  phone: string | null;
  connected: boolean;
}

interface CategoryCost {
  category: string;
  sent: number;
  rate: number;
  cost: number;
}

interface NumberUsage {
  instance_id: string | null;
  label: string;
  phone: string | null;
  connected: boolean;
  quality_rating: string | null;
  attempted: number;
  sent: number;
}

interface DayVolume {
  day: string;
  attempted: number;
  sent: number;
}

interface TypeVolume {
  code: string;
  label: string;
  attempted: number;
  sent: number;
}

interface Usage {
  month: string;
  attempted: number;
  sent: number;
  failed: number;
  recipients: number;
  new_contacts: number;
  estimated_cost: number;
  cost_by_category: CategoryCost[];
  numbers: NumberUsage[];
  daily: DayVolume[];
  by_type: TypeVolume[];
}

const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const num = (n: number) => n.toLocaleString("ar-EG");

/**
 * Dollars, at the precision the figure actually has.
 *
 * <p>Two decimals is the right shape for an invoice and the wrong one for this
 * page. A utility message to Egypt costs $0.0036, so three of them rendered
 * "$0.01" - rounded UP, and indistinguishable from one message, from two, or
 * from anything else under a cent. Amounts below a dollar therefore keep four
 * decimals, which is the precision Meta quotes its own rates at; a real month's
 * bill is over a dollar and reads normally.
 */
const usd = (n: number) => {
  const v = n ?? 0;
  return `$${v !== 0 && Math.abs(v) < 1 ? v.toFixed(4) : v.toFixed(2)}`;
};

/** "2026-08" → "أغسطس ٢٠٢٦". */
function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const index = Number(m) - 1;
  return `${AR_MONTHS[index] ?? m} ${Number(y).toLocaleString("ar-EG", { useGrouping: false })}`;
}

/** The current month as YYYY-MM, in the timezone the backend reports in. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The WhatsApp usage dashboard a teacher opens first.
 *
 * <p>Written for someone who has never heard of an API. Every figure answers a
 * question they would actually ask - how many messages went out, from which
 * number, to how many people, and what it cost - and nothing on the page needs
 * a word of explanation about how any of it works.
 */
export function WhatsappDashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [usage, setUsage] = useState<Usage | null>(null);
  const [numbers, setNumbers] = useState<WaNumber[]>([]);
  const [loading, setLoading] = useState(true);

  // The number itself, not a count. A teacher has one, and the only thing they
  // ever need to know about it is whether it is up - so it says so here and
  // there is no screen for it anywhere else.
  useEffect(() => {
    api
      .get<WaNumber[]>("/services/whatsapp")
      .then(setNumbers)
      .catch(() => setNumbers([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<Usage>(`/services/whatsapp/usage?month=${month}`)
      .then((u) => alive && setUsage(u))
      .catch(() => alive && setUsage(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [month]);

  const atCurrent = month === currentMonth();

  if (loading && !usage) return <LoaderBlock />;

  return (
    <div className="space-y-5">
      {/* ── Header: the month, and what it covers ───────────────────────── */}
      <div className="rounded-2xl bg-dark p-5 text-white shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
              <WhatsappLogo className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-lg font-bold">رسائل واتساب</h2>
              <p className="mt-0.5 text-sm text-white/60">
                ملخّص ما أرسله النظام خلال {monthLabel(month)}.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {numbers.length === 0 ? (
                  <span className="text-xs text-white/50">لا يوجد رقم مضاف بعد</span>
                ) : (
                  numbers.map((n) => (
                    <span
                      key={n.id}
                      className="flex items-center gap-1.5 rounded-full bg-white/10 py-1 pr-2.5 pl-3 text-xs"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          n.connected ? "bg-green-400" : "bg-rose-400"
                        }`}
                      />
                      <span className="font-medium" dir="auto">
                        {numberName(n)}
                      </span>
                      <span className="text-white/50">{n.connected ? "يعمل" : "متوقف"}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
          {/* RTL: "السابق" sits on the right, so the chevrons are mirrored. */}
          <div className="flex shrink-0 items-center gap-1 rounded-xl border border-white/20 p-1">
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              title="الشهر السابق"
              className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/10"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="min-w-24 text-center text-sm font-medium">{monthLabel(month)}</span>
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              disabled={atCurrent}
              title="الشهر التالي"
              className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {!usage ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-400">
          تعذّر تحميل بيانات الاستخدام.
        </p>
      ) : (
        <>
          {/* ── The four headline numbers ────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={<Send className="h-5 w-5" />}
              value={num(usage.sent)}
              label="رسالة وصلت"
              note={usage.failed > 0 ? `${num(usage.failed)} لم تصل` : "لم تفشل أي رسالة"}
              tone={usage.failed > 0 ? "amber" : "green"}
            />
            <Kpi
              icon={<Users className="h-5 w-5" />}
              value={num(usage.recipients)}
              label="شخص وصلته رسالة"
              note="أرقام مختلفة، مش عدد الرسائل"
            />
            <Kpi
              icon={<UserPlus className="h-5 w-5" />}
              value={num(usage.new_contacts)}
              label="رقم جديد كلّمناه"
              note="لم نراسله قبل هذا الشهر"
            />
            <Kpi
              icon={<Coins className="h-5 w-5" />}
              value={usd(usage.estimated_cost)}
              label="تكلفة تقديرية"
              note="محسوبة على الرسائل التي وصلت"
              tone={usage.estimated_cost > 0 ? "accent" : undefined}
            />
          </div>

          {/* ── Daily volume ─────────────────────────────────────────────── */}
          <DailyChart days={usage.daily} />

          {/* Two panels used to sit beside this one and both were dropped: the
              per-category cost breakdown restated the cost tile above one row at
              a time, and the per-number panel mostly reported "رسائل بدون رقم
              محدد" - traffic from before the numbers were tracked - which read
              as a fault rather than as history. The dashboard is the month at a
              glance; per-number detail belongs on the numbers screen. */}
          <TypesPanel types={usage.by_type} />
        </>
      )}

      {loading && (
        <p className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          جارٍ التحديث…
        </p>
      )}
    </div>
  );
}

function Kpi({
  icon,
  value,
  label,
  note,
  tone,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  note?: string;
  tone?: "green" | "amber" | "accent";
}) {
  const toneClass =
    tone === "green"
      ? "bg-green-50 text-green-600"
      : tone === "amber"
        ? "bg-amber-50 text-amber-600"
        : tone === "accent"
          ? "bg-accent/10 text-accent"
          : "bg-slate-100 text-slate-500";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClass}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-tight text-slate-800">{value}</div>
          <div className="truncate text-xs text-slate-500">{label}</div>
        </div>
      </div>
      {note && <p className="mt-2 truncate text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

/** Daily volume as plain bars. No chart library - the app carries none. */
function DailyChart({ days }: { days: DayVolume[] }) {
  const peak = useMemo(() => Math.max(1, ...days.map((d) => d.attempted)), [days]);
  const busiest = useMemo(
    () => days.reduce<DayVolume | null>((a, d) => (a && a.sent >= d.sent ? a : d), null),
    [days],
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-slate-800">الرسائل يوماً بيوم</h3>
        {busiest && busiest.sent > 0 && (
          <p className="text-xs text-slate-400">
            أكثر يوم: {Number(busiest.day.slice(-2)).toLocaleString("ar-EG")} بعدد{" "}
            {num(busiest.sent)} رسالة
          </p>
        )}
      </div>

      {days.length === 0 ? (
        <p className="mt-6 text-center text-sm text-slate-400">لا توجد رسائل في هذا الشهر.</p>
      ) : (
        <div className="mt-5 flex h-40 items-end gap-[3px] overflow-x-auto pb-1" dir="ltr">
          {days.map((d) => {
            const failed = d.attempted - d.sent;
            const dayNum = Number(d.day.slice(-2));
            return (
              <div
                key={d.day}
                className="group relative flex min-w-2 flex-1 flex-col justify-end"
                title={`يوم ${dayNum}: ${d.sent} وصلت${failed > 0 ? ` · ${failed} فشلت` : ""}`}
              >
                {/* Failures stack on top of deliveries, so the bar's full height
                    is everything attempted and the red part is what went wrong. */}
                {failed > 0 && (
                  <div
                    className="rounded-t bg-rose-300"
                    style={{ height: `${(failed / peak) * 100}%` }}
                  />
                )}
                <div
                  className={`bg-accent transition-colors group-hover:bg-accent-hover ${
                    failed > 0 ? "" : "rounded-t"
                  }`}
                  style={{ height: `${(d.sent / peak) * 100}%`, minHeight: d.sent > 0 ? 2 : 0 }}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
          وصلت
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-300" />
          لم تصل
        </span>
      </div>
    </div>
  );
}

function TypesPanel({ types }: { types: TypeVolume[] }) {
  const peak = Math.max(1, ...types.map((t) => t.sent));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-bold text-slate-800">أنواع الرسائل</h3>
      <p className="mt-0.5 text-xs text-slate-400">أي نوع من الرسائل استهلك أكثر.</p>

      <div className="mt-4 space-y-2.5">
        {types.length === 0 ? (
          <p className="text-sm text-slate-400">لا توجد رسائل في هذا الشهر.</p>
        ) : (
          types.map((t) => (
            <div key={t.code}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-slate-700">{t.label}</span>
                <span className="shrink-0 font-semibold text-slate-800">{num(t.sent)}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-accent" style={{ width: `${(t.sent / peak) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
