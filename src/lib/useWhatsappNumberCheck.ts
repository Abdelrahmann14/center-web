import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { useOnline } from "@/lib/useOnline";

/**
 * Whether one number is on WhatsApp, answered while it is being typed.
 *
 * <p>"unknown" is a real answer and not a failure to have one: the check service
 * may be off, or the third party may not have replied. Showing that as "no
 * WhatsApp" would tell a receptionist to go and ask a family for another number
 * that works perfectly well, so the two are kept apart all the way to the badge.
 */
export type NumberCheck = "idle" | "checking" | "yes" | "no" | "unknown";

/**
 * Answers already seen in this tab.
 *
 * <p>Module-level, so it survives the form being closed and reopened and is
 * shared by the student's numbers and the guardian's. Typing a digit and
 * deleting it again is then free, and so is re-entering a number the desk just
 * saw. The server stores its own answers for good; this only saves the round
 * trip.
 */
const seen = new Map<string, boolean | null>();

/** 11 digits starting 01 - anything shorter is still being typed. */
function complete(phone: string): boolean {
  return /^01\d{9}$/.test(phone);
}

export function useWhatsappNumberCheck(phone: string): NumberCheck {
  const online = useOnline();
  // Debounced so a number is asked about once, when the typing stops - not
  // eleven times on the way to the last digit.
  const settled = useDebounced(phone);
  const [state, setState] = useState<NumberCheck>("idle");

  useEffect(() => {
    if (!complete(settled)) {
      setState("idle");
      return;
    }
    if (seen.has(settled)) {
      const hit = seen.get(settled);
      setState(hit === null ? "unknown" : hit ? "yes" : "no");
      return;
    }
    // Offline the mirror has nothing to say about a number nobody has asked
    // about, and the queue must not carry a question - by the time it drained,
    // whoever asked has long since saved the student.
    if (!online) {
      setState("idle");
      return;
    }

    let cancelled = false;
    setState("checking");
    api
      .get<{ phone: string; exists: boolean | null }>(
        `/messaging/whatsapp/check-number?phone=${encodeURIComponent(settled)}`,
      )
      .then((r) => {
        seen.set(settled, r.exists);
        if (!cancelled) setState(r.exists === null ? "unknown" : r.exists ? "yes" : "no");
      })
      .catch(() => {
        // Deliberately NOT remembered: a failed request is not an answer, and
        // caching it would make one bad moment permanent for that number.
        if (!cancelled) setState("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [settled, online]);

  return state;
}
