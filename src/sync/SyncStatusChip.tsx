// Subtle sync indicator for the dashboard: a small pill reflecting whether
// changes are pending, syncing, offline, or fully synced.
import { Check, CloudOff, RefreshCw, Clock, AlertTriangle } from "lucide-react";
import type { SyncStatus } from "@center/core";
import { useSync } from "./SyncProvider";

export function SyncStatusChip() {
  const { status } = useSync();
  const v = view(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${v.className}`}
    >
      <v.Icon className={`h-3.5 w-3.5 ${v.spin ? "animate-spin" : ""}`} />
      {v.label}
    </span>
  );
}

function view(status: SyncStatus) {
  if (status.phase === "syncing") {
    return { label: "جارٍ المزامنة", Icon: RefreshCw, spin: true, className: "bg-accent/10 text-accent" };
  }
  if (status.phase === "offline") {
    return {
      label: status.pending > 0 ? `${status.pending} بانتظار الاتصال` : "دون اتصال",
      Icon: CloudOff,
      spin: false,
      className: "bg-slate-100 text-slate-500",
    };
  }
  if (status.phase === "error") {
    return { label: "تعذّرت المزامنة", Icon: AlertTriangle, spin: false, className: "bg-rose-50 text-rose-600" };
  }
  if (status.pending > 0) {
    return { label: `${status.pending} غير متزامن`, Icon: Clock, spin: false, className: "bg-accent/10 text-accent" };
  }
  return { label: "متزامن", Icon: Check, spin: false, className: "bg-green-50 text-green-600" };
}
