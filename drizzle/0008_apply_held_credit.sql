ALTER TABLE "payment_allocations" ADD COLUMN "from_credit" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Money a customer paid beyond what was open stays on the payment as held credit. This spreads it
-- over their open invoices: oldest payment first, onto the oldest-due invoice first, the order
-- receivePayment uses. Allocations to cancelled invoices don't use up a payment, so cancelling an
-- invoice that held credit paid gives that credit back.
create or replace function public.apply_held_credit(p_customer uuid) returns void
language plpgsql as $$
declare
  pay record;
  inv record;
  free numeric(12, 2);
  take numeric(12, 2);
begin
  for pay in
    select p.id,
           p.amount - coalesce((
             select sum(a.amount) from public.payment_allocations a
             join public.invoices i on i.id = a.invoice_id
             where a.payment_id = p.id and i.status = 'issued'), 0) as free
    from public.payments p
    where p.customer_id = p_customer and p.status = 'active' and not p.is_refund
    order by p.payment_date, p.number
  loop
    free := pay.free;
    continue when free <= 0;
    for inv in
      select i.id,
             i.total - least(i.total,
               coalesce((select sum(a.amount) from public.payment_allocations a
                         join public.payments p2 on p2.id = a.payment_id
                         where a.invoice_id = i.id and p2.status = 'active'), 0)
               + coalesce((select sum(r.total) from public.sales_returns r where r.invoice_id = i.id), 0)
             ) as owed
      from public.invoices i
      where i.customer_id = p_customer and i.status = 'issued'
      order by i.due_date, i.invoice_date, i.number
    loop
      exit when free <= 0;
      continue when inv.owed <= 0;
      take := least(free, inv.owed);
      insert into public.payment_allocations (payment_id, invoice_id, amount, from_credit)
        values (pay.id, inv.id, take, true);
      free := free - take;
    end loop;
  end loop;
end $$;
--> statement-breakpoint

-- Settle what existing held credit already covers.
select public.apply_held_credit(c.id) from public.customers c;
