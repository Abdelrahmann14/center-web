import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Search, Loader2 } from "lucide-react";
import { THEAD } from "@/components/tableStyles";
import { Pagination } from "@/components/Pagination";
import { api, ApiError, qs, type Page } from "@/lib/api";
import { useCachedGet } from "@/lib/dataCache";
import { LoaderBlock } from "@/components/PencilLoader";
import { useToast } from "@/components/Toast";
import { Select, Money } from "@/components/ui";
import { fmtDateTime } from "@/lib/datetime";
import { groupLabel, type Group } from "@/modules/students/StudentForm";
import { type Lecture } from "./LectureForm";

interface Reg {
  id: string;
  serial: number;
  name: string;
  gender: string | null;
  school: string | null;
  city: string | null;
  religion: string | null;
  lesson_price: number | null;
  student_phones: string[];
  parent_phones: string[];
  assigned_group_id: string | null;
  registered_group_id: string | null;
  homework_flag: string | null;
  exam_score: number | null;
  total_lessons: number;
  attended_at: string | null;
}

const ROWS_OPTIONS = ["10", "25", "50", "الكل"];
const isOther = (r: Reg) =>
  !!(r.assigned_group_id && r.registered_group_id && r.assigned_group_id !== r.registered_group_id);

const Dash = () => <span className="block text-center text-slate-300">-</span>;

/** Which stat pill is filtering the table. null = show everyone. */
type Filter = { kind: "new" } | { kind: "other" } | { kind: "price"; price: number | null } | null;

const sameFilter = (a: Filter, b: Filter) =>
  a != null && b != null && a.kind === b.kind && (a.kind !== "price" || a.price === (b as { price: number | null }).price);


export default function LessonGroupPage() {
  const { lectureId, groupId } = useParams<{ lectureId: string; groupId: string }>();
  const { data: lecture } = useCachedGet<Lecture>(lectureId ? `/lectures/${lectureId}` : null);
  const { data: groups } = useCachedGet<Group[]>("/groups");

  const [rows, setRows] = useState<Reg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [rowsPer, setRowsPer] = useState("25");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>(null);

  // One ref per rendered exam input, so Enter / arrows can walk the column.
  const examRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusExam = (index: number) => {
    const el = examRefs.current[index];
    if (!el) return;
    el.focus();
    el.select();
  };

  useEffect(() => {
    if (!lectureId || !groupId) return;
    // One group's roster within one lesson is a bounded set, so fetch it whole
    // and keep the stats + pagination client-side. "none" filters to students
    // registered under no group.
    const groupParam = groupId === "none" ? { groupless: true } : { groupId };
    api
      .get<Page<Reg>>(`/registrations${qs({ lectureId, ...groupParam, size: 2000 })}`)
      .then((p) => setRows(p.content))
      .finally(() => setLoading(false));
  }, [lectureId, groupId]);

  const groupById = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g])), [groups]);
  const label = (id: string | null) => {
    if (!id) return "بدون مجموعة";
    const g = groupById.get(id);
    return g ? groupLabel(g) : "-";
  };
  const thisGroupLabel = groupId === "none" ? "بدون مجموعة" : label(groupId ?? null);

  // Max exam grade parsed from the lecture (e.g. "من 50" -> 50). null = no cap.
  const examMax = useMemo(() => {
    const m = lecture?.exam_grade?.match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }, [lecture]);

  const totals = useMemo(() => {
    let male = 0, female = 0;
    const news: Reg[] = [];
    const other: Reg[] = [];
    for (const r of rows) {
      if (r.gender === "ذكر") male++;
      else if (r.gender === "أنثى") female++;
      if (r.total_lessons === 1) news.push(r);
      if (isOther(r)) other.push(r);
    }
    return { total: rows.length, male, female, news, other };
  }, [rows]);

  const buckets = useMemo(() => {
    const map = new Map<number | null, Reg[]>();
    for (const r of rows) {
      const key = r.lesson_price ?? null;
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    return [...map.entries()]
      .map(([price, list]) => ({ price, list }))
      .sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
  }, [rows]);

  // The stat pills ARE the table's filters: picking one narrows these rows, it
  // does not open a dialog. Search narrows further.
  const filtered = useMemo(() => {
    let out = rows;
    if (filter?.kind === "new") out = out.filter((r) => r.total_lessons === 1);
    else if (filter?.kind === "other") out = out.filter(isOther);
    else if (filter?.kind === "price") out = out.filter((r) => (r.lesson_price ?? null) === filter.price);

    const q = search.trim();
    if (!q) return out;
    const isCode = /^\d+$/.test(q);
    return out.filter((r) => (isCode ? String(r.serial).startsWith(q) : r.name.includes(q)));
  }, [rows, search, filter]);

  // Toggling a pill restarts the page window.
  function toggleFilter(next: Exclude<Filter, null>) {
    setFilter((prev) => (sameFilter(prev, next) ? null : next));
    setPage(1);
  }

  const perPage = rowsPer === "الكل" ? filtered.length || 1 : Number(rowsPer);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice((current - 1) * perPage, current * perPage);

  function patchExam(id: string, updated: Reg) {
    setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }

  if (loading) return <LoaderBlock />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{thisGroupLabel}</h1>
        <Link
          to="/lectures"
          className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <ArrowRight className="h-4 w-4" />
          رجوع
        </Link>
      </div>

      {/* Stat pills double as the table's filters - click one to narrow the rows. */}
      {rows.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            <StatPill label="الإجمالي" value={totals.total} accent />
            <StatPill label="ذكور" value={totals.male} />
            <StatPill label="إناث" value={totals.female} />
            <StatPill
              label="جدد"
              value={totals.news.length}
              active={filter?.kind === "new"}
              onClick={() => toggleFilter({ kind: "new" })}
            />
            <StatPill
              label="من مجموعة أخرى"
              value={totals.other.length}
              active={filter?.kind === "other"}
              onClick={() => toggleFilter({ kind: "other" })}
            />
            {filter && (
              <button
                type="button"
                onClick={() => {
                  setFilter(null);
                  setPage(1);
                }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                مسح التصفية
              </button>
            )}
          </div>
          {buckets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {buckets.map((b, i) => {
                const on = filter?.kind === "price" && filter.price === b.price;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleFilter({ kind: "price", price: b.price })}
                    className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs transition ${
                      on ? "border-amber-400 bg-amber-100 ring-2 ring-amber-200" : "border-amber-200 bg-amber-50 hover:bg-amber-100"
                    }`}
                  >
                    <span className="font-bold text-amber-700">
                      {b.price == null ? "بدون سعر" : <Money value={b.price} className="text-amber-700" />}
                    </span>
                    <span className="font-semibold text-slate-700">{b.list.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Search + rows-per-page */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="بحث بالاسم أو الكود..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-11 pl-4 text-slate-800 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>عرض</span>
          <div className="w-24">
            <Select
              value={rowsPer}
              onChange={(v) => {
                setRowsPer(v);
                setPage(1);
              }}
              options={ROWS_OPTIONS.map((r) => ({ value: r, label: r }))}
            />
          </div>
        </div>
      </div>

      {/* No horizontal scroll: percentage columns (the same widths the students
          page uses for the shared ones) and wrapping free-text cells. */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full table-fixed text-right text-xs">
          <colgroup>
            <col className="w-[3.5%]" />
            <col className="w-[15%]" />
            {/* Phones are always 11 digits - pinned, not shared. */}
            <col className="w-[104px]" />
            <col className="w-[104px]" />
            <col className="w-[9%]" />
            <col className="w-[4%]" />
            <col className="w-[6%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[11%]" />
            <col className="w-[9%]" />
          </colgroup>
          <thead className={`${THEAD} text-xs font-medium`}>
            <tr>
              <th className="px-2 py-2.5">#</th>
              <th className="px-2 py-2.5">الاسم</th>
              <th className="px-2 py-2.5">هاتف الطالب</th>
              <th className="px-2 py-2.5">هاتف ولي الأمر</th>
              <th className="px-2 py-2.5">المدرسة</th>
              <th className="px-2 py-2.5">النوع</th>
              <th className="px-2 py-2.5">المدينة</th>
              <th className="px-2 py-2.5">الديانة</th>
              <th className="px-2 py-2.5">السعر</th>
              <th className="px-2 py-2.5">الواجب</th>
              <th className="px-2 py-2.5">المجموعة الأصلية</th>
              <th className="px-2 py-2.5">وقت الحضور</th>
              <th className="px-2 py-2.5">
                الاختبار{examMax != null ? ` (من ${examMax})` : ""}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map((r, i) => (
              <tr
                key={r.id}
                // Attending under someone else's group is the harder flag, so
                // it wins over a homework issue.
                className={`h-14 transition ${
                  isOther(r)
                    ? "bg-rose-100 hover:bg-rose-200"
                    : r.homework_flag
                      ? "bg-amber-100 hover:bg-amber-200"
                      : "hover:bg-slate-50/60"
                }`}
              >
                <td className="px-2 font-medium text-slate-400">{r.serial}</td>
                <td className="px-2 font-medium leading-snug break-words text-slate-800">{r.name}</td>
                <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                  {r.student_phones.length ? (
                    r.student_phones.map((p) => <span key={p} className="block truncate">{p}</span>)
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-2 tabular-nums text-slate-600" dir="ltr">
                  {r.parent_phones.length ? (
                    r.parent_phones.map((p) => <span key={p} className="block truncate">{p}</span>)
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-2 leading-snug break-words text-slate-600">{r.school || <Dash />}</td>
                <td className="px-2 text-slate-600">{r.gender || <Dash />}</td>
                <td className="px-2 leading-snug break-words text-slate-600">{r.city || <Dash />}</td>
                <td className="px-2 leading-snug break-words text-slate-600">{r.religion || <Dash />}</td>
                <td className="px-2 text-slate-600">
                  {r.lesson_price != null ? <Money value={r.lesson_price} /> : <Dash />}
                </td>
                <td className="px-2 leading-snug text-slate-700">{r.homework_flag || <Dash />}</td>
                <td className="px-2 leading-snug break-words">
                  {isOther(r) ? (
                    <span className="font-medium text-rose-700">{label(r.assigned_group_id)}</span>
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-2 text-slate-600" dir="ltr">
                  {r.attended_at ? fmtDateTime(r.attended_at) : <Dash />}
                </td>
                <td className="px-2">
                  <ExamCell
                    reg={r}
                    max={examMax}
                    onSaved={(u) => patchExam(r.id, u)}
                    inputRef={(el) => {
                      examRefs.current[i] = el;
                    }}
                    onMove={(step) => focusExam(i + step)}
                  />
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center text-slate-400">
                  {rows.length === 0 ? "لا يوجد طلاب في هذه المجموعة" : "لا توجد نتائج مطابقة"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination current={current} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string;
  value: number;
  accent?: boolean;
  /** The pill is currently filtering the table. */
  active?: boolean;
  onClick?: () => void;
}) {
  const cls = `rounded-lg border px-3 py-1.5 text-right ${
    active
      ? "border-accent bg-accent/10 ring-2 ring-accent/20"
      : accent
        ? "border-accent/30 bg-accent/5"
        : "border-slate-200 bg-white"
  } ${onClick ? "cursor-pointer transition hover:border-accent hover:shadow-sm" : ""}`;
  const inner = (
    <>
      <span className="text-xs text-slate-500">{label} </span>
      <span className={`text-base font-bold ${accent || active ? "text-accent" : "text-slate-800"}`}>{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/**
 * The one editable cell in the table. Enter and the up/down arrows walk the
 * column so a whole group's grades can be typed without touching the mouse:
 * moving focus fires the blur that saves the value being left behind.
 */
function ExamCell({
  reg,
  max,
  onSaved,
  inputRef,
  onMove,
}: {
  reg: Reg;
  max: number | null;
  onSaved: (updated: Reg) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  onMove: (step: number) => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState(reg.exam_score != null ? String(reg.exam_score) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const raw = value.trim();
    const next = raw === "" ? null : Number(raw);
    const current = reg.exam_score;
    if (next === current) return;
    if (next != null && (isNaN(next) || next < 0)) {
      setValue(current != null ? String(current) : "");
      return toast("الدرجة لا يمكن أن تكون أقل من صفر", "error");
    }
    if (next != null && max != null && next > max) {
      setValue(current != null ? String(current) : "");
      return toast(`الدرجة لا يمكن أن تتجاوز ${max}`, "error");
    }
    setSaving(true);
    try {
      const updated = await api.patch<Reg>(`/registrations/${reg.id}/exam`, { exam_score: next });
      onSaved(updated);
      toast("تم حفظ الدرجة");
    } catch (err) {
      setValue(current != null ? String(current) : "");
      toast(err instanceof ApiError ? err.message : "تعذّر الحفظ", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={max ?? undefined}
        step="0.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          // The arrows would otherwise nudge the number itself.
          if (e.key === "Enter" || e.key === "ArrowDown") {
            e.preventDefault();
            onMove(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onMove(-1);
          }
        }}
        placeholder="-"
        className="w-full rounded-lg border border-slate-300 px-1 py-1.5 text-center text-slate-800 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
    </div>
  );
}
