import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "@/components/icons";

/**
 * The system's date picker.
 *
 * <p>It exists because the native `<input type="date">` cannot be dressed: it
 * renders its own popup with the browser's chrome, its own mm/dd/yyyy field and
 * its own blue. This one is the app's - the accent colour, the app's radii, and
 * a week that starts on Saturday like every group schedule in the system.
 *
 * <p>The calendar itself is deliberately English while the app around it is
 * Arabic: a date grid is read as a grid of figures, and Latin month names and
 * digits are what dates are read in here. The two action labels stay Arabic,
 * because they are app actions rather than calendar content.
 */

/** 0 = Saturday, matching how groups number the week everywhere else. */
const WEEKDAYS = [
  { short: "Sa", full: "Saturday" },
  { short: "Su", full: "Sunday" },
  { short: "Mo", full: "Monday" },
  { short: "Tu", full: "Tuesday" },
  { short: "We", full: "Wednesday" },
  { short: "Th", full: "Thursday" },
  { short: "Fr", full: "Friday" },
];

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const FULL_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parse = (value: string) => (value ? new Date(`${value}T00:00:00`) : null);

/** Which column a date sits in when the week starts on Saturday. */
const column = (d: Date) => (d.getDay() + 1) % 7;

export function DatePicker({
  value,
  onChange,
  max,
  placeholder = "اختر يوماً",
  clearLabel,
}: {
  /** ISO `yyyy-mm-dd`, or "" for no selection. */
  value: string;
  onChange: (value: string) => void;
  /** ISO upper bound; days after it cannot be picked. */
  max?: string;
  placeholder?: string;
  /** Shows a clear action with this label when a date is selected. */
  clearLabel?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const selected = useMemo(() => parse(value), [value]);
  const maxDate = useMemo(() => parse(max ?? ""), [max]);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // The month on screen. Opening on a selected date lands on its month.
  const [cursor, setCursor] = useState(() => {
    const base = selected ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return;
    const base = selected ?? today;
    setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [open, selected, today]);

  // Reset the position each time it opens so the measure below runs fresh, and
  // the panel is never painted at last time's coordinates for a frame.
  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  /**
   * Anchor under the trigger and clamp into the viewport.
   *
   * <p>Aligning the right edges alone is not enough: this page lays its controls
   * out on the left, so a panel hung from the trigger's right edge ran straight
   * off the side of the screen. Both axes are clamped, and the panel flips above
   * the trigger when there is no room below it. The panel is measured rather
   * than assumed, because its height changes with the number of week rows.
   */
  const place = useCallback(() => {
    const trigger = btnRef.current?.getBoundingClientRect();
    const panel = popRef.current;
    if (!trigger || !panel) return;

    const gap = 8;
    const margin = 8;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    let left = trigger.right - width;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin));

    let top = trigger.bottom + gap;
    if (top + height > window.innerHeight - margin) {
      const above = trigger.top - height - gap;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
    }

    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, []);

  useLayoutEffect(() => {
    // `cursor` matters: a month with an extra week row makes the panel taller.
    if (open) place();
  }, [open, cursor, place]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Scrolling the page moves the calendar back under its trigger rather than
    // dismissing it, and a scroll started inside the panel is not the page's.
    function onScroll(e: Event) {
      if (popRef.current?.contains(e.target as Node)) return;
      place();
    }
    const reflow = () => place();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  // The month's days, padded with blanks so the first one lands in its column.
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const lead = column(first);
    const out: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= daysInMonth; day++) {
      out.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
    }
    // Fill the last row so the grid never changes height between months.
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const sameDay = (a: Date, b: Date | null) =>
    b !== null &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const beyondMax = (d: Date) => maxDate !== null && d.getTime() > maxDate.getTime();

  // The month step is disabled rather than hidden, so the control never shifts.
  const nextBlocked =
    maxDate !== null &&
    new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime() > maxDate.getTime();

  function pick(day: Date) {
    onChange(iso(day));
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-xl border bg-slate-50 px-4 py-2.5 leading-6 outline-none transition ${
          open ? "border-accent bg-white ring-2 ring-accent/45" : "border-slate-300 hover:bg-white"
        }`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
        <span className={value ? "text-slate-800" : "text-slate-400"}>
          {selected ? FULL_DATE.format(selected) : placeholder}
        </span>
        {value && clearLabel && (
          // A span, not a button: a button inside a button is invalid markup.
          <span
            role="button"
            tabIndex={0}
            title={clearLabel}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onChange("");
                setOpen(false);
              }
            }}
            className="-ml-1 rounded-md p-0.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            dir="ltr"
            style={{
              position: "fixed",
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              // Rendered before it is placed so it can be measured; kept out of
              // sight for that one frame rather than flashing in the corner.
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-[60] w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl animate-scale-up"
          >
            <div className="flex items-center justify-between">
              {/* The calendar reads left-to-right, so back is on the left. */}
              <StepBtn
                title="الشهر السابق"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </StepBtn>
              <span className="font-ledger text-sm font-bold text-dark">
                {MONTH_YEAR.format(cursor)}
              </span>
              <StepBtn
                title="الشهر التالي"
                disabled={nextBlocked}
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </StepBtn>
            </div>

            {/* Saturday first: the week is numbered that way throughout the
                system, and a group's day comes from that same order. */}
            <div className="mt-3 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((d) => (
                <div
                  key={d.full}
                  title={d.full}
                  className="font-ledger grid h-7 place-items-center text-xs font-medium text-slate-400"
                >
                  {d.short}
                </div>
              ))}

              {cells.map((day, i) => {
                if (day === null) return <span key={`pad-${i}`} className="h-9" />;
                const isSelected = sameDay(day, selected);
                const isToday = sameDay(day, today);
                const disabled = beyondMax(day);
                return (
                  <button
                    key={iso(day)}
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(day)}
                    className={`font-ledger grid h-9 place-items-center rounded-lg text-sm transition ${
                      isSelected
                        ? "bg-accent font-bold text-white"
                        : disabled
                          ? "text-slate-300"
                          : isToday
                            ? "font-bold text-accent ring-1 ring-accent/40 hover:bg-accent/10"
                            : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            {/* The two actions belong to the app, not to the calendar, so they
                stay in the app's language. */}
            <div dir="rtl" className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={() => pick(today)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/10"
              >
                اليوم
              </button>
              {clearLabel && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
                >
                  {clearLabel}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function StepBtn({
  children,
  title,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
