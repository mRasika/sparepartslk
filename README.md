# Sparepartslk

Stock management and billing for a single-store motorbike spare-parts business.

## Prerequisites

- Node.js 20+ and pnpm 9+
- Docker Desktop (running) — needed by the local Supabase stack

## Local setup

```sh
pnpm install
pnpm supabase start          # starts Postgres + Auth in Docker; prints keys
cp .env.example .env.local   # paste the anon and service_role keys printed above
pnpm db:migrate
pnpm db:seed -- --admin-email you@example.com --admin-password 'change-me'
pnpm dev
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app on http://localhost:3000 |
| `pnpm test` | Vitest service/unit tests (needs `supabase start`) |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed base data and the first admin user |
