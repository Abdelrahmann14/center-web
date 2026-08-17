// How many parts an Egyptian student name is expected to have, and how few it
// may be saved with. Mirrors ValidationRules on the server.
//
// The distinction matters: the form used to REFUSE anything under four parts,
// which meant a student genuinely known by two names could not be entered at all
// and people invented a third word to get past it - worse data than a short name
// honestly recorded. Two parts now save; four is still the complete form, and
// anything less leaves the record flagged as incomplete so it can be chased.

export const NAME_MIN_PARTS = 2;
export const NAME_FULL_PARTS = 4;

export function nameParts(name: string | null | undefined): number {
  const t = (name ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Enough to save. */
export function isSaveableName(name: string | null | undefined): boolean {
  return nameParts(name) >= NAME_MIN_PARTS;
}

/** The complete four-part name; short of this the record reads as incomplete. */
export function isFullName(name: string | null | undefined): boolean {
  return nameParts(name) >= NAME_FULL_PARTS;
}
