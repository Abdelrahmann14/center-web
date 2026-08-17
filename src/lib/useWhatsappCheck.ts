// Looks up, per phone number, whether it is registered on WhatsApp.
//
// Debounced and cached per number for the component's lifetime, so editing other
// fields never re-checks a number already resolved. It asks the workspace's own
// endpoint rather than the public /register one because that endpoint REMEMBERS
// the answer: a number reaches Green API once, and every later form - and every
// student sharing that phone - is answered from storage.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { useOnline } from "@/lib/useOnline";

export type WaStatus = "checking" | "yes" | "no" | "unknown";

const digits = (p: string) => p.replace(/\D/g, "");

export function useWhatsappCheck(phones: string[]): Record<string, WaStatus> {
  const online = useOnline();
  const [map, setMap] = useState<Record<string, WaStatus>>({});
  // Numbers with a DEFINITIVE server answer (yes/no). Only these are never
  // re-checked; an unresolved number stays open so a reconnect re-checks it.
  const resolved = useRef<Set<string>>(new Set());

  const list = phones.map(digits).filter((d) => d.length === 11);
  const key = useDebounced(JSON.stringify(list));

  useEffect(() => {
    const nums: string[] = JSON.parse(key);

    // Offline: the check needs the server, so don't attempt it. Show unresolved
    // numbers as "unknown" and leave them open, so when the connection returns
    // this effect re-runs (online is a dep) and reviews them automatically.
    if (!online) {
      setMap((m) => {
        const next = { ...m };
        for (const d of nums) if (!resolved.current.has(d)) next[d] = "unknown";
        return next;
      });
      return;
    }

    for (const d of nums) {
      if (resolved.current.has(d)) continue;
      setMap((m) => ({ ...m, [d]: "checking" }));
      api
        .get<{ exists_whatsapp: boolean; checked: boolean }>(`/students/check-whatsapp?phone=${d}`)
        .then((r) => {
          // Only a real answer is final; an unchecked number is retried later.
          if (r.checked) resolved.current.add(d);
          setMap((m) => ({ ...m, [d]: !r.checked ? "unknown" : r.exists_whatsapp ? "yes" : "no" }));
        })
        .catch(() => setMap((m) => ({ ...m, [d]: "unknown" })));
    }
  }, [key, online]);

  return map;
}
