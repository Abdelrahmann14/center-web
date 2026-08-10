import { useState } from "react";
import { Link } from "react-router-dom";
import { Users2, Users, BarChart3, GraduationCap, BookOpenText, ClipboardCheck, CalendarCheck2, FileText, BellRing, Blocks, ArrowLeft } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { AddMenu } from "@/components/AddMenu";
import { AddStudentModal } from "@/modules/students/AddStudentModal";
import { AddLectureModal } from "@/modules/lectures/AddLectureModal";

const ADD_OPTIONS = [
  { key: "session", label: "حصة" },
  { key: "student", label: "طالب" },
  { key: "alert", label: "تنبيه" },
];

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
}

const MODULES: ModuleCard[] = [
  {
    to: "/students",
    title: "الطلاب",
    desc: "إضافة الطلاب وإدارة بياناتهم",
    icon: <Users className="h-6 w-6" />,
    section: "daily",
    perm: ["STUDENT_VIEW"],
  },
  {
    to: "/lectures",
    title: "الحصص",
    desc: "عرض وإدارة الحصص",
    icon: <BookOpenText className="h-6 w-6" />,
    section: "daily",
    perm: ["LESSON_VIEW"],
  },
  {
    to: "/lesson-registration",
    title: "تسجيل الحصة",
    desc: "تسجيل حضور الطلاب في الحصص",
    icon: <ClipboardCheck className="h-6 w-6" />,
    section: "daily",
    perm: ["REGISTRATION_ACCESS"],
  },
  {
    to: "/offline-attendance",
    title: "تسجيل الحضور",
    desc: "تسجيل حضور الطلاب دون اتصال بالإنترنت",
    icon: <CalendarCheck2 className="h-6 w-6" />,
    section: "daily",
    perm: ["ATTENDANCE_ACCESS"],
  },
  {
    to: "/exams",
    title: "الاختبارات",
    desc: "بناء ونشر اختبارات الحصص",
    icon: <FileText className="h-6 w-6" />,
    section: "daily",
    perm: ["EXAM_CREATE", "EXAM_UPDATE", "EXAM_DELETE", "EXAM_PUBLISH"],
  },
  {
    to: "/analytics",
    title: "الإحصائيات",
    desc: "نظرة عامة على بيانات النظام",
    icon: <BarChart3 className="h-6 w-6" />,
    section: "manage",
    adminOnly: true,
  },
  {
    to: "/grades",
    title: "المجموعات والسناتر",
    desc: "إدارة السناتر ومجموعات الطلاب ومواعيدها",
    icon: <GraduationCap className="h-6 w-6" />,
    section: "manage",
    adminOnly: true,
  },
  {
    to: "/users",
    title: "المساعدون",
    desc: "إنشاء حسابات المساعدين والتحكم بالصلاحيات",
    icon: <Users2 className="h-6 w-6" />,
    section: "manage",
    adminOnly: true,
  },
  {
    to: "/notifications",
    title: "الإشعارات والمراسلات",
    desc: "إرسال الإشعارات لطلابك وإدارة الرسائل",
    icon: <BellRing className="h-6 w-6" />,
    section: "comms",
    perm: ["NOTIFICATION_SEND"],
  },
  {
    to: "/services",
    title: "تكامل الخدمات",
    desc: "واتساب وجهات اتصال Google",
    icon: <Blocks className="h-6 w-6" />,
    section: "comms",
    adminOnly: true,
  },
];

export default function DashboardHome() {
  const { effectiveRole, can } = useAuth();
  const [notice, setNotice] = useState("");
  const [addStudent, setAddStudent] = useState(false);
  const [addLecture, setAddLecture] = useState(false);
  const modules = MODULES.filter((m) =>
    m.adminOnly ? effectiveRole === "admin" : m.perm ? m.perm.some(can) : true
  );

  function handleAdd(key: string) {
    if (key === "student") {
      setAddStudent(true);
    } else if (key === "session") {
      setAddLecture(true);
    } else {
      setNotice("هذه الميزة قيد التطوير");
      setTimeout(() => setNotice(""), 2500);
    }
  }

  return (
    <div>
      {effectiveRole === "user" && (
        <div className="flex justify-end">
          <AddMenu options={ADD_OPTIONS} onSelect={handleAdd} />
        </div>
      )}

      {notice && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          {notice}
        </div>
      )}

      <div className="mt-2 space-y-8">
        {SECTIONS.map((s) => {
          const items = modules.filter((m) => m.section === s.key);
          if (items.length === 0) return null;
          return (
            <section key={s.key}>
              {/* Section label with a rule that fills the leftover width. */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-600">{s.label}</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((m) => (
                  <Link
                    key={m.to}
                    to={m.to}
                    className="group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-slate-300 bg-white p-5 pr-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-xl hover:shadow-accent/10"
                  >
                    {/* Leading accent edge: makes the card read as a card at a
                        glance instead of a faint outline on a white frame. */}
                    <span className="absolute inset-y-0 right-0 w-1.5 bg-accent/50 transition duration-200 group-hover:bg-accent" />
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent transition duration-200 group-hover:bg-accent group-hover:text-white">
                      {m.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-bold text-slate-800">{m.title}</span>
                      <span className="mt-1 block text-sm leading-relaxed text-slate-500">{m.desc}</span>
                    </span>
                    <ArrowLeft className="mt-1.5 h-4 w-4 shrink-0 text-slate-400 transition duration-200 group-hover:-translate-x-1 group-hover:text-accent" />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {addStudent && <AddStudentModal onClose={() => setAddStudent(false)} />}
      {addLecture && <AddLectureModal onClose={() => setAddLecture(false)} />}
    </div>
  );
}
