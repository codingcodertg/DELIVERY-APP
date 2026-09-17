-- 113 · Los tutoriales, para todo el que tenga sesion
--
-- La decision que la acompana es la de la rama `hub-tutoriales`, en DECISIONS.md. Se cita la rama y no
-- el numero: el checksum congela este cuerpo.
--
-- EL HUECO. Los tutoriales pasan de la «Cuenta» de Entregas a una herramienta del hub que ve todo el
-- mundo. Viven en `public.settings.tutorials` (037), y la 100 cierra la LECTURA de `settings` a
-- `has_deliveries_access()` (vigente en la 083: admin o 'deliveries' en module_access). Quien solo
-- tiene RR. HH., Time Tracker o el ERP abriria la pagina y veria la lista vacia, que se lee como «no
-- hay tutoriales» y no como «no puedes leerlos».
--
-- ES LA MISMA PARED que choco `store_rank` en la 108 y `store_names()` en la 109, y se salta igual: una
-- funcion `security definer` que lee Ajustes con permisos de dueno y devuelve LO MINIMO. Aqui, lo que
-- la pagina pinta: id, titulo, descripcion, enlace y app. `added_by` y `added_at` se quedan dentro, y
-- el resto de `settings` (direcciones, tarifas, `auto_approve`) ni se mira.
--
-- SE DESCARTO leer con la llave de servicio desde el servidor: evita la migracion, pero seria la
-- primera pagina del hub que lee Ajustes saltandose la RLS, y el patron de este repo para esta pared es
-- el de la 109.
--
-- LA ESCRITURA NO CAMBIA: `settings` solo lo actualiza `is_admin()` (100). El admin relee la columna
-- entera antes de escribir (src/lib/tutorials-hub.ts, guardaTutoriales), asi que no pierde los campos
-- que esta funcion no devuelve.

create or replace function public.tutorials()
returns table (
  id          text,
  title       text,
  description text,
  url         text,
  app         text
)
language sql
stable
security definer
-- `set search_path` explicito: sin el, una funcion `security definer` es la puerta clasica para que
-- alguien plante un `settings` suyo en un esquema por delante. `pg_temp` va al final, por lo mismo.
set search_path = public, pg_temp
as $$
  select (t.value->>'id')::text          as id,
         (t.value->>'title')::text       as title,
         (t.value->>'description')::text as description,
         (t.value->>'url')::text         as url,
         (t.value->>'app')::text         as app
    from public.settings cfg,
         jsonb_array_elements(
           case when jsonb_typeof(cfg.tutorials) = 'array' then cfg.tutorials else '[]'::jsonb end
         ) with ordinality as t(value, ordinality)
   where cfg.id = 1
     and nullif(btrim(coalesce(t.value->>'title', '')), '') is not null
     and nullif(btrim(coalesce(t.value->>'url', '')), '') is not null
   order by t.ordinality;
$$;

comment on function public.tutorials() is
  'Los tutoriales del hub, en el orden en que los puso el admin: id, titulo, descripcion, enlace y app. Para authenticated, tenga o no Entregas (113). No expone added_by, added_at ni nada mas de settings.';

revoke execute on function public.tutorials() from public, anon;
grant  execute on function public.tutorials() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop function if exists public.tutorials();
--   -- no hay dato que restaurar: esta migracion no escribe nada.

-- ===========================================================================
-- Comprobacion despues de aplicarla (de solo lectura)
-- ===========================================================================
--   select jsonb_array_length(tutorials) from public.settings where id = 1;   -- los guardados
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-sin-entregas>","role":"authenticated"}';
--   select count(*) from public.tutorials();          -- el mismo numero que arriba (los validos)
--   select count(*) from public.settings;             -- 0: la tabla sigue cerrada para esta cuenta
--   rollback;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('113_tutorials_for_everyone.sql', 'dfb9a271be27a49ede8a7d7b9b04d759171342dd7c9255c96f132a15ac0f69e9') on conflict (name) do nothing;
