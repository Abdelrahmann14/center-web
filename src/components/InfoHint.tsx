import { Info } from "lucide-react";

/**
 * A small "i" icon beside a title that reveals a description on hover. RTL: the
 * tooltip drops below the icon, aligned to the reading start (right).
 */
export function InfoHint({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`group relative inline-flex shrink-0 ${className}`}>
      <Info className="h-4 w-4 cursor-help text-slate-400 transition group-hover:text-accent" />
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 text-right text-xs font-normal leading-5 text-slate-600 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
