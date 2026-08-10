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
} from "lucide-react";
import { THEAD } from "@/components/tableStyles";
import { DeleteButton } from "@/components/DeleteButton";
import { Pagination } from "@/components/Pagination";
import { api, ApiError, qs, type Page } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { cachedGet, invalidate, useCachedGet } from "@/lib/dataCache";
import { useDebounced } from "@/lib/useDebounced";
import { usePageState } from "@/lib/pageState";
import { Modal, ConfirmDialog, Select } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { LectureForm, type Lecture, type Grade } from "./LectureForm";
import { groupLabel, type Group } from "@/modules/students/StudentForm";
import { fmtDateTime } from "@/lib/datetime";
import { AuditCell } from "@/components/AuditCell";

interface GradeCount {
  grade: string | null;
  count: number;
}

const ROWS_OPTIONS = ["10", "25", "50"];


export default function LecturesPage() {
  const [pageData, setPageData] = useState<Page<Lecture> | null>(null);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [counts, setCounts] = useState<GradeCount[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = usePageState("lectures.search", "");
  const [fGrade, setFGrade] = usePageState("lectures.fGrade", "");
  const [rows, setRows] = usePageState("lectures.rows", "25");
  const [page, setPage] = usePageState("lectures.page", 1);

  const [showAdd, setShowAdd] = useState(false);
  const [editLecture, setEditLecture] = useState<Lecture | null>(null);
  const [groupsFor, setGroupsFor] = useState<Lecture | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Lecture | null>(null);

  const debouncedSearch = useDebounced(search);

  // Lookups: grades feed the tabs, counts label them. Both are small arrays.
  function loadCounts() {
    cachedGet<GradeCount[]>("/lectures/grade-counts", true).then(setCounts).catch(() => {});
  }
  useEffect(() => {
    cachedGet<Grade[]>("/grades").then(setGrades).catch(() => {});
    loadCounts();
  }, []);

  // camelCase filter keys + entity sort property (see StudentsPage).
  const query = qs({
    search: debouncedSearch.trim(),
    grade: fGrade,
    page: page - 1,
    size: rows,
    sort: "createdAt,desc",
  });

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => {
    setReloadKey((n) => n + 1);
    loadCounts();
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cachedGet<Page<Lecture>>(`/lectures${query}`)
      .then((data) => !cancelled && setPageData(data))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  // Reset to page 1 when the filters change, but not on mount (restored page).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setPage(1);
  }, [debouncedSearch, fGrade, rows]);

  const lectures = pageData?.content ?? [];
  const totalCount = pageData?.total_elements ?? 0;
  const totalPages = Math.max(1, pageData?.total_pages ?? 1);
  const current = Math.min(page, totalPages);
  const countFor = (grade: string) => counts.find((c) => c.grade === grade)?.count ?? 0;
  const totalLessons = useMemo(() => counts.reduce((s, c) => s + c.count, 0), [counts]);

  function upsert() {
    invalidate("/lectures");
    reload();
  }

  async function handleDelete(l: Lecture) {
    try {
      await api.del(`/lectures/${l.id}`);
      invalidate("/lectures");
      reload();
      toast.success(`تم حذف "${l.name}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حذف الحصة");
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الحصة أو الاختبار..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-11 pl-4 text-slate-800 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        {search && (
          <button
            onClick={() => setSearch("")}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
            مسح
          </button>
        )}
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          حصة جديدة
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[{ name: "" }, ...grades].map((g) => {
          const active = fGrade === g.name;
          const label = g.name || "الكل";
          const count = g.name === "" ? totalLessons : countFor(g.name);
          return (
            <button
              key={g.name || "all"}
              onClick={() => setFGrade(g.name)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-accent text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
              <span
                className={`rounded-md px-1.5 text-xs ${
                  active ? "bg-white/20" : "bg-slate-100 text-slate-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Result total + page size, above the table (same as the students page). */}
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
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[62vh] overflow-y-auto scrollbar-thin">
            <table className="w-full table-fixed text-right text-xs">
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
                {lectures.map((l) => (
                  // The row itself is inert: the recorded data is reachable
                  // only through عرض المجموعات -> عرض.
                  <tr key={l.id} className="h-14 transition hover:bg-slate-50/60">
                    <td className="px-3 font-medium leading-snug break-words text-accent">{l.name}</td>
                    <td className="px-3 leading-snug break-words text-slate-600">{l.grade || "-"}</td>
                    <td className="px-3 leading-snug break-words text-slate-600">{l.exam_name || "-"}</td>
                    <td className="px-3 tabular-nums text-slate-600">{l.exam_grade || "-"}</td>
                    <td className="px-3 leading-snug break-words text-slate-600">{l.homework || "-"}</td>
                    <td className="px-3"><AuditCell at={l.created_at} by={l.created_by} /></td>
                    <td className="px-3"><AuditCell at={l.updated_at} by={l.updated_by} /></td>
                    <td className="px-3">
                      <div className="flex items-center justify-center gap-2 text-slate-400">
                        <button
                          onClick={() => setGroupsFor(l)}
                          className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hover"
                        >
                          <Users className="h-3.5 w-3.5" />
                          عرض المجموعات
                        </button>
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
                {lectures.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-400">
                      <BookOpenText className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                      {search || fGrade ? "لا توجد نتائج مطابقة" : "لا توجد حصص بعد"}
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

      {groupsFor && <LessonGroupsModal lecture={groupsFor} onClose={() => setGroupsFor(null)} />}

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
function LessonGroupsModal({ lecture, onClose }: { lecture: Lecture; onClose: () => void }) {
  const navigate = useNavigate();
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
        <div className="divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.group_id ?? "none"} className="flex items-center justify-between gap-4 py-3">
              <div>
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
              <button
                onClick={() => navigate(`/lectures/${lecture.id}/groups/${r.group_id ?? "none"}`)}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover"
              >
                <Eye className="h-4 w-4" />
                عرض
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
