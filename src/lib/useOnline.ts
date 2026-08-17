// Live browser connectivity as a React value. `navigator.onLine` reports the OS
// link state (not whether our server is reachable), which is exactly what the UI
// needs to grey out actions that CANNOT work offline - a WhatsApp send, a PDF
// dispatch - rather than let a click fail. Built on useSyncExternalStore so every
// consumer re-renders together on an online/offline transition.
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // assume online when there is no navigator (never strand the UI)
  );
}
