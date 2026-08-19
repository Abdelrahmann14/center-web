import { isFullName } from "@/lib/studentName";
import type { Grade, Student } from "./StudentForm";

// The exact set of fields the students page counts toward "بيانات مكتملة". One
// source of truth, so the row colour, the detail view and the edit form all
// agree on what "ناقص" means for a given student.
export type StudentField =
  | "name"
  | "grade"
  | "school"
  | "city"
  | "gender"
  | "group"
  | "student_phones"
  | "parent_phones";

/** Arabic labels for each field, for the missing-data summary. */
export const STUDENT_FIELD_LABEL: Record<StudentField, string> = {
  name: "الاسم بالكامل",
  grade: "الصف",
  school: "المدرسة",
  city: "المنطقة السكنية",
  gender: "النوع",
  group: "المجموعة",
  student_phones: "هاتف الطالب",
  parent_phones: "هاتف ولي الأمر",
};

/**
 * Which required fields a student is still missing. A name shorter than four
 * parts counts as incomplete even though it saves.
 */
export function missingStudentFields(s: Student, _grades: Grade[]): Set<StudentField> {
  const out = new Set<StudentField>();
  if (!isFullName(s.name)) out.add("name");
  if (!s.grade?.trim()) out.add("grade");
  if (!s.school?.trim()) out.add("school");
  if (!s.city?.trim()) out.add("city");
  if (!s.gender) out.add("gender");
  if (!s.group_id) out.add("group");
  if (s.student_phones.length === 0) out.add("student_phones");
  if (s.parent_phones.length === 0) out.add("parent_phones");
  return out;
}

/** Whether the student is missing any required field (the amber-row rule). */
export function isIncomplete(s: Student, grades: Grade[]): boolean {
  return missingStudentFields(s, grades).size > 0;
}
