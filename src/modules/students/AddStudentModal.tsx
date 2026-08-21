import { useEffect, useState } from "react";
import { cachedGet, invalidate } from "@/lib/dataCache";
import { StudentForm, type StudentOptions, type Grade, type Group } from "./StudentForm";

// Opens the shared StudentForm in place (home اضافة→طالب). Self-fetches the
// lookups it needs. On create the form stays open + resets.
export function AddStudentModal({ onClose }: { onClose: () => void }) {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [options, setOptions] = useState<StudentOptions | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      cachedGet<Grade[]>("/grades/in-use"),
      cachedGet<Group[]>("/groups"),
      cachedGet<StudentOptions>("/students/options"),
    ])
      .then(([gr, gp, opt]) => {
        setGrades(gr);
        setGroups(gp);
        setOptions(opt);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  if (!ready || !options) return null;

  return (
    <StudentForm
      grades={grades}
      groups={groups}
      options={options}
      onClose={onClose}
      onSaved={() => {
        // Drops every cached page of the list, and the serial/suggestions the
        // new student just changed.
        invalidate("/students");
      }}
    />
  );
}
