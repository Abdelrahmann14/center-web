import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  X,
  Ban,
  Barcode,
  FileChartColumn,
  Loader2,
  Pencil,
  Trash2,
  Users,
  SlidersHorizontal,
  Plus,
  MessageCircleOff,
} from "@/components/icons";
import { THEAD } from "@/components/tableStyles";
import { RowActionsMenu, type RowAction } from "@/components/RowActionsMenu";
import { Pagination } from "@/components/Pagination";
import { api, ApiError, isOfflineError, qs } from "@/lib/api";
import { useOnline } from "@/lib/useOnline";
import { useSync } from "@/sync/SyncProvider";
import { toast } from "@/components/ui/toast";
import { cachedGet, cachedGetAll, invalidate } from "@/lib/dataCache";
import { useDebounced } from "@/lib/useDebounced";
import { AuditCell } from "@/components/AuditCell";
import { usePageState } from "@/lib/pageState";
import { TRACK_OPTIONS } from "@/lib/tracks";
import { useAuth } from "@/auth/AuthContext";
import { useBarcodeScanner } from "@/lib/useBarcodeScanner";
import {
  STUDENT_SEARCH_PLACEHOLDER,
  matchesStudentSearch,
  searchModeLabel,
} from "@/lib/studentSearch";
import { isFullName } from "@/lib/studentName";
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
import { StudentDetails } from "./StudentDetails";

const ROWS_OPTIONS = ["10", "25", "50"];

const Dash = () => <span className="block text-center text-slate-300">-</span>;


const EMPTY_SET: ReadonlySet<string> = new Set();

export default function StudentsPage() {
  const navigate = useNavigate();
  const { can, hasModule } = useAuth();
  const sync = useSync();
  const online = useOnline();
  const canCreate = can("STUDENT_CREATE");
  const canUpdate = can("STUDENT_UPDATE");
  const canDelete = can("STUDENT_DELETE");
  const canAnalytics = can("STUDENT_ANALYTICS");
  // Same permission the server puts on POST /students/{id}/barcode/send.
  const canSendBarcode = can("STUDENT_REPORT_SEND");
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
  const [viewStudent, setViewStudent] = useState<Student | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Student | null>(null);
  /** Id of the student whose barcode is being sent, so only that row spins. */
  const [sendingBarcode, setSendingBarcode] = useState<string | null>(null);

  /**
   * A scanned code IS a student code, so it goes straight into the search box -
   * the shared rule reads a digit string that does not start with 0 as a code,
   * which narrows the table to that one student. One behaviour, two ways in.
   */
  function onScanned(code: string) {
    const digits = code.replace(/\D/g, "");
    setSearch(digits || code);
    setPage(1);
  }

  // A desk scanner typing into the page while focus is elsewhere.
  useBarcodeScanner(onScanned);

  // Searching and filtering happen on the server, so don't fire a request per
  // keystroke.
  const debouncedSearch = useDebounced(search);

  // Small shared lookup lists, loaded once through the SWR cache.
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
  // No page/size here: `cachedGetAll` pulls every page of this search, so the
  // chip filters below can run over the whole dataset.
  //
  // `whatsappMissing` narrows the query to everyone whose numbers are known NOT
  // to be on WhatsApp - a server-side fact, kept in the workspace's number cache.
  const [waMissingOnly, setWaMissingOnly] = useState(false);

  const query = qs({
    search: debouncedSearch.trim(),
    whatsappMissing: waMissingOnly ? "true" : "",
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
   *
   * <p>A name shorter than four parts counts too. Two parts now SAVE fine - the
   * form no longer refuses them - but the quadruple is still the complete
   * Egyptian name, so a short one leaves the row amber and chase-able instead of
   * blocking whoever was trying to enter the student.
   */
  const incomplete = useMemo(() => {
    const trackKindByGrade = new Map(grades.map((g) => [g.name, g.track_kind]));
    return (s: Student) => {
      const kind = s.grade ? trackKindByGrade.get(s.grade) : undefined;
      const needsTrack = kind != null && TRACK_OPTIONS[kind].length > 0;
      return (
        !isFullName(s.name) ||
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

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim();
    return allRows.filter(
      (s) =>
        matchesStudentSearch(s, term) &&
        (Object.keys(colF) as ColKey[]).every((k) => {
          const set = colF[k];
          return !set || set.size === 0 || set.has(colVal[k](s));
        })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, colF, colVal, debouncedSearch]);
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
  }, [debouncedSearch, rows, colF, waMissingOnly]);

  const hasFilters = !!search || anyColFilter || waMissingOnly;
  function clearFilters() {
    setSearch("");
    setColF({});
    setWaMissingOnly(false);
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

  /**
   * Send the student their barcode card, straight from the row.
   *
   * <p>No confirmation step on purpose: it is one student, one card, to their own
   * number, and the desk needs it to be one click. It is NOT queued when offline
   * either - the card is rendered server-side at send time, so there is nothing
   * for the browser to hold on to; the button is simply disabled instead.
   */
  async function sendBarcode(s: Student) {
    setSendingBarcode(s.id);
    try {
      await api.post(`/students/${s.id}/barcode/send`);
      toast.success(`تم إرسال الباركود إلى ${s.name}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر إرسال الباركود");
    } finally {
      setSendingBarcode(null);
    }
  }

  async function handleDelete(s: Student) {
    const done = (queued: boolean) => {
      invalidate("/students"); // drops every cached page of the list
      reload();
      toast.success(
        queued ? `تم حذف "${s.name}" - بانتظار المزامنة عند عودة الاتصال` : `تم حذف "${s.name}"`,
      );
    };
    try {
      // Offline the delete is queued rather than refused. A student deleted from
      // the mirror is gone from every screen at once, and the server applies the
      // same delete on reconnect - where deleting an already-deleted student is
      // the outcome asked for, not an error.
      if (!online && sync.ready) {
        await sync.queueStudentDelete(s.id);
        done(true);
        return;
      }
      await api.del(`/students/${s.id}`);
      done(false);
    } catch (err) {
      if (isOfflineError(err) && sync.ready) {
        await sync.queueStudentDelete(s.id);
        done(true);
        return;
      }
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
      <div className="sticky top-0 z-20 -mx-4 mt-3 border-b border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6">
        {/* Row 1 - instant search + advanced settings */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative order-1 w-full min-w-[200px] flex-1 sm:w-auto">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputMode="search"
              placeholder={STUDENT_SEARCH_PLACEHOLDER}
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
            {/* Says which of the three searches is running, so the leading-zero
                rule is discoverable instead of folklore. */}
            {searchModeLabel(search) && (
              <span className="pointer-events-none absolute -bottom-4 right-1 text-[11px] text-slate-400">
                {searchModeLabel(search)}
              </span>
            )}
          </div>
          <div className="relative order-2" ref={settingsRef}>
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
              className="order-4 flex h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 font-medium text-white shadow-sm transition hover:bg-accent-hover"
            >
              <Plus className="h-5 w-5" />
              طالب جديد
            </button>
          )}
        </div>

        {/* Row 2 - filter chips */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {shownFields.map((f) => (
            <MultiSelectFilter
              key={f.key}
              label={f.label}
              options={distinct[f.key]}
              selected={colF[f.key] ?? EMPTY_SET}
              onChange={(s) => setCol(f.key, s)}
            />
          ))}
          {/* Stands apart from the chips because it narrows the query rather
              than the loaded rows, and because it answers one recurring job:
              find the families we cannot reach on WhatsApp. */}
          <button
            type="button"
            onClick={() => setWaMissingOnly((v) => !v)}
            title="الطلاب الذين ثبت أن أرقامهم ليست على واتساب"
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              waMissingOnly
                ? "border-rose-300 bg-rose-50 text-rose-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <MessageCircleOff className="h-4 w-4" />
            بدون واتساب
          </button>
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

      {/* Result total + row-colour legend + page size */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-y-2 text-sm text-slate-500">
        <span>
          الإجمالي{" "}
          <span className="font-semibold text-slate-700">{totalCount.toLocaleString("ar-EG")}</span>
        </span>
        {/* What the coloured rows below mean. The swatches carry the same fill
            the rows use, so the key reads as a direct sample, not a guess. */}
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-100 ring-1 ring-amber-400" />
            بيانات ناقصة
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-rose-100 ring-1 ring-rose-400" />
            محظور
          </span>
        </div>
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
        // Eleven columns as percentage shares of the frame, which works down to
        // a laptop and breaks on a phone: at 375px each share is about fourteen
        // pixels and every cell turns into a column of single letters. The
        // shares are kept - they are right whenever there is room - and a floor
        // is put under them, so on a narrow screen the TABLE scrolls sideways
        // inside its own box instead of the whole page doing it.
        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1000px] table-fixed text-right text-sm">
            <colgroup>
              {/* Shares, adding up to exactly 100. App and Google columns moved
                  into the row-detail view, so the freed width goes to the
                  readable free-text columns. */}
              <col className="w-[4%]" />
              <col className="w-[19%]" />
              {/* The phones carry eleven digits, so they take the widest share
                  after the name. */}
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              {/* School and group both wrap onto a second line when a name runs
                  long, so nothing is cut off. */}
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              {/* Price / status sized to their widest value: a three-digit price
                  and "محظور" (with its icon). Gender moved under the name as a
                  ♂/♀ mark, so it no longer needs a column. */}
              <col className="w-[5%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              {/* One menu button, so the narrowest column on the table. */}
              <col className="w-[5%]" />
            </colgroup>
              <thead className={`${THEAD} font-medium`}>
                <tr>
                  <th className="px-2 py-2.5">#</th>
                  <th className="px-2 py-2.5">الطالب</th>
                  <th className="px-2 py-2.5">رقم الطالب</th>
                  <th className="px-2 py-2.5">رقم ولي الأمر</th>
                  <th className="px-2 py-2.5">المدرسة</th>
                  <th className="px-2 py-2.5">المجموعة</th>
                  <th className="px-2 py-2.5">السعر</th>
                  <th className="px-2 py-2.5">الحالة</th>
                  <th className="px-2 py-2.5">أنشئ في</th>
                  <th className="px-2 py-2.5">آخر تحديث</th>
                  <th className="px-2 py-2.5 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((s) => {
                  const g = s.group_id ? groupById.get(s.group_id) : undefined;
                  const missing = incomplete(s);
                  // Each action is gated by its own permission, so a view-only
                  // assistant sees none of them - and then the menu button itself
                  // is hidden rather than opening on an empty list.
                  const rowActions: RowAction[] = [
                    ...(canSendBarcode
                      ? [
                          {
                            key: "barcode",
                            label: sendingBarcode === s.id ? "جارٍ الإرسال…" : "إرسال الباركود",
                            icon: sendingBarcode === s.id ? Loader2 : Barcode,
                            onSelect: () => sendBarcode(s),
                            disabled: sendingBarcode === s.id || !online || s.student_phones.length === 0,
                            title: !online
                              ? "لا يوجد اتصال بالإنترنت"
                              : s.student_phones.length === 0
                                ? "لا يوجد رقم هاتف للطالب"
                                : "إرسال الباركود للطالب عبر واتساب",
                          },
                        ]
                      : []),
                    ...(canAnalytics
                      ? [
                          {
                            key: "analytics",
                            label: "تقرير الطالب",
                            icon: FileChartColumn,
                            onSelect: () => navigate(`/students/${s.id}/analytics`),
                          },
                        ]
                      : []),
                    ...(canUpdate
                      ? [{ key: "edit", label: "تعديل", icon: Pencil, onSelect: () => setEditStudent(s) }]
                      : []),
                    ...(canDelete
                      ? [
                          {
                            key: "delete",
                            label: "حذف",
                            icon: Trash2,
                            onSelect: () => setConfirmDelete(s),
                            danger: true,
                          },
                        ]
                      : []),
                  ];
                  return (
                    <tr
                      key={s.id}
                      // The whole row opens the full detail view; the action
                      // buttons stop propagation so they still do their own thing.
                      onClick={() => setViewStudent(s)}
                      // Blocked wins over incomplete: it is the harder stop.
                      className={`h-14 cursor-pointer transition ${
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
                        {/* Grade with the student's sex as a medical ♂/♀ mark -
                            the old "النوع" column folded into one glyph here. */}
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span className="truncate">{s.grade ?? "-"}</span>
                          {s.gender && (
                            <span
                              title={s.gender}
                              className={`text-sm leading-none ${
                                s.gender === "أنثى" ? "text-pink-500" : "text-sky-600"
                              }`}
                            >
                              {s.gender === "أنثى" ? "♀" : "♂"}
                            </span>
                          )}
                        </div>
                      </td>
                      {/* A number is never broken across two lines; on a frame
                          too narrow for eleven digits it truncates and the whole
                          number stays available on hover. */}
                      <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                        {s.student_phones.length ? (
                          s.student_phones.map((p) => (
                            <span key={p} className="block truncate" title={p}>{p}</span>
                          ))
                        ) : (
                          <Dash />
                        )}
                      </td>
                      <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                        {s.parent_phones.length ? (
                          s.parent_phones.map((p) => (
                            <span key={p} className="block truncate" title={p}>{p}</span>
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
                      <td className="px-2"><AuditCell at={s.created_at} by={s.created_by} /></td>
                      <td className="px-2"><AuditCell at={s.updated_at} by={s.updated_by} /></td>
                      {/* One menu instead of a strip of icons: every action
                          keeps its name and the column keeps its width. */}
                      <td className="px-2" onClick={(e) => e.stopPropagation()}>
                        {rowActions.length > 0 && <RowActionsMenu actions={rowActions} />}
                      </td>
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-16 text-center text-slate-400">
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

      {viewStudent && (
        <StudentDetails
          student={viewStudent}
          groups={groups}
          hasMobileApp={hasMobileApp}
          onClose={() => setViewStudent(null)}
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

