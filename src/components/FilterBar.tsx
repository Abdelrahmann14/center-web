import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, SlidersHorizontal } from "@/components/icons";
import { MultiSelectFilter } from "./MultiSelectFilter";
import { Pagination } from "./Pagination";

/** One filterable column: how to label it and how to read its value off a row. */
export interface ColField<T> {
  key: string;
  label: string;
  value: (row: T) => string;
}

interface FilterBarProps<T> {
  /** The WHOLE dataset for the current search (chips filter these client-side). */
  rows: T[];
  fields: ColField<T>[];
  /** Server full-text search (whole dataset). */
  search: string;
  onSearch: (s: string) => void;
  searchPlaceholder?: string;
  /**
   * Rows per page. The bar paginates the FILTERED rows and renders the
   * pagination control itself, so the page window always follows the filters.
   */
  pageSize?: number;
  /** Renders the table body from the filtered rows of the current page. */
  children: (visibleRows: T[]) => React.ReactNode;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * The enterprise filter bar shared by the super-admin tables. Mirrors the admin
 * Students page: sticky search + advanced-settings popover (show/hide chips) +
 * searchable multi-select chips + removable value tags + live count.
 *
 * Chips filter the whole dataset the caller passed in, and only then does the
 * bar cut it into pages - filtering one server page at a time would scatter the
 * matches across the original page boundaries. The search box hits the server.
 * Uses only the app tokens (accent / slate / rose / white). RTL.
 */
export function FilterBar<T>({
  rows,
  fields,
  search,
  onSearch,
  searchPlaceholder,
  pageSize,
  children,
}: FilterBarProps<T>) {
  const [colF, setColF] = useState<Record<string, Set<string>>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const setCol = (k: string, s: Set<string>) => setColF((prev) => ({ ...prev, [k]: s }));

  const distinct = useMemo(() => {
    const out: Record<string, string[]> = {};
    fields.forEach((f) => {
      out[f.key] = Array.from(new Set(rows.map(f.value))).sort((a, b) => a.localeCompare(b, "ar"));
    });
    return out;
  }, [rows, fields]);

  const visibleRows = useMemo(
    () =>
      rows.filter((r) =>
        fields.every((f) => {
          const set = colF[f.key];
          return !set || set.size === 0 || set.has(f.value(r));
        }),
      ),
    [rows, fields, colF],
  );

  // Filter first, paginate second.
  const perPage = pageSize && pageSize > 0 ? pageSize : visibleRows.length || 1;
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / perPage));
  const [page, setPage] = useState(1);
  const current = Math.min(page, totalPages);
  const pageRows = pageSize ? visibleRows.slice((current - 1) * perPage, current * perPage) : visibleRows;

  // Any change to what is being filtered starts the window over at page 1.
  useEffect(() => {
    setPage(1);
  }, [search, colF]);

  const anyColFilter = Object.values(colF).some((s) => s && s.size > 0);
  const hasFilters = !!search || anyColFilter;
  const activeTags = fields.flatMap((f) =>
    Array.from(colF[f.key] ?? []).map((v) => ({ key: f.key, label: f.label, value: v })),
  );
  const shownFields = fields.filter((f) => !hidden.has(f.key));

  function clearFilters() {
    onSearch("");
    setColF({});
  }
  function removeTag(k: string, v: string) {
    setColF((prev) => {
      const set = new Set(prev[k]);
      set.delete(v);
      return { ...prev, [k]: set };
    });
  }

  // Close the settings popover on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <>
      {/* Sticky enterprise filter bar */}
      <div className="sticky top-0 z-20 -mx-4 mt-3 border-b border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6">
        {/* Row 1 - instant search + advanced settings */}
        <div className="flex items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder ?? "بحث..."}
              aria-label="بحث"
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-9 text-slate-800 shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {search && (
              <button
                onClick={() => onSearch("")}
                aria-label="مسح البحث"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {fields.length > 0 && (
            <div className="relative" ref={settingsRef}>
              <button
                onClick={() => setSettingsOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={settingsOpen}
                title="إعدادات التصفية"
                className={`flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                  settingsOpen
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                <SlidersHorizontal className="h-5 w-5" />
              </button>
              {settingsOpen && (
                <div className="animate-scale-up absolute left-0 top-full z-30 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                  <p className="px-2 py-1 text-xs font-semibold text-slate-400">الفلاتر الظاهرة</p>
                  <div className="max-h-72 overflow-auto">
                    {fields.map((f) => {
                      const shown = !hidden.has(f.key);
                      return (
                        <label
                          key={f.key}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={shown}
                            onChange={() =>
                              setHidden((prev) => {
                                const next = new Set(prev);
                                shown ? next.add(f.key) : next.delete(f.key);
                                return next;
                              })
                            }
                            className="h-4 w-4 accent-accent"
                          />
                          {f.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 2 - filter chips */}
        {shownFields.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {shownFields.map((f) => (
              <MultiSelectFilter
                key={f.key}
                label={f.label}
                options={distinct[f.key]}
                selected={colF[f.key] ?? EMPTY_SET}
                onChange={(s) => setCol(f.key, s)}
              />
            ))}
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="ms-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                <X className="h-4 w-4" />
                مسح الكل
              </button>
            )}
          </div>
        )}

        {/* Row 3 - active value tags */}
        {activeTags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {activeTags.map((t) => (
              <span
                key={`${t.key}:${t.value}`}
                className="animate-scale-up flex items-center gap-1 rounded-full bg-accent/10 py-1 pe-1 ps-2.5 text-xs font-medium text-accent"
              >
                <span className="text-accent/70">{t.label}:</span>
                {t.value}
                <button
                  onClick={() => removeTag(t.key, t.value)}
                  aria-label={`إزالة ${t.value}`}
                  className="rounded-full p-0.5 transition hover:bg-accent/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Result total - what the filters actually matched, not the raw dataset */}
      <div className="mt-4 text-sm text-slate-500">
        الإجمالي{" "}
        <span className="font-semibold text-slate-700">{visibleRows.length.toLocaleString("ar-EG")}</span>
      </div>

      {children(pageRows)}

      {pageSize != null && <Pagination current={current} totalPages={totalPages} onChange={setPage} />}
    </>
  );
}
