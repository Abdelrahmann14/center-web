// Delete control: the standard plain rose trash icon button used across the app.
import { Trash2 } from "lucide-react";

export function DeleteButton({
  onClick,
  label = "حذف",
  disabled = false,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
