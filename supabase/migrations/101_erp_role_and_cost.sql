-- 101 · Escalafon propio del ERP (erp_role) + costo cerrado de raiz (A-2d). D-181.
-- Aprobado por el dueno 2026-09-03. Plan: docs/PLAN-A-2d-erp-role-cost.md.
--
-- Medido antes de tocar (matriz rol x accion con ROLLBACK, real + sintetico):
--   A-2d  : un vendedor con ERP lee las 6,104 filas de erp.products.cost DIRECTO de la tabla
--           base; la vista app_products solo lo enmascara cosmeticamente. Escalafon: un
--           manager de Deliveries con ERP ve costo por la vista, porque can_see_cost() lee
--           public.profiles.role. Ninguno tenia que ver costo.
--   A-2c-erp: las tablas de historial (audit_log, price_history, qoh_alert_log,
--           qoh_reconcile_log, sales_history) YA son append-only: su unica politica es el
--           gate RESTRICTIVE "erp module gate" y NO hay politica permisiva de escritura, asi
--           que ningun cliente inserta/actualiza/borra (medido: hasta el admin da BLOQ). Las
--           escriben funciones SECURITY DEFINER (audit_row, capture_price_history, etc.). Por
--           eso esta migracion NO las toca: no habia hueco.
--
-- El escalafon se cierra con UN cambio de funcion: todas las politicas permisivas que dan
-- autoridad (products update mgr/admin, sku_aliases insert, audit_log read) y el enmascarado
-- de costo (can_see_cost) delegan en erp.current_app_role(). Al leer erp_role en vez de
-- public.profiles.role, se re-keyean todas a la vez. El gate has_erp_access() (acceso al
-- modulo) no cambia. No hay reescritura tabla-por-tabla porque las tablas operativas (POs,
-- inventario) no tienen escritura de cliente hoy (gate restrictivo, sin permisiva -> ya
-- denegado; se escriben server-side con service-role).

-- ===========================================================================
-- 1. Columna erp_role + CHECK de los 3 valores
-- ===========================================================================
alter table public.profiles add column if not exists erp_role text;
alter table public.profiles drop constraint if exists profiles_erp_role_known;
alter table public.profiles add constraint profiles_erp_role_known
  check (erp_role is null or erp_role in ('staff','manager','admin')) not valid;

-- ===========================================================================
-- 2. Poblado (regla del dueno; lista nominal en D-181)
--    Los 2 admins de Deliveries -> admin (conservan costo). Cualquier otro con ERP -> staff.
--    Nadie GANA costo por accidente: solo los 2 admins lo conservan explicitamente.
-- ===========================================================================
update public.profiles set erp_role = 'admin' where role = 'admin';
update public.profiles set erp_role = 'staff'
  where erp_role is null and 'erp' = any(coalesce(module_access, '{}'));

-- ===========================================================================
-- 3. Guard: solo un admin de Deliveries cambia erp_role (fold en el de D-179)
-- ===========================================================================
create or replace function public.guard_profile_privileged_columns()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Solo un admin cambia permissions/store/username/erp_role. Un no-admin editando SU fila
  -- toca full_name/avatar_url/active_session_id y nada mas. Mismo patron que guard_role_change.
  if coalesce(public.current_user_role(), 'sales') <> 'admin'
     and auth.uid() is not null
     and ( NEW.permissions is distinct from OLD.permissions
        or NEW.store       is distinct from OLD.store
        or NEW.username    is distinct from OLD.username
        or NEW.erp_role    is distinct from OLD.erp_role ) then
    raise exception 'Only an admin can change permissions, store, username or erp_role';
  end if;
  return NEW;
end $$;

-- ===========================================================================
-- 4. erp.current_app_role() -> erp_role (NO public.profiles.role). Cierra el escalafon.
-- ===========================================================================
create or replace function erp.current_app_role()
  returns text language sql stable security definer set search_path = '' as $$
  select erp_role from public.profiles where id = auth.uid()
$$;

-- ===========================================================================
-- 5. A-2d: costo tras funcion DEFINER + REVOKE de columna base
--    La vista sigue security_invoker (la RLS de fila del base sigue aplicando). El costo ya
--    no se referencia como columna en la vista, sino via una funcion DEFINER que lo enmascara
--    con can_see_cost(). Asi el REVOKE de la columna no rompe la vista, y una consulta directa
--    a la tabla base recibe "permission denied for column cost".
-- ===========================================================================
create or replace function erp.product_cost(p_id bigint)
  returns numeric language sql stable security definer set search_path = '' as $$
  select case when erp.can_see_cost() then p.cost else null end from erp.products p where p.id = p_id
$$;
create or replace function erp.store_product_cost(p_store text, p_product bigint)
  returns numeric language sql stable security definer set search_path = '' as $$
  select case when erp.can_see_cost() then sp.store_cost else null end
  from erp.store_products sp where sp.store_id = p_store and sp.product_id = p_product
$$;
create or replace function erp.price_history_cost(ph_id bigint)
  returns numeric language sql stable security definer set search_path = '' as $$
  select case when erp.can_see_cost() then ph.cost else null end from erp.price_history ph where ph.id = ph_id
$$;
grant execute on function erp.product_cost(bigint)              to authenticated;
grant execute on function erp.store_product_cost(text, bigint)  to authenticated;
grant execute on function erp.price_history_cost(bigint)        to authenticated;

-- Vistas recreadas: identicas salvo que el costo/margen sale de las funciones DEFINER.
create or replace view erp.app_products with (security_invoker = on) as
 SELECT p.id, p.sku, p.name, p.description, p.status, p.record_status, p.needs_review,
    p.review_tags, p.discontinue_reason, p.disc_survey, p.category_id, c.path AS category_path,
    p.raw_category, p.raw_type, p.product_type, p.vendor_id, v.name AS vendor_name, p.mpn,
    p.material, p.finish, p.color1, p.color2, p.style, p.size_in, p.size_cm, p.origin,
    p.base_unit, p.sellable_units, p.sf_per_box, p.pieces_per_box, p.boxes_per_pallet,
    p.weight_per_box_lbs,
    erp.product_cost(p.id) AS cost,
    p.price, p.price_approved, p.price_source, p.taxable, p.barcode_upc, p.shopify_handle,
    p.image_url, p.tags, p.collection, p.bros, p.cuz, p.moq_group, p.verified, p.created_by,
    p.approved_by, p.approved_at, p.created_at, p.updated_at,
    erp.unit_gm(p.price, p.sell_unit::text, p.base_unit, p.sf_per_box, p.pieces_per_box::numeric, erp.product_cost(p.id)) AS gm_amount,
    erp.unit_margin_pct(p.price, p.sell_unit::text, p.base_unit, p.sf_per_box, p.pieces_per_box::numeric, erp.product_cost(p.id)) AS margin_pct,
    p.seo_title, p.seo_description, p.sell_unit, q.qoh, p.look, p.color_observation,
    p.substitute_color, p.subs, p.verified_level, p.date_added, p.folder_url, p.product_url,
    p.image_urls, p.lbs_per_pallet, p.price_erp, p.price_sales, p.price_mgr, p.price_vol,
    p.price_kind, p.price_mode
   FROM erp.products p
     LEFT JOIN erp.categories c ON c.id = p.category_id
     LEFT JOIN erp.vendors v ON v.id = p.vendor_id
     LEFT JOIN ( SELECT sp.product_id, sum(sp.qoh) AS qoh
           FROM erp.store_products sp GROUP BY sp.product_id) q ON q.product_id = p.id
  WHERE p.record_status = 'published'::erp.record_status
     OR (( SELECT erp.current_app_role()) = ANY (ARRAY['admin'::text, 'manager'::text]));

create or replace view erp.app_store_products with (security_invoker = on) as
 SELECT sp.store_id, sp.product_id, sp.assortment_active, sp.qb_code, sp.qoh,
    erp.store_product_cost(sp.store_id, sp.product_id) AS store_cost,
    sp.store_price, sp.moq, sp.reorder_point, sp.safety_stock, sp.min_level, sp.max_level,
    sp.abc_class,
    erp.unit_margin_pct(sp.store_price, pr.sell_unit::text, pr.base_unit, pr.sf_per_box, pr.pieces_per_box::numeric, erp.store_product_cost(sp.store_id, sp.product_id)) AS store_margin_pct,
    sp.qoh_verified, sp.qb_description
   FROM erp.store_products sp
     LEFT JOIN erp.products pr ON pr.id = sp.product_id
  WHERE (EXISTS ( SELECT 1 FROM erp.products p
          WHERE p.id = sp.product_id
            AND (p.record_status = 'published'::erp.record_status
                 OR (( SELECT erp.current_app_role()) = ANY (ARRAY['admin'::text, 'manager'::text])))));

create or replace view erp.app_price_history with (security_invoker = on) as
 SELECT ph.id, ph.product_id, ph.store_id, ph.price,
    erp.price_history_cost(ph.id) AS cost,
    ph.effective_from, ph.source, ph.actor, ph.created_at
   FROM erp.price_history ph
  WHERE (EXISTS ( SELECT 1 FROM erp.products p
          WHERE p.id = ph.product_id
            AND (p.record_status = 'published'::erp.record_status
                 OR (( SELECT erp.current_app_role()) = ANY (ARRAY['admin'::text, 'manager'::text])))));

-- Cerrar el costo de la tabla base. authenticated tiene SELECT a nivel de TABLA, asi que un
-- revoke de columna NO basta (el grant de tabla lo cubre igual). Hay que quitar el SELECT de
-- tabla y re-conceder columna por columna TODO MENOS el costo. La vista (invoker) lee las
-- columnas concedidas; el costo entra por la funcion DEFINER. anon no se re-concede (el ERP
-- exige sesion, anon no lo toca).
revoke select on erp.products       from authenticated, anon;
revoke select on erp.store_products from authenticated, anon;
revoke select on erp.price_history  from authenticated, anon;

grant select (id, sku, name, description, status, record_status, needs_review, review_tags,
  discontinue_reason, disc_survey, category_id, raw_category, raw_type, product_type, vendor_id,
  mpn, material, finish, color1, color2, style, size_in, size_cm, origin, base_unit,
  sellable_units, sf_per_box, pieces_per_box, boxes_per_pallet, weight_per_box_lbs, price,
  price_approved, price_source, taxable, barcode_upc, shopify_handle, image_url, tags, collection,
  bros, cuz, moq_group, verified, created_by, approved_by, approved_at, created_at, updated_at,
  seo_title, seo_description, sell_unit, look, color_observation, substitute_color, subs,
  verified_level, date_added, folder_url, product_url, image_urls, lbs_per_pallet, price_erp,
  price_sales, price_mgr, price_vol, price_kind, price_mode)
  on erp.products to authenticated;

grant select (store_id, product_id, assortment_active, qb_code, qoh, store_price, moq,
  reorder_point, safety_stock, min_level, max_level, abc_class, qoh_verified, demand,
  lead_time_months, qb_description)
  on erp.store_products to authenticated;

grant select (id, product_id, store_id, price, effective_from, source, actor, created_at)
  on erp.price_history to authenticated;

-- ===========================================================================
-- ROLLBACK (un comando: pegar el bloque). Restaura role de Deliveries y las columnas.
-- ===========================================================================
-- begin;
--   -- revertir current_app_role al rol de Deliveries
--   create or replace function erp.current_app_role() returns text language sql stable
--     security definer set search_path='' as $$ select role from public.profiles where id=auth.uid() $$;
--   -- devolver el SELECT de tabla completo (incluye el costo) y recrear las vistas con el CASE
--   grant select on erp.products       to authenticated;
--   grant select on erp.store_products to authenticated;
--   grant select on erp.price_history  to authenticated;
--   -- recrear las 3 vistas con el CASE WHEN can_see_cost() THEN p.cost (definicion previa);
--   -- ver git de este archivo para el cuerpo exacto anterior.
--   drop function if exists erp.product_cost(bigint);
--   drop function if exists erp.store_product_cost(text, bigint);
--   drop function if exists erp.price_history_cost(bigint);
--   -- quitar erp_role del guard
--   create or replace function public.guard_profile_privileged_columns() returns trigger
--     language plpgsql security definer set search_path=public as $$ begin
--       if coalesce(public.current_user_role(),'sales') <> 'admin' and auth.uid() is not null
--          and ( NEW.permissions is distinct from OLD.permissions or NEW.store is distinct from OLD.store
--             or NEW.username is distinct from OLD.username ) then
--         raise exception 'Only an admin can change permissions, store or username'; end if;
--       return NEW; end $$;
--   alter table public.profiles drop constraint if exists profiles_erp_role_known;
--   alter table public.profiles drop column if exists erp_role;
-- commit;
