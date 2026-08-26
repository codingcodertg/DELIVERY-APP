-- 065: RLS for the ERP schema.
--
-- All 37 tables get RLS. Only 22 policies come with them, and that is faithful,
-- not an omission: 15 of these tables are never queried directly by the app, only
-- through the SECURITY DEFINER functions in 064. RLS on with no policy means
-- deny-all for a client session, which is exactly right for them.
--
-- ---------------------------------------------------------------------------
-- THE MODULE GATE, AND WHY IT IS HERE
-- ---------------------------------------------------------------------------
--
-- The ERP's own policies are written `to authenticated`. That was correct in
-- rtg-erp, where every account WAS an ERP account. It is wrong here: this app's
-- authenticated users are drivers, warehouse staff, sales reps and recruiters,
-- and most of them have no business reading the purchasing catalog.
--
-- This is not a hypothetical. Merging in the other direction produced exactly
-- this bug and it took an accident to find: a ported read policy ended `ELSE
-- true`, correct in its original home because every account there was a
-- deliveries account, and the merge introduced a role for which it was not.
-- A catalog-only account could read every delivery in the company.
--
-- So the gate is applied here, once, as a RESTRICTIVE policy per table.
-- Restrictive policies AND with everything else, where permissive ones OR — so
-- this cannot be widened by adding another permissive policy later, and a future
-- policy written without thinking about module access is still gated.
--
-- has_erp_access() (062) is the check: the 'erp' flag in module_access, or being
-- an admin.

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table erp.ack_lines enable row level security;
alter table erp.audit_log enable row level security;
alter table erp.categories enable row level security;
alter table erp.channel_state enable row level security;
alter table erp.cycle_counts enable row level security;
alter table erp.exemption_certificates enable row level security;
alter table erp.inventory_movements enable row level security;
alter table erp.inventory_snapshots enable row level security;
alter table erp.locations enable row level security;
alter table erp.lots enable row level security;
alter table erp.order_acknowledgments enable row level security;
alter table erp.po_lines enable row level security;
alter table erp.po_receipts enable row level security;
alter table erp.price_history enable row level security;
alter table erp.product_external_refs enable row level security;
alter table erp.product_images enable row level security;
alter table erp.product_relations enable row level security;
alter table erp.product_requests enable row level security;
alter table erp.products enable row level security;
alter table erp.purchase_orders enable row level security;
alter table erp.qoh_alert_log enable row level security;
alter table erp.qoh_reconcile_log enable row level security;
alter table erp.reservations enable row level security;
alter table erp.sales_history enable row level security;
alter table erp.sales_invoice_lines enable row level security;
alter table erp.sales_invoices enable row level security;
alter table erp.salespeople enable row level security;
alter table erp.saved_views enable row level security;
alter table erp.sku_aliases enable row level security;
alter table erp.staging_cat_assign enable row level security;
alter table erp.store_products enable row level security;
alter table erp.stores enable row level security;
alter table erp.tax_rates enable row level security;
alter table erp.user_store_assignments enable row level security;
alter table erp.vendor_catalogs enable row level security;
alter table erp.vendor_skus enable row level security;
alter table erp.vendors enable row level security;

-- ---------------------------------------------------------------------------
-- The module gate (restrictive: ANDs with every policy below, present or future)
-- ---------------------------------------------------------------------------
create policy "erp module gate" on erp.ack_lines as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.audit_log as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.categories as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.channel_state as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.cycle_counts as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.exemption_certificates as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.inventory_movements as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.inventory_snapshots as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.locations as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.lots as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.order_acknowledgments as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.po_lines as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.po_receipts as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.price_history as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.product_external_refs as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.product_images as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.product_relations as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.product_requests as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.products as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.purchase_orders as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.qoh_alert_log as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.qoh_reconcile_log as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.reservations as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.sales_history as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.sales_invoice_lines as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.sales_invoices as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.salespeople as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.saved_views as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.sku_aliases as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.staging_cat_assign as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.store_products as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.stores as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.tax_rates as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.user_store_assignments as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.vendor_catalogs as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.vendor_skus as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());
create policy "erp module gate" on erp.vendors as restrictive for all to authenticated
  using (public.has_erp_access()) with check (public.has_erp_access());

-- ---------------------------------------------------------------------------
-- The ERP's own policies, as they stand in rtg-erp
-- ---------------------------------------------------------------------------
create policy "audit_log read (mgr/admin)" on erp.audit_log as permissive for select to authenticated
  using ((( SELECT erp.current_app_role() AS current_app_role) = ANY (ARRAY['admin', 'manager'])));
create policy "read categories" on erp.categories as permissive for select to authenticated
  using (true);
create policy "read channel_state" on erp.channel_state as permissive for select to authenticated
  using (true);
create policy "perf select authenticated" on erp.product_external_refs as permissive for select to authenticated
  using (true);
create policy "read product_images" on erp.product_images as permissive for select to authenticated
  using (true);
create policy "read product_relations" on erp.product_relations as permissive for select to authenticated
  using (true);
create policy "product_requests insert (own)" on erp.product_requests as permissive for insert to authenticated
  with check ((requester = ( SELECT auth.uid() AS uid)));
create policy "product_requests read" on erp.product_requests as permissive for select to authenticated
  using (((requester = ( SELECT auth.uid() AS uid)) OR (( SELECT erp.current_app_role() AS current_app_role) = ANY (ARRAY['admin', 'manager']))));
create policy "products draft insert" on erp.products as permissive for insert to authenticated
  with check (((record_status = 'draft'::erp.record_status) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((cost IS NULL) OR ( SELECT erp.can_see_cost() AS can_see_cost))));
create policy "products update (mgr/admin)" on erp.products as permissive for update to authenticated
  using ((( SELECT erp.current_app_role() AS current_app_role) = ANY (ARRAY['admin', 'manager'])))
  with check ((( SELECT erp.current_app_role() AS current_app_role) = ANY (ARRAY['admin', 'manager'])));
create policy "sales_invoice_lines select authenticated" on erp.sales_invoice_lines as permissive for select to authenticated
  using (true);
create policy "sales_invoices select authenticated" on erp.sales_invoices as permissive for select to authenticated
  using (true);
create policy "salespeople select authenticated" on erp.salespeople as permissive for select to authenticated
  using (true);
create policy "saved_views own delete" on erp.saved_views as permissive for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "saved_views own insert" on erp.saved_views as permissive for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "saved_views own select" on erp.saved_views as permissive for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "saved_views own update" on erp.saved_views as permissive for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "read sku_aliases" on erp.sku_aliases as permissive for select to authenticated
  using (true);
create policy "sku_aliases insert (mgr/admin)" on erp.sku_aliases as permissive for insert to authenticated
  with check ((( SELECT erp.current_app_role() AS current_app_role) = ANY (ARRAY['admin', 'manager'])));
create policy "read stores" on erp.stores as permissive for select to authenticated
  using (true);
create policy "read own assignments" on erp.user_store_assignments as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT erp.current_app_role() AS current_app_role) = 'admin')));
create policy "read vendors" on erp.vendors as permissive for select to authenticated
  using (true);
