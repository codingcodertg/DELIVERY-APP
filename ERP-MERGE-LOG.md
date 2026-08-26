# Merge into RTG ERP — session log & handoff

**Date:** 2026-08-23 · **Target repo:** `codingcodertg/rtg-erp` · **Live:** https://rtg-erp.vercel.app

Merging this app (deliveries + recruiting + timetracker) into `rtg-erp`, the company's other live
system (6-store product catalog / purchasing / inventory). **rtg-erp is the host**: one repo, one
Vercel deploy, one Supabase project going forward.

Authoritative technical record lives in the target repo — `docs/adr/0010-delivery-role-extension.md`.
This file is the session-level handoff: what happened, what's pending, what to watch.

---

## Decisions taken (by Andrés, this session)

| Decision | Choice | Why it mattered |
|---|---|---|
| Merge direction | rtg-erp hosts | It's the more hardened system (money paths, RLS, security audits) |
| Database | One shared project (rtg-erp's) | Rejected keeping two projects in sync |
| Role model | Extend rtg-erp's `app_role` enum | Rejected a separate role column; accepted the bigger audit surface for one unified model |
| Shared store logins | Bring over as-is | `salesrfc@`, `warehouserft@` etc. stay shared; converting to per-person is a business change, not a migration detail |
| Scope | All three modules | deliveries, recruiting, timetracker |

## Key identifiers

- **rtg-erp Supabase:** `wkjlcxxtmcdrjnoollhw` (org `RTG`, Pro plan, us-east-1)
- **deliveries-app Supabase:** `iwhcsvgujydebdyllcqu` (`DELIVERY'S APP`, ca-central-1)
- **Vercel project:** `prj_J6hmVuD3R0Es17LmoFywG600u3UD`, team `rtgwarehouse`
- **Git identity that works:** commits must be authored as `codingcodertg`
  (`RRODRIGUEZ@RDZTILEGROUP.NET`) or Vercel refuses to deploy them — see "Traps" below.

> Tokens/keys used this session are deliberately **not** recorded here. Regenerate from the Supabase
> and GitHub dashboards when needed.

---

## What shipped (all merged to `main` and deployed)

### Phase 1 — role model · PR #53
- `v4_68`: added `driver`, `warehouse`, `logistics`, `sales`, `accounting` to `app_role`.
- **Found and fixed a real security bug.** 20 page/action guards used
  `if (session.role === "staff") redirect("/")` — "block staff, allow everyone else". That only
  equalled "admin or manager" because those were the only three roles. The moment a driver/warehouse
  account could log in, all 20 would have waved them straight into `/purchasing`, `/analytics`,
  `/po-upload`, `/master`, `/decisions`, `/review/*` — every cost- and margin-bearing screen in the
  ERP. Replaced with the positive `canSeeCost()` allow-list. Caught by auditing before the new roles
  could exist, not after.
- Test group 41 proves a driver session is denied everywhere staff is and can't see cost.

### Phase 2 — identity · PR #55
- `v4_69`: `profiles` gained `recruiting_role`, `timetracker_role`, `module_access`.
- **32 staff accounts created** in rtg-erp via the Auth Admin API.
- **Zero emails matched beforehand** — rtg-erp had only 3 `@rtg-demo.com` seed accounts. Every one
  was a create, not a merge.
- `public._deliveries_identity_map` holds old-UUID → new-UUID. **Every Phase 3 import keys off this.**
  Don't drop it until no further import needs remapping.

### Phase 3 — data · PRs #56, #57, #58, #59
- Three new schemas: `deliveries`, `recruiting`, `timetracker` (mirroring how this app already
  isolates the latter two). **This is what made the merge tractable** — sidesteps every name
  collision (`profiles`, `stores`, `audit_log`, `settings`, `notifications`) without renaming a
  single table.
- **30 tables · 5,979 rows · verified equal on both sides, table by table.**
- Every user-reference column remapped through the identity map. Unmappable refs were reported
  rather than silently nulled — there were none.
- **Storage copied separately** (a DB import moves rows that *reference* files, never the bytes):
  2,077 screenshots (900 MB), 49 resumes (12 MB), 1 app file. Verified against source.
- `v4_74`: **68 RLS policies**, ported from this app's live `pg_policies` rather than invented.
  No merged table is left without a policy.

### Phase 4 — UI foundation · PR #60
- `lib/domain/modules.ts` — who sees which module.
- `lib/domain/roles.ts` — `AppRole` widened to all 8 values (it was still 3-valued after v4_68, so
  TypeScript believed a driver session was impossible while the DB could produce one).
- `lib/supabase/module-server.ts` — schema-bound client, anon key + user JWT so RLS applies.
- `side-nav` — Modules section; catalog nav hidden from delivery-floor roles.
- `app/deliveries/page.tsx` — orders list over the 77 real orders, role-shaped stage chips.
- 21 new unit tests (119 total). Full verify green.

---

## ⚠️ BLOCKING: one dashboard setting

The merged schemas are **not exposed to the API**, so `/deliveries` errors until this is done:

**Dashboard → rtg-erp → Settings → API → Exposed schemas** → add `deliveries`, `recruiting`,
`timetracker`.

https://supabase.com/dashboard/project/wkjlcxxtmcdrjnoollhw/settings/api

Neither Supabase token could do this via API ("account does not have the necessary privileges") —
it needs the owner's dashboard session. Verify afterwards with:

```
GET /v1/projects/wkjlcxxtmcdrjnoollhw/postgrest   →   db_schema should list all five
```

This is safe: the 68 RLS policies are already live. Exposure without RLS would be dangerous;
exposure *with* it is turning on a door that already has a lock.

---

## What's left

| Phase | State |
|---|---|
| 4 — UI port | **~2% done.** Foundation + 1 page. ~70 routes, ~43,600 lines remain |
| 5 — Cutover | Not started. Vercel/DNS consolidation, parity smoke test, retire old project |

Phase 4 is a rewrite, not a move: Next 14→15, React 18→19, 1,347 lines of hand-written CSS →
Tailwind 4 + shadcn/cva. Best done module by module in reviewable batches. The pattern is now proven
end-to-end, which makes the rest mechanical rather than exploratory.

---

## Open risks — read before continuing

1. **Both systems are live in parallel.** Anything staff do in this app after 2026-08-23 does not
   appear in rtg-erp. The imports are idempotent (`on conflict do nothing`) by design, so a delta
   re-run at cutover is safe — but it must happen, or there must be a freeze.

2. **The permissive deliveries write policy.** `ALL USING (true)` for any authenticated user, ported
   verbatim because this app enforces writes in application code, not RLS. Weaker than rtg-erp's
   norm (ADR 0002). Documented in `v4_74`'s header rather than quietly tightened. Today an ERP-only
   user with no deliveries duties can write deliveries rows. Tighten once the UI exists to test it.

3. **All 32 migrated accounts share one temporary password.** Rotate them. `12345678` was requested
   and **rejected by Supabase** — it's on the known-breached list, and the leaked-password protection
   would have to be disabled project-wide to force it, which weakens security for everyone.

4. **Backups.** rtg-erp's own tech-debt register rates this High and it's still open: 7 daily
   snapshots, no PITR, restore never tested. PITR is available (~$100/mo, Pro plan) but is a real
   recurring cost — deferred as a business decision, not an oversight. There was no verified restore
   path behind any of this session's data work.

5. **The 3 demo accounts** (`admin@`/`manager@`/`staff@rtg-demo.com`) are untouched by request, plus
   a `test-admin@rtg-demo.com` account created this session for testing.

---

## Traps that cost time (don't relearn these)

- **Merged ≠ applied.** Merging a migration PR does *not* run it on production — CI only proves it
  replays in a throwaway DB. `v4_68` and `v4_69` sat merged-but-unapplied until an import failed
  with "column not found". **Every migration must be explicitly applied to
  `wkjlcxxtmcdrjnoollhw` and recorded in `supabase_migrations.schema_migrations`.**

- **Vercel checks the commit author, not the merger.** A squash-merge by an authorized account does
  *not* unblock a deploy whose commits were authored by an unrecognized GitHub identity. Commits
  authored as `CARRERSRTG` were refused (`TEAM_ACCESS_REQUIRED`); the same content authored as
  `codingcodertg` deployed fine. Author correctly from the start — rewriting history afterwards is
  the wrong tool.

- **PostgREST caches the schema.** After DDL, `notify pgrst, 'reload schema'` or the API keeps
  insisting a new column doesn't exist.

- **Legacy Supabase API keys are disabled** on rtg-erp (since 2026-06-14). The long JWT-style
  `anon`/`service_role` keys return "Legacy API keys are disabled". Use the `sb_secret_…` /
  `sb_publishable_…` format from **Settings → API Keys**.

- **jsonb vs text[] both arrive as JS arrays.** Guessing from the value alone silently turns jsonb
  objects into the string `[object Object]`. Read the real column type from
  `information_schema.columns`.

---

## Migration ledger added this session

| # | File | What |
|---|---|---|
| v4_68 | `add_delivery_roles` | 5 new `app_role` values |
| v4_69 | `delivery_profile_fields` | `recruiting_role`, `timetracker_role`, `module_access` |
| v4_70 | `deliveries_schema_core` | `deliveries` schema + core orders table |
| v4_71 | `deliveries_schema_rest` | the other 9 deliveries tables |
| v4_72 | `recruiting_schema` | 11 recruiting tables |
| v4_73 | `timetracker_schema` | 9 timetracker tables |
| v4_74 | `merge_rls_policies` | 68 policies + access helpers |
