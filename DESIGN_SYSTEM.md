# psycho — Design System

> Reconstructed reference. Arabic-only, RTL, font **Noto Kufi Arabic** (never override).

## Design tokens — single source of truth

Brand values live in **`packages/design-tokens/tokens.js`** (a workspace package,
shared with the future mobile app). The web app consumes them as Tailwind theme
variables via the generated `theme.css`, imported in `src/index.css`.

- **Never hardcode a brand hex** (`bg-[#3B7A8C]`). Use the semantic utilities:
  `bg-accent`, `hover:bg-accent-hover`, `text-accent`, `border-accent`,
  `ring-accent/20`, `bg-accent/10`, `bg-dark`, `text-dark`. Opacity modifiers work
  (`bg-accent/5`). In raw CSS/SVG use `var(--color-accent)`.
- **To change a brand color:** edit `tokens.js`, then
  `npm -w @center/design-tokens run generate` (rewrites `theme.css`). Every screen
  follows automatically — that is the point.
- `theme.css` is generated; never edit it by hand.

## Colors
- Accent: token `accent` (`#3B7A8C`) — hover token `accent-hover` (`#2F6473`).
  Focus ring `ring-accent/20`.
- Sidebar / dark surface: token `dark` (`#0F172A`).
- Danger: `rose-600`. Success: `green-600`. Warning/discount: `amber-600`
  (Tailwind defaults; also mirrored in `tokens.js` for other platforms).
- Surfaces: white cards on `slate-100` page; borders `slate-200`; muted text `slate-400/500`.

## Radius / spacing
- Cards: `rounded-2xl border border-slate-200 bg-white shadow-sm`, padding `p-4`/`p-5`.
- Inputs/controls: `rounded-xl`, `inputClass` from `ui.tsx` (`px-4 py-2.5`, teal focus ring).
- Icon buttons: `rounded-lg p-1.5`, hover tint.

## Shared components (`src/components/ui.tsx`)
- `Select` / `MultiSelect` — custom on-theme dropdowns (never native `<select>`).
- `Modal` — portal, whole card scrolls, sizes `md|lg|xl|2xl|3xl`.
- `ConfirmDialog` — yes/no (danger variant red).
- `Field` (label + hint), `FieldError` (floating rose bubble, needs `relative` wrapper),
  `FormNotice` (solid rose/green form bubble), `requiredArabic` (localizes native popup).
- `AutocompleteInput` — suggestion input (School/City); the smart-search pattern.
- `PencilLoader` / `LoaderBlock` — teal loading indicator.
- `Toast` (`useToast`) — top-center success/error.

## Conventions
- Every card: always-visible controls (active toggle, edit → Modal, delete → ConfirmDialog).
- Students module = the reference implementation; copy its patterns.
- Buttons: primary = accent bg white text; secondary = slate border ghost.
- Naming: سنتر/سناتر, مساعد/مساعدون, الصف/الصفوف, الشعبة, الطلاب.
