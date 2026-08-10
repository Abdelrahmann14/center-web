// Looks up, per phone number, whether it is registered on WhatsApp (Green API).
// Debounced and cached per number for the component's lifetime, so editing other
// fields never re-checks a number already resolved.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";

export type WaStatus = "checking" | "yes" | "no" | "unknown";

const digits = (p: string) => p.replace(/\D/g, "");

export function useWhatsappCheck(phones: string[]): Record<string, WaStatus> {
  const [map, setMap] = useState<Record<string, WaStatus>>({});
  const requested = useRef<Set<string>>(new Set());

  const list = phones.map(digits).filter((d) => d.length === 11);
  const key = useDebounced(JSON.stringify(list));

  useEffect(() => {
    const nums: string[] = JSON.parse(key);
    for (const d of nums) {
      if (requested.current.has(d)) continue;
      requested.current.add(d);
      setMap((m) => ({ ...m, [d]: "checking" }));
      api
        .get<{ exists_whatsapp: boolean; checked: boolean }>(`/register/check-whatsapp?phone=${d}`)
        .then((r) =>
          setMap((m) => ({ ...m, [d]: !r.checked ? "unknown" : r.exists_whatsapp ? "yes" : "no" }))
        )
        .catch(() => setMap((m) => ({ ...m, [d]: "unknown" })));
    }
  }, [key]);

  return map;
}
