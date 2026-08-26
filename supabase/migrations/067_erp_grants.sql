-- 066: GRANTs on the erp schema.
--
-- RLS (065) decides which ROWS a query may see; Postgres checks plain GRANTs
-- first, at schema and table level, before RLS runs at all. `create schema`
-- grants nothing to anyone but the owner. Same reasoning as 061 for timetracker.
--
-- DIFFERENT FROM 061 IN ONE RESPECT, DELIBERATELY: anon gets nothing.
--
-- 061 grants to anon, authenticated and service_role, following what recruiting
-- had. The ERP has no public surface at all — no equivalent of the public order
-- tracking page — so there is no reason for an unauthenticated session to hold
-- privileges on purchasing and cost data, even with RLS refusing every row.
-- rtg-erp itself grants anon table privileges on 27 of these tables; that is
-- Supabase's default rather than a decision, and it is not worth reproducing.
-- Grant to anon only if something is deliberately made public, and say so there.

grant usage on schema erp to authenticated, service_role;

grant all on all tables    in schema erp to authenticated, service_role;
grant all on all sequences in schema erp to authenticated, service_role;
grant all on all functions in schema erp to authenticated, service_role;

-- So a table added to erp.* by a later migration gets the same grants without
-- this file needing to be revisited.
alter default privileges in schema erp grant all on tables    to authenticated, service_role;
alter default privileges in schema erp grant all on sequences to authenticated, service_role;
alter default privileges in schema erp grant all on functions to authenticated, service_role;
