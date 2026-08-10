import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  X,
  Ban,
  FileChartColumn,
  Pencil,
  Users,
  SlidersHorizontal,
  Plus,
} from "lucide-react";
import { THEAD } from "@/components/tableStyles";
import { DeleteButton } from "@/components/DeleteButton";
import { Pagination } from "@/components/Pagination";
import { api, ApiError, qs } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { cachedGet, cachedGetAll, invalidate } from "@/lib/dataCache";
import { useDebounced } from "@/lib/useDebounced";
import { AuditCell } from "@/components/AuditCell";
import { usePageState } from "@/lib/pageState";
import { TRACK_OPTIONS } from "@/lib/tracks";
import { useAuth } from "@/auth/AuthContext";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { Select, ConfirmDialog, Money } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import {
  StudentForm,
  groupLabel,
  type Student,
  type StudentOptions,
  type Grade,
  type Group,
} from "./StudentForm";

const ROWS_OPTIONS = ["10", "25", "50"];

const Dash = () => <span className="block text-center text-slate-300">-</span>;


const EMPTY_SET: ReadonlySet<string> = new Set();

export default function StudentsPage() {
  const navigate = useNavigate();
  const { can, hasModule } = useAuth();
  const canCreate = can("STUDENT_CREATE");
  const canAnalytics = can("STUDENT_ANALYTICS");
  // The app column is meaningless for a workspace without the mobile app.
  const hasMobileApp = hasModule("MOBILE_APP");
  const [allRows, setAllRows] = useState<Student[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [options, setOptions] = useState<StudentOptions | null>(null);
  const [loading, setLoading] = useState(true);

  // Search persists across navigation (return as you left it). The full-text
  // search hits the server; the chip filters below run over the whole dataset
  // in the browser, and pagination is applied to the FILTERED rows.
  const [search, setSearch] = usePageState("students.search", "");
  const [rows, setRows] = usePageState("students.rows", "10");
  const [page, setPage] = usePageState("students.page", 1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Student | null>(null);

  // Searching and filtering happen on the server, so don't fire a request per
  // keystroke.
  const debouncedSearch = useDebounced(search);

  // Lookup lists are small and shared, so they stay plain cached arrays.
  useEffect(() => {
    Promise.all([
      cachedGet<Grade[]>("/grades"),
      cachedGet<Group[]>("/groups"),
      cachedGet<StudentOptions>("/students/options"),
    ])
      .then(([gr, gp, opt]) => {
        setGrades(gr);
        setGroups(gp);
        setOptions(opt);
      })
      .catch(() => {});
  }, []);

  // Filter keys are the backend record's component names and `sort` is the
  // entity property - both camelCase, unlike the snake_case response bodies.
  // No page/size here: `cachedGetAll` pulls every page of this search.
  const query = qs({
    search: debouncedSearch.trim(),
    sort: "createdAt,desc",
  });

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cachedGetAll<Student>(`/students${query}`)
      .then((data) => {
        // A slower earlier query must not overwrite a newer one's results.
        if (!cancelled) setAllRows(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  const reload = () => setReloadKey((n) => n + 1);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // ── Client-side chip filters (over the whole dataset). Never id / name /
  // created / updated. ──
  /**
   * A record is incomplete when any field the student form requires is missing -
   * whatever the reason (imported data, a record saved before a field existed,
   * a group that was later deleted). The track only counts when the student's
   * grade actually has tracks.
   */
  const incomplete = useMemo(() => {
    const trackKindByGrade = new Map(grades.map((g) => [g.name, g.track_kind]));
    return (s: Student) => {
      const kind = s.grade ? trackKindByGrade.get(s.grade) : undefined;
      const needsTrack = kind != null && TRACK_OPTIONS[kind].length > 0;
      return (
        !s.name?.trim() ||
        !s.grade?.trim() ||
        !s.school?.trim() ||
        !s.city?.trim() ||
        !s.gender ||
        !s.group_id ||
        s.student_phones.length === 0 ||
        s.parent_phones.length === 0 ||
        (needsTrack && !s.academic_track)
      );
    };
  }, [grades]);

  const colVal = useMemo(() => {
    const priceLabel = (s: Student) =>
      s.lesson_price == null ? "—" : s.lesson_price === 0 ? "معفي" : String(s.lesson_price);
    return {
      grade: (s: Student) => s.grade || "—",
      group: (s: Student) => {
        const g = s.group_id ? groupById.get(s.group_id) : undefined;
        return g ? groupLabel(g) : "—";
      },
      school: (s: Student) => s.school || "—",
      religion: (s: Student) => s.religion || "—",
      gender: (s: Student) => s.gender || "—",
      status: (s: Student) => (s.is_active ? "نشط" : "محظور"),
      data: (s: Student) => (incomplete(s) ? "بيانات ناقصة" : "بيانات مكتملة"),
      price: priceLabel,
      registered: (s: Student) => (s.registered ? "مُسجَّل" : "غير مُسجَّل"),
      google: (s: Student) => (s.google_synced ? "مُزامَن" : "غير مُزامَن"),
    } as const;
  }, [groupById, incomplete]);
  type ColKey = keyof typeof colVal;

  // The chip bar. Order = display order; each is a searchable multi-select.
  const FIELDS: { key: ColKey; label: string }[] = [
    { key: "grade", label: "الصف" },
    { key: "group", label: "المجموعة" },
    { key: "school", label: "المدرسة" },
    { key: "religion", label: "الديانة" },
    { key: "gender", label: "النوع" },
    { key: "status", label: "الحالة" },
    { key: "data", label: "اكتمال البيانات" },
    { key: "price", label: "السعر" },
    ...(hasMobileApp ? ([{ key: "registered", label: "التطبيق" }] as const) : []),
    { key: "google", label: "مزامنة Google" },
  ];
  const [hiddenFields, setHiddenFields] = useState<Set<ColKey>>(new Set());

  const [colF, setColF] = useState<Partial<Record<ColKey, Set<string>>>>({});
  const setCol = (k: ColKey, s: Set<string>) => setColF((prev) => ({ ...prev, [k]: s }));

  // Options come from the whole dataset, so a value that exists only on a later
  // page is still offered as a filter.
  const distinct = useMemo(() => {
    const out = {} as Record<ColKey, string[]>;
    (Object.keys(colVal) as ColKey[]).forEach((k) => {
      out[k] = Array.from(new Set(allRows.map(colVal[k]))).sort((a, b) => a.localeCompare(b, "ar"));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, colVal]);

  const filtered = useMemo(
    () =>
      allRows.filter((s) =>
        (Object.keys(colF) as ColKey[]).every((k) => {
          const set = colF[k];
          return !set || set.size === 0 || set.has(colVal[k](s));
        })
      ),
    [allRows, colF, colVal]
  );
  const anyColFilter = Object.values(colF).some((s) => s && s.size > 0);

  // Filter first, paginate second: the page window always slices the FILTERED
  // rows, so 50 matches at 10 per page are 5 full pages.
  const perPage = Number(rows) || 10;
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const current = Math.min(page, totalPages);
  const visibleRows = filtered.slice((current - 1) * perPage, current * perPage);

  // Reset to page 1 whenever the search, chip filters or page size change - but
  // NOT on mount, so a restored page survives navigation.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, rows, colF]);

  const hasFilters = !!search || anyColFilter;
  function clearFilters() {
    setSearch("");
    setColF({});
  }
  function removeTag(k: ColKey, v: string) {
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

  const activeTags = FIELDS.flatMap((f) =>
    Array.from(colF[f.key] ?? []).map((v) => ({ key: f.key, label: f.label, value: v })),
  );
  const shownFields = FIELDS.filter((f) => !hiddenFields.has(f.key));

  async function handleDelete(s: Student) {
    try {
      await api.del(`/students/${s.id}`);
      invalidate("/students"); // drops every cached page of the list
      reload();
      toast.success(`تم حذف "${s.name}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الطالب");
    } finally {
      setConfirmDelete(null);
    }
  }

  function handleSaved() {
    invalidate("/students");
    reload();
    setEditStudent(null);
  }

  return (
    <div>
      {/* Sticky enterprise filter bar */}
      <div className="sticky top-0 z-20 -mx-6 mt-3 border-b border-slate-200 bg-white px-6 py-3">
        {/* Row 1 — instant search + advanced settings */}
        <div className="flex items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو المدرسة أو رقم الهاتف..."
              aria-label="بحث"
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-9 text-slate-800 shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="مسح البحث"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
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
                  {FIELDS.map((f) => {
                    const shown = !hiddenFields.has(f.key);
                    return (
                      <label
                        key={f.key}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={shown}
                          onChange={() =>
                            setHiddenFields((prev) => {
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
          {canCreate && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 font-medium text-white shadow-sm transition hover:bg-accent-hover"
            >
              <Plus className="h-5 w-5" />
              طالب جديد
            </button>
          )}
        </div>

        {/* Row 2 — filter chips */}
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

        {/* Row 3 — active value tags */}
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

      {/* Result total + page size */}
      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>
          الإجمالي{" "}
          <span className="font-semibold text-slate-700">{totalCount.toLocaleString("ar-EG")}</span>
        </span>
        <div className="flex items-center gap-2">
          <span>عرض</span>
          <div className="w-20">
            <Select value={rows} onChange={setRows} options={ROWS_OPTIONS.map((r) => ({ value: r, label: r }))} />
          </div>
        </div>
      </div>

      {loading ? (
        <LoaderBlock />
      ) : (
        // No horizontal scroll: the table fits the frame, so the columns are
        // percentage-sized and the free-text ones truncate.
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full table-fixed text-right text-xs">
            <colgroup>
              <col className="w-[3.5%]" />
              <col className="w-[15%]" />
              {/* Phones are always exactly 11 digits, so these two are pinned to
                  that width in pixels rather than sharing the table's width. */}
              <col className="w-[104px]" />
              <col className="w-[104px]" />
              {/* School and group stay narrow: long names wrap to a second line
                  rather than widening the column. */}
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              {/* Gender / price / status / app / Google each hold one short value. */}
              <col className="w-[4%]" />
              <col className="w-[5%]" />
              <col className="w-[6%]" />
              {hasMobileApp && <col className="w-[5%]" />}
              <col className="w-[5%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
            </colgroup>
              <thead className={`${THEAD} font-medium`}>
                <tr>
                  <th className="px-2 py-2.5">#</th>
                  <th className="px-2 py-2.5">الطالب</th>
                  <th className="px-2 py-2.5">هاتف الطالب</th>
                  <th className="px-2 py-2.5">هاتف ولي الأمر</th>
                  <th className="px-2 py-2.5">المدرسة</th>
                  <th className="px-2 py-2.5">المجموعة</th>
                  <th className="px-2 py-2.5">النوع</th>
                  <th className="px-2 py-2.5">السعر</th>
                  <th className="px-2 py-2.5">الحالة</th>
                  {hasMobileApp && <th className="px-2 py-2.5">التطبيق</th>}
                  <th className="px-2 py-2.5">Google</th>
                  <th className="px-2 py-2.5">أنشئ في</th>
                  <th className="px-2 py-2.5">آخر تحديث</th>
                  <th className="px-2 py-2.5 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((s) => {
                  const g = s.group_id ? groupById.get(s.group_id) : undefined;
                  const missing = incomplete(s);
                  return (
                    <tr
                      key={s.id}
                      // Blocked wins over incomplete: it is the harder stop.
                      className={`h-14 transition ${
                        !s.is_active
                          ? "bg-rose-100 hover:bg-rose-200"
                          : missing
                            ? "bg-amber-100 hover:bg-amber-200"
                            : "hover:bg-slate-50/60"
                      }`}
                    >
                      <td className="px-2 font-medium text-slate-400">{s.serial}</td>
                      <td className="px-2">
                        <div className="truncate font-medium text-slate-800" title={s.name}>{s.name}</div>
                        <div className="truncate text-[11px] text-slate-400">{s.grade ?? "-"}</div>
                      </td>
                      <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                        {s.student_phones.length ? (
                          s.student_phones.map((p) => (
                            <span key={p} className="block truncate">{p}</span>
                          ))
                        ) : (
                          <Dash />
                        )}
                      </td>
                      <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                        {s.parent_phones.length ? (
                          s.parent_phones.map((p) => (
                            <span key={p} className="block truncate">{p}</span>
                          ))
                        ) : (
                          <Dash />
                        )}
                      </td>
                      {/* School and group wrap onto a second line instead of
                          being cut off - the column stays narrow either way. */}
                      <td className="px-2 leading-snug break-words text-slate-600">
                        {s.school || <Dash />}
                      </td>
                      <td className="px-2 leading-snug break-words text-slate-600">
                        {g ? groupLabel(g) : <Dash />}
                      </td>
                      <td className="px-2 text-slate-600">{s.gender || <Dash />}</td>
                      <td className="px-2">
                        {s.lesson_price == null ? (
                          <Dash />
                        ) : s.lesson_price === 0 ? (
                          <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                            معفي
                          </span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1">
                            <Money value={s.lesson_price} className="text-slate-700" />
                            {s.is_discounted && (
                              <span className="rounded-md bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                                مُخَفَّض
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      {/* Status only - the reason lives in the edit form. */}
                      <td className="px-2">
                        {s.is_active ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                            <span className="text-slate-600">نشط</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 font-medium text-rose-700">
                            <Ban className="h-3.5 w-3.5 shrink-0" />
                            محظور
                          </span>
                        )}
                      </td>
                      {hasMobileApp && (
                        <td className="px-2">
                          {s.registered ? (
                            <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">مُسجَّل</span>
                          ) : (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">غير مُسجَّل</span>
                          )}
                        </td>
                      )}
                      <td className="px-2">
                        {s.google_synced ? (
                          <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">مُزامَن</span>
                        ) : (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">غير مُزامَن</span>
                        )}
                      </td>
                      <td className="px-2"><AuditCell at={s.created_at} by={s.created_by} /></td>
                      <td className="px-2"><AuditCell at={s.updated_at} by={s.updated_by} /></td>
                      <td className="px-2">
                        <div className="flex items-center justify-center gap-2 text-slate-400">
                          {canAnalytics && (
                            <button
                              onClick={() => navigate(`/students/${s.id}/analytics`)}
                              title="تقرير الطالب"
                              className="transition hover:text-accent"
                            >
                              <FileChartColumn className="h-4 w-4" />
                            </button>
                          )}
                          <button onClick={() => setEditStudent(s)} title="تعديل" className="transition hover:text-accent">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <DeleteButton onClick={() => setConfirmDelete(s)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={hasMobileApp ? 14 : 13} className="py-16 text-center text-slate-400">
                      <Users className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                      {hasFilters || anyColFilter ? "لا توجد نتائج مطابقة" : "لا يوجد طلاب بعد"}
                    </td>
                  </tr>
                )}
              </tbody>
          </table>
        </div>
      )}

      {!loading && <Pagination current={current} totalPages={totalPages} onChange={setPage} />}

      {addOpen && options && (
        <StudentForm
          grades={grades}
          groups={groups}
          options={options}
          onClose={() => setAddOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {editStudent && options && (
        <StudentForm
          initial={editStudent}
          grades={grades}
          groups={groups}
          options={options}
          onClose={() => setEditStudent(null)}
          onSaved={handleSaved}
        />
      )}


      {confirmDelete && (
        <ConfirmDialog
          title="حذف الطالب"
          message={`هل أنت متأكد من حذف "${confirmDelete.name}"؟`}
          confirmLabel="حذف"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

