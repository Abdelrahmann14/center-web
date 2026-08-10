import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

/** At/above this many options the dropdown gains a search box + select-all. */
const SEARCH_THRESHOLD = 8;

export interface MultiSelectFilterProps {
  label: string;
  options: string[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Optional leading icon shown in the chip. */
  icon?: React.ReactNode;
}

/**
 * A filter chip that opens a keyboard-navigable, multi-select popover. Small,
 * fixed option sets (gender, status, yes/no, …) show their options directly for
 * speed; large sets (schools, groups, …) get a search box and select-all. Uses
 * only the app's tokens: accent (brand), slate (neutral), rose (danger). RTL.
 */
export function MultiSelectFilter({ label, options, selected, onChange, icon }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const optRefs = useRef<(HTMLLIElement | null)[]>([]);

  const searchable = options.length >= SEARCH_THRESHOLD;

  const filtered = useMemo(
    () => (searchable ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : options),
    [options, q, searchable],
  );

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHi(0);
    const t = setTimeout(() => (searchable ? inputRef.current : listRef.current)?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, searchable]);

  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    optRefs.current[hi]?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const count = selected.size;
  const active = count > 0;
  const allShown = filtered.length > 0 && filtered.every((o) => selected.has(o));

  function toggle(v: string) {
    const next = new Set(selected);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange(next);
  }
  function toggleAllShown() {
    const next = new Set(selected);
    if (allShown) filtered.forEach((o) => next.delete(o));
    else filtered.forEach((o) => next.add(o));
    onChange(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter" || (e.key === " " && !searchable)) {
      e.preventDefault();
      if (filtered[hi]) toggle(filtered[hi]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Home") {
      setHi(0);
    } else if (e.key === "End") {
      setHi(filtered.length - 1);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          active
            ? "border-accent bg-accent/10 text-accent"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        {icon}
        {label}
        {active && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-white">
            {count.toLocaleString("ar-EG")}
          </span>
        )}
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="animate-scale-up absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          {searchable && (
            <>
              <div className="p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={`بحث في ${label}`}
                    aria-label={`بحث في ${label}`}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-8 pl-2 text-sm outline-none transition focus:border-accent focus:bg-white"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between border-y border-slate-100 px-3 py-1.5 text-xs">
                <button type="button" onClick={toggleAllShown} className="font-medium text-accent transition hover:underline">
                  {allShown ? "إلغاء تحديد الظاهر" : "تحديد الكل"}
                </button>
                <button
                  type="button"
                  onClick={() => onChange(new Set())}
                  disabled={!active}
                  className="font-medium text-slate-400 transition enabled:hover:text-rose-600 disabled:opacity-40"
                >
                  مسح
                </button>
              </div>
            </>
          )}

          <ul
            ref={listRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            tabIndex={searchable ? -1 : 0}
            onKeyDown={searchable ? undefined : onKeyDown}
            className="max-h-60 overflow-auto p-1 focus:outline-none"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-400">لا توجد نتائج</li>
            ) : (
              filtered.map((o, i) => {
                const on = selected.has(o);
                return (
                  <li
                    key={o}
                    ref={(el) => {
                      optRefs.current[i] = el;
                    }}
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => toggle(o)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
                      i === hi ? "bg-accent/10" : ""
                    }`}
                  >
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition ${
                        on ? "border-accent bg-accent text-white" : "border-slate-300"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate text-slate-700">{o}</span>
                  </li>
                );
              })
            )}
          </ul>

          {!searchable && active && (
            <div className="border-t border-slate-100 p-1">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="w-full rounded-lg py-1.5 text-xs font-medium text-slate-400 transition hover:text-rose-600"
              >
                مسح
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
