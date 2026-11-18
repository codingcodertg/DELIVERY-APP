-- 324: Warehouse Associate (nivel scrap_only = «Associate (Deliveries + scrap)») ve SOLO sus propios reportes de merma (2026-11-17).
--
-- El dueño (17 nov): el Associate usa las pantallas de almacén de Deliveries y LLENA merma; NO ve reportes de otros, ni
-- KPI, ni dashboards, ni administración de conteos de inventario, ni configuración. Hoy la base lo dejaba ver más:
--   - La 292 (warehouse_ops_can_see) dio a scrap_only la merma de TODA su tienda («todos ven los de su tienda»). Esa
--     rama se quita: scrap_only vuelve a ver solo lo suyo (la regla de la 265).
--   - La 273/274 (warehouse_ops_in_store) dio a scrap_only el equipo, las listas diarias, las refacciones, el uso y los
--     conteos de inventario de su tienda (sus políticas SELECT y las RPC de conteo y mantenimiento pasan por ahí).
--     Se le quita: in_store ya no cuenta a scrap_only.
--   - La 284 (warehouse_ops_people) pasaba por warehouse_ops_in_store. El selector de «¿quién lo rompió?» de la MERMA
--     sigue necesitando la gente de su tienda, así que el RPC mantiene EXACTAMENTE la regla de antes (admin, o cualquier
--     nivel con la tienda suya) sin depender de in_store.
--
-- Qué NO cambia: el guardia de tipo y de tienda de warehouse_reports (265), la RLS de warehouse_reports (sigue
-- pasando por warehouse_ops_can_see), admin / store_admin / full, el supervisor de almacén, quien corrige la merma
-- (warehouse_ops_can_manage), y las funciones que ya usan can_manage.
--
-- Solo crea (reemplaza) tres funciones. Sin begin/commit propios. Para deshacer: volver a crear las tres con el cuerpo
-- de la 292 (can_see) y de la 273 (in_store) y de la 284 (people). delete from public.schema_migrations where name = '324_warehouse_associate.sql';

-- ---------------------------------------------------------------------------
-- 1. Quien ve un reporte: el Associate solo ve los suyos de merma
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_can_see(r_kind text, r_store text, r_author uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select
      n.nivel = 'admin'
      or (n.nivel = 'store_admin' and t.mia)
      or (
        r_kind in ('zone', 'insubordination', 'positive')
        and (
          p.recruiting_role in ('admin', 'manager')
          or (n.nivel = 'full' and p.role = 'manager' and t.mia)
        )
      )
      or (
        r_kind not in ('zone', 'insubordination', 'positive')
        and (
          (n.nivel = 'scrap_only' and r_author = p.id and r_kind = any(public.warehouse_ops_kinds_of(n.nivel)))
          or (n.nivel = 'full' and (
            r_author = p.id
            or ((p.role = 'manager' or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}'))) and t.mia)
          ))
        )
      )
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
      cross join lateral (select (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia) t
    where p.id = auth.uid()
  ), false);
$function$;

-- ---------------------------------------------------------------------------
-- 2. La tienda de la que se ocupa el personal (equipo, lista diaria, refacciones, uso, conteos): no para el Associate
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_in_store(r_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select n.nivel = 'admin'
        or (n.nivel not in ('', 'scrap_only') and (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))))
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.warehouse_ops_in_store(text) from public, anon;
grant execute on function public.warehouse_ops_in_store(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. El selector de empleados de la MERMA (284): sigue dando la gente de la tienda a cualquier nivel, como antes
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_people()
  returns table (id uuid, full_name text, store text)
  language sql stable security definer set search_path = public as $$
  select e.id, e.full_name, e.store
    from recruiting.employee_files e
   where e.profile_id is null
     and e.date_left is null
     and coalesce(btrim(e.full_name), '') <> ''
     and (
       e.job_title ilike '%warehouse%' or e.job_title ilike '%inventory%' or e.job_title ilike '%driver%'
       or e.job_title ilike '%almac%' or e.job_title ilike '%merma%'
       or e.department ilike '%warehouse%' or e.department ilike '%almac%'
     )
     and public.warehouse_ops_level_of(auth.uid()) is not null
     -- Acota por tienda (como la 284): el admin pasa; los demás, solo la(s) tienda(s) del que llama.
     and (
       public.warehouse_ops_level_of(auth.uid()) = 'admin'
       or exists (
         select 1 from public.profiles p
          where p.id = auth.uid()
            and (p.store = e.store or e.store = any(coalesce(p.visible_stores, '{}')))
       )
     )
$$;
revoke all on function public.warehouse_ops_people() from public, anon;
grant execute on function public.warehouse_ops_people() to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare
  d text;
  f text;
begin
  -- can_see: 'scrap_only' aparece UNA vez (la rama propia); la de la tienda (292) ya no esta.
  d := pg_get_functiondef('public.warehouse_ops_can_see(text,text,uuid)'::regprocedure);
  if (length(d) - length(replace(d, 'scrap_only', ''))) / length('scrap_only') <> 1 then
    raise exception '324: warehouse_ops_can_see sigue dando a scrap_only la tienda entera';
  end if;
  if position('r_author = p.id' in d) = 0 then raise exception '324: warehouse_ops_can_see perdio la rama de lo propio'; end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.warehouse_ops_can_see(text,text,uuid)'::regprocedure) then
    raise exception '324: warehouse_ops_can_see dejo de ser security definer';
  end if;

  -- in_store: scrap_only no pasa.
  d := pg_get_functiondef('public.warehouse_ops_in_store(text)'::regprocedure);
  if (length(d) - length(replace(d, 'scrap_only', ''))) / length('scrap_only') <> 1 then
    raise exception '324: warehouse_ops_in_store no excluye a scrap_only';
  end if;

  -- people: ya no pasa por in_store, y sigue acotada por tienda.
  d := pg_get_functiondef('public.warehouse_ops_people()'::regprocedure);
  if position('warehouse_ops_in_store' in d) > 0 then raise exception '324: warehouse_ops_people sigue pasando por in_store'; end if;
  if position('visible_stores' in d) = 0 then raise exception '324: warehouse_ops_people no acota por tienda'; end if;

  -- Las politicas que dependen de in_store siguen ahi (no se tocaron), y nadie anonimo ejecuta las tres.
  foreach f in array array[
    'public.warehouse_ops_can_see(text, text, uuid)', 'public.warehouse_ops_in_store(text)', 'public.warehouse_ops_people()'
  ] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '324: anon ejecuta %', f; end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and policyname is not null) then
    raise exception '324: warehouse_reports perdio sus politicas de lectura';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('324_warehouse_associate.sql', '2307a47bb8c6bf027aec991c49f7843ff1a03377519985e8eb71a36f4ef89f0c') on conflict (name) do nothing;
