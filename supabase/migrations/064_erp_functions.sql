-- 064: the ERP's 69 database functions.
--
-- Extracted from the live rtg-erp database and rewritten to schema `erp`. The
-- rewrite was mechanical and safe to check, because every one of these pins
-- `search_path = ''` and fully qualifies its references — so `public.products`
-- became `erp.products`, and the single reference to `public.profiles` was left
-- exactly where it was, because identity stays shared.
--
-- ONE adaptation, and it is the only place these differ from the originals:
-- current_app_role() returned the `app_role` enum, which existed only as the
-- type of profiles.role. This repo's profiles.role is text, so the function
-- returns text. Nothing else needed changing — the ERP's own code already wrote
-- `current_app_role()::text` in all 55 of its authorization guards, and the two
-- places that compared without a cast compare against string literals, which
-- works the same on text.
--
-- NOT brought across (9 functions): has_deliveries_access, has_recruiting_access,
-- has_timetracker_access, is_recruiting_admin, is_timetracker_admin,
-- current_timetracker_role, track_order, set_own_display_name,
-- admin_set_user_access. Those were written for the merge running the other
-- direction, or belong to modules this repo already owns — this app has its own
-- has_recruiting_access() and current_timetracker_role() in public, and taking
-- the ERP's copies would have shadowed them.
--
-- 66 of these are SECURITY DEFINER, which is what makes the 15 ERP tables with
-- RLS enabled and no policies reachable at all: the app never touches them
-- directly, only through these.

-- These are emitted in alphabetical order, which is not dependency order:
-- can_see_cost() calls current_app_role() and is created before it. Postgres
-- validates a SQL function's body at creation time, so that fails with
-- "function erp.current_app_role() does not exist" even though both exist by the
-- end of the file. Body checking is turned off for the duration — the same thing
-- pg_restore does, and for the same reason. It is set LOCAL, so it lasts only
-- for this transaction and never leaks into a later session.
set local check_function_bodies = off;

CREATE OR REPLACE FUNCTION erp.add_product_relation(p_product_id bigint, p_related_id bigint, p_relation text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_rel erp.relation_kind;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_product_id = p_related_id then raise exception 'a product cannot be its own relation'; end if;
  v_rel := p_relation::erp.relation_kind;
  if not exists (select 1 from erp.products where id = p_product_id) then raise exception 'product % not found', p_product_id; end if;
  if not exists (select 1 from erp.products where id = p_related_id) then raise exception 'product % not found', p_related_id; end if;
  insert into erp.product_relations(product_id, related_product_id, relation)
  values (p_product_id, p_related_id, v_rel), (p_related_id, p_product_id, v_rel)
  on conflict do nothing;
end $function$;

CREATE OR REPLACE FUNCTION erp.adjust_inventory(p_product_id bigint, p_store_id text, p_qty_delta numeric, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_mov bigint; v_qoh numeric;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_reason not in ('adjustment','damage','shrinkage') then raise exception 'invalid adjustment reason % (use adjustment|damage|shrinkage)', p_reason using errcode='P0001'; end if;
  if coalesce(p_qty_delta,0) = 0 then raise exception 'adjustment qty_delta must be non-zero' using errcode='P0001'; end if;
  if not exists (select 1 from erp.products p where p.id=p_product_id) then raise exception 'product % not found', p_product_id using errcode='P0002'; end if;
  if p_store_id is null or not exists (select 1 from erp.stores s where s.id=p_store_id) then raise exception 'store % not found', p_store_id using errcode='P0002'; end if;
  insert into erp.inventory_movements (product_id, store_id, qty_delta, reason, reference, actor)
  values (p_product_id, p_store_id, p_qty_delta, p_reason::erp.movement_reason, nullif(btrim(coalesce(p_note,'')),''), auth.uid())
  returning id into v_mov;
  select coalesce(qoh,0) into v_qoh from erp.store_products where store_id=p_store_id and product_id=p_product_id;
  return jsonb_build_object('movement_id', v_mov, 'reason', p_reason, 'qty_delta', p_qty_delta,
    'new_qoh', coalesce(v_qoh,0), 'negative', coalesce(v_qoh,0) < 0);
end $function$;

CREATE OR REPLACE FUNCTION erp.analytics_category_stats(p_period text DEFAULT 'month'::text, p_parent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_period text; r jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  v_period := case when p_period in ('week','month','quarter','year') then p_period else 'month' end;
  with base as (
    select p.id, p.cost, p.price, p.sell_unit, p.base_unit, p.sf_per_box, p.pieces_per_box, p.review_tags, p.needs_review, p.record_status,
           case when p_parent is null then coalesce(nullif(split_part(c.path,' > ',1),''),'Uncategorized')
                else nullif(split_part(c.path,' > ',2),'') end as grp
    from erp.products p left join erp.categories c on c.id = p.category_id
    where p_parent is null or c.path like p_parent || ' > %'
  ),
  sales as (
    select b.grp, sum(s.net_sales) net, sum(s.qty) units,
           coalesce(sum(s.net_sales) filter (where b.cost is not null),0) net_m,
           coalesce(sum(s.qty*b.cost) filter (where b.cost is not null),0) cogs
    from erp.sales_history s join base b on b.id = s.product_id where b.grp is not null group by b.grp
  ),
  cat as (
    select grp, count(*) product_count,
           count(*) filter (where review_tags @> array['BELOW COST']) below_cost,
           count(*) filter (where needs_review) needs_review,
           round(avg(erp.unit_margin_pct(price, sell_unit::text, base_unit, sf_per_box, pieces_per_box, cost)),1) avg_margin
    from base where record_status='published' and grp is not null group by grp
  ),
  inv as (
    select b.grp, sum(sp.qoh*b.cost) value from erp.store_products sp join base b on b.id = sp.product_id where b.cost is not null and b.grp is not null group by b.grp
  )
  select jsonb_build_object(
    'period', v_period, 'parent', p_parent,
    'trend_sales', coalesce((select jsonb_agg(jsonb_build_object('label', to_char(bk, case v_period when 'week' then 'YYYY-MM-DD' when 'month' then 'Mon YYYY' when 'quarter' then '"Q"Q YYYY' else 'YYYY' end), 'value', round(v,2)) order by bk)
        from (select date_trunc(v_period, s.sold_at) bk, sum(s.net_sales) v from erp.sales_history s join base b on b.id=s.product_id group by 1) t), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'category', grp, 'net_sales', round(coalesce(net,0),2), 'units', round(coalesce(units,0)),
        'gm', round(coalesce(net_m,0)-coalesce(cogs,0),2),
        'margin_pct', case when coalesce(net_m,0)<>0 then round((net_m-cogs)/net_m*100,1) else null end,
        'product_count', coalesce(product_count,0), 'inventory_value', round(coalesce(value,0),2),
        'avg_margin_pct', avg_margin, 'below_cost', coalesce(below_cost,0), 'needs_review', coalesce(needs_review,0)) order by coalesce(net,0) desc)
      from (select distinct grp from base where grp is not null) g
      left join sales using (grp) left join cat using (grp) left join inv using (grp)
      where coalesce(net,0) <> 0 or coalesce(product_count,0) > 0), '[]'::jsonb)
  ) into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION erp.analytics_store_stats(p_period text DEFAULT 'month'::text, p_store text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_period text; r jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  v_period := case when p_period in ('week','month','quarter','year') then p_period else 'month' end;
  with sh as (
    select s.net_sales, s.qty, s.sold_at, s.unified_desc, p.cost, p.name as pname
    from erp.sales_history s left join erp.products p on p.id = s.product_id
    where p_store is null or s.store_id = p_store
  ),
  m as (
    select coalesce(sum(net_sales),0) net, coalesce(sum(qty),0) units, count(*) txns,
           coalesce(sum(net_sales) filter (where cost is not null),0) net_m,
           coalesce(sum(qty*cost) filter (where cost is not null),0) cogs,
           min(sold_at) ds, max(sold_at) de
    from sh
  )
  select jsonb_build_object(
    'period', v_period, 'store', p_store,
    'range_start', (select ds from m), 'range_end', (select de from m),
    'net_sales', (select round(net,2) from m), 'units', (select round(units) from m), 'txns', (select txns from m),
    'avg_sale', (select case when txns>0 then round(net/txns,2) else 0 end from m),
    'cogs', (select round(cogs,2) from m),
    'gm', (select round(net_m-cogs,2) from m),
    'margin_pct', (select case when net_m<>0 then round((net_m-cogs)/net_m*100,1) else null end from m),
    'trend_sales', coalesce((select jsonb_agg(jsonb_build_object('label', to_char(b, case v_period when 'week' then 'YYYY-MM-DD' when 'month' then 'Mon YYYY' when 'quarter' then '"Q"Q YYYY' else 'YYYY' end), 'value', round(v,2)) order by b)
        from (select date_trunc(v_period, sold_at) b, sum(net_sales) v from sh group by 1) t), '[]'::jsonb),
    'trend_units', coalesce((select jsonb_agg(jsonb_build_object('label', to_char(b, case v_period when 'week' then 'YYYY-MM-DD' when 'month' then 'Mon YYYY' when 'quarter' then '"Q"Q YYYY' else 'YYYY' end), 'value', round(v)) order by b)
        from (select date_trunc(v_period, sold_at) b, sum(qty) v from sh group by 1) t), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('label', lbl, 'value', round(v,2)) order by v desc)
        from (select coalesce(pname, unified_desc, 'Unmatched') lbl, sum(net_sales) v from sh group by 1 order by v desc nulls last limit 10) tp), '[]'::jsonb)
  ) into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION erp.analytics_vendor_stats(p_period text DEFAULT 'month'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_period text; r jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  v_period := case when p_period in ('week','month','quarter','year') then p_period else 'month' end;
  with sales as (
    select p.vendor_id, sum(s.net_sales) net, sum(s.qty) units,
           coalesce(sum(s.net_sales) filter (where p.cost is not null),0) net_m,
           coalesce(sum(s.qty*p.cost) filter (where p.cost is not null),0) cogs
    from erp.sales_history s join erp.products p on p.id = s.product_id group by p.vendor_id
  ),
  cat as (
    select p.vendor_id, count(*) product_count,
           count(*) filter (where p.review_tags @> array['BELOW COST']) below_cost,
           count(*) filter (where p.needs_review) needs_review,
           round(avg(erp.unit_margin_pct(p.price, p.sell_unit::text, p.base_unit, p.sf_per_box, p.pieces_per_box, p.cost)),1) avg_margin
    from erp.products p where p.record_status='published' group by p.vendor_id
  ),
  inv as (
    select p.vendor_id, sum(sp.qoh*p.cost) value
    from erp.store_products sp join erp.products p on p.id = sp.product_id where p.cost is not null group by p.vendor_id
  )
  select jsonb_build_object(
    'period', v_period,
    'trend_sales', coalesce((select jsonb_agg(jsonb_build_object('label', to_char(b, case v_period when 'week' then 'YYYY-MM-DD' when 'month' then 'Mon YYYY' when 'quarter' then '"Q"Q YYYY' else 'YYYY' end), 'value', round(v,2)) order by b)
        from (select date_trunc(v_period, sold_at) b, sum(net_sales) v from erp.sales_history group by 1) t), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(jsonb_build_object(
        'vendor_id', vendor_id, 'vendor', vname, 'net_sales', round(net,2), 'units', round(units),
        'gm', round(gm,2), 'margin_pct', margin_pct, 'product_count', product_count,
        'inventory_value', round(inv_value,2), 'avg_margin_pct', avg_margin, 'below_cost', below_cost, 'needs_review', needs_review) order by net desc nulls last)
      from (
        select v.id vendor_id, v.name vname,
               coalesce(sales.net,0) net, coalesce(sales.units,0) units,
               coalesce(sales.net_m,0)-coalesce(sales.cogs,0) gm,
               case when coalesce(sales.net_m,0)<>0 then round((sales.net_m-sales.cogs)/sales.net_m*100,1) else null end margin_pct,
               coalesce(cat.product_count,0) product_count, coalesce(inv.value,0) inv_value,
               cat.avg_margin, coalesce(cat.below_cost,0) below_cost, coalesce(cat.needs_review,0) needs_review
        from erp.vendors v
        left join sales on sales.vendor_id = v.id
        left join cat   on cat.vendor_id = v.id
        left join inv   on inv.vendor_id = v.id
        where coalesce(sales.net,0) <> 0 or coalesce(cat.product_count,0) > 0
        order by net desc nulls last limit 30
      ) x), '[]'::jsonb)
  ) into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION erp.apply_category_assignments()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare updated int := 0; skipped int := 0; no_match int := 0; rec record;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  for rec in
    select s.sku, c.id as cat_id
    from erp.staging_cat_assign s
    left join erp.categories c on c.path = s.path
  loop
    if rec.cat_id is null then no_match := no_match + 1; continue; end if;
    update erp.products set category_id = rec.cat_id, updated_at = now()
      where sku = rec.sku and category_id is null;
    if found then updated := updated + 1; else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('updated', updated, 'skipped', skipped, 'no_match', no_match);
end $function$;

CREATE OR REPLACE FUNCTION erp.apply_decisions(p_rows jsonb, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  elem jsonb; prod erp.products%rowtype;
  v_sku text; v_price numeric; v_cost numeric; v_sf numeric;
  v_status erp.commercial_status; v_cat bigint; changes jsonb;
  applied int := 0; skipped int := 0; errored int := 0; will_apply int := 0; v_seq int := 0;
  out_rows jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'too many rows (max 20000 per call)'; end if;

  create temp table if not exists _dec_results (seq int, obj jsonb) on commit drop;
  truncate _dec_results;

  for elem in select * from jsonb_array_elements(p_rows) loop
    v_seq := v_seq + 1;
    v_sku := upper(trim(coalesce(elem->>'sku','')));
    if v_sku = '' then
      errored := errored + 1;
      insert into _dec_results values (v_seq, jsonb_build_object('sku', elem->>'sku', 'action','error','reason','missing SKU'));
      continue;
    end if;
    select * into prod from erp.products where sku = v_sku;
    if not found then
      errored := errored + 1;
      insert into _dec_results values (v_seq, jsonb_build_object('sku', v_sku, 'action','error','reason','unknown SKU'));
      continue;
    end if;

    begin
      changes := '[]'::jsonb;
      v_price := null; v_cost := null; v_sf := null; v_status := null; v_cat := null;

      if nullif(trim(coalesce(elem->>'price','')),'') is not null then
        v_price := (elem->>'price')::numeric;
        if v_price is distinct from prod.price then changes := changes || jsonb_build_object('field','price','from',prod.price,'to',v_price); end if;
      end if;
      if nullif(trim(coalesce(elem->>'cost','')),'') is not null then
        v_cost := (elem->>'cost')::numeric;
        if v_cost is distinct from prod.cost then changes := changes || jsonb_build_object('field','cost','from',prod.cost,'to',v_cost); end if;
      end if;
      if nullif(trim(coalesce(elem->>'sf_per_box','')),'') is not null then
        v_sf := (elem->>'sf_per_box')::numeric;
        if v_sf is distinct from prod.sf_per_box then changes := changes || jsonb_build_object('field','sf_per_box','from',prod.sf_per_box,'to',v_sf); end if;
      end if;
      if nullif(trim(coalesce(elem->>'base_unit','')),'') is not null and trim(elem->>'base_unit') is distinct from prod.base_unit then
        changes := changes || jsonb_build_object('field','base_unit','from',prod.base_unit,'to',trim(elem->>'base_unit'));
      end if;
      if nullif(trim(coalesce(elem->>'size_in','')),'') is not null and trim(elem->>'size_in') is distinct from prod.size_in then
        changes := changes || jsonb_build_object('field','size_in','from',prod.size_in,'to',trim(elem->>'size_in'));
      end if;
      if nullif(trim(coalesce(elem->>'size_cm','')),'') is not null and trim(elem->>'size_cm') is distinct from prod.size_cm then
        changes := changes || jsonb_build_object('field','size_cm','from',prod.size_cm,'to',trim(elem->>'size_cm'));
      end if;
      if nullif(trim(coalesce(elem->>'material','')),'') is not null and trim(elem->>'material') is distinct from prod.material then
        changes := changes || jsonb_build_object('field','material','from',prod.material,'to',trim(elem->>'material'));
      end if;
      if nullif(trim(coalesce(elem->>'finish','')),'') is not null and trim(elem->>'finish') is distinct from prod.finish then
        changes := changes || jsonb_build_object('field','finish','from',prod.finish,'to',trim(elem->>'finish'));
      end if;
      if nullif(trim(coalesce(elem->>'status','')),'') is not null then
        v_status := (elem->>'status')::erp.commercial_status;
        if v_status is distinct from prod.status then changes := changes || jsonb_build_object('field','status','from',prod.status::text,'to',v_status::text); end if;
      end if;
      if nullif(trim(coalesce(elem->>'category_path','')),'') is not null then
        select id into v_cat from erp.categories where path = trim(elem->>'category_path');
        if v_cat is null then raise exception 'unknown category "%"', trim(elem->>'category_path'); end if;
        if v_cat is distinct from prod.category_id then
          changes := changes || jsonb_build_object('field','category_path','from',(select path from erp.categories where id=prod.category_id),'to',trim(elem->>'category_path'));
        end if;
      end if;

      if jsonb_array_length(changes) = 0 then
        skipped := skipped + 1;
        insert into _dec_results values (v_seq, jsonb_build_object('sku',v_sku,'action','skip','reason','no change'));
      elsif p_dry_run then
        will_apply := will_apply + 1;
        insert into _dec_results values (v_seq, jsonb_build_object('sku',v_sku,'action','preview','changes',changes));
      else
        update erp.products set
          price       = case when nullif(trim(coalesce(elem->>'price','')),'') is not null then v_price else price end,
          cost        = case when nullif(trim(coalesce(elem->>'cost','')),'') is not null then v_cost else cost end,
          sf_per_box  = case when nullif(trim(coalesce(elem->>'sf_per_box','')),'') is not null then v_sf else sf_per_box end,
          base_unit   = case when nullif(trim(coalesce(elem->>'base_unit','')),'') is not null then trim(elem->>'base_unit') else base_unit end,
          size_in     = case when nullif(trim(coalesce(elem->>'size_in','')),'') is not null then trim(elem->>'size_in') else size_in end,
          size_cm     = case when nullif(trim(coalesce(elem->>'size_cm','')),'') is not null then trim(elem->>'size_cm') else size_cm end,
          material    = case when nullif(trim(coalesce(elem->>'material','')),'') is not null then trim(elem->>'material') else material end,
          finish      = case when nullif(trim(coalesce(elem->>'finish','')),'') is not null then trim(elem->>'finish') else finish end,
          status      = case when nullif(trim(coalesce(elem->>'status','')),'') is not null then v_status else status end,
          category_id = case when nullif(trim(coalesce(elem->>'category_path','')),'') is not null then v_cat else category_id end,
          updated_at  = now()
        where id = prod.id;
        applied := applied + 1;
        insert into _dec_results values (v_seq, jsonb_build_object('sku',v_sku,'action','applied','changes',changes));
      end if;
    exception when others then
      errored := errored + 1;
      insert into _dec_results values (v_seq, jsonb_build_object('sku',v_sku,'action','error','reason', sqlerrm));
    end;
  end loop;

  select coalesce(jsonb_agg(obj order by seq), '[]'::jsonb) into out_rows from _dec_results;
  return jsonb_build_object(
    'dry_run', p_dry_run, 'total', jsonb_array_length(p_rows),
    'applied', applied, 'skipped', skipped, 'errored', errored, 'will_apply', will_apply,
    'rows', out_rows
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.apply_master_import(p_rows jsonb, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  elem jsonb; prod erp.products%rowtype; diff jsonb; patch jsonb; changes jsonb;
  v_sku text; v_expected text; v_uid uuid := auth.uid();
  v_seq int := 0; v_target_id bigint; v_is_draft boolean; v_do_write boolean; v_lock timestamptz;
  applied int := 0; skipped int := 0; errored int := 0; will_apply int := 0; stale int := 0; drafts int := 0;
  out_rows jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'too many rows (max 20000 per call)'; end if;

  create temp table if not exists _mi_results (seq int, obj jsonb) on commit drop;
  truncate _mi_results;

  for elem in select * from jsonb_array_elements(p_rows) loop
    v_seq := v_seq + 1;
    v_sku := upper(btrim(coalesce(elem->>'sku','')));
    v_is_draft := false; v_do_write := false; v_target_id := null; v_lock := null;

    if v_sku = '' then
      errored := errored + 1;
      insert into _mi_results values (v_seq, jsonb_build_object('sku', elem->>'sku','action','error','reason','missing SKU'));
      continue;
    end if;

    begin
      select * into prod from erp.products where sku = v_sku;

      if not found then
        if nullif(btrim(coalesce(elem->>'name','')),'') is null then raise exception 'new product needs a name'; end if;
        if v_sku !~ '^[A-Z0-9][A-Z0-9\-]{0,63}$' then raise exception 'invalid SKU format for a new product'; end if;
        diff  := erp.master_import_diff(elem, '{}'::jsonb);
        patch := diff->'patch';
        if p_dry_run then
          drafts := drafts + 1;
          insert into _mi_results values (v_seq, jsonb_build_object(
            'sku', v_sku, 'action','new_draft','reason','unknown SKU -> will create a draft for approval',
            'changes', diff->'changes'));
          continue;
        end if;
        v_is_draft := true; v_do_write := true;
      else
        diff    := erp.master_import_diff(elem, to_jsonb(prod));
        patch   := diff->'patch';
        changes := diff->'changes';
        v_expected := nullif(btrim(elem->>'__row_version'),'');
        if jsonb_array_length(changes) = 0 then
          skipped := skipped + 1;
          insert into _mi_results values (v_seq, jsonb_build_object('sku',v_sku,'action','skip','reason','no change'));
          continue;
        elsif v_expected is not null and v_expected::timestamptz is distinct from prod.updated_at then
          stale := stale + 1;
          insert into _mi_results values (v_seq, jsonb_build_object(
            'sku',v_sku,'action','stale',
            'reason','changed in the DB since your export - review their value vs current DB value',
            'changes',changes));
          continue;
        elsif p_dry_run then
          will_apply := will_apply + 1;
          insert into _mi_results values (v_seq, jsonb_build_object('sku',v_sku,'action','preview','changes',changes));
          continue;
        end if;
        v_target_id := prod.id; v_lock := prod.updated_at; v_do_write := true;
      end if;

      if v_do_write then
        if v_is_draft then
          insert into erp.products (sku, name, status, record_status, needs_review, review_tags, taxable, created_by)
          values (v_sku, coalesce(patch->>'name', btrim(elem->>'name')),
                  coalesce((patch->>'status')::erp.commercial_status, 'active'),
                  'draft', true, array['EXCEL IMPORT'], true, v_uid)
          returning id into v_target_id;
          v_lock := null;
        end if;

        update erp.products set
          name              = case when patch ? 'name'              then patch->>'name'                                else name end,
          description       = case when patch ? 'description'       then patch->>'description'                         else description end,
          discontinue_reason= case when patch ? 'discontinue_reason'then patch->>'discontinue_reason'                  else discontinue_reason end,
          mpn               = case when patch ? 'mpn'               then patch->>'mpn'                                 else mpn end,
          material          = case when patch ? 'material'          then patch->>'material'                            else material end,
          finish            = case when patch ? 'finish'            then patch->>'finish'                              else finish end,
          color1            = case when patch ? 'color1'            then patch->>'color1'                              else color1 end,
          color2            = case when patch ? 'color2'            then patch->>'color2'                              else color2 end,
          look              = case when patch ? 'look'              then patch->>'look'                                else look end,
          color_observation = case when patch ? 'color_observation' then patch->>'color_observation'                   else color_observation end,
          substitute_color  = case when patch ? 'substitute_color'  then patch->>'substitute_color'                    else substitute_color end,
          style             = case when patch ? 'style'             then patch->>'style'                               else style end,
          size_in           = case when patch ? 'size_in'           then patch->>'size_in'                             else size_in end,
          size_cm           = case when patch ? 'size_cm'           then patch->>'size_cm'                             else size_cm end,
          origin            = case when patch ? 'origin'            then patch->>'origin'                              else origin end,
          base_unit         = case when patch ? 'base_unit'         then patch->>'base_unit'                           else base_unit end,
          collection        = case when patch ? 'collection'        then patch->>'collection'                          else collection end,
          tags              = case when patch ? 'tags'              then patch->>'tags'                                else tags end,
          barcode_upc       = case when patch ? 'barcode_upc'       then patch->>'barcode_upc'                         else barcode_upc end,
          shopify_handle    = case when patch ? 'shopify_handle'    then patch->>'shopify_handle'                      else shopify_handle end,
          seo_title         = case when patch ? 'seo_title'         then patch->>'seo_title'                           else seo_title end,
          seo_description   = case when patch ? 'seo_description'   then patch->>'seo_description'                     else seo_description end,
          image_url         = case when patch ? 'image_url'         then patch->>'image_url'                           else image_url end,
          folder_url        = case when patch ? 'folder_url'        then patch->>'folder_url'                          else folder_url end,
          product_url       = case when patch ? 'product_url'       then patch->>'product_url'                         else product_url end,
          bros              = case when patch ? 'bros'              then patch->>'bros'                                else bros end,
          cuz               = case when patch ? 'cuz'               then patch->>'cuz'                                 else cuz end,
          subs              = case when patch ? 'subs'              then patch->>'subs'                                else subs end,
          price_kind        = case when patch ? 'price_kind'        then patch->>'price_kind'                          else price_kind end,
          price_mode        = case when patch ? 'price_mode'        then patch->>'price_mode'                          else price_mode end,
          price             = case when patch ? 'price'             then (patch->>'price')::numeric                    else price end,
          cost              = case when patch ? 'cost'              then (patch->>'cost')::numeric                     else cost end,
          sf_per_box        = case when patch ? 'sf_per_box'        then (patch->>'sf_per_box')::numeric               else sf_per_box end,
          weight_per_box_lbs= case when patch ? 'weight_per_box_lbs'then (patch->>'weight_per_box_lbs')::numeric       else weight_per_box_lbs end,
          lbs_per_pallet    = case when patch ? 'lbs_per_pallet'    then (patch->>'lbs_per_pallet')::numeric           else lbs_per_pallet end,
          moq_group         = case when patch ? 'moq_group'         then (patch->>'moq_group')::numeric                else moq_group end,
          price_erp         = case when patch ? 'price_erp'         then (patch->>'price_erp')::numeric                else price_erp end,
          price_sales       = case when patch ? 'price_sales'       then (patch->>'price_sales')::numeric              else price_sales end,
          price_mgr         = case when patch ? 'price_mgr'         then (patch->>'price_mgr')::numeric                else price_mgr end,
          price_vol         = case when patch ? 'price_vol'         then (patch->>'price_vol')::numeric                else price_vol end,
          pieces_per_box    = case when patch ? 'pieces_per_box'    then (patch->>'pieces_per_box')::int               else pieces_per_box end,
          boxes_per_pallet  = case when patch ? 'boxes_per_pallet'  then (patch->>'boxes_per_pallet')::int             else boxes_per_pallet end,
          status            = case when patch ? 'status'            then (patch->>'status')::erp.commercial_status  else status end,
          product_type      = case when patch ? 'product_type'      then (patch->>'product_type')::erp.product_type else product_type end,
          sell_unit         = case when patch ? 'sell_unit'         then (patch->>'sell_unit')::erp.sell_unit       else sell_unit end,
          taxable           = case when patch ? 'taxable'           then (patch->>'taxable')::boolean                  else taxable end,
          date_added        = case when patch ? 'date_added'        then (patch->>'date_added')::date                  else date_added end,
          category_id       = case when patch ? 'category_id'       then (patch->>'category_id')::bigint               else category_id end,
          vendor_id         = case when patch ? 'vendor_id'         then (patch->>'vendor_id')::bigint                 else vendor_id end,
          updated_at = now()
        where id = v_target_id and (v_lock is null or updated_at = v_lock);

        if v_is_draft then
          insert into erp.product_requests (type, product_id, requester, payload, reason)
          values ('new', v_target_id, v_uid,
                  jsonb_build_object('sku', v_sku, 'name', coalesce(patch->>'name', btrim(elem->>'name')), 'source','excel_round_trip'),
                  'Excel round-trip import (unknown SKU)');
          drafts := drafts + 1;
          insert into _mi_results values (v_seq, jsonb_build_object('sku',v_sku,'action','new_draft','reason','draft created for approval','changes',diff->'changes'));
        elsif not found then
          stale := stale + 1;
          insert into _mi_results values (v_seq, jsonb_build_object('sku',v_sku,'action','stale','reason','changed concurrently during apply','changes',changes));
        else
          applied := applied + 1;
          insert into _mi_results values (v_seq, jsonb_build_object('sku',v_sku,'action','applied','changes',changes));
        end if;
      end if;
    exception when others then
      errored := errored + 1;
      insert into _mi_results values (v_seq, jsonb_build_object('sku',v_sku,'action','error','reason', sqlerrm));
    end;
  end loop;

  select coalesce(jsonb_agg(obj order by seq), '[]'::jsonb) into out_rows from _mi_results;
  return jsonb_build_object(
    'dry_run', p_dry_run, 'total', jsonb_array_length(p_rows),
    'applied', applied, 'skipped', skipped, 'errored', errored, 'will_apply', will_apply,
    'stale', stale, 'drafts', drafts, 'rows', out_rows
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.apply_movement_to_cache()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.store_id is not null and new.reason <> 'opening_balance' then
    insert into erp.store_products (store_id, product_id, qoh, assortment_active)
    values (new.store_id, new.product_id, new.qty_delta, false)
    on conflict (store_id, product_id) do update set qoh = coalesce(erp.store_products.qoh, 0) + excluded.qoh;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION erp.assign_draft_sku(p_id bigint, p_sku text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare clean_sku text := upper(trim(p_sku));
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  if clean_sku !~ '^[A-Z0-9][A-Z0-9-]{0,63}$' then raise exception 'invalid SKU format'; end if;
  if exists (select 1 from erp.products where sku = clean_sku and id <> p_id) then
    raise exception 'SKU % already exists', clean_sku;
  end if;
  update erp.products set
    sku = clean_sku,
    review_tags = array_remove(review_tags, 'PO IMPORT'),
    needs_review = (coalesce(array_length(array_remove(review_tags, 'PO IMPORT'), 1), 0) > 0),
    updated_at = now()
  where id = p_id and record_status = 'draft';
  if not found then raise exception 'draft % not found', p_id; end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.assign_sell_units(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_assigned int; v_uncomputable int; v_dist jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  drop table if exists _su;
  create temp table _su on commit drop as
  select id, price, cost, sf_per_box, pieces_per_box,
    case product_type
      when 'tile'  then 'sqft'::erp.sell_unit
      when 'trim'  then 'piece'::erp.sell_unit
      when 'tool'  then 'each'::erp.sell_unit
      when 'accessory' then 'each'::erp.sell_unit
      when 'setting_material' then coalesce(
        (case when erp.base_unit_to_sell_unit(base_unit) in ('bag','bucket','box')
              then erp.base_unit_to_sell_unit(base_unit) end), 'each'::erp.sell_unit)
      else coalesce(erp.base_unit_to_sell_unit(base_unit), 'each'::erp.sell_unit)  -- 'other'
    end as target
  from erp.products
  where sell_unit is null and record_status <> 'archived';

  select count(*) into v_assigned from _su;
  select count(*) into v_uncomputable from _su
    where target in ('sqft','piece') and price is not null and cost is not null
      and ((target='sqft' and coalesce(sf_per_box,0) <= 0) or (target='piece' and coalesce(pieces_per_box,0) <= 0));
  select coalesce(jsonb_object_agg(target::text, n), '{}'::jsonb) into v_dist
    from (select target, count(*) n from _su group by target) d;

  if not p_dry_run then
    update erp.products p set sell_unit = s.target, updated_at = now()
    from _su s where s.id = p.id and p.sell_unit is null;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'assigned', v_assigned, 'by_unit', v_dist,
                            'uncomputable_missing_factor', v_uncomputable);
end $function$;

CREATE OR REPLACE FUNCTION erp.audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  pk  text  := coalesce(rec->>'id', rec->>'old_sku');
begin
  insert into erp.audit_log(actor, table_name, row_pk, action, before, after)
  values (
    auth.uid(), tg_table_name, pk, tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION erp.base_unit_to_sell_unit(p_base text)
 RETURNS erp.sell_unit
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case upper(btrim(coalesce(p_base,'')))
    when 'BOX' then 'box' when 'BX' then 'box'
    when 'BAG' then 'bag'
    when 'BUCKET' then 'bucket'
    when 'LF' then 'linear_ft' when 'LM' then 'linear_ft'
    when 'PIECE' then 'piece' when 'PC' then 'piece' when 'PCS' then 'piece'
    when 'EA' then 'each' when 'EACH' then 'each' when 'PAIR' then 'each'
    when 'SF' then 'sqft' when 'SQFT' then 'sqft' when 'PI2' then 'sqft'
    else null end::erp.sell_unit
$function$;

CREATE OR REPLACE FUNCTION erp.bulk_resolve_tag(p_ids bigint[], p_tag text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_total int; v_updated int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  if array_length(p_ids, 1) > 10000 then raise exception 'too many rows (max 10000)'; end if;
  v_total := coalesce(array_length(p_ids, 1), 0);

  with upd as (
    update erp.products p
       set review_tags  = array_remove(p.review_tags, p_tag),
           needs_review = (coalesce(array_length(array_remove(p.review_tags, p_tag), 1), 0) > 0),
           updated_at   = now()
     where p.id = any(p_ids)
       and p_tag = any(p.review_tags)
    returning p.id
  )
  select count(*)::int into v_updated from upd;

  return jsonb_build_object('updated', v_updated, 'skipped', v_total - v_updated);
end $function$;

CREATE OR REPLACE FUNCTION erp.bulk_update_products(p_ids bigint[], patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  i bigint;
  updated int := 0; skipped int := 0; errored int := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  if array_length(p_ids, 1) > 10000 then raise exception 'too many rows (max 10000)'; end if;
  foreach i in array p_ids loop
    begin
      update erp.products set
        name           = case when patch ? 'name'           then nullif(patch->>'name','')               else name end,
        price          = case when patch ? 'price'          then nullif(patch->>'price','')::numeric      else price end,
        cost           = case when patch ? 'cost'           then nullif(patch->>'cost','')::numeric       else cost end,
        base_unit      = case when patch ? 'base_unit'      then nullif(patch->>'base_unit','')           else base_unit end,
        sf_per_box     = case when patch ? 'sf_per_box'     then nullif(patch->>'sf_per_box','')::numeric else sf_per_box end,
        pieces_per_box = case when patch ? 'pieces_per_box' then nullif(patch->>'pieces_per_box','')::int else pieces_per_box end,
        size_in        = case when patch ? 'size_in'        then nullif(patch->>'size_in','')             else size_in end,
        size_cm        = case when patch ? 'size_cm'        then nullif(patch->>'size_cm','')             else size_cm end,
        material       = case when patch ? 'material'       then nullif(patch->>'material','')            else material end,
        finish         = case when patch ? 'finish'         then nullif(patch->>'finish','')             else finish end,
        mpn            = case when patch ? 'mpn'            then nullif(patch->>'mpn','')                 else mpn end,
        category_id    = case when patch ? 'category_id'    then nullif(patch->>'category_id','')::bigint else category_id end,
        status         = case when nullif(patch->>'status','') is not null then (patch->>'status')::erp.commercial_status else status end,
        updated_at = now()
      where id = i and record_status <> 'archived';
      if found then
        updated := updated + 1;
        v_rows := v_rows || jsonb_build_object('id', i, 'action', 'updated');
      else
        skipped := skipped + 1;
        v_rows := v_rows || jsonb_build_object('id', i, 'action', 'skipped',
                              'reason', 'no matching row (archived, or no such id)');
      end if;
    exception when others then
      -- The per-row subtransaction still contains the failure so one bad row cannot abort the batch —
      -- but the REASON now travels back to the caller instead of being discarded (COR-11).
      errored := errored + 1;
      v_rows := v_rows || jsonb_build_object('id', i, 'action', 'error', 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object(
    'total',   coalesce(array_length(p_ids, 1), 0),
    'updated', updated,
    'skipped', skipped,
    'errored', errored,
    'rows',    v_rows
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.can_see_cost()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(erp.current_app_role() in ('admin','manager'), false)
$function$;

CREATE OR REPLACE FUNCTION erp.capture_price_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.price is not null or new.cost is not null then
      insert into erp.price_history(product_id, store_id, price, cost, source, actor)
      values (new.id, null, new.price, new.cost, 'portal edit', auth.uid());
    end if;
  elsif (new.price is distinct from old.price) or (new.cost is distinct from old.cost) then
    insert into erp.price_history(product_id, store_id, price, cost, source, actor)
    values (new.id, null, new.price, new.cost, 'portal edit', auth.uid());
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION erp.capture_store_price_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.store_price is not null or new.store_cost is not null then
      insert into erp.price_history(product_id, store_id, price, cost, source, actor)
      values (new.product_id, new.store_id, new.store_price, new.store_cost, 'portal edit', auth.uid());
    end if;
  elsif (new.store_price is distinct from old.store_price) or (new.store_cost is distinct from old.store_cost) then
    insert into erp.price_history(product_id, store_id, price, cost, source, actor)
    values (new.product_id, new.store_id, new.store_price, new.store_cost, 'portal edit', auth.uid());
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION erp.catalog_facets()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with v as (
    select p.status, p.record_status, p.needs_review
    from erp.products p
    where p.record_status = 'published' or erp.current_app_role() in ('admin','manager')
  )
  select jsonb_build_object(
    'total',         (select count(*) from v),
    'active',        (select count(*) from v where status='active'),
    'special_order', (select count(*) from v where status='special_order'),
    'needs_review',  (select count(*) from v where needs_review),
    'by_record', jsonb_build_object(
      'all',              (select count(*) from v),
      'published',        (select count(*) from v where record_status='published'),
      'draft',            (select count(*) from v where record_status='draft'),
      'pending_approval', (select count(*) from v where record_status='pending_approval'),
      'archived',         (select count(*) from v where record_status='archived')
    )
  );
$function$;

CREATE OR REPLACE FUNCTION erp.category_browse()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  with prod as (
    select p.id, p.name,
           coalesce(nullif(split_part(c.path,' > ',1),''),'Uncategorized') grp,
           row_number() over (
             partition by coalesce(nullif(split_part(c.path,' > ',1),''),'Uncategorized') order by p.name
           ) rn
    from erp.products p left join erp.categories c on c.id = p.category_id
    where p.record_status = 'published'
  )
  select coalesce(jsonb_agg(jsonb_build_object('category', grp, 'product_count', cnt, 'sample', sample) order by cnt desc), '[]'::jsonb) into r
  from (
    select grp, count(*) cnt,
           jsonb_agg(jsonb_build_object('id', id, 'name', name) order by rn) filter (where rn <= 10) sample
    from prod group by grp
  ) g;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION erp.confirm_external_match(p_ref_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_pid bigint; v_code text; v_mpn text; v_status text;
begin
  -- Fail-closed role gate, unchanged from v4_20/v4_54: a NULL role must not pass, so the
  -- test is coalesce(...)::text not in (...) rather than a bare NOT IN.
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- THE GUARD. `and match_status = 'auto'` makes the confirm a state transition instead of
  -- an unconditional write: it matches no row for an already-confirmed or rejected ref, so
  -- FOUND is false and the backfill below is never reached a second time.
  update erp.product_external_refs
     set match_status = 'confirmed', updated_at = now()
   where id = p_ref_id
     and match_status = 'auto'
  returning product_id, external_sku into v_pid, v_code;

  if not found then
    -- Found-check. Separate the two failure modes so the caller gets a true reason: a
    -- missing id and a wrong-state id used to be indistinguishable (the second did not
    -- even raise).
    select match_status into v_status
      from erp.product_external_refs where id = p_ref_id;
    if v_status is null then
      raise exception 'external ref % not found', p_ref_id;
    end if;
    raise exception 'external ref % is already %, not a pending auto suggestion', p_ref_id, v_status;
  end if;

  -- MPN enrichment: only when empty, only on the one confirm that moved the row out of
  -- 'auto', through the existing audited update_product path (#21/#38). Never overwrites
  -- an existing mpn; never writes mpn without a confirm.
  select nullif(btrim(mpn), '') into v_mpn from erp.products where id = v_pid;
  if v_mpn is null and v_code is not null and btrim(v_code) <> '' then
    perform erp.update_product(v_pid, jsonb_build_object('mpn', v_code));
  end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.current_app_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select role from public.profiles where id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION erp.dashboard_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'total',         (select count(*) from erp.products),
    'active',        (select count(*) from erp.products where status='active'),
    'special_order', (select count(*) from erp.products where status='special_order'),
    'inactive',      (select count(*) from erp.products where status='inactive'),
    'discontinued',  (select count(*) from erp.products where status='discontinued'),
    'needs_review',  (select count(*) from erp.products where needs_review),
    'categorized',   (select count(*) from erp.products where category_id is not null),
    'priced',        (select count(*) from erp.products where price is not null),
    'with_image',    (select count(distinct product_id) from erp.product_images),
    'by_status',     (select coalesce(jsonb_agg(jsonb_build_object('label',status::text,'value',n) order by n desc),'[]'::jsonb)
                      from (select status, count(*) n from erp.products group by status) s),
    'by_tag',        (select coalesce(jsonb_agg(jsonb_build_object('label',tag,'value',n) order by n desc),'[]'::jsonb)
                      from (select unnest(review_tags) tag, count(*) n from erp.products where needs_review group by 1) t),
    'top_categories',(select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value) order by value desc),'[]'::jsonb)
                      from (select coalesce(split_part(c.path,' > ',1),'Uncategorized') label, count(*) value
                            from erp.products p left join erp.categories c on c.id=p.category_id
                            group by 1 order by value desc limit 8) tc),
    'top_vendors',   (select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value) order by value desc),'[]'::jsonb)
                      from (select coalesce(v.name,'—') label, count(*) value
                            from erp.products p left join erp.vendors v on v.id=p.vendor_id
                            group by 1 order by value desc limit 8) tv)
  );
$function$;

CREATE OR REPLACE FUNCTION erp.decide_request(p_request_id bigint, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r erp.product_requests; v_closed int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;

  -- ROOT LOCK (COR-08). Was an unlocked `select * into r`.
  select * into r from erp.product_requests where id = p_request_id for update;
  if not found then raise exception 'request % not found', p_request_id; end if;
  if r.status <> 'pending' then raise exception 'request already %', r.status; end if;

  if p_approve then
    if r.type = 'edit' and r.product_id is not null then
      update erp.products set
        name           = case when r.payload ? 'name'           then nullif(r.payload->>'name','')               else name end,
        price          = case when r.payload ? 'price'          then nullif(r.payload->>'price','')::numeric      else price end,
        cost           = case when r.payload ? 'cost'           then nullif(r.payload->>'cost','')::numeric       else cost end,
        base_unit      = case when r.payload ? 'base_unit'      then nullif(r.payload->>'base_unit','')           else base_unit end,
        sf_per_box     = case when r.payload ? 'sf_per_box'     then nullif(r.payload->>'sf_per_box','')::numeric else sf_per_box end,
        pieces_per_box = case when r.payload ? 'pieces_per_box' then nullif(r.payload->>'pieces_per_box','')::int else pieces_per_box end,
        size_in        = case when r.payload ? 'size_in'        then nullif(r.payload->>'size_in','')             else size_in end,
        size_cm        = case when r.payload ? 'size_cm'        then nullif(r.payload->>'size_cm','')             else size_cm end,
        material       = case when r.payload ? 'material'       then nullif(r.payload->>'material','')            else material end,
        finish         = case when r.payload ? 'finish'         then nullif(r.payload->>'finish','')             else finish end,
        mpn            = case when r.payload ? 'mpn'            then nullif(r.payload->>'mpn','')                 else mpn end,
        verified_level = greatest(coalesce(verified_level, 0), 1),  -- v4_56: approved edit => human-reviewed
        updated_at = now()
      where id = r.product_id;
    elsif r.type = 'reactivate' and r.product_id is not null then
      update erp.products set status = 'active', updated_at = now() where id = r.product_id;
    elsif r.type = 'deactivate' and r.product_id is not null then
      update erp.products set status = 'inactive', updated_at = now() where id = r.product_id;
    end if;
    update erp.product_requests
      set status='approved', decided_by=auth.uid(), decided_at=now(), decision_note=p_note
      where id = p_request_id and status = 'pending';
  else
    update erp.product_requests
      set status='rejected', decided_by=auth.uid(), decided_at=now(), decision_note=p_note
      where id = p_request_id and status = 'pending';
  end if;

  -- BELT AND BRACES: 0 rows means someone else decided it while we held the lock. Raise, so the
  -- product edit above rolls back with it rather than being applied a second time.
  get diagnostics v_closed = row_count;
  if v_closed <> 1 then
    raise exception 'request % was decided by a concurrent call — nothing was applied', p_request_id;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.is_below_cost(p_price numeric, p_sell_unit text, p_base_unit text, p_sf_per_box numeric, p_pieces_per_box numeric, p_cost numeric)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when p_cost is null then null
    else erp.price_in_cost_unit(p_price,p_sell_unit,p_base_unit,p_sf_per_box,p_pieces_per_box) < p_cost end
$function$;

CREATE OR REPLACE FUNCTION erp.link_draft_to_product(draft_id bigint, target_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d_mpn text; d_cost numeric; d_sku text; d_status erp.record_status; t_sku text;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  if draft_id = target_id then raise exception 'cannot link to itself'; end if;
  select mpn, cost, sku, record_status into d_mpn, d_cost, d_sku, d_status from erp.products where id = draft_id;
  if d_sku is null then raise exception 'draft % not found', draft_id; end if;
  if d_status <> 'draft' then raise exception 'product % is not a draft', draft_id; end if;
  select sku into t_sku from erp.products where id = target_id;
  if t_sku is null then raise exception 'target % not found', target_id; end if;

  if d_mpn is not null and upper(d_mpn) <> t_sku then
    insert into erp.sku_aliases(old_sku, product_id, reason) values (upper(d_mpn), target_id, 'PO link')
    on conflict (old_sku) do update set product_id = excluded.product_id, reason = 'PO link';
  end if;
  if d_cost is not null then
    update erp.products set cost = d_cost, updated_at = now() where id = target_id;
  end if;
  update erp.products set record_status = 'archived', needs_review = false, updated_at = now() where id = draft_id;
end $function$;

CREATE OR REPLACE FUNCTION erp.list_cycle_counts(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(j order by ca desc), '[]'::jsonb) into r from (
    select cc.created_at as ca, jsonb_build_object(
      'id', cc.id, 'product_id', cc.product_id, 'sku', p.sku, 'name', p.name, 'store_id', cc.store_id,
      'counted_qty', cc.counted_qty, 'system_qty', cc.system_qty, 'variance', cc.variance,
      'tolerance_pct', cc.tolerance_pct, 'status', cc.status, 'counted_at', cc.counted_at, 'reconciled_at', cc.reconciled_at
    ) as j
    from erp.cycle_counts cc join erp.products p on p.id = cc.product_id
    order by cc.created_at desc
    limit greatest(coalesce(p_limit,50),1) offset greatest(coalesce(p_offset,0),0)
  ) s;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION erp.list_purchase_orders(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if coalesce(erp.current_app_role()::text, '') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with po as (
    select p.id, p.po_number, p.vendor_id, p.po_date, p.status, p.currency, p.total, v.name as vendor_name
    from erp.purchase_orders p left join erp.vendors v on v.id = p.vendor_id
    order by p.po_date desc nulls last, p.id desc
    limit greatest(coalesce(p_limit,50),1) offset greatest(coalesce(p_offset,0),0)
  ),
  latest_ack as (
    select distinct on (a.po_id) a.po_id, a.id, a.ack_document_no, a.ack_date, a.total,
      coalesce(a.merchandise_value, a.subtotal,
        a.total - coalesce(a.iva_amount,0) - coalesce(a.freight,0) - coalesce(a.handling,0) - coalesce(a.handling_bonus,0)) as merchandise
    from erp.order_acknowledgments a
    where a.po_id in (select id from po)
    order by a.po_id, coalesce(a.ack_date, a.created_at::date) desc, a.id desc
  ),
  pol as (
    select l.po_id, l.vendor_item_no, l.uom, l.unit_rate, l.qty, l.amount, pr.sf_per_box as prod_sf
    from erp.po_lines l
    join latest_ack la on la.po_id = l.po_id
    left join erp.products pr on pr.id = l.product_id
  ),
  ackl as (
    select la.po_id, al.item_no, al.uom, al.unit_price, al.quantity, al.boxes, al.amount
    from erp.ack_lines al join latest_ack la on la.id = al.ack_id
  ),
  joined as (
    select
      coalesce(p.po_id, a.po_id) as po_id,
      case when p.po_id is null then 'ack_only' when a.po_id is null then 'po_only' else 'matched' end as line_status,
      p.uom as po_uom, p.unit_rate as po_unit_rate, p.qty as po_qty, p.amount as po_amount,
      coalesce(p.prod_sf, case when a.boxes is not null and a.boxes <> 0 then a.quantity / a.boxes end) as sf_per_box,
      a.uom as ack_uom, a.unit_price as ack_unit_price, a.boxes as ack_boxes, a.amount as ack_amount
    from pol p
    full outer join ackl a on a.po_id = p.po_id and upper(btrim(a.item_no)) = upper(btrim(p.vendor_item_no))
  ),
  calc as (
    select j.*,
      case when j.po_unit_rate is null then null
           when upper(coalesce(j.po_uom,'')) = upper(coalesce(j.ack_uom,'')) then j.po_unit_rate
           when j.sf_per_box is not null and j.sf_per_box <> 0 then j.po_unit_rate / j.sf_per_box else null end as puip,
      case when j.po_qty is null then null
           when upper(coalesce(j.po_uom,'')) like 'BOX%' or upper(coalesce(j.po_uom,'')) in ('BX','CJ','CAJA') then j.po_qty
           when j.sf_per_box is not null and j.sf_per_box <> 0 and upper(coalesce(j.po_uom,'')) in ('PI2','SF','SQFT','M2','FT2') then j.po_qty / j.sf_per_box
           else j.po_qty end as pb
    from joined j
  ),
  flags as (
    select po_id, count(*) filter (where
      line_status <> 'matched'
      or (puip is not null and puip <> 0 and ack_unit_price is not null and abs((ack_unit_price - puip)/puip) > 0.01)
      or (pb is not null and pb <> 0 and ack_boxes is not null and abs((ack_boxes - pb)/pb) > 0.01)
      or (po_amount is not null and po_amount <> 0 and ack_amount is not null and abs((ack_amount - po_amount)/po_amount) > 0.01)
    ) as flagged_lines
    from calc group by po_id
  ),
  enriched as (
    select po.*,
      (select count(*) from erp.po_lines l where l.po_id = po.id) as po_line_count,
      (select count(*) from erp.order_acknowledgments a where a.po_id = po.id) as ack_count,
      la.id as ack_id, la.ack_document_no, la.ack_date, la.total as ack_total, la.merchandise as ack_merchandise,
      coalesce(f.flagged_lines, 0) as flagged_lines
    from po
    left join latest_ack la on la.po_id = po.id
    left join flags f on f.po_id = po.id
  )
  select jsonb_build_object(
    'total', (select count(*) from erp.purchase_orders),
    'limit', coalesce(p_limit,50), 'offset', coalesce(p_offset,0),
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'po_number', po_number, 'vendor_id', vendor_id, 'vendor_name', vendor_name,
      'po_date', po_date, 'status', status::text, 'currency', currency, 'total', total,
      'po_line_count', po_line_count, 'ack_count', ack_count, 'ack_id', ack_id,
      'ack_document_no', ack_document_no, 'ack_date', ack_date, 'ack_total', ack_total,
      'total_gap', case when ack_total is not null then ack_total - coalesce(total,0) end,
      'merch_gap', case when ack_merchandise is not null then ack_merchandise - coalesce(total,0) end,
      'flagged_lines', flagged_lines, 'has_discrepancies', flagged_lines > 0
    ) order by po_date desc nulls last, id desc), '[]'::jsonb)
  ) into result from enriched;

  return result;
end $function$;

CREATE OR REPLACE FUNCTION erp.master_import_diff(p_elem jsonb, p_current jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  patch jsonb := '{}'::jsonb; changes jsonb := '[]'::jsonb;
  k text; t text; v_num numeric; v_int int; v_bool boolean; v_date date;
  v_cat bigint; v_vendor bigint; v_tok text; v_old_path text;
  text_keys text[] := array[
    'name','description','discontinue_reason','mpn','material','finish','color1','color2','look',
    'color_observation','substitute_color','style','size_in','size_cm','origin','base_unit','collection',
    'tags','barcode_upc','shopify_handle','seo_title','seo_description','image_url','folder_url','product_url'];
  num_keys text[] := array[
    'price','cost','sf_per_box','weight_per_box_lbs','lbs_per_pallet','moq_group',
    'price_erp','price_sales','price_mgr','price_vol'];
  int_keys text[] := array['pieces_per_box','boxes_per_pallet'];
begin
  foreach k in array text_keys loop
    if p_elem ? k then
      t := nullif(btrim(p_elem->>k),'');
      if t is not null and t is distinct from (p_current->>k) then
        changes := changes || jsonb_build_object('field',k,'from',p_current->>k,'to',t);
        patch   := patch   || jsonb_build_object(k,t);
      end if;
    end if;
  end loop;

  foreach k in array num_keys loop
    if p_elem ? k and nullif(btrim(p_elem->>k),'') is not null then
      v_num := btrim(p_elem->>k)::numeric;
      if v_num < 0 then raise exception '% must be >= 0 (got %)', k, p_elem->>k; end if;
      if v_num is distinct from nullif(p_current->>k,'')::numeric then
        changes := changes || jsonb_build_object('field',k,'from',nullif(p_current->>k,'')::numeric,'to',v_num);
        patch   := patch   || jsonb_build_object(k,v_num::text);
      end if;
    end if;
  end loop;

  foreach k in array int_keys loop
    if p_elem ? k and nullif(btrim(p_elem->>k),'') is not null then
      v_int := btrim(p_elem->>k)::int;
      if v_int < 0 then raise exception '% must be >= 0 (got %)', k, p_elem->>k; end if;
      if v_int is distinct from nullif(p_current->>k,'')::int then
        changes := changes || jsonb_build_object('field',k,'from',nullif(p_current->>k,'')::int,'to',v_int);
        patch   := patch   || jsonb_build_object(k,v_int::text);
      end if;
    end if;
  end loop;

  if p_elem ? 'status' and nullif(btrim(p_elem->>'status'),'') is not null then
    t := btrim(p_elem->>'status')::erp.commercial_status::text;
    if t is distinct from (p_current->>'status') then
      changes := changes || jsonb_build_object('field','status','from',p_current->>'status','to',t);
      patch   := patch   || jsonb_build_object('status',t);
    end if;
  end if;
  if p_elem ? 'product_type' and nullif(btrim(p_elem->>'product_type'),'') is not null then
    t := btrim(p_elem->>'product_type')::erp.product_type::text;
    if t is distinct from (p_current->>'product_type') then
      changes := changes || jsonb_build_object('field','product_type','from',p_current->>'product_type','to',t);
      patch   := patch   || jsonb_build_object('product_type',t);
    end if;
  end if;
  if p_elem ? 'sell_unit' and nullif(btrim(p_elem->>'sell_unit'),'') is not null then
    t := btrim(p_elem->>'sell_unit')::erp.sell_unit::text;
    if t is distinct from (p_current->>'sell_unit') then
      changes := changes || jsonb_build_object('field','sell_unit','from',p_current->>'sell_unit','to',t);
      patch   := patch   || jsonb_build_object('sell_unit',t);
    end if;
  end if;

  if p_elem ? 'price_kind' and nullif(btrim(p_elem->>'price_kind'),'') is not null then
    t := lower(btrim(p_elem->>'price_kind'));
    if t not in ('general','specific') then raise exception 'price_kind must be general|specific (got %)', p_elem->>'price_kind'; end if;
    if t is distinct from (p_current->>'price_kind') then
      changes := changes || jsonb_build_object('field','price_kind','from',p_current->>'price_kind','to',t);
      patch   := patch   || jsonb_build_object('price_kind',t);
    end if;
  end if;
  if p_elem ? 'price_mode' and nullif(btrim(p_elem->>'price_mode'),'') is not null then
    t := lower(btrim(p_elem->>'price_mode'));
    if t not in ('fixed','leveled') then raise exception 'price_mode must be fixed|leveled (got %)', p_elem->>'price_mode'; end if;
    if t is distinct from (p_current->>'price_mode') then
      changes := changes || jsonb_build_object('field','price_mode','from',p_current->>'price_mode','to',t);
      patch   := patch   || jsonb_build_object('price_mode',t);
    end if;
  end if;

  if p_elem ? 'taxable' and nullif(btrim(p_elem->>'taxable'),'') is not null then
    t := lower(btrim(p_elem->>'taxable'));
    v_bool := case when t in ('true','t','yes','y','1') then true
                   when t in ('false','f','no','n','0') then false else null end;
    if v_bool is null then raise exception 'taxable must be yes/no (got %)', p_elem->>'taxable'; end if;
    if v_bool is distinct from nullif(p_current->>'taxable','')::boolean then
      changes := changes || jsonb_build_object('field','taxable','from',nullif(p_current->>'taxable','')::boolean,'to',v_bool);
      patch   := patch   || jsonb_build_object('taxable',v_bool::text);
    end if;
  end if;

  if p_elem ? 'date_added' and nullif(btrim(p_elem->>'date_added'),'') is not null then
    v_date := btrim(p_elem->>'date_added')::date;
    if v_date is distinct from nullif(p_current->>'date_added','')::date then
      changes := changes || jsonb_build_object('field','date_added','from',p_current->>'date_added','to',v_date::text);
      patch   := patch   || jsonb_build_object('date_added',v_date::text);
    end if;
  end if;

  if p_elem ? 'category_path' and nullif(btrim(p_elem->>'category_path'),'') is not null then
    select id into v_cat from erp.categories where path = btrim(p_elem->>'category_path');
    if v_cat is null then raise exception 'unknown category "%"', btrim(p_elem->>'category_path'); end if;
    if v_cat is distinct from nullif(p_current->>'category_id','')::bigint then
      select path into v_old_path from erp.categories where id = nullif(p_current->>'category_id','')::bigint;
      changes := changes || jsonb_build_object('field','category_path','from',v_old_path,'to',btrim(p_elem->>'category_path'));
      patch   := patch   || jsonb_build_object('category_id',v_cat::text);
    end if;
  end if;

  if p_elem ? 'vendor_name' and nullif(btrim(p_elem->>'vendor_name'),'') is not null then
    select id into v_vendor from erp.vendors where name = btrim(p_elem->>'vendor_name');
    if v_vendor is null then raise exception 'unknown vendor "%"', btrim(p_elem->>'vendor_name'); end if;
    if v_vendor is distinct from nullif(p_current->>'vendor_id','')::bigint then
      changes := changes || jsonb_build_object('field','vendor_name',
                   'from',(select name from erp.vendors where id = nullif(p_current->>'vendor_id','')::bigint),
                   'to',btrim(p_elem->>'vendor_name'));
      patch   := patch   || jsonb_build_object('vendor_id',v_vendor::text);
    end if;
  end if;

  foreach k in array array['bros','cuz','subs'] loop
    if p_elem ? k then
      t := nullif(btrim(p_elem->>k),'');
      if t is not null then
        foreach v_tok in array regexp_split_to_array(upper(t), '[,;[:space:]]+') loop
          if v_tok <> '' and not exists (select 1 from erp.products where sku = v_tok) then
            raise exception 'unknown % target "%"', k, v_tok;
          end if;
        end loop;
        if t is distinct from (p_current->>k) then
          changes := changes || jsonb_build_object('field',k,'from',p_current->>k,'to',t);
          patch   := patch   || jsonb_build_object(k,t);
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('patch', patch, 'changes', changes);
end $function$;

CREATE OR REPLACE FUNCTION erp.match_product_by_mpn(p_mpn text, p_vendor_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pid from (
    select product_id as pid, 1 as rank from erp.vendor_skus
      where p_vendor_id is not null and product_id is not null
        and vendor_id = p_vendor_id and upper(vendor_sku) = upper(btrim(p_mpn))
    union all
    select product_id, 2 from erp.vendor_skus
      where product_id is not null and upper(vendor_sku) = upper(btrim(p_mpn))
    union all
    select id, 3 from erp.products
      where upper(mpn) = upper(btrim(p_mpn))
  ) m
  where nullif(btrim(p_mpn), '') is not null
  order by rank
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION erp.merge_products(survivor_id bigint, loser_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare loser_sku text; surv_tags text[];
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  if survivor_id = loser_id then raise exception 'survivor and loser must differ'; end if;
  select sku into loser_sku from erp.products where id = loser_id;
  if loser_sku is null then raise exception 'loser % not found', loser_id; end if;
  if not exists (select 1 from erp.products where id = survivor_id) then raise exception 'survivor % not found', survivor_id; end if;

  update erp.products set record_status='archived', needs_review=false, updated_at=now() where id = loser_id;

  insert into erp.sku_aliases(old_sku, product_id, reason)
  values (loser_sku, survivor_id, 'merge')
  on conflict (old_sku) do update set product_id = excluded.product_id, reason = 'merge';

  select array_remove(array_remove(review_tags,'POSSIBLE DUP'),'MERGE') into surv_tags from erp.products where id = survivor_id;
  update erp.products
    set review_tags = surv_tags,
        needs_review = (coalesce(array_length(surv_tags,1),0) > 0),
        updated_at = now()
    where id = survivor_id;
end $function$;

CREATE OR REPLACE FUNCTION erp.negative_balances()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', sp.product_id, 'sku', p.sku, 'name', p.name, 'store_id', sp.store_id, 'qoh', sp.qoh
  ) order by sp.qoh asc), '[]'::jsonb) into r
  from erp.store_products sp join erp.products p on p.id = sp.product_id
  where coalesce(sp.qoh,0) < 0;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION erp.po_receiving_detail(p_po_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  select jsonb_build_object(
    'po_id', po.id, 'po_number', po.po_number, 'status', po.status, 'vendor_name', v.name,
    'currency', po.currency, 'store_id', po.store_id,
    'ack_freight', (select oa.freight from erp.order_acknowledgments oa where oa.po_id = po.id order by oa.id limit 1),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'po_line_id', pl.id, 'line_no', pl.line_no, 'vendor_item_no', pl.vendor_item_no,
        'product_id', pl.product_id, 'sku', pr.sku, 'name', pr.name, 'description', pl.description,
        'uom', pl.uom, 'qty', pl.qty, 'unit_rate', pl.unit_rate, 'amount', pl.amount,
        'received_qty', coalesce(pl.received_qty,0), 'remaining', coalesce(pl.qty,0) - coalesce(pl.received_qty,0)
      ) order by pl.line_no)
      from erp.po_lines pl left join erp.products pr on pr.id = pl.product_id where pl.po_id = po.id), '[]'::jsonb)
  ) into r
  from erp.purchase_orders po left join erp.vendors v on v.id = po.vendor_id
  where po.id = p_po_id;
  if r is null then raise exception 'PO % not found', p_po_id using errcode='P0002'; end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION erp.po_recon_rows(p_po_id bigint, p_price_tol numeric DEFAULT 0.01, p_qty_tol numeric DEFAULT 0.01, p_total_tol numeric DEFAULT 0.01)
 RETURNS TABLE(mpn text, description text, sf_per_box numeric, line_status text, po_line_no integer, po_qty numeric, po_uom text, po_unit_rate numeric, po_amount numeric, po_unit_per_pi2 numeric, po_boxes numeric, ack_line_no integer, ack_uom text, ack_quantity numeric, ack_boxes numeric, ack_unit_price numeric, ack_amount numeric, price_pct numeric, price_flag boolean, qty_diff numeric, qty_pct numeric, qty_flag boolean, total_diff numeric, total_pct numeric, total_flag boolean, product_id bigint, po_line_id bigint, ack_line_id bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare v_ack_id bigint;
begin
  if coalesce(erp.current_app_role()::text, '') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select a.id into v_ack_id from erp.order_acknowledgments a
   where a.po_id = p_po_id order by coalesce(a.ack_date, a.created_at::date) desc, a.id desc limit 1;

  return query
  with pol as (
    select l.*, pr.sf_per_box as prod_sf
    from erp.po_lines l left join erp.products pr on pr.id = l.product_id
    where l.po_id = p_po_id
  ),
  ackl as ( select l.* from erp.ack_lines l where l.ack_id = v_ack_id ),
  joined as (
    select
      coalesce(p.vendor_item_no, a.item_no) as mpn,
      coalesce(p.description, a.description) as description,
      coalesce(p.prod_sf, case when a.boxes is not null and a.boxes <> 0 then a.quantity / a.boxes end) as sf_per_box,
      case when p.id is null then 'ack_only' when a.id is null then 'po_only' else 'matched' end as line_status,
      p.line_no as po_line_no, p.qty as po_qty, p.uom as po_uom, p.unit_rate as po_unit_rate, p.amount as po_amount,
      a.line_no as ack_line_no, a.uom as ack_uom, a.quantity as ack_quantity, a.boxes as ack_boxes,
      a.unit_price as ack_unit_price, a.amount as ack_amount,
      p.product_id as product_id, p.id as po_line_id, a.id as ack_line_id
    from pol p
    full outer join ackl a on upper(btrim(a.item_no)) = upper(btrim(p.vendor_item_no))
  ),
  calc as (
    select j.*,
      case
        when j.po_unit_rate is null then null
        when upper(coalesce(j.po_uom,'')) = upper(coalesce(j.ack_uom,'')) then j.po_unit_rate
        when j.sf_per_box is not null and j.sf_per_box <> 0 then j.po_unit_rate / j.sf_per_box
        else null
      end as po_unit_per_pi2,
      case
        when j.po_qty is null then null
        when upper(coalesce(j.po_uom,'')) like 'BOX%' or upper(coalesce(j.po_uom,'')) in ('BX','CJ','CAJA') then j.po_qty
        when j.sf_per_box is not null and j.sf_per_box <> 0
             and upper(coalesce(j.po_uom,'')) in ('PI2','SF','SQFT','M2','FT2') then j.po_qty / j.sf_per_box
        else j.po_qty
      end as po_boxes
    from joined j
  )
  select
    c.mpn, c.description, c.sf_per_box, c.line_status,
    c.po_line_no, c.po_qty, c.po_uom, c.po_unit_rate, c.po_amount, c.po_unit_per_pi2, c.po_boxes,
    c.ack_line_no, c.ack_uom, c.ack_quantity, c.ack_boxes, c.ack_unit_price, c.ack_amount,
    case when c.po_unit_per_pi2 is not null and c.po_unit_per_pi2 <> 0 and c.ack_unit_price is not null
         then (c.ack_unit_price - c.po_unit_per_pi2) / c.po_unit_per_pi2 end,
    (c.po_unit_per_pi2 is not null and c.po_unit_per_pi2 <> 0 and c.ack_unit_price is not null
         and abs((c.ack_unit_price - c.po_unit_per_pi2) / c.po_unit_per_pi2) > p_price_tol),
    case when c.po_boxes is not null and c.ack_boxes is not null then c.ack_boxes - c.po_boxes end,
    case when c.po_boxes is not null and c.po_boxes <> 0 and c.ack_boxes is not null
         then (c.ack_boxes - c.po_boxes) / c.po_boxes end,
    (c.po_boxes is not null and c.po_boxes <> 0 and c.ack_boxes is not null
         and abs((c.ack_boxes - c.po_boxes) / c.po_boxes) > p_qty_tol),
    case when c.po_amount is not null and c.ack_amount is not null then c.ack_amount - c.po_amount end,
    case when c.po_amount is not null and c.po_amount <> 0 and c.ack_amount is not null
         then (c.ack_amount - c.po_amount) / c.po_amount end,
    (c.po_amount is not null and c.po_amount <> 0 and c.ack_amount is not null
         and abs((c.ack_amount - c.po_amount) / c.po_amount) > p_total_tol),
    c.product_id, c.po_line_id, c.ack_line_id
  from calc c
  order by coalesce(c.po_line_no, c.ack_line_no), c.mpn;
end $function$;

CREATE OR REPLACE FUNCTION erp.prevent_movement_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'inventory_movements is append-only (no % allowed)', tg_op using errcode = '0A000';
end $function$;

CREATE OR REPLACE FUNCTION erp.price_in_cost_unit(p_price numeric, p_sell_unit text, p_base_unit text, p_sf_per_box numeric, p_pieces_per_box numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_price is null then null
    when nullif(btrim(coalesce(p_sell_unit,'')),'') is not null
         and lower(btrim(p_sell_unit)) = lower(btrim(coalesce(p_base_unit,''))) then p_price
    when p_sell_unit = 'sqft'  then case when coalesce(p_sf_per_box,0)     > 0 then p_price * p_sf_per_box     end
    when p_sell_unit = 'piece' then case when coalesce(p_pieces_per_box,0) > 0 then p_price * p_pieces_per_box end
    else p_price
  end
$function$;

CREATE OR REPLACE FUNCTION erp.product_vocabulary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out jsonb;
begin
  if coalesce(erp.current_app_role()::text, '') not in ('admin','manager','staff') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'base_unit', coalesce((select jsonb_agg(distinct base_unit order by base_unit)
                             from erp.products
                            where base_unit is not null and btrim(base_unit) <> ''), '[]'::jsonb),
    'material',  coalesce((select jsonb_agg(distinct material order by material)
                             from erp.products
                            where material is not null and btrim(material) <> ''), '[]'::jsonb),
    'finish',    coalesce((select jsonb_agg(distinct finish order by finish)
                             from erp.products
                            where finish is not null and btrim(finish) <> ''), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION erp.publish_product(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(erp.current_app_role()::text,'') <> 'admin' then raise exception 'only admin can publish' using errcode = '42501'; end if;
  update erp.products
    set record_status='published', approved_by=auth.uid(), approved_at=now(), updated_at=now()
    where id = p_id;
  if not found then raise exception 'product % not found', p_id; end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.purchasing_groups(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with base as materialized (
    select p.id, p.sku, p.name, p.product_type, p.cost, p.size_in, p.color1, p.color2,
           p.finish, p.material, p.bros,
           v.name as vendor_name, v.lead_time_days, v.min_order,
           nullif(split_part(coalesce(c.path,''), ' > ', 2), '') as l2,
           case when nullif(btrim(p.bros),'') is not null
                then 'fam:' || lower(btrim(p.bros))
                else lower(coalesce(p.product_type::text,'')) || '|'
                  || lower(regexp_replace(coalesce(p.size_in,''), '\s', '', 'g')) || '|'
                  || lower(coalesce(split_part(coalesce(c.path,''),' > ',2),'')) || '|'
                  || lower(coalesce(btrim(p.color1),'')) || '|'
                  || lower(coalesce(btrim(p.color2),'')) || '|'
                  || lower(coalesce(btrim(p.finish),'')) || '|'
                  || lower(coalesce(btrim(p.material),''))
           end as group_key
    from erp.products p
    left join erp.vendors v on v.id = p.vendor_id
    left join erp.categories c on c.id = p.category_id
    where p.record_status = 'published'
      and (
        nullif(btrim(p.bros),'') is not null
        or (nullif(btrim(p.size_in),'') is not null and (
              nullif(btrim(p.color1),'') is not null or nullif(btrim(p.color2),'') is not null
              or nullif(btrim(p.finish),'') is not null or nullif(btrim(p.material),'') is not null
        ))
      )
  ),
  store_agg as materialized (
    select product_id, sum(qoh) as qoh, max(moq) as moq, max(reorder_point) as reorder_point,
           max(min_level) as min_level, max(max_level) as max_level
    from erp.store_products group by product_id
  ),
  last_ph as materialized (
    select distinct on (product_id) product_id, price as last_price, effective_from as last_price_date
    from erp.price_history order by product_id, effective_from desc
  ),
  grp as (
    select group_key, count(*) as n from base group by group_key having count(*) > 1
  ),
  page as (
    select group_key, n from grp order by n desc, group_key
    limit greatest(coalesce(p_limit,25),1) offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'total_groups', (select count(*) from grp),
    'total_grouped_products', (select coalesce(sum(n),0) from grp),
    'limit', coalesce(p_limit,25),
    'offset', coalesce(p_offset,0),
    'groups', coalesce(jsonb_agg(grp_obj order by n desc, group_key), '[]'::jsonb)
  )
  into result
  from (
    select pg.group_key, pg.n,
      jsonb_build_object(
        'group_key', pg.group_key,
        'member_count', pg.n,
        'label', coalesce(
          nullif(btrim((select concat_ws(' ', b.l2, b.size_in, b.color1, b.finish, b.material)
                        from base b where b.group_key = pg.group_key order by b.id limit 1)), ''),
          (select b.name from base b where b.group_key = pg.group_key order by b.id limit 1)),
        'members', (
          select jsonb_agg(
            jsonb_build_object(
              'id', b.id, 'sku', b.sku, 'name', b.name, 'vendor', b.vendor_name,
              'cost', b.cost,
              'last_price', lp.last_price, 'last_price_date', lp.last_price_date,
              'lead_time_days', b.lead_time_days,
              'moq', coalesce(sa.moq, b.min_order),
              'qoh', sa.qoh,
              'reorder_point', sa.reorder_point, 'min_level', sa.min_level, 'max_level', sa.max_level,
              'size_in', b.size_in, 'shape', b.l2,
              'color', nullif(concat_ws(' / ', nullif(btrim(b.color1),''), nullif(btrim(b.color2),'')), ''),
              'finish', b.finish, 'material', b.material,
              'image', (select pi.storage_path from erp.product_images pi where pi.product_id = b.id and pi.sort_order = 0 limit 1)
            ) order by b.cost asc nulls last
          )
          from base b
          left join store_agg sa on sa.product_id = b.id
          left join last_ph lp on lp.product_id = b.id
          where b.group_key = pg.group_key
        )
      ) as grp_obj
    from page pg
  ) z;

  return result;
end $function$;

CREATE OR REPLACE FUNCTION erp.qoh_drift_alert()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_payload jsonb; v_run timestamptz; v_key text; v_to text; v_from text; v_req bigint;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_payload := erp.qoh_drift_alert_build();
  if v_payload is null then
    return jsonb_build_object('sent', false, 'reason', 'no_drift');
  end if;
  v_run := (v_payload->>'run_at')::timestamptz;

  if exists (select 1 from erp.qoh_alert_log where run_at = v_run) then
    return jsonb_build_object('sent', false, 'reason', 'already_alerted', 'run_at', v_run);
  end if;

  select decrypted_secret into v_key  from vault.decrypted_secrets where name = 'resend_api_key'  limit 1;
  select decrypted_secret into v_to   from vault.decrypted_secrets where name = 'qoh_alert_email' limit 1;
  select decrypted_secret into v_from from vault.decrypted_secrets where name = 'qoh_alert_from'  limit 1;
  v_from := coalesce(v_from, 'RTG ERP <onboarding@resend.dev>');
  if v_key is null or v_to is null then
    return jsonb_build_object('sent', false, 'reason', 'missing_secret',
      'detail', 'set resend_api_key and qoh_alert_email in Supabase Vault',
      'drift_rows', v_payload->'drift_rows');
  end if;

  select net.http_post(
    'https://api.resend.com/emails',
    jsonb_build_object('from', v_from, 'to', jsonb_build_array(v_to),
                       'subject', v_payload->>'subject', 'html', v_payload->>'html'),
    '{}'::jsonb,
    jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json')
  ) into v_req;

  insert into erp.qoh_alert_log(run_at, drift_rows, store_count, net_request_id)
    values (v_run, (v_payload->>'drift_rows')::int, (v_payload->>'store_count')::int, v_req);

  return jsonb_build_object('sent', true, 'reason', 'sent', 'run_at', v_run,
    'drift_rows', v_payload->'drift_rows', 'net_request_id', v_req);
end $function$;

CREATE OR REPLACE FUNCTION erp.qoh_drift_alert_build()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_run timestamptz; v_n int; v_stores int; v_rows_html text; v_html text;
begin
  if not (
    coalesce(erp.current_app_role()::text,'') in ('admin','manager')
    or coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','') = 'service_role'
  ) then raise exception 'not authorized' using errcode = '42501'; end if;

  select max(run_at) into v_run from erp.qoh_reconcile_log where repaired = false;
  if v_run is null then return null; end if;

  select count(*), count(distinct store_id) into v_n, v_stores
  from erp.qoh_reconcile_log where repaired = false and run_at = v_run;
  if coalesce(v_n,0) = 0 then return null; end if;

  select string_agg(
    format('<tr><td>%s</td><td>%s</td><td align="right">%s</td><td align="right">%s</td><td align="right">%s</td></tr>',
           store_id, product_id, cached_qoh, derived_qoh, diff), '' order by ord)
  into v_rows_html
  from (
    select store_id, product_id, cached_qoh, derived_qoh, diff,
           row_number() over (order by abs(diff) desc nulls last, store_id, product_id) as ord
    from erp.qoh_reconcile_log
    where repaired = false and run_at = v_run
    order by abs(diff) desc nulls last, store_id, product_id
    limit 10
  ) t;

  v_html := format(
$h$<div style="font-family:system-ui,Arial,sans-serif;font-size:14px">
<h2 style="margin:0 0 8px">⚠️ QOH cache drift detected</h2>
<p>The weekly QOH reconcile (%s UTC) found <b>%s</b> drifted (store, product) row(s) across <b>%s</b> store(s).</p>
<p>The append-only ledger (inventory_movements) is the source of truth; store_products.qoh is out of sync. Repair with <code>select erp.reconcile_qoh_repair();</code> (manager), then investigate the cause.</p>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #ddd;font-size:13px">
<thead><tr style="background:#f6f6f6"><th align="left">store</th><th align="left">product_id</th><th align="right">cached_qoh</th><th align="right">derived_qoh</th><th align="right">diff</th></tr></thead>
<tbody>%s</tbody></table>
<p style="color:#888;font-size:12px">Worst %s of %s row(s) by |diff|. Full detail in qoh_reconcile_log (run_at %s).</p></div>$h$,
    to_char(v_run,'YYYY-MM-DD HH24:MI'), v_n, v_stores, v_rows_html, least(v_n,10), v_n,
    to_char(v_run,'YYYY-MM-DD HH24:MI:SS'));

  return jsonb_build_object(
    'run_at', v_run,
    'drift_rows', v_n,
    'store_count', v_stores,
    'subject', format('⚠️ RTG ERP — QOH cache drift: %s row(s)', v_n),
    'html', v_html
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.receive_manual(p_product_id bigint, p_store_id text, p_qty numeric, p_base_cost numeric DEFAULT NULL::numeric, p_freight_cost numeric DEFAULT 0, p_duty_cost numeric DEFAULT 0, p_lot_number text DEFAULT NULL::text, p_received_date date DEFAULT NULL::date, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_lot bigint; v_landed numeric;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'receive qty must be greater than zero (got %) — use adjust_inventory to reduce on-hand', p_qty
      using errcode='P0001';
  end if;
  if not exists (select 1 from erp.products p where p.id = p_product_id) then raise exception 'product % not found', p_product_id using errcode='P0002'; end if;
  if p_store_id is null or not exists (select 1 from erp.stores s where s.id = p_store_id) then raise exception 'store % not found', p_store_id using errcode='P0002'; end if;
  v_landed := round(coalesce(p_base_cost,0) + coalesce(p_freight_cost,0) + coalesce(p_duty_cost,0), 4);
  insert into erp.lots (product_id, lot_number, received_date, status, base_cost, freight_cost, duty_cost, landed_cost)
  values (p_product_id, coalesce(p_lot_number, 'MAN-'||to_char(now(),'YYYYMMDDHH24MISS')), coalesce(p_received_date, current_date),
          'available', round(coalesce(p_base_cost,0),4), round(coalesce(p_freight_cost,0),4), round(coalesce(p_duty_cost,0),4), v_landed)
  returning id into v_lot;
  insert into erp.inventory_movements (product_id, lot_id, store_id, qty_delta, reason, reference, actor)
  values (p_product_id, v_lot, p_store_id, p_qty, 'receive', coalesce(p_reference,'manual receive'), auth.uid());
  return jsonb_build_object('lot_id', v_lot, 'product_id', p_product_id, 'store_id', p_store_id, 'qty', p_qty, 'landed_cost', v_landed);
end $function$;

CREATE OR REPLACE FUNCTION erp.receive_po(p_po_id bigint, p_store_id text, p_receipts jsonb, p_freight_total numeric DEFAULT NULL::numeric, p_duty_total numeric DEFAULT NULL::numeric, p_receipt_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_po erp.purchase_orders%rowtype;
  v_freight numeric; v_duty numeric; v_order_ext numeric;
  v_rec jsonb; v_line erp.po_lines%rowtype; v_qty numeric; v_remaining numeric;
  v_line_ext numeric; v_base numeric; v_freight_pu numeric; v_duty_pu numeric; v_landed numeric;
  v_lot bigint; v_results jsonb := '[]'::jsonb; v_n int := 0; v_total numeric := 0;
  v_all_recv boolean; v_any_recv boolean; v_status erp.po_status;
  v_key text; v_receipt_id bigint; v_prev erp.po_receipts%rowtype; v_out jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode='42501';
  end if;

  v_key := nullif(btrim(p_receipt_key), '');

  -- IDEMPOTENCY (COR-02/COR-03). A repeat with the same key returns the ORIGINAL result and posts
  -- nothing. The claim is inserted before any work: a concurrent duplicate blocks on the unique
  -- index, then finds the committed row and replays it. `on conflict do nothing` returning no row is
  -- exactly that case.
  if v_key is not null then
    select * into v_prev from erp.po_receipts where receipt_key = v_key;
    if found then
      if v_prev.po_id <> p_po_id then
        raise exception 'receipt key % was already used for PO % — keys must be unique per receipt',
          v_key, v_prev.po_id using errcode='P0001';
      end if;
      return v_prev.result || jsonb_build_object('replayed', true);
    end if;
  end if;

  -- Serialize every receive against this PO. Taken before the PO row is read so the status check,
  -- the per-line caps and the end-of-call status recompute all see one consistent picture.
  perform pg_advisory_xact_lock(hashtextextended('erp.purchase_orders:receive:' || p_po_id::text, 0));

  select * into v_po from erp.purchase_orders where id = p_po_id;
  if not found then raise exception 'PO % not found', p_po_id using errcode='P0002'; end if;
  if p_store_id is null or not exists (select 1 from erp.stores s where s.id = p_store_id) then
    raise exception 'receiving store % not found', p_store_id using errcode='P0002'; end if;

  -- STATUS GUARD (COR-02): a draft PO is not yet a commitment, a closed one is terminal.
  if v_po.status in ('draft','closed') then
    raise exception 'PO % is % — cannot receive against it', coalesce(v_po.po_number, p_po_id::text), v_po.status
      using errcode='P0001';
  end if;

  if v_key is not null then
    insert into erp.po_receipts (receipt_key, po_id, store_id, actor, result)
      values (v_key, p_po_id, p_store_id, auth.uid(), '{}'::jsonb)
      on conflict (receipt_key) do nothing
      returning id into v_receipt_id;
    if v_receipt_id is null then
      -- a concurrent call claimed the same key and has now committed
      select * into v_prev from erp.po_receipts where receipt_key = v_key;
      if found then return v_prev.result || jsonb_build_object('replayed', true); end if;
      raise exception 'could not claim receipt key %', v_key using errcode='P0001';
    end if;
  end if;

  v_freight := coalesce(p_freight_total, (select oa.freight from erp.order_acknowledgments oa where oa.po_id = p_po_id order by oa.id limit 1), 0);
  v_duty := coalesce(p_duty_total, 0);
  select coalesce(sum(coalesce(pl.amount, pl.qty*pl.unit_rate, 0)),0) into v_order_ext from erp.po_lines pl where pl.po_id = p_po_id;

  for v_rec in select value from jsonb_array_elements(coalesce(p_receipts,'[]'::jsonb)) loop
    v_qty := coalesce((v_rec->>'qty')::numeric, 0);
    -- A negative receipt is a caller bug, not a return: reject rather than silently skip (COR-03).
    if v_qty < 0 then
      raise exception 'receive qty must not be negative (PO line %, got %)', v_rec->>'po_line_id', v_qty
        using errcode='P0001';
    end if;
    if v_qty = 0 then continue; end if;   -- an untouched line on the receiving form

    -- FOR UPDATE before reading received_qty: two concurrent receives of the same line serialize
    -- here, so the remaining-qty check below cannot be computed against a stale value.
    select * into v_line from erp.po_lines
      where id = (v_rec->>'po_line_id')::bigint and po_id = p_po_id for update;
    if not found then raise exception 'PO line % is not on PO %', v_rec->>'po_line_id', p_po_id using errcode='P0002'; end if;
    if v_line.product_id is null then raise exception 'PO line % has no linked product — link it first', v_line.id using errcode='P0001'; end if;

    -- OVER-RECEIPT CAP (COR-02). NULL qty is handled explicitly: previously such a line counted as
    -- fully received via `0 >= 0` and could absorb an unbounded receipt.
    if v_line.qty is null then
      raise exception 'PO line % has no ordered qty — set the line qty before receiving against it', v_line.id
        using errcode='P0001';
    end if;
    v_remaining := v_line.qty - v_line.received_qty;
    if v_qty > v_remaining then
      raise exception 'over-receipt on PO % line %: tried to receive %, only % remaining (ordered %, already received %)',
        coalesce(v_po.po_number, p_po_id::text), coalesce(v_line.line_no, v_line.id), v_qty, v_remaining,
        v_line.qty, v_line.received_qty using errcode='P0001';
    end if;

    v_line_ext := coalesce(v_line.amount, v_line.qty*v_line.unit_rate, 0);
    v_base := coalesce(v_line.unit_rate, case when coalesce(v_line.qty,0)<>0 then v_line.amount/v_line.qty end, 0);
    v_freight_pu := case when v_order_ext > 0 and coalesce(v_line.qty,0) > 0 then (v_freight * v_line_ext / v_order_ext) / v_line.qty else 0 end;
    v_duty_pu := case when v_order_ext > 0 and coalesce(v_line.qty,0) > 0 then (v_duty * v_line_ext / v_order_ext) / v_line.qty else 0 end;
    v_landed := round(coalesce(v_base,0) + v_freight_pu + v_duty_pu, 4);

    insert into erp.lots (product_id, lot_number, received_date, status, base_cost, freight_cost, duty_cost, landed_cost)
    values (v_line.product_id,
            coalesce(v_po.po_number,'PO')||'-L'||coalesce(v_line.line_no::text, v_line.id::text)||'-'||to_char(now(),'YYYYMMDDHH24MISS'),
            current_date, 'available', round(coalesce(v_base,0),4), round(v_freight_pu,4), round(v_duty_pu,4), v_landed)
    returning id into v_lot;

    insert into erp.inventory_movements (product_id, lot_id, store_id, qty_delta, reason, reference, actor)
    values (v_line.product_id, v_lot, p_store_id, v_qty, 'receive',
            'PO '||coalesce(v_po.po_number,p_po_id::text)||' line '||coalesce(v_line.line_no::text,v_line.id::text), auth.uid());

    update erp.po_lines set received_qty = received_qty + v_qty where id = v_line.id;

    v_n := v_n + 1; v_total := v_total + v_qty;
    v_results := v_results || jsonb_build_object('po_line_id', v_line.id, 'product_id', v_line.product_id,
                   'lot_id', v_lot, 'qty', v_qty, 'landed_cost', v_landed);
  end loop;

  -- Status recompute. `qty is not null and …` closes the COR-02 NULL-qty hole: a line with no ordered
  -- qty is NOT fully received (it used to satisfy `0 >= 0` and could flip a PO to 'received').
  select bool_and(qty is not null and received_qty >= qty), bool_or(received_qty > 0)
    into v_all_recv, v_any_recv from erp.po_lines where po_id = p_po_id;
  if v_all_recv then v_status := 'received';
  elsif v_any_recv then v_status := 'partial';
  else v_status := v_po.status; end if;
  if v_status is distinct from v_po.status then
    update erp.purchase_orders set status = v_status, updated_at = now() where id = p_po_id;
  end if;

  v_out := jsonb_build_object('po_id', p_po_id, 'po_status', v_status, 'lots_created', v_n,
    'total_qty', v_total, 'freight_total', v_freight, 'duty_total', v_duty, 'received', v_results,
    'receipt_key', v_key);
  if v_receipt_id is not null then
    update erp.po_receipts set result = v_out where id = v_receipt_id;
  end if;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION erp.reconcile_cycle_count(p_count_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c erp.cycle_counts%rowtype; v_current numeric; v_delta numeric; v_mov bigint; v_closed int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;

  -- ROOT LOCK. Everything below is decided against the row version we are holding.
  select * into c from erp.cycle_counts where id = p_count_id for update;
  if not found then raise exception 'cycle count % not found', p_count_id using errcode='P0002'; end if;
  if c.status <> 'open' then raise exception 'cycle count % is already %', p_count_id, c.status using errcode='P0001'; end if;

  -- CHILD LOCK: freeze the on-hand the variance is measured against. A missing store_products row is
  -- still legal (never-stocked pair) and reads as 0, exactly as before.
  select coalesce(sp.qoh,0) into v_current
    from erp.store_products sp
   where sp.store_id = c.store_id and sp.product_id = c.product_id
     for update;
  v_current := coalesce(v_current,0);
  v_delta := c.counted_qty - v_current;
  if v_delta <> 0 then
    insert into erp.inventory_movements (product_id, store_id, qty_delta, reason, reference, actor)
    values (c.product_id, c.store_id, v_delta, 'count_adjustment', 'cycle count #'||c.id, auth.uid())
    returning id into v_mov;
  end if;
  -- a physical count verifies on-hand (clears the unverified opening balance) for this product/store
  update erp.store_products set qoh_verified = true where store_id=c.store_id and product_id=c.product_id;

  -- BELT AND BRACES: the close carries the state the guard checked. If this ever writes 0 rows the
  -- lock did not hold, and raising rolls the whole call back — the movement above included.
  update erp.cycle_counts set status='reconciled', system_qty=v_current, variance=(c.counted_qty - v_current),
    reconciled_by=auth.uid(), reconciled_at=now()
   where id = c.id and status = 'open';
  get diagnostics v_closed = row_count;
  if v_closed <> 1 then
    raise exception 'cycle count % was reconciled by a concurrent call — nothing was posted', p_count_id using errcode='P0001';
  end if;

  return jsonb_build_object('count_id', c.id, 'delta_posted', v_delta, 'movement_id', v_mov,
    'new_qoh', c.counted_qty, 'verified', true);
end $function$;

CREATE OR REPLACE FUNCTION erp.reconcile_po(p_po_id bigint, p_price_tol numeric DEFAULT 0.01, p_qty_tol numeric DEFAULT 0.01, p_total_tol numeric DEFAULT 0.01)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_po jsonb; v_ack jsonb; v_lines jsonb; v_summary jsonb; v_ack_id bigint; v_pot numeric; v_at numeric; v_merch numeric; v_acks jsonb;
begin
  if coalesce(erp.current_app_role()::text, '') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select to_jsonb(x) into v_po from (
    select po.id, po.po_number, po.vendor_id, v.name as vendor_name, po.store_id, po.po_date,
           po.buyer_user, po.currency, po.status::text as status, po.ship_to_name, po.ship_to_address,
           po.total, po.notes, po.source_pdf_ref
    from erp.purchase_orders po left join erp.vendors v on v.id = po.vendor_id
    where po.id = p_po_id
  ) x;
  if v_po is null then raise exception 'purchase order % not found', p_po_id; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'ack_document_no', a.ack_document_no, 'ack_date', a.ack_date, 'total', a.total)
           order by coalesce(a.ack_date, a.created_at::date) desc, a.id desc), '[]'::jsonb)
    into v_acks from erp.order_acknowledgments a where a.po_id = p_po_id;

  select a.id into v_ack_id from erp.order_acknowledgments a
   where a.po_id = p_po_id order by coalesce(a.ack_date, a.created_at::date) desc, a.id desc limit 1;

  select to_jsonb(y) into v_ack from (
    select a.id, a.ack_document_no, a.ack_date, a.valid_from, a.valid_to, a.order_type, a.customer_no,
           a.currency, a.incoterm, a.payment_terms, a.salesperson, a.specifier, a.ship_to_name, a.ship_to_address,
           a.merchandise_value, a.handling, a.handling_bonus, a.freight, a.subtotal, a.iva_pct, a.iva_amount,
           a.total, a.special_instructions, a.source_pdf_ref
    from erp.order_acknowledgments a where a.id = v_ack_id
  ) y;

  with r as (
    select * from erp.po_recon_rows(p_po_id, p_price_tol, p_qty_tol, p_total_tol)
  )
  select
    coalesce(jsonb_agg(to_jsonb(r) order by coalesce(r.po_line_no, r.ack_line_no)), '[]'::jsonb),
    jsonb_build_object(
      'line_count', count(*),
      'matched', count(*) filter (where r.line_status = 'matched'),
      'po_only', count(*) filter (where r.line_status = 'po_only'),
      'ack_only', count(*) filter (where r.line_status = 'ack_only'),
      'price_flags', count(*) filter (where r.price_flag),
      'qty_flags', count(*) filter (where r.qty_flag),
      'total_flags', count(*) filter (where r.total_flag),
      'flagged_lines', count(*) filter (where r.price_flag or r.qty_flag or r.total_flag or r.line_status <> 'matched')
    )
  into v_lines, v_summary from r;

  v_pot := (v_po->>'total')::numeric;
  v_at  := (v_ack->>'total')::numeric;
  v_merch := coalesce(
    (v_ack->>'merchandise_value')::numeric,
    (v_ack->>'subtotal')::numeric,
    v_at - coalesce((v_ack->>'iva_amount')::numeric,0) - coalesce((v_ack->>'freight')::numeric,0)
         - coalesce((v_ack->>'handling')::numeric,0) - coalesce((v_ack->>'handling_bonus')::numeric,0)
  );
  v_summary := v_summary || jsonb_build_object(
    'po_total', v_pot, 'ack_total', v_at, 'ack_count', jsonb_array_length(v_acks),
    'total_gap', case when v_ack is not null then coalesce(v_at,0) - coalesce(v_pot,0) end,
    'total_gap_pct', case when v_ack is not null and v_pot is not null and v_pot <> 0 then (v_at - v_pot) / v_pot end,
    'ack_merchandise', v_merch,
    'merch_gap', case when v_ack is not null then coalesce(v_merch,0) - coalesce(v_pot,0) end,
    'merch_gap_pct', case when v_ack is not null and v_pot is not null and v_pot <> 0 then (coalesce(v_merch,0) - v_pot) / v_pot end,
    'tax_and_freight', case when v_ack is not null then coalesce(v_at,0) - coalesce(v_merch,0) end,
    'has_discrepancies', (v_summary->>'flagged_lines')::int > 0
  );

  return jsonb_build_object(
    'po', v_po, 'ack', v_ack, 'acks', v_acks, 'lines', v_lines, 'summary', v_summary,
    'tolerances', jsonb_build_object('price_pct', p_price_tol, 'qty_pct', p_qty_tol, 'total_pct', p_total_tol)
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.reconcile_qoh()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not (
    coalesce(erp.current_app_role()::text,'') in ('admin','manager')
    or coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','') = 'service_role'
  ) then raise exception 'not authorized' using errcode = '42501'; end if;

  with derived as (
    select s.store_id, s.product_id,
           coalesce(s.qoh,0) as cached_qoh,
           coalesce(d.qoh,0) as derived_qoh
    from erp.store_products s
    left join (
      select product_id, store_id, sum(qty_delta) as qoh
      from erp.inventory_movements
      where store_id is not null
      group by product_id, store_id
    ) d on d.store_id = s.store_id and d.product_id = s.product_id
    where coalesce(s.qoh,0) is distinct from coalesce(d.qoh,0)
  ),
  logged as (
    insert into erp.qoh_reconcile_log(store_id, product_id, cached_qoh, derived_qoh, diff, repaired)
    select store_id, product_id, cached_qoh, derived_qoh, derived_qoh - cached_qoh, false from derived
    returning store_id, product_id, cached_qoh, derived_qoh
  )
  select jsonb_build_object(
    'mode', 'detect',
    'run_at', now(),
    'drift_rows', (select count(*) from logged),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'store_id', store_id, 'product_id', product_id,
        'cached_qoh', cached_qoh, 'derived_qoh', derived_qoh,
        'diff', derived_qoh - cached_qoh) order by store_id, product_id) from logged), '[]'::jsonb)
  ) into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION erp.reconcile_qoh_repair()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_stores text[]; v_products bigint[];
  v_pass int := 0; v_max_passes constant int := 5;
  v_pass_repaired int; v_pass_logged int;
  v_repaired int := 0; v_logged int := 0; v_clean boolean := false;
begin
  if not (
    coalesce(erp.current_app_role()::text,'') in ('admin','manager')
    or coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','') = 'service_role'
  ) then raise exception 'not authorized' using errcode = '42501'; end if;

  -- ROOT LOCK: the aggregate root of a repair is the whole cache, so an advisory lock.
  perform pg_advisory_xact_lock(hashtextextended('erp.reconcile_qoh_repair', 0));

  loop
    v_pass := v_pass + 1;

    -- (b) candidate read. Unlocked and cheap; anything it misses is caught by the next pass.
    select coalesce(array_agg(c.store_id  order by c.store_id, c.product_id), '{}'::text[]),
           coalesce(array_agg(c.product_id order by c.store_id, c.product_id), '{}'::bigint[])
      into v_stores, v_products
      from (
        select s.store_id, s.product_id
          from erp.store_products s
          left join (
            select m.product_id, m.store_id, sum(m.qty_delta) as qoh
              from erp.inventory_movements m
             where m.store_id is not null
             group by m.product_id, m.store_id
          ) d on d.store_id = s.store_id and d.product_id = s.product_id
         where coalesce(s.qoh,0) is distinct from coalesce(d.qoh,0)
      ) c;

    if coalesce(array_length(v_stores,1),0) = 0 then
      v_clean := true;
      exit;
    end if;

    -- (c) lock them, in key order, before reading anything we intend to write back.
    perform 1
       from erp.store_products sp
       join unnest(v_stores, v_products) as k(store_id, product_id)
         on k.store_id = sp.store_id and k.product_id = sp.product_id
      order by sp.store_id, sp.product_id
        for update of sp;

    -- (d)+(e) recompute under the lock, in a new statement (so a movement that committed while we
    -- waited is visible), restricted to the locked set, and write only what is still drifted.
    with locked as (
      select k.store_id, k.product_id from unnest(v_stores, v_products) as k(store_id, product_id)
    ),
    derived as (
      select l.store_id, l.product_id,
             coalesce(sp.qoh,0) as cached_qoh,
             coalesce((select sum(m.qty_delta) from erp.inventory_movements m
                        where m.store_id = l.store_id and m.product_id = l.product_id), 0) as derived_qoh
        from locked l
        join erp.store_products sp on sp.store_id = l.store_id and sp.product_id = l.product_id
    ),
    drifted as (
      select * from derived where cached_qoh is distinct from derived_qoh
    ),
    logged as (
      insert into erp.qoh_reconcile_log(store_id, product_id, cached_qoh, derived_qoh, diff, repaired)
      select store_id, product_id, cached_qoh, derived_qoh, derived_qoh - cached_qoh, true from drifted
      returning 1
    ),
    upd as (
      update erp.store_products sp set qoh = d.derived_qoh
        from drifted d
       where sp.store_id = d.store_id and sp.product_id = d.product_id
      returning 1
    )
    select (select count(*)::int from upd), (select count(*)::int from logged)
      into v_pass_repaired, v_pass_logged;

    v_repaired := v_repaired + v_pass_repaired;
    v_logged   := v_logged   + v_pass_logged;

    exit when v_pass >= v_max_passes;
  end loop;

  return jsonb_build_object(
    'mode', 'repair', 'run_at', now(),
    'repaired', v_repaired,
    'logged',   v_logged,
    'passes',   v_pass,
    'clean',    v_clean
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.record_cycle_count(p_product_id bigint, p_store_id text, p_counted_qty numeric, p_tolerance_pct numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id bigint; v_system numeric; v_var numeric;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_counted_qty is null then raise exception 'counted_qty is required' using errcode='P0001'; end if;
  if not exists (select 1 from erp.products p where p.id=p_product_id) then raise exception 'product % not found', p_product_id using errcode='P0002'; end if;
  if p_store_id is null or not exists (select 1 from erp.stores s where s.id=p_store_id) then raise exception 'store % not found', p_store_id using errcode='P0002'; end if;
  select coalesce(qoh,0) into v_system from erp.store_products where store_id=p_store_id and product_id=p_product_id;
  v_system := coalesce(v_system,0);
  v_var := p_counted_qty - v_system;
  insert into erp.cycle_counts (store_id, product_id, counted_qty, system_qty, variance, tolerance_pct, status, counted_by, counted_at)
  values (p_store_id, p_product_id, p_counted_qty, v_system, v_var, p_tolerance_pct, 'open', auth.uid(), now())
  returning id into v_id;
  return jsonb_build_object('count_id', v_id, 'system_qty', v_system, 'counted_qty', p_counted_qty, 'variance', v_var,
    'within_tolerance', case when p_tolerance_pct is null then v_var = 0 else abs(v_var) <= abs(v_system) * p_tolerance_pct / 100.0 end);
end $function$;

CREATE OR REPLACE FUNCTION erp.reflag_below_cost(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_below_before int; v_mismatch_before int; v_below_after int; v_needs int;
        v_cleared int; v_newly int; v_changed int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  drop table if exists _rf;
  create temp table _rf on commit drop as
  select p.id,
    coalesce(p.review_tags, '{}') as old_tags,
    array_remove(array_remove(array_remove(coalesce(p.review_tags,'{}'),'BELOW COST'),'UNIT MISMATCH?'),'NEEDS UNIT DATA') as base_tags,
    case
      when p.price is null or p.price <= 0 or p.cost is null then null
      when erp.price_in_cost_unit(p.price, p.sell_unit::text, p.base_unit, p.sf_per_box, p.pieces_per_box) is null then 'NEEDS UNIT DATA'
      when erp.is_below_cost(p.price, p.sell_unit::text, p.base_unit, p.sf_per_box, p.pieces_per_box, p.cost) then 'BELOW COST'
      else null
    end as new_flag
  from erp.products p
  where p.record_status <> 'archived';
  select
    count(*) filter (where old_tags @> array['BELOW COST']),
    count(*) filter (where old_tags @> array['UNIT MISMATCH?']),
    count(*) filter (where new_flag = 'BELOW COST'),
    count(*) filter (where new_flag = 'NEEDS UNIT DATA'),
    count(*) filter (where (old_tags @> array['BELOW COST'] or old_tags @> array['UNIT MISMATCH?']) and new_flag is null),
    count(*) filter (where new_flag = 'BELOW COST' and not (old_tags @> array['BELOW COST'])),
    count(*) filter (where old_tags is distinct from (case when new_flag is null then base_tags else array_append(base_tags, new_flag) end))
  into v_below_before, v_mismatch_before, v_below_after, v_needs, v_cleared, v_newly, v_changed from _rf;
  if not p_dry_run then
    update erp.products p set
      review_tags  = case when r.new_flag is null then r.base_tags else array_append(r.base_tags, r.new_flag) end,
      needs_review = (coalesce(array_length(case when r.new_flag is null then r.base_tags else array_append(r.base_tags, r.new_flag) end, 1), 0) > 0),
      updated_at   = now()
    from _rf r
    where r.id = p.id
      and p.review_tags is distinct from (case when r.new_flag is null then r.base_tags else array_append(r.base_tags, r.new_flag) end);
  end if;
  return jsonb_build_object('dry_run', p_dry_run,
    'below_cost_before', v_below_before, 'unit_mismatch_before', v_mismatch_before,
    'below_cost_after', v_below_after, 'unit_mismatch_after', 0, 'needs_unit_data_after', v_needs,
    'cleared_false_positives', v_cleared, 'newly_below_cost', v_newly, 'rows_changed', v_changed);
end $function$;

CREATE OR REPLACE FUNCTION erp.reflag_possible_dups(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_total int; v_cross int; v_stale int; v_kept int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with norm as (
    select id, vendor_id, upper(nullif(btrim(mpn),'')) as mpn, record_status,
      regexp_replace(lower(name), '[^a-z0-9]+', '', 'g') as nk,
      ('POSSIBLE DUP' = any(review_tags)) as flagged
    from erp.products
  ),
  ev as (
    select
      (a.nk <> '' and exists (select 1 from norm b
         where b.id <> a.id and b.nk = a.nk and b.record_status <> 'archived')) as has_name_twin,
      (a.nk <> '' and exists (select 1 from norm b
         where b.id <> a.id and b.nk = a.nk and b.record_status <> 'archived'
           and ((a.vendor_id is not null and a.vendor_id = b.vendor_id)
                or (a.mpn is not null and a.mpn = b.mpn)))) as has_real_twin
    from norm a
    where a.flagged and a.record_status <> 'archived'
  )
  select count(*),
         count(*) filter (where has_name_twin and not has_real_twin),
         count(*) filter (where not has_name_twin),
         count(*) filter (where has_real_twin)
    into v_total, v_cross, v_stale, v_kept
  from ev;

  if not p_dry_run then
    with norm as (
      select id, vendor_id, upper(nullif(btrim(mpn),'')) as mpn, record_status,
        regexp_replace(lower(name), '[^a-z0-9]+', '', 'g') as nk,
        ('POSSIBLE DUP' = any(review_tags)) as flagged
      from erp.products
    ),
    targets as (
      select a.id from norm a
      where a.flagged and a.record_status <> 'archived'
        and not (a.nk <> '' and exists (select 1 from norm b
              where b.id <> a.id and b.nk = a.nk and b.record_status <> 'archived'
                and ((a.vendor_id is not null and a.vendor_id = b.vendor_id)
                     or (a.mpn is not null and a.mpn = b.mpn))))
    )
    update erp.products p set
      review_tags  = array_remove(p.review_tags, 'POSSIBLE DUP'),
      needs_review = (coalesce(array_length(array_remove(p.review_tags, 'POSSIBLE DUP'), 1), 0) > 0),
      updated_at   = now()
    from targets t
    where t.id = p.id;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'flagged_total', v_total,
    'kept_genuine', v_kept,
    'cleared_total', v_cross + v_stale,
    'cleared_cross_vendor', v_cross,
    'cleared_no_current_twin', v_stale
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.reject_external_match(p_ref_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update erp.product_external_refs set match_status = 'rejected', updated_at = now() where id = p_ref_id;
  if not found then raise exception 'external ref % not found', p_ref_id; end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.remove_product_relation(p_product_id bigint, p_related_id bigint, p_relation text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_rel erp.relation_kind := p_relation::erp.relation_kind;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  delete from erp.product_relations
  where relation = v_rel
    and ((product_id = p_product_id and related_product_id = p_related_id)
      or (product_id = p_related_id and related_product_id = p_product_id));
end $function$;

CREATE OR REPLACE FUNCTION erp.reorder_report(p_store text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; v_total int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  select count(*) into v_total
  from erp.store_products sp
  where coalesce(sp.reorder_point,0) > 0 and coalesce(sp.qoh,0) <= sp.reorder_point
    and (p_store is null or sp.store_id = p_store);
  select jsonb_build_object(
    'total', v_total, 'store', p_store,
    'items', coalesce((select jsonb_agg(j order by urgency asc) from (
      select jsonb_build_object(
        'product_id', p.id, 'sku', p.sku, 'name', p.name, 'vendor', v.name, 'store_id', sp.store_id,
        'qoh', sp.qoh, 'reorder_point', sp.reorder_point, 'demand', sp.demand,
        'lead_time_months', sp.lead_time_months, 'abc_class', sp.abc_class,
        'suggested_qty', ceil(greatest(coalesce(nullif(sp.max_level,0), sp.reorder_point) - coalesce(sp.qoh,0), 0)),
        'cost', p.cost
      ) j, (coalesce(sp.qoh,0) - sp.reorder_point) urgency
      from erp.store_products sp
      join erp.products p on p.id = sp.product_id
      left join erp.vendors v on v.id = p.vendor_id
      where coalesce(sp.reorder_point,0) > 0 and coalesce(sp.qoh,0) <= sp.reorder_point
        and (p_store is null or sp.store_id = p_store)
      order by urgency asc
      limit greatest(coalesce(p_limit,100),1) offset greatest(coalesce(p_offset,0),0)
    ) x), '[]'::jsonb)
  ) into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION erp.resolve_review_tag(p_id bigint, p_tag text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  update erp.products p
     set review_tags  = array_remove(p.review_tags, p_tag),
         needs_review = (coalesce(array_length(array_remove(p.review_tags, p_tag), 1), 0) > 0),
         updated_at   = now()
   where p.id = p_id;
  if not found then raise exception 'product % not found', p_id; end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.review_tag_facets()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out jsonb;
begin
  if coalesce(erp.current_app_role()::text, '') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', (select count(*) from erp.products where needs_review),
    'tags',  coalesce((
      select jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc, t.tag)
        from (select unnest(review_tags) as tag, count(*) as n
                from erp.products
               where needs_review
               group by 1) t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $function$;

CREATE OR REPLACE FUNCTION erp.seed_opening_balances(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count int; v_total numeric; v_skipped int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;

  -- ROOT LOCK: the aggregate root of this job is the whole ledger seed, so it is an advisory lock.
  perform pg_advisory_xact_lock(hashtextextended('erp.seed_opening_balances', 0));

  select count(*)::int into v_skipped
    from erp.store_products sp
   where coalesce(sp.qoh,0) <> 0
     and exists (select 1 from erp.inventory_movements m
                  where m.store_id = sp.store_id and m.product_id = sp.product_id);

  if p_dry_run then
    select count(*)::int, coalesce(sum(sp.qoh),0) into v_count, v_total
      from erp.store_products sp
     where coalesce(sp.qoh,0) <> 0
       and not exists (select 1 from erp.inventory_movements m
                        where m.store_id = sp.store_id and m.product_id = sp.product_id);
  else
    with ins as (
      insert into erp.inventory_movements (product_id, store_id, qty_delta, reason, reference, actor, at)
      select sp.product_id, sp.store_id, sp.qoh, 'opening_balance', 'QB import opening balance (unverified)', auth.uid(), now()
        from erp.store_products sp
       where coalesce(sp.qoh,0) <> 0
         and not exists (select 1 from erp.inventory_movements m
                          where m.store_id = sp.store_id and m.product_id = sp.product_id)
      returning qty_delta
    )
    select count(*)::int, coalesce(sum(qty_delta),0) into v_count, v_total from ins;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'opening_balances', v_count, 'total_qoh', v_total,
    'skipped_already_in_ledger', v_skipped);
end $function$;

CREATE OR REPLACE FUNCTION erp.set_invoice_line_match(p_line_id bigint, p_product_id bigint, p_method text, p_confidence numeric, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(p_status,'') not in ('auto','confirmed','rejected') then
    raise exception 'invalid match_status %', p_status;
  end if;
  update erp.sales_invoice_lines
     set product_id = p_product_id, match_method = p_method,
         match_confidence = p_confidence, match_status = p_status
   where id = p_line_id;
  if not found then raise exception 'sales invoice line % not found', p_line_id; end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.set_po_line_product(p_po_line_id bigint, p_product_id bigint, p_write_alias boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_mpn text; v_vendor bigint;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from erp.products where id = p_product_id) then raise exception 'product % not found', p_product_id; end if;
  update erp.po_lines set product_id = p_product_id where id = p_po_line_id
    returning upper(btrim(vendor_item_no)) into v_mpn;
  if not found then raise exception 'po_line % not found', p_po_line_id; end if;
  if p_write_alias and nullif(v_mpn,'') is not null then
    select po.vendor_id into v_vendor from erp.purchase_orders po join erp.po_lines l on l.po_id = po.id where l.id = p_po_line_id;
    if v_vendor is not null and not exists (select 1 from erp.vendor_skus where vendor_id = v_vendor and upper(vendor_sku) = v_mpn) then
      insert into erp.vendor_skus(vendor_id, product_id, vendor_sku) values (v_vendor, p_product_id, v_mpn);
    end if;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.suggest_po_line_matches(p_po_line_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_mpn text; v_desc text; v_vendor bigint; result jsonb;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode='42501'; end if;
  select upper(btrim(l.vendor_item_no)), l.description, po.vendor_id into v_mpn, v_desc, v_vendor
  from erp.po_lines l join erp.purchase_orders po on po.id = l.po_id where l.id = p_po_line_id;
  if not found then raise exception 'po_line % not found', p_po_line_id; end if;

  with cand as (
    select p.id, p.sku, p.name, p.size_in,
      (vs.product_id is not null) as is_vendor_sku,
      (nullif(v_mpn,'') is not null and upper(p.mpn) = v_mpn) as is_mpn,
      case when nullif(v_desc,'') is not null then extensions.similarity(p.name, v_desc) else 0 end as sim
    from erp.products p
    left join erp.vendor_skus vs on vs.product_id = p.id and nullif(v_mpn,'') is not null
         and upper(vs.vendor_sku) = v_mpn and (v_vendor is null or vs.vendor_id = v_vendor)
    where p.record_status <> 'archived'
      and ( (nullif(v_mpn,'') is not null and (vs.product_id is not null or upper(p.mpn) = v_mpn))
            or (nullif(v_desc,'') is not null and extensions.similarity(p.name, v_desc) > 0.25) )
  ),
  ranked as (
    select id, sku, name, size_in,
      case when bool_or(is_vendor_sku) then 1 when bool_or(is_mpn) then 2 else 3 end as rank,
      case when bool_or(is_vendor_sku) then 'vendor SKU' when bool_or(is_mpn) then 'MPN' else 'name' end as reason,
      max(sim) as sim
    from cand group by id, sku, name, size_in
    order by rank, sim desc nulls last
    limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'sku',sku,'name',name,'size_in',size_in,'reason',reason)), '[]'::jsonb)
  into result from ranked;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION erp.tag_uncategorized()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tagged int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  with upd as (
    update erp.products
      set review_tags = array_append(review_tags, 'NO CATEGORY'),
          needs_review = true,
          updated_at = now()
    where category_id is null
      and record_status <> 'archived'
      and not ('NO CATEGORY' = any(review_tags))
    returning 1
  )
  select count(*) into tagged from upd;
  return jsonb_build_object('tagged', tagged);
end $function$;

CREATE OR REPLACE FUNCTION erp.unit_gm(p_price numeric, p_sell_unit text, p_base_unit text, p_sf_per_box numeric, p_pieces_per_box numeric, p_cost numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select round(erp.price_in_cost_unit(p_price,p_sell_unit,p_base_unit,p_sf_per_box,p_pieces_per_box) - p_cost, 2)
$function$;

CREATE OR REPLACE FUNCTION erp.unit_margin_pct(p_price numeric, p_sell_unit text, p_base_unit text, p_sf_per_box numeric, p_pieces_per_box numeric, p_cost numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select round(
    (erp.price_in_cost_unit(p_price,p_sell_unit,p_base_unit,p_sf_per_box,p_pieces_per_box) - p_cost)
    / nullif(erp.price_in_cost_unit(p_price,p_sell_unit,p_base_unit,p_sf_per_box,p_pieces_per_box), 0) * 100, 1)
$function$;

CREATE OR REPLACE FUNCTION erp.update_product(p_id bigint, patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  update erp.products set
    name           = case when patch ? 'name'           then nullif(patch->>'name','')               else name end,
    price          = case when patch ? 'price'          then nullif(patch->>'price','')::numeric      else price end,
    cost           = case when patch ? 'cost'           then nullif(patch->>'cost','')::numeric       else cost end,
    base_unit      = case when patch ? 'base_unit'      then nullif(patch->>'base_unit','')           else base_unit end,
    sf_per_box     = case when patch ? 'sf_per_box'     then nullif(patch->>'sf_per_box','')::numeric else sf_per_box end,
    pieces_per_box = case when patch ? 'pieces_per_box' then nullif(patch->>'pieces_per_box','')::int else pieces_per_box end,
    size_in        = case when patch ? 'size_in'        then nullif(patch->>'size_in','')             else size_in end,
    size_cm        = case when patch ? 'size_cm'        then nullif(patch->>'size_cm','')             else size_cm end,
    material       = case when patch ? 'material'       then nullif(patch->>'material','')            else material end,
    finish         = case when patch ? 'finish'         then nullif(patch->>'finish','')             else finish end,
    mpn            = case when patch ? 'mpn'            then nullif(patch->>'mpn','')                 else mpn end,
    category_id    = case when patch ? 'category_id'    then nullif(patch->>'category_id','')::bigint else category_id end,
    status         = case when nullif(patch->>'status','') is not null then (patch->>'status')::erp.commercial_status else status end,
    seo_title       = case when patch ? 'seo_title'       then nullif(patch->>'seo_title','')       else seo_title end,
    seo_description = case when patch ? 'seo_description' then nullif(patch->>'seo_description','') else seo_description end,
    sell_unit       = case when patch ? 'sell_unit'       then nullif(patch->>'sell_unit','')::erp.sell_unit else sell_unit end,
    updated_at = now()
  where id = p_id;
  if not found then raise exception 'product % not found', p_id; end if;
end $function$;

CREATE OR REPLACE FUNCTION erp.upsert_acknowledgment(p_header jsonb, p_lines jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ack_id bigint; v_po_id bigint; v_vendor_id bigint; v_doc_no text; v_po_number text;
  elem jsonb; v_seq int := 0; v_mpn text; v_match_po_line bigint;
  v_inserted int := 0; v_matched int := 0; v_unmatched int := 0; v_unmatched_mpns text[] := '{}';
begin
  if coalesce(erp.current_app_role()::text, '') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_header is null or jsonb_typeof(p_header) <> 'object' then raise exception 'p_header must be a JSON object'; end if;

  v_doc_no := nullif(btrim(p_header->>'ack_document_no'), '');
  if v_doc_no is null then raise exception 'ack_document_no is required'; end if;
  v_po_number := nullif(btrim(p_header->>'po_number'), '');

  v_po_id := nullif(p_header->>'po_id', '')::bigint;        -- explicit link wins, else match by po_number
  if v_po_id is null and v_po_number is not null then
    select id into v_po_id from erp.purchase_orders where po_number = v_po_number;
  end if;
  v_vendor_id := nullif(p_header->>'vendor_id', '')::bigint; -- explicit, else inherit from linked PO
  if v_vendor_id is null and v_po_id is not null then
    select vendor_id into v_vendor_id from erp.purchase_orders where id = v_po_id;
  end if;

  insert into erp.order_acknowledgments as a (
    po_id, po_number, vendor_id, ack_document_no, ack_date, valid_from, valid_to, order_type,
    customer_no, currency, incoterm, payment_terms, salesperson, specifier, ship_to_name, ship_to_address,
    merchandise_value, handling, handling_bonus, freight, subtotal, iva_pct, iva_amount, total,
    special_instructions, source_pdf_ref, updated_at
  ) values (
    v_po_id, v_po_number, v_vendor_id, v_doc_no,
    nullif(p_header->>'ack_date', '')::date, nullif(p_header->>'valid_from', '')::date, nullif(p_header->>'valid_to', '')::date,
    nullif(p_header->>'order_type', ''), nullif(p_header->>'customer_no', ''), nullif(p_header->>'currency', ''),
    nullif(p_header->>'incoterm', ''), nullif(p_header->>'payment_terms', ''), nullif(p_header->>'salesperson', ''),
    nullif(p_header->>'specifier', ''), nullif(p_header->>'ship_to_name', ''), nullif(p_header->>'ship_to_address', ''),
    nullif(p_header->>'merchandise_value', '')::numeric, nullif(p_header->>'handling', '')::numeric,
    nullif(p_header->>'handling_bonus', '')::numeric, nullif(p_header->>'freight', '')::numeric,
    nullif(p_header->>'subtotal', '')::numeric, nullif(p_header->>'iva_pct', '')::numeric,
    nullif(p_header->>'iva_amount', '')::numeric, nullif(p_header->>'total', '')::numeric,
    nullif(p_header->>'special_instructions', ''), nullif(p_header->>'source_pdf_ref', ''), now()
  )
  on conflict (ack_document_no) do update set
    po_id = excluded.po_id, po_number = excluded.po_number, vendor_id = excluded.vendor_id,
    ack_date = excluded.ack_date, valid_from = excluded.valid_from, valid_to = excluded.valid_to,
    order_type = excluded.order_type, customer_no = excluded.customer_no, currency = excluded.currency,
    incoterm = excluded.incoterm, payment_terms = excluded.payment_terms, salesperson = excluded.salesperson,
    specifier = excluded.specifier, ship_to_name = excluded.ship_to_name, ship_to_address = excluded.ship_to_address,
    merchandise_value = excluded.merchandise_value, handling = excluded.handling, handling_bonus = excluded.handling_bonus,
    freight = excluded.freight, subtotal = excluded.subtotal, iva_pct = excluded.iva_pct, iva_amount = excluded.iva_amount,
    total = excluded.total, special_instructions = excluded.special_instructions, source_pdf_ref = excluded.source_pdf_ref,
    updated_at = now()
  returning a.id into v_ack_id;

  delete from erp.ack_lines where ack_id = v_ack_id;  -- full replace (idempotent re-upload)

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for elem in select * from jsonb_array_elements(p_lines) loop
      v_seq := v_seq + 1;
      v_mpn := nullif(btrim(elem->>'item_no'), '');
      v_match_po_line := null;
      if v_po_id is not null and v_mpn is not null then
        select id into v_match_po_line from erp.po_lines
          where po_id = v_po_id and upper(vendor_item_no) = upper(v_mpn) order by line_no limit 1;
      end if;
      insert into erp.ack_lines (
        ack_id, line_no, item_no, customer_item_no, description, uom, quantity, unit_price, amount,
        boxes, weight_kg, weight_lbs, pallet_factor_m2, pallets, matched_po_line_id
      ) values (
        v_ack_id, coalesce(nullif(elem->>'line_no', '')::int, v_seq), v_mpn,
        nullif(elem->>'customer_item_no', ''), nullif(elem->>'description', ''), nullif(elem->>'uom', ''),
        nullif(elem->>'quantity', '')::numeric, nullif(elem->>'unit_price', '')::numeric, nullif(elem->>'amount', '')::numeric,
        nullif(elem->>'boxes', '')::numeric, nullif(elem->>'weight_kg', '')::numeric, nullif(elem->>'weight_lbs', '')::numeric,
        nullif(elem->>'pallet_factor_m2', '')::numeric, nullif(elem->>'pallets', '')::numeric, v_match_po_line
      );
      v_inserted := v_inserted + 1;
      if v_match_po_line is not null then v_matched := v_matched + 1;
      else v_unmatched := v_unmatched + 1; v_unmatched_mpns := v_unmatched_mpns || coalesce(v_mpn, '(blank)'); end if;
    end loop;
  end if;

  if v_po_id is not null then  -- lifecycle: a still-draft/sent PO becomes 'acknowledged'
    update erp.purchase_orders set status = 'acknowledged', updated_at = now()
      where id = v_po_id and status in ('draft','sent');
  end if;

  return jsonb_build_object(
    'ack_id', v_ack_id, 'ack_document_no', v_doc_no, 'po_id', v_po_id, 'po_number', v_po_number,
    'lines_inserted', v_inserted, 'matched_lines', v_matched, 'unmatched_lines', v_unmatched,
    'unmatched_mpns', to_jsonb(v_unmatched_mpns)
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.upsert_external_ref(p_ref jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id bigint; v_status text;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager')
     and coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select id, match_status into v_id, v_status
    from erp.product_external_refs
   where product_id = (p_ref->>'product_id')::bigint
     and source = coalesce(p_ref->>'source','daltile');
  if v_id is not null and v_status in ('confirmed','rejected') then
    return v_id;
  end if;

  insert into erp.product_external_refs as t (
    product_id, source, external_sku, external_url, external_title, series_name,
    nominal_size, finish, color_name, specs, image_urls, match_method, match_confidence,
    match_status, matched_at, updated_at)
  values (
    (p_ref->>'product_id')::bigint, coalesce(p_ref->>'source','daltile'),
    p_ref->>'external_sku', p_ref->>'external_url', p_ref->>'external_title', p_ref->>'series_name',
    p_ref->>'nominal_size', p_ref->>'finish', p_ref->>'color_name', p_ref->'specs',
    case when p_ref ? 'image_urls' then array(select jsonb_array_elements_text(p_ref->'image_urls')) else null end,
    p_ref->>'match_method', nullif(p_ref->>'match_confidence','')::numeric, 'auto', now(), now())
  on conflict (product_id, source) do update set
    external_sku = excluded.external_sku, external_url = excluded.external_url,
    external_title = excluded.external_title, series_name = excluded.series_name,
    nominal_size = excluded.nominal_size, finish = excluded.finish, color_name = excluded.color_name,
    specs = excluded.specs, image_urls = excluded.image_urls, match_method = excluded.match_method,
    match_confidence = excluded.match_confidence, updated_at = now()
    where t.match_status = 'auto'
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION erp.upsert_purchase_order(p_header jsonb, p_lines jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_po_id bigint; v_vendor_id bigint; v_po_number text;
  v_existing_status erp.po_status; v_final_status erp.po_status; v_status_locked boolean := false;
  v_lines jsonb; v_bad text;
  v_upserted int := 0; v_deleted int := 0; v_preserved int := 0;
  v_matched int := 0; v_unmatched int := 0; v_unmatched_mpns text[] := '{}';
begin
  if coalesce(erp.current_app_role()::text, '') not in ('admin','manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_header is null or jsonb_typeof(p_header) <> 'object' then raise exception 'p_header must be a JSON object'; end if;

  v_po_number := nullif(btrim(p_header->>'po_number'), '');
  if v_po_number is null then raise exception 'po_number is required'; end if;
  v_vendor_id := nullif(p_header->>'vendor_id', '')::bigint;
  if v_vendor_id is null then raise exception 'vendor_id is required'; end if;

  -- Serialize this PO against a concurrent re-upload or receive. Keyed on po_number because the PO
  -- row may not exist yet. See the locking note in receive_po.
  perform pg_advisory_xact_lock(hashtextextended('erp.purchase_orders:' || v_po_number, 0));

  select po.id, po.status into v_po_id, v_existing_status
    from erp.purchase_orders po where po.po_number = v_po_number;

  -- Normalize the payload: resolve every line_no ONCE (explicit value, else 1-based ordinal) so the
  -- guards below and the merge agree on the key.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    v_lines := '[]'::jsonb;
  else
    if exists (select 1 from jsonb_array_elements(p_lines) x where jsonb_typeof(x) <> 'object') then
      raise exception 'p_lines must be an array of JSON objects' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(jsonb_set(e.value, '{line_no}',
             to_jsonb(coalesce(nullif(e.value->>'line_no','')::int, e.ord::int))) order by e.ord), '[]'::jsonb)
      into v_lines
      from jsonb_array_elements(p_lines) with ordinality as e(value, ord);
  end if;

  -- A duplicate line_no in one payload would make the keyed merge ambiguous (and ON CONFLICT would
  -- raise "cannot affect row a second time"). Reject it with something a human can act on.
  select string_agg(d.ln::text, ', ' order by d.ln) into v_bad
    from (select (x->>'line_no')::int as ln from jsonb_array_elements(v_lines) x
           group by 1 having count(*) > 1) d;
  if v_bad is not null then
    raise exception 'PO %: duplicate line_no in payload (%)', v_po_number, v_bad using errcode = 'P0001';
  end if;

  -- Guards run BEFORE any write, so a refused re-upload changes nothing at all.
  if v_po_id is not null then
    select string_agg(pl.line_no::text, ', ' order by pl.line_no) into v_bad
      from erp.po_lines pl
     where pl.po_id = v_po_id and pl.received_qty > 0
       and not exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'line_no')::int = pl.line_no);
    if v_bad is not null then
      raise exception
        'PO % re-upload would drop line(s) % that already have receipts — receipts cannot be discarded by an upload; correct the PO in place, or close it and raise a new one',
        v_po_number, v_bad using errcode = 'P0001';
    end if;

    select string_agg(format('line %s (received %s, upload says %s)',
                             pl.line_no, pl.received_qty, x->>'qty'), '; ' order by pl.line_no)
      into v_bad
      from erp.po_lines pl
      join jsonb_array_elements(v_lines) x on (x->>'line_no')::int = pl.line_no
     where pl.po_id = v_po_id
       and pl.received_qty > 0
       and nullif(x->>'qty','')::numeric is not null
       and nullif(x->>'qty','')::numeric < pl.received_qty;
    if v_bad is not null then
      raise exception 'PO % re-upload would set an ordered qty below the qty already received: %',
        v_po_number, v_bad using errcode = 'P0001';
    end if;

    v_status_locked := v_existing_status not in ('draft','sent');
  end if;

  insert into erp.purchase_orders as po (
    po_number, vendor_id, store_id, po_date, buyer_user, currency,
    ship_to_name, ship_to_address, status, total, notes, source_pdf_ref, updated_at
  ) values (
    v_po_number, v_vendor_id,
    nullif(p_header->>'store_id', ''),
    nullif(p_header->>'po_date', '')::date,
    nullif(p_header->>'buyer_user', ''),
    coalesce(nullif(p_header->>'currency', ''), 'USD'),
    nullif(p_header->>'ship_to_name', ''),
    nullif(p_header->>'ship_to_address', ''),
    coalesce(nullif(p_header->>'status', ''), 'draft')::erp.po_status,
    nullif(p_header->>'total', '')::numeric,
    nullif(p_header->>'notes', ''),
    nullif(p_header->>'source_pdf_ref', ''),
    now()
  )
  on conflict (po_number) do update set
    vendor_id = excluded.vendor_id, store_id = excluded.store_id, po_date = excluded.po_date,
    buyer_user = excluded.buyer_user, currency = excluded.currency, ship_to_name = excluded.ship_to_name,
    ship_to_address = excluded.ship_to_address, total = excluded.total,
    -- STATUS NEVER MOVES BACKWARD (COR-01): the payload's status is honored only while the PO is
    -- still draft/sent. po.* here is the EXISTING row.
    status = case when po.status in ('draft','sent') then excluded.status else po.status end,
    notes = excluded.notes, source_pdf_ref = excluded.source_pdf_ref, updated_at = now()
  returning po.id, po.status into v_po_id, v_final_status;

  -- Keyed merge on (po_id, line_no) — the unique constraint po_lines_po_id_line_no_key.
  with merged as (
    insert into erp.po_lines as pl (po_id, line_no, vendor_item_no, product_id, description, qty, uom, unit_rate, amount)
    select v_po_id,
           (x->>'line_no')::int,
           nullif(btrim(x->>'vendor_item_no'), ''),
           erp.match_product_by_mpn(nullif(btrim(x->>'vendor_item_no'), ''), v_vendor_id),
           nullif(x->>'description', ''),
           nullif(x->>'qty', '')::numeric,
           nullif(x->>'uom', ''),
           nullif(x->>'unit_rate', '')::numeric,
           nullif(x->>'amount', '')::numeric
      from jsonb_array_elements(v_lines) x
    on conflict (po_id, line_no) do update set
      vendor_item_no = excluded.vendor_item_no,
      description    = excluded.description,
      qty            = excluded.qty,
      uom            = excluded.uom,
      unit_rate      = excluded.unit_rate,
      amount         = excluded.amount,
      -- received_qty is DELIBERATELY ABSENT: an upload never rewrites receipts.
      -- product_id freezes once the line has receipts (its lots already point at that product).
      product_id     = case when pl.received_qty > 0 then pl.product_id else excluded.product_id end
    returning pl.product_id, pl.received_qty, pl.vendor_item_no
  )
  select count(*)::int,
         count(*) filter (where product_id is not null)::int,
         count(*) filter (where product_id is null)::int,
         count(*) filter (where received_qty > 0)::int,
         coalesce(array_agg(coalesce(vendor_item_no, '(blank)')) filter (where product_id is null), '{}')
    into v_upserted, v_matched, v_unmatched, v_preserved, v_unmatched_mpns
    from merged;

  -- Lines dropped from the PO. Only unreceived ones can reach here — received ones raised above.
  with gone as (
    delete from erp.po_lines as pl
     where pl.po_id = v_po_id
       and pl.received_qty = 0
       and not exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'line_no')::int = pl.line_no)
    returning pl.id
  )
  select count(*)::int into v_deleted from gone;

  return jsonb_build_object(
    'po_id', v_po_id, 'po_number', v_po_number, 'po_status', v_final_status::text,
    'lines_inserted', v_upserted,          -- kept: the existing caller reads this key
    'lines_upserted', v_upserted,
    'lines_deleted', v_deleted,
    'lines_receipts_preserved', v_preserved,
    'status_locked', v_status_locked,      -- true => the payload's status was ignored on purpose
    'matched', v_matched, 'unmatched', v_unmatched,
    'unmatched_mpns', to_jsonb(v_unmatched_mpns)
  );
end $function$;

CREATE OR REPLACE FUNCTION erp.upsert_sales_invoice(p_inv jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
  v_invoice_no text; v_store_id text;
  v_req_status text; v_cur_status text; v_status text;
  v_rank_req int; v_rank_cur int;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager')
     and coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_inv is null or jsonb_typeof(p_inv) <> 'object' then
    raise exception 'p_inv must be a JSON object' using errcode = 'P0001';
  end if;

  v_invoice_no := nullif(btrim(p_inv->>'invoice_no'), '');
  if v_invoice_no is null then
    raise exception 'invoice_no is required on a sales invoice' using errcode = 'P0001';
  end if;

  -- NEW-03: without a store the (store_id, invoice_no) key cannot be resolved and the upsert
  -- degrades into an unconditional insert.
  v_store_id := nullif(btrim(p_inv->>'store_id'), '');
  if v_store_id is null then
    raise exception
      'store_id is required on sales invoice % -- the (store_id, invoice_no) key cannot be resolved without it',
      v_invoice_no using errcode = 'P0001';
  end if;
  if not exists (select 1 from erp.stores s where s.id = v_store_id) then
    raise exception 'store % not found (sales invoice %)', v_store_id, v_invoice_no using errcode = 'P0002';
  end if;

  v_req_status := nullif(btrim(p_inv->>'status'), '');
  if v_req_status is not null and v_req_status not in ('draft','posted','void') then
    raise exception 'invalid sales invoice status % (expected draft, posted or void)', v_req_status
      using errcode = 'P0001';
  end if;

  -- Serialise against a concurrent re-ingest of the same invoice before the status is read.
  perform pg_advisory_xact_lock(hashtextextended('erp.sales_invoices:' || v_store_id || ':' || v_invoice_no, 0));

  select i.id, i.status into v_id, v_cur_status
    from erp.sales_invoices i
   where i.store_id = v_store_id and i.invoice_no = v_invoice_no;

  -- COR-06 (a): resolve the status BEFORE any write, so a refused downgrade changes nothing at all.
  v_rank_req := case v_req_status when 'draft' then 0 when 'posted' then 1 when 'void' then 2 end;
  v_rank_cur := case v_cur_status when 'draft' then 0 when 'posted' then 1 when 'void' then 2 end;
  if v_cur_status is null then
    v_status := coalesce(v_req_status, 'draft');
  elsif v_req_status is null then
    v_status := v_cur_status;
  elsif v_rank_req < v_rank_cur then
    raise exception
      'sales invoice % (store %) is % -- a re-ingest may not move it back to %; omit "status" from the payload to keep the stored lifecycle state, or change it deliberately through its own action',
      v_invoice_no, v_store_id, v_cur_status, v_req_status using errcode = 'P0001';
  else
    v_status := v_req_status;
  end if;

  insert into erp.sales_invoices as i (
    invoice_no, store_id, invoice_date, customer_name, customer_hubspot_id, customer_po,
    salesperson_code, terms, payment_status, subtotal, tax_rate, tax_amount, total, balance_due,
    source, source_file_ref, status, notes, created_by, updated_at)
  values (
    v_invoice_no, v_store_id, nullif(p_inv->>'invoice_date','')::date,
    p_inv->>'customer_name', p_inv->>'customer_hubspot_id', p_inv->>'customer_po',
    nullif(p_inv->>'salesperson_code',''), p_inv->>'terms', p_inv->>'payment_status',
    nullif(p_inv->>'subtotal','')::numeric, nullif(p_inv->>'tax_rate','')::numeric,
    nullif(p_inv->>'tax_amount','')::numeric, nullif(p_inv->>'total','')::numeric,
    nullif(p_inv->>'balance_due','')::numeric, coalesce(nullif(p_inv->>'source',''),'digital'),
    p_inv->>'source_file_ref', v_status, p_inv->>'notes',
    nullif(p_inv->>'created_by','')::uuid, now())
  on conflict (store_id, invoice_no) do update set
    invoice_date = excluded.invoice_date,
    customer_name = excluded.customer_name,
    -- human / out-of-band columns: carried, never erased by a document re-read
    customer_hubspot_id = coalesce(excluded.customer_hubspot_id, i.customer_hubspot_id),
    notes = coalesce(excluded.notes, i.notes),
    customer_po = excluded.customer_po,
    salesperson_code = excluded.salesperson_code,
    terms = excluded.terms,
    payment_status = excluded.payment_status,
    subtotal = excluded.subtotal,
    tax_rate = excluded.tax_rate,
    tax_amount = excluded.tax_amount,
    total = excluded.total,
    balance_due = excluded.balance_due,
    source = excluded.source,
    source_file_ref = excluded.source_file_ref,
    -- COR-06: excluded.status is v_status, resolved above; it can never rank below i.status.
    status = excluded.status,
    updated_at = now()
  returning i.id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION erp.upsert_sales_invoice_lines(p_invoice_id bigint, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_lines jsonb; v_bad text; v_n int := 0;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager')
     and coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from erp.sales_invoices where id = p_invoice_id) then
    raise exception 'sales invoice % not found', p_invoice_id using errcode = 'P0002';
  end if;

  -- Serialise concurrent re-ingests of the same invoice's lines (the v4_58 locking pattern).
  perform pg_advisory_xact_lock(hashtextextended('erp.sales_invoice_lines:' || p_invoice_id::text, 0));

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    v_lines := '[]'::jsonb;
  else
    if exists (select 1 from jsonb_array_elements(p_lines) x where jsonb_typeof(x) <> 'object') then
      raise exception 'p_lines must be an array of JSON objects' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(jsonb_set(e.value, '{line_no}',
             to_jsonb(coalesce(nullif(e.value->>'line_no','')::int, e.ord::int))) order by e.ord), '[]'::jsonb)
      into v_lines
      from jsonb_array_elements(p_lines) with ordinality as e(value, ord);
  end if;

  select string_agg(d.ln::text, ', ' order by d.ln) into v_bad
    from (select (x->>'line_no')::int as ln from jsonb_array_elements(v_lines) x
           group by 1 having count(*) > 1) d;
  if v_bad is not null then
    raise exception 'sales invoice %: duplicate line_no in payload (%)', p_invoice_id, v_bad
      using errcode = 'P0001';
  end if;

  -- COR-06 (b) GUARD, before any write: a human match decision may not be dropped by a re-ingest.
  select string_agg(l.line_no::text, ', ' order by l.line_no) into v_bad
    from erp.sales_invoice_lines l
   where l.invoice_id = p_invoice_id
     and l.match_status <> 'auto'
     and not exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'line_no')::int = l.line_no);
  if v_bad is not null then
    raise exception
      'sales invoice % re-ingest would drop line(s) % carrying a human match decision (confirmed/rejected) -- a decision cannot be discarded by a re-read; reset it with set_invoice_line_match first, or ingest the corrected document under its own invoice_no',
      p_invoice_id, v_bad using errcode = 'P0001';
  end if;

  with merged as (
    insert into erp.sales_invoice_lines as l (
      invoice_id, line_no, raw_item_code, raw_description, raw_uom, qty, unit_price, amount,
      product_id, match_method, match_confidence, match_status)
    select p_invoice_id, (x->>'line_no')::int, x->>'raw_item_code', x->>'raw_description',
      x->>'raw_uom', nullif(x->>'qty','')::numeric, nullif(x->>'unit_price','')::numeric,
      nullif(x->>'amount','')::numeric, nullif(x->>'product_id','')::bigint,
      nullif(x->>'match_method',''), nullif(x->>'match_confidence','')::numeric,
      coalesce(nullif(x->>'match_status',''),'auto')
    from jsonb_array_elements(v_lines) as x
    on conflict (invoice_id, line_no) do update set
      raw_item_code   = excluded.raw_item_code,
      raw_description = excluded.raw_description,
      raw_uom         = excluded.raw_uom,
      qty             = excluded.qty,
      unit_price      = excluded.unit_price,
      amount          = excluded.amount,
      -- l.* here is the EXISTING row. The four match columns freeze once a human has decided.
      product_id       = case when l.match_status = 'auto' then excluded.product_id       else l.product_id       end,
      match_method     = case when l.match_status = 'auto' then excluded.match_method     else l.match_method     end,
      match_confidence = case when l.match_status = 'auto' then excluded.match_confidence else l.match_confidence end,
      match_status     = case when l.match_status = 'auto' then excluded.match_status     else l.match_status     end
    returning l.id
  )
  select count(*)::int into v_n from merged;

  -- Lines dropped from the payload. Only 'auto' ones can reach here -- decided ones raised above;
  -- the predicate is repeated as defence in depth, exactly as v4_58 repeats received_qty = 0.
  delete from erp.sales_invoice_lines l
   where l.invoice_id = p_invoice_id
     and l.match_status = 'auto'
     and not exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'line_no')::int = l.line_no);

  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION erp.upsert_salesperson(p_sp jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text; v_active boolean;
begin
  if coalesce(erp.current_app_role()::text,'') not in ('admin','manager')
     and coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role','') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_code := upper(btrim(coalesce(p_sp->>'code','')));
  if v_code = '' then
    raise exception 'salesperson code is required' using errcode = 'P0001';
  end if;

  -- NULL here means "key absent or empty" -- distinguishable from an explicit false, which the old
  -- body could not do because it coalesced the missing key to true before ON CONFLICT ever saw it.
  v_active := nullif(p_sp->>'active','')::boolean;

  insert into erp.salespeople as s (code, name, store_id, active)
  values (v_code,
          nullif(btrim(coalesce(p_sp->>'name','')), ''),
          nullif(btrim(coalesce(p_sp->>'store_id','')), ''),
          coalesce(v_active, true))
  on conflict (code) do update set
    name     = coalesce(excluded.name, s.name),
    store_id = coalesce(excluded.store_id, s.store_id),
    active   = coalesce(v_active, s.active)   -- COR-12: keep the stored flag when the payload is silent
  returning code into v_code;
  return v_code;
end $function$;
