import { useEffect, useState } from "react";
import { cachedGet, invalidate } from "@/lib/dataCache";
import { LectureForm, type Grade } from "./LectureForm";

// Opens the shared LectureForm in place (home اضافة→حصة). Self-fetches grades.
export function AddLectureModal({ onClose }: { onClose: () => void }) {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    cachedGet<Grade[]>("/grades/in-use")
      .then(setGrades)
      .finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <LectureForm
      grades={grades}
      onClose={onClose}
      onSaved={() => invalidate("/lectures")}
    />
  );
}
