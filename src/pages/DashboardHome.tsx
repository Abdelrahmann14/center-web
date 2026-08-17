import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  BookOpen,
  ClipboardCheck,
  ReceiptText,
  FileQuestion,
  ChartColumn,
  CalendarRange,
  UserCog,
  Megaphone,
  Plug,
  ArrowLeft,
  UserPlus,
  CalendarClock,
  CalendarPlus,
} from "@/components/icons";
import { useAuth } from "@/auth/AuthContext";
import { AddStudentModal } from "@/modules/students/AddStudentModal";
import { AddLectureModal } from "@/modules/lectures/AddLectureModal";
import { cachedGet } from "@/lib/dataCache";
import { fmtTime } from "@/lib/datetime";
import { useOnline } from "@/lib/useOnline";
import type { Group } from "@/modules/students/StudentForm";

/** Section buckets, rendered in this order; empty ones disappear. */
const SECTIONS = [
  { key: "daily", label: "العمل اليومي" },
  { key: "manage", label: "الإدارة والإعداد" },
  { key: "comms", label: "التواصل والخدمات" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

interface ModuleCard {
  to: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  section: SectionKey;
  /** Any-of permission codes; the card shows when the principal holds one. */
  perm?: string[];
  /** Admin-only screens (the workspace owner), never assistants. */
  adminOnly?: boolean;
  /** Module gate, for admin-only screens that carry no permission of their own. */
  module?: string;
  /** Works with no connection - same list as NAV in DashboardLayout, same reason. */
  offline?: boolean;
}

// Same icon as the sidebar for the same screen - see the note on NAV in
// DashboardLayout. A launcher card and a nav row are two doors to one room.
const MODULES: ModuleCard[] = [
  {
    to: "/students",
    title: "الطلاب",
    desc: "إضافة الطلاب وإدارة بياناتهم",
    icon: <Users className="h-6 w-6" />,
    section: "daily",
    perm: ["STUDENT_VIEW"],
    offline: true,
  },
  {
    to: "/lectures",
    title: "الحصص",
    desc: "عرض وإدارة الحصص",
    icon: <BookOpen className="h-6 w-6" />,
    section: "daily",
    perm: ["LESSON_VIEW"],
    offline: true,
  },
  {
    to: "/lesson-registration",
    title: "تسجيل الحصة",
    desc: "تسجيل حضور الطلاب في الحصص",
    icon: <ClipboardCheck className="h-6 w-6" />,
    section: "daily",
    perm: ["REGISTRATION_ACCESS"],
    offline: true,
  },
  {
    to: "/financials",
    title: "الحسابات",
    desc: "فواتير الحصص والإيرادات والمصروفات",
    icon: <ReceiptText className="h-6 w-6" />,
    section: "daily",
    perm: ["FINANCE_VIEW"],
    offline: true,
  },
  {
    to: "/exams",
    title: "الاختبارات",
    desc: "بناء ونشر اختبارات الحصص",
    icon: <FileQuestion className="h-6 w-6" />,
    section: "daily",
    perm: ["EXAM_CREATE", "EXAM_UPDATE", "EXAM_DELETE", "EXAM_PUBLISH"],
  },
  {
    to: "/analytics",
    title: "الإحصائيات",
    desc: "نظرة عامة على بيانات النظام",
    icon: <ChartColumn className="h-6 w-6" />,
    section: "manage",
    adminOnly: true,
    module: "ANALYTICS",
  },
  {
    to: "/grades",
    title: "المجموعات والسناتر",
    desc: "إدارة السناتر ومجموعات الطلاب ومواعيدها",
    icon: <CalendarRange className="h-6 w-6" />,
    section: "manage",
    adminOnly: true,
    module: "GROUPS",
  },
  {
    to: "/users",
    title: "المساعدون",
    desc: "إنشاء حسابات المساعدين والتحكم بالصلاحيات",
    icon: <UserCog className="h-6 w-6" />,
    section: "manage",
    adminOnly: true,
    module: "ASSISTANTS",
  },
  {
    to: "/notifications",
    title: "الإشعارات والمراسلات",
    desc: "إرسال الإشعارات لطلابك وإدارة الرسائل",
    icon: <Megaphone className="h-6 w-6" />,
    section: "comms",
    perm: ["NOTIFICATION_SEND"],
  },
  {
    to: "/services",
    title: "الخدمات",
    desc: "واتساب وجهات اتصال Google",
    icon: <Plug className="h-6 w-6" />,
    section: "comms",
    adminOnly: true,
  },
];

/** JS getDay() is Sunday-based; the backend day_of_week is Saturday-based (0=السبت). */
const backendDay = (jsDay: number) => (jsDay + 1) % 7;

/**
 * The date and a live clock, ticking every second in its own component so the
 * whole page does not re-render each tick. The weekday/day/month follow the
 * system's Arabic reading; the clock is a distinct Latin, tabular face (12-hour
 * with AM/PM) so it reads as a clock, not another Arabic figure on the page.
 */
function HeaderDateTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const weekday = now.toLocaleDateString("ar-EG", { weekday: "long" });
  const dayMonth = now.toLocaleDateString("ar-EG", { day: "numeric", month: "long" });
  const pad = (n: number) => String(n).padStart(2, "0");
  const h24 = now.getHours();
  const period = h24 < 12 ? "ص" : "م";
  const h12 = h24 % 12 || 12;
  const clock = `${pad(h12)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // Clock on top (distinct Latin tabular face), the date a size smaller beneath
  // it. No box, no icon - plain white on the dark band.
  return (
    <div className="flex flex-col items-start sm:items-end">
      <div className="flex items-baseline gap-1.5 text-white" dir="ltr">
        <span className="font-clock text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
          {clock}
        </span>
        <span className="text-base font-bold">{period}</span>
      </div>
      <div className="mt-1 text-sm text-white/85">
        <span className="font-semibold">{weekday}</span>
        <span className="mx-1 text-white/45">•</span>
        <span>{dayMonth}</span>
      </div>
    </div>
  );
}

export default function DashboardHome() {
  const { effectiveRole, can, hasModule } = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const [addStudent, setAddStudent] = useState(false);
  const [addLecture, setAddLecture] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);

  const modules = MODULES.filter((m) => {
    // Offline, a card whose screen the mirror cannot serve is removed rather
    // than left to open on an empty page - same rule as the sidebar.
    if (!online && !m.offline) return false;
    if (m.module && !hasModule(m.module)) return false;
    return m.adminOnly ? effectiveRole === "admin" : m.perm ? m.perm.some(can) : true;
  });

  const canRegister = can("REGISTRATION_ACCESS");
  const canAddStudent = can("STUDENT_CREATE");
  const canAddLecture = can("LESSON_CREATE");
  // The schedule board only makes sense for someone who works with lessons.
  const canSeeSchedule = canRegister || can("STUDENT_VIEW") || effectiveRole === "admin";

  // Today's board reads the group timetable (day + time). Fetched defensively:
  // a role without access simply gets no board rather than an error.
  useEffect(() => {
    if (!canSeeSchedule) return;
    cachedGet<Group[]>("/groups")
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [canSeeSchedule]);

  const now = new Date();
  const today = backendDay(now.getDay());

  // Active groups meeting today, earliest first - the day's sessions.
  const todays = (groups ?? [])
    .filter((g) => g.is_active && g.day_of_week === today)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  // Open Lesson Registration with this session's grade + group pre-filled, rather
  // than dropping the user on an empty form.
  const openRegistration = (g: Group) =>
    navigate("/lesson-registration", { state: { grade: g.grade, groupId: g.id } });

  return (
    <div className="space-y-8">
      {/* ── Command hero: greeting, live date/clock, today's sessions, day actions.
          A dark band that carries the sidebar's ink into the page. Everything in
          it reads white. ── */}
      <section className="relative overflow-hidden rounded-2xl bg-dark px-6 py-6 text-white shadow-sm sm:px-8 sm:py-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 130% at 100% 0%, rgba(59,122,140,0.30), transparent 55%)",
          }}
        />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-end gap-4">
            <HeaderDateTime />
          </div>

          {(canSeeSchedule || canRegister || canAddStudent || canAddLecture) && (
            <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              {canSeeSchedule && (
                <div className="min-w-0 flex-1">
                  <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-white">
                    <CalendarClock className="h-4 w-4" />
                    حصص النهارده
                    {todays.length > 0 && (
                      <span className="rounded-full bg-white px-2 py-0.5 text-dark">
                        {todays.length.toLocaleString("ar-EG")}
                      </span>
                    )}
                  </div>

                  {groups === null ? (
                    <div className="text-sm text-white">جارٍ التحميل…</div>
                  ) : todays.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/25 px-4 py-3 text-sm text-white">
                      مفيش حصص متجدولة النهارده
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2.5">
                      {todays.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => openRegistration(g)}
                          title="فتح تسجيل الحصة بهذه البيانات"
                          className="group flex items-center gap-3 rounded-xl bg-white px-3.5 py-2.5 text-right shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
                        >
                          <span className="grid shrink-0 place-items-center rounded-lg bg-accent/10 px-2.5 py-1.5">
                            <span className="text-base font-bold tabular-nums leading-none text-accent">
                              {fmtTime(g.start_time)}
                            </span>
                          </span>
                          <span className="min-w-0 text-right">
                            <span className="block truncate text-sm font-semibold text-slate-800">
                              {g.center_name}
                            </span>
                            <span className="block truncate text-xs text-slate-500">{g.grade}</span>
                          </span>
                          <ClipboardCheck className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-accent" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(canAddLecture || canAddStudent) && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  {canAddLecture && (
                    <button
                      onClick={() => setAddLecture(true)}
                      className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-dark shadow-sm transition hover:bg-white/90"
                    >
                      <CalendarPlus className="h-4 w-4" />
                      إضافة حصة
                    </button>
                  )}
                  {canAddStudent && (
                    <button
                      onClick={() => setAddStudent(true)}
                      className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-dark shadow-sm transition hover:bg-white/90"
                    >
                      <UserPlus className="h-4 w-4" />
                      إضافة طالب
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Module launcher: square cards, grouped by workflow. On hover an accent
          wash rises from the bottom and the content turns white. ── */}
      {SECTIONS.map((s) => {
        const items = modules.filter((m) => m.section === s.key);
        if (items.length === 0) return null;
        return (
          <section key={s.key}>
            <div className="mb-4 flex items-center gap-3">
              <span className="h-4 w-1 rounded-full bg-accent" />
              <span className="text-sm font-bold text-slate-700">{s.label}</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((m) => (
                <Link
                  key={m.to}
                  to={m.to}
                  className="group relative flex items-center gap-4 overflow-hidden rounded-xl border border-slate-300 bg-white p-4 transition-all duration-300 ease-out hover:border-accent motion-safe:hover:-translate-y-1 shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.9),0_5px_0_0_var(--color-accent-hover),0_12px_20px_-5px_rgb(15_23_42_/_0.28)] hover:shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.9),0_8px_0_0_var(--color-accent-hover),0_22px_30px_-6px_rgb(15_23_42_/_0.34)]"
                >
                  {/* Rising accent wash: grows from the bottom edge upward to fill
                      the card on hover, so the color reads as moving up. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-0 bg-gradient-to-t from-accent-hover to-accent transition-[height] duration-300 ease-out group-hover:h-full"
                  />
                  <span className="relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent transition-colors duration-300 group-hover:bg-white/20 group-hover:text-white">
                    {m.icon}
                  </span>
                  <span className="relative z-10 min-w-0 flex-1">
                    <span className="block text-base font-bold text-slate-800 transition-colors duration-300 group-hover:text-white">
                      {m.title}
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-slate-500 line-clamp-2 transition-colors duration-300 group-hover:text-white/85">
                      {m.desc}
                    </span>
                  </span>
                  <ArrowLeft className="relative z-10 h-4 w-4 shrink-0 text-slate-300 transition-all duration-300 group-hover:-translate-x-1 group-hover:text-white" />
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      {addStudent && <AddStudentModal onClose={() => setAddStudent(false)} />}
      {addLecture && <AddLectureModal onClose={() => setAddLecture(false)} />}
    </div>
  );
}
