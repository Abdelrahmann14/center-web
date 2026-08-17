// A quiet line in the dark sidebar footer saying when the workspace was last in
// step with the server. Not a control: syncing is automatic - on a timer, on
// reconnect and after every local write - so a button to "sync now" only ever
// asked the user to do something the app was already doing.
import { Loader2, Wifi, WifiOff } from "@/components/icons";
import { fmtDateTime } from "@/lib/datetime";
import { useSync } from "./SyncProvider";

export function SyncStatusPill() {
  const { status, ready } = useSync();
  if (!ready) return null;

  const { phase, pending, lastSyncedAt, lastError } = status;
  const when = lastSyncedAt ? fmtDateTime(new Date(lastSyncedAt).toISOString()) : null;

  const offline = phase === "offline" || phase === "error";
  const tone = offline ? "text-amber-300" : "text-slate-400";

  return (
    <div
      // The last sync time is the fact; the state of the line is the icon beside
      // it. Both live in a title as well, for the states that carry a reason.
      title={
        phase === "error" && lastError
          ? lastError
          : offline
            ? "لا يوجد اتصال - التعديلات محفوظة محلياً وتُرفع عند عودة الاتصال"
            : "تتم المزامنة تلقائياً في الخلفية"
      }
      className={`flex w-full items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium ${tone}`}
    >
      {phase === "syncing" ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : offline ? (
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Wifi className="h-3.5 w-3.5 shrink-0" />
      )}
      {/* A failure says what went wrong, right here. Hiding the reason in a
          tooltip left "sync is broken" as the only thing anyone could report. */}
      <span className="truncate">
        {phase === "error" && lastError
          ? lastError
          : when
            ? `آخر مزامنة ${when}`
            : "لم تتم مزامنة بعد"}
      </span>
      {/* Only when something is still queued - otherwise there is nothing to say. */}
      {pending > 0 && (
        <span className="rounded-md bg-white/10 px-1.5 text-[11px] font-bold tabular-nums">
          {pending.toLocaleString("ar-EG")}
        </span>
      )}
    </div>
  );
}
