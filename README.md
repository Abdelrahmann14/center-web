# psycho — Arabic teacher student-management app

Desktop + web app for a private Arabic teacher: students, groups, lectures,
lesson registration (attendance), assistants (monthly attendance + payroll),
grades/centers with per-grade pricing, and analytics.

Stack: React 19 + Vite + TS + Tailwind 4 (frontend) · FastAPI + psycopg → Supabase
Postgres (backend) · pywebview + PyInstaller → `.exe` (desktop).

## First-time setup

### Backend
```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env        # then fill DATABASE_URL + JWT_SECRET
.venv\Scripts\python -m migrations.run_migrations
.venv\Scripts\python make_admin.py admin <password>
.venv\Scripts\python -m uvicorn api.app:app --reload --reload-dir api --port 8001
```

> Python **3.12** required (3.13/3.14 lack binary wheels for psycopg/bcrypt).
> Use the Supabase **Session Pooler** host (IPv4). URL-encode the DB password.

### Frontend
```powershell
npm install
npm run dev        # http://localhost:5174, proxies /api -> 127.0.0.1:8001
npm run build      # tsc --noEmit + vite build -> dist/
```

## Auth toggle
`SECURITY_ENABLED` in both `src/config.ts` and `backend/.env`. Currently **off**
(auto-runs as admin, no login). Flip **both** to `true` to enable auth.

## Migrations
`backend/migrations/NNN_*.sql`, applied via `python -m migrations.run_migrations`
(tracked by filename in `schema_migrations`). Note: two `012_` files exist
(assistant_management + registrations) — both valid. Next free number: **014**.

## Roles
- **admin** → groups, grades/centers, analytics, assistants (المساعدون).
- **user** → students, lectures, lesson registration (تسجيل الحصة).
