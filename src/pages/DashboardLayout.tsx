import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  GraduationCap,
  BookOpen,
  ClipboardList,
  CalendarCheck2,
  FileText,
  LineChart,
  School,
  UserCog,
  Blocks,
  BellRing,
  Power,
  Menu,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import sidebarLogo from "@/assets/sidebar-logo.jpeg";
import { ConfirmDialog } from "@/components/ui";
import { PAGE_FRAME_ID } from "@/components/PencilLoader";
import { getScroll, saveScroll } from "@/lib/pageState";
import { SyncProvider } from "@/sync/SyncProvider";
import { toast } from "@/components/ui/toast";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Any-of permission codes; the item shows when the principal holds one. */
  perm?: string[];
  /** Admin-only screens (the workspace owner), never assistants. */
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "الرئيسية", icon: <Home className="h-5 w-5" /> },
  { to: "/students", label: "الطلاب", icon: <GraduationCap className="h-5 w-5" />, perm: ["STUDENT_VIEW"] },
  { to: "/lectures", label: "الحصص", icon: <BookOpen className="h-5 w-5" />, perm: ["LESSON_VIEW"] },
  { to: "/lesson-registration", label: "تسجيل الحصة", icon: <ClipboardList className="h-5 w-5" />, perm: ["REGISTRATION_ACCESS"] },
  { to: "/offline-attendance", label: "الحضور", icon: <CalendarCheck2 className="h-5 w-5" />, perm: ["ATTENDANCE_ACCESS"] },
  { to: "/exams", label: "الاختبارات", icon: <FileText className="h-5 w-5" />, perm: ["EXAM_CREATE", "EXAM_UPDATE", "EXAM_DELETE", "EXAM_PUBLISH"] },
  { to: "/analytics", label: "الإحصائيات", icon: <LineChart className="h-5 w-5" />, adminOnly: true },
  { to: "/grades", label: "المجموعات والسناتر", icon: <School className="h-5 w-5" />, adminOnly: true },
  { to: "/users", label: "المساعدون", icon: <UserCog className="h-5 w-5" />, adminOnly: true },
  { to: "/notifications", label: "الإشعارات والمراسلات", icon: <BellRing className="h-5 w-5" />, perm: ["NOTIFICATION_SEND"] },
  { to: "/services", label: "تكامل الخدمات", icon: <Blocks className="h-5 w-5" />, adminOnly: true },
];

export default function DashboardLayout() {
  const { user, effectiveRole, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Close the mobile drawer whenever the route changes (a nav tap navigated).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Connectivity toasts, so every role knows when an action might silently fail.
  // Listeners fire only on real transitions - no spurious toast on first load.
  const offlineToastId = useRef<string | null>(null);
  useEffect(() => {
    function onOffline() {
      offlineToastId.current = toast.error("انقطع الاتصال بالإنترنت", {
        title: "لا يوجد اتصال",
        duration: Infinity,
      });
    }
    function onOnline() {
      if (offlineToastId.current !== null) {
        toast.dismiss(offlineToastId.current);
        offlineToastId.current = null;
      }
      toast.success("عاد الاتصال بالإنترنت");
    }
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  // Restore this route's scroll position when returning to it.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (el) el.scrollTop = getScroll(location.pathname);
  }, [location.pathname]);

  async function handleLogout() {
    // logout() closes the work session and clears cache + page state.
    await logout();
    navigate("/login", { replace: true });
  }

  // Permission-gated: an item shows only when the principal actually holds a
  // relevant permission - so the admin sees every workspace screen (they hold
  // all workspace permissions), while each assistant sees exactly the screens
  // the admin granted them. Service Integrations stays admin-only.
  const items = NAV.filter((n) =>
    n.adminOnly ? effectiveRole === "admin" : n.perm ? n.perm.some(can) : true
  );

  return (
    <SyncProvider>
    <div className="flex h-screen gap-3 overflow-hidden bg-dark p-3">
      {/* Dimmed backdrop behind the mobile drawer. */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="animate-fade-in fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
        />
      )}

      <aside
        className={`z-40 flex w-64 flex-col overflow-hidden rounded-[20px] bg-dark text-slate-200 transition-transform duration-200 max-lg:fixed max-lg:inset-y-3 max-lg:right-3 max-lg:shadow-2xl lg:static lg:translate-x-0 ${
          mobileOpen ? "max-lg:translate-x-0" : "max-lg:translate-x-[calc(100%+0.75rem)]"
        }`}
      >
        <div className="flex h-18 items-center px-3">
          {/* The logo art is white-on-black in a JPEG (no alpha channel), so
              `screen` blending drops its black backdrop onto the sidebar. The
              source is square with the mark in a middle band, so this box keeps
              the mark's own ~7:4 ratio - `cover` then trims only dead black and
              the whole mark stays visible. Width drives the drawn size. */}
          <img
            src={sidebarLogo}
            alt="سنتر"
            /* contrast crushes the JPEG's near-black compression noise back to
               black so `screen` blending doesn't reveal it as a grey haze. */
            className="h-16 w-28 shrink-0 object-cover contrast-125 mix-blend-screen"
          />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-white text-dark"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          {/* Account row: identity is static; only the sign-out button reacts. */}
          <div className="flex items-center gap-3 px-2 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/20 text-sm font-bold text-white">
              {user?.username?.trim()?.[0] ?? "؟"}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">
              {user?.username}
            </span>
            <button
              onClick={() => setConfirmLogout(true)}
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-rose-400 transition hover:bg-white/10 hover:text-rose-300"
            >
              <Power className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* The persistent rounded content frame. Only its inner page swaps. */}
      <main
        id={PAGE_FRAME_ID}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors duration-200"
      >
        {/* Mobile top bar: opens the sidebar drawer (no page overlap). */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            title="القائمة"
            aria-label="القائمة"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-bold text-slate-800">{user?.username}</span>
        </div>

        <div
          ref={mainRef}
          onScroll={(e) => saveScroll(location.pathname, e.currentTarget.scrollTop)}
          className="flex-1 overflow-auto"
        >
          <div key={location.pathname} className="w-full px-6 py-5 animate-page">
            <Outlet />
          </div>
        </div>
      </main>

      {confirmLogout && (
        <ConfirmDialog
          title="تسجيل الخروج"
          message="هل تريد بالتأكيد تسجيل الخروج من النظام؟"
          confirmLabel="تسجيل الخروج"
          danger
          onConfirm={handleLogout}
          onClose={() => setConfirmLogout(false)}
        />
      )}
    </div>
    </SyncProvider>
  );
}
