# Sparepartslk

Stock management and billing for a single-store motorbike spare-parts business (B2B, Sri Lanka).

- **Stock:** parts with tier prices and bike fitments, goods received (GRN) with weighted average cost,
  adjustments, low-stock list with CSV export, and a full stock history per part.
- **Billing:** keyboard-first invoices (cash or credit) with tier pricing, discounts and VAT;
  A4, 80 mm receipt and PDF printing; payments with oldest-first allocation; returns and credit notes;
  statements, outstanding and overdue lists.
- **Control:** admin and staff roles, gapless document numbers, an append-only stock ledger,
  and a nightly check that stock on hand matches the ledger.

Design: [`docs/superpowers/specs/2026-10-22-stock-billing-mvp-design.md`](docs/superpowers/specs/2026-10-22-stock-billing-mvp-design.md).

## Prerequisites

- Node.js 20+ and pnpm 9+
- Docker Desktop, running (the local Supabase stack runs in Docker)
- Google Chrome (the end-to-end tests drive the installed Chrome)

## Local setup

```sh
pnpm install
pnpm supabase start          # Postgres + Auth in Docker; prints the keys
cp .env.example .env.local   # paste the anon and service_role keys printed above
pnpm db:migrate
pnpm db:seed -- --admin-email you@example.com --admin-password 'choose-a-password'
pnpm dev                     # http://localhost:3000
```

Sign in with the admin you just seeded, then add staff under **Users**.
For realistic test data, run `pnpm db:seed-demo` (local only; production is set up with `db:seed` alone, so it starts empty).
To start the local database over: `pnpm supabase db reset`, then `pnpm db:migrate`, `pnpm db:seed …` and optionally `pnpm db:seed-demo`.
`pnpm supabase status` prints the keys again; Supabase Studio runs at <http://127.0.0.1:54323>.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app |
| `pnpm test` | Service and unit tests (Vitest) against the `sparepartslk_test` database, created and migrated automatically |
| `pnpm test:e2e` | End-to-end tests (Playwright, installed Chrome). Starts its own server on port 3100 against the test database and resets it first |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm build` | Production build |
| `pnpm db:generate` | Generate a migration after changing `src/server/db/schema` |
| `pnpm db:migrate` | Apply migrations (uses `DIRECT_URL`) |
| `pnpm db:seed` | Base data (price tiers, walk-in customer, settings) and the first admin; safe to re-run |
| `pnpm db:seed-demo` | **Local testing only.** Loads ~30 parts, suppliers, customers and two months of GRNs, invoices, payments and returns. Refuses any non-local database; loads once |

`supabase start` must be running for `pnpm test` and `pnpm test:e2e`.

## Deploying (Vercel + Supabase)

1. **Create a Supabase project.** From **Project Settings → API** copy the URL, anon key and service_role key.
   From **Database → Connection string** copy the **transaction pooler** URL (port 6543) for `DATABASE_URL`
   and the **direct** URL (port 5432) for `DIRECT_URL`.
2. **Run migrations and seed from your machine** against the new project:

   ```sh
   DIRECT_URL='postgresql://…:5432/postgres' DATABASE_URL="$DIRECT_URL" pnpm db:migrate
   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DATABASE_URL="$DIRECT_URL" \
     pnpm db:seed -- --admin-email owner@yourshop.lk --admin-password '…'
   ```

3. **Schedule the nightly stock check.** Enable the `pg_cron` extension (Database → Extensions), then run
   [`supabase/cron.sql`](supabase/cron.sql) in the SQL editor. It runs `reconcile_stock()` at 02:00 Colombo time;
   mismatches appear on the admin dashboard.
4. **Logo storage.** The `branding` bucket is created automatically the first time an admin uploads a logo
   under **Settings**. To create it by hand: Storage → New bucket → `branding`, public.
5. **Deploy to Vercel.** Import the repo and set these environment variables (Production and Preview):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DATABASE_URL` (pooler URL), `DIRECT_URL`.
6. In Supabase **Authentication → URL configuration**, set the Site URL to the Vercel domain.

Backups: Supabase takes daily backups. Issued documents are never deleted, as tax records must be kept for at least 5 years.

## Tax invoice compliance (IRD)

With VAT turned on in **Settings**, invoices are titled **TAX INVOICE**, show the supplier and buyer TIN,
a VAT breakdown and a sequential serial number. The IRD standard tax-invoice format has been gazetted and
postponed several times (Gazettes 2463/05, 2481/22, 2500/106). **Before go-live, check the current mandatory
fields on ird.gov.lk / documents.gov.lk** and adjust `src/components/print/invoice-a4.tsx` and
`src/components/print/invoice-pdf.tsx` if needed.

## How it fits together

- Next.js 15 App Router. Every write is a Server Action (`src/server/actions`) that checks the user and calls a
  service (`src/server/services`). Each service runs one database transaction that locks the affected parts rows.
- Stock lives in two places kept in step: the append-only `stock_movements` ledger and the cached
  `parts.qty_on_hand`. `reconcile_stock()` compares them nightly.
- Supabase provides Postgres and Auth only. Data access goes through Drizzle on the server; row-level security
  is on for every table with no policies, so the browser can't read data directly.
- Money is `numeric(12,2)` and all arithmetic uses decimal.js (`src/lib/money.ts`), rounding half-up.
- Business dates and document-number years use Asia/Colombo time.
