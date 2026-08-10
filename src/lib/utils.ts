// Tiny className joiner. The project is not shadcn, so there is no clsx or
// tailwind-merge dependency; this keeps conditional class lists readable without
// adding packages. Callers must avoid passing two conflicting Tailwind utilities
// for the same property (compute the final class instead of layering overrides).
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
