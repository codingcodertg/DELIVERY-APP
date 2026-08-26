-- 068: make the ERP's views respect the caller's RLS.
--
-- Found by testing the gate against real rows rather than an empty table — with
-- 600 products seeded, a driver whose has_erp_access() is FALSE could still read
-- all 600 through erp.app_products, and a manager without ERP access could read
-- their cost.
--
-- Cause: a Postgres view runs with the privileges of its OWNER unless it is
-- created with security_invoker. RLS on erp.products therefore never applied to
-- anyone querying the view, and the app reads app_* everywhere precisely BECAUSE
-- that is the cost-masking layer. The module gate in 066 was real but unreachable
-- through the front door.
--
-- Inherited, not introduced here: rtg-erp's own five views carry no reloptions
-- either. It was masked there because every authenticated account in that
-- database WAS an ERP account, and the base policy admitted `authenticated`
-- broadly — so "the view ignores RLS" and "RLS would have allowed it anyway"
-- looked identical. Merging into an app whose users are mostly drivers, sales
-- reps and recruiters is what separated them.
--
-- can_see_cost() is unaffected and still does its own job: it decides which
-- COLUMNS come back, this decides which ROWS. Both are needed — a manager with
-- ERP access sees cost, a manager without sees nothing at all.

alter view erp.app_products       set (security_invoker = on);
alter view erp.app_store_products set (security_invoker = on);
alter view erp.app_lots           set (security_invoker = on);
alter view erp.app_price_history  set (security_invoker = on);
alter view erp.inventory_qoh      set (security_invoker = on);
