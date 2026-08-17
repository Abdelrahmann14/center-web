// UUIDv7: time-ordered so client-generated ids sort by creation and keep good
// index locality. Good enough without a native crypto dependency - the random
// bits make a collision negligible for one device's offline writes. Ported from
// the mobile client so both platforms mint the same id shape for the outbox.
function hexNibble(): string {
  return Math.floor(Math.random() * 16).toString(16);
}

export function uuidv7(): string {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, "0"); // 48-bit millisecond timestamp
  let rand = "";
  for (let i = 0; i < 20; i++) rand += hexNibble();

  const timeLow = tsHex.slice(0, 8);
  const timeMid = tsHex.slice(8, 12);
  const verAndRandA = "7" + rand.slice(0, 3); // version 7
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16); // 10xx
  const randB = variant + rand.slice(3, 6);
  const randC = rand.slice(6, 18);
  return `${timeLow}-${timeMid}-${verAndRandA}-${randB}-${randC}`;
}

/** Today's local calendar date as "YYYY-MM-DD" (the app is used in Egypt). */
export function localDateIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
