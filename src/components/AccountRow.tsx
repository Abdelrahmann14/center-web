import { LogOut } from "@/components/icons";
import { useAuth } from "@/auth/AuthContext";
import { roleLabel as labelForRole } from "@/lib/roles";
import { Avatar } from "@/components/Avatar";

/**
 * The sidebar account row: who is signed in, with the sign-out button beside
 * them. No menu to open first - signing out was the only thing the old dropdown
 * was still for, and a control behind a click is a control that has to be found.
 */
export function AccountRow({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth();

  return (
    <div className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-right">
      <Avatar photo={user?.photo} name={user?.username ?? "؟"} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">{user?.username}</span>
        <span className="block truncate text-xs text-slate-400">{labelForRole(user?.role)}</span>
      </span>
      <button
        onClick={onLogout}
        title="تسجيل الخروج"
        aria-label="تسجيل الخروج"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-400"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
