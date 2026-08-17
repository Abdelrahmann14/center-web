// What each role is CALLED, in one place.
//
// The database calls the workspace owner "admin", because that is what they are
// to the system: the root of one tenant. To everyone using the product they are
// the teacher - it is their center, their students, their name on the barcode -
// and an interface that calls them "مدير" is describing our schema rather than
// their job. "user" has the same problem in the other direction: it means
// assistant, and "مستخدم" says nothing at all.
//
// The wire values are untouched. This is only what people read.

import type { Role } from "@/auth/AuthContext";

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "مشرف عام",
  admin: "مدرّس",
  user: "مساعد",
  student: "طالب",
  parent: "ولي أمر",
};

export function roleLabel(role: Role | string | null | undefined): string {
  if (!role) return "";
  return ROLE_LABEL[role] ?? String(role);
}
