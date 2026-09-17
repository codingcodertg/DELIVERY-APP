-- 115 · Tutoriales: la audiencia son los roles de la app del video
--
-- La decision que la acompana es la de la rama `tutoriales-roles-por-app`, en DECISIONS.md. Se cita la
-- rama y no el numero: el checksum congela este cuerpo.
--
-- EL PEDIDO. El dueno, sobre D-269: «dentro de cada app tambien que salgan los roles, que sean check
-- boxes y que pueda editar eso». Hasta ahora la audiencia de un video eran siempre roles de Entregas
-- (114). Ahora son los roles de SU app.
--
-- CADA APP, SU ROL Y SU ACCESO, medidos en el repo (no supuestos):
--   app           rol de quien mira                         acceso (helper vigente)
--   deliveries    profiles.role                             has_deliveries_access()  (083)
--   recruiting    profiles.recruiting_role                  has_recruiting_access()  (055)
--   timetracker   profiles.timetracker_role                 has_timetracker_access() (058)
--   clockin       role de la vista clockin.profiles (112)   has_clockin_access()     (087)
--   erp           profiles.erp_role                         has_erp_access()         (062)
--   general       profiles.role (los de Entregas)           has_deliveries_access()
-- Un video sin `app`, o con una que no esta en la lista, es General: el mismo caso que D-269, asi que un
-- video de entonces (sin app y con roles de Entregas) se ve exactamente igual.
--
-- QUIEN VE QUE, aqui y no en la pantalla:
--   * el admin del hub (`is_admin()`, 099) ve todos;
--   * el resto ve los videos sin audiencia, y los que incluyen SU ROL EN LA APP DEL VIDEO si tiene acceso
--     a esa app. Sin acceso, su rol en esa app no cuenta: sigue viendo los de para todos. (Es lo que en
--     la 114 era «el rol de Entregas solo cuenta con Entregas», generalizado a cada app.)
--
-- EL ROL DE FICHAJE se lee de la vista `clockin.profiles`, que lo deriva de `role` y `timetracker_role`,
-- en vez de copiar su CASE aqui: asi no hay dos sitios que puedan decir cosas distintas. La vista es
-- `security_invoker`, y dentro de esta funcion `security definer` la lee el dueno de la funcion. Quien no
-- tiene fila en `clockin.employee_settings` no aparece en la vista: no tiene rol de fichaje y no coincide.
--
-- LA FIRMA NO CAMBIA (las seis columnas de la 114), asi que basta `create or replace`: la funcion no deja
-- de existir en ningun momento. Los permisos se repiten por si acaso; son los mismos.
--
-- LO QUE NO CAMBIA: quien tiene Entregas puede leer `settings.tutorials` crudo por REST (100), audiencias
-- incluidas. La audiencia decide que es relevante para cada uno; no es un secreto.

create or replace function public.tutorials()
returns table (
  id          text,
  title       text,
  description text,
  url         text,
  app         text,
  roles       text[]
)
language sql
stable
security definer
-- `set search_path` explicito: sin el, una funcion `security definer` es la puerta clasica para que
-- alguien plante un `settings` suyo en un esquema por delante. `pg_temp` va al final, por lo mismo.
set search_path = public, pg_temp
as $$
  with quien as (
    select coalesce(public.is_admin(), false)               as admin,
           coalesce(public.has_deliveries_access(), false)  as con_entregas,
           coalesce(public.has_recruiting_access(), false)  as con_rrhh,
           coalesce(public.has_timetracker_access(), false) as con_tt,
           coalesce(public.has_clockin_access(), false)     as con_fichaje,
           coalesce(public.has_erp_access(), false)         as con_erp,
           p.role                                           as rol_entregas,
           p.recruiting_role                                as rol_rrhh,
           p.timetracker_role                               as rol_tt,
           (select c.role from clockin.profiles c where c.id = auth.uid()) as rol_fichaje,
           p.erp_role                                       as rol_erp
      from (select 1) as uno
      left join public.profiles p on p.id = auth.uid()
  )
  select (t.value->>'id')::text          as id,
         (t.value->>'title')::text       as title,
         (t.value->>'description')::text as description,
         (t.value->>'url')::text         as url,
         (t.value->>'app')::text         as app,
         a.roles                         as roles
    from public.settings cfg
   cross join quien q
   cross join lateral jsonb_array_elements(
           case when jsonb_typeof(cfg.tutorials) = 'array' then cfg.tutorials else '[]'::jsonb end
         ) with ordinality as t(value, ordinality)
   cross join lateral (
           select array(
                    select jsonb_array_elements_text(
                             case when jsonb_typeof(t.value->'roles') = 'array' then t.value->'roles' else '[]'::jsonb end
                           )
                  ) as roles
         ) a
   cross join lateral (
           -- El rol de quien mira EN LA APP DEL VIDEO, y si tiene acceso a esa app.
           select case t.value->>'app'
                    when 'recruiting'  then q.con_rrhh    and q.rol_rrhh     = any(a.roles)
                    when 'timetracker' then q.con_tt      and q.rol_tt       = any(a.roles)
                    when 'clockin'     then q.con_fichaje and q.rol_fichaje  = any(a.roles)
                    when 'erp'         then q.con_erp     and q.rol_erp      = any(a.roles)
                    -- 'deliveries', sin app o una app desconocida: General, con los roles de Entregas.
                    else                    q.con_entregas and q.rol_entregas = any(a.roles)
                  end as coincide
         ) m
   where cfg.id = 1
     and nullif(btrim(coalesce(t.value->>'title', '')), '') is not null
     and nullif(btrim(coalesce(t.value->>'url', '')), '') is not null
     and ( q.admin
        or cardinality(a.roles) = 0
        or coalesce(m.coincide, false) )
   order by t.ordinality;
$$;

comment on function public.tutorials() is
  'Los tutoriales del hub que puede ver quien llama, en su orden: el admin todos; el resto los que no tienen audiencia y los que incluyen su rol en la app del video, si tiene acceso a esa app. Sin app, los roles de Entregas. Devuelve la audiencia de cada uno. Para authenticated (113, 114, 115).';

revoke execute on function public.tutorials() from public, anon;
grant  execute on function public.tutorials() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   create or replace function public.tutorials() con el cuerpo de la 114 (misma firma), su comentario,
--   su revoke y su grant. No hay dato que restaurar: esta migracion no escribe nada.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- <uuid-...> son cuentas reales con ese perfil. Los videos se inventan dentro de la transaccion.
--
--   begin;
--   update public.settings set tutorials =
--     '[{"id":"v0","title":"Para todos","url":"https://x.test/0"},
--       {"id":"v1","title":"General, solo sales (forma de D-269)","url":"https://x.test/1","roles":["sales"]},
--       {"id":"v2","title":"Entregas, solo manager","url":"https://x.test/2","app":"deliveries","roles":["manager"]},
--       {"id":"v3","title":"Time Tracker, solo employee","url":"https://x.test/3","app":"timetracker","roles":["employee"]},
--       {"id":"v4","title":"RR. HH., solo recruiter","url":"https://x.test/4","app":"recruiting","roles":["recruiter"]},
--       {"id":"v5","title":"Fichaje, solo manager","url":"https://x.test/5","app":"clockin","roles":["manager"]},
--       {"id":"v6","title":"ERP, solo staff","url":"https://x.test/6","app":"erp","roles":["staff"]}]'
--    where id = 1;
--   set local role authenticated;
--
--   -- una por una, cambiando el sub:
--   set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--   select id from public.tutorials();
--
--   admin del hub                                     -> v0 v1 v2 v3 v4 v5 v6
--   sales con Entregas                                -> v0 v1
--   solo Time Tracker, employee (role 'sales' por defecto, sin Entregas)
--                                                     -> v0 v3            (NO v1: sin Entregas)
--   manager de Entregas, sin Time Tracker             -> v0 v2            (NO v5: sin acceso a fichaje)
--   gerente de tienda de Time Tracker (timetracker_role manager, con fila en employee_settings)
--                                                     -> v0 v5 (+ v1/v2 si ademas tiene Entregas con ese rol)
--   recruiter de RR. HH.                              -> v0 v4 (+ lo de su rol de Entregas si tiene Entregas)
--   staff del ERP                                     -> v0 v6 (+ idem)
--
--   reset role;
--   rollback;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('115_tutorial_roles_per_app.sql', '194ac4ef2973785ee83c982cc99b336925c8c682a0979fe139dbf7eb9836fa24') on conflict (name) do nothing;
