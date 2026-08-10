import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Role, CurrentUser, LoginResponse } from "@center/core";
import { api, ApiError, setToken, setUnauthorizedHandler } from "@/lib/api";
import { clearCache } from "@/lib/dataCache";
import { clearPageState } from "@/lib/pageState";

// Re-exported so existing importers (e.g. `import { type Role } from
// "@/auth/AuthContext"`) keep working; the definitions now live in @center/core.
export type { Role, CurrentUser } from "@center/core";

interface AuthState {
  user: CurrentUser | null;
  /** The signed-in account's role. Kept as a field for call sites that read it. */
  effectiveRole: Role | null;
  /** True until the stored session has been checked - hold routing meanwhile. */
  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Whether the signed-in principal holds a fine-grained permission (e.g. LESSON_CREATE). */
  can: (code: string) => boolean;
  /** Whether the module (e.g. ANALYTICS) is enabled for this workspace. */
  hasModule: (code: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "psycho.token";
const USER_KEY = "psycho.user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [restoring, setRestoring] = useState(true);

  function reset() {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    clearCache();
    clearPageState();
  }

  function remember(me: CurrentUser) {
    setUser(me);
    localStorage.setItem(USER_KEY, JSON.stringify(me));
  }

  /**
   * A session lasts until the user signs out. The stored token is re-verified on
   * launch, but only a real rejection (401/403) ends the session: on the desktop
   * the app is often opened before the server is reachable, so an unreachable
   * server falls back to the cached account instead of bouncing to the login
   * screen. Mirrors the mobile app.
   */
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setRestoring(false);
      return;
    }
    setToken(token);
    const cachedRaw = localStorage.getItem(USER_KEY);
    const cached = cachedRaw ? (JSON.parse(cachedRaw) as CurrentUser) : null;

    api
      .get<CurrentUser>("/auth/me")
      .then(remember)
      .catch((err) => {
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 401 || status === 403 || !cached) {
          reset();
        } else {
          setUser(cached);
        }
      })
      .finally(() => setRestoring(false));
    // Runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<LoginResponse>("/auth/login", { email, password });
    // The desktop app is for admins and their assistants only - students use the
    // mobile app. Reject a student sign-in here rather than show an empty shell.
    if (res.user.role === "student") {
      setToken(null);
      throw new Error("هذا التطبيق مخصص للمدرسين والمساعدين فقط. الطلاب يستخدمون تطبيق الهاتف.");
    }
    setToken(res.token);
    localStorage.setItem(TOKEN_KEY, res.token);
    remember(res.user);
  }

  async function logout() {
    reset();
  }

  // An expired or rejected token anywhere in the app drops us back to login
  // rather than leaving a half-dead session showing stale data.
  setUnauthorizedHandler(reset);

  const effectiveRole: Role | null = user?.role ?? null;

  const value = useMemo(
    () => {
      const perms = new Set(user?.permissions ?? []);
      const mods = new Set(user?.modules ?? []);
      return {
        user, effectiveRole, restoring, login, logout,
        can: (code: string) => perms.has(code),
        hasModule: (code: string) => mods.has(code),
      };
    },
    // login/logout are stable closures over state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, effectiveRole, restoring],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
