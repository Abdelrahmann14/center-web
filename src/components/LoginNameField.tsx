import { useEffect } from "react";
import type { Role } from "@center/core";
import { EMAIL_DOMAIN } from "@center/core";
import { Field, inputClass, requiredArabic } from "@/components/ui";
import { sanitiseLoginName, useEmailAvailability } from "@/lib/useEmailAvailability";

/**
 * The login name - only the part before the domain, which is fixed by the role.
 * A taken name is reported while typing, with free alternatives to click, so the
 * clash never reaches submit.
 */
export function LoginNameField({
  value,
  onChange,
  role,
  currentValue,
  onTakenChange,
}: {
  value: string;
  onChange: (v: string) => void;
  role: Role;
  /** The account's own current local part - never reported as taken. */
  currentValue?: string;
  /** Lets the form disable submit while the name is unavailable. */
  onTakenChange?: (taken: boolean) => void;
}) {
  const { result, checking } = useEmailAvailability(value, role, currentValue);
  const taken = result != null && result.valid && !result.available;

  // Reporting upward happens after commit - setting parent state during render
  // would warn ("cannot update a component while rendering another").
  useEffect(() => {
    onTakenChange?.(taken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taken]);

  return (
    <Field
      label="اسم المستخدم"
      // The domain lives in the hint, not beside the control: it is fixed by the
      // role, and inside the box it collided with the floating label.
      hint={`أحرف إنجليزية وأرقام فقط، بدون مسافات أو رموز · يُكمَّل بـ ${EMAIL_DOMAIN[role]}`}
    >
      <input
        type="text"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(sanitiseLoginName(e.target.value))}
        required
        {...requiredArabic}
        className={`${inputClass} ${taken ? "border-rose-400" : ""}`}
      />

      {checking && <p className="mt-1 text-xs text-slate-400">جارٍ التحقق…</p>}
      {result?.available && (
        <p className="mt-1 text-xs text-green-600">{`${result.email} متاح`}</p>
      )}
      {taken && (
        <div className="mt-1">
          <p className="text-xs text-rose-600">هذا الاسم مستخدم بالفعل. بدائل متاحة:</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {result!.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange(s)}
                className="rounded-xl border border-accent px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/10"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </Field>
  );
}
