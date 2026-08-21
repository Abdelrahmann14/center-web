/**
 * The local Egyptian form of a number, so two spellings of one phone compare
 * equal.
 *
 * <p>The roster stores "01012345678", but a number can arrive written as
 * "+20 101 234 5678" or "201012345678" - from an import, a paste, or the
 * message log, which records whatever was handed to WhatsApp. Comparing those
 * as text says they are different people.
 *
 * <p>Deliberately the same rule as the server's `WhatsappSendLogListener.localPhone`:
 * both sides of the WhatsApp-reachability lookup have to fold a number the same
 * way, or the map arrives keyed in a form the page cannot find.
 */
export function localPhone(raw: string | null | undefined): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d && !d.startsWith("0")) d = "0" + d;
  return d;
}
