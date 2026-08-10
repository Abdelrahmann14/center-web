import { useState } from "react";
import { GraduationCap, Users2, HeartHandshake } from "lucide-react";
import TeachersPage from "./TeachersPage";
import StudentsAdminPage from "./StudentsAdminPage";
import ParentsAdminPage from "./ParentsAdminPage";

// The three former top-level tabs (Teachers / Students / Parents) merged under a
// single "Users" tab. An inner segmented control switches between the lists, each
// of which keeps its own columns, filters and actions.
const SUBTABS = [
  { key: "teachers", label: "المدرّسون", icon: GraduationCap, Page: TeachersPage },
  { key: "students", label: "الطلاب", icon: Users2, Page: StudentsAdminPage },
  { key: "parents", label: "أولياء الأمور", icon: HeartHandshake, Page: ParentsAdminPage },
] as const;

type Key = (typeof SUBTABS)[number]["key"];

export default function UsersPage() {
  const [sub, setSub] = useState<Key>("teachers");
  const Active = SUBTABS.find((t) => t.key === sub)!.Page;

  return (
    <div>
      <div className="flex w-fit flex-wrap gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              sub === t.key ? "bg-dark text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <Active />
      </div>
    </div>
  );
}
