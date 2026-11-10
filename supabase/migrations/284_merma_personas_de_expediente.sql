-- 284: Merma — el selector de empleados también muestra a los de almacén SIN usuario (solo expediente) (2026-11-10).
--
-- El dueño (10 nov): hay empleados de almacén que no tienen (ni ocupan) cuenta del Hub, solo expediente de RR. HH.
-- (`recruiting.employee_files` con `profile_id` nulo). El selector de merma solo leía `profiles`, así que esa gente no
-- salía. La RLS de `employee_files` es solo para RR. HH. (admin/manager), y NO se toca; en su lugar, un RPC acotado y de
-- SOLO LECTURA deja que quien usa Operaciones de almacén obtenga apenas {id, nombre, tienda} de los expedientes de
-- almacén activos y sin cuenta. Nada de datos sensibles (sin correo, teléfono, sueldo, etc.).
--
-- Qué hace:
--   warehouse_ops_people(): devuelve (id, full_name, store) de los expedientes con `profile_id` nulo, sin baja
--   (`date_left` nulo) y cuyo puesto/departamento es de almacén. Solo responde a quien tiene nivel en Operaciones de
--   almacén (`warehouse_ops_level_of(auth.uid()) is not null`); a los demás, cero filas.
--
-- Additive (solo crea la función). 237/280/281/282/283 intactas. Para deshacer:
--   drop function if exists public.warehouse_ops_people();
--   delete from public.schema_migrations where name = '284_merma_personas_de_expediente.sql';

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
$$;
revoke all on function public.warehouse_ops_people() from public, anon;
grant execute on function public.warehouse_ops_people() to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'warehouse_ops_people') then
    raise exception '284: falta la funcion warehouse_ops_people';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_people()', 'execute') then
    raise exception '284: anon no debe ejecutar warehouse_ops_people';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_people()'::regprocedure);
  if position('profile_id is null' in f) = 0 or position('date_left is null' in f) = 0 then
    raise exception '284: warehouse_ops_people debe limitarse a expedientes sin usuario y sin baja';
  end if;
  if position('warehouse_ops_level_of' in f) = 0 then
    raise exception '284: warehouse_ops_people debe exigir nivel de Operaciones de almacen';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('284_merma_personas_de_expediente.sql', 'ced975b55375cc85202a4beddabb2514fedf77510bcc068c2eccbfc38e8051fc') on conflict (name) do nothing;
