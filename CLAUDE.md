# psycho — project instructions for AI assistants

**Before writing ANY UI, read [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).** It is the
authoritative style guide. Match it exactly — consistency over novelty.

## Non-negotiable rules

- UI is **Arabic-only, RTL**. Never English UI text (except the login field
  "اسم المستخدم"). Permanent font: **Noto Kufi Arabic** — never override.
- Dropdowns → shared `Select` (never native `<select>`).
- Dialogs/forms → shared `Modal` (never hand-rolled `fixed inset-0` overlays).
  Form in `children` with an `id`; footer submit uses `form="<id>"`.
- Validation → `FieldError` (inline rose bubble) + `FormNotice` (form bubble) +
  `requiredArabic` for empty-field "مطلوب". Never the rose-50 box or the English
  browser popup.
- Loading → `PencilLoader` / `LoaderBlock`.
- Accent color `#3B7A8C` (hover `#2F6473`); dark surface `#0F172A`; danger
  `rose-600`; success `green-600`.
- Arabic naming: سنتر/سناتر (not مركز), مساعد/مساعدون (not مستخدم), الصف/الصفوف,
  الشعبة (not المسار), الطلاب.
- Reuse from `src/components/ui.tsx`. The **Students module is the reference
  implementation** — copy its patterns.

## Stack / workflow

- Frontend: React 19 + Vite + TS + Tailwind 4 (`@/` → `src/`), talks to the
  backend over REST. Dev server is web on **:5174** (`npm run dev`).
- Backend: **Spring Boot 3.4 (Java 21)** at `server/`, built/run with the Maven
  wrapper (`./mvnw spring-boot:run`). Data via Spring Data JPA / Hibernate on
  Postgres (Supabase). The old FastAPI/psycopg + pywebview `.exe` backend is
  **gone** (`desktop/main.py` is dead — ignore it).
- Migrations: **Flyway** SQL in `server/src/main/resources/db/migration`,
  V-numbered (e.g. `V15__thing.sql`), applied automatically on app startup — not
  a Python runner. Every feature: design schema → add next `V*` migration →
  implement.
- Verify frontend with `tsc --noEmit`. **Never run `npm run build`** — the user
  runs the dev server.
- Auth is **mandatory JWT** — stateless, no bypass in any profile (there is no
  `SECURITY_ENABLED`; `src/config.ts` is deleted). Public routes only:
  `/api/auth/login`, `/api/health`, `/api/auth/logout`, swagger.
- Multi-tenant: **Admin = workspace root**; role hierarchy
  SUPER_ADMIN → ADMIN → USER (assistant) → STUDENT, each inheriting the ranks
  below. Tenant scoping via Hibernate `@TenantId` on `admin_id`. See memory
  `psycho-tenancy.md`.
