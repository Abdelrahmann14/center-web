// Delete control: the standard plain rose trash icon button used across the app.
import { useState } from "react";
import { Trash2, Loader2 } from "@/components/icons";

export function DeleteButton({
  onClick,
  label = "حذف",
  disabled = false,
}: {
  /** Returning a promise swaps the trash for a spinner until it settles. */
  onClick: () => void | Promise<unknown>;
  label?: string;
  disabled?: boolean;
}) {
  // Most call sites only open a confirm dialog and return nothing, so the
  // spinner appears exactly for the ones that go to the server themselves.
  const [busy, setBusy] = useState(false);

  async function run(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    const result = onClick();
    if (!result || typeof (result as Promise<unknown>).then !== "function") return;
    setBusy(true);
    try {
      await result;
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      title={label}
      disabled={disabled || busy}
      onClick={run}
      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
