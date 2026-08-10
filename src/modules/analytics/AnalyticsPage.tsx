import { useEffect, useState } from "react";
import { Users2, CalendarDays, MapPin, GraduationCap } from "lucide-react";
import { api } from "@/lib/api";
import { dayLabel } from "@/lib/days";
import { LoaderBlock } from "@/components/PencilLoader";

interface DayCount {
  day_of_week: number;
  count: number;
}

interface Analytics {
  assistants_count: number;
  students_count: number;
  groups_count: number;
  centers_count: number;
  groups_by_day: DayCount[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Analytics>("/analytics")
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoaderBlock />;
  }

  if (!data) return null;

  const maxDay = Math.max(1, ...data.groups_by_day.map((d) => d.count));
  const byDayMap = new Map(data.groups_by_day.map((d) => [d.day_of_week, d.count]));

  const stats = [
    { label: "المساعدون", value: data.assistants_count, icon: <Users2 className="h-5 w-5" /> },
    { label: "الطلاب الحاليون", value: data.students_count, icon: <GraduationCap className="h-5 w-5" /> },
    { label: "المجموعات", value: data.groups_count, icon: <CalendarDays className="h-5 w-5" /> },
    { label: "السناتر", value: data.centers_count, icon: <MapPin className="h-5 w-5" /> },
  ];

  return (
    <div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
              {s.icon}
            </div>
            <div className="mt-3 text-2xl font-bold text-slate-800">{s.value}</div>
            <div className="text-sm text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-bold text-slate-800">المجموعات حسب اليوم</h2>
        <div className="flex items-end gap-3" style={{ height: 200 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const count = byDayMap.get(d) ?? 0;
            const h = (count / maxDay) * 100;
            return (
              <div key={d} className="flex flex-1 flex-col items-center justify-end gap-2">
                <span className="text-xs font-medium text-slate-600">{count}</span>
                <div
                  className="w-full rounded-t-lg bg-accent transition-all"
                  style={{ height: `${Math.max(h, count > 0 ? 6 : 2)}%`, minHeight: 4, opacity: count > 0 ? 1 : 0.15 }}
                />
                <span className="text-xs text-slate-500">{dayLabel(d)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
