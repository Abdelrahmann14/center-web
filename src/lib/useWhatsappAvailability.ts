// Whether a WhatsApp action can be offered, and through which number.
//
// The backend decides; this only mirrors. Every screen that used to answer the
// question for itself ("is a number connected?") got it wrong, because a number
// also needs an approved template for that particular message type. So the rule
// lives in one endpoint, and a page asks here rather than reasoning about it.
//
// The answer is cached for the app's lifetime and shared between callers: half a
// dozen pages mount this, it changes only when someone edits the WhatsApp
// settings, and a fresh request per button would be absurd. `refreshWhatsapp()`
// drops the cache after such an edit.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface WhatsappMessageType {
  code: string;
  label: string;
  description: string;
  carries_file: boolean;
  /** The number explicitly chosen for this type, or null. */
  instance_id: string | null;
  /** The number that would actually carry it right now, or null. */
  effective_instance_id: string | null;
  number_label: string | null;
  template_id: string | null;
  template_name: string | null;
  ready: boolean;
  blocked_reason: string | null;
}

export interface WhatsappAvailability {
  enabled: boolean;
  connected_count: number;
  types: WhatsappMessageType[];
}

/** What a screen assumes before the answer arrives: nothing is available yet. */
const UNKNOWN: WhatsappAvailability = {
  enabled: false,
  connected_count: 0,
  types: [],
};

let cache: Promise<WhatsappAvailability> | null = null;
const listeners = new Set<(a: WhatsappAvailability) => void>();

function load(): Promise<WhatsappAvailability> {
  if (!cache) {
    cache = api
      .get<WhatsappAvailability>("/services/whatsapp/availability")
      // A failure here must not break the page that asked. Treating it as
      // "nothing available" is the safe direction: a disabled button explains
      // itself, an enabled one that fails does not.
      .catch(() => UNKNOWN);
  }
  return cache;
}

/** Re-reads availability after a settings change, updating every mounted caller. */
export function refreshWhatsapp() {
  cache = null;
  load().then((a) => listeners.forEach((fn) => fn(a)));
}

/**
 * @returns the availability, and whether it has arrived yet. While `loading` is
 *          true a button should be disabled but NOT explained - the reason is
 *          not known yet, and guessing one reads as a bug.
 */
export function useWhatsappAvailability(): {
  availability: WhatsappAvailability;
  loading: boolean;
} {
  const [state, setState] = useState<WhatsappAvailability | null>(null);

  useEffect(() => {
    let alive = true;
    const update = (a: WhatsappAvailability) => alive && setState(a);
    listeners.add(update);
    load().then(update);
    return () => {
      alive = false;
      listeners.delete(update);
    };
  }, []);

  return { availability: state ?? UNKNOWN, loading: state === null };
}

/**
 * One message type's readiness, for a button that sends exactly one kind of
 * message. `disabled` is what goes on the button; `reason` is what goes in its
 * title, so the user is told why rather than left with a dead control.
 */
export function useWhatsappAction(code: string): {
  ready: boolean;
  disabled: boolean;
  reason: string | null;
  numberLabel: string | null;
} {
  const { availability, loading } = useWhatsappAvailability();
  const type = availability.types.find((t) => t.code === code) ?? null;
  const ready = !loading && !!type?.ready;
  return {
    ready,
    disabled: !ready,
    reason: loading ? null : (type?.blocked_reason ?? "ميزة واتساب غير متاحة"),
    numberLabel: type?.number_label ?? null,
  };
}
