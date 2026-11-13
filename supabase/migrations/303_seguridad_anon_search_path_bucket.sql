-- 303: seguridad de la base (auditoría del 12 nov) — funciones que `anon` podía ejecutar, search_path, bucket `app` y dos políticas.
--
-- Hallazgos del advisor de seguridad de Supabase y qué se hace con cada uno:
--
-- (a) 120 funciones SECURITY DEFINER ejecutables por `anon` (por /rest/v1/rpc). A 115 se les quita el EXECUTE de
--     `public` (el permiso por defecto de Postgres, que alcanza a anon) y de `anon`; `authenticated` y `service_role` lo
--     conservan con un GRANT explícito (hoy lo tenían las 120: nada cambia para quien inició sesión ni para el servidor).
--       · 38 son funciones de TRIGGER / event trigger: nadie necesita EXECUTE para que un trigger dispare (Postgres
--         solo lo exige al crear el trigger), así que quitarlo no puede romper nada.
--       · 77 son RPCs y helpers de permisos. Evidencia de que un visitante sin sesión no las usa:
--           - `anon` solo tiene USAGE en el esquema `public`: a erp / clockin / recruiting / timetracker no llega ni hoy.
--           - Ninguna aparece en una política RLS que aplique a `anon` o `public`, ni en una vista que anon pueda leer, ni
--             en un CHECK, default, índice o función SECURITY INVOKER / de trigger que anon pueda alcanzar (consultado en
--             pg_policies, pg_views, pg_constraint, pg_attrdef, pg_index y pg_proc el 12 nov).
--           - El código del Hub y de las apps hermanas (rtg-clock-in, timetracker, recruiting-app, rtg-erp, rtg-encuesta,
--             tile-ops-app) no llama a ninguna con el cliente sin sesión.
--     SE QUEDAN ejecutables por anon 5: cada una aparece en políticas RLS con rol `public`, que Postgres evalúa
--     también para anon (quitarlas convertiría «no ve filas» en un error):
-- KEEP: clockin.auth_company_id()
-- KEEP: clockin.auth_is_manager()
-- KEEP: clockin.auth_is_owner()
-- KEEP: public.current_recruiting_role()
-- KEEP: public.current_user_role()
--     Las tres de `clockin` son «por revisar»: anon no tiene USAGE en ese esquema, así que hoy no las alcanza; se dejan
--     por prudencia. Un segundo pase sobre `authenticated` queda fuera de esta migración (ver DECISIONS).
--
-- (b) 8 funciones sin `search_path` fijo: se les fija. No cambia lo que devuelven (solo usan funciones de pg_catalog y,
--     una, el tipo `public.deliveries`).
-- (c) Bucket público `app` (la APK de Entregas): solo acepta APK (`application/vnd.android.package-archive`, lo único que
--     guarda) y baja el tope de 200 MB a 50 MB (la APK pesa 3,6 MB). Las descargas no cambian.
-- (d) Dos políticas que reevaluaban `auth.uid()` por fila: se envuelve en `(select auth.uid())`. Misma regla, más barata.
-- (e) La vista `public.perfiles_publicos` sale en el advisor como SECURITY DEFINER: es A PROPÓSITO (290, M1): corre como
--     dueño para que el nombre se vea aunque `profiles` se cierre, es de solo lectura y no expone columnas sensibles.
--     NO se toca.
--
-- Additive/correctivo: solo permisos, configuración de funciones, una fila de storage.buckets y dos políticas. 237/238/239
-- intactas. Para deshacer, ver el bloque «ROLLBACK» al final (comentado).

-- Nota: se escribe `on routine` (equivale a `on function` para funciones) para que los espejos de las pruebas, que
-- buscan la última migración que DEFINE un guard por el texto «function public.<nombre>», no tomen esta por una de ellas.

-- ===========================================================================
-- (a) Funciones de trigger / event trigger: fuera `public` y `anon`
-- ===========================================================================
revoke execute on routine clockin.block_employee_exception_delete() from public, anon;
grant execute on routine clockin.block_employee_exception_delete() to authenticated, service_role;
revoke execute on routine clockin.enforce_entry_employee_write() from public, anon;
grant execute on routine clockin.enforce_entry_employee_write() to authenticated, service_role;
revoke execute on routine clockin.enforce_exception_employee_write() from public, anon;
grant execute on routine clockin.enforce_exception_employee_write() to authenticated, service_role;
revoke execute on routine clockin.rls_auto_enable() from public, anon;
grant execute on routine clockin.rls_auto_enable() to authenticated, service_role;
revoke execute on routine erp.apply_movement_to_cache() from public, anon;
grant execute on routine erp.apply_movement_to_cache() to authenticated, service_role;
revoke execute on routine erp.audit_row() from public, anon;
grant execute on routine erp.audit_row() to authenticated, service_role;
revoke execute on routine erp.capture_price_history() from public, anon;
grant execute on routine erp.capture_price_history() to authenticated, service_role;
revoke execute on routine erp.capture_store_price_history() from public, anon;
grant execute on routine erp.capture_store_price_history() to authenticated, service_role;
revoke execute on routine erp.customer_associations_antes() from public, anon;
grant execute on routine erp.customer_associations_antes() to authenticated, service_role;
revoke execute on routine erp.customer_associations_historial() from public, anon;
grant execute on routine erp.customer_associations_historial() to authenticated, service_role;
revoke execute on routine erp.customers_asociaciones_al_juntar() from public, anon;
grant execute on routine erp.customers_asociaciones_al_juntar() to authenticated, service_role;
revoke execute on routine erp.customers_historial() from public, anon;
grant execute on routine erp.customers_historial() to authenticated, service_role;
revoke execute on routine public.entregada_fija_fecha() from public, anon;
grant execute on routine public.entregada_fija_fecha() to authenticated, service_role;
revoke execute on routine public.estimator_approvals_guard() from public, anon;
grant execute on routine public.estimator_approvals_guard() to authenticated, service_role;
revoke execute on routine public.estimator_competitor_files_guard() from public, anon;
grant execute on routine public.estimator_competitor_files_guard() to authenticated, service_role;
revoke execute on routine public.estimator_quotes_guard() from public, anon;
grant execute on routine public.estimator_quotes_guard() to authenticated, service_role;
revoke execute on routine public.guard_clockin_access_change() from public, anon;
grant execute on routine public.guard_clockin_access_change() to authenticated, service_role;
revoke execute on routine public.guard_delivery_stage() from public, anon;
grant execute on routine public.guard_delivery_stage() to authenticated, service_role;
revoke execute on routine public.guard_erp_access_change() from public, anon;
grant execute on routine public.guard_erp_access_change() to authenticated, service_role;
revoke execute on routine public.guard_factura_obligatoria() from public, anon;
grant execute on routine public.guard_factura_obligatoria() to authenticated, service_role;
revoke execute on routine public.guard_point_events_append_only() from public, anon;
grant execute on routine public.guard_point_events_append_only() to authenticated, service_role;
revoke execute on routine public.guard_profile_privileged_columns() from public, anon;
grant execute on routine public.guard_profile_privileged_columns() to authenticated, service_role;
revoke execute on routine public.guard_recruiting_access_change() from public, anon;
grant execute on routine public.guard_recruiting_access_change() to authenticated, service_role;
revoke execute on routine public.guard_role_change() from public, anon;
grant execute on routine public.guard_role_change() to authenticated, service_role;
revoke execute on routine public.guard_timetracker_access_change() from public, anon;
grant execute on routine public.guard_timetracker_access_change() to authenticated, service_role;
revoke execute on routine public.handle_new_user() from public, anon;
grant execute on routine public.handle_new_user() to authenticated, service_role;
revoke execute on routine public.protect_last_recruiting_admin() from public, anon;
grant execute on routine public.protect_last_recruiting_admin() to authenticated, service_role;
revoke execute on routine public.protect_last_timetracker_admin() from public, anon;
grant execute on routine public.protect_last_timetracker_admin() to authenticated, service_role;
revoke execute on routine public.tracker_guard_completado() from public, anon;
grant execute on routine public.tracker_guard_completado() to authenticated, service_role;
revoke execute on routine public.warehouse_ops_log_group_sig() from public, anon;
grant execute on routine public.warehouse_ops_log_group_sig() to authenticated, service_role;
revoke execute on routine public.warehouse_ops_log_report() from public, anon;
grant execute on routine public.warehouse_ops_log_report() to authenticated, service_role;
revoke execute on routine public.warehouse_ops_log_report_sig() from public, anon;
grant execute on routine public.warehouse_ops_log_report_sig() to authenticated, service_role;
revoke execute on routine public.warehouse_ops_wipe_sigs_on_edit() from public, anon;
grant execute on routine public.warehouse_ops_wipe_sigs_on_edit() to authenticated, service_role;
revoke execute on routine recruiting.guard_app_name_change() from public, anon;
grant execute on routine recruiting.guard_app_name_change() to authenticated, service_role;
revoke execute on routine recruiting.guard_employee_file_link() from public, anon;
grant execute on routine recruiting.guard_employee_file_link() to authenticated, service_role;
revoke execute on routine recruiting.log_stage_change() from public, anon;
grant execute on routine recruiting.log_stage_change() to authenticated, service_role;
revoke execute on routine recruiting.new_profile_employee_file() from public, anon;
grant execute on routine recruiting.new_profile_employee_file() to authenticated, service_role;
revoke execute on routine timetracker.guard_employee_settings_privilege_columns() from public, anon;
grant execute on routine timetracker.guard_employee_settings_privilege_columns() to authenticated, service_role;

-- ===========================================================================
-- (a) RPCs y helpers de permisos: fuera `public` y `anon`; authenticated y service_role se quedan
-- ===========================================================================
revoke execute on routine erp.add_product_relation(bigint, bigint, text) from public, anon;
grant execute on routine erp.add_product_relation(bigint, bigint, text) to authenticated, service_role;
revoke execute on routine erp.adjust_inventory(bigint, text, numeric, text, text) from public, anon;
grant execute on routine erp.adjust_inventory(bigint, text, numeric, text, text) to authenticated, service_role;
revoke execute on routine erp.analytics_category_stats(text, text) from public, anon;
grant execute on routine erp.analytics_category_stats(text, text) to authenticated, service_role;
revoke execute on routine erp.analytics_store_stats(text, text) from public, anon;
grant execute on routine erp.analytics_store_stats(text, text) to authenticated, service_role;
revoke execute on routine erp.analytics_vendor_stats(text) from public, anon;
grant execute on routine erp.analytics_vendor_stats(text) to authenticated, service_role;
revoke execute on routine erp.apply_category_assignments() from public, anon;
grant execute on routine erp.apply_category_assignments() to authenticated, service_role;
revoke execute on routine erp.apply_decisions(jsonb, boolean) from public, anon;
grant execute on routine erp.apply_decisions(jsonb, boolean) to authenticated, service_role;
revoke execute on routine erp.apply_master_import(jsonb, boolean) from public, anon;
grant execute on routine erp.apply_master_import(jsonb, boolean) to authenticated, service_role;
revoke execute on routine erp.assign_draft_sku(bigint, text) from public, anon;
grant execute on routine erp.assign_draft_sku(bigint, text) to authenticated, service_role;
revoke execute on routine erp.assign_sell_units(boolean) from public, anon;
grant execute on routine erp.assign_sell_units(boolean) to authenticated, service_role;
revoke execute on routine erp.bulk_resolve_tag(bigint[], text) from public, anon;
grant execute on routine erp.bulk_resolve_tag(bigint[], text) to authenticated, service_role;
revoke execute on routine erp.bulk_update_products(bigint[], jsonb) from public, anon;
grant execute on routine erp.bulk_update_products(bigint[], jsonb) to authenticated, service_role;
revoke execute on routine erp.can_see_cost() from public, anon;
grant execute on routine erp.can_see_cost() to authenticated, service_role;
revoke execute on routine erp.catalog_facets() from public, anon;
grant execute on routine erp.catalog_facets() to authenticated, service_role;
revoke execute on routine erp.category_browse() from public, anon;
grant execute on routine erp.category_browse() to authenticated, service_role;
revoke execute on routine erp.confirm_external_match(bigint) from public, anon;
grant execute on routine erp.confirm_external_match(bigint) to authenticated, service_role;
revoke execute on routine erp.current_app_role() from public, anon;
grant execute on routine erp.current_app_role() to authenticated, service_role;
revoke execute on routine erp.customers_can_write() from public, anon;
grant execute on routine erp.customers_can_write() to authenticated, service_role;
revoke execute on routine erp.customers_ve_la_fila(uuid, uuid, text) from public, anon;
grant execute on routine erp.customers_ve_la_fila(uuid, uuid, text) to authenticated, service_role;
revoke execute on routine erp.dashboard_stats() from public, anon;
grant execute on routine erp.dashboard_stats() to authenticated, service_role;
revoke execute on routine erp.decide_request(bigint, boolean, text) from public, anon;
grant execute on routine erp.decide_request(bigint, boolean, text) to authenticated, service_role;
revoke execute on routine erp.link_draft_to_product(bigint, bigint) from public, anon;
grant execute on routine erp.link_draft_to_product(bigint, bigint) to authenticated, service_role;
revoke execute on routine erp.list_cycle_counts(integer, integer) from public, anon;
grant execute on routine erp.list_cycle_counts(integer, integer) to authenticated, service_role;
revoke execute on routine erp.list_purchase_orders(integer, integer) from public, anon;
grant execute on routine erp.list_purchase_orders(integer, integer) to authenticated, service_role;
revoke execute on routine erp.master_import_diff(jsonb, jsonb) from public, anon;
grant execute on routine erp.master_import_diff(jsonb, jsonb) to authenticated, service_role;
revoke execute on routine erp.match_product_by_mpn(text, bigint) from public, anon;
grant execute on routine erp.match_product_by_mpn(text, bigint) to authenticated, service_role;
revoke execute on routine erp.merge_products(bigint, bigint) from public, anon;
grant execute on routine erp.merge_products(bigint, bigint) to authenticated, service_role;
revoke execute on routine erp.negative_balances() from public, anon;
grant execute on routine erp.negative_balances() to authenticated, service_role;
revoke execute on routine erp.po_receiving_detail(bigint) from public, anon;
grant execute on routine erp.po_receiving_detail(bigint) to authenticated, service_role;
revoke execute on routine erp.po_recon_rows(bigint, numeric, numeric, numeric) from public, anon;
grant execute on routine erp.po_recon_rows(bigint, numeric, numeric, numeric) to authenticated, service_role;
revoke execute on routine erp.price_history_cost(bigint) from public, anon;
grant execute on routine erp.price_history_cost(bigint) to authenticated, service_role;
revoke execute on routine erp.product_cost(bigint) from public, anon;
grant execute on routine erp.product_cost(bigint) to authenticated, service_role;
revoke execute on routine erp.product_vocabulary() from public, anon;
grant execute on routine erp.product_vocabulary() to authenticated, service_role;
revoke execute on routine erp.publish_product(bigint) from public, anon;
grant execute on routine erp.publish_product(bigint) to authenticated, service_role;
revoke execute on routine erp.purchasing_groups(integer, integer) from public, anon;
grant execute on routine erp.purchasing_groups(integer, integer) to authenticated, service_role;
revoke execute on routine erp.qoh_drift_alert() from public, anon;
grant execute on routine erp.qoh_drift_alert() to authenticated, service_role;
revoke execute on routine erp.qoh_drift_alert_build() from public, anon;
grant execute on routine erp.qoh_drift_alert_build() to authenticated, service_role;
revoke execute on routine erp.receive_manual(bigint, text, numeric, numeric, numeric, numeric, text, date, text) from public, anon;
grant execute on routine erp.receive_manual(bigint, text, numeric, numeric, numeric, numeric, text, date, text) to authenticated, service_role;
revoke execute on routine erp.receive_po(bigint, text, jsonb, numeric, numeric, text) from public, anon;
grant execute on routine erp.receive_po(bigint, text, jsonb, numeric, numeric, text) to authenticated, service_role;
revoke execute on routine erp.reconcile_cycle_count(bigint) from public, anon;
grant execute on routine erp.reconcile_cycle_count(bigint) to authenticated, service_role;
revoke execute on routine erp.reconcile_po(bigint, numeric, numeric, numeric) from public, anon;
grant execute on routine erp.reconcile_po(bigint, numeric, numeric, numeric) to authenticated, service_role;
revoke execute on routine erp.reconcile_qoh() from public, anon;
grant execute on routine erp.reconcile_qoh() to authenticated, service_role;
revoke execute on routine erp.reconcile_qoh_repair() from public, anon;
grant execute on routine erp.reconcile_qoh_repair() to authenticated, service_role;
revoke execute on routine erp.record_cycle_count(bigint, text, numeric, numeric) from public, anon;
grant execute on routine erp.record_cycle_count(bigint, text, numeric, numeric) to authenticated, service_role;
revoke execute on routine erp.reflag_below_cost(boolean) from public, anon;
grant execute on routine erp.reflag_below_cost(boolean) to authenticated, service_role;
revoke execute on routine erp.reflag_possible_dups(boolean) from public, anon;
grant execute on routine erp.reflag_possible_dups(boolean) to authenticated, service_role;
revoke execute on routine erp.reject_external_match(bigint) from public, anon;
grant execute on routine erp.reject_external_match(bigint) to authenticated, service_role;
revoke execute on routine erp.remove_product_relation(bigint, bigint, text) from public, anon;
grant execute on routine erp.remove_product_relation(bigint, bigint, text) to authenticated, service_role;
revoke execute on routine erp.reorder_report(text, integer, integer) from public, anon;
grant execute on routine erp.reorder_report(text, integer, integer) to authenticated, service_role;
revoke execute on routine erp.resolve_review_tag(bigint, text) from public, anon;
grant execute on routine erp.resolve_review_tag(bigint, text) to authenticated, service_role;
revoke execute on routine erp.review_tag_facets() from public, anon;
grant execute on routine erp.review_tag_facets() to authenticated, service_role;
revoke execute on routine erp.seed_opening_balances(boolean) from public, anon;
grant execute on routine erp.seed_opening_balances(boolean) to authenticated, service_role;
revoke execute on routine erp.set_invoice_line_match(bigint, bigint, text, numeric, text) from public, anon;
grant execute on routine erp.set_invoice_line_match(bigint, bigint, text, numeric, text) to authenticated, service_role;
revoke execute on routine erp.set_po_line_product(bigint, bigint, boolean) from public, anon;
grant execute on routine erp.set_po_line_product(bigint, bigint, boolean) to authenticated, service_role;
revoke execute on routine erp.store_product_cost(text, bigint) from public, anon;
grant execute on routine erp.store_product_cost(text, bigint) to authenticated, service_role;
revoke execute on routine erp.suggest_po_line_matches(bigint) from public, anon;
grant execute on routine erp.suggest_po_line_matches(bigint) to authenticated, service_role;
revoke execute on routine erp.tag_uncategorized() from public, anon;
grant execute on routine erp.tag_uncategorized() to authenticated, service_role;
revoke execute on routine erp.update_product(bigint, jsonb) from public, anon;
grant execute on routine erp.update_product(bigint, jsonb) to authenticated, service_role;
revoke execute on routine erp.upsert_acknowledgment(jsonb, jsonb) from public, anon;
grant execute on routine erp.upsert_acknowledgment(jsonb, jsonb) to authenticated, service_role;
revoke execute on routine erp.upsert_external_ref(jsonb) from public, anon;
grant execute on routine erp.upsert_external_ref(jsonb) to authenticated, service_role;
revoke execute on routine erp.upsert_purchase_order(jsonb, jsonb) from public, anon;
grant execute on routine erp.upsert_purchase_order(jsonb, jsonb) to authenticated, service_role;
revoke execute on routine erp.upsert_sales_invoice(jsonb) from public, anon;
grant execute on routine erp.upsert_sales_invoice(jsonb) to authenticated, service_role;
revoke execute on routine erp.upsert_sales_invoice_lines(bigint, jsonb) from public, anon;
grant execute on routine erp.upsert_sales_invoice_lines(bigint, jsonb) to authenticated, service_role;
revoke execute on routine erp.upsert_salesperson(jsonb) from public, anon;
grant execute on routine erp.upsert_salesperson(jsonb) to authenticated, service_role;
revoke execute on routine public.current_timetracker_role() from public, anon;
grant execute on routine public.current_timetracker_role() to authenticated, service_role;
revoke execute on routine public.has_clockin_access() from public, anon;
grant execute on routine public.has_clockin_access() to authenticated, service_role;
revoke execute on routine public.has_customers_access() from public, anon;
grant execute on routine public.has_customers_access() to authenticated, service_role;
revoke execute on routine public.has_erp_access() from public, anon;
grant execute on routine public.has_erp_access() to authenticated, service_role;
revoke execute on routine public.has_recruiting_access() from public, anon;
grant execute on routine public.has_recruiting_access() to authenticated, service_role;
revoke execute on routine public.has_timetracker_access() from public, anon;
grant execute on routine public.has_timetracker_access() to authenticated, service_role;
revoke execute on routine public.has_warehouse_ops_access() from public, anon;
grant execute on routine public.has_warehouse_ops_access() to authenticated, service_role;
revoke execute on routine public.is_admin() from public, anon;
grant execute on routine public.is_admin() to authenticated, service_role;
revoke execute on routine public.is_timetracker_admin() from public, anon;
grant execute on routine public.is_timetracker_admin() to authenticated, service_role;
revoke execute on routine public.leads_private_pools() from public, anon;
grant execute on routine public.leads_private_pools() to authenticated, service_role;
revoke execute on routine public.leads_sees_private() from public, anon;
grant execute on routine public.leads_sees_private() to authenticated, service_role;
revoke execute on routine public.store_auto_approves(text) from public, anon;
grant execute on routine public.store_auto_approves(text) to authenticated, service_role;
revoke execute on routine timetracker.purge_old_screenshots(interval) from public, anon;
grant execute on routine timetracker.purge_old_screenshots(interval) to authenticated, service_role;

-- ===========================================================================
-- (b) search_path fijo
-- ===========================================================================
alter function public.leads_private_order(text) set search_path = public, pg_temp;
alter function public.numeros_de_factura(text) set search_path = public, pg_temp;
alter function public.pallets_de_la_carga(public.deliveries) set search_path = public, pg_temp;
alter function public.relevo_norm(text) set search_path = public, pg_temp;
alter function public.survey_rating_notes_valid(jsonb, text[]) set search_path = public, pg_temp;
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function erp.customers_codigo_de_tienda(text) set search_path = erp, public, pg_temp;
alter function timetracker.touch_updated_at() set search_path = timetracker, public, pg_temp;

-- ===========================================================================
-- (c) Bucket `app`: solo la APK, tope de 50 MB
-- ===========================================================================
update storage.buckets set
  allowed_mime_types = array['application/vnd.android.package-archive'],
  file_size_limit = 52428800
 where id = 'app';

-- ===========================================================================
-- (d) Políticas: `auth.uid()` una vez por consulta, no por fila
-- ===========================================================================
alter policy "delivery files insert" on public.delivery_files
  with check (
    (exists (select 1 from public.deliveries d where d.id = delivery_files.delivery_id))
    and created_by = (select auth.uid())
  );
alter policy ucr_insert on recruiting.user_creation_requests
  with check (
    ((select public.current_recruiting_role()) = any (array['admin'::text, 'manager'::text]))
    and requested_by = (select auth.uid())
  );

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare
  f text;
  n int;
  quitadas constant text[] := array[
    'clockin.block_employee_exception_delete()',
    'clockin.enforce_entry_employee_write()',
    'clockin.enforce_exception_employee_write()',
    'clockin.rls_auto_enable()',
    'erp.add_product_relation(bigint, bigint, text)',
    'erp.adjust_inventory(bigint, text, numeric, text, text)',
    'erp.analytics_category_stats(text, text)',
    'erp.analytics_store_stats(text, text)',
    'erp.analytics_vendor_stats(text)',
    'erp.apply_category_assignments()',
    'erp.apply_decisions(jsonb, boolean)',
    'erp.apply_master_import(jsonb, boolean)',
    'erp.apply_movement_to_cache()',
    'erp.assign_draft_sku(bigint, text)',
    'erp.assign_sell_units(boolean)',
    'erp.audit_row()',
    'erp.bulk_resolve_tag(bigint[], text)',
    'erp.bulk_update_products(bigint[], jsonb)',
    'erp.can_see_cost()',
    'erp.capture_price_history()',
    'erp.capture_store_price_history()',
    'erp.catalog_facets()',
    'erp.category_browse()',
    'erp.confirm_external_match(bigint)',
    'erp.current_app_role()',
    'erp.customer_associations_antes()',
    'erp.customer_associations_historial()',
    'erp.customers_asociaciones_al_juntar()',
    'erp.customers_can_write()',
    'erp.customers_historial()',
    'erp.customers_ve_la_fila(uuid, uuid, text)',
    'erp.dashboard_stats()',
    'erp.decide_request(bigint, boolean, text)',
    'erp.link_draft_to_product(bigint, bigint)',
    'erp.list_cycle_counts(integer, integer)',
    'erp.list_purchase_orders(integer, integer)',
    'erp.master_import_diff(jsonb, jsonb)',
    'erp.match_product_by_mpn(text, bigint)',
    'erp.merge_products(bigint, bigint)',
    'erp.negative_balances()',
    'erp.po_receiving_detail(bigint)',
    'erp.po_recon_rows(bigint, numeric, numeric, numeric)',
    'erp.price_history_cost(bigint)',
    'erp.product_cost(bigint)',
    'erp.product_vocabulary()',
    'erp.publish_product(bigint)',
    'erp.purchasing_groups(integer, integer)',
    'erp.qoh_drift_alert()',
    'erp.qoh_drift_alert_build()',
    'erp.receive_manual(bigint, text, numeric, numeric, numeric, numeric, text, date, text)',
    'erp.receive_po(bigint, text, jsonb, numeric, numeric, text)',
    'erp.reconcile_cycle_count(bigint)',
    'erp.reconcile_po(bigint, numeric, numeric, numeric)',
    'erp.reconcile_qoh()',
    'erp.reconcile_qoh_repair()',
    'erp.record_cycle_count(bigint, text, numeric, numeric)',
    'erp.reflag_below_cost(boolean)',
    'erp.reflag_possible_dups(boolean)',
    'erp.reject_external_match(bigint)',
    'erp.remove_product_relation(bigint, bigint, text)',
    'erp.reorder_report(text, integer, integer)',
    'erp.resolve_review_tag(bigint, text)',
    'erp.review_tag_facets()',
    'erp.seed_opening_balances(boolean)',
    'erp.set_invoice_line_match(bigint, bigint, text, numeric, text)',
    'erp.set_po_line_product(bigint, bigint, boolean)',
    'erp.store_product_cost(text, bigint)',
    'erp.suggest_po_line_matches(bigint)',
    'erp.tag_uncategorized()',
    'erp.update_product(bigint, jsonb)',
    'erp.upsert_acknowledgment(jsonb, jsonb)',
    'erp.upsert_external_ref(jsonb)',
    'erp.upsert_purchase_order(jsonb, jsonb)',
    'erp.upsert_sales_invoice(jsonb)',
    'erp.upsert_sales_invoice_lines(bigint, jsonb)',
    'erp.upsert_salesperson(jsonb)',
    'public.current_timetracker_role()',
    'public.entregada_fija_fecha()',
    'public.estimator_approvals_guard()',
    'public.estimator_competitor_files_guard()',
    'public.estimator_quotes_guard()',
    'public.guard_clockin_access_change()',
    'public.guard_delivery_stage()',
    'public.guard_erp_access_change()',
    'public.guard_factura_obligatoria()',
    'public.guard_point_events_append_only()',
    'public.guard_profile_privileged_columns()',
    'public.guard_recruiting_access_change()',
    'public.guard_role_change()',
    'public.guard_timetracker_access_change()',
    'public.handle_new_user()',
    'public.has_clockin_access()',
    'public.has_customers_access()',
    'public.has_erp_access()',
    'public.has_recruiting_access()',
    'public.has_timetracker_access()',
    'public.has_warehouse_ops_access()',
    'public.is_admin()',
    'public.is_timetracker_admin()',
    'public.leads_private_pools()',
    'public.leads_sees_private()',
    'public.protect_last_recruiting_admin()',
    'public.protect_last_timetracker_admin()',
    'public.store_auto_approves(text)',
    'public.tracker_guard_completado()',
    'public.warehouse_ops_log_group_sig()',
    'public.warehouse_ops_log_report()',
    'public.warehouse_ops_log_report_sig()',
    'public.warehouse_ops_wipe_sigs_on_edit()',
    'recruiting.guard_app_name_change()',
    'recruiting.guard_employee_file_link()',
    'recruiting.log_stage_change()',
    'recruiting.new_profile_employee_file()',
    'timetracker.guard_employee_settings_privilege_columns()',
    'timetracker.purge_old_screenshots(interval)'
  ];
  se_quedan constant text[] := array[
    'clockin.auth_company_id()',
    'clockin.auth_is_manager()',
    'clockin.auth_is_owner()',
    'public.current_recruiting_role()',
    'public.current_user_role()'
  ];
begin
  if cardinality(quitadas) <> 115 or cardinality(se_quedan) <> 5 then
    raise exception '303: las listas no cuadran';
  end if;
  foreach f in array quitadas loop
    if has_function_privilege('anon', f::regprocedure, 'execute') then
      raise exception '303: anon todavia puede ejecutar %', f;
    end if;
    if not has_function_privilege('authenticated', f::regprocedure, 'execute') then
      raise exception '303: authenticated perdio %', f;
    end if;
    if not has_function_privilege('service_role', f::regprocedure, 'execute') then
      raise exception '303: service_role perdio %', f;
    end if;
  end loop;
  foreach f in array se_quedan loop
    if not has_function_privilege('anon', f::regprocedure, 'execute') then
      raise exception '303: % debe seguir ejecutable por anon (politicas RLS con rol public)', f;
    end if;
  end loop;

  foreach f in array array[
    'public.leads_private_order(text)', 'public.numeros_de_factura(text)', 'public.pallets_de_la_carga(public.deliveries)',
    'public.relevo_norm(text)', 'public.survey_rating_notes_valid(jsonb, text[])', 'public.touch_updated_at()',
    'erp.customers_codigo_de_tienda(text)', 'timetracker.touch_updated_at()'
  ] loop
    if not exists (select 1 from pg_proc p, unnest(coalesce(p.proconfig, '{}')) x
                    where p.oid = f::regprocedure and x like 'search_path=%') then
      raise exception '303: % sigue sin search_path fijo', f;
    end if;
  end loop;

  if not exists (select 1 from storage.buckets where id = 'app' and file_size_limit = 52428800
                   and allowed_mime_types = array['application/vnd.android.package-archive']) then
    raise exception '303: el bucket app no quedo con su tope y su tipo';
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'app'
               and coalesce(o.metadata->>'mimetype', '') <> 'application/vnd.android.package-archive') then
    raise exception '303: hay un archivo en el bucket app que no es APK; revisar antes de limitar el tipo';
  end if;

  select count(*) into n from pg_policies
   where ((schemaname = 'public' and tablename = 'delivery_files' and policyname = 'delivery files insert')
       or (schemaname = 'recruiting' and tablename = 'user_creation_requests' and policyname = 'ucr_insert'))
     and with_check ~* 'select\s+auth\.uid\(\)';
  if n <> 2 then
    raise exception '303: las dos politicas deben usar (select auth.uid()) (encontre %)', n;
  end if;

  if not exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'perfiles_publicos') then
    raise exception '303: la vista perfiles_publicos (290) debe seguir existiendo';
  end if;
end $chk$;

-- ===========================================================================
-- ROLLBACK (comentado). Para deshacer, correr esto a mano:
-- ===========================================================================
-- Las del esquema `public` tenian ademas un GRANT explicito a anon; las demas solo el de PUBLIC.
-- grant execute on routine clockin.block_employee_exception_delete() to public;
-- grant execute on routine clockin.enforce_entry_employee_write() to public;
-- grant execute on routine clockin.enforce_exception_employee_write() to public;
-- grant execute on routine clockin.rls_auto_enable() to public;
-- grant execute on routine erp.add_product_relation(bigint, bigint, text) to public;
-- grant execute on routine erp.adjust_inventory(bigint, text, numeric, text, text) to public;
-- grant execute on routine erp.analytics_category_stats(text, text) to public;
-- grant execute on routine erp.analytics_store_stats(text, text) to public;
-- grant execute on routine erp.analytics_vendor_stats(text) to public;
-- grant execute on routine erp.apply_category_assignments() to public;
-- grant execute on routine erp.apply_decisions(jsonb, boolean) to public;
-- grant execute on routine erp.apply_master_import(jsonb, boolean) to public;
-- grant execute on routine erp.apply_movement_to_cache() to public;
-- grant execute on routine erp.assign_draft_sku(bigint, text) to public;
-- grant execute on routine erp.assign_sell_units(boolean) to public;
-- grant execute on routine erp.audit_row() to public;
-- grant execute on routine erp.bulk_resolve_tag(bigint[], text) to public;
-- grant execute on routine erp.bulk_update_products(bigint[], jsonb) to public;
-- grant execute on routine erp.can_see_cost() to public;
-- grant execute on routine erp.capture_price_history() to public;
-- grant execute on routine erp.capture_store_price_history() to public;
-- grant execute on routine erp.catalog_facets() to public;
-- grant execute on routine erp.category_browse() to public;
-- grant execute on routine erp.confirm_external_match(bigint) to public;
-- grant execute on routine erp.current_app_role() to public;
-- grant execute on routine erp.customer_associations_antes() to public;
-- grant execute on routine erp.customer_associations_historial() to public;
-- grant execute on routine erp.customers_asociaciones_al_juntar() to public;
-- grant execute on routine erp.customers_can_write() to public;
-- grant execute on routine erp.customers_historial() to public;
-- grant execute on routine erp.customers_ve_la_fila(uuid, uuid, text) to public;
-- grant execute on routine erp.dashboard_stats() to public;
-- grant execute on routine erp.decide_request(bigint, boolean, text) to public;
-- grant execute on routine erp.link_draft_to_product(bigint, bigint) to public;
-- grant execute on routine erp.list_cycle_counts(integer, integer) to public;
-- grant execute on routine erp.list_purchase_orders(integer, integer) to public;
-- grant execute on routine erp.master_import_diff(jsonb, jsonb) to public;
-- grant execute on routine erp.match_product_by_mpn(text, bigint) to public;
-- grant execute on routine erp.merge_products(bigint, bigint) to public;
-- grant execute on routine erp.negative_balances() to public;
-- grant execute on routine erp.po_receiving_detail(bigint) to public;
-- grant execute on routine erp.po_recon_rows(bigint, numeric, numeric, numeric) to public;
-- grant execute on routine erp.price_history_cost(bigint) to public;
-- grant execute on routine erp.product_cost(bigint) to public;
-- grant execute on routine erp.product_vocabulary() to public;
-- grant execute on routine erp.publish_product(bigint) to public;
-- grant execute on routine erp.purchasing_groups(integer, integer) to public;
-- grant execute on routine erp.qoh_drift_alert() to public;
-- grant execute on routine erp.qoh_drift_alert_build() to public;
-- grant execute on routine erp.receive_manual(bigint, text, numeric, numeric, numeric, numeric, text, date, text) to public;
-- grant execute on routine erp.receive_po(bigint, text, jsonb, numeric, numeric, text) to public;
-- grant execute on routine erp.reconcile_cycle_count(bigint) to public;
-- grant execute on routine erp.reconcile_po(bigint, numeric, numeric, numeric) to public;
-- grant execute on routine erp.reconcile_qoh() to public;
-- grant execute on routine erp.reconcile_qoh_repair() to public;
-- grant execute on routine erp.record_cycle_count(bigint, text, numeric, numeric) to public;
-- grant execute on routine erp.reflag_below_cost(boolean) to public;
-- grant execute on routine erp.reflag_possible_dups(boolean) to public;
-- grant execute on routine erp.reject_external_match(bigint) to public;
-- grant execute on routine erp.remove_product_relation(bigint, bigint, text) to public;
-- grant execute on routine erp.reorder_report(text, integer, integer) to public;
-- grant execute on routine erp.resolve_review_tag(bigint, text) to public;
-- grant execute on routine erp.review_tag_facets() to public;
-- grant execute on routine erp.seed_opening_balances(boolean) to public;
-- grant execute on routine erp.set_invoice_line_match(bigint, bigint, text, numeric, text) to public;
-- grant execute on routine erp.set_po_line_product(bigint, bigint, boolean) to public;
-- grant execute on routine erp.store_product_cost(text, bigint) to public;
-- grant execute on routine erp.suggest_po_line_matches(bigint) to public;
-- grant execute on routine erp.tag_uncategorized() to public;
-- grant execute on routine erp.update_product(bigint, jsonb) to public;
-- grant execute on routine erp.upsert_acknowledgment(jsonb, jsonb) to public;
-- grant execute on routine erp.upsert_external_ref(jsonb) to public;
-- grant execute on routine erp.upsert_purchase_order(jsonb, jsonb) to public;
-- grant execute on routine erp.upsert_sales_invoice(jsonb) to public;
-- grant execute on routine erp.upsert_sales_invoice_lines(bigint, jsonb) to public;
-- grant execute on routine erp.upsert_salesperson(jsonb) to public;
-- grant execute on routine public.current_timetracker_role() to public, anon;
-- grant execute on routine public.entregada_fija_fecha() to public, anon;
-- grant execute on routine public.estimator_approvals_guard() to public, anon;
-- grant execute on routine public.estimator_competitor_files_guard() to public, anon;
-- grant execute on routine public.estimator_quotes_guard() to public, anon;
-- grant execute on routine public.guard_clockin_access_change() to public, anon;
-- grant execute on routine public.guard_delivery_stage() to public, anon;
-- grant execute on routine public.guard_erp_access_change() to public, anon;
-- grant execute on routine public.guard_factura_obligatoria() to public, anon;
-- grant execute on routine public.guard_point_events_append_only() to public, anon;
-- grant execute on routine public.guard_profile_privileged_columns() to public, anon;
-- grant execute on routine public.guard_recruiting_access_change() to public, anon;
-- grant execute on routine public.guard_role_change() to public, anon;
-- grant execute on routine public.guard_timetracker_access_change() to public, anon;
-- grant execute on routine public.handle_new_user() to public, anon;
-- grant execute on routine public.has_clockin_access() to public, anon;
-- grant execute on routine public.has_customers_access() to public, anon;
-- grant execute on routine public.has_erp_access() to public, anon;
-- grant execute on routine public.has_recruiting_access() to public, anon;
-- grant execute on routine public.has_timetracker_access() to public, anon;
-- grant execute on routine public.has_warehouse_ops_access() to public, anon;
-- grant execute on routine public.is_admin() to public, anon;
-- grant execute on routine public.is_timetracker_admin() to public, anon;
-- grant execute on routine public.leads_private_pools() to public, anon;
-- grant execute on routine public.leads_sees_private() to public, anon;
-- grant execute on routine public.protect_last_recruiting_admin() to public, anon;
-- grant execute on routine public.protect_last_timetracker_admin() to public, anon;
-- grant execute on routine public.store_auto_approves(text) to public, anon;
-- grant execute on routine public.tracker_guard_completado() to public, anon;
-- grant execute on routine public.warehouse_ops_log_group_sig() to public, anon;
-- grant execute on routine public.warehouse_ops_log_report() to public, anon;
-- grant execute on routine public.warehouse_ops_log_report_sig() to public, anon;
-- grant execute on routine public.warehouse_ops_wipe_sigs_on_edit() to public, anon;
-- grant execute on routine recruiting.guard_app_name_change() to public;
-- grant execute on routine recruiting.guard_employee_file_link() to public;
-- grant execute on routine recruiting.log_stage_change() to public;
-- grant execute on routine recruiting.new_profile_employee_file() to public;
-- grant execute on routine timetracker.guard_employee_settings_privilege_columns() to public;
-- grant execute on routine timetracker.purge_old_screenshots(interval) to public;
-- alter function public.leads_private_order(text) reset search_path;
-- alter function public.numeros_de_factura(text) reset search_path;
-- alter function public.pallets_de_la_carga(public.deliveries) reset search_path;
-- alter function public.relevo_norm(text) reset search_path;
-- alter function public.survey_rating_notes_valid(jsonb, text[]) reset search_path;
-- alter function public.touch_updated_at() reset search_path;
-- alter function erp.customers_codigo_de_tienda(text) reset search_path;
-- alter function timetracker.touch_updated_at() reset search_path;
-- update storage.buckets set allowed_mime_types = null, file_size_limit = 209715200 where id = 'app';
-- alter policy "delivery files insert" on public.delivery_files
--   with check ((exists (select 1 from public.deliveries d where d.id = delivery_files.delivery_id)) and created_by = auth.uid());
-- alter policy ucr_insert on recruiting.user_creation_requests
--   with check (((select public.current_recruiting_role()) = any (array['admin'::text, 'manager'::text])) and requested_by = auth.uid());
-- delete from public.schema_migrations where name = '303_seguridad_anon_search_path_bucket.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('303_seguridad_anon_search_path_bucket.sql', '5942bac15257e1b8742ee0579b95105d7cb0ba9f18dc8931ecc9b5a4b3539f41') on conflict (name) do nothing;
