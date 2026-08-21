import { useMemo } from "react";
import { Select } from "@/components/ui";
import { arabicDigits } from "@/lib/datetime";

/**
 * A wall-clock time, picked in Arabic.
 *
 * <p>Replaces {@code <input type="time">}. That control renders its own dropdown
 * from the browser, which means Chrome's list: Western digits, an AM/PM column,
 * and a panel no stylesheet in this project can reach. On an otherwise Arabic
 * RTL form it was the one place the app stopped speaking the user's language,
 * and there was no way to fix it from here without owning the control.
 *
 * <p>Three shared {@code Select}s, which is what the design system asks for
 * anyway. The value in and out stays "HH:mm" on the 24-hour clock - the wire
 * format the API and the database already use - so only the reading changes.
 */
export function TimeSelect({
  value,
  onChange,
  disabled = false,
}: {
  /** "HH:mm" or "HH:mm:ss", 24-hour. */
  value: string;
  /** Always emits "HH:mm", 24-hour. */
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [h24, minute] = parse(value);
  const isPm = h24 >= 12;
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;

  const emit = (nextHour12: number, nextMinute: number, pm: boolean) => {
    // 12 is the hinge in both directions: 12 AM is 00:00 and 12 PM is 12:00,
    // which the plain "add twelve for PM" rule gets wrong at both ends.
    const base = nextHour12 % 12;
    const hour = pm ? base + 12 : base;
    onChange(`${pad(hour)}:${pad(nextMinute)}`);
  };

  const hours = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const h = i + 1;
        return { value: String(h), label: arabicDigits(h) };
      }),
    [],
  );

  // Every five minutes, plus whatever this group is actually on. A time already
  // saved at :20 or :37 - imported, or set before this control existed - has to
  // stay pickable, or opening the form would silently round it on save.
  const minutes = useMemo(() => {
    const set = new Set<number>();
    for (let m = 0; m < 60; m += 5) set.add(m);
    set.add(minute);
    return [...set]
      .sort((a, b) => a - b)
      .map((m) => ({ value: String(m), label: arabicDigits(m, true) }));
  }, [minute]);

  return (
    // dir="rtl" and hour first, so it reads "٥ : ٣٠ م" the way it is said.
    <div className="flex w-full items-center gap-1.5" dir="rtl">
      <div className="min-w-0 flex-1">
        <Select
          value={String(hour12)}
          onChange={(v) => emit(Number(v), minute, isPm)}
          options={hours}
          disabled={disabled}
        />
      </div>
      <span className="shrink-0 font-semibold text-slate-400">:</span>
      <div className="min-w-0 flex-1">
        <Select
          value={String(minute)}
          onChange={(v) => emit(hour12, Number(v), isPm)}
          options={minutes}
          disabled={disabled}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Select
          value={isPm ? "pm" : "am"}
          onChange={(v) => emit(hour12, minute, v === "pm")}
          options={[
            { value: "am", label: "ص" },
            { value: "pm", label: "م" },
          ]}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "17:30" / "17:30:00" -> [17, 30]. Anything unreadable falls back to 16:00. */
function parse(value: string): [number, number] {
  const [h, m] = (value ?? "").split(":");
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return [16, 0];
  return [hour, Number.isFinite(minute) && minute >= 0 && minute < 60 ? minute : 0];
}
