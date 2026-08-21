/**
 * One date/time format for the whole system: Arabic (Egypt), short date and
 * short time - e.g. ٣‏/٨‏/٢٠٢٦، ١:٤٦ ص. Every table, card and detail row goes
 * through here, so a format change happens in one place.
 */
export function fmtDateTime(iso?: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

/** Date only, same locale - for rows where the clock adds nothing. */
export function fmtDate(iso?: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString("ar-EG", { dateStyle: "short" });
}

/**
 * A wall-clock time ("16:00", "16:30:00") as the 12-hour Arabic reading the
 * whole system uses: ٤ م, ٤:٣٠ م, ٩ ص. Minutes are dropped when they are zero,
 * because "four in the afternoon" is how the hour is actually said.
 *
 * This takes a plain time string, not a date: group start times carry no day.
 */
export function fmtTime(time?: string | null, fallback = "-"): string {
  if (!time) return fallback;
  const [h, m] = time.split(":");
  const hour = Number(h);
  const minute = Number(m ?? 0);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return fallback;

  const period = hour < 12 ? "ص" : "م";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0
    ? `${arabicDigits(twelve)} ${period}`
    : `${arabicDigits(twelve)}:${arabicDigits(minute, true)} ${period}`;
}

/**
 * Western digits as Arabic-Indic ones (٠-٩), optionally padded to two.
 *
 * <p>Its own export because the time PICKER needs the same digits the time
 * DISPLAY uses - a menu offering "5" beside a table reading "٥" would be the
 * same clock written two ways on one screen.
 */
export function arabicDigits(n: number, pad = false): string {
  return (pad ? String(n).padStart(2, "0") : String(n)).replace(/\d/g, (d) =>
    String.fromCharCode(0x0660 + Number(d)),
  );
}
