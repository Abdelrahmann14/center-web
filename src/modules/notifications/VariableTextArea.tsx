import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { VariableEditor, type MessageVariable } from "@/components/VariableEditor";

/**
 * The message field used across the Messages page. It loads the variable catalog
 * once and hands it to {@link VariableEditor}, which renders every inserted
 * variable as a readable chip ("اسم الطالب") instead of the stored token.
 *
 * <p>The catalog is fetched once per session and shared: it is small, it never
 * changes at runtime, and three editors on one screen asking separately only
 * produced three identical requests.
 */

let cache: MessageVariable[] | null = null;
let inFlight: Promise<MessageVariable[]> | null = null;

function loadVariables(): Promise<MessageVariable[]> {
  if (cache) return Promise.resolve(cache);
  inFlight ??= api
    .get<MessageVariable[]>("/messaging/variables")
    .then((v) => {
      cache = v;
      return v;
    })
    .catch(() => {
      // Offline or refused: the editor still works, it just cannot offer chips
      // until the next attempt, so the in-flight promise is cleared to allow one.
      inFlight = null;
      return [];
    });
  return inFlight;
}

export function VariableTextArea({
  value,
  onChange,
  rows = 6,
  placeholder,
  disabled,
  leading,
  fieldTint,
  onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  leading?: React.ReactNode;
  fieldTint?: string;
  /** Fired when the author leaves the field - see VariableEditor.onCommit. */
  onCommit?: () => void;
}) {
  const [vars, setVars] = useState<MessageVariable[]>(cache ?? []);

  useEffect(() => {
    let alive = true;
    loadVariables().then((v) => {
      if (alive && v.length) setVars(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <VariableEditor
      value={value}
      onChange={onChange}
      variables={vars}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      leading={leading}
      fieldTint={fieldTint}
      onCommit={onCommit}
    />
  );
}
