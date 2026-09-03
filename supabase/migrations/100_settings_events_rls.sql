-- 100 · RLS de settings (A-2b) e historial (A-2c) — D-180, auditoria A-2b/A-2c
--
-- Molde: seccion 8 de PLAN-A-2a-profiles-rls.md; helper is_admin() de 099. Detalle y
-- sorpresas flaggeadas en docs/PLAN-A-2b-2c-settings-events.md.
--
-- Dos reglas:
--   settings  -> SELECT amplio (la app lee tarifas/tiendas/ventanas en todo el modulo);
--               INSERT/UPDATE/DELETE solo el ADMIN DEL MODULO. La pantalla ya es admin-only.
--   historial -> SELECT amplio; INSERT firmado por quien actua (created_by = auth.uid(),
--               cf. D-039: nadie firma a nombre de otro); SIN UPDATE/DELETE ni para admin
--               (append-only, como security_events).
--
-- Medido antes de tocar (matriz rol x accion con ROLLBACK, real+sintetico):
--   . order_events: la app inserta con created_by = me.id (= auth.uid()) en sus 2 sitios y
--     NUNCA hace update/delete de eventos -> el WITH CHECK no rompe mover ordenes.
--   . stage_history: lo escribe recruiting.log_stage_change (SECURITY DEFINER, salta RLS);
--     la app nunca lo inserta/edita -> lockearlo del cliente no rompe nada.
--   . settings deliveries: UI admin-only. settings recruiting: hoy solo 2 admins tienen
--     recruiting_role, y el write es UPDATE(id=1) que solo alcanza un admin.
--
-- NO se tocan (ya correctas): security_events, timetracker.settings, timetracker.audit,
-- clockin.audit_log. FLAGGEADAS aparte (no a ciegas): *.employee_settings (prefs por
-- empleado, self-editables), clockin.notes_log (notas editables por su autor), y las 5
-- tablas de historial de ERP (modelo de rol propio + garantia de costos #29) -> A-2c-erp.

-- ===========================================================================
-- A-2b . public.settings — write solo is_admin()
-- ===========================================================================
drop policy if exists "auth write settings" on public.settings;
drop policy if exists "auth read settings"  on public.settings;
create policy "settings select"       on public.settings for select to authenticated
  using (public.has_deliveries_access());
create policy "settings insert admin" on public.settings for insert to authenticated
  with check (public.is_admin());
create policy "settings update admin" on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "settings delete admin" on public.settings for delete to authenticated
  using (public.is_admin());

-- ===========================================================================
-- A-2e . recruiting.settings — write solo el admin/manager de recruiting (su tier, NO is_admin)
-- ===========================================================================
drop policy if exists "recruiting write settings" on recruiting.settings;
drop policy if exists "recruiting read settings"  on recruiting.settings;
create policy "settings select"       on recruiting.settings for select to authenticated
  using (public.has_recruiting_access());
create policy "settings insert admin" on recruiting.settings for insert to authenticated
  with check (public.current_recruiting_role() in ('admin','manager'));
create policy "settings update admin" on recruiting.settings for update to authenticated
  using (public.current_recruiting_role() in ('admin','manager'))
  with check (public.current_recruiting_role() in ('admin','manager'));
create policy "settings delete admin" on recruiting.settings for delete to authenticated
  using (public.current_recruiting_role() in ('admin','manager'));

-- ===========================================================================
-- A-2c . public.order_events — append-only, firmado por quien actua
-- ===========================================================================
drop policy if exists "auth write order_events" on public.order_events;
drop policy if exists "auth read order_events"  on public.order_events;
create policy "order_events select"      on public.order_events for select to authenticated
  using (public.has_deliveries_access());
create policy "order_events insert self" on public.order_events for insert to authenticated
  with check (public.has_deliveries_access() and created_by = (select auth.uid()));
-- Sin UPDATE ni DELETE: append-only, incluso para admin (cf. D-039, security_events).

-- ===========================================================================
-- A-2c . recruiting.stage_history — solo lectura desde cliente; lo escribe el trigger DEFINER
-- ===========================================================================
drop policy if exists "recruiting write stage_history" on recruiting.stage_history;
drop policy if exists "recruiting read stage_history"  on recruiting.stage_history;
create policy "stage_history select" on recruiting.stage_history for select to authenticated
  using (public.has_recruiting_access());
-- Sin INSERT/UPDATE/DELETE desde cliente: recruiting.log_stage_change (SECURITY DEFINER,
-- salta RLS) es el unico escritor y siempre estampa changed_by = auth.uid().

-- ===========================================================================
-- ROLLBACK (un comando: pegar todo este bloque). Restaura las politicas ALL previas.
-- ===========================================================================
-- begin;
--   drop policy if exists "settings select" on public.settings;
--   drop policy if exists "settings insert admin" on public.settings;
--   drop policy if exists "settings update admin" on public.settings;
--   drop policy if exists "settings delete admin" on public.settings;
--   create policy "auth read settings"  on public.settings for select to authenticated using (public.has_deliveries_access());
--   create policy "auth write settings" on public.settings for all    to authenticated using (public.has_deliveries_access()) with check (public.has_deliveries_access());
--
--   drop policy if exists "settings select" on recruiting.settings;
--   drop policy if exists "settings insert admin" on recruiting.settings;
--   drop policy if exists "settings update admin" on recruiting.settings;
--   drop policy if exists "settings delete admin" on recruiting.settings;
--   create policy "recruiting read settings"  on recruiting.settings for select to authenticated using (public.has_recruiting_access());
--   create policy "recruiting write settings" on recruiting.settings for all    to authenticated using (public.has_recruiting_access()) with check (public.has_recruiting_access());
--
--   drop policy if exists "order_events select" on public.order_events;
--   drop policy if exists "order_events insert self" on public.order_events;
--   create policy "auth read order_events"  on public.order_events for select to authenticated using (public.has_deliveries_access());
--   create policy "auth write order_events" on public.order_events for all    to authenticated using (public.has_deliveries_access()) with check (public.has_deliveries_access());
--
--   drop policy if exists "stage_history select" on recruiting.stage_history;
--   create policy "recruiting read stage_history"  on recruiting.stage_history for select to authenticated using (public.has_recruiting_access());
--   create policy "recruiting write stage_history" on recruiting.stage_history for all    to authenticated using (public.has_recruiting_access()) with check (public.has_recruiting_access());
-- commit;
