// The one rule every student-search box in the app follows, decided by the very
// first character typed:
//
//   starts with 0        -> a phone number (the student's OR the guardian's)
//   starts with 1-9      -> the student CODE, as a prefix (what a barcode gives)
//   anything else        -> a name / school / residential area
//
// Splitting on the leading zero is what makes one box able to serve both jobs
// without a mode switch: every Egyptian mobile starts with one and no student
// code does, so a run of digits can only mean one thing. It also stops "12" from
// dredging up every phone containing 12 when the user plainly meant code 12.
//
// This file is the single source of that rule for the browser, and it matches
// `StudentSpecifications.search` on the server character for character - the same
// text has to find the same students whether the query ran against Postgres, the
// offline mirror, or a list already in memory.

export type SearchMode = "phone" | "code" | "text" | "empty";

/** Which of the three searches this term asks for. */
export function searchMode(term: string): SearchMode {
  const t = (term ?? "").trim();
  if (!t) return "empty";
  if (t.startsWith("0")) return "phone";
  return /^[0-9]/.test(t) ? "code" : "text";
}

/**
 * Fold Arabic orthographic variants so a search matches the way a human reads:
 * أ/إ/آ are all ا, ى is ي, ة is ه, and the diacritics are noise.
 */
export function foldArabic(s: string): string {
  return (s ?? "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْـ]/g, "")
    .trim()
    .toLowerCase();
}

/** The subset of a student a search ever looks at. */
export interface SearchableStudent {
  name?: string | null;
  serial?: number | string | null;
  school?: string | null;
  city?: string | null;
  student_phones?: string[] | null;
  parent_phones?: string[] | null;
}

/** Apply the rule to one student, in memory. */
export function matchesStudentSearch(s: SearchableStudent, term: string): boolean {
  const t = (term ?? "").trim();
  switch (searchMode(t)) {
    case "empty":
      return true;
    case "phone": {
      const digits = t.replace(/\D/g, "");
      return [...(s.student_phones ?? []), ...(s.parent_phones ?? [])].some((p) =>
        String(p).includes(digits),
      );
    }
    case "code":
      return String(s.serial ?? "").startsWith(t);
    default: {
      const q = foldArabic(t);
      return [s.name, s.school, s.city].some((v) => foldArabic(String(v ?? "")).includes(q));
    }
  }
}

/**
 * A one-line hint of what the box will do with what has been typed, so the rule
 * is discoverable instead of folklore.
 */
export function searchModeLabel(term: string): string | null {
  switch (searchMode(term)) {
    case "phone":
      return "بحث برقم الهاتف";
    case "code":
      return "بحث بكود الطالب";
    case "text":
      return "بحث بالاسم";
    default:
      return null;
  }
}

/** The placeholder: what the box searches, without spelling out the mechanism. */
export const STUDENT_SEARCH_PLACEHOLDER = "ابحث بالاسم أو رقم الهاتف أو كود الطالب";
