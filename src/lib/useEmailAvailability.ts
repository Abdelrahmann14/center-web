import { useEffect, useState } from "react";
import type { EmailAvailability, Role } from "@center/core";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";

/**
 * Debounced check of whether a login name is free for a role. Accounts sign in
 * with `<name>@center.<role>.com`, so the clash - and the suggested
 * alternatives - are surfaced while typing rather than on submit.
 *
 * <p>Stays null for a blank name or the account's own unchanged one.
 */
export function useEmailAvailability(
  localPart: string,
  role: Role,
  currentLocalPart?: string,
): { result: EmailAvailability | null; checking: boolean } {
  const debounced = useDebounced(localPart.trim(), 400);
  const [result, setResult] = useState<EmailAvailability | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!debounced || debounced === (currentLocalPart ?? "").trim()) {
      setResult(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    api
      .get<EmailAvailability>(
        `/accounts/email-available?username=${encodeURIComponent(debounced)}&role=${role}`,
      )
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setResult(null))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, role, currentLocalPart]);

  return { result, checking };
}

/** Strips anything the login-name rules forbid (letters and digits only). */
export function sanitiseLoginName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
}

/** The part before '@' - what the forms show and edit. */
export function localPartOf(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  return at < 0 ? email : email.slice(0, at);
}
