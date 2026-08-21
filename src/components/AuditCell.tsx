import { fmtDateTime } from "@/lib/datetime";

/**
 * A table cell for an audit column: the timestamp on the first line and who did
 * it underneath.
 *
 * <p>The name is only worth a line where more than one person could have done
 * it. Omitting the prop entirely drops the line; passing it and finding it empty
 * still prints a dash, because there the blank is meaningful - a row written
 * before auditing existed - and the dash keeps the rows aligned.
 */
export function AuditCell({ at, by }: { at?: string | null; by?: string | null }) {
  return (
    // Wraps instead of forcing its column wider: on a table that must fit its
    // frame a long stamp takes a second line rather than pushing everything
    // else sideways.
    <div className="leading-tight break-words">
      <div className="text-xs text-slate-500">{fmtDateTime(at)}</div>
      {by !== undefined && (
        <div className="mt-0.5 text-[11px] text-slate-400">{by ? `بواسطة ${by}` : "—"}</div>
      )}
    </div>
  );
}
