-- 069: the SELECT policies the ERP never needed, and now does.
--
-- 068 turned on security_invoker so the module gate would actually apply through
-- erp.app_products. That worked — and then admins saw nothing either, because
-- there is NO SELECT policy on erp.products. There never was one in rtg-erp
-- either.
--
-- That is not an oversight upstream; it is the design. The app reads app_* and
-- never the base tables, the views ran as their owner, and so the views WERE the
-- read path. Cost masking inside them was the only gate that had to exist,
-- because every authenticated account in that database was an ERP account and
-- there was nothing else to keep out.
--
-- Here there is: drivers, sales reps, recruiters. So the read path needs a rule
-- of its own, and this is it. The two halves now say different things and both
-- are needed:
--
--   * the restrictive gate (066) — may you open the ERP at all;
--   * these policies       — which rows, once you are in;
--   * can_see_cost()       — which columns, once you can see the row.
--
-- The products rule mirrors what the view's own WHERE already said, so nothing
-- about visibility changes for someone who legitimately has ERP access: a
-- published product is visible, an unpublished one only to admin/manager.
--
-- The rest are unconditional here. They are reference and history tables with no
-- per-row audience, and the restrictive gate above already decides who reaches
-- them at all.

create policy "products read" on erp.products for select to authenticated
  using (
    record_status = 'published'::erp.record_status
    or erp.current_app_role() in ('admin','manager')
  );

create policy "categories read"          on erp.categories          for select to authenticated using (true);
create policy "vendors read"             on erp.vendors             for select to authenticated using (true);
create policy "store_products read"      on erp.store_products      for select to authenticated using (true);
create policy "lots read"                on erp.lots                for select to authenticated using (true);
create policy "price_history read"       on erp.price_history       for select to authenticated using (true);
create policy "inventory_movements read" on erp.inventory_movements for select to authenticated using (true);
