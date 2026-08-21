import { ClipboardCheck, Loader2, Pencil, Plus, Send, Trash2 } from "@/components/icons";
import type { FinanceEntry, Invoice } from "./types";
import { useWhatsappAction } from "@/lib/useWhatsappAvailability";

/**
 * A lesson session drawn as the thing it replaces: the carbon-copy receipt the
 * desk used to tear out of a book at the end of a class.
 *
 * The stub on top carries the lesson; the ledger underneath carries the money;
 * the perforation between them is the divider, punched through both side edges
 * so it reads as a tear line rather than a rule. The takings are machine-derived
 * and can never be typed over - only the "أخرى" lines are hand-written, and they
 * are marked as such with a rule down their edge.
 */

/** Latin tabular figures: a ledger column has to align digit-for-digit. */
const money = (n: number) => Math.ceil(n).toLocaleString("en-US");
/** Arabic-Indic figures for counts that sit inside a sentence, not a column. */
const ar = (n: number) => n.toLocaleString("ar-EG");

const WEEKDAY = new Intl.DateTimeFormat("ar-EG", { weekday: "long" });
const DAY_MONTH = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long" });

export function InvoiceCard({
  invoice,
  canManage,
  canAttendance,
  canSend,
  online,
  sending,
  onAddEntry,
  onEditEntry,
  onDeleteEntry,
  onAttendance,
  onSend,
}: {
  invoice: Invoice;
  canManage: boolean;
  canAttendance: boolean;
  canSend: boolean;
  /** False greys out the send button - everything else on the card is queueable. */
  online: boolean;
  sending: boolean;
  onAddEntry: () => void;
  onEditEntry: (entry: FinanceEntry) => void;
  onDeleteEntry: (entry: FinanceEntry) => void;
  onAttendance: () => void;
  onSend: () => void;
}) {
  const date = new Date(`${invoice.session_date}T00:00:00`);
  // The invoice PDF leaves over WhatsApp like any other document, so the same
  // backend answer decides whether the button can be offered.
  const wa = useWhatsappAction("broadcast");

  return (
    <article className="relative flex w-[23rem] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      {/* ── Stub: what was taught, to whom, when ── */}
      <header className="px-5 pb-4 pt-5">
        <h3 className="truncate text-lg font-bold text-dark" title={invoice.lecture_name}>
          {invoice.lecture_name}
        </h3>
        <p className="mt-1 truncate text-sm text-slate-500">
          {invoice.group_label}
          {invoice.center_name ? ` · ${invoice.center_name}` : ""}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {invoice.grade ?? "بدون صف"} · {WEEKDAY.format(date)} {DAY_MONTH.format(date)}
        </p>
      </header>

      {/* ── The tear line. The wrapper spans the full card so the notches punch
          into its side edges; the dashed rule is inset so it stops short of
          them, the way a real perforation does. ── */}
      <div className="invoice-perf relative">
        <div className="mx-5 border-t border-dashed border-slate-300" />
      </div>

      {/* ── Ledger: how the money adds up ── */}
      <div className="flex-1 space-y-1.5 px-5 py-4">
        <Row label="طلاب المجموعة" value={ar(invoice.students)} plain />
        <Row label="الحاضرون" value={ar(invoice.attended)} plain />
        <Row label="سعر الحصة" value={money(invoice.lesson_price)} />

        <div className="pt-2 text-[11px] font-medium text-slate-400">تحصيل الحضور</div>
        {invoice.lines.map((line, i) => (
          <Row
            key={`${line.price ?? "none"}-${i}`}
            label={
              line.price === null
                ? "بدون سعر محدد"
                : line.price === 0
                  ? "إعفاء"
                  : line.discounted
                    ? "بخصم"
                    : "بالسعر الكامل"
            }
            note={line.price === null ? `${ar(line.count)} طالب` : `${line.count} × ${money(line.price)}`}
            value={money(line.subtotal)}
            muted={line.price === 0 || line.price === null}
          />
        ))}

        {/* Padding, not margin: the parent's space-y already owns margin-top and
            would win the specificity fight. */}
        <div className="mt-1.5 border-t border-slate-100 pt-3">
          <Row label="إجمالي التحصيل" value={money(invoice.gross)} strong />
          <Row
            label="نسبة السنتر"
            note={`${invoice.percentage}%`}
            value={`- ${money(invoice.center_cut)}`}
            tone="rose"
          />
          <Row label="الصافي بعد النسبة" value={money(invoice.net_after_cut)} strong />
        </div>

        {/* ── Hand-written lines. The rule down the edge says a person typed
            these, unlike everything above them. ── */}
        {invoice.entries.length > 0 && (
          <div className="space-y-1.5 border-r-2 border-slate-200 pr-3 pt-2">
            {invoice.entries.map((entry) => (
              <div key={entry.id} className="group/entry flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-600" title={entry.description}>
                  {entry.description}
                </span>
                {canManage && (
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover/entry:opacity-100">
                    <IconBtn title="تعديل البند" onClick={() => onEditEntry(entry)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title="حذف البند" danger onClick={() => onDeleteEntry(entry)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </span>
                )}
                <span
                  className={`shrink-0 font-ledger font-semibold ${
                    entry.kind === "income" ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {entry.kind === "income" ? "+" : "-"} {money(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Who ran the session with the teacher. Names only - the register lives
            behind the الحضور button. Gated with the button: attendance access is
            one permission, so someone without it sees neither. */}
        {canAttendance && invoice.attendees.length > 0 && (
          <div className="pt-2">
            <div className="text-[11px] font-medium text-slate-400">المساعدون الحاضرون</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {invoice.attendees.map((name) => (
                <span
                  key={name}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-4">
          {canAttendance && (
            <button
              onClick={onAttendance}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-accent/50 hover:text-accent"
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              الحضور
            </button>
          )}
          {canManage && (
            <button
              onClick={onAddEntry}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-accent/50 hover:text-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              أخرى
            </button>
          )}
          {/* The one control on this card that cannot be queued: a WhatsApp
              message is not data this app owns, so with no line it is off. */}
          {canSend && (
            <button
              onClick={onSend}
              disabled={sending || !online || wa.disabled}
              title={
                !online
                  ? "لا يوجد اتصال بالإنترنت"
                  : wa.disabled
                    ? (wa.reason ?? "إرسال واتساب غير متاح")
                    : "إرسال الفاتورة للمدرّس عبر واتساب"
              }
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              إرسال للمدرّس
            </button>
          )}
        </div>
      </div>

      {/* ── The stamp: the one number the teacher came here for ── */}
      <div className="flex items-baseline justify-between bg-dark px-5 py-3.5 text-white">
        <span className="text-sm">الصافي المستحق</span>
        <span className="font-ledger text-2xl font-bold">{money(invoice.total)}</span>
      </div>
    </article>
  );
}

/**
 * One ledger line. The leader dots carry the eye from the label to the figure,
 * the same way the center price list already does it.
 */
function Row({
  label,
  note,
  value,
  strong = false,
  muted = false,
  plain = false,
  tone,
}: {
  label: string;
  note?: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  /** A count rather than money: no ledger face, no emphasis. */
  plain?: boolean;
  tone?: "rose";
}) {
  const figure = tone === "rose" ? "text-rose-600" : muted ? "text-slate-400" : "text-dark";
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className={`shrink-0 ${muted ? "text-slate-400" : "text-slate-600"}`}>{label}</span>
      {note && <span className="shrink-0 font-ledger text-xs text-slate-400">{note}</span>}
      <span className="min-w-4 flex-1 border-b border-dotted border-slate-200" />
      <span
        className={`shrink-0 ${plain ? "text-sm text-slate-700 tabular-nums" : "font-ledger"} ${
          strong ? "font-bold" : "font-semibold"
        } ${figure}`}
      >
        {value}
      </span>
    </div>
  );
}

function IconBtn({
  children,
  title,
  danger = false,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md p-1 text-slate-400 transition ${
        danger ? "hover:bg-rose-50 hover:text-rose-600" : "hover:bg-accent/10 hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
