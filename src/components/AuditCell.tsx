import { fmtDateTime } from "@/lib/datetime";

/**
 * A table cell for an audit column: the timestamp on the first line and who did
 * it underneath. Rows written before auditing existed carry no name, so the
 * second line falls back to a dash instead of disappearing (keeps rows aligned).
 */
export function AuditCell({ at, by }: { at?: string | null; by?: string | null }) {
  return (
    // Wraps instead of forcing its column wider: on a table that must fit its
    // frame a long stamp takes a second line rather than pushing everything
    // else sideways.
    <div className="leading-tight break-words">
      <div className="text-xs text-slate-500">{fmtDateTime(at)}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{by ? `بواسطة ${by}` : "—"}</div>
    </div>
  );
}
