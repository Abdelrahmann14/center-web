import { fmtDateTime } from "@/lib/datetime";

/**
 * A table cell for an audit column: the timestamp on the first line and who did
 * it underneath. Rows written before auditing existed carry no name, so the
 * second line falls back to a dash instead of disappearing (keeps rows aligned).
 */
export function AuditCell({ at, by }: { at?: string | null; by?: string | null }) {
  return (
    <div className="whitespace-nowrap leading-tight">
      <div className="text-xs text-slate-500">{fmtDateTime(at)}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{by ? `بواسطة ${by}` : "—"}</div>
    </div>
  );
}
