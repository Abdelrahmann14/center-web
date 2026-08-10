import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";

export type Availability = "idle" | "checking" | "available" | "taken";

/**
 * Debounced check of whether a username is free (usernames are globally unique).
 * Stays "idle" for a blank name or the account's own unchanged name.
 */
export function useUsernameAvailability(username: string, currentName?: string): Availability {
  const debounced = useDebounced(username.trim(), 400);
  const [state, setState] = useState<Availability>("idle");

  useEffect(() => {
    if (!debounced || debounced === (currentName ?? "").trim()) {
      setState("idle");
      return;
    }
    let cancelled = false;
    setState("checking");
    api
      .get<{ available: boolean }>(
        `/users/username-available?username=${encodeURIComponent(debounced)}`,
      )
      .then((r) => !cancelled && setState(r.available ? "available" : "taken"))
      .catch(() => !cancelled && setState("idle"));
    return () => {
      cancelled = true;
    };
  }, [debounced, currentName]);

  return state;
}
