import { X, ChevronDown, Check, Coins } from "lucide-react";
import type { ReactNode, FormEvent } from "react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Shared input styling used across all forms.
//
// `leading-6` is load-bearing: it pins the content box to 24px so every control
// wearing this class (and the Select, which matches it) is exactly the same
// height. The faint fill makes the control visible against the white page, and
// clears on focus. The focus ring is deliberately strong - at a lighter opacity
// it was hard to tell which control was active.
export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 leading-6 text-slate-800 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/45";

/**
 * Lets a control inside a Field say whether it currently holds a value. Native
 * inputs are read straight off the DOM, but the system Select is a button, so it
 * reports through here instead. A non-null context also tells a control it is
 * inside a floating field, so it drops its own placeholder - the resting label
 * IS the placeholder.
 */
const FieldReportCtx = createContext<((key: string, filled: boolean) => void) | null>(null);

/** Inputs that paint their own format hint (dd/mm/yyyy), so never rest a label over them. */
const SELF_LABELLING = new Set(["date", "time", "datetime-local", "month", "week", "color"]);

/**
 * The system form field. The label starts inside the control and lifts onto its
 * top border once the field is focused or filled, with its own white background
 * cutting the notch.
 *
 * Whether the field is filled and whether it wraps a textarea are both detected
 * from the rendered control, so a call site is just `<Field label="..."><input
 * ... /></Field>` - no extra wiring. `filled` overrides the detection, and
 * `plain` falls back to a label above the control (for a field that wraps a
 * checkbox list or another composite instead of one text control).
 */
export function Field({
  label,
  hint,
  filled,
  multiline,
  plain = false,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  /** Overrides the auto-detected filled state. */
  filled?: boolean;
  /** Overrides textarea auto-detection (rests the label near the top). */
  multiline?: boolean;
  /** Renders the old label-above-control layout. */
  plain?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [auto, setAuto] = useState({ filled: false, multiline: false });
  const reports = useRef(new Map<string, boolean>());
  const [reported, setReported] = useState(false);

  const report = useCallback((key: string, isFilled: boolean) => {
    reports.current.set(key, isFilled);
    setReported(Array.from(reports.current.values()).some(Boolean));
  }, []);

  const scan = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const controls = Array.from(
      el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
    );
    const next = {
      filled: controls.some(
        (c) => c.value !== "" || SELF_LABELLING.has((c as HTMLInputElement).type)
      ),
      multiline: controls.some((c) => c.tagName === "TEXTAREA"),
    };
    // Re-runs after every render (controlled values change without an event),
    // so bail out on an unchanged result rather than looping.
    setAuto((prev) =>
      prev.filled === next.filled && prev.multiline === next.multiline ? prev : next
    );
  }, []);

  useEffect(scan);

  if (plain) {
    return (
      <div className={className}>
        <div className="mb-1.5 flex items-center gap-2">
          <label className="text-sm font-semibold text-slate-800">{label}</label>
          {hint && <span className="text-xs text-slate-400">{hint}</span>}
        </div>
        {children}
      </div>
    );
  }

  const up = focused || filled === true || auto.filled || reported;
  const asTextarea = multiline ?? auto.multiline;

  return (
    <FieldReportCtx.Provider value={report}>
      <div className={className}>
        <div
          ref={ref}
          className="relative"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onInput={scan}
        >
          {children}
          <label
            // Lifted clear of the border rather than sitting on it - at -top-2
            // the label read as part of the control instead of a label.
            className={`pointer-events-none absolute right-3 z-10 bg-white px-1 font-medium leading-none transition-all duration-150 ease-out ${
              up
                ? "-top-2.5 text-xs"
                : asTextarea
                  ? "top-3 text-sm"
                  : "top-1/2 -translate-y-1/2 text-sm"
            } ${focused ? "text-accent" : up ? "text-slate-600" : "text-slate-400"}`}
          >
            {label}
          </label>
        </div>
        {hint && <p className="mt-1 px-1 text-xs text-slate-400">{hint}</p>}
      </div>
    </FieldReportCtx.Provider>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

// Spread onto a native required <input> to localize the browser's popup to "مطلوب".
export const requiredArabic = {
  onInvalid: (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity("مطلوب"),
  onInput: (e: FormEvent<HTMLInputElement>) => e.currentTarget.setCustomValidity(""),
};

/**
 * System-wide dropdown - fully custom (NOT native <select>), so BOTH the closed
 * control and the open option list are on-theme.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "اختر...",
  disabled = false,
  onFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // A dropdown is a button, not an input, so the surrounding Field cannot read a
  // value off the DOM - report it instead, and drop the placeholder there since
  // the floating label already sits in that spot.
  const report = useContext(FieldReportCtx);
  const uid = useId();
  useEffect(() => {
    report?.(uid, value !== "");
    return () => report?.(uid, false);
  }, [report, uid, value]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onFocus={onFocus}
        onClick={() => setOpen((o) => !o)}
        // Same padding, fill and line height as inputClass, so a select and an
        // input standing side by side are exactly the same height.
        className={`flex w-full items-center justify-between rounded-xl border py-2.5 pr-4 pl-3 text-right leading-6 text-slate-800 outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
          open
            ? "border-accent bg-white ring-2 ring-accent/45"
            : "border-slate-300 bg-slate-50 hover:border-slate-400 focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/45"
        }`}
      >
        {/* Never empty: a blank span would collapse the line box and leave this
            control shorter than a text input. */}
        <span className={`truncate leading-6 ${selected ? "" : "text-slate-400"}`}>
          {selected ? selected.label : report ? " " : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-fade-in">
          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm transition ${
                  isSel
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span>{o.label}</span>
                {isSel && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Multi-select dropdown (checkboxes) - same look as Select. */
export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = "اختر...",
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const label =
    value.length === 0
      ? placeholder
      : options
          .filter((o) => value.includes(o.value))
          .map((o) => o.label)
          .join("، ");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-xl border bg-white py-2.5 pr-4 pl-3 text-right text-sm outline-none transition ${
          open ? "border-accent ring-2 ring-accent/20" : "border-slate-300 hover:border-slate-400"
        }`}
      >
        <span className={`truncate ${value.length ? "text-slate-800" : "text-slate-400"}`}>{label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-fade-in">
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-400">لا يوجد مساعدون</div>
          )}
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-slate-100"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on ? "border-accent bg-accent text-white" : "border-slate-300"
                  }`}
                >
                  {on && <Check className="h-3 w-3" />}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Text input that suggests from previously-entered values (school/city etc).
 * Type a prefix → matching prior values appear; click, Enter, or ArrowRight
 * (caret at end) completes to the top match. Free typing continues.
 */
/**
 * Put on a <form> so Enter walks to the next field instead of submitting - a
 * long form can then be filled without touching the mouse. The last field still
 * submits, textareas keep their newlines, and a field that already handled
 * Enter itself (an open suggestion list) is left alone.
 */
export function advanceOnEnter(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter" || e.defaultPrevented || e.shiftKey) return;
  const el = e.target as HTMLElement;
  if (!(el instanceof HTMLInputElement)) return;
  if (el.type === "submit" || el.type === "button" || el.type === "checkbox") return;

  const fields = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>("input, textarea"),
  ).filter(
    (f) =>
      !(f as HTMLInputElement).disabled &&
      !(f as HTMLInputElement).readOnly &&
      f.tabIndex !== -1 &&
      // offsetParent is null for anything hidden, so collapsed rows are skipped.
      f.offsetParent !== null,
  );
  const i = fields.indexOf(el);
  if (i === -1 || i === fields.length - 1) return;

  e.preventDefault();
  const next = fields[i + 1];
  next.focus();
  if (next instanceof HTMLInputElement && next.type === "text") next.select();
}

export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  autoFocus,
  error = false,
  onBlur,
  onFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  autoFocus?: boolean;
  error?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** Keyboard cursor into `matches`; -1 means nothing is highlighted yet. */
  const [hi, setHi] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const optRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inField = useContext(FieldReportCtx) !== null;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // A changed query invalidates the old cursor position.
  useEffect(() => setHi(-1), [value]);
  useEffect(() => {
    if (hi >= 0) optRefs.current[hi]?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const q = value.trim();
  const matches = (() => {
    if (!q) return [];
    const uniq = Array.from(new Set(suggestions.filter((s) => s && s !== value)));
    const starts = uniq.filter((s) => s.startsWith(q));
    const contains = uniq.filter((s) => !s.startsWith(q) && s.includes(q));
    return [...starts, ...contains].slice(0, 6);
  })();
  const show = open && matches.length > 0;

  function accept(v: string) {
    onChange(v);
    setOpen(false);
    setHi(-1);
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        // Inside a Field the floating label occupies the placeholder's spot.
        placeholder={inField ? "" : placeholder}
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        aria-activedescendant={show && hi >= 0 ? `ac-opt-${hi}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          onFocus?.();
        }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => (h + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => (h <= 0 ? matches.length - 1 : h - 1));
          } else if (e.key === "Home") {
            e.preventDefault();
            setHi(0);
          } else if (e.key === "End") {
            e.preventDefault();
            setHi(matches.length - 1);
          } else if (e.key === "Enter") {
            // Enter takes the highlighted row, or the top match when the user
            // never moved the cursor. Stopped here so a form-level
            // advance-on-Enter does not also jump to the next field.
            e.preventDefault();
            e.stopPropagation();
            accept(matches[hi >= 0 ? hi : 0]);
          } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === value.length) {
            e.preventDefault();
            accept(matches[hi >= 0 ? hi : 0]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setHi(-1);
          }
        }}
        className={`${inputClass} ${error ? "border-rose-400 focus:border-rose-400 focus:ring-rose-200" : ""}`}
      />
      {show && (
        <div
          role="listbox"
          className="absolute z-40 mt-1.5 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-fade-in"
        >
          {matches.map((s, i) => (
            <button
              key={s}
              id={`ac-opt-${i}`}
              ref={(el) => {
                optRefs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={i === hi}
              // The input keeps focus, so pointer hover moves the same cursor
              // the arrow keys use - one highlight, not two competing ones.
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => accept(s)}
              className={`block w-full rounded-lg px-3 py-2 text-right text-sm transition ${
                i === hi ? "bg-accent/10 text-accent" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MODAL_WIDTH = {
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-2xl",
  "2xl": "max-w-3xl",
  "3xl": "max-w-4xl",
} as const;

/**
 * Standard modal dialog for the whole system. The whole card scrolls as one unit
 * (Bernard pattern), portaled to <body> so no transformed ancestor traps it.
 *
 * Clicking the backdrop does NOTHING on purpose: every dialog in the app closes
 * through its X (or Cancel) button only, so a stray click beside a form can
 * never throw away what was typed.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof MODAL_WIDTH;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in">
      <div
        className={`no-scrollbar relative w-full ${MODAL_WIDTH[size]} max-h-[90vh] space-y-5 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-scale-up`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">{children}</div>

        {footer && <div className="flex justify-end gap-3 pt-1">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/** Confirmation dialog - yes/no before an action (logout, delete, ...). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-5 py-2.5 font-medium text-white transition ${
              danger ? "bg-rose-600 hover:bg-rose-700" : "bg-accent hover:bg-accent-hover"
            }`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}

/** Floating rose bubble above an input (needs a `relative` wrapper). */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  // mb clears the floating label, which sits on the control's top border.
  return (
    <div className="absolute bottom-full right-0 z-20 mb-2.5">
      <div className="relative rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white shadow">
        {message}
        <span className="absolute right-3 top-full -mt-px h-2 w-2 -translate-y-1/2 rotate-45 bg-rose-600" />
      </div>
    </div>
  );
}

/** Solid form-level bubble (rose = error, green = success) with a downward pointer. */
export function FormNotice({
  message,
  variant = "error",
}: {
  message?: string | null;
  variant?: "error" | "success";
}) {
  if (!message) return null;
  const bg = variant === "success" ? "bg-green-600" : "bg-rose-600";
  return (
    <div className="relative">
      <div className={`rounded-lg px-3 py-2 text-sm font-medium text-white shadow ${bg}`}>
        {message}
      </div>
    </div>
  );
}

/** On/off switch - reliable click target, knob position is dir-stable (LTR). */
export function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      dir="ltr"
      className="relative h-[25px] w-[50px] shrink-0 cursor-pointer rounded-full transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: checked
          ? "linear-gradient(to bottom, #4cd964, #5de24e)"
          : "linear-gradient(to bottom, #b3b3b3, #e6e6e6)",
      }}
    >
      <span
        className="absolute top-px h-[23px] w-[23px] rounded-full bg-white transition-all duration-300"
        style={{ left: checked ? "26px" : "1px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
      />
    </button>
  );
}

/** Money value with a coin icon (replaces the "ج.م" label everywhere). */
export function Money({ value, className }: { value: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${className ?? ""}`}>
      {value}
      <Coins className="h-3.5 w-3.5 shrink-0 text-amber-500" />
    </span>
  );
}

