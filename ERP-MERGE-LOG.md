# ERP → deliveries-app merge log

Direction reversed on 2026-08-25 (D-090). deliveries-app is the host; the ERP
moved in. What follows is what actually happened, including the parts that went
wrong, so the next person does not rediscover them.

## Code

- Next 14.2 / React 18 → **15.5 / 19**. Surface was small: two files using
  `cookies()`, five taking `params`. 487 tests identical before and after.
- 23 ERP routes under `/erp`, namespaced to `src/lib/erp` and
  `src/components/erp` because `utils`, `analytics`, `export` and `supabase`
  all collided by name with this repo's own.
- Tailwind 4 **without preflight**, scoped to `[data-app="erp"]`. Preflight is a
  global reset; importing it would have stripped every deliveries, recruiting
  and timetracker screen — the ones the reversal existed to protect.
- `@supabase/ssr` 0.5.2 → 0.12.0. Not optional: one app, one copy, and the ERP
  code is written against 0.12.

## Schema (migrations 062–069)

Schema `erp`, following the `recruiting` / `timetracker` precedent: 37 tables,
5 views, 11 enums, 69 functions, 128 indexes, RLS on all 37.

`public.profiles` was the **only** name colliding between the two databases, and
this repo's copy is a strict superset — so it is shared, not copied, and the 12
foreign keys pointing at it still point at it. The `app_role` enum was not
created; it existed only as the type of `profiles.role`, and this repo's is text.

The ERP is the first module with **no role column of its own**. Cost visibility
is `role in ('admin','manager')`, values `role` already carries. A second column
would have been the same fact, free to drift.

## Data — 84,454 of 84,467 rows

Every table matches the source except `user_store_assignments` (13 → 0), and
that is correct: all 13 belong to `rtg-demo` accounts that have no counterpart
here.

Provenance columns (`created_by`, `actor`, `requester`, …) were remapped through
an email-based identity map — 32 of 36 profiles matched. They still came out
null, and that is also correct: **every** provenance value in the source is
`manager@rtg-demo.com`, a seeded demo account. The map worked; there was nothing
real to map. Checked rather than assumed.

Four things had to be handled on the way in, each a real difference:

- identity columns are `GENERATED ALWAYS` → `OVERRIDING SYSTEM VALUE`, and the
  sequences must then be resynced or the next insert collides;
- `sales_history.net_sales` is a `GENERATED` column and cannot appear in the
  insert at all;
- `inventory_movements.lot_id` pointed at lots outside an early subset — cleared
  rather than dropping rows, because quantity-on-hand stays correct either way;
- load order had to follow the FK graph, computed rather than guessed.

## Two inherited security holes, closed

**068 — the views ignored RLS.** A Postgres view runs as its OWNER unless
created with `security_invoker`, and the app reads `app_*` everywhere because
that is the cost-masking layer. With products seeded, a driver whose
`has_erp_access()` is false read the entire catalog, and a manager without ERP
access read cost. Inherited from rtg-erp, where it was invisible because every
authenticated account there WAS an ERP account — "the view ignores RLS" and "RLS
would have allowed it anyway" looked identical.

**069 — no SELECT policy on the base tables.** Fixing 068 then locked admins out
too. Also not an upstream oversight: the views WERE the read path, so cost
masking was the only gate that had to exist. Three layers now say three
different things — the restrictive gate decides whether you may open the ERP,
these policies decide which rows, `can_see_cost()` decides which columns.

Both were found by testing against real rows. The same test against empty tables
passed while proving nothing, because every role saw zero.

## Verified (2026-08-25, full dataset)

| role | erp access | products | with cost |
|---|---|---|---|
| admin | true | 6,859 | 6,104 |
| driver / sales / manager | false | 0 | 0 |
| manager, after an admin ticks the box | true | 6,859 | 6,104 |

`dashboard_stats`, `catalog_facets`, `category_browse`, `reorder_report`,
`analytics_store_stats`, `analytics_vendor_stats`, `purchasing_groups` and the
`inventory_qoh` view all run clean. Zero orphaned foreign keys.

## Still open

- **Notion is not updated.** CLAUDE.md requires it in the same session; the
  token has never been provided to the assistant.
- `src/lib/recruiting/supabase/server.ts` has no importers — dead, left as-is.
- The Daltile refresh job needs `JOBS_SECRET`, `WAREHOUSE_CATALOG_URL` and
  `WAREHOUSE_READ_TOKEN` in the environment. Without them it returns a 500
  naming the missing variable, which is the honest failure — it is not wired to
  a cron here either.
