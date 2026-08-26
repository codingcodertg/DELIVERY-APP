-- 063: the ERP schema — 37 tables, 5 views, 11 enums.
--
-- Generated from the live rtg-erp database (project wkjlcxxtmcdrjnoollhw), not
-- hand-written and not replayed from its 95 migration files: replaying those
-- would reproduce a year of intermediate states, and half of them create things
-- a later one drops. What is captured here is the shape that database actually
-- has today.
--
-- Everything lands in schema `erp`, following the precedent this repo already
-- set with `recruiting` (056) and `timetracker` (059). Two consequences worth
-- naming:
--
--   * public.profiles is NOT copied. It was the ONLY name colliding between the
--     two databases, and this repo's copy is a strict superset of the ERP's — it
--     already has module_access, store, permissions, username. The 12 foreign
--     keys that pointed at public.profiles still point there, unchanged.
--
--   * the `app_role` enum is NOT created. It existed only as the type of
--     profiles.role, and this repo's profiles.role is plain text. 064 adapts
--     current_app_role() to return text accordingly; every other use of it in
--     the ERP's own code was already cast ::text.
--
-- _deliveries_identity_map is also not copied: it was scaffolding for the merge
-- running the OTHER direction (deliveries into the ERP), and holds nothing this
-- database needs.

create schema if not exists erp;

-- The ERP's catalog search uses trigram indexes. pg_trgm is enabled in rtg-erp
-- but was not here, so those CREATE INDEX statements failed with
-- 'operator class "gin_trgm_ops" does not exist'. Installed into Supabase's
-- `extensions` schema, the convention for this project, and the opclass is
-- referenced schema-qualified below so it resolves whatever search_path a
-- session happens to carry.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums. In `erp`, not public, so they cannot collide with anything this app
-- adds later — `record_status` and `request_status` are generic enough names
-- that a collision is a question of when, not if.
-- ---------------------------------------------------------------------------
create type erp.abc_class          as enum ('A', 'B', 'C');
create type erp.commercial_status  as enum ('active', 'special_order', 'discontinued', 'inactive');
create type erp.lot_status         as enum ('available', 'in_transit', 'quality_hold', 'damaged', 'reserved');
create type erp.movement_reason    as enum ('receive', 'sale', 'return', 'transfer', 'adjustment', 'count_adjustment', 'damage', 'shrinkage', 'in_transit', 'opening_balance');
create type erp.po_status          as enum ('draft', 'sent', 'acknowledged', 'partial', 'received', 'closed');
create type erp.product_type       as enum ('tile', 'trim', 'setting_material', 'tool', 'accessory', 'other');
create type erp.record_status      as enum ('draft', 'pending_approval', 'published', 'archived');
create type erp.relation_kind      as enum ('bro', 'cuz', 'sub');
create type erp.request_status     as enum ('pending', 'approved', 'rejected');
create type erp.request_type       as enum ('new', 'edit', 'reactivate', 'deactivate');
create type erp.sell_unit          as enum ('sqft', 'piece', 'box', 'bag', 'bucket', 'linear_ft', 'each');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table erp.ack_lines (
  id bigint generated always as identity not null,
  ack_id bigint not null,
  line_no integer,
  item_no text,
  customer_item_no text,
  description text,
  uom text,
  quantity numeric,
  unit_price numeric,
  amount numeric,
  boxes numeric,
  weight_kg numeric,
  weight_lbs numeric,
  pallet_factor_m2 numeric,
  pallets numeric,
  matched_po_line_id bigint,
  created_at timestamp with time zone default now() not null
);

create table erp.audit_log (
  id bigint generated always as identity not null,
  actor uuid,
  table_name text not null,
  row_pk text not null,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamp with time zone default now() not null
);

create table erp.categories (
  id bigint generated always as identity not null,
  path text not null,
  level integer not null,
  parent_path text,
  definition text
);

create table erp.channel_state (
  product_id bigint not null,
  shopify_published boolean default false not null,
  shopify_product_id text
);

create table erp.cycle_counts (
  id bigint generated always as identity not null,
  store_id text,
  location_id bigint,
  product_id bigint,
  lot_id bigint,
  counted_qty numeric,
  system_qty numeric,
  variance numeric,
  tolerance_pct numeric,
  status text default 'open'::text,
  counted_by uuid,
  counted_at timestamp with time zone,
  reconciled_by uuid,
  reconciled_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table erp.exemption_certificates (
  id bigint generated always as identity not null,
  customer_id bigint,
  cert_number text,
  type text,
  expiry date,
  pdf_storage_path text,
  created_at timestamp with time zone default now() not null
);

create table erp.inventory_movements (
  id bigint generated always as identity not null,
  product_id bigint not null,
  lot_id bigint,
  location_id bigint,
  store_id text,
  qty_delta numeric not null,
  reason erp.movement_reason not null,
  reference text,
  actor uuid,
  at timestamp with time zone default now() not null
);

create table erp.inventory_snapshots (
  id bigint generated always as identity not null,
  snapshot_at timestamp with time zone default now() not null,
  store_id text,
  product_id bigint,
  lot_id bigint,
  qty numeric,
  unit_cost numeric,
  value numeric,
  created_at timestamp with time zone default now() not null
);

create table erp.locations (
  id bigint generated always as identity not null,
  store_id text,
  name text not null,
  type text,
  created_at timestamp with time zone default now() not null
);

create table erp.lots (
  id bigint generated always as identity not null,
  product_id bigint not null,
  lot_number text,
  received_date date,
  status erp.lot_status default 'available'::erp.lot_status not null,
  base_cost numeric,
  freight_cost numeric,
  duty_cost numeric,
  landed_cost numeric,
  location_id bigint,
  fob_terms text,
  created_at timestamp with time zone default now() not null
);

create table erp.order_acknowledgments (
  id bigint generated always as identity not null,
  po_id bigint,
  po_number text,
  vendor_id bigint,
  ack_document_no text not null,
  ack_date date,
  valid_from date,
  valid_to date,
  order_type text,
  customer_no text,
  currency text,
  incoterm text,
  payment_terms text,
  salesperson text,
  specifier text,
  ship_to_name text,
  ship_to_address text,
  merchandise_value numeric,
  handling numeric,
  handling_bonus numeric,
  freight numeric,
  subtotal numeric,
  iva_pct numeric,
  iva_amount numeric,
  total numeric,
  special_instructions text,
  source_pdf_ref text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table erp.po_lines (
  id bigint generated always as identity not null,
  po_id bigint not null,
  line_no integer,
  vendor_item_no text,
  product_id bigint,
  description text,
  qty numeric,
  uom text,
  unit_rate numeric,
  amount numeric,
  created_at timestamp with time zone default now() not null,
  received_qty numeric default 0 not null
);

create table erp.po_receipts (
  id bigint generated always as identity not null,
  receipt_key text not null,
  po_id bigint not null,
  store_id text not null,
  actor uuid,
  result jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table erp.price_history (
  id bigint generated always as identity not null,
  product_id bigint not null,
  store_id text,
  price numeric,
  cost numeric,
  effective_from timestamp with time zone default now() not null,
  source text,
  actor uuid,
  created_at timestamp with time zone default now() not null
);

create table erp.product_external_refs (
  id bigint generated always as identity not null,
  product_id bigint not null,
  source text default 'daltile'::text not null,
  external_sku text,
  external_url text,
  external_title text,
  series_name text,
  nominal_size text,
  finish text,
  color_name text,
  specs jsonb,
  image_urls text[],
  match_method text,
  match_confidence numeric(4,3),
  match_status text default 'auto'::text not null,
  matched_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table erp.product_images (
  id bigint generated always as identity not null,
  product_id bigint not null,
  storage_path text not null,
  sort_order integer default 0 not null
);

create table erp.product_relations (
  id bigint generated always as identity not null,
  product_id bigint not null,
  related_product_id bigint not null,
  relation erp.relation_kind not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null
);

create table erp.product_requests (
  id bigint generated always as identity not null,
  type erp.request_type not null,
  status erp.request_status default 'pending'::erp.request_status not null,
  product_id bigint,
  payload jsonb default '{}'::jsonb not null,
  requester uuid,
  requester_store text,
  reason text,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_note text,
  created_at timestamp with time zone default now() not null
);

create table erp.products (
  id bigint generated always as identity not null,
  sku text not null,
  name text not null,
  description text,
  status erp.commercial_status default 'active'::erp.commercial_status not null,
  record_status erp.record_status default 'published'::erp.record_status not null,
  needs_review boolean default false not null,
  review_tags text[] default '{}'::text[] not null,
  discontinue_reason text,
  disc_survey text,
  category_id bigint,
  raw_category text,
  raw_type text,
  product_type erp.product_type,
  vendor_id bigint,
  mpn text,
  material text,
  finish text,
  color1 text,
  color2 text,
  style text,
  size_in text,
  size_cm text,
  origin text,
  base_unit text,
  sellable_units text[],
  sf_per_box numeric(10,2),
  pieces_per_box integer,
  boxes_per_pallet integer,
  weight_per_box_lbs numeric(10,2),
  cost numeric(12,2),
  price numeric(12,2),
  price_approved boolean default false not null,
  price_source text,
  taxable boolean default true not null,
  barcode_upc text,
  shopify_handle text,
  image_url text,
  tags text,
  collection text,
  bros text,
  cuz text,
  moq_group numeric,
  verified text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  seo_title text,
  seo_description text,
  sell_unit erp.sell_unit,
  look text,
  color_observation text,
  substitute_color text,
  subs text,
  verified_level smallint default 0 not null,
  date_added date,
  folder_url text,
  product_url text,
  image_urls text[],
  lbs_per_pallet numeric(10,2),
  price_erp numeric(12,2),
  price_sales numeric(12,2),
  price_mgr numeric(12,2),
  price_vol numeric(12,2),
  price_kind text,
  price_mode text
);

create table erp.purchase_orders (
  id bigint generated always as identity not null,
  po_number text not null,
  vendor_id bigint not null,
  store_id text,
  po_date date,
  buyer_user text,
  currency text default 'USD'::text not null,
  ship_to_name text,
  ship_to_address text,
  status erp.po_status default 'draft'::erp.po_status not null,
  total numeric,
  notes text,
  source_pdf_ref text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table erp.qoh_alert_log (
  id bigint generated always as identity not null,
  run_at timestamp with time zone not null,
  drift_rows integer not null,
  store_count integer not null,
  net_request_id bigint,
  alerted_at timestamp with time zone default now() not null
);

create table erp.qoh_reconcile_log (
  id bigint generated always as identity not null,
  run_at timestamp with time zone default now() not null,
  store_id text not null,
  product_id bigint not null,
  cached_qoh numeric,
  derived_qoh numeric,
  diff numeric,
  repaired boolean default false not null
);

create table erp.reservations (
  id bigint generated always as identity not null,
  product_id bigint not null,
  lot_id bigint,
  store_id text,
  qty numeric not null,
  quote_id bigint,
  order_id bigint,
  status text default 'active'::text not null,
  expires_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

create table erp.sales_history (
  id bigint generated always as identity not null,
  product_id bigint,
  store_id text,
  sold_at date not null,
  qty numeric not null,
  sales_price numeric,
  net_sales numeric generated always as ((qty * sales_price)) stored,
  sf_box numeric,
  unified_desc text,
  created_at timestamp with time zone default now() not null
);

create table erp.sales_invoice_lines (
  id bigint generated always as identity not null,
  invoice_id bigint not null,
  line_no integer not null,
  raw_item_code text,
  raw_description text,
  raw_uom text,
  qty numeric(12,3),
  unit_price numeric(12,4),
  amount numeric(12,2),
  product_id bigint,
  match_method text,
  match_confidence numeric(4,3),
  match_status text default 'auto'::text not null,
  created_at timestamp with time zone default now() not null
);

create table erp.sales_invoices (
  id bigint generated always as identity not null,
  invoice_no text not null,
  store_id text not null,
  invoice_date date,
  customer_name text,
  customer_hubspot_id text,
  customer_po text,
  salesperson_code text,
  terms text,
  payment_status text,
  subtotal numeric(12,2),
  tax_rate numeric(6,4),
  tax_amount numeric(12,2),
  total numeric(12,2),
  balance_due numeric(12,2),
  source text default 'digital'::text not null,
  source_file_ref text,
  status text default 'draft'::text not null,
  notes text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table erp.salespeople (
  code text not null,
  name text,
  store_id text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table erp.saved_views (
  id bigint generated always as identity not null,
  user_id uuid not null,
  scope text not null,
  name text not null,
  state jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table erp.sku_aliases (
  old_sku text not null,
  product_id bigint not null,
  reason text
);

create table erp.staging_cat_assign (
  sku text,
  path text
);

create table erp.store_products (
  store_id text not null,
  product_id bigint not null,
  assortment_active boolean default true not null,
  qb_code text,
  qoh numeric,
  store_cost numeric(12,2),
  store_price numeric(12,2),
  moq numeric,
  reorder_point numeric,
  safety_stock numeric,
  min_level numeric,
  max_level numeric,
  abc_class erp.abc_class,
  qoh_verified boolean default false not null,
  demand numeric,
  lead_time_months numeric,
  qb_description text
);

create table erp.stores (
  id text not null,
  name text not null,
  created_at timestamp with time zone default now() not null,
  address text,
  square_footage numeric,
  lease_terms text,
  layout_type text,
  payment_processor text
);

create table erp.tax_rates (
  id bigint generated always as identity not null,
  store_id text not null,
  component text not null,
  rate numeric not null,
  effective_date date not null,
  created_at timestamp with time zone default now() not null
);

create table erp.user_store_assignments (
  user_id uuid not null,
  store_id text not null
);

create table erp.vendor_catalogs (
  id bigint generated always as identity not null,
  vendor_id bigint not null,
  source text,
  imported_at timestamp with time zone,
  payload jsonb,
  created_at timestamp with time zone default now() not null
);

create table erp.vendor_skus (
  id bigint generated always as identity not null,
  vendor_id bigint not null,
  product_id bigint,
  vendor_sku text,
  created_at timestamp with time zone default now() not null
);

create table erp.vendors (
  id bigint generated always as identity not null,
  name text not null,
  aliases text[],
  pct_of_purchasing text,
  fcb2b_certified text,
  csv_832_capable boolean,
  account_number text,
  rep_name text,
  rep_contact text,
  lead_time_days integer,
  min_order numeric,
  payment_terms text,
  return_policy text,
  default_fob_terms text
);

-- ---------------------------------------------------------------------------
-- Primary keys, uniques, checks, then foreign keys. Split from the CREATE TABLE
-- statements above so tables can be created in any order — the FK block below
-- references tables defined later in the file. 53 FKs stay inside erp; the 12
-- that point at public.profiles keep pointing there, because identity is shared.
-- ---------------------------------------------------------------------------
alter table erp.ack_lines add constraint ack_lines_pkey PRIMARY KEY (id);
alter table erp.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table erp.categories add constraint categories_pkey PRIMARY KEY (id);
alter table erp.channel_state add constraint channel_state_pkey PRIMARY KEY (product_id);
alter table erp.cycle_counts add constraint cycle_counts_pkey PRIMARY KEY (id);
alter table erp.exemption_certificates add constraint exemption_certificates_pkey PRIMARY KEY (id);
alter table erp.inventory_movements add constraint inventory_movements_pkey PRIMARY KEY (id);
alter table erp.inventory_snapshots add constraint inventory_snapshots_pkey PRIMARY KEY (id);
alter table erp.locations add constraint locations_pkey PRIMARY KEY (id);
alter table erp.lots add constraint lots_pkey PRIMARY KEY (id);
alter table erp.order_acknowledgments add constraint order_acknowledgments_pkey PRIMARY KEY (id);
alter table erp.po_lines add constraint po_lines_pkey PRIMARY KEY (id);
alter table erp.po_receipts add constraint po_receipts_pkey PRIMARY KEY (id);
alter table erp.price_history add constraint price_history_pkey PRIMARY KEY (id);
alter table erp.product_external_refs add constraint product_external_refs_pkey PRIMARY KEY (id);
alter table erp.product_images add constraint product_images_pkey PRIMARY KEY (id);
alter table erp.product_relations add constraint product_relations_pkey PRIMARY KEY (id);
alter table erp.product_requests add constraint product_requests_pkey PRIMARY KEY (id);
alter table erp.products add constraint products_pkey PRIMARY KEY (id);
alter table erp.purchase_orders add constraint purchase_orders_pkey PRIMARY KEY (id);
alter table erp.qoh_alert_log add constraint qoh_alert_log_pkey PRIMARY KEY (id);
alter table erp.qoh_reconcile_log add constraint qoh_reconcile_log_pkey PRIMARY KEY (id);
alter table erp.reservations add constraint reservations_pkey PRIMARY KEY (id);
alter table erp.sales_history add constraint sales_history_pkey PRIMARY KEY (id);
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_pkey PRIMARY KEY (id);
alter table erp.sales_invoices add constraint sales_invoices_pkey PRIMARY KEY (id);
alter table erp.salespeople add constraint salespeople_pkey PRIMARY KEY (code);
alter table erp.saved_views add constraint saved_views_pkey PRIMARY KEY (id);
alter table erp.sku_aliases add constraint sku_aliases_pkey PRIMARY KEY (old_sku);
alter table erp.store_products add constraint store_products_pkey PRIMARY KEY (store_id, product_id);
alter table erp.stores add constraint stores_pkey PRIMARY KEY (id);
alter table erp.tax_rates add constraint tax_rates_pkey PRIMARY KEY (id);
alter table erp.user_store_assignments add constraint user_store_assignments_pkey PRIMARY KEY (user_id, store_id);
alter table erp.vendor_catalogs add constraint vendor_catalogs_pkey PRIMARY KEY (id);
alter table erp.vendor_skus add constraint vendor_skus_pkey PRIMARY KEY (id);
alter table erp.vendors add constraint vendors_pkey PRIMARY KEY (id);
alter table erp.ack_lines add constraint ack_lines_ack_id_line_no_key UNIQUE (ack_id, line_no);
alter table erp.categories add constraint categories_path_key UNIQUE (path);
alter table erp.order_acknowledgments add constraint order_acknowledgments_ack_document_no_key UNIQUE (ack_document_no);
alter table erp.po_lines add constraint po_lines_po_id_line_no_key UNIQUE (po_id, line_no);
alter table erp.po_receipts add constraint po_receipts_receipt_key_key UNIQUE (receipt_key);
alter table erp.product_external_refs add constraint product_external_refs_product_id_source_key UNIQUE (product_id, source);
alter table erp.product_relations add constraint product_relations_product_id_related_product_id_relation_key UNIQUE (product_id, related_product_id, relation);
alter table erp.products add constraint products_sku_key UNIQUE (sku);
alter table erp.purchase_orders add constraint purchase_orders_po_number_key UNIQUE (po_number);
alter table erp.qoh_alert_log add constraint qoh_alert_log_run_at_key UNIQUE (run_at);
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_invoice_id_line_no_key UNIQUE (invoice_id, line_no);
alter table erp.sales_invoices add constraint sales_invoices_store_id_invoice_no_key UNIQUE (store_id, invoice_no);
alter table erp.vendors add constraint vendors_name_key UNIQUE (name);
alter table erp.categories add constraint categories_level_check CHECK (((level >= 1) AND (level <= 3)));
alter table erp.po_lines add constraint po_lines_received_le_qty CHECK (((qty IS NULL) OR (received_qty <= qty)));
alter table erp.po_lines add constraint po_lines_received_qty_nonneg CHECK ((received_qty >= (0)::numeric));
alter table erp.product_external_refs add constraint perf_match_status_chk CHECK ((match_status = ANY (ARRAY['auto'::text, 'confirmed'::text, 'rejected'::text])));
alter table erp.product_relations add constraint product_relations_check CHECK ((product_id <> related_product_id));
alter table erp.products add constraint products_price_kind_chk CHECK ((price_kind = ANY (ARRAY['general'::text, 'specific'::text])));
alter table erp.products add constraint products_price_mode_chk CHECK ((price_mode = ANY (ARRAY['fixed'::text, 'leveled'::text])));
alter table erp.products add constraint products_sku_check CHECK (((sku ~ '^[A-Z0-9][A-Z0-9-]{0,63}$'::text) OR (sku ~ '^[A-Z0-9][A-Z0-9-]{0,57}~MERGE$'::text)));
alter table erp.products add constraint products_verified_level_chk CHECK ((verified_level = ANY (ARRAY[0, 1, 2])));
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_amount_sign_matches_qty CHECK (((amount IS NULL) OR (qty IS NULL) OR ((amount * qty) >= (0)::numeric)));
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_confidence_range CHECK (((match_confidence IS NULL) OR ((match_confidence >= (0)::numeric) AND (match_confidence <= (1)::numeric))));
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_line_no_positive CHECK ((line_no > 0));
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_match_method_check CHECK ((match_method = ANY (ARRAY['sku'::text, 'mpn'::text, 'vendor_sku'::text, 'alias'::text, 'name_size'::text, 'manual'::text])));
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_match_status_check CHECK ((match_status = ANY (ARRAY['auto'::text, 'confirmed'::text, 'rejected'::text])));
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_no_nan CHECK (((COALESCE(qty, (0)::numeric) <> 'NaN'::numeric) AND (COALESCE(unit_price, (0)::numeric) <> 'NaN'::numeric) AND (COALESCE(amount, (0)::numeric) <> 'NaN'::numeric) AND (COALESCE(match_confidence, (0)::numeric) <> 'NaN'::numeric)));
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_qty_nonzero CHECK (((qty IS NULL) OR (qty <> (0)::numeric)));
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_unit_price_nonneg CHECK (((unit_price IS NULL) OR (unit_price >= (0)::numeric)));
alter table erp.sales_invoices add constraint sales_invoices_invoice_no_not_blank CHECK ((btrim(invoice_no) <> ''::text));
alter table erp.sales_invoices add constraint sales_invoices_no_nan CHECK (((COALESCE(subtotal, (0)::numeric) <> 'NaN'::numeric) AND (COALESCE(tax_rate, (0)::numeric) <> 'NaN'::numeric) AND (COALESCE(tax_amount, (0)::numeric) <> 'NaN'::numeric) AND (COALESCE(total, (0)::numeric) <> 'NaN'::numeric) AND (COALESCE(balance_due, (0)::numeric) <> 'NaN'::numeric)));
alter table erp.sales_invoices add constraint sales_invoices_source_check CHECK ((source = ANY (ARRAY['digital'::text, 'scanned'::text])));
alter table erp.sales_invoices add constraint sales_invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text, 'void'::text])));
alter table erp.sales_invoices add constraint sales_invoices_tax_rate_range CHECK (((tax_rate IS NULL) OR ((tax_rate >= (0)::numeric) AND (tax_rate < (1)::numeric))));
alter table erp.sales_invoices add constraint sales_invoices_tax_sign_matches_subtotal CHECK (((subtotal IS NULL) OR (tax_amount IS NULL) OR ((subtotal * tax_amount) >= (0)::numeric)));
alter table erp.sales_invoices add constraint sales_invoices_total_covers_subtotal_tax CHECK (((total IS NULL) OR (subtotal IS NULL) OR (tax_amount IS NULL) OR (abs(total) >= (abs((subtotal + tax_amount)) - 0.01))));
alter table erp.salespeople add constraint salespeople_code_not_blank CHECK ((btrim(code) <> ''::text));
alter table erp.saved_views add constraint saved_views_scope_check CHECK ((scope = ANY (ARRAY['catalog'::text, 'review'::text])));
alter table erp.ack_lines add constraint ack_lines_ack_id_fkey FOREIGN KEY (ack_id) REFERENCES erp.order_acknowledgments(id) ON DELETE CASCADE;
alter table erp.ack_lines add constraint ack_lines_matched_po_line_id_fkey FOREIGN KEY (matched_po_line_id) REFERENCES erp.po_lines(id) ON DELETE SET NULL;
alter table erp.channel_state add constraint channel_state_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id) ON DELETE CASCADE;
alter table erp.cycle_counts add constraint cycle_counts_counted_by_fkey FOREIGN KEY (counted_by) REFERENCES public.profiles(id);
alter table erp.cycle_counts add constraint cycle_counts_location_id_fkey FOREIGN KEY (location_id) REFERENCES erp.locations(id);
alter table erp.cycle_counts add constraint cycle_counts_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES erp.lots(id);
alter table erp.cycle_counts add constraint cycle_counts_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.cycle_counts add constraint cycle_counts_reconciled_by_fkey FOREIGN KEY (reconciled_by) REFERENCES public.profiles(id);
alter table erp.cycle_counts add constraint cycle_counts_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.inventory_movements add constraint inventory_movements_actor_fkey FOREIGN KEY (actor) REFERENCES public.profiles(id);
alter table erp.inventory_movements add constraint inventory_movements_location_id_fkey FOREIGN KEY (location_id) REFERENCES erp.locations(id);
alter table erp.inventory_movements add constraint inventory_movements_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES erp.lots(id);
alter table erp.inventory_movements add constraint inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.inventory_movements add constraint inventory_movements_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.inventory_snapshots add constraint inventory_snapshots_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES erp.lots(id);
alter table erp.inventory_snapshots add constraint inventory_snapshots_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.inventory_snapshots add constraint inventory_snapshots_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.locations add constraint locations_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.lots add constraint lots_location_id_fkey FOREIGN KEY (location_id) REFERENCES erp.locations(id);
alter table erp.lots add constraint lots_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.order_acknowledgments add constraint order_acknowledgments_po_id_fkey FOREIGN KEY (po_id) REFERENCES erp.purchase_orders(id) ON DELETE SET NULL;
alter table erp.order_acknowledgments add constraint order_acknowledgments_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES erp.vendors(id) ON DELETE SET NULL;
alter table erp.po_lines add constraint po_lines_po_id_fkey FOREIGN KEY (po_id) REFERENCES erp.purchase_orders(id) ON DELETE CASCADE;
alter table erp.po_lines add constraint po_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id) ON DELETE SET NULL;
alter table erp.po_receipts add constraint po_receipts_po_id_fkey FOREIGN KEY (po_id) REFERENCES erp.purchase_orders(id) ON DELETE CASCADE;
alter table erp.po_receipts add constraint po_receipts_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.price_history add constraint price_history_actor_fkey FOREIGN KEY (actor) REFERENCES public.profiles(id);
alter table erp.price_history add constraint price_history_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.price_history add constraint price_history_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.product_external_refs add constraint product_external_refs_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id) ON DELETE CASCADE;
alter table erp.product_images add constraint product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id) ON DELETE CASCADE;
alter table erp.product_relations add constraint product_relations_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id) ON DELETE CASCADE;
alter table erp.product_relations add constraint product_relations_related_product_id_fkey FOREIGN KEY (related_product_id) REFERENCES erp.products(id) ON DELETE CASCADE;
alter table erp.product_requests add constraint product_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id);
alter table erp.product_requests add constraint product_requests_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.product_requests add constraint product_requests_requester_fkey FOREIGN KEY (requester) REFERENCES public.profiles(id);
alter table erp.product_requests add constraint product_requests_requester_store_fkey FOREIGN KEY (requester_store) REFERENCES erp.stores(id);
alter table erp.products add constraint products_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);
alter table erp.products add constraint products_category_id_fkey FOREIGN KEY (category_id) REFERENCES erp.categories(id);
alter table erp.products add constraint products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table erp.products add constraint products_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES erp.vendors(id);
alter table erp.purchase_orders add constraint purchase_orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id) ON DELETE SET NULL;
alter table erp.purchase_orders add constraint purchase_orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES erp.vendors(id) ON DELETE RESTRICT;
alter table erp.reservations add constraint reservations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table erp.reservations add constraint reservations_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES erp.lots(id);
alter table erp.reservations add constraint reservations_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.reservations add constraint reservations_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.sales_history add constraint sales_history_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id) ON DELETE SET NULL;
alter table erp.sales_history add constraint sales_history_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES erp.sales_invoices(id) ON DELETE CASCADE;
alter table erp.sales_invoice_lines add constraint sales_invoice_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.sales_invoices add constraint sales_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table erp.sales_invoices add constraint sales_invoices_salesperson_code_fkey FOREIGN KEY (salesperson_code) REFERENCES erp.salespeople(code);
alter table erp.sales_invoices add constraint sales_invoices_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.salespeople add constraint salespeople_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.saved_views add constraint saved_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table erp.sku_aliases add constraint sku_aliases_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id) ON DELETE CASCADE;
alter table erp.store_products add constraint store_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id) ON DELETE CASCADE;
alter table erp.store_products add constraint store_products_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.tax_rates add constraint tax_rates_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id);
alter table erp.user_store_assignments add constraint user_store_assignments_store_id_fkey FOREIGN KEY (store_id) REFERENCES erp.stores(id) ON DELETE CASCADE;
alter table erp.user_store_assignments add constraint user_store_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table erp.vendor_catalogs add constraint vendor_catalogs_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES erp.vendors(id);
alter table erp.vendor_skus add constraint vendor_skus_product_id_fkey FOREIGN KEY (product_id) REFERENCES erp.products(id);
alter table erp.vendor_skus add constraint vendor_skus_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES erp.vendors(id);

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- Only the standalone ones. A primary key or unique CONSTRAINT already creates
-- its own backing index, and pg_indexes lists those too — re-issuing them is
-- how this file first failed with "relation ..._key already exists". The 52
-- constraint-backed indexes are therefore excluded here; they arrive above.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_ack_lines_matched ON erp.ack_lines USING btree (matched_po_line_id);
CREATE INDEX idx_ack_lines_mpn ON erp.ack_lines USING btree (upper(item_no));
CREATE INDEX audit_log_actor_at_idx ON erp.audit_log USING btree (actor, at DESC);
CREATE INDEX audit_log_record_at_idx ON erp.audit_log USING btree (table_name, row_pk, at DESC);
CREATE INDEX cycle_counts_created_idx ON erp.cycle_counts USING btree (created_at DESC);
CREATE INDEX cycle_counts_product_idx ON erp.cycle_counts USING btree (product_id);
CREATE INDEX idx_cycle_counts_counted_by ON erp.cycle_counts USING btree (counted_by);
CREATE INDEX idx_cycle_counts_location_id ON erp.cycle_counts USING btree (location_id);
CREATE INDEX idx_cycle_counts_lot_id ON erp.cycle_counts USING btree (lot_id);
CREATE INDEX idx_cycle_counts_reconciled_by ON erp.cycle_counts USING btree (reconciled_by);
CREATE INDEX idx_cycle_counts_store_id ON erp.cycle_counts USING btree (store_id);
CREATE INDEX idx_inv_mov_qoh ON erp.inventory_movements USING btree (product_id, store_id) INCLUDE (qty_delta);
CREATE INDEX idx_inv_mov_store_product ON erp.inventory_movements USING btree (store_id, product_id);
CREATE INDEX idx_inventory_movements_at ON erp.inventory_movements USING btree (at DESC);
CREATE INDEX idx_inventory_movements_location_id ON erp.inventory_movements USING btree (location_id);
CREATE INDEX inv_mov_actor_idx ON erp.inventory_movements USING btree (actor);
CREATE INDEX inv_mov_lot_idx ON erp.inventory_movements USING btree (lot_id);
CREATE INDEX inv_mov_product_at_idx ON erp.inventory_movements USING btree (product_id, at DESC);
CREATE UNIQUE INDEX inventory_movements_opening_balance_uniq ON erp.inventory_movements USING btree (product_id, store_id) WHERE (reason = 'opening_balance'::erp.movement_reason);
CREATE INDEX idx_inventory_snapshots_lot_id ON erp.inventory_snapshots USING btree (lot_id);
CREATE INDEX idx_inventory_snapshots_product_id ON erp.inventory_snapshots USING btree (product_id);
CREATE INDEX idx_inventory_snapshots_store_id ON erp.inventory_snapshots USING btree (store_id);
CREATE INDEX inv_snap_at_idx ON erp.inventory_snapshots USING btree (snapshot_at);
CREATE INDEX idx_locations_store_id ON erp.locations USING btree (store_id);
CREATE INDEX idx_lots_location_id ON erp.lots USING btree (location_id);
CREATE INDEX lots_product_idx ON erp.lots USING btree (product_id);
CREATE INDEX idx_ack_po ON erp.order_acknowledgments USING btree (po_id);
CREATE INDEX idx_ack_po_number ON erp.order_acknowledgments USING btree (po_number);
CREATE INDEX idx_ack_vendor ON erp.order_acknowledgments USING btree (vendor_id);
CREATE INDEX idx_po_lines_mpn ON erp.po_lines USING btree (upper(vendor_item_no));
CREATE INDEX idx_po_lines_product ON erp.po_lines USING btree (product_id);
CREATE INDEX po_receipts_po_id_idx ON erp.po_receipts USING btree (po_id);
CREATE INDEX po_receipts_store_id_idx ON erp.po_receipts USING btree (store_id);
CREATE INDEX price_history_actor_idx ON erp.price_history USING btree (actor);
CREATE INDEX price_history_product_effective_idx ON erp.price_history USING btree (product_id, effective_from DESC);
CREATE INDEX price_history_store_id_idx ON erp.price_history USING btree (store_id);
CREATE INDEX idx_perf_source ON erp.product_external_refs USING btree (source, match_status);
CREATE UNIQUE INDEX product_images_product_sort_uk ON erp.product_images USING btree (product_id, sort_order);
CREATE INDEX idx_product_relations_related ON erp.product_relations USING btree (related_product_id);
CREATE INDEX product_requests_decided_by_idx ON erp.product_requests USING btree (decided_by);
CREATE INDEX product_requests_product_id_idx ON erp.product_requests USING btree (product_id);
CREATE INDEX product_requests_requester_idx ON erp.product_requests USING btree (requester);
CREATE INDEX product_requests_requester_store_idx ON erp.product_requests USING btree (requester_store);
CREATE INDEX products_approved_by_idx ON erp.products USING btree (approved_by);
CREATE INDEX products_category_id_idx ON erp.products USING btree (category_id);
CREATE INDEX products_created_by_idx ON erp.products USING btree (created_by);
CREATE INDEX products_mpn_idx ON erp.products USING btree (mpn) WHERE (mpn IS NOT NULL);
CREATE INDEX products_mpn_upper_idx ON erp.products USING btree (upper(mpn)) WHERE (mpn IS NOT NULL);
CREATE INDEX products_name_trgm ON erp.products USING gin (name extensions.gin_trgm_ops);
CREATE INDEX products_needs_review_idx ON erp.products USING btree (needs_review) WHERE needs_review;
CREATE INDEX products_record_status_idx ON erp.products USING btree (record_status);
CREATE INDEX products_review_tags_gin ON erp.products USING gin (review_tags);
CREATE INDEX products_status_idx ON erp.products USING btree (status);
CREATE INDEX products_vendor_id_idx ON erp.products USING btree (vendor_id);
CREATE INDEX idx_purchase_orders_store ON erp.purchase_orders USING btree (store_id);
CREATE INDEX idx_purchase_orders_vendor ON erp.purchase_orders USING btree (vendor_id);
CREATE INDEX idx_qoh_alert_log_run_at ON erp.qoh_alert_log USING btree (run_at DESC);
CREATE INDEX idx_qoh_reconcile_log_run_at ON erp.qoh_reconcile_log USING btree (run_at DESC);
CREATE INDEX idx_qoh_reconcile_log_store_product ON erp.qoh_reconcile_log USING btree (store_id, product_id);
CREATE INDEX idx_reservations_created_by ON erp.reservations USING btree (created_by);
CREATE INDEX idx_reservations_lot_id ON erp.reservations USING btree (lot_id);
CREATE INDEX idx_reservations_store_id ON erp.reservations USING btree (store_id);
CREATE INDEX reservations_product_idx ON erp.reservations USING btree (product_id);
CREATE INDEX sales_history_product_date ON erp.sales_history USING btree (product_id, sold_at);
CREATE INDEX sales_history_store_date ON erp.sales_history USING btree (store_id, sold_at);
CREATE INDEX idx_sales_inv_lines_product ON erp.sales_invoice_lines USING btree (product_id);
CREATE INDEX idx_sales_invoices_created_by ON erp.sales_invoices USING btree (created_by);
CREATE INDEX idx_sales_invoices_date ON erp.sales_invoices USING btree (invoice_date DESC);
CREATE INDEX idx_sales_invoices_salesperson ON erp.sales_invoices USING btree (salesperson_code);
CREATE INDEX idx_salespeople_store ON erp.salespeople USING btree (store_id);
CREATE INDEX saved_views_user_scope_idx ON erp.saved_views USING btree (user_id, scope);
CREATE INDEX sku_aliases_product_id_idx ON erp.sku_aliases USING btree (product_id);
CREATE INDEX idx_store_products_reorder ON erp.store_products USING btree (store_id) WHERE (COALESCE(reorder_point, (0)::numeric) > (0)::numeric);
CREATE INDEX store_products_product_id_idx ON erp.store_products USING btree (product_id);
CREATE INDEX tax_rates_store_eff_idx ON erp.tax_rates USING btree (store_id, effective_date DESC);
CREATE INDEX idx_user_store_assignments_store_id ON erp.user_store_assignments USING btree (store_id);
CREATE INDEX idx_vendor_catalogs_vendor_id ON erp.vendor_catalogs USING btree (vendor_id);
CREATE INDEX vendor_skus_product_idx ON erp.vendor_skus USING btree (product_id);
CREATE INDEX vendor_skus_vendor_idx ON erp.vendor_skus USING btree (vendor_id);
