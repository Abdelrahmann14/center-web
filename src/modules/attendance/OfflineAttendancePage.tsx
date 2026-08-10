// Offline attendance-taking (phase 1 web write flow). Reads the roster from the
// local IndexedDB mirror and marks students present with a local write plus a
// queued mutation, so it works with no connection and syncs automatically.
import { useCallback, useEffect, useState } from "react";
import { Check, Circle, Users } from "lucide-react";
import { LoaderBlock } from "@/components/PencilLoader";
import { useSync } from "@/sync/SyncProvider";
import { SyncStatusChip } from "@/sync/SyncStatusChip";
import type { RosterGroup } from "@/sync/store";

export default function OfflineAttendancePage() {
  const { store, syncNow } = useSync();
  const [groups, setGroups] = useState<RosterGroup[]>([]);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!store) return;
    const [roster, marked] = await Promise.all([store.rosterByGroup(), store.presentTodayIds()]);
    setGroups(roster);
    setPresent(marked);
    setLoading(false);
  }, [store]);

  useEffect(() => {
    // Pull the freshest roster, then read whatever is local (works offline).
    syncNow();
    void reload();
  }, [reload, syncNow]);

  async function mark(groupId: string, studentId: string) {
    if (!store || present.has(studentId)) return;
    setPresent((s) => new Set(s).add(studentId));
    await store.markAttendance(groupId, studentId);
    syncNow();
  }

  if (loading) return <LoaderBlock />;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-end">
        <SyncStatusChip />
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white py-16 text-slate-400">
          <Users className="h-8 w-8" />
          <p className="text-sm">لا يوجد طلاب. اتصل بالإنترنت مرة واحدة لتنزيل القائمة.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.groupId}>
              <div className="mb-2 px-1 text-sm font-semibold text-slate-500">
                {`${g.groupName} · ${g.students.length}`}
              </div>
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {g.students.map((s) => {
                  const isPresent = present.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => mark(g.groupId, s.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-right transition hover:bg-slate-50"
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          isPresent ? "bg-green-600 text-white" : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {isPresent ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-semibold text-slate-800">{s.name}</span>
                        {s.serial != null && (
                          <span className="block text-xs text-slate-400">{`كود ${s.serial}`}</span>
                        )}
                      </span>
                      {isPresent && <span className="text-xs font-semibold text-green-600">حاضر</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
