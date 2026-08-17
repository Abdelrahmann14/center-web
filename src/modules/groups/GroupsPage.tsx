import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus, Loader2, Pencil, Power, Trash2, Users, Coins } from "@/components/icons";
import { DeleteButton } from "@/components/DeleteButton";
import { api, ApiError } from "@/lib/api";
import { cachedGet, invalidate } from "@/lib/dataCache";
import { DAYS, dayLabel } from "@/lib/days";
import { fmtTime } from "@/lib/datetime";
import { Modal, Field, Select, FormNotice, Switch, Money, inputClass } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { useToast } from "@/components/Toast";

interface Group {
  id: string;
  day_of_week: number;
  start_time: string;
  center_name: string;
  grade: string;
  is_active: boolean;
  deleted?: boolean;
  student_count: number;
  last_attendance: string | null;
  lesson_price: number | null;
  version?: number;
}

/** The wire shape a group create/edit carries (matches GroupRequest). */
const groupPayload = (
  g: Pick<Group, "day_of_week" | "start_time" | "center_name" | "grade" | "is_active">
) => ({
  day_of_week: g.day_of_week,
  start_time: g.start_time,
  center_name: g.center_name,
  grade: g.grade,
  is_active: g.is_active,
});
interface Grade {
  id: string;
  name: string;
  is_active: boolean;
}
interface Center {
  id: string;
  name: string;
  is_active: boolean;
  /** Price list, carried on the center itself (that is how it is saved). */
  grades?: { grade: string; price: number }[];
}

const ar = (n: number) => n.toLocaleString("ar-EG");

/** JS weeks start on Sunday; this app's start on Saturday. */
const todayDow = (new Date().getDay() + 1) % 7;

/**
 * One slot is one (day, minute). The server stores a LocalTime, so the wire
 * value can carry seconds - key on HH:mm alone or "16:00" and "16:00:00" would
 * read as two different slots.
 */
const slotKey = (day: number | string, time: string) => `${day}-${time.slice(0, 5)}`;

/**
 * The first quarter-hour inside `hour` that no group holds yet. Two groups can
 * share a day but not a minute, so offering a taken time from the calendar's +
 * button only earns a rejection - offer the next free one instead.
 */
function freeTimeIn(hour: number, day: number, groups: Group[]): string {
  const hh = String(hour).padStart(2, "0");
  const taken = new Set(
    groups.filter((g) => g.day_of_week === day).map((g) => g.start_time.slice(0, 5))
  );
  return ["00", "30", "15", "45"].map((mm) => `${hh}:${mm}`).find((t) => !taken.has(t)) ?? `${hh}:00`;
}

/**
 * The week is the real shape of this data, so the page is a timetable rather
 * than a card grid: one band per day, slots inside it ordered by the clock. The
 * day is named once in the rail instead of on every card, which frees the card
 * to lead with the only thing that identifies a slot - its start time.
 */
export default function GroupsPage() {
  const toast = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [centers, setCenters] = useState<Center[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Group | null>(null);
  // The group students are transferred to when their group is deleted.
  const [transferTo, setTransferTo] = useState("");
  const [centerFilter, setCenterFilter] = useState("");
  // Set when a new group is started from an empty calendar cell.
  const [preset, setPreset] = useState<{ day: number; time: string } | null>(null);
  async function load() {
    setLoading(true);
    try {
      const [g, gr, c] = await Promise.all([
        cachedGet<Group[]>("/groups"),
        cachedGet<Grade[]>("/grades"),
        cachedGet<Center[]>("/centers"),
      ]);
      // Deleted groups stay in the API (so history labels resolve) but never show
      // on the management page.
      setGroups(g.filter((x) => !x.deleted));
      setGrades(gr);
      setCenters(c);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function upsert(g: Group, isEdit: boolean) {
    setGroups((prev) => (isEdit ? prev.map((x) => (x.id === g.id ? g : x)) : [...prev, g]));
    invalidate("/groups");
  }

  /**
   * Flip the active flag through the dedicated PATCH.
   *
   * Returns the state that stuck, so a caller holding its own copy of the flag
   * (the form) follows rather than drifting.
   */
  async function toggleActive(g: Group): Promise<boolean> {
    const next = !g.is_active;
    setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, is_active: next } : x)));
    try {
      await api.patch<Group>(`/groups/${g.id}/active`, { is_active: next });
      return next;
    } catch {
      setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, is_active: g.is_active } : x)));
      toast("تعذّر تغيير الحالة", "error");
      return g.is_active;
    }
  }

  async function handleDelete(g: Group, target?: string) {
    try {
      const q = target ? `?transfer_to_group_id=${target}` : "";
      await api.del(`/groups/${g.id}${q}`);
      setGroups((prev) => prev.filter((x) => x.id !== g.id));
      invalidate("/groups");
      invalidate("/students");
      toast("تم حذف المجموعة");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "تعذّر حذف المجموعة", "error");
    } finally {
      setConfirmDelete(null);
      setTransferTo("");
    }
  }

  const shown = useMemo(
    () => (centerFilter ? groups.filter((g) => g.center_name === centerFilter) : groups),
    [groups, centerFilter]
  );

  // One band per day that actually has slots. An empty day is absence, not
  // information, so it is left out rather than drawn as a hollow row.
  const week = useMemo(
    () =>
      DAYS.map((d) => ({
        ...d,
        slots: shown
          .filter((g) => g.day_of_week === d.value)
          .sort((a, b) => a.start_time.localeCompare(b.start_time)),
      })).filter((d) => d.slots.length > 0),
    [shown]
  );

  // Every occupied (day, time). Built from all groups, never the filtered view -
  // a center filter must not hide a clash the server would reject anyway.
  const takenSlots = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of groups) m.set(slotKey(g.day_of_week, g.start_time), g);
    return m;
  }, [groups]);

  const totalStudents = shown.reduce((sum, g) => sum + g.student_count, 0);
  // Only the centers that actually hold a group are worth offering as filters.
  const usedCenters = Array.from(new Set(groups.map((g) => g.center_name))).sort((a, b) =>
    a.localeCompare(b, "ar")
  );

  if (loading) return <LoaderBlock />;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-dark">جدول الأسبوع</h2>
          <p className="mt-1 text-sm text-slate-500">
            {ar(shown.length)} مجموعة
            {shown.length > 0 && <> · {ar(totalStudents)} طالب</>}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
        >
          <Plus className="h-5 w-5" />
          مجموعة جديدة
        </button>
      </div>

      {usedCenters.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterChip active={!centerFilter} onClick={() => setCenterFilter("")}>
            كل السناتر
          </FilterChip>
          {usedCenters.map((name) => (
            <FilterChip
              key={name}
              active={centerFilter === name}
              onClick={() => setCenterFilter(centerFilter === name ? "" : name)}
            >
              {name}
            </FilterChip>
          ))}
        </div>
      )}

      {week.length === 0 ? null : (
        <WeekCalendar
          groups={shown}
          onEdit={setEditGroup}
          onCreate={(day, hour) => {
            setPreset({ day, time: freeTimeIn(hour, day, groups) });
            setShowForm(true);
          }}
        />
      )}

      {week.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <p className="font-medium text-slate-600">
            {centerFilter ? `لا توجد مجموعات في ${centerFilter}` : "لا توجد مجموعات بعد"}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {centerFilter ? "اختر سنتراً آخر أو أضف مجموعة هنا." : "أضف مجموعة لتظهر في جدول الأسبوع."}
          </p>
        </div>
      ) : (
        // The calendar needs seven columns to be readable, so below lg the same
        // week is read as day bands instead.
        <div className="mt-6 space-y-7 lg:hidden">
          {week.map((day, i) => {
            const students = day.slots.reduce((sum, g) => sum + g.student_count, 0);
            return (
              <section
                key={day.value}
                className="animate-band grid gap-4 sm:grid-cols-[9.5rem_1fr]"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* The day is named once, here, instead of on every card. */}
                <header
                  className={`sm:border-e sm:border-slate-200 sm:pe-5 sm:text-end ${
                    day.value === todayDow ? "sm:border-e-accent" : ""
                  }`}
                >
                  <h3
                    className={`text-xl font-bold ${
                      day.value === todayDow ? "text-accent" : "text-dark"
                    }`}
                  >
                    {day.label}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {ar(day.slots.length)} مجموعة
                    <br className="hidden sm:block" />
                    <span className="sm:hidden"> · </span>
                    {ar(students)} طالب
                  </p>
                </header>

                <div className="grid gap-3 sm:grid-cols-2">
                  {day.slots.map((g) => (
                    <SlotCard
                      key={g.id}
                      group={g}
                      onToggle={() => toggleActive(g)}
                      onEdit={() => setEditGroup(g)}
                      onDelete={() => setConfirmDelete(g)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {showForm && (
        <GroupForm
          grades={grades}
          centers={centers}
          taken={takenSlots}
          preset={preset ?? undefined}
          onClose={() => {
            setShowForm(false);
            setPreset(null);
          }}
          onSaved={(g) => {
            upsert(g, false);
            setShowForm(false);
            setPreset(null);
          }}
        />
      )}

      {editGroup && (
        <GroupForm
          initial={editGroup}
          grades={grades}
          centers={centers}
          taken={takenSlots}
          // The open form is the source of truth for the flag while it is open,
          // so the toggled state has to land back on it - otherwise a second
          // press would compute its flip from the state before the first.
          onToggle={async () => {
            const next = await toggleActive(editGroup);
            setEditGroup((prev) => (prev ? { ...prev, is_active: next } : prev));
            return next;
          }}
          // Deleting is a decision of its own, so the form steps aside and the
          // confirmation takes the screen instead of stacking on top of it.
          onDelete={() => {
            setConfirmDelete(editGroup);
            setEditGroup(null);
          }}
          onClose={() => setEditGroup(null)}
          onSaved={(g) => {
            upsert(g, true);
            setEditGroup(null);
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          title="حذف المجموعة"
          onClose={() => {
            setConfirmDelete(null);
            setTransferTo("");
          }}
          footer={
            <>
              <button
                onClick={() => {
                  setConfirmDelete(null);
                  setTransferTo("");
                }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                onClick={() => handleDelete(confirmDelete, transferTo || undefined)}
                disabled={confirmDelete.student_count > 0 && !transferTo}
                className="rounded-xl bg-rose-600 px-5 py-2.5 font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                حذف
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            سيتم حذف مجموعة {dayLabel(confirmDelete.day_of_week)} {fmtTime(confirmDelete.start_time)} في{" "}
            {confirmDelete.center_name}. تبقى بيانات الحصص السابقة كما هي في سجلّات الطلاب.
          </p>
          {confirmDelete.student_count > 0 &&
            (() => {
              const targets = groups.filter(
                (g) =>
                  g.id !== confirmDelete.id &&
                  g.grade === confirmDelete.grade &&
                  g.is_active &&
                  !g.deleted
              );
              return (
                <div className="mt-4">
                  <Field label={`نقل ${confirmDelete.student_count.toLocaleString("ar-EG")} طالب إلى مجموعة`}>
                    <Select
                      value={transferTo}
                      onChange={setTransferTo}
                      placeholder="اختر المجموعة"
                      options={targets.map((g) => ({
                        value: g.id,
                        label: `${dayLabel(g.day_of_week)} ${fmtTime(g.start_time)} - ${g.center_name}`,
                      }))}
                    />
                  </Field>
                  <p className="mt-1 text-xs text-slate-400">
                    {targets.length === 0
                      ? "لا توجد مجموعة أخرى في نفس الصف - أنشئ واحدة أولاً لنقل الطلاب إليها."
                      : "لا يمكن ترك الطلاب بدون مجموعة، فاختر مجموعة لنقلهم إليها."}
                  </p>
                </div>
              );
            })()}
        </Modal>
      )}
    </div>
  );
}

/** The hour a slot falls in, e.g. "16:30" -> 16. */
const hourOf = (time: string) => Number(time.slice(0, 2));

/**
 * The week as an actual calendar: days across, the clock down the side, each
 * group sitting in its own hour. This is how the schedule is read on paper, so
 * it is how it is drawn. Groups carry no end time, so an hour is the grid's
 * finest row and slots sharing one hour stack inside the cell.
 */
function WeekCalendar({
  groups,
  onEdit,
  onCreate,
}: {
  groups: Group[];
  onEdit: (g: Group) => void;
  onCreate: (day: number, hour: number) => void;
}) {
  const today = todayDow;

  // The grid spans only the hours that are actually taught, so an evening
  // centre never scrolls past an empty morning.
  const hours = useMemo(() => {
    if (groups.length === 0) return [];
    const hs = groups.map((g) => hourOf(g.start_time));
    const from = Math.min(...hs);
    const to = Math.max(...hs);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [groups]);

  const cells = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const g of groups) {
      const key = `${g.day_of_week}-${hourOf(g.start_time)}`;
      const list = map.get(key);
      if (list) list.push(g);
      else map.set(key, [g]);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return map;
  }, [groups]);

  const perDay = useMemo(() => {
    const counts = new Map<number, number>();
    for (const g of groups) counts.set(g.day_of_week, (counts.get(g.day_of_week) ?? 0) + 1);
    return counts;
  }, [groups]);

  if (hours.length === 0) return null;

  return (
    // Seven columns need room to breathe, so the calendar starts at lg and the
    // day bands carry everything below it.
    <div className="mt-6 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
      <div className="grid grid-cols-[3.75rem_repeat(7,minmax(0,1fr))] xl:grid-cols-[5rem_repeat(7,minmax(0,1fr))]">
        {/* Column headers: the days, with the clock's own corner left blank. */}
        <div className="border-b border-slate-200 bg-slate-50/80" />
        {DAYS.map((d) => {
          const count = perDay.get(d.value) ?? 0;
          const isToday = d.value === today;
          return (
            <div
              key={d.value}
              className={`border-b border-s border-slate-200 px-2 py-3 text-center ${
                isToday ? "bg-accent/10" : "bg-slate-50/80"
              }`}
            >
              <div
                className={`text-sm font-bold ${
                  isToday ? "text-accent" : count > 0 ? "text-dark" : "text-slate-400"
                }`}
              >
                {d.label}
              </div>
              <div className={`mt-1 text-[11px] ${isToday ? "text-accent/70" : "text-slate-400"}`}>
                {count > 0 ? `${ar(count)} مجموعة` : "لا شيء"}
              </div>
            </div>
          );
        })}

        {hours.map((h) => (
          <Fragment key={h}>
            {/* The hour, read as the system reads every other clock. The rule
                under it runs unbroken across all seven days, so one hour never
                bleeds into the next. */}
            <div className="border-b border-slate-200 bg-slate-50/40 px-3 pt-2.5 text-end text-xs font-medium text-slate-500">
              {fmtTime(`${String(h).padStart(2, "0")}:00`)}
            </div>
            {DAYS.map((d) => {
              const slots = cells.get(`${d.value}-${h}`) ?? [];
              return (
                <div
                  key={d.value}
                  className={`group/cell flex min-h-[6.25rem] flex-col gap-4 border-b border-s border-slate-200 p-2 pb-3 transition ${
                    d.value === today ? "bg-accent/[0.04]" : ""
                  }`}
                >
                  {slots.map((g) => (
                    <SlotBlock key={g.id} group={g} onEdit={() => onEdit(g)} />
                  ))}
                  {/* An empty hour is an offer: click it to schedule there. An
                      hour that already holds a group is not - it keeps its slot
                      and nothing invites a second one on top of it. */}
                  {slots.length === 0 && (
                    <button
                      type="button"
                      onClick={() => onCreate(d.value, h)}
                      title={`مجموعة جديدة ${d.label} ${fmtTime(`${String(h).padStart(2, "0")}:00`)}`}
                      className="flex flex-1 items-center justify-center rounded-lg text-slate-300 opacity-0 transition hover:bg-accent/10 hover:text-accent focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/45 group-hover/cell:opacity-100"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * One group inside a calendar cell, read top to bottom as a teacher reads a
 * timetable: when, how many, where, which grade.
 *
 * A light card, not a solid dark block: a white surface with an accent edge and
 * a dark, high-contrast time so it reads at a glance without weighing the whole
 * grid down. The head count and grade each ride in their own tint chip, so the
 * three facts separate by shape, not just by position. A stopped group is the
 * same card drawn hollow and dimmed. The card carries no controls of its own -
 * every action lives in the form it opens.
 */
function SlotBlock({ group: g, onEdit }: { group: Group; onEdit: () => void }) {
  const on = g.is_active;
  return (
    <button
      type="button"
      onClick={onEdit}
      title={`${fmtTime(g.start_time)} · ${g.center_name} · ${g.grade} · ${ar(
        g.student_count
      )} طالب${g.lesson_price != null ? ` · ${ar(g.lesson_price)} جنيه للحصة` : ""}${
        on ? "" : " · معطّلة"
      }`}
      className={`group/slot block w-full rounded-xl border p-3 text-right transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
        on
          ? // Real depth, three layers: an inset highlight lights the top face,
            // a solid darker-teal lip under the card is its physical thickness,
            // and a soft ambient shadow floats it above the grid. The bright
            // accent edge on the start side is the lit corner. Hover lifts the
            // card and grows the lip - the illusion of picking it up.
            "border-slate-300 bg-slate-100 shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.9),0_5px_0_0_var(--color-accent-hover),0_12px_20px_-5px_rgb(15_23_42_/_0.28)] motion-safe:hover:-translate-y-1 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.9),0_8px_0_0_var(--color-accent-hover),0_22px_30px_-6px_rgb(15_23_42_/_0.34)]"
          : "border-dashed border-slate-300 bg-slate-50/60 opacity-70 hover:opacity-100"
      }`}
    >
      {/* Row 1 - the start time leads (it is what tells two slots apart), the
          head count rides in an accent chip on the other end. */}
      <span className="flex items-center justify-between gap-1.5">
        <span
          className={`truncate text-base font-extrabold leading-5 tracking-tight ${
            on ? "text-dark" : "text-slate-400"
          }`}
        >
          {fmtTime(g.start_time)}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-4 tabular-nums ${
            on ? "bg-accent/10 text-accent" : "bg-slate-100 text-slate-400"
          }`}
        >
          <Users className="h-3 w-3 shrink-0" />
          {ar(g.student_count)}
        </span>
      </span>

      {/* Row 2 - the centre, quietly. */}
      <span
        className={`mt-1.5 block truncate text-xs leading-4 ${on ? "text-slate-500" : "text-slate-400"}`}
      >
        {g.center_name}
      </span>

      {/* Row 3 - the grade in its own chip, the price trailing it. */}
      <span className="mt-2 flex items-center justify-between gap-1.5">
        <span
          className={`truncate rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-4 ${
            on ? "bg-slate-100 text-slate-600" : "text-slate-400"
          }`}
        >
          {g.grade}
        </span>
        {g.lesson_price != null && (
          <span
            className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold leading-4 tabular-nums ${
              on ? "text-slate-600" : "text-slate-400"
            }`}
          >
            <Coins className={`h-3 w-3 shrink-0 ${on ? "text-amber-500" : "text-slate-300"}`} />
            {ar(g.lesson_price)} ج
          </span>
        )}
      </span>

      {!on && (
        <span className="mt-1.5 block text-[10px] font-bold leading-4 text-slate-400">معطّلة</span>
      )}
    </button>
  );
}

/**
 * One weekly slot. The start time is the headline because, inside a day, it is
 * the only thing that tells two slots apart. The accent edge carries the active
 * state so the switch does not have to be read to know it.
 */
function SlotCard({
  group: g,
  onToggle,
  onEdit,
  onDelete,
}: {
  group: Group;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      className={`rounded-2xl border border-s-4 bg-white p-4 transition ${
        g.is_active
          ? "border-slate-200 border-s-accent hover:border-slate-300 hover:shadow-md"
          : "border-dashed border-slate-200 border-s-slate-300 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-3xl font-bold leading-none tracking-tight text-dark">
            {fmtTime(g.start_time)}
          </div>
          <div className="mt-1.5 truncate text-sm text-slate-500" title={g.center_name}>
            {g.center_name}
          </div>
        </div>
        <Switch checked={g.is_active} onChange={onToggle} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">{g.grade}</span>
        {g.lesson_price != null && (
          <Money value={ar(g.lesson_price)} className="text-xs text-slate-500" />
        )}
        {!g.is_active && (
          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">معطّلة</span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <Users className="h-3.5 w-3.5 text-slate-400" />
          {ar(g.student_count)} طالب
          {g.last_attendance && <span className="text-slate-400">· آخر حضور {g.last_attendance}</span>}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            title="تعديل"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <DeleteButton onClick={onDelete} />
        </div>
      </div>
    </article>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function GroupForm({
  initial,
  grades,
  centers,
  taken,
  preset,
  onToggle,
  onDelete,
  onClose,
  onSaved,
}: {
  initial?: Group;
  grades: Grade[];
  centers: Center[];
  /** Every (day, time) already holding a group, keyed by slotKey. */
  taken: Map<string, Group>;
  /** Day and hour the form opened on, when it came from an empty calendar cell. */
  preset?: { day: number; time: string };
  /** Flips the group's active flag; resolves to the state that stuck. */
  onToggle?: () => Promise<boolean>;
  onDelete?: () => void;
  onClose: () => void;
  onSaved: (g: Group) => void;
}) {
  const toast = useToast();
  const isEdit = initial !== undefined;
  const [day, setDay] = useState(String(initial?.day_of_week ?? preset?.day ?? 0));
  const [time, setTime] = useState(initial?.start_time ?? preset?.time ?? "16:00");
  const [center, setCenter] = useState(initial?.center_name ?? "");
  const [grade, setGrade] = useState(initial?.grade ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const activeCenters = centers.filter((c) => c.is_active || c.name === initial?.center_name);
  const activeGrades = grades.filter((g) => g.is_active || g.name === initial?.grade);

  // The server rejects a second group on the same minute. Say so while the time
  // is being picked, rather than letting the save fail.
  const holder = taken.get(slotKey(day, time));
  const clash = holder && holder.id !== initial?.id ? holder : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (clash) {
      setError("اختر وقتاً آخر - هذا الموعد محجوز");
      return;
    }
    if (!center || !grade) {
      setError("اختر السنتر والصف");
      return;
    }
    setSaving(true);
    const payload = groupPayload({
      day_of_week: Number(day),
      start_time: time,
      center_name: center,
      grade,
      is_active: initial?.is_active ?? true,
    });
    try {
      const saved = isEdit
        ? await api.put<Group>(`/groups/${initial.id}`, payload)
        : await api.post<Group>("/groups", payload);
      toast(isEdit ? "تم تحديث المجموعة" : "تمت إضافة المجموعة");
      onSaved(saved);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "تعذّر حفظ المجموعة";
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={isEdit ? "تعديل مجموعة" : "مجموعة جديدة"}
      onClose={onClose}
      footer={
        <>
          {/* Acting on the group lives with the group, not on the calendar block
              - the week stays a week, and nothing hides behind a hover. */}
          {isEdit && (
            <div className="me-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onToggle}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 font-medium transition ${
                  initial.is_active
                    ? "border-slate-300 text-slate-600 hover:bg-slate-50"
                    : "border-accent bg-accent/10 text-accent hover:bg-accent/15"
                }`}
              >
                <Power className="h-4 w-4" />
                {initial.is_active ? "تعطيل" : "تفعيل"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 font-medium text-rose-600 transition hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
                حذف
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="group-form"
            disabled={saving || clash !== null}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="group-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="اليوم">
          <Select value={day} onChange={setDay} options={DAYS.map((d) => ({ value: String(d.value), label: d.label }))} />
        </Field>
        <div>
          <Field label="الوقت">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </Field>
          {clash && (
            <p className="mt-1 flex items-start gap-1 px-1 text-xs font-medium text-rose-600">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                محجوز لمجموعة {clash.center_name} · {clash.grade}
              </span>
            </p>
          )}
        </div>
        <Field label="السنتر">
          <Select
            value={center}
            onChange={setCenter}
            placeholder="اختر السنتر"
            options={activeCenters.map((c) => ({ value: c.name, label: c.name }))}
          />
        </Field>
        <Field label="الصف">
          <Select
            value={grade}
            onChange={setGrade}
            placeholder="اختر الصف"
            options={activeGrades.map((g) => ({ value: g.name, label: g.name }))}
          />
        </Field>
        <div className="sm:col-span-2">
          <FormNotice message={error} />
        </div>
      </form>
    </Modal>
  );
}
