import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Users2, BookOpen, MessageCircle } from "@/components/icons";
import { useAuth } from "@/auth/AuthContext";
import { ConfirmDialog } from "@/components/ui";
import { PAGE_FRAME_ID } from "@/components/PencilLoader";
import { toast } from "@/components/ui/toast";

/**
 * The super admin's platform console. No sidebar and no workspace browsing: a top
 * bar (logout at the top-right) over a tab strip.
 *
 * <p>The console operates the platform; it does not use it. There is no screen
 * here for sending a message to anyone - messaging belongs to a teacher's own
 * workspace, under that teacher's own number. What the super admin keeps is the
 * WhatsApp account itself: which numbers exist and which templates are approved.
 */
const TABS = [
  { to: "/users", label: "المستخدمون", icon: Users2 },
  { to: "/grades", label: "الصفوف", icon: BookOpen },
  { to: "/whatsapp", label: "واتساب", icon: MessageCircle },
];

export default function SuperAdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Surface connectivity changes as toasts so the super admin always knows when
  // an action might silently fail. Listeners fire only on real transitions, so
  // the initial page load never shows a spurious "restored" toast.
  const offlineToastId = useRef<string | null>(null);
  useEffect(() => {
    function onOffline() {
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

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* Floating pill header: centered, offset from the top, hovering above the content. */}
      <div className="z-10 flex justify-center px-4 pt-5 pb-1">
        <nav className="flex flex-wrap items-center justify-center gap-1 rounded-full border border-slate-200/70 bg-white/90 px-2 py-1.5 shadow-lg shadow-slate-900/10 backdrop-blur">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "bg-dark text-white"
                    : "text-slate-600 hover:bg-dark hover:text-white"
                }`
              }
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </NavLink>
          ))}
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <button
            onClick={() => setConfirmLogout(true)}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-600 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </button>
        </nav>
      </div>

      <main id={PAGE_FRAME_ID} className="relative flex-1 overflow-auto">
        {/* key on pathname re-triggers the enter animation on every navigation. */}
        <div key={location.pathname} className="w-full px-4 py-4 animate-page sm:px-6 sm:py-5">
          <Outlet />
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
