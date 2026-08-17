import { useState } from "react";
import { Loader2, LogIn } from "@/components/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Logo } from "@/components/Logo";
import { Field, FieldError, inputClass } from "@/components/ui";
import { PasswordInput } from "@/components/PasswordInput";
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
    // h-dvh + centred, so on a phone the form sits in the middle of what is
    // actually on screen and the page never scrolls: `min-h-screen` measured the
    // viewport at its tallest (address bar hidden), which left the card taller
    // than the visible area and pushed the button under the fold. The logo and
    // the padding shrink on small screens for the same reason - the card has to
    // fit, not merely start at the top.
    <div className="flex h-dvh items-center justify-center overflow-hidden bg-slate-200 p-4">
      <div className="w-full max-w-sm animate-page rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-5 flex flex-col items-center gap-2 sm:mb-6 sm:gap-3">
          <Logo className="h-28 w-auto max-w-[360px] sm:h-44" />
          <p className="text-sm text-slate-500">تسجيل الدخول إلى النظام</p>
        </div>

        {/* noValidate: the system owns validation, so the browser bubble stays out. */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4 sm:space-y-5">
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
              <PasswordInput value={password} onChange={setPassword} />
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
