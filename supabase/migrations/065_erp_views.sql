-- 065: the ERP's cost-masking views.
--
-- Separate from 063 for a hard ordering reason, not tidiness: every one of these
-- calls can_see_cost(), which is created in 064. Kept inside 063 they failed with
-- "function can_see_cost() does not exist" — the views are the cost gate, so they
-- cannot exist before the function that decides it.
--
-- ---------------------------------------------------------------------------
-- Views.
--
-- These are the cost-masking layer: app_products, app_store_products, app_lots
-- and app_price_history each return cost/margin/GM only when can_see_cost()
-- says so, and NULL otherwise. That is decision #29 expressed in SQL, and it is
-- why the app reads app_* rather than the base tables.
--
-- Created with search_path set to erp so their unqualified references
-- (FROM products p, JOIN categories c) resolve inside this schema. Postgres
-- stores resolved OIDs, so the setting matters only while they are created.
-- ---------------------------------------------------------------------------
set local search_path = erp, public;

create view erp.app_lots as
 SELECT id,
    product_id,
    lot_number,
    received_date,
    status,
    location_id,
    fob_terms,
    created_at,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN base_cost
            ELSE NULL::numeric
        END AS base_cost,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN freight_cost
            ELSE NULL::numeric
        END AS freight_cost,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN duty_cost
            ELSE NULL::numeric
        END AS duty_cost,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN landed_cost
            ELSE NULL::numeric
        END AS landed_cost
   FROM lots l
  WHERE (EXISTS ( SELECT 1
           FROM products p
          WHERE p.id = l.product_id AND (p.record_status = 'published'::erp.record_status OR ((( SELECT current_app_role() AS current_app_role)) = ANY (ARRAY['admin', 'manager'])))));

create view erp.app_price_history as
 SELECT id,
    product_id,
    store_id,
    price,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN cost
            ELSE NULL::numeric
        END AS cost,
    effective_from,
    source,
    actor,
    created_at
   FROM price_history ph
  WHERE (EXISTS ( SELECT 1
           FROM products p
          WHERE p.id = ph.product_id AND (p.record_status = 'published'::erp.record_status OR ((( SELECT current_app_role() AS current_app_role)) = ANY (ARRAY['admin', 'manager'])))));

create view erp.app_products as
 SELECT p.id,
    p.sku,
    p.name,
    p.description,
    p.status,
    p.record_status,
    p.needs_review,
    p.review_tags,
    p.discontinue_reason,
    p.disc_survey,
    p.category_id,
    c.path AS category_path,
    p.raw_category,
    p.raw_type,
    p.product_type,
    p.vendor_id,
    v.name AS vendor_name,
    p.mpn,
    p.material,
    p.finish,
    p.color1,
    p.color2,
    p.style,
    p.size_in,
    p.size_cm,
    p.origin,
    p.base_unit,
    p.sellable_units,
    p.sf_per_box,
    p.pieces_per_box,
    p.boxes_per_pallet,
    p.weight_per_box_lbs,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN p.cost
            ELSE NULL::numeric
        END AS cost,
    p.price,
    p.price_approved,
    p.price_source,
    p.taxable,
    p.barcode_upc,
    p.shopify_handle,
    p.image_url,
    p.tags,
    p.collection,
    p.bros,
    p.cuz,
    p.moq_group,
    p.verified,
    p.created_by,
    p.approved_by,
    p.approved_at,
    p.created_at,
    p.updated_at,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN unit_gm(p.price, p.sell_unit::text, p.base_unit, p.sf_per_box, p.pieces_per_box::numeric, p.cost)
            ELSE NULL::numeric
        END AS gm_amount,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN unit_margin_pct(p.price, p.sell_unit::text, p.base_unit, p.sf_per_box, p.pieces_per_box::numeric, p.cost)
            ELSE NULL::numeric
        END AS margin_pct,
    p.seo_title,
    p.seo_description,
    p.sell_unit,
    q.qoh,
    p.look,
    p.color_observation,
    p.substitute_color,
    p.subs,
    p.verified_level,
    p.date_added,
    p.folder_url,
    p.product_url,
    p.image_urls,
    p.lbs_per_pallet,
    p.price_erp,
    p.price_sales,
    p.price_mgr,
    p.price_vol,
    p.price_kind,
    p.price_mode
   FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN ( SELECT sp.product_id,
            sum(sp.qoh) AS qoh
           FROM store_products sp
          GROUP BY sp.product_id) q ON q.product_id = p.id
  WHERE p.record_status = 'published'::erp.record_status OR ((( SELECT current_app_role() AS current_app_role)) = ANY (ARRAY['admin', 'manager']));

create view erp.app_store_products as
 SELECT sp.store_id,
    sp.product_id,
    sp.assortment_active,
    sp.qb_code,
    sp.qoh,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN sp.store_cost
            ELSE NULL::numeric
        END AS store_cost,
    sp.store_price,
    sp.moq,
    sp.reorder_point,
    sp.safety_stock,
    sp.min_level,
    sp.max_level,
    sp.abc_class,
        CASE
            WHEN ( SELECT can_see_cost() AS can_see_cost) THEN unit_margin_pct(sp.store_price, pr.sell_unit::text, pr.base_unit, pr.sf_per_box, pr.pieces_per_box::numeric, sp.store_cost)
            ELSE NULL::numeric
        END AS store_margin_pct,
    sp.qoh_verified,
    sp.qb_description
   FROM store_products sp
     LEFT JOIN products pr ON pr.id = sp.product_id
  WHERE (EXISTS ( SELECT 1
           FROM products p
          WHERE p.id = sp.product_id AND (p.record_status = 'published'::erp.record_status OR ((( SELECT current_app_role() AS current_app_role)) = ANY (ARRAY['admin', 'manager'])))));

create view erp.inventory_qoh as
 SELECT product_id,
    store_id,
    sum(qty_delta) AS qoh
   FROM inventory_movements
  WHERE store_id IS NOT NULL
  GROUP BY product_id, store_id;

reset search_path;
