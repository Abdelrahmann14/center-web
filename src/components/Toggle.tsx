// Shared on/off switch. Green when on, grey when off; the knob sits on the
// start (right) side when on. RTL-aware via an explicit offset so direction
// never flips the visual meaning.

export function Toggle({
  checked,
  onChange,
  disabled = false,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-green-600" : "bg-slate-300"
      }`}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
        style={{ right: checked ? 2 : 22 }}
      />
    </button>
  );
}
