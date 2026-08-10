// The application's primary brand mark. Single source of truth: every place that
// shows the logo (sidebar, login) renders this component.
import logoUrl from "@/assets/logo.png";

export function Logo({ className }: { className?: string }) {
  return <img src={logoUrl} alt="سنتر" className={`object-contain ${className ?? ""}`} />;
}
