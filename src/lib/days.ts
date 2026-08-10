// Arabic week: index 0 = Saturday (السبت). Matches backend smallint day_of_week (0..6).
export const DAYS: { value: number; label: string }[] = [
  { value: 0, label: "السبت" },
  { value: 1, label: "الأحد" },
  { value: 2, label: "الإثنين" },
  { value: 3, label: "الثلاثاء" },
  { value: 4, label: "الأربعاء" },
  { value: 5, label: "الخميس" },
  { value: 6, label: "الجمعة" },
];

export function dayLabel(value: number): string {
  return DAYS.find((d) => d.value === value)?.label ?? "-";
}
