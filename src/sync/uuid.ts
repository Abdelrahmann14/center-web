// UUIDv7 (time-ordered) and a local calendar-date helper. Browser crypto is
// available, so we use it for the random bits.
function randomHex(nibbles: number): string {
  const bytes = new Uint8Array(Math.ceil(nibbles / 2));
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out.slice(0, nibbles);
}

export function uuidv7(): string {
  const tsHex = Date.now().toString(16).padStart(12, "0");
  const rand = randomHex(20);
  const timeLow = tsHex.slice(0, 8);
  const timeMid = tsHex.slice(8, 12);
  const verRandA = "7" + rand.slice(0, 3);
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  const randB = variant + rand.slice(3, 6);
  const randC = rand.slice(6, 18);
  return `${timeLow}-${timeMid}-${verRandA}-${randB}-${randC}`;
}

/** Today's local date "YYYY-MM-DD". */
export function localDateIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
