import { useEffect, useState } from "react";

/**
 * Delays a fast-changing value so typing doesn't fire a request per keystroke.
 * Used by the server-side search boxes.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
