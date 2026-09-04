# RDZ · Deliveries — Architecture & Rebuild Guide

> Living document. Kept in sync with the codebase on every change.
> Purpose: enough real detail to **recreate the system from scratch**.

Last verified against code: 2026-08-19 (recruiting module ported, D-052)

---

## 1. What it is

Internal delivery-order management for a tile company. Salespeople create orders,
the Office Manager approves/rejects, the Warehouse fulfills. Four roles, one shared
team workspace. Bilingual (English / Spanish), light/dark themed, mobile-friendly.

Order lifecycle:
```
draft → pending → approved → fulfilling → ready → picked_up → delivered
          │  └── rejected (back to sales) ──┐
          └──────────────── canceled ───────┘
```
Driver marks `ready → picked_up` (collected) then `picked_up → delivered`.

## 2. Stack

- **Next.js 14.2** (App Router, `"use client"` components) + **React 18** + **TypeScript**
- **Supabase** (Postgres + Auth + Realtime + RLS) for production
- **Local demo mode** — localStorage, no backend, for offline/demo use
- **Vercel** for hosting
- No CSS framework — hand-written CSS in `src/app/globals.css` with CSS variables + theming
- Routing/distance: server route calling Google Maps / Mapbox / OpenStreetMap (auto-selected by env key)

## 3. Two data modes (the core design decision)

The app runs in one of two modes, chosen by `NEXT_PUBLIC_LOCAL_MODE` in `.env.local`:

| | Local demo (`true`) | Supabase (`false`) |
|---|---|---|
| Provider | `src/lib/local-data-provider.tsx` | `src/lib/data-provider.tsx` |
| Storage | browser localStorage (`rtg_deliveries_local_v4`) | Postgres |
| Auth | fake "View as" role switcher (`LocalApp.tsx`) | Supabase Auth |
| Realtime | `storage` events across tabs | Supabase postgres_changes channel |

**Both providers implement the identical `DataState` contract** (defined in `data-provider.tsx`).
Every component consumes data through `useData()` and never knows which mode is active.
**Rule: any new data operation must be added to BOTH providers with matching behavior.**

Shared, mode-agnostic business logic lives in `src/lib/` (e.g. `notifications.ts`,
`constants.ts`, `utils.ts`) so the two providers stay in lock-step.

## 4. Directory map

```
src/
  app/
    (app)/                  authenticated shell (layout picks Local vs Supabase provider)
      layout.tsx            reads NEXT_PUBLIC_LOCAL_MODE, mounts provider + TopBar
      page.tsx              Orders — table/board toggle, filters, search, CSV, ?order= deep-link
      approvals/page.tsx    manager queue of pending orders
      warehouse/page.tsx    warehouse fulfillment queue (store-scoped)
      driver/page.tsx       driver view: to-deliver / delivered, can log new orders
      settings/page.tsx     admin-only: language, workspace name, duration rates, pick-lists
      users/page.tsx        admin-only: invite / role / delete users
    api/
      distance/route.ts     POST {origin,destination} → miles + ETA (Google/Mapbox/OSM)
      geocode/route.ts      POST {q} → address autocomplete suggestions (Google/Mapbox/OSM)
      invite/route.ts       admin invites a user (service-role)
      delete-user/route.ts  admin deletes a user (service-role)
    auth/callback, auth/signout, login, reset-password
    layout.tsx, globals.css, manifest.ts
  components/
    LocalApp.tsx            local-mode shell + role switcher
    TopBar.tsx              app title, tabs, lang/theme toggles, NotificationBell, user, sign-out
    NotificationBell.tsx    bell + unread badge + dropdown; click → /?order=<id>
    OrdersTable.tsx         compact table view
    OrdersBoard.tsx         kanban board — one column per stage
    OrderModal.tsx          create/edit/view an order + workflow action buttons
    AddressInput.tsx        text input with real-time /api/geocode autocomplete dropdown
    VersionFooter.tsx
  lib/
    data-provider.tsx       Supabase provider + DataState contract + useData()
    local-data-provider.tsx localStorage provider (mirrors the contract)
    notifications.ts        role-targeted notification recipient logic (shared)
    export.ts               Excel (collapsible, grouped by employee) + print-to-PDF exports
    constants.ts            STAGES, ROLE_INFO, TABS, permission helpers
    types.ts                Profile, Delivery, OrderEvent, Settings, Stage, UserRole
    utils.ts                formatting, deliveryColumns, colLabel, CSV, palletDuration, nowMilitary
    prefs.tsx               language + theme context (usePrefs, t(en,es))
    supabase/               client / server / admin / middleware factories
supabase/
  schema.sql                tables, triggers, RLS, realtime (fresh install)
  roles.sql                 role column + stage-transition guard + write RLS
  migrations/001_notifications.sql   add notifications to an existing DB
```

## 5. Roles & permissions

Roles: `admin | manager | sales | warehouse | driver` (`UserRole` in types.ts).
Permission helpers in `constants.ts`: `canCreate`, `canApprove`, `canFulfill`, `canDeliver`, `canEditFields(role, stage)`.

- **sales** — create/edit orders in draft/pending/rejected, submit, resubmit, cancel
- **manager** (Office Manager) — approve/reject pending, unlock approved back to pending
- **warehouse** — approved → fulfilling → ready; edits ONLY pallets + prepared status;
  scoped to their `profile.store` (only sees orders picked up from that store)
- **driver** — own view (`/driver`); can log new orders like sales; marks ready → delivered;
  scoped to their store / assigned orders
- **admin** — everything + settings + user management (assigns each warehouse/driver a store);
  can override an order to ANY status via the "Set status" selector (bypasses `canTransition`)

In Supabase mode these are enforced in the DB (RLS + a stage-transition trigger in `roles.sql`),
so they hold regardless of client. The UI mirrors them for UX.

`profiles` also carries `recruiting_role` and `module_access` — access to the **recruiting
module** (a separate app's data, sharing this same `profiles` table; see §11). These are
independent of the deliveries `role` above: a deliveries `sales` user can also be a recruiting
`admin`. Null/empty by default for everyone; only a deliveries `admin` can grant them
(`guard_recruiting_access_change` trigger, deliberately separate from `guard_role_change` above).

### ERP role model — `erp_role` (D-181)

The **ERP module** has its own tier column `erp_role` (`staff | manager | admin`, null = no ERP
tier), parallel to `recruiting_role`/`timetracker_role`. It gates the ERP's cost/margin
visibility (decision #29) and catalog authority. Until D-181 the ERP had **no** column of its
own and keyed cost on the deliveries `role` (`admin|manager`) — which meant an office manager of
Deliveries inherited ERP cost without anyone granting it, and, worse, `erp.products.cost` was
readable straight off the base table (the masking view `app_products` was only cosmetic).

D-181 closed both:
- **`erp.current_app_role()` reads `erp_role`**, not `profiles.role`. Every ERP policy that gives
  authority (`products update`, `sku_aliases insert`, `audit_log read`) and the cost mask
  (`can_see_cost()` → `erp_role in ('manager','admin')`) delegate to this one function, so the
  single change re-keyed all of them. Access to the module itself is still the `module_access`
  checkbox (`has_erp_access()`), unchanged.
- **Cost is closed at the base table**: `SELECT` on the `cost`/`store_cost` columns is revoked
  from `authenticated` (table `SELECT` revoked, every non-cost column re-granted), and the
  `app_products`/`app_store_products`/`app_price_history` views read cost through a
  `SECURITY DEFINER` function that masks it by `can_see_cost()`. Direct base-table reads of cost
  return `permission denied` for everyone; cost flows only through the views.
- Only a deliveries `admin` may change `erp_role` — folded into `guard_profile_privileged_columns`
  (D-179), not a new trigger. The ERP's operational/history tables (POs, inventory, `audit_log`,
  `price_history`, …) have a **RESTRICTIVE** `has_erp_access()` gate and no permissive write
  policy, so they were already append-only / service-role-only from the client — D-181 left them
  untouched.

Workflow moves are additionally guarded client-side by `canTransition(from, to)` in
`constants.ts`, enforced in both providers' `setStage`. An order can NEVER reach the
warehouse (fulfilling/ready/delivered) without a manager approving it first.

## 6. Data model (Postgres / TS types)

- **profiles** — id (=auth user), full_name, role, store (warehouse/driver scope), avatar_url
- **settings** — singleton row id=1: app_name, order_types[] (text[]),
  stores & drivers (jsonb — arrays of `{name, address}` so each location is
  map-searchable), pickup_min_per_pallet, delivery_min_per_pallet
- **deliveries** — the order. order_no (sequential), stage, rejected_reason, all spec fields
  (prepared_status, status_temp, order_type, store, po2, so_num, invoice_num, input_date,
  input_time, delivery_date, pickup_address/duration, est_pallets (sales),
  actual_pallets (warehouse-revised), redelivery_of + redelivery_reason (repeat tracking),
  assigned_driver,
  delivery_duration/address/windows, account, contact, delivery_phone, delivery_notes),
  route_miles/duration/provider/traffic, created_by, approved_by/at, timestamps
- **order_events** — audit/history log (kind, note, created_by) per delivery. Written on
  create, every stage change, field edits ("edited"), and admin status overrides. Shown in
  the order's "Activity" section with actor + timestamp.
- **notifications** — user_id (recipient), delivery_id, order_no, kind, message, read, created_at

## 7. Key feature notes (implementation-specific)

- **Store & driver locations** — Settings stores/drivers are `{name, address}`; the
  address is entered via `AddressInput` (map-searchable). When routing an order with no
  explicit pickup address, the origin falls back to the selected store's saved address.
  Selecting a store also auto-fills the order's pickup name + pickup address.
- **Intra-store (store-to-store) orders** — when the order type matches `/transfer|intra/i`
  (e.g. "Intra-Tienda"), the Delivery Address input becomes a **store dropdown**; picking the
  destination store fills `delivery_address` from that store's saved address.
- **Address autocomplete** — pickup & delivery addresses use `AddressInput`, which
  debounces (~350ms) to `/api/geocode` for live suggestions (Google Places / Mapbox /
  OSM Nominatim by env). Picking a suggestion sets the field, which triggers the mileage
  calc. Pickup Name field was removed. Free-typing still works; suggestions are best-effort.
- **Auto distance/ETA** — `OrderModal` debounces (~900ms) on pickup/store + delivery address
  and calls `/api/distance`; a `lastRouted` ref avoids re-fetching the same pair. Manual
  "Recalculate" button also present. Errors only surface on manual runs.
- **Durations** — pickup/delivery durations are auto-derived (`palletDuration` = pallets ×
  per-pallet minutes from settings) and persisted via `withDurations`, but the duration
  fields are NOT shown in the form.
- **Input date/time** — stamped automatically at creation (`todayISO()` + `nowMilitary()`
  in `withDurations`); not editable in the form. Still shown in view mode + CSV.
- **Notifications** — `notificationsForStage()` fans a stage change to recipients:
  pending→managers, approved→warehouse + creator, rejected/ready/delivered→creator.
  Actor never notified. Emitted from both providers' `setStage`/`addDelivery`.
  Bell in TopBar; clicking navigates `/?order=<id>` which the Orders page auto-opens.
- **Board view** — `OrdersBoard`, columns per `STAGES`, ignores the stage chip filter,
  keeps search. Toggle in Orders page header.
- **i18n** — `usePrefs().t(en, es)` picks per language. `colLabel()` translates the
  view-mode detail keys (CSV keeps English headers).

## 8. Rebuild from scratch

1. `npx create-next-app` (14, TS, App Router). Add deps: `@supabase/ssr`, `@supabase/supabase-js`, `exceljs`.
2. Copy `src/` and `supabase/`. Set up `.env.local` from `.env.local.example`.
3. **Local demo:** `NEXT_PUBLIC_LOCAL_MODE=true`, `npm run dev`. No backend needed.
4. **Supabase:** create project → run `supabase/schema.sql` then `supabase/roles.sql`
   in SQL Editor. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`. The first user is **not** made admin automatically —
   `handle_new_user` sets `role` from the invite metadata (default `sales`); promote the
   first admin by hand in the DB. (The timetracker "first signup becomes admin" trigger was
   deliberately dropped in the merge — see the note further down. Corrected 2026-09-03, D-179.)
   For an existing DB, also run the files in `supabase/migrations/` in order.
5. Optional live traffic: set `GOOGLE_MAPS_API_KEY` or `MAPBOX_TOKEN` (else OSM, no traffic).
6. Deploy to Vercel with the same env vars; add the Vercel URL to Supabase Auth redirect allow-list.

## 9. Conventions

- Bump `LS_KEY` suffix in `local-data-provider.tsx` when the demo seed shape changes (forces reseed).
- Add new tables to the realtime publication and give them RLS in `schema.sql`.
- Keep the two data providers behaviorally identical.
- All user-facing strings go through `t(en, es)`.

## 10. Change log (most recent first)

- **D-081's `ensureSession()` had its own unguarded failure mode, found the same day (D-088).**
  Only `refreshSession()` inside it was wrapped in `.catch(() => {})`; `getSession()` itself had no
  error handling. Once D-081 made every `reloadAll()` `await ensureSession()` as its first line, a
  `getSession()` failure — a fetch aborted mid-navigation, which is exactly what opening the app or
  switching modules looks like to the browser — threw an unhandled rejection that killed the whole
  `reloadAll()` before it ever reached `setReady(true)`, leaving the screen stuck empty until an
  unrelated manual refresh happened to give `getSession()` a clean run. `tsc`/`vitest`/`next build`
  couldn't have caught it — none of them exercise a real browser navigation with an in-flight
  request. Fixed by wrapping `ensureSession()`'s entire body in `try/catch` in all three data
  providers, making it strictly best-effort: a failure now just means `reloadAll()` proceeds with
  whatever session already exists, the same as before D-081 existed at all.
- **Versioning and the update banner went from one global number to one per app (D-087).**
  `src/lib/app-versions.ts` (new) holds `APP_VERSIONS = { deliveries, recruiting, timetracker }`,
  replacing the single `APP_VERSION` constant that used to live in `constants.ts` — that constant
  is gone; everything that displayed or compared a version now reads its own app's key from this
  map instead. `/api/version` returns `{ versions: {...}, apk }`; `apk` (the driver shell's native
  build number) is NOT a fourth app in that map — it hangs off `deliveries` conceptually, since the
  Capacitor shell loads deliveries specifically. `AppUpdateBanner` (mounted 4 times: deliveries'
  `TopBar`, and the `home`/`recruiting`/`timetracker` layouts) now takes a static `app` prop — each
  layout only ever wraps its own route tree, so there's exactly one right answer per call site, no
  runtime detection needed. `home`/`login` (genuinely shared, outside all three app folders) use
  deliveries' version — the judgment call there: deliveries is the one app nobody needs a grant
  for, and the hub/login are styled as deliveries' own UI, not a fourth app of their own. Bumping
  stays entirely manual, decided per-commit by whoever's making the change (see `CLAUDE.md`'s
  updated flow step 3) — deliberately no auto-bump script parsing `git diff` to decide which app(s)
  changed, since a shared file touched doesn't reliably mean all three were affected, and an
  auto-bump-all-on-any-shared-touch policy would recreate the "everyone gets notified of everything"
  problem this change exists to fix. recruiting and timetracker start at `0.1.0`, not `1.0.0`:
  neither has an independent version history in this repo (D-050 and D-064 are both recorded
  against the OLD global counter, not a number of their own) — a stray `APP_VERSION = "0.0.47"`
  found in `src/lib/recruiting/constants.ts` turned out to be dead code (never imported anywhere),
  a frozen leftover from recruiting's original standalone repo's own `package.json`-synced version
  at merge time, not a maintained history worth inheriting.
- **All three `reloadAll()`s now refresh a stale token before reading, not just before writing
  (D-081).** `deliveries`/`recruiting`/`timetracker`'s data providers all had the same latent bug:
  `if (d.data) setDeliveries(...)` treats an empty array as truthy, and an expired access token
  doesn't make a `select` error — RLS just treats the request as anonymous and PostgREST returns
  `200` with `[]`. The result silently overwrote real state with nothing, with no error anywhere,
  read exactly like "all my data disappeared." Hit for real the same day across all three modules
  (once already, pre-session, on the Users page; twice more during the timetracker work, D-077).
  timetracker's provider already had an `ensureSession()` helper — used only before writes; now
  called at the top of every `reloadAll()`/`reloadAdmin()` in all three providers. Covers the
  common case (ordinary token expiry, worsened by background-tab timer throttling delaying the
  client's own auto-refresh) by refreshing proactively before the read; does not cover a
  genuinely server-revoked session, which would still need a real re-login.
- **Recruiting module — UI ported, Etapa 2 complete (D-052)**: all 8 recruiting pages now live
  under `/recruiting/*` in this repo/deploy, in their own sibling route group with an
  independent layout, DataProvider, and TopBar. CSS scoped under `.recruiting-module`;
  `usePrefs()` reused instead of porting a second i18n provider. Found and fixed two more
  role-vs-recruiting_role bugs beyond the one from D-051 (a query that could have crashed the
  Users page on a driver profile; `/api/delete-user` that would have deleted a shared account
  instead of revoking module access) — see §11.
- **Recruiting module — data unified (D-050)**: recruiting's Postgres data now lives in this
  project, schema `recruiting.*`, sharing `profiles` (new `recruiting_role` / `module_access`
  columns, both null/empty by default). RLS hardened at the same time — see §11.
- **Split loads**: at pickup the driver confirms how many pallets actually fit; a short
  load splits the order — loaded part keeps the order_no with suffix "a" (out for
  delivery), remainder becomes a new linked order with the SAME order_no and suffix "b",
  re-staged with no driver (`order_suffix` column, migration 012 + updated roles.sql
  insert guard; `orderLabel()` in utils renders "#1001a").
- **Warehouse pallet confirmation**: "Mark ready" now asks to confirm the pallet count
  (prefilled from the original estimate) and stamps `actual_pallets` with the stage move.
- **Single-device sessions** (Supabase mode): profile stores `active_session_id`
  (migration 013); signing in on a new device signs the old one out via realtime,
  landing it on /login?reason=session with an explanation.
- **Role defaults**: warehouse queue defaults to All; sales (like managers) lands on
  Pending; driver table shows Invoice # instead of SO (`ROLE_DEFAULT_COLUMNS.driver`).
- **Driver visibility**: drivers see only orders assigned to them or created by them
  (client filter + RLS migration 011).
- **Store per rep**: Users tab can assign a store to sales reps too; new orders prefill
  the creator's store. Demo: Sam Sales→Edinburg, Wade Warehouse→Pharr.
- Order form defaults the delivery window to **All Day (8:30–5:30)**.
- Invite emails: redirect origin now prefers NEXT_PUBLIC_SITE_URL, then the
  proxy-forwarded host — never localhost when invited from the deployed app.
- Demo seed: added 20 next-day orders (#1070–#1089, `delivery_date` = tomorrow) across
  all six stores with mixed stages/drivers/fees/pins (`demo-data.ts`; LS_KEY v12).
- Added `picked_up` stage: driver marks ready→picked_up→delivered (driver page has an
  "Out for delivery" tab). Removed the admin "Set status" selector.
- Driver "Navigate" buttons in the order view (canDeliver roles): open Google Maps
  (turn-by-turn pickup→delivery) or Waze with the trip.
- Selecting a store auto-fills pickup name + address. Intra-store order types
  ("Intra-Tienda"/"Transfer") make the delivery destination a store dropdown that fills
  the delivery address from the chosen store.
- Admin can set an order to ANY status ("Set status" selector; bypasses `canTransition`).
  Full history: field edits now log an "edited" event; Activity log shows actor + timestamp.
  Drivers can also submit/resubmit/cancel their own drafts.
- Added **driver** role (own view, logs orders like sales, marks delivered). **Warehouse**
  store-scoped + edits only pallets/prepared-status. **Re-delivery** tracking: repeats logged
  as new linked orders (redelivery_of/reason) via the "Record re-delivery" flow. **Exports**:
  Excel grouped-by-employee with collapsible rows (exceljs) + print-to-PDF, replacing the
  CSV-only button (CSV still available). Migrations 004; roles.sql updated for driver + redelivery.
- Stores & drivers now carry a map-searchable address ({name,address} jsonb, migration 003).
  New `LocationEditor` in Settings uses `AddressInput`; store address feeds routing origin.
- Approval gate hardened: `canTransition` guard in both providers blocks any move to
  warehouse stages without prior manager approval. Account field moved next to Contact.
- Warehouse/Fulfillment section in the order form is now hidden entirely from sales/manager
  (shown only to warehouse & admin). Details still visible to all in view mode.
- Pallets: sales sets `est_pallets`; warehouse revises `actual_pallets` (new column,
  migration 002). Warehouse field lives in the Fulfillment section; board shows actual if set.
- Address autocomplete: pickup & delivery addresses are real-time search inputs
  (`AddressInput` + `/api/geocode`); picking a suggestion recomputes mileage. Removed Pickup Name.
- Removed Pickup/Delivery Duration fields from the order form (auto-computed, not shown).
- Input Date + Input Military Time now auto-stamped at creation and removed from the form.
- Per-pallet duration formula in labels restricted to admin/manager (then fields removed entirely).
- Fully translated OrderModal (labels, buttons, messages, view-mode keys via colLabel).
- Added Orders board view (kanban by stage) + table/board toggle.
- Notifications open the related order via `/?order=<id>` deep-link.
- Added role-targeted in-app notification bell (Supabase + local, table + RLS + realtime).
- Distance/ETA now auto-calculates (debounced) as addresses are typed.

## 11. Recruiting module (D-050, D-051, D-052 — complete)

RECRUIT·HN used to be a separate Next.js app (`recruiting-app`). As of D-052 it's fully a
module inside this container app: same deploy, same repo, `/recruiting/*`. The old
`recruiting-app` repo/deploy/Supabase project still exist as a read-only fallback (see §"Old
recruiting project" below) but nothing in production points at them anymore.

- **Schema, not prefix.** Recruiting's 11 tables live in their own Postgres schema,
  `recruiting.*` (`candidates`, `contacts`, `jobs`, `stages`, `stage_history`, `attachments`,
  `questions`, `question_sets`, `templates`, `custom_fields`, `settings`) — not `public.*`.
  Deliveries' own `public.settings` and every other deliveries table are untouched. The
  `recruiting` schema must be added to Supabase → Settings → API → **Exposed schemas** for
  PostgREST to serve it (manual, one-time, not something a migration can do).
- **Identity is shared, permissions are not.** `public.profiles` — already deliveries' table —
  gained `recruiting_role` (`admin | manager | recruiter`, null = no role) and `module_access`
  (`text[]`, today only ever contains `'recruiting'` or is empty). These are independent of the
  deliveries `role` column (see §5). Every profile that existed before D-050 got
  `recruiting_role = null`, `module_access = '{}'` — nobody was granted access by the migration
  itself.
- **`has_recruiting_access()`** (`select recruiting_role is not null from profiles where
  id = auth.uid()`) replaced "any authenticated user" on all 11 `recruiting.*` tables and on
  `storage.objects` for the `resumes` bucket. Mirrors the existing `current_user_role()`
  pattern deliveries already used.
- **`guard_recruiting_access_change`** — a new trigger on `profiles`, deliberately separate
  from `guard_role_change` (untouched) — requires a **deliveries** admin (`current_user_role()
  = 'admin'`), not a recruiting admin, to change anyone's `recruiting_role` or `module_access`.
  Granting cross-module access is a container-level decision.
- **FKs cross schemas on purpose:** `recruiting.candidates.assigned_recruiter` /
  `created_by`, `recruiting.contacts.created_by`, `recruiting.stage_history.changed_by`, and
  `recruiting.attachments.created_by` all reference `public.profiles(id)` directly — normal in
  Postgres, no wrapper needed.
- **No local-mode exemption:** deliveries' rule that every data operation exists in both
  providers (Supabase + local demo) does NOT apply to the recruiting module — recruiting never
  had a local provider and doesn't get one now. Documented exception, not an oversight.
- **`resumes` Storage bucket** was recreated in this project (private, same RLS pattern) and
  its 49 objects copied over from the old recruiting project, same paths.
- **The old recruiting Supabase project (`cfawfwzndxumeufhcwga`) is untouched and stays alive**
  as a read-only fallback until production is validated for 1–2 weeks post-cutover — see D-050.
- **The UI is ported.** 9 pages under `src/app/recruiting/(recruiting)/`: bare `/recruiting`
  is candidates (deliberately — recruiting's original `/` was a "Today" dashboard; the
  candidates list took the module's root instead, and that stays true — see below), plus
  `board`, `calendar`, `metrics`, `outcomes`, `questions`, `settings`, `users`, `today`.
- **`/recruiting/today` (D-061)** is the daily action list — interviews scheduled today,
  outcomes past the 3h grace period, follow-ups due, and new candidates with no phone
  interview scheduled yet. It reads no state of its own: every row is derived from fields
  Calendar/Outcomes/Candidates already read off `candidates` (`phone_date`, `inperson_date`,
  `follow_up`, `status`, `reg_date`). D-059 had removed the "Today" tab as a dead link
  (nothing behind it — the original recruiting-app's Today page was never ported, and its
  source isn't in this repo to port from); this rebuilds it from scratch against the current
  data model rather than resurrecting the old one. Root `/recruiting` stays Candidates —
  Today is a tab, not a reclaimed root, so D-052's decision isn't reopened.
- **`(recruiting)` is a sibling of `(app)`, never nested under it.** It has its own
  `layout.tsx` — own profile fetch, own `DataProvider` (`src/lib/recruiting-data-provider.tsx`,
  Supabase-only, no local variant — see D4/D-050), own `TopBar`
  (`src/components/recruiting/*`). Nothing from `(app)/layout.tsx` is inherited: no deliveries
  realtime channels, and critically no `DriverGate`/`LocationTracker` — those are deliveries-
  driver-only concepts that have no business mounting on a recruiting page. The recruiting
  layout has its own access guard: no `recruiting_role` → `redirect(landingRoute(...))`, the
  same function that sends a driver to `/driver` unconditionally (D-051) — so `/recruiting/*`
  is exactly as unreachable to a driver as `/home` is, by construction, not by convention.
- **Supabase clients under `src/lib/recruiting/supabase/*`** are built with
  `db: { schema: "recruiting" }`, so every `.from()` call defaults there. The one recurring
  exception: `profiles` lives in `public`, so every query against it uses
  `.schema("public").from("profiles")` explicitly — four spots in the data provider, one in
  Settings (display name), two in the `/api/recruiting/*` routes' admin checks, one in the
  realtime subscription list (`postgres_changes` always needs the real schema, regardless of
  the client's default).
- **CSS: scoped under `.recruiting-module`, not a second global stylesheet.**
  `src/app/recruiting/recruiting.css` is recruiting's original `globals.css` with every
  selector — including its `:root` CSS variables and bare element selectors (`body`, `button`,
  `input`, `a`, `label`) — rewritten to `.recruiting-module <selector>`. This mattered more than
  a normal "avoid class collisions" pass: Next.js bundles all imported CSS sitewide regardless
  of which route is active, so an unscoped `body { font-family: ...; background: var(--paper) }`
  would have silently changed deliveries' own `<body>` styling depending on CSS load order.
  Verified by grepping the compiled `.next/static/css/*.css` output for any recruiting-only
  class (`.cand-row`, `.kb-board`, etc.) appearing without the `.recruiting-module` prefix —
  zero hits.
- **`usePrefs()` (deliveries' own theme/lang context) is reused; recruiting's `I18nProvider`
  was never ported.** `PrefsProvider` already wraps the entire app from the root
  `app/layout.tsx`, so every recruiting component gets light/dark theme and EN/ES for free —
  `useI18n()` calls were mechanically renamed to `usePrefs()` (identical `t(en, es)` signature).
- **Three bugs found and fixed while porting, all the same shape:** something written for
  recruiting's *own* `profiles.role` column, now confused by deliveries' shared `role` column
  on the same table.
  1. `updateUserRole` wrote `role` instead of `recruiting_role` (fixed in the base-port commit).
  2. `reloadAll()`'s "recruiters" query read `profiles.role` (deliveries' role) with no filter —
     any deliveries user, including a driver, would have shown up in recruiting's Users page,
     and `ROLE_INFO[u.role]` (only defined for admin/manager/recruiter) would have thrown on a
     value like `"driver"`. Fixed: query now filters `recruiting_role is not null` and maps
     `recruiting_role → role` in memory.
  3. `/api/recruiting/delete-user` (ported from recruiting's `/api/delete-user`) used to call
     `admin.auth.admin.deleteUser()` — correct when recruiting was someone's only account, but
     that account is now the shared deliveries identity. Changed to *revoke recruiting access*
     (null `recruiting_role`, drop `'recruiting'` from `module_access`) instead of deleting the
     auth user. `/api/recruiting/invite` and `/api/recruiting/delete-user` are their own
     namespace — deliveries' own `/api/invite`/`/api/delete-user` are untouched.
- **User management unified into deliveries' own `/users` (D-053).** Two separate Users
  screens editing the same shared `profiles` row was the exact pattern that produced the three
  bugs above — someone edits meaning one column and hits the other. `UserDialog.tsx` gained an
  "Access to other modules" section (checkbox + `recruiting_role` picker per module, driven by
  the shared `MODULES` list in `constants.ts`) and a new, deliberately separate function,
  `updateUserRecruitingAccess()` in `data-provider.tsx` — it can't be confused with
  `updateUserRole()` because it has a different name and a different signature, and it writes
  `recruiting_role`/`module_access` only. `src/app/recruiting/(recruiting)/users/page.tsx` is
  now a one-line `redirect("/users")`, the same pattern `/home` already used for
  `landingRoute()`. `recruiting-data-provider.tsx` lost `updateUserRole`, `updateUserAvatar` and
  `deleteUser` (only that retired page called them); `/api/recruiting/invite` and
  `/api/recruiting/delete-user` were deleted, and with them
  `src/lib/recruiting/supabase/admin.ts` (recruiting's service-role client), which had no
  importer left. The read-only `recruiters` list (candidate-assignment dropdowns in
  `board`/`candidates`) is untouched — that's not user management.
- **This closed a real authorization gap, not just a UI one.** The two retired endpoints
  authorized by `recruiting_role === 'admin'` (a recruiting admin) using a service-role client —
  which the `guard_recruiting_access_change` trigger treats as trusted (`auth.uid()` is null),
  bypassing its own requirement that a *deliveries* admin make the change. A recruiting admin
  who wasn't also a deliveries admin could revoke someone's access without the trigger ever
  seeing it. The unified `/users` is deliveries-admin-only already (`me.role !== 'admin'` in
  `users/page.tsx`, unchanged), so `updateUserRecruitingAccess()` is a plain client-side
  `profiles` update — same pattern `updateUserRole`/`updateUserStore`/`updateUserPermissions`
  already use — and the trigger is now the *only* authority, not a second opinion an API route
  could route around.
- **Resolved the "grant access to an existing user" gap** noted above: since the dialog already
  operates on an existing profile, granting recruiting access is just that same client-side
  `UPDATE` — no invite email needed. The dialog's checkbox default when checked with no tier
  chosen is `recruiter`, matching what the old invite flow always defaulted to.
- **App switcher, generic for N modules (D-054).** `ModuleSwitcher.tsx` (`src/components/`, a
  sibling of both `TopBar.tsx` files — not inside `recruiting/`) is mounted by both TopBars and
  lets someone with 2+ modules jump directly between them without returning to `/home`. It's
  pure presentation — props only (`{ current, deliveriesRole, moduleAccess }`), no hook from
  either `DataProvider` — which is what lets one file live in both route groups without
  reintroducing anything D-052's isolation was protecting against (GPS tracking, deliveries'
  realtime channels): a component with no data of its own can't leak either. `constants.ts`
  exports `DELIVERIES_CARD` and `accessibleModules(moduleAccess)` — the one place that turns a
  `module_access` array into the ordered list of reachable modules (deliveries always first);
  `HomeSelector` and `ModuleSwitcher` both call it instead of each filtering `MODULES` on their
  own. A third module is one entry in `MODULES` — neither component changes.
- **`deliveriesRole`, never `role`, in the switcher's props — same bug class as D-052's #1/#2,
  closed by naming.** Inside recruiting's own `TopBar`, `me.role` means `recruiting_role`. The
  switcher only ever needs the DELIVERIES role (it's what decides the driver exception and
  where "back to Deliveries" lands), so the prop is named to make that collision impossible to
  reintroduce by accident. `recruiting/(recruiting)/layout.tsx` already selected
  `profile.role`/`profile.module_access` (needed them for the `landingRoute()` guard) but
  discarded both when building `RecruitingProfile` — they're now passed to `TopBar` as separate
  props, never folded into that type, which stays recruiting's own shape.
- **Destination per module:** deliveries uses `roleHome(deliveriesRole)`, never `landingRoute()`
  — that would return `/home` again for anyone still holding 2+ modules, turning "switch to
  deliveries" into a bounce back to the selector. Other modules use their own `MODULES[i].href`.
  `HomeSelector`'s own deliveries card had the same problem in a different shape — its `href`
  was hardcoded to `"/"`, harmless only because the sole 2+-module user today is admin
  (`roleHome('admin') === '/'`); a warehouse or logistics user would have landed on the Orders
  board instead of `/warehouse`/`/routes`. Fixed in the same change so the hub and the switcher
  behave identically.
- **The hub hosts shared tools now, not just the module picker (D-056).** Users moved out of
  deliveries entirely, to `/home/users` — it was never really "deliveries' own" screen once D-053
  let it grant Recruiting access too. `HUB_TOOLS` in `constants.ts` is the generic registry: a
  sibling of `MODULES`, but granted by ROLE (`visible(me)` predicate) instead of by
  `module_access` membership, because nobody is "given" Users the way they're given a module —
  an admin has it because they're an admin. `HomeSelector` and `ModuleSwitcher` both read this
  same list, so a second shared tool is one entry there, not a change to either file.
- **Landing vs. staying are two different questions now — `landingRoute()` itself didn't
  change.** An admin with only deliveries still lands on `/` after login, same as always. What's
  new is `home/page.tsx`'s own guard: `hasReasonToBeHere = accessibleModules(...).length > 1 ||
  HUB_TOOLS.some(t => t.visible(me))`, a separate expression, not a change inside
  `landingRoute()` itself — that admin's landing route is still their own module, but they now
  have an explicit way back to `/home` for Users. `ModuleSwitcher` mirrors the split: `⇄` (jump
  to another module) still needs 2+ modules; `⌂` (back to the hub) needs 2+ modules *or* a
  visible hub tool, so a deliveries-only admin sees `⌂` alone, with nowhere to swap to.
- **`(app)/users/page.tsx` and `recruiting/(recruiting)/users/page.tsx` are both redirects now**
  (to `/home/users`) — no URL from before the move goes dead. `home/users/layout.tsx` is a
  Server Component gate (`redirect()` before anything mounts, same pattern as recruiting's own
  layout guard) — a real hardening over the old Client Component page, which used to mount the
  `DataProvider` and load everyone's profile before showing a non-admin "Admins only." The actual
  authority never moved either way: `guard_recruiting_access_change` (D-050) still requires a
  deliveries admin for any write to `recruiting_role`/`module_access`, regardless of which URL
  the request came from.
- **The retired `"users"` capability.** `CAPABILITIES`/`ROLE_CAPS`/the `Capability` type used to
  carry a grantable `"users"` extra permission — but the screen it gated always required
  `role==='admin'` outright, so granting it to a non-admin only ever led to "Admins only." It
  never worked; removed in the same change rather than left as a checkbox with nothing behind it.
- **`UserDialog.tsx` is a block per module now, not three hand-written, asymmetric sections
  (D-057).** `MODULE_ACCESS` (`constants.ts`) is the permissions-dialog counterpart to
  `MODULES`/`HUB_TOOLS` — same "N modules as data, not N hand-written UI blocks" idea, but a
  different shape: those two describe navigation cards, this describes which **profile column** a
  block edits (`roleColumn: "role" | "recruiting_role"`, optional `accessColumn`/`capabilities`).
  Deliveries is `alwaysOn` (no checkbox — `profiles.role` is `NOT NULL`, there is no "no module"
  state anywhere in the schema to offer); recruiting is opt-in, same as always. A module with no
  fine-grained capabilities (recruiting today) simply omits `capabilities` from its descriptor and
  that part of its block never renders — no special-casing in the component.
- **The write side stays deliberately less generic than the render side, on purpose.**
  `MODULE_ACCESS[i].key` is `ModuleAccessKey`, a closed union (`"deliveries" | "recruiting"`), not
  the open `string` `MODULES`/`HUB_TOOLS` use — because `UserDialog.tsx` dispatches every write
  through an exhaustive `switch` on that key (`setModuleRole`/`setModuleAccess`, the
  `const _exhaustive: never = key` idiom). A module added to the array without a matching switch
  case fails `tsc`, not a silent `UPDATE` against the wrong column at runtime — the exact class of
  confusion (`role` vs `recruiting_role`) that produced two of D-052's three bugs. A second,
  cheaper defense sits in `landing-route.test.ts`: `MODULE_ACCESS.map(m => m.roleColumn)` asserted
  to have no duplicates, so two modules ever aiming at the same column fails a test, not a review.
  The three write functions in `data-provider.tsx` (`updateUserRole`, `updateUserPermissions`,
  `updateUserRecruitingAccess`) were not touched or merged — the generic part is what gets
  rendered, never what gets written.

## 12. Timetracker module (D-064→D-080 — data, UI, real data, desktop client, all done)

A third module joining the container, same two-stage shape as recruiting (D-050→D-052): data
first, UI later. As of D-064 only the data stage is done — `timetracker.*` exists in this
project's Postgres with real RLS, but no `/timetracker/*` route group yet and no real employee
data migrated. Source app: `timetracker-clean` (separate repo, Vite + React, own Vercel
project, own Supabase project `qklsxhzmbnglgzufdbmz`) — an Upwork-style time tracker with a web
client and a Windows Electron desktop client.

- **Genuinely different shape from recruiting, not a repeat of the same playbook.** Recruiting
  was Next.js-to-Next.js — becoming a sibling route group was mechanical. Timetracker is a Vite
  SPA with no `react-router` (tab state, not URL routes) with a THIRD client on top of web:
  Electron desktop. As of D-074 it no longer bundles the Vite build locally — `main.js` calls
  `loadURL(<the hosted /timetracker route>)`, same shape as the driver APK's Capacitor
  `server.url` — instead of keeping a second, separately-maintained Vite/React tree alive
  forever alongside the ported one. See D-074 below for what porting the desktop-only bridge
  behavior into the Next.js route required before this repoint was safe to make.
- **`public.profiles` gains `timetracker_role` (`admin | employee`, null = none) and
  `'timetracker'` as a third valid `module_access` value** (migration 058) — same shape as
  `recruiting_role`, independent trigger (`guard_timetracker_access_change`,
  `protect_last_timetracker_admin`), same "only a deliveries admin changes this" rule as 055.
- **Unlike recruiting, timetracker's original `profiles` row was NOT thin** — 8 columns of its
  own (`pay_method`, `pay_details`, `worker_type`, `track_mode`, `breaks_enabled`, `active`,
  `city`, `deleted_at`). Bloating the shared `public.profiles` with pay/HR data every other module
  would carry around forever was rejected — those 8 columns live in
  `timetracker.employee_settings` instead, a companion table 1:1 with `public.profiles` via `id`.
  Only identity + access (`timetracker_role`, `module_access`) sit on the shared table, same
  boundary recruiting already established.
- **`timetracker.*` schema (migration 059): 8 tables** — `employee_settings`, `projects`,
  `assignments`, `sessions`, `requests`, `payrolls`, `settings` (singleton `id='app'` holding a
  jsonb config blob, not per-column like recruiting's `settings`), `audit`, `screenshots`. Built
  from timetracker's CURRENT final shape (base tables + every later `alter table add column`
  folded in), not its migration history — same approach 056 took for recruiting.
- **RLS (migration 060) is deliberately MORE granular than recruiting's.** 057 gave recruiting one
  flat rule (`has_recruiting_access()` for everything) because nothing in recruiting is
  per-row-private among its own members. Timetracker isn't: `sessions`/`requests`/`payrolls`/
  `screenshots` are owner-or-admin (an employee reads their own pay and their own screenshots,
  never a coworker's) — this is the exact privacy boundary timetracker's own history already had
  to fix once (their old Firebase rules let any employee read everyone's pay). `projects`/
  `assignments`/`settings` stay read-all-members/write-admin-only, matching recruiting's shape
  where there's no ownership to protect.
- **A real privilege-escalation bug was caught and fixed before this ever reached production
  data.** The first cut of `is_timetracker_admin()` was `select timetracker_role = 'admin' from
  profiles where id = auth.uid()` — for anyone with `timetracker_role is null` (i.e. every normal
  employee) that expression evaluates to SQL `NULL`, not `false`. A plpgsql guard written as `if
  not is_timetracker_admin() and ... then raise exception` silently let it through, because `not
  NULL` is `NULL`, and `NULL` is falsy to an `if`. Caught by testing the exact self-escalation path
  (rolled-back transaction impersonating a non-admin) before trusting the migration, the same
  verification discipline used everywhere else in this project. Fixed by wrapping both
  `is_timetracker_admin()` and `has_timetracker_access()` as `select coalesce((select ...),
  false)` — never returns anything but a real boolean, even when the profile row doesn't exist at
  all. RLS `using` clauses were never at risk (NULL already behaves like false there); the risk was
  specifically a boolean helper used inside imperative `if` logic.
- **GRANTs were missing entirely, and this exposed that recruiting's are undocumented.**
  `create schema` grants nothing but ownership by default — RLS only runs after the plain
  SQL-standard GRANT check passes. Migration 061 grants `USAGE`/table privileges to
  `anon`/`authenticated`/`service_role` on `timetracker.*`, plus `alter default privileges` so a
  table added later inherits them automatically. Comparing against production turned up that
  `recruiting.*` has the identical grants already — but they were never captured in 055/056/057 or
  anywhere else in this repo; someone applied them by hand once, outside any migration. Not fixed
  retroactively here (out of scope for this change), but worth knowing: `recruiting`'s migration
  files alone do not fully reproduce its own schema from empty.
- **The exact same "manual step outside any migration" class of gap bit again, worse, in D-077:**
  `timetracker` was never added to the Supabase project's exposed-schemas API config
  (`db_schema`, set via `PATCH /v1/projects/{ref}/postgrest` — platform config, not a Postgres
  object, so no `.sql` migration could have covered it). Every `supabase.from(...)` call scoped to
  `db: { schema: "timetracker" }` — i.e. everything `timetracker-data-provider.tsx` has ever done —
  failed with `PGRST106: Invalid schema` from D-066 onward. A failed `select` just returns no rows
  to `supabase-js`, not a thrown error, so every screen rendered its normal empty state instead of
  visibly breaking; `tsc`/`vitest`/`next build` never touch production Supabase, so none of them
  could have caught it either. Unnoticed until D-073 put real data in place worth expecting to see,
  found only when an actual browser-facing REST call (`Accept-Profile: timetracker`) was tested
  instead of continuing to verify with the management-API SQL connection that bypasses PostgREST
  (and its schema-exposure check) entirely. Fixed by adding `timetracker` to `db_schema` via the
  same Management API. **If a fourth module is ever added, this exact step has to be remembered by
  hand again** — there is still nowhere in this repo that automates or checks it.
- **D-073's migration turned out to have a real cutoff gap, confirmed and closed the same day
  (D-078).** D-073 ran mid-afternoon on 2026-08-20; the desktop wasn't repointed at the live site
  until D-074, a day later, so people kept tracking time on the OLD standalone app for hours after
  the snapshot. Found via a direct report ("I worked until 11pm, only see screenshots up to 2pm"),
  not proactively. Row ids are preserved 1:1 between the old and new projects (D-073's own
  convention), which made finding exactly what was missing mechanical: compare by `id`, `UPDATE`
  the one session D-073 captured mid-flight (still-live when the snapshot ran) to its final values,
  `INSERT ... ON CONFLICT (id) DO NOTHING` everything genuinely new. Confirms D-075's flagged risk
  isn't theoretical: as long as `timetracker-clean/web` stays live and in use, this exact class of
  gap can recur, and the fix pattern here (compare-by-id, same `ID_MAP`, idempotent insert) is
  reusable next time rather than needing to be re-derived.
- **D-073 also silently skipped `timetracker.settings` — company-wide config, not per-employee data
  — found the same day (D-079).** Of the 8 tables D-073 migrated, `settings` (a single `id='app'`
  row) wasn't one of them; the row that existed came from whatever the schema migration seeded, not
  from the old project's real config. Concretely: `weekStartDay` was `6` (Saturday, the code
  default) instead of the real `5` (Friday), and `appName`/`timeZone`/`workApps`/`locations`/
  `idleLimitMin` were missing outright — `timeZone` in particular silently fell back to
  `BROWSER_TZ` (whoever's own machine), not a fixed business timezone, for anyone who opened the
  app before this was fixed. Found while chasing a seemingly unrelated symptom: Track Time's "This
  week" total (`TrackedTotals`) showing 50.17h instead of a verified-correct 56.40h. That
  component's own logic — falling back to the company default week-start-day when no project is
  selected — is original, ported behavior (D-066), not a bug; the REAL bug was that the "company
  default" it fell back to was wrong. Fixed with a targeted `UPDATE ... data || '{...}'::jsonb`
  restoring exactly the old project's real values, leaving already-correct keys
  (`paymentMethods`/`adjustmentTypes`/etc., which *had* made it over) untouched. The restored
  `timeZone` (`America/Tegucigalpa`) deliberately does NOT match deliveries/recruiting's
  `America/Chicago` (see `business_timezone_hydration`) — preserved as-is rather than unified,
  since picking one business timezone for the whole container is a real decision with payroll-week
  implications, not something to default silently out of a bug report.
- **The desktop shell had no way to ever show dark mode — closed the same day (D-080).** Root
  `layout.tsx`'s pre-paint theme script (shared by the whole container) unconditionally set
  `data-theme="light"` whenever nothing was saved in `localStorage` yet — never left the attribute
  absent, which is the one condition under which `.timetracker-module`'s own CSS (D-066) already
  defaults to a complete dark palette (`--tt-bg:#0f1420`, described in D-072 as "designed for the
  original's dark-mode default"). A brand-new Electron session has empty `localStorage` by
  definition, so the desktop client always landed on light — not a missing feature, a default that
  was silently winning every time. Fixed in two places that both need to agree (the inline script
  AND `PrefsProvider`'s own initial React state in `prefs.tsx`, which otherwise re-applies light a
  moment later): both now check `window.ttDesktop` and default to dark there specifically, only
  when no explicit choice has ever been saved. A ☀️/🌙 toggle was added to timetracker's `TopBar`
  (`usePrefs().toggleTheme()`, the same shared mechanism deliveries/recruiting use) — nothing in
  the module exposed changing theme at all before this. Separately, `desktop/main.js` gained
  `Menu.setApplicationMenu(null)` (Electron's default File/Edit/View/Window/Help menu bar has no
  use in a single-purpose client) and a matching `backgroundColor: '#0f1420'` on the `BrowserWindow`
  so the window paints the right color before the page even loads, instead of Electron's own
  default showing through as a mismatched void around the content.
- **Storage bucket renamed `timetracker-screenshots`, not `screenshots`.** The original app owned
  that name outright in its own project; here it shares a flat Storage namespace with deliveries'
  own buckets and recruiting's `resumes`, so it gets the same module-prefixed treatment. Path
  convention inside the bucket is unchanged: `<employee_uid>/<session_id>/<timestamp>.jpg`.
- **The "first signup becomes admin" trigger from timetracker's original schema was deliberately
  dropped, not ported.** It made sense for a brand-new, empty app; meaningless — and dangerous —
  once merged into a container with years of existing users and an existing admin. Access is
  granted the same way recruiting's is: an existing deliveries admin sets `timetracker_role` from
  the hub's Users dialog (D-057's `MODULE_ACCESS` pattern will need a third entry once the UI
  exists), never by signing up. `public.handle_new_user()` was not touched by this migration.
- **No real data migrated yet, and no `/timetracker/*` route exists** (true as of D-064; both are
  done as of D-071/D-073 — see below). Old `qklsxhzmbnglgzufdbmz` project stays live and untouched
  as a fallback, same posture D-050 used for recruiting's old project.
- **Real data migrated (D-073).** All of the old project's history — 4 projects, 3 assignments,
  231 sessions, 4 already-paid payrolls ($1,641.23), 7 requests, 50 audit entries, 1,921 real
  screenshot files (814 MB) — now lives in `timetracker.*` and its Storage bucket. Only 3 real
  people existed in the old roster (a 4th was an already-deleted test account with zero rows
  anywhere, safely skipped); 2 already had deliveries accounts and just got `timetracker_role`
  granted, 1 (Nick Huerta) got a new deliveries account scoped to `module_access: ['timetracker']`
  only, per explicit instruction that a timetracker-only person should get nothing else. A real
  RLS bug was caught before any file was copied: migrated `screenshots.path` initially kept the
  OLD employee id as its folder prefix, which `storage.objects`' owner-read policy checks against
  `auth.uid()` — the new employee would never match, silently blocking their own screenshots (an
  admin would still see them via `is_timetracker_admin()`, masking the bug for anyone who only
  tested as admin). Fixed by rewriting `path` to the new employee id before uploading. The first
  copy attempt also hit Supabase Management API rate limits from ~2000 individual per-file path
  UPDATEs (looked like failed copies; the files themselves had mostly already uploaded) — fixed by
  batching updates 200 at a time instead of one per file.
- **Wired into the hub and the Users dialog ahead of the UI port (D-065)** — `MODULES`,
  `MODULE_ACCESS`, and `updateUserTimetrackerAccess()` (mirroring `updateUserRecruitingAccess()`
  exactly, in both `DataState` implementations) all got a `timetracker` entry, same as D-054/D-057
  did for recruiting. The module card can 404 today (`/timetracker` doesn't resolve yet) — the
  same brief mid-port state recruiting was in during D-052 — but nobody has `timetracker` in
  `module_access` in production yet, so nothing is actually reachable until an admin deliberately
  grants it through the now-wired dialog.
- **Wiring the third module surfaced a bug the first two never would have.** `UserDialog.tsx`'s
  current-role lookup was `m.roleColumn === "role" ? u.role : (u.recruiting_role ?? undefined)` —
  correct with exactly two modules only by coincidence (everything that wasn't `"role"` happened
  to be recruiting's column), and would have shown recruiting's role inside timetracker's block.
  Fixed to a real generic lookup, `u[m.roleColumn]`. The WRITE side was already safe — D-057's
  exhaustive `switch` fails `tsc` if a module's case is missing — but that compile-time guarantee
  never covered this READ. Three data points establish a pattern that two can't.
- **`/timetracker` is a real page now (D-066, Etapa 2 pass 1) — Track Time only, everything else
  still pending.** `timetracker/(timetracker)/` is a third sibling route group, same independence
  as recruiting's: own `layout.tsx` (auth guard, no deliveries providers), own `DataProvider`
  (`src/lib/timetracker-data-provider.tsx`), own `TopBar`, own scoped CSS
  (`.timetracker-module`, same reasoning as `.recruiting-module` — D-052).
- **camelCase, not snake_case — a deliberate divergence from recruiting-data-provider.tsx.**
  Recruiting's types are shaped exactly like their Postgres rows (`resume_path`,
  `stage_changed_at`); timetracker's are camelCase (`durationSeconds`, `hourlyRate`), matching
  the ORIGINAL Vite app's own convention. `src/lib/timetracker/supabase/rowcase.ts`
  (`rowToCamel`/`toSnakeRow`, ported from timetracker's own `shared/lib/supabase.js`) converts at
  the data-provider boundary — one place, not scattered. Chosen because every ported screen's
  internal logic already reads/writes camelCase throughout; rewriting that across ~18 screens for
  a purely cosmetic consistency gain was rejected as unnecessary risk for zero functional benefit.
- **`timetracker.employee_settings`, not the shared `public.profiles` row.** `Employee` in
  `lib/timetracker/types.ts` is assembled server-side in `layout.tsx` from TWO queries — the
  shared `profiles` row (identity + `timetracker_role`) and `employee_settings` (059) — because,
  unlike recruiting's near-empty profile, timetracker's has 8 module-specific columns (pay info,
  track mode, activation status) that don't belong on a table every module reads.
- **`lib/timetracker/i18n.ts` — a ported KEY-based dictionary (`t('track.start')`), not
  deliveries' `usePrefs()`/`t(en,es)` inline pairs.** Every one of timetracker's screens already
  calls it the dictionary way; converting hundreds of call sites to match `usePrefs()`'s signature
  would be a much bigger, riskier rewrite for no functional gain. Ported near-verbatim from the
  original's `web/src/lib/i18n.js` (full EN+ES dictionary, ~450 keys), including its
  module-level-state-plus-subscribers pattern (`useT()` re-renders on `setLang()`).
- **`lib/timetracker/helpers.ts` — also ported near-verbatim**, including its unusual (for this
  codebase) mutable-module-global `APP_SETTINGS`, synced from the settings row on every
  `DataProvider` reload (`syncAppSettings()`). Deliveries/recruiting read settings from React
  context; timetracker's date/money/pay formatting helpers are plain functions called far outside
  any component tree (sorting, labels), so they can't read a hook — same reason the original had
  this shape. Kept, not redesigned, for the same "don't touch what already works" reasoning as the
  i18n port.
- **Desktop-only behavior was ABSENT in this pass (D-066), then ported for real in D-074** once
  the desktop shell was repointed at this same hosted route instead of a locally-bundled Vite
  build. `isDesktop()` (`src/lib/timetracker/desktop.ts`) checks `window.ttDesktop` at runtime —
  present only inside the Electron shell (its preload script), absent in a plain browser tab — so
  the exact same page/component tree now serves both clients, gated at runtime rather than by two
  separate builds. What's gated this way: system-wide activity metering (desktop) vs.
  focus-gated keydown/mousedown listeners (web); smart-idle screen-motion detection (desktop
  only — a browser tab can't read the rest of the screen); native screenshot capture, uploaded
  from the renderer via new `uploadScreenshot`/`insertBlankScreenshot` data-provider functions
  (RLS already allowed employee-owned inserts since D-064; nothing new needed there); and
  auto-stop on OS lock/sleep. See D-074 for the full account, including why skipping this port
  and repointing `loadURL` directly would have quietly gutted the desktop app's reason to exist.
- **The three gaps D-074 tracked here were closed in D-075**, same day, on request ("hazlos
  todos"): `lib/timetracker/offlineQueue.ts` (new) buffers session patches (localStorage) and
  screenshots (IndexedDB) on a failed write and flushes on reconnect or every 30s — unlike the
  original, it takes `updateSession`/`uploadScreenshot` as parameters instead of importing its own
  Supabase client, so the schema-scoped client and camelCase conversion stay only in the data
  provider; `notify()` now also fires a real browser `Notification` when permission is granted and
  the page ISN'T running in the desktop shell (which already draws its own floating toast for the
  same events — see the comment on `notify()` in `timetracker-data-provider.tsx`), with the two
  missing trigger points (weekly-limit warning, "tracking started") added back into Track Time;
  `TtUpdateBanner`/`TtCheckUpdateLink` (new, `components/timetracker/UpdateBanner.tsx`) report
  `desktop/main.js`'s `tt:update` IPC state in-app, desktop-only.
- **Investigating one of those gaps surfaced a real, unresolved risk, not a settled fact.**
  `timetracker-clean/web` — the original standalone Vite app, nominally superseded by this port —
  turned out to still be live and in active use: its recent commit history is real production bug
  fixes, not dead code, and it still points at the OLD Supabase project (`qklsxhzmbnglgzufdbmz`),
  not the one this module's `/timetracker` reads from since D-073. Anyone still using it is writing
  to a database this app never sees, and vice versa — a silent split that gets worse the longer it
  runs. Confirmed directly with the person who'd know rather than assumed either way. Not something
  this repo's code can fix: flagged as an open warning at the top of `timetracker-clean/CLAUDE.md`,
  `DEPLOY.md`, and `RELEASE.md` instead of writing docs that quietly treated it as decided.
- **`/timetracker/week` (D-067) — the second screen, a closer 1:1 port than Track Time.** A
  read-only weekly timesheet with no desktop/offline/live-tick concerns, so it translated more
  directly. Added `myPayrolls` to the data provider, same `reloadAll()` + `employee_uid`-filtered
  realtime shape as `mySessions`. The original's own `SettingsContext` wasn't ported — `settings`
  already lives on `useData()` since D-066, so this screen just reads that instead of standing up
  a second context for the same data.
- **`/timetracker/requests` (D-068) — the third screen: a form + insert + list, no new design
  decisions.** Added `myRequests`/`addRequest()` to the data provider, same shape as `myPayrolls`.
- **Employee side complete (D-069): `/timetracker/diary` + `/timetracker/account`.**
  `components/timetracker/WorkDiary.tsx` is a SHARED component (ported once) — the original reuses
  it between the employee's own diary and the manager's per-employee view, so the still-pending
  manager screen will reuse this same file rather than a second copy. `myScreenshots` (all of
  mine, not just the latest) replaced the single `latestScreenshot` state in the data provider;
  Track Time now reads `latestScreenshot` as a derived value (`myScreenshots[0]`) instead of its
  own fetch. `Employee.email` is new — sourced from `auth.users` server-side in `layout.tsx`, not
  `public.profiles` (which, unlike timetracker's original profile row, has no email column; the
  real address lives in Auth). Saving the account page is two writes, not one: `full_name` to the
  shared `public.profiles`, everything else to `timetracker.employee_settings` (upserted, since
  nobody creates that row on grant — D-064). Noted but explicitly NOT fixed here: deliveries'
  `public.profiles` UPDATE policy is `USING true WITH CHECK true` — "only your own row" is enforced
  by the client's `.eq('id', me.id)` filter, not the database. Pre-existing, consistent with how
  `UserDialog.tsx` already relies on the same trust model; out of scope for this change.
  All 5 employee-side screens now exist; the manager side (10 screens) is what's left.
- **Manager side starts (D-070): `/timetracker/insights`, the dashboard.** First screen needing
  company-wide data, not just "mine." `timetracker-data-provider.tsx` gained a manager-only
  section — `allEmployees`/`allProjects`/`allAssignments`/`allRequests` (reference data, kept live
  via `reloadAll()`/realtime, same shape as the employee-scoped fields) — but deliberately NOT
  company-wide `sessions` the same way. Time entries are an unbounded, ever-growing dataset;
  bulk-loading and realtime-subscribing to ALL of them (safe for `mySessions`, scoped to one
  person) wouldn't scale. Manager screens call `sessionsSince(startISO)` on demand instead — a
  plain query, not part of the live state. `TABS` split into `TABS` (employee) and `MANAGER_TABS`
  (admin, dashboard first, employee's own tabs after — an admin can still track their own time,
  same ground the original's "View as employee" toggle covered, just as separate routes instead of
  a mode switch). A genuine Rules-of-Hooks bug was caught before it shipped: the first cut put the
  `role !== "admin"` early-return BEFORE the page's own hooks, which is invalid — React requires
  hooks called unconditionally, same order every render. Fixed by moving the gate to just before
  the JSX return; the hooks run either way (harmless for a non-admin, since `sessionsSince` already
  no-ops server-side).
- **Etapa 2 complete (D-071): all 10 manager screens landed in one push** (`hazlo todo de una vez`).
  `/timetracker/live`, `/team-requests`, `/projects`, `/assignments`, `/people`, `/team-diary`,
  `/audit`, `/settings`, `/reports`. 15 screens total, 5 employee + 10 manager.
  - **`/timetracker/people` is deliberately SMALLER than the original's `ManagerPeople.jsx`.** Role
    changes, account creation (the original called a `create-user` Edge Function that doesn't even
    exist in this Supabase project), and account deletion are NOT here — D-053/D-057 already
    established that identity/access lifecycle lives in the hub's Users dialog, not inside a
    module; recruiting doesn't manage its own users either. Only genuinely module-scoped fields
    stayed: worker type, track mode, breaks, and the `active` onboarding toggle
    (`timetracker.employee_settings`, independent of module access — see D-064). Renaming and pay
    info remain self-service only (My Account, D-069), matching the original's own boundary there.
  - **`/timetracker/settings` deliberately drops two of the original's features.** No backup/
    restore: the original's JSON export/import wrote to `profiles` directly via `upsert` — in this
    container that's the identity table every module shares, and a bad restore could silently
    overwrite another module's role/store/driver data for unrelated people. Not a small fix; needs
    its own `timetracker.*`-only design before it's safe. No theme toggle: this container already
    has ONE shared theme mechanism (`data-theme`, D-052) that `.timetracker-module`'s own CSS
    already listens to; a second toggle would just fight the first.
  - **`/timetracker/reports` doesn't export Excel/PDF.** That used a separate library
    (`lib/exportTimesheet.js`) not ported. CSV export (no extra dependency) covers the same data and
    IS ported; the printable receipt (the browser's own print dialog, no library needed) is also
    ported in full. The calculation logic itself — the highest-stakes code in the whole module,
    since it computes and records real payroll — was translated as literally as possible, not
    redesigned, same reasoning as Track Time (D-066).
  - **Two routes were renamed to avoid collisions the original didn't have to worry about.** The
    original overloads one "Requests"/"Work diary" tab with different content depending on
    employee-vs-manager mode; URL-based routing needs two distinct paths instead:
    `/timetracker/requests` (D-068, an employee's own) vs. `/timetracker/team-requests` (the
    approval queue), and `/timetracker/diary` (D-069) vs. `/timetracker/team-diary`.
    `components/timetracker/WorkDiary.tsx` (ported once, D-069) is reused as-is by team-diary —
    the exact reason it was pulled out as a shared component in the first place.
  - **Provider gained `liveSessions` and `auditLog` as genuinely live (realtime-subscribed) state**
    — unlike `sessionsSince`, both are bounded in practice (a handful of people clocked in at once;
    the latest 300 audit rows), so continuous subscription doesn't have the unbounded-growth
    problem raw company-wide sessions do (see D-070).
- **The topbar is theme-INVARIANT, always dark (D-072) — matching deliveries' and recruiting's own
  `.topbar` (`var(--ink)`), not toggled by `data-theme` the way the rest of `.timetracker-module`
  is.** A screenshot caught the actual bug: in light mode, `--tt-chip` (every tab's background) and
  `--tt-bg` (the topbar's background) are two nearly-identical pale blues — fine contrast in a
  palette designed for the original's dark-mode default, invisible once rendered light. Rather than
  hand-tuning a better light palette for just this module, the fix matches the pattern already
  proven twice: solid dark bar, plain light text for inactive tabs, only the active tab gets a
  background (deliveries' own `.tab`/`.tab.active`, `globals.css`) — and the role badge/lang/sign-
  out buttons in `TopBar.tsx` switched to fixed `rgba(255,255,255,.1)` overrides instead of theme
  variables, the same inline-override pattern `recruiting/TopBar.tsx` already uses for the same
  reason.
- **Real employee data migrated from the old project (D-073)**, the **Electron desktop shell
  repointed at this hosted route (D-074)**, and its **remaining known gaps closed the same day
  (D-075)**: schema (D-064) → UI (D-066 through D-071) → visual fix (D-072) → real data (D-073) →
  desktop client (D-074) → offline/notifications/auto-update (D-075). The desktop repoint required
  porting the desktop-only bridge behavior into this Next.js route first (see the bullet above and
  D-074 itself) — `main.js` in the separate `timetracker-clean` repo now calls
  `loadURL('https://rtg-hub.vercel.app/timetracker')` (until 2026-09-04, `deliveries-app-seven.vercel.app`, which now redirects there with a 307) instead of bundling a local Vite
  build, so a deploy here reaches every installed desktop client without a reinstall. Packaging and
  publishing an actual installer update (`electron-builder --win nsis --publish always`, which
  pushes a real GitHub Release that already-installed apps auto-download) is a separate, deliberate
  step — not done as part of this change. What's genuinely still open isn't a code gap: whether
  `timetracker-clean/web`'s remaining users get moved to this route, and when (D-075).
- **Publishing the v0.0.44 installer surfaced a real bug the same day (D-076): login always landed
  on `/` (deliveries), never back on `/timetracker`.** Every guarded layout (`(timetracker)`,
  `(recruiting)`, `home`, `home/users`) redirected unauthenticated hits to a bare `/login`, and
  `login/page.tsx` always `router.push("/")`'d on success — fine for a browser tab (one extra
  click from the hub), broken for the Electron shell, which has no address bar: the only way back
  to Track Time was `ModuleSwitcher`'s hub/switch links, which also let the desktop client wander
  into deliveries/recruiting and silently stop the screenshot/activity tick loop (mounted only on
  `/timetracker`). Fixed with a `?next=<path>` round-trip through login, and by hiding
  `ModuleSwitcher` entirely when `isDesktop()` is true — the desktop shell has no address bar, so
  once the switcher can't reach another module, nothing in the UI can either. **A separate finding
  surfaced while diagnosing this, deliberately NOT fixed:** `middleware.ts` lives at the repo root
  instead of `src/middleware.ts`, which Next.js requires when a `src/` directory is in use — it
  never actually runs (no "Compiling /middleware" in `next dev`, confirmed empirically against a
  live dev server), so every route's real auth gate has always been each layout's own `redirect()`
  check, not middleware. Moving/activating previously-dead middleware code mid-hotfix was judged
  too consequential to bundle into an urgent fix — flagged, not touched.
