import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
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
  Menu,
} from "@/components/icons";
import { useAuth } from "@/auth/AuthContext";
import sidebarLogo from "@/assets/sidebar-logo.png";
import { AccountRow } from "@/components/AccountRow";
import { ConfirmDialog } from "@/components/ui";
import { PAGE_FRAME_ID } from "@/components/PencilLoader";
import { getScroll, saveScroll } from "@/lib/pageState";
import { toast } from "@/components/ui/toast";
import { useOnline } from "@/lib/useOnline";
import { SyncStatusPill } from "@/sync/SyncStatusPill";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Any-of permission codes; the item shows when the principal holds one. */
  perm?: string[];
  /** Admin-only screens (the workspace owner), never assistants. */
  adminOnly?: boolean;
  /**
   * The screen still works with no connection - its reads are answered by the
   * offline mirror (see WebSyncStore.resolveRead) and its writes are queued.
   *
   * <p>Everything else is HIDDEN while offline rather than left to fail: those
   * screens open on a request the mirror cannot answer, so the page lands empty
   * or errors and the only way out is a reload - which, offline, is worse. A
   * door that leads nowhere is removed, not labelled.
   */
  offline?: boolean;
  /**
   * Module the screen belongs to. Only needed for admin-only screens: a
   * permission-gated screen already disappears when its module is switched off,
   * because a disabled module stops granting its permissions. These carry no
   * permission, so they check the module directly.
   */
  module?: string;
}

/**
 * One icon per screen, and the SAME icon on the home launcher - an icon is a
 * name, and two names for one screen means neither is ever learned. Each glyph
 * is the screen's own noun rather than the category it belongs to: every screen
 * here is "education", so a mortarboard says nothing about which one this is.
 */
const NAV: NavItem[] = [
  { to: "/", label: "الرئيسية", icon: <Home className="h-5 w-5" />, offline: true },
  // People, not a graduation: this screen is the roster.
  { to: "/students", label: "الطلاب", icon: <Users className="h-5 w-5" />, perm: ["STUDENT_VIEW"], offline: true },
  { to: "/lectures", label: "الحصص", icon: <BookOpen className="h-5 w-5" />, perm: ["LESSON_VIEW"], offline: true },
  // The act is ticking names present, so the tick is the icon.
  { to: "/lesson-registration", label: "تسجيل الحصة", icon: <ClipboardCheck className="h-5 w-5" />, perm: ["REGISTRATION_ACCESS"], offline: true },
  // Invoices, not a wallet - it matches what the page actually draws.
  { to: "/financials", label: "الحسابات", icon: <ReceiptText className="h-5 w-5" />, perm: ["FINANCE_VIEW"], offline: true },
  // An exam is a question paper; this is the only "?" in the set.
  { to: "/exams", label: "الاختبارات", icon: <FileQuestion className="h-5 w-5" />, perm: ["EXAM_CREATE", "EXAM_UPDATE", "EXAM_DELETE", "EXAM_PUBLISH"] },
  // Columns, not a trend line: the data is per-lesson counts, not a time series.
  { to: "/analytics", label: "الإحصائيات", icon: <ChartColumn className="h-5 w-5" />, adminOnly: true, module: "ANALYTICS" },
  // A group IS a weekly day-and-time slot - that is its database key, and this
  // is the screen that sets it. The range reads as the week, against the clock
  // used on the home page for today alone.
  { to: "/grades", label: "المجموعات والسناتر", icon: <CalendarRange className="h-5 w-5" />, adminOnly: true, module: "GROUPS" },
  { to: "/users", label: "المساعدون", icon: <UserCog className="h-5 w-5" />, adminOnly: true, module: "ASSISTANTS" },
  // WhatsApp messaging: manual sends, the automated messages, and their log.
  { to: "/notifications", label: "الرسائل", icon: <Megaphone className="h-5 w-5" />, perm: ["NOTIFICATION_SEND"] },
  // Connections to the outside. Blocks read as "modules", which these are not.
  { to: "/services", label: "الخدمات", icon: <Plug className="h-5 w-5" />, adminOnly: true },
];

export default function DashboardLayout() {
  const { user, effectiveRole, logout, can, hasModule } = useAuth();
  const online = useOnline();
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
      // Auto-dismisses after 5s like any other toast; the sidebar sync pill
      // carries the persistent offline state, so the toast is a brief heads-up,
      // not a banner.
      offlineToastId.current = toast.error("لا يوجد اتصال", { duration: 5000 });
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
  const items = NAV.filter((n) => {
    // With no connection, only the screens the mirror can actually serve stay
    // reachable - see NavItem.offline.
    if (!online && !n.offline) return false;
    if (n.module && !hasModule(n.module)) return false;
    return n.adminOnly ? effectiveRole === "admin" : n.perm ? n.perm.some(can) : true;
  });

  return (
    // h-dvh, not h-screen: on a phone `100vh` is the tallest the viewport ever
    // gets (browser chrome hidden), so with the address bar showing the shell was
    // taller than the visible area - the open drawer ran off the bottom and a
    // strip of page appeared under it until the bar collapsed. The dynamic unit
    // tracks the area actually on screen.
    <div className="flex h-dvh gap-2 overflow-hidden bg-dark p-2 sm:gap-3 sm:p-3">
      {/* Dimmed backdrop behind the mobile drawer. */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="animate-fade-in fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
        />
      )}

      <aside
        className={`z-40 flex w-64 flex-col overflow-hidden rounded-[20px] bg-dark text-slate-200 transition-transform duration-200 max-lg:fixed max-lg:inset-y-2 max-lg:right-2 sm:max-lg:inset-y-3 sm:max-lg:right-3 max-lg:shadow-2xl lg:static lg:translate-x-0 ${
          mobileOpen ? "max-lg:translate-x-0" : "max-lg:translate-x-[calc(100%+0.75rem)]"
        }`}
      >
        <div className="flex h-18 items-center justify-center px-3">
          {/* Transparent PNG (white wordmark + the colored reading-girl mark), so
              it sits on the dark sidebar as-is - no blend tricks.

              The file is cropped to the artwork itself. It used to be the mark
              floating in a 1080x1080 canvas that was more than half empty, drawn
              into a fixed 112x64 box with `cover` - so the transparent margin ate
              the box and the wordmark landed at ~87px wide. Now the height sets
              the size and the width follows the real aspect ratio, with no crop,
              centred in the sidebar rather than pinned to its edge. */}
          <img
            src={sidebarLogo}
            alt="سنتر"
            className="h-12 w-auto shrink-0"
          />
        </div>

        {/* A simple wavy line dividing the logo from the nav. */}
        <div className="mb-2 px-3" aria-hidden>
          <svg
            viewBox="0 0 240 8"
            preserveAspectRatio="none"
            className="block h-2 w-full text-white/25"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          >
            <path d="M0 4 Q 15 0 30 4 T 60 4 T 90 4 T 120 4 T 150 4 T 180 4 T 210 4 T 240 4" />
          </svg>
        </div>

        {/* overscroll-contain: scrolling past the end of the nav must not hand
            the gesture to the page behind the drawer, which is what made the
            page slide out from under it. */}
        <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">
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

        <div className="space-y-2 border-t border-white/10 p-2">
          {/* Offline sync state: quiet when synced, speaks up when offline or
              while writes are still queued. */}
          <SyncStatusPill />
          {/* Who is signed in, with sign-out right next to them. */}
          <AccountRow onLogout={() => setConfirmLogout(true)} />
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
          // The page itself scrolls one way only. Anything genuinely wider than
          // the frame - a table - carries its own horizontal scroller, so
          // sideways movement belongs to that element and never to the page.
          className="flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div key={location.pathname} className="w-full min-w-0 px-4 py-4 animate-page sm:px-6 sm:py-5">
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
  );
}
