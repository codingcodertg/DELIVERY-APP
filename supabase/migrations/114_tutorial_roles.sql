-- 114 · Tutoriales por rol: cada video para quien toca
--
-- La decision que la acompana es la de la rama `tutoriales-categorias`, en DECISIONS.md. Se cita la rama
-- y no el numero: el checksum congela este cuerpo.
--
-- EL PEDIDO. El dueno: «quiero categorias, porque habra videos solo para sales, solo para office y asi».
-- Y corrigio enseguida: «al reves: a cada video le pongo la categoria […], es mas facil que ir usuario por
-- usuario». Asi que la audiencia de un video son ROLES QUE YA EXISTEN, los de Entregas (`ROLE_INFO`), y no
-- hay nada que configurar en cada persona. Continua D-268 (tutoriales en el hub, 113).
--
-- LA AUDIENCIA vive en cada tutorial de `settings.tutorials`, como `roles` (claves de rol). Vacio = para
-- todos. La escribe solo el admin: `settings` solo lo actualiza `is_admin()` (100). No hay columna nueva.
--
-- QUIEN VE QUE SE DECIDE AQUI, en `public.tutorials()`, no en la pantalla:
--   * el admin (`is_admin()`, 099) ve todos;
--   * el resto ve los videos sin audiencia, y los que incluyen su rol SI TIENE ENTREGAS.
--
-- POR QUE «SI TIENE ENTREGAS». `profiles.role` es el rol de Entregas, `not null default 'sales'`
-- (roles.sql), sin `check`, y `handle_new_user` (056) pone 'sales' a quien no trae otro. Medido en
-- produccion el 2026-09-17 por el orquestador: de 35 perfiles, 5 no tienen Entregas y los 5 son 'sales'
-- por defecto, con solo Time Tracker. Sin esta condicion, un video «solo para sales» lo verian ellos
-- tambien. La condicion es `has_deliveries_access()` (vigente en la 083: admin o 'deliveries' en
-- module_access), el mismo helper que ya decide quien lee `settings`.
--
-- UN ROL QUE NO EXISTE en la audiencia de un video no coincide con nadie. Si era el unico, el video solo lo
-- ve el admin, y la pagina se lo marca al admin para que no pase en silencio. Una cuenta con un rol fuera
-- de `ROLE_INFO` (medido: 0 hoy) no coincide con ninguna audiencia y ve los videos para todos.
--
-- LA FIRMA CAMBIA: una sexta columna, `roles`, para que el admin vea la audiencia. `create or replace` no
-- puede cambiar las columnas de una funcion que devuelve tabla: se BORRA y se crea, y los permisos se
-- vuelven a dar. Entre el `drop` y el `create` la funcion no existe: se aplica en UNA transaccion.
--
-- LO QUE NO CAMBIA: quien tiene Entregas puede leer `settings.tutorials` crudo por REST, audiencias
-- incluidas (la 100 abre la lectura de `settings` a `has_deliveries_access()`). La audiencia decide que es
-- relevante para cada uno; no es un secreto.

-- Parte de la definicion VIGENTE, la de la 113. Lo que no cambia se copia tal cual: las cinco columnas,
-- solo filas con titulo y enlace, el orden de la lista, `security definer` y su `search_path`.
drop function if exists public.tutorials();

create function public.tutorials()
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
    select coalesce(public.is_admin(), false)              as admin,
           coalesce(public.has_deliveries_access(), false) as con_entregas,
           public.current_user_role()                      as rol
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
   where cfg.id = 1
     and nullif(btrim(coalesce(t.value->>'title', '')), '') is not null
     and nullif(btrim(coalesce(t.value->>'url', '')), '') is not null
     and ( q.admin
        or cardinality(a.roles) = 0
        or (q.con_entregas and q.rol = any(a.roles)) )
   order by t.ordinality;
$$;

comment on function public.tutorials() is
  'Los tutoriales del hub que puede ver quien llama, en su orden: el admin todos; el resto los que no tienen audiencia y, si tiene Entregas, los que incluyen su rol. Devuelve la audiencia de cada uno. Para authenticated (113, 114).';

revoke execute on function public.tutorials() from public, anon;
grant  execute on function public.tutorials() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop function if exists public.tutorials();
--   -- y crear public.tutorials() con el cuerpo de la 113 (cinco columnas), su comentario, su revoke y su
--   -- grant. En una transaccion, por lo mismo que arriba.
--   -- No hay dato que restaurar: esta migracion no escribe nada. Las audiencias que el admin haya puesto
--   -- se quedan en settings.tutorials, y la funcion de la 113 simplemente no las mira.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- <uuid-...> son cuentas reales. Los videos se inventan dentro de la transaccion.
--
--   begin;
--   update public.settings set tutorials =
--     '[{"id":"t0","title":"Para todos","url":"https://x.test/0"},
--       {"id":"t1","title":"Solo sales","url":"https://x.test/1","roles":["sales"]},
--       {"id":"t2","title":"Solo office","url":"https://x.test/2","roles":["manager"]},
--       {"id":"t3","title":"Rol que no existe","url":"https://x.test/3","roles":["rol-borrado"]}]'
--    where id = 1;
--   set local role authenticated;
--
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   select id, roles from public.tutorials();     -- admin: t0, t1, t2, t3
--
--   set local request.jwt.claims = '{"sub":"<uuid-sales-con-entregas>","role":"authenticated"}';
--   select id from public.tutorials();            -- t0, t1. NO t2 ni t3
--
--   set local request.jwt.claims = '{"sub":"<uuid-manager-con-entregas>","role":"authenticated"}';
--   select id from public.tutorials();            -- t0, t2
--
--   set local request.jwt.claims = '{"sub":"<uuid-sales-sin-entregas>","role":"authenticated"}';
--   select id from public.tutorials();            -- solo t0: sin Entregas, su 'sales' por defecto no cuenta
--
--   reset role;
--   rollback;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('114_tutorial_roles.sql', '81306558b7b2b3735f6144c8d83161d2e62c9a3d6e2a716e21a3c4c50854950a') on conflict (name) do nothing;
