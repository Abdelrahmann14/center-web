import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  X,
  Eye,
  Users,
  CalendarDays,
  Pencil,
  BookOpenText,
} from "@/components/icons";
import { THEAD } from "@/components/tableStyles";
import { DeleteButton } from "@/components/DeleteButton";
import { Pagination } from "@/components/Pagination";
import { api, ApiError, isOfflineError, qs } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { useSync } from "@/sync/SyncProvider";
import { cachedGet, cachedGetAll, invalidate, useCachedGet } from "@/lib/dataCache";
import { useDebounced } from "@/lib/useDebounced";
import { useOnline } from "@/lib/useOnline";
import { usePageState } from "@/lib/pageState";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { Modal, ConfirmDialog, Select } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { LectureForm, type Lecture, type Grade } from "./LectureForm";
import { groupLabel, type Group } from "@/modules/students/StudentForm";
import { fmtDateTime } from "@/lib/datetime";
import { AuditCell } from "@/components/AuditCell";

const ROWS_OPTIONS = ["10", "25", "50"];

// The two exam states, spelled once so the chip options, the row labels and the
// filter all read the same word.
const EXAM_YES = "بامتحان";
const EXAM_NO = "بدون امتحان";

/** A lesson counts as recent when it was created within this many days. */
const RECENT_DAYS = 7;

export default function LecturesPage() {
  const navigate = useNavigate();
  const sync = useSync();
  const online = useOnline();
  const [allRows, setAllRows] = useState<Lecture[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);

  // Search + page size + page persist across navigation (return as you left it);
  // the chip filters below are transient, exactly as on the students page.
  const [search, setSearch] = usePageState("lectures.search", "");
  const [rows, setRows] = usePageState("lectures.rows", "25");
  const [page, setPage] = usePageState("lectures.page", 1);

  // Client-side chip filters over the whole loaded set - same system the
  // students page uses, so the two screens filter identically.
  const [gradeSel, setGradeSel] = useState<Set<string>>(new Set());
  const [examSel, setExamSel] = useState<Set<string>>(new Set());
  const [recentOnly, setRecentOnly] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [editLecture, setEditLecture] = useState<Lecture | null>(null);
  const [groupsFor, setGroupsFor] = useState<Lecture | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Lecture | null>(null);

  const debouncedSearch = useDebounced(search);

  useEffect(() => {
    cachedGet<Grade[]>("/grades").then(setGrades).catch(() => {});
  }, []);

  // The search hits the server; the chip filters run over the whole result set
  // in the browser, and pagination is applied to the FILTERED rows - so a chip
  // can never hide matches on a page it did not happen to load.
  const query = qs({ search: debouncedSearch.trim(), sort: "createdAt,desc" });

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cachedGetAll<Lecture>(`/lectures${query}`)
      .then((data) => !cancelled && setAllRows(data))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  // Grade options come from the whole dataset, so a grade that appears only on a
  // later page is still offered. Sorted in Arabic collation.
  const gradeOptions = useMemo(
    () =>
      Array.from(new Set(allRows.map((l) => l.grade || "—"))).sort((a, b) =>
        a.localeCompare(b, "ar"),
      ),
    [allRows],
  );
  const examLabel = (l: Lecture) => (l.has_exam ? EXAM_YES : EXAM_NO);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    return allRows.filter(
      (l) =>
        (gradeSel.size === 0 || gradeSel.has(l.grade || "—")) &&
        (examSel.size === 0 || examSel.has(examLabel(l))) &&
        (!recentOnly || new Date(l.created_at).getTime() >= cutoff),
    );
  }, [allRows, gradeSel, examSel, recentOnly]);

  // Filter first, paginate second: the page window slices the FILTERED rows.
  const perPage = Number(rows) || 25;
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const current = Math.min(page, totalPages);
  const visibleRows = filtered.slice((current - 1) * perPage, current * perPage);

  // Reset to page 1 when a filter changes, but not on mount (restored page).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, rows, gradeSel, examSel, recentOnly]);

  const anyChip = gradeSel.size > 0 || examSel.size > 0 || recentOnly;
  const hasFilters = !!search || anyChip;
  function clearFilters() {
    setSearch("");
    setGradeSel(new Set());
    setExamSel(new Set());
    setRecentOnly(false);
  }
  const without = (set: Set<string>, v: string) => {
    const next = new Set(set);
    next.delete(v);
    return next;
  };

  // Row 3 - one removable pill per active value, mirroring the students page.
  const activeTags: { id: string; label: string; value: string; remove: () => void }[] = [
    ...Array.from(gradeSel).map((v) => ({
      id: `grade:${v}`,
      label: "الصف",
      value: v,
      remove: () => setGradeSel(without(gradeSel, v)),
    })),
    ...Array.from(examSel).map((v) => ({
      id: `exam:${v}`,
      label: "الاختبار",
      value: v,
      remove: () => setExamSel(without(examSel, v)),
    })),
    ...(recentOnly
      ? [{ id: "recent", label: "المدة", value: `آخر ${RECENT_DAYS} أيام`, remove: () => setRecentOnly(false) }]
      : []),
  ];

  function upsert() {
    invalidate("/lectures");
    reload();
  }

  async function handleDelete(l: Lecture) {
    const done = (queued: boolean) => {
      invalidate("/lectures");
      reload();
      toast.success(
        queued ? `تم حذف "${l.name}" - بانتظار المزامنة عند عودة الاتصال` : `تم حذف "${l.name}"`,
      );
    };
    try {
      if (!online && sync.ready) {
        await sync.queueLectureDelete(l.id);
        done(true);
        return;
      }
      await api.del(`/lectures/${l.id}`);
      done(false);
    } catch (err) {
      if (isOfflineError(err) && sync.ready) {
        await sync.queueLectureDelete(l.id);
        done(true);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الحصة");
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div>
      {/* Sticky filter bar - same structure as the students page. */}
      <div className="sticky top-0 z-20 -mx-4 mt-3 border-b border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6">
        {/* Row 1 - search + add. It wraps on a phone: side by side, a 240px
            minimum on the search plus the button came to more than the frame is
            wide, so the button was pushed off the edge of the screen. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full min-w-0 flex-1 sm:w-auto sm:min-w-[240px]">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم الحصة أو الاختبار..."
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
          <button
            onClick={() => setShowAdd(true)}
            className="flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-medium text-white shadow-sm transition hover:bg-accent-hover sm:w-auto"
          >
            <Plus className="h-5 w-5" />
            حصة جديدة
          </button>
        </div>

        {/* Row 2 - filter chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MultiSelectFilter
            label="الصف"
            options={gradeOptions}
            selected={gradeSel}
            onChange={setGradeSel}
          />
          <MultiSelectFilter
            label="الاختبار"
            options={[EXAM_YES, EXAM_NO]}
            selected={examSel}
            onChange={setExamSel}
          />
          {/* Stands apart from the chips because it narrows by a fact about the
              row (its age) rather than by one of its column values. */}
          <button
            type="button"
            onClick={() => setRecentOnly((v) => !v)}
            title="الحصص المُنشأة خلال آخر سبعة أيام"
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              recentOnly
                ? "border-accent bg-accent/10 text-accent"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <CalendarDays className="h-4 w-4" />
            آخر {RECENT_DAYS} أيام
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
                key={t.id}
                className="animate-scale-up flex items-center gap-1 rounded-full bg-accent/10 py-1 pe-1 ps-2.5 text-xs font-medium text-accent"
              >
                <span className="text-accent/70">{t.label}:</span>
                {t.value}
                <button
                  onClick={t.remove}
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
      {!loading && (
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
      )}

      {loading ? (
        <LoaderBlock />
      ) : (
        // No horizontal scroll: the columns are percentage-sized and the free
        // text ones wrap onto a second line.
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[62vh] overflow-y-auto scrollbar-thin">
            <table className="w-full min-w-[860px] table-fixed text-right text-xs">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[7%]" />
                <col className="w-[13%]" />
                <col className="w-[6%]" />
                <col className="w-[16%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead className={`sticky top-0 ${THEAD} text-xs font-medium`}>
                <tr>
                  <th className="px-3 py-3">الحصة</th>
                  <th className="px-3 py-3">الصف</th>
                  <th className="px-3 py-3">الاختبار</th>
                  <th className="px-3 py-3">الدرجة</th>
                  <th className="px-3 py-3">الواجب</th>
                  <th className="px-3 py-3">أُنشئت</th>
                  <th className="px-3 py-3">آخر تعديل</th>
                  <th className="px-3 py-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((l) => (
                  // The whole row is the target: click anywhere on it to open the
                  // groups that sat this lesson. The actions cell stops the click
                  // so edit/delete don't also open the dialog.
                  <tr
                    key={l.id}
                    onClick={() => setGroupsFor(l)}
                    title="عرض المجموعات التي أخذت هذه الحصة"
                    className="h-14 cursor-pointer transition hover:bg-accent/[0.06]"
                  >
                    <td className="px-3 font-medium leading-snug break-words text-accent">{l.name}</td>
                    <td className="px-3 font-medium text-slate-700">
                      {l.grade || <span className="text-slate-400">-</span>}
                    </td>
                    <td className="px-3 leading-snug break-words text-slate-600">
                      {l.has_exam ? l.exam_name || "-" : <span className="text-slate-400">{EXAM_NO}</span>}
                    </td>
                    <td className="px-3 tabular-nums text-slate-600">{l.has_exam ? l.exam_grade || "-" : "-"}</td>
                    <td className="px-3 leading-snug break-words text-slate-600">{l.homework || "-"}</td>
                    <td className="px-3"><AuditCell at={l.created_at} by={l.created_by} /></td>
                    <td className="px-3"><AuditCell at={l.updated_at} by={l.updated_by} /></td>
                    <td className="px-3">
                      <div
                        className="flex items-center justify-center gap-2 text-slate-400"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => setEditLecture(l)}
                          title="تعديل"
                          className="transition hover:text-accent"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <DeleteButton onClick={() => setConfirmDelete(l)} />
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-400">
                      <BookOpenText className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                      {hasFilters ? "لا توجد نتائج مطابقة" : "لا توجد حصص بعد"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && <Pagination current={current} totalPages={totalPages} onChange={setPage} />}

      {showAdd && (
        <LectureForm
          grades={grades}
          onClose={() => setShowAdd(false)}
          onSaved={upsert}
        />
      )}

      {editLecture && (
        <LectureForm
          initial={editLecture}
          grades={grades}
          onClose={() => setEditLecture(null)}
          onSaved={upsert}
        />
      )}

      {groupsFor && <LessonGroupsModal lecture={groupsFor} onClose={() => setGroupsFor(null)} navigate={navigate} />}

      {confirmDelete && (
        <ConfirmDialog
          title="حذف الحصة"
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

interface LessonGroup {
  group_id: string | null;
  count: number;
  /** When the group sat this lesson - its first attendance row. */
  attended_at: string | null;
}

/**
 * The groups that actually attended one lesson. This dialog is the only door to
 * the recorded data: each row's عرض opens that lesson-group's students page.
 */
function LessonGroupsModal({
  lecture,
  onClose,
  navigate,
}: {
  lecture: Lecture;
  onClose: () => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { data: groups } = useCachedGet<Group[]>("/groups");
  const [rows, setRows] = useState<LessonGroup[] | null>(null);

  useEffect(() => {
    api
      .get<LessonGroup[]>(`/registrations/groups?lecture_id=${lecture.id}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [lecture.id]);

  const groupById = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g])), [groups]);
  const label = (id: string | null) => {
    if (!id) return "بدون مجموعة";
    const g = groupById.get(id);
    return g ? groupLabel(g) : "مجموعة محذوفة";
  };

  const total = (rows ?? []).reduce((s, r) => s + r.count, 0);

  /**
   * Newest group at the top, oldest at the bottom, numbered by the order they
   * actually sat the lesson - so #1 is the first group to take it and sits at
   * the foot of the list, the way a stack of sheets builds up.
   *
   * <p>The server orders these by head count, which says nothing about sequence.
   * A group with no recorded time has no place in the sequence, so it sinks to
   * the bottom rather than claiming to be first.
   */
  const ordered = useMemo(() => {
    const byTime = [...(rows ?? [])].sort((a, b) => {
      if (!a.attended_at) return 1;
      if (!b.attended_at) return -1;
      return a.attended_at.localeCompare(b.attended_at);
    });
    // Number in the order they sat it, then flip so the newest reads first.
    return byTime.map((r, i) => ({ row: r, order: i + 1 })).reverse();
  }, [rows]);

  return (
    <Modal
      size="lg"
      title={`مجموعات حصة "${lecture.name}"`}
      subtitle={rows ? `الحاضرون ${total.toLocaleString("ar-EG")}` : undefined}
      onClose={onClose}
    >
      {rows === null ? (
        <LoaderBlock />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400">
          لم تحضر أي مجموعة هذه الحصة
        </div>
      ) : (
        // A visible rule between groups: this list is read as separate sittings
        // of one lesson, not as one block of text.
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {ordered.map(({ row: r, order }) => (
            <div
              key={r.group_id ?? "none"}
              className="flex items-center justify-between gap-4 px-3 py-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="font-ledger mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-dark/8 text-xs font-bold text-dark/70">
                  {order}
                </span>
                <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-slate-800">
                  <BookOpenText className="h-4 w-4 text-accent" />
                  {label(r.group_id)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {r.count.toLocaleString("ar-EG")} طالب
                  </span>
                  {/* When this group actually sat the lesson. */}
                  {r.attended_at && (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      <span dir="ltr">{fmtDateTime(r.attended_at)}</span>
                    </span>
                  )}
                </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {/* No send buttons here on purpose: they now live inside the
                    group's own roster, next to the students they would message. */}
                <button
                  onClick={() => navigate(`/lectures/${lecture.id}/groups/${r.group_id ?? "none"}`)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover"
                >
                  <Eye className="h-4 w-4" />
                  عرض
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
