-- 299: merma — el GERENTE de la tienda también borra un reporte (no solo el admin) (2026-11-12).
--
-- Ayuda de Roberto (12 nov, «Need ability to delete as admin and manager»). La 297 dejó `warehouse_ops_delete_scrap_report`
-- solo para el admin. Ahora puede también quien inicia la aprobación en esa tienda (`warehouse_ops_can_start_approval`:
-- admin de la app, store_admin en sus tiendas, gerente con nivel «full» en su tienda; el supervisor NO). Todo lo demás
-- de la 297 se queda igual: grupo pendiente → sale y se borran sus firmas; grupo aprobado → no se deja; los archivos que
-- otro reporte comparte nunca se borran.
--
-- Se reescribe la función desde su definición ACTUAL cambiando solo la puerta, y se comprueba que el cambio ocurrió:
--   1. la puerta del principio (solo admin, antes de leer el reporte) pasa a «sin sesión → fuera»;
--   2. justo después de comprobar que es merma, la puerta nueva, que necesita la tienda del reporte.
--
-- Additive. 237/238/239 intactas.

do $m$
declare
  f text;
  g text;
  linea_tipo constant text := 'if r.kind <> ''scrap'' then raise exception ''warehouse_ops: solo se borran reportes de merma'' using errcode = ''22023''; end if;';
begin
  f := pg_get_functiondef('public.warehouse_ops_delete_scrap_report(uuid)'::regprocedure);
  -- 1. La puerta vieja (solo admin), con cualquier espacio o salto de línea entre sus partes.
  g := regexp_replace(f,
    'if yo is null or not \(\s*exists \(select 1 from public\.profiles where id = yo and role = ''admin''\)\s*or coalesce\(public\.warehouse_ops_level_of\(yo\), ''''\) = ''admin''\s*\) then\s*raise exception ''warehouse_ops: solo el admin borra un reporte'' using errcode = ''42501'';\s*end if;',
    'if yo is null then raise exception ''warehouse_ops: sin acceso'' using errcode = ''42501''; end if;');
  if g = f then raise exception '299: no encontre la puerta de solo admin en warehouse_ops_delete_scrap_report'; end if;
  -- 2. La puerta nueva, ya con la tienda del reporte.
  if position(linea_tipo in g) = 0 then raise exception '299: no encontre la comprobacion de tipo en warehouse_ops_delete_scrap_report'; end if;
  g := replace(g, linea_tipo, linea_tipo || E'\n  if not (exists (select 1 from public.profiles where id = yo and role = ''admin'') or public.warehouse_ops_can_start_approval(r.store)) then\n    raise exception ''warehouse_ops: solo el admin o el gerente de la tienda borra un reporte'' using errcode = ''42501'';\n  end if;');
  execute g;
end $m$;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  f := pg_get_functiondef('public.warehouse_ops_delete_scrap_report(uuid)'::regprocedure);
  if position('warehouse_ops_can_start_approval(r.store)' in f) = 0 then
    raise exception '299: delete_scrap_report debe dejar al gerente de la tienda (can_start_approval)';
  end if;
  if position('solo el admin borra un reporte' in f) > 0 then
    raise exception '299: quedo la puerta vieja de solo admin';
  end if;
  -- La seguridad de la 297 sigue: grupo aprobado bloqueado y archivos compartidos fuera de la lista a borrar.
  if position('primero deshaz la aprobacion' in f) = 0 or position('x.adjustment_proof = f' in f) = 0 then
    raise exception '299: se perdio una salvaguarda de la 297';
  end if;
  if position('security definer' in lower(f)) = 0 then
    raise exception '299: debe seguir siendo security definer';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_delete_scrap_report(uuid)', 'execute') then
    raise exception '299: anon no debe ejecutar delete_scrap_report';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('299_merma_gerente_borra_reporte.sql', 'f85eb0022706ad8b8a6001f7be852bd040d725abebd47ffeb475b9b9a4a476ae') on conflict (name) do nothing;
