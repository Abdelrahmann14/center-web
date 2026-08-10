import { useEffect, useRef, useState } from "react";
import { Plus, ChevronDown } from "lucide-react";

interface Option {
  key: string;
  label: string;
}

/** Home "اضافة" menu - opens on click, closes on outside-click / Esc. */
export function AddMenu({
  options,
  onSelect,
}: {
  options: Option[];
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
      >
        <Plus className="h-5 w-5" />
        اضافة
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1.5 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-fade-in">
          {options.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                onSelect(o.key);
                setOpen(false);
              }}
              className="block w-full rounded-lg px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-slate-100"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
