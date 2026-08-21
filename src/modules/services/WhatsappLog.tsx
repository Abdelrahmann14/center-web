import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, X, MessageCircle, Users, Clock, CheckCircle2, Ban, RotateCcw,
} from "@/components/icons";
import { cachedGetAll } from "@/lib/dataCache";
import { usePageState } from "@/lib/pageState";
import { useDebounced } from "@/lib/useDebounced";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { Select, inputClass } from "@/components/ui";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { DatePicker } from "@/components/DatePicker";
import { Pagination } from "@/components/Pagination";
import { fmtDateTime } from "@/lib/datetime";

// ── Shared types ───────────────────────────────────────────────────────────


interface LogRow {
  id: string;
  recipient_name: string | null;
  phone: string | null;
  recipient_code: string | null;
  recipient_type: string;
  body: string;
  status: string;
  failure_reason: string | null;
  source: string;
  origin: string;
  /** The number it left from, or null when it never reached one. */
  number_label: string | null;
  /** The approved template the recipient actually read. */
  template_name: string | null;
  sent_by_name: string | null;
  created_at: string;
}


const EMPTY_SET: ReadonlySet<string> = new Set();

// ── The log ─────────────────────────────────────────────────────────────────

/**
 * Everything WhatsApp has sent for this account.
 *
 * <p>Lives inside الخدمات ← واتساب rather than on a screen of its own: there is
 * nothing left to put beside it. The automated messages used to sit here as a
 * page of editors, and a compose box beside them, but the wording now comes from
 * templates the platform writes and Meta approves - so nothing on this side
 * writes a message any more. What is left is the record of what went out.
 */
export function WhatsappLog() {
  return <HistoryTab />;
}

// ── History (send log) ───────────────────────────────────────────────────────

const STATUS_AR: Record<string, string> = { SENT: "تم الإرسال", FAILED: "فشل" };
const SOURCE_AR: Record<string, string> = { SYSTEM: "تلقائي", MANUAL: "يدوي" };
const ORIGIN_AR: Record<string, string> = {
  ATTENDANCE: "حضور",
  ABSENCE: "غياب",
  NEW_STUDENT: "طالب جديد",
  EXAM_GRADE: "درجة اختبار",
  MANUAL: "يدوي",
  BARCODE: "باركود",
  REPORT: "تقرير",
  INVOICE: "فاتورة",
  broadcast: "إعلان عام",
  exam_result: "نتيجة اختبار",
  student_verification: "كود تحقق",
  student_password_reset: "استعادة كلمة السر",
  parent_password_reset: "استعادة كلمة السر (ولي أمر)",
  parent_link_approved_wa: "قبول ربط ولي أمر",
  parent_link_rejected_wa: "رفض ربط ولي أمر",
};
// Who a message went to. TEACHER is the workspace owner's own number (the
// invoice PDFs go there); OTHER is a number that belongs to nobody on the
// roster, which is now the only case the table has nothing to name.
const TYPE_AR: Record<string, string> = {
  STUDENT: "طالب",
  PARENT: "ولي أمر",
  TEACHER: "المدرّس",
  OTHER: "رقم خارجي",
};

const FIELDS = [
  { key: "status", label: "الحالة", ar: STATUS_AR },
  { key: "source", label: "المصدر", ar: SOURCE_AR },
  { key: "origin", label: "النوع", ar: ORIGIN_AR },
  { key: "recipient_type", label: "المستلم", ar: TYPE_AR },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
const ROWS_OPTIONS = ["10", "25", "50"];

/** Folds Arabic letter variants so "احمد" matches "أحمد", "مصطفى" matches "مصطفي". */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْـ]/g, "");
}

/** The message's type as a coloured chip, grouped by what kind of send it was. */
const ORIGIN_TONE: Record<string, string> = {
  ATTENDANCE: "bg-teal-50 text-teal-700",
  ABSENCE: "bg-amber-50 text-amber-700",
  NEW_STUDENT: "bg-emerald-50 text-emerald-700",
  EXAM_GRADE: "bg-violet-50 text-violet-700",
  BARCODE: "bg-blue-50 text-blue-700",
  REPORT: "bg-blue-50 text-blue-700",
  INVOICE: "bg-blue-50 text-blue-700",
  broadcast: "bg-violet-50 text-violet-700",
  exam_result: "bg-green-50 text-green-700",
};

function OriginChip({ origin }: { origin: string }) {
  const cls = ORIGIN_TONE[origin] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      {ORIGIN_AR[origin] ?? origin}
    </span>
  );
}

function HistoryTab() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [search, setSearch] = usePageState("messages.search", "");
  const [date, setDate] = usePageState("messages.date", "");
  const [page, setPage] = usePageState("messages.page", 1);
  const [perPageStr, setPerPageStr] = usePageState("messages.rows", "25");
  const [colF, setColF] = useState<Partial<Record<FieldKey, Set<string>>>>({});
  const perPage = Number(perPageStr) || 25;
  const debounced = useDebounced(search);
  const mounted = useRef(false);

  useEffect(() => {
    cachedGetAll<LogRow>("/messaging/whatsapp/log").then(setRows).catch(() => setRows([]));
  }, []);

  const setCol = (key: FieldKey, next: Set<string>) => setColF((c) => ({ ...c, [key]: next }));

  const distinct = useMemo(() => {
    const out: Record<FieldKey, string[]> = { status: [], source: [], origin: [], recipient_type: [] };
    if (!rows) return out;
    for (const f of FIELDS) {
      const seen = new Set<string>();
      for (const r of rows) {
        const raw = r[f.key] as string;
        if (raw) seen.add(f.ar[raw] ?? raw);
      }
      out[f.key] = [...seen];
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = debounced.trim().toLowerCase();
    return rows.filter((r) => {
      if (date && r.created_at.slice(0, 10) !== date) return false;
      for (const f of FIELDS) {
        const set = colF[f.key];
        if (set && set.size > 0) {
          const display = f.ar[r[f.key] as string] ?? (r[f.key] as string);
          if (!set.has(display)) return false;
        }
      }
      if (q) {
        const hay = norm(`${r.recipient_name ?? ""} ${r.phone ?? ""} ${r.recipient_code ?? ""} ${r.body}`);
        if (!hay.includes(norm(q))) return false;
      }
      return true;
    });
  }, [rows, debounced, date, colF]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * perPage, current * perPage);

  useEffect(() => {
    if (mounted.current) setPage(1);
    else mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, date, colF, perPageStr]);

  const activeTags = FIELDS.flatMap((f) =>
    [...(colF[f.key] ?? [])].map((value) => ({ key: f.key, label: f.label, value })));

  function removeTag(key: FieldKey, value: string) {
    setColF((c) => {
      const next = new Set(c[key] ?? []);
      next.delete(value);
      return { ...c, [key]: next };
    });
  }

  if (!rows) return <LoaderBlock />;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الرقم أو الكود أو النص"
            className={`${inputClass} pr-9`}
          />
        </div>
        {FIELDS.map((f) => (
          <MultiSelectFilter
            key={f.key}
            label={f.label}
            options={distinct[f.key]}
            selected={colF[f.key] ?? EMPTY_SET}
            onChange={(s) => setCol(f.key, s)}
          />
        ))}
        <DatePicker value={date} onChange={setDate} placeholder="كل الأيام" clearLabel="كل الأيام" />
        {date && (
          <button onClick={() => setDate("")} className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
            <RotateCcw className="h-4 w-4" />
            كل الأيام
          </button>
        )}
        <div className="ms-auto flex items-center gap-2 text-sm text-slate-500">
          <span>عرض</span>
          <div className="w-20">
            <Select value={perPageStr} onChange={setPerPageStr} options={ROWS_OPTIONS.map((r) => ({ value: r, label: r }))} />
          </div>
        </div>
      </div>

      {activeTags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {activeTags.map((t) => (
            <span key={`${t.key}:${t.value}`} className="animate-scale-up flex items-center gap-1 rounded-full bg-accent/10 py-1 pe-1 ps-2.5 text-xs font-medium text-accent">
              <span className="text-accent/70">{t.label}:</span>
              {t.value}
              <button onClick={() => removeTag(t.key, t.value)} aria-label={`إزالة ${t.value}`} className="rounded-full p-0.5 transition hover:bg-accent/20">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1100px] text-right text-sm">
          <thead className={`${THEAD} font-medium`}>
            <tr>
              <th className="px-4 py-3">المستلم</th>
              <th className="px-4 py-3">النوع</th>
              <th className="px-4 py-3">الرقم</th>
              <th className="px-4 py-3">الكود</th>
              <th className="px-4 py-3">الرسالة</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">أُرسلت من</th>
              <th className="px-4 py-3">المصدر</th>
              <th className="px-4 py-3">التاريخ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => {
              const failed = r.status === "FAILED";
              return (
                <tr key={r.id} className={failed ? "bg-rose-100 hover:bg-rose-200" : "hover:bg-slate-50/60"}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{r.recipient_name || "-"}</div>
                    <div className="text-[11px] text-slate-400">{TYPE_AR[r.recipient_type] ?? r.recipient_type}</div>
                  </td>
                  <td className="px-4 py-3"><OriginChip origin={r.origin} /></td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">{r.phone || "-"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.recipient_code || "-"}</td>
                  <td className="max-w-xs px-4 py-3">
                    <p className="line-clamp-2 text-slate-700" title={r.body}>{r.body}</p>
                    {failed && r.failure_reason && (
                      <p className="mt-0.5 text-[11px] text-rose-700">{r.failure_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {failed ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700"><Ban className="h-3.5 w-3.5" /> فشل</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> تم الإرسال</span>
                    )}
                  </td>
                  {/* Which number carried it. The parent read the TEMPLATE,
                      not the body in the column beside this one, so the template
                      is named rather than implied. */}
                  <td className="px-4 py-3 text-xs">
                    <span className="text-slate-600" dir="auto">
                      {r.number_label ?? "—"}
                    </span>
                    {r.template_name && (
                      <div className="mt-0.5 text-[11px] text-slate-400" dir="ltr">
                        {r.template_name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <div>{SOURCE_AR[r.source] ?? r.source}</div>
                    {r.source === "MANUAL" && r.sent_by_name && <div className="text-slate-400">{r.sent_by_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500" dir="ltr">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{fmtDateTime(r.created_at)}</span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                  <MessageCircle className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                  لا توجد رسائل مطابقة
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination current={current} totalPages={totalPages} onChange={setPage} />

      <div className="mt-4">
        <span className="text-xs text-slate-400">
          <Users className="ml-1 inline h-3.5 w-3.5" />
          {filtered.length.toLocaleString("ar-EG")} رسالة
        </span>
      </div>
    </div>
  );
}
