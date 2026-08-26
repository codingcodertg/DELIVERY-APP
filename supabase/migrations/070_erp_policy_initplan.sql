-- 070: evaluate the module gate ONCE per query, not once per row.
--
-- The catalog timed out at 8s on 6,859 products with "canceling statement due to
-- statement timeout", while the same data served rtg-erp fine.
--
-- Cause: my policies from 066 and 069 call their helper bare —
-- `using (public.has_erp_access())`. Postgres treats that as a per-row
-- expression, so a SECURITY DEFINER function that queries public.profiles ran
-- once for every row scanned. Wrapping it in a scalar subquery,
-- `using ((select public.has_erp_access()))`, lets the planner hoist it into an
-- InitPlan evaluated a single time.
--
-- This is not a new discovery — every policy the ERP itself shipped is already
-- written `( SELECT erp.current_app_role() ...)`, and rtg-erp carries a test
-- group named `38_masking_initplan.sql` guarding exactly this. Mine were the
-- only ones that were not, because I wrote them by hand rather than copying the
-- shape that was already there.
--
-- Behaviour is identical. The functions are STABLE, so one evaluation per query
-- is the same answer as one per row.


drop policy if exists "erp module gate" on erp.ack_lines;
create policy "erp module gate" on erp.ack_lines as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.audit_log;
create policy "erp module gate" on erp.audit_log as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.categories;
create policy "erp module gate" on erp.categories as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.channel_state;
create policy "erp module gate" on erp.channel_state as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.cycle_counts;
create policy "erp module gate" on erp.cycle_counts as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.exemption_certificates;
create policy "erp module gate" on erp.exemption_certificates as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.inventory_movements;
create policy "erp module gate" on erp.inventory_movements as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.inventory_snapshots;
create policy "erp module gate" on erp.inventory_snapshots as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.locations;
create policy "erp module gate" on erp.locations as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.lots;
create policy "erp module gate" on erp.lots as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.order_acknowledgments;
create policy "erp module gate" on erp.order_acknowledgments as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.po_lines;
create policy "erp module gate" on erp.po_lines as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.po_receipts;
create policy "erp module gate" on erp.po_receipts as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.price_history;
create policy "erp module gate" on erp.price_history as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.product_external_refs;
create policy "erp module gate" on erp.product_external_refs as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.product_images;
create policy "erp module gate" on erp.product_images as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.product_relations;
create policy "erp module gate" on erp.product_relations as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.product_requests;
create policy "erp module gate" on erp.product_requests as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.products;
create policy "erp module gate" on erp.products as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.purchase_orders;
create policy "erp module gate" on erp.purchase_orders as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.qoh_alert_log;
create policy "erp module gate" on erp.qoh_alert_log as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.qoh_reconcile_log;
create policy "erp module gate" on erp.qoh_reconcile_log as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.reservations;
create policy "erp module gate" on erp.reservations as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.sales_history;
create policy "erp module gate" on erp.sales_history as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.sales_invoice_lines;
create policy "erp module gate" on erp.sales_invoice_lines as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.sales_invoices;
create policy "erp module gate" on erp.sales_invoices as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.salespeople;
create policy "erp module gate" on erp.salespeople as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.saved_views;
create policy "erp module gate" on erp.saved_views as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.sku_aliases;
create policy "erp module gate" on erp.sku_aliases as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.staging_cat_assign;
create policy "erp module gate" on erp.staging_cat_assign as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.store_products;
create policy "erp module gate" on erp.store_products as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.stores;
create policy "erp module gate" on erp.stores as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.tax_rates;
create policy "erp module gate" on erp.tax_rates as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.user_store_assignments;
create policy "erp module gate" on erp.user_store_assignments as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.vendor_catalogs;
create policy "erp module gate" on erp.vendor_catalogs as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.vendor_skus;
create policy "erp module gate" on erp.vendor_skus as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));
drop policy if exists "erp module gate" on erp.vendors;
create policy "erp module gate" on erp.vendors as restrictive for all to authenticated
  using ((select public.has_erp_access()))
  with check ((select public.has_erp_access()));

-- Same fix for the products read rule added in 069.
drop policy if exists "products read" on erp.products;
create policy "products read" on erp.products for select to authenticated
  using (
    record_status = 'published'::erp.record_status
    or (select erp.current_app_role()) in ('admin','manager')
  );
