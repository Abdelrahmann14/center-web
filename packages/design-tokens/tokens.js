// Canonical design tokens - the single source of truth for psycho's visual
// language across every client. The desktop web app consumes these as Tailwind
// theme variables (see the generated theme.css); the future React Native app
// imports this module directly. Change a value here, run `npm run generate`,
// and every platform follows.

/** Brand + semantic colors. */
export const color = {
  /** Primary brand teal. */
  accent: "#3B7A8C",
  /** Hover/pressed state of the accent. */
  accentHover: "#2F6473",
  /** Dark surface - sidebar, dark panels. */
  dark: "#0F172A",

  // Status colors (match Tailwind's rose-600 / green-600 / amber-600 so the web
  // can keep using those utilities while other platforms read them from here).
  danger: "#E11D48",
  success: "#16A34A",
  warning: "#D97706",

  // Neutrals - reference values; the web uses Tailwind's slate scale directly.
  surface: "#FFFFFF",
  page: "#F1F5F9", // slate-100
  border: "#E2E8F0", // slate-200
  textMuted: "#94A3B8", // slate-400
};

/**
 * The subset exposed to Tailwind as `--color-*` utilities: brand colors that
 * are NOT in Tailwind's default palette. Each key becomes bg-<key>, text-<key>,
 * border-<key>, ring-<key> (with opacity modifiers, e.g. bg-accent/10). Status
 * and neutral colors are omitted here because Tailwind already ships them.
 */
export const tailwindColors = {
  accent: color.accent,
  "accent-hover": color.accentHover,
  dark: color.dark,
};

/** Corner radii - control = rounded-xl, card = rounded-2xl. */
export const radius = {
  control: "0.75rem",
  card: "1rem",
};

/** Typography. RTL Arabic UI; this font is never overridden. */
export const font = {
  arabic: '"Noto Kufi Arabic", system-ui, sans-serif',
};

export default { color, tailwindColors, radius, font };
