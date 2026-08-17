/**
 * The homework flag's stored value is a whole phrase ("واجب ناقص") because that
 * is what the database column and the API have always carried, and changing it
 * would rewrite every historical row. On screen the word "واجب" is already the
 * column heading, the dropdown's own label, or the section it sits in - so it is
 * repeated in every single value it introduces.
 *
 * <p>Display strips it; the value never changes. Anything that is not one of the
 * known phrases is shown exactly as it was stored.
 */
export function homeworkLabel(flag: string | null | undefined): string {
  if (!flag) return "";
  const trimmed = flag.trim();
  return trimmed.startsWith("واجب ") ? trimmed.slice("واجب ".length) : trimmed;
}
