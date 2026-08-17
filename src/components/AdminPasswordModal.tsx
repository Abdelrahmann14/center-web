import { useState } from "react";
import { Loader2, ShieldCheck } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { Modal, Field, FormNotice, inputClass } from "@/components/ui";

/** Prompts for the admin password and verifies it before allowing a sensitive action. */
export function AdminPasswordModal({
  title = "تأكيد كلمة مرور المدرّس",
  message,
  onConfirmed,
  onClose,
}: {
  title?: string;
  message?: string;
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setChecking(true);
    try {
      await api.post("/auth/verify-admin", { password });
      onConfirmed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر التحقق");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Modal
      title={title}
      subtitle={message}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="admin-pw"
            disabled={checking}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {checking ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
            تأكيد
          </button>
        </>
      }
    >
      <form id="admin-pw" onSubmit={handleSubmit} className="space-y-4">
        <Field label="كلمة مرور المدرّس">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            className={inputClass}
          />
        </Field>
        <FormNotice message={error} />
      </form>
    </Modal>
  );
}
