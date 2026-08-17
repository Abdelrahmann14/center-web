import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "@/components/icons";
import { inputClass } from "@/components/ui";

/**
 * A password box that can be read back.
 *
 * <p>Two things it fixes, both of which produced wrong passwords rather than
 * merely awkward ones:
 *
 * <p>DIRECTION. The app is right-to-left, so a bare input inherited RTL and a
 * Latin password came out laid backwards on screen - the characters were stored
 * correctly but read in the opposite order, so whoever typed the password for
 * an assistant then dictated it wrong. A password is a sequence, never a
 * sentence: it is always laid out left to right, whatever the page around it
 * does.
 *
 * <p>VISIBILITY. Someone setting a password for another person has to be able
 * to see what they set, which is why these fields were plain text before - at
 * the cost of showing the password to the room on the sign-in screen too. The
 * eye gives both: masked by default, revealed while asked for.
 */
export function PasswordInput({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "dir">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        // A password is a character sequence, so it is written and read in one
        // direction regardless of the page's.
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // ps-11 (start padding): the button sits on the LEFT of the box in this
        // RTL layout, which is the field's logical end.
        className={`${className ?? inputClass} ps-11 text-left`}
      />
      <button
        type="button"
        // Never take focus from the field being typed into.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown((v) => !v)}
        title={shown ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        aria-label={shown ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        className="absolute inset-y-0 left-0 flex w-11 items-center justify-center text-slate-400 transition hover:text-accent"
      >
        {shown ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}
