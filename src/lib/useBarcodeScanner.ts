import { useEffect, useRef } from "react";

/**
 * Detects a hardware barcode scanner working as a keyboard wedge (HID): it
 * "types" the decoded code as a very fast burst of keystrokes and ends with
 * Enter. A human types far slower, so a gap longer than BURST_GAP_MS between
 * keys resets the buffer - someone typing a number and pressing Enter never
 * triggers a scan.
 *
 * It fires ONLY when focus is not in a text field, so manual typing (including a
 * page's own search box) is never hijacked - that field resolves its own Enter,
 * and the scanner covers the case where focus has drifted elsewhere.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  // Kept in a ref so a changing handler never re-binds the listener.
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    // Scanners emit ~1-5ms between characters; humans well over 100ms.
    const BURST_GAP_MS = 50;
    const MIN_LEN = 2;
    let buffer = "";
    let lastAt = 0;

    const editable = (el: Element | null) =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable);

    function onKeyDown(e: KeyboardEvent) {
      // e.timeStamp is a monotonic millisecond clock - no wall-clock needed.
      if (e.timeStamp - lastAt > BURST_GAP_MS) buffer = "";
      lastAt = e.timeStamp;

      if (e.key === "Enter") {
        const code = buffer;
        buffer = "";
        if (code.length >= MIN_LEN && !editable(document.activeElement)) {
          e.preventDefault();
          handler.current(code);
        }
        return;
      }
      // Only printable single characters belong to a scanned code.
      if (e.key.length === 1) buffer += e.key;
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
