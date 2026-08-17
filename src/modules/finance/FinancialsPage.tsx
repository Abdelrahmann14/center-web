import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Wallet } from "@/components/icons";
import { useAuth } from "@/auth/AuthContext";
import { api, ApiError, isOfflineError } from "@/lib/api";
import { useOnline } from "@/lib/useOnline";
import { useSync } from "@/sync/SyncProvider";
import { ConfirmDialog } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { LoaderBlock } from "@/components/PencilLoader";
import { useToast } from "@/components/Toast";
import { usePageState } from "@/lib/pageState";
import { InvoiceCard } from "./InvoiceCard";
import { OtherEntryModal } from "./OtherEntryModal";
import { AttendanceModal } from "./AttendanceModal";
import type { FinanceEntry, Invoice } from "./types";

/** How far back the default view reaches, today included. */
const WINDOW_DAYS = 7;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const ar = (n: number) => n.toLocaleString("ar-EG");

const DAY_LABEL = new Intl.DateTimeFormat("ar-EG", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * The Financials screen: every lesson session that has been registered, read as
 * an invoice.
 *
 * <p>The default is the last seven days rather than today alone, because a
 * teacher squares up on Thursday for a week of classes. Picking a date narrows
 * to that day; the reset chip puts the week back.
 */
export default function FinancialsPage() {
  const toast = useToast();
  const online = useOnline();
  const sync = useSync();
  const { can } = useAuth();
  // Financials is one permission: whoever can open it can manage entries and send
  // invoices too. There is no finer split any more.
  const canManage = can("FINANCE_VIEW");
  const canSend = can("FINANCE_VIEW");
  // Assistant attendance is its own permission, granted apart from Financials.
  const canAttendance = can("ASSISTANT_ATTENDANCE");

  // "" means the default window; a value means that single day.
  const [date, setDate] = usePageState<string>("finance.date", "");
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const [entryFor, setEntryFor] = useState<{ invoice: Invoice; entry?: FinanceEntry } | null>(null);
  const [attendanceFor, setAttendanceFor] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<{ invoice: Invoice; entry: FinanceEntry } | null>(null);
  const [confirmSend, setConfirmSend] = useState<Invoice | null>(null);

  const range = useMemo(() => {
    if (date) return { from: date, to: date };
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (WINDOW_DAYS - 1));
    return { from: iso(start), to: iso(today) };
  }, [date]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Never cached: an invoice is money, and a stale total is worse than a
      // spinner. Every mutation below refetches through here.
      const rows = await api.get<Invoice[]>(`/finance/invoices?from=${range.from}&to=${range.to}`);
      setInvoices(rows);
    } catch (err) {
      setInvoices([]);
      toast(err instanceof ApiError ? err.message : "تعذّر تحميل الفواتير", "error");
    } finally {
      setLoading(false);
    }
    // toast is stable in this app; keeping it out avoids a reload loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  // Sessions arrive newest-first; keep that order while splitting them by day.
  const days = useMemo(() => {
    const grouped = new Map<string, Invoice[]>();
    for (const invoice of invoices ?? []) {
      const bucket = grouped.get(invoice.session_date);
      if (bucket) bucket.push(invoice);
      else grouped.set(invoice.session_date, [invoice]);
    }
    return Array.from(grouped, ([day, rows]) => ({ day, rows }));
  }, [invoices]);

  async function removeEntry(entry: FinanceEntry) {
    // Queued with no line: the line goes from the invoice now and the delete
    // replays when the connection is back.
    async function removeOffline() {
      await sync.queueFinanceEntryDelete(entry.id);
      toast("تم حذف البند - بانتظار المزامنة");
      await load();
    }

    try {
      if (!online && sync.ready) {
        await removeOffline();
        return;
      }
      await api.del(`/finance/entries/${entry.id}`);
      toast("تم حذف البند");
      await load();
    } catch (err) {
      if (isOfflineError(err) && sync.ready) {
        try {
          await removeOffline();
          return;
        } catch {
          toast("تعذّر حذف البند دون اتصال", "error");
          return;
        }
      }
      toast(err instanceof ApiError ? err.message : "تعذّر حذف البند", "error");
    } finally {
      setDeleting(null);
    }
  }

  async function sendInvoice(invoice: Invoice) {
    setConfirmSend(null);
    setSendingKey(invoice.key);
    const params = new URLSearchParams({
      lecture_id: invoice.lecture_id,
      date: invoice.session_date,
    });
    if (invoice.group_id) params.set("group_id", invoice.group_id);
    try {
      await api.post<{ phone: string }>(`/finance/invoices/send?${params}`);
      toast("تم إرسال الفاتورة للمدرّس");
    } catch (err) {
      // WhatsApp is the one part of this page that needs a live connection.
      toast(err instanceof ApiError ? err.message : "تعذّر إرسال الفاتورة", "error");
    } finally {
      setSendingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">الحسابات</h1>
          <p className="mt-1 text-sm text-slate-500">
            {date
              ? `فواتير يوم ${DAY_LABEL.format(new Date(`${date}T00:00:00`))}`
              : `فواتير آخر ${ar(WINDOW_DAYS)} أيام`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* The system picker, not the browser's: the native one renders an
              English Sunday-first grid that reads as a foreign control here. */}
          <DatePicker
            value={date}
            onChange={setDate}
            max={iso(new Date())}
            placeholder={`آخر ${ar(WINDOW_DAYS)} أيام`}
            clearLabel={`آخر ${ar(WINDOW_DAYS)} أيام`}
          />
          {date && (
            <button
              onClick={() => setDate("")}
              title={`العودة لآخر ${ar(WINDOW_DAYS)} أيام`}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              آخر {ar(WINDOW_DAYS)} أيام
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <LoaderBlock />
      ) : days.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <Wallet className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 font-medium text-slate-600">لا توجد فواتير في هذه الفترة</p>
          <p className="mt-1 text-sm text-slate-400">
            تظهر الفاتورة بعد تسجيل حضور الحصة من صفحة تسجيل الحصة.
          </p>
        </div>
      ) : (
        days.map(({ day, rows }) => (
          <section key={day}>
            {/* The date rule separates one day from the next. Totals live on the
                invoices themselves - the page never sums across them. */}
            <div className="flex items-baseline gap-3">
              <h2 className="shrink-0 font-bold text-dark">
                {DAY_LABEL.format(new Date(`${day}T00:00:00`))}
              </h2>
              <span className="shrink-0 text-xs text-slate-400">
                {ar(rows.length)} {rows.length === 1 ? "فاتورة" : "فواتير"}
              </span>
              <span className="min-w-4 flex-1 border-b border-slate-200" />
            </div>

            {/* One day is one strip: the invoices sit side by side on it, the way
                a stack of receipts is laid out on a desk. */}
            <div className="no-scrollbar -mx-1 mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto rounded-2xl bg-slate-50 px-4 py-4">
              {rows.map((invoice) => (
                <InvoiceCard
                  key={invoice.key}
                  invoice={invoice}
                  canManage={canManage}
                  canAttendance={canAttendance}
                  canSend={canSend}
                  online={online}
                  sending={sendingKey === invoice.key}
                  onAddEntry={() => setEntryFor({ invoice })}
                  onEditEntry={(entry) => setEntryFor({ invoice, entry })}
                  onDeleteEntry={(entry) => setDeleting({ invoice, entry })}
                  onAttendance={() => setAttendanceFor(invoice)}
                  onSend={() => setConfirmSend(invoice)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {entryFor && (
        <OtherEntryModal
          invoice={entryFor.invoice}
          entry={entryFor.entry}
          onClose={() => setEntryFor(null)}
          onSaved={() => {
            setEntryFor(null);
            load();
          }}
        />
      )}

      {attendanceFor && (
        <AttendanceModal
          invoice={attendanceFor}
          onClose={() => setAttendanceFor(null)}
          onSaved={() => {
            setAttendanceFor(null);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="حذف البند"
          message={`هل تريد حذف "${deleting.entry.description}" من هذه الفاتورة؟`}
          confirmLabel="حذف"
          danger
          onConfirm={() => removeEntry(deleting.entry)}
          onClose={() => setDeleting(null)}
        />
      )}

      {confirmSend && (
        <ConfirmDialog
          title="إرسال الفاتورة"
          message={`سيتم إرسال فاتورة "${confirmSend.lecture_name}" بصيغة PDF إلى رقم واتساب المدرّس. هل تريد المتابعة؟`}
          confirmLabel="إرسال"
          onConfirm={() => sendInvoice(confirmSend)}
          onClose={() => setConfirmSend(null)}
        />
      )}
    </div>
  );
}
