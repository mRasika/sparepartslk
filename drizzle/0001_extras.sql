-- Trigram search on part names.
create extension if not exists pg_trgm;
--> statement-breakpoint
create index if not exists parts_name_trgm_idx on public.parts using gin (name gin_trgm_ops);
--> statement-breakpoint

-- RLS on with no policies: anon/authenticated (browser) roles can never read app data.
-- The app connects as the table owner, which bypasses RLS.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
--> statement-breakpoint

-- Nightly check: flags every part whose cached qty differs from its ledger sum
-- (skipping parts that already have an unresolved issue). Returns rows inserted.
create or replace function public.reconcile_stock() returns integer
language plpgsql
set search_path = public
as $$
declare inserted integer;
begin
  insert into stock_reconciliation_issues (part_id, stored_qty, ledger_qty)
  select p.id, p.qty_on_hand, coalesce(m.ledger_qty, 0)
  from parts p
  left join (
    select part_id, sum(qty_change)::integer as ledger_qty
    from stock_movements
    group by part_id
  ) m on m.part_id = p.id
  where p.qty_on_hand <> coalesce(m.ledger_qty, 0)
    and not exists (
      select 1 from stock_reconciliation_issues i
      where i.part_id = p.id and i.resolved_at is null
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
