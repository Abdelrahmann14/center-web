import { useState } from "react";
import { Loader2, LogIn } from "@/components/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Logo } from "@/components/Logo";
import { Field, FieldError, inputClass } from "@/components/ui";
import { toast } from "@/components/ui/toast";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Same reveal rule as the rest of the system (LectureForm/StudentForm):
  // "مطلوب" and format errors wait for a submit attempt, then live in the
  // floating FieldError bubble above the field. They clear live as the value
  // becomes valid.
  const emailErr = !attempted
    ? null
    : !email.trim()
      ? "مطلوب"
      : !EMAIL_RE.test(email.trim())
        ? "بريد إلكتروني غير صحيح"
        : null;
  const pwErr = attempted && !password ? "مطلوب" : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (!email.trim() || !EMAIL_RE.test(email.trim()) || !password) return;

    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate("/", { replace: true });
    } catch (err) {
      // A rejected login is about the attempt (wrong name/password, server
      // down), not one field - so it surfaces as a toast.
      toast.error(err instanceof Error ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-200 p-4">
      <div className="w-full max-w-sm animate-page rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Logo className="h-44 w-auto max-w-[360px]" />
          <p className="text-sm text-slate-500">تسجيل الدخول إلى النظام</p>
        </div>

        {/* noValidate: the system owns validation, so the browser bubble stays out. */}
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <Field label="البريد الإلكتروني">
            <div className="relative">
              <FieldError message={emailErr} />
              <input
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                className={inputClass}
              />
            </div>
          </Field>
          <Field label="كلمة المرور">
            <div className="relative">
              <FieldError message={pwErr} />
              <input
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          </Field>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
            دخول
          </button>
        </form>
      </div>
    </div>
  );
}
