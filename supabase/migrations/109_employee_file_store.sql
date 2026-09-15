-- 109 · La tienda de quien no tiene cuenta, y la lista de tiendas para elegirla
--
-- La decision que la acompana es la de la rama `expediente-con-tienda`, en DECISIONS.md.
--
-- SIN EL MARCADOR DE DECISION SIN NUMERAR, Y NO ES UN OLVIDO. Una migracion se ejecuta a
-- mano y su fila en `schema_migrations` guarda el checksum del cuerpo; sustituir el marcador
-- por el numero despues cambiaria ese cuerpo y `migrate-status` diria «cambiada» para
-- siempre. Por eso se cita la rama, que no cambia al numerar.
--
-- EL HUECO. Al cargar la hoja del dueno para el directorio (108), de 47 personas 20 no tienen
-- cuenta: asociados de almacen, choferes, corporativo. `phone_book()` sacaba la tienda de
-- `profiles.store`, y `recruiting.employee_files` no tenia columna de tienda: la 106 la dejo
-- en `profiles` cuando todo expediente tenia cuenta. Esas 20 personas caian todas en
-- «Sin tienda», que es falso.
--
-- LA REGLA: SI HAY CUENTA, MANDA LA CUENTA. `profiles.store` decide que pedidos ve un
-- vendedor y a que tienda pertenece un gerente; es un dato con consecuencias en Entregas. La
-- tienda del expediente solo existe para quien no tiene cuenta, y la funcion la usa
-- UNICAMENTE cuando la cuenta no dice nada. Asi las dos no pueden contar cosas distintas de
-- la misma persona: una de ellas no se consulta mientras la otra exista.

-- ===========================================================================
-- 1. La columna
-- ===========================================================================
alter table recruiting.employee_files
  add column if not exists store text;

comment on column recruiting.employee_files.store is
  'Tienda de la persona, SOLO para quien no tiene cuenta: con cuenta manda profiles.store. Mismo vocabulario que profiles.store (los nombres de tienda de Ajustes). Null = sin tienda.';

-- ===========================================================================
-- 2. El directorio usa la tienda del expediente cuando la cuenta no la dice
-- ===========================================================================
-- Parte de la definicion VIGENTE (108), no de otra: `create or replace` reemplaza la funcion
-- entera, y cualquier cosa que no se copie aqui se pierde en produccion. Lo unico que cambia
-- es la tienda, en los DOS sitios donde se usa: la columna que se devuelve y el cruce con el
-- orden de Ajustes. Cambiar solo el primero dejaria a esas personas bajo su tienda pero sin
-- rango, detras de todas las demas, que es un fallo que no se ve a simple vista.
create or replace function public.phone_book()
returns table (
  full_name       text,
  title           text,
  store           text,
  store_rank      int,
  department      text,
  phone           text,
  ringcentral_ext text,
  email           text
)
language sql
stable
security definer
-- `set search_path` explicito: sin el, una funcion `security definer` es la puerta clasica
-- para que alguien plante un `profiles` suyo en un esquema por delante y se lo lea con
-- permisos de dueno. `pg_temp` va al final, nunca al principio, por lo mismo.
set search_path = public, recruiting, pg_temp
as $$
  with orden as (
    select s.value->>'name' as nombre, s.ordinality::int as rank
      from public.settings cfg,
           jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) with ordinality as s(value, ordinality)
     where cfg.id = 1
  ),
  personas as (
    select
      f.full_name,
      f.department,
      f.phone,
      f.ringcentral_ext,
      f.email,
      p.full_name as cuenta_nombre,
      p.title     as cuenta_titulo,
      -- La tienda que vale: la de la cuenta si la dice, la del expediente si no.
      coalesce(
        nullif(btrim(coalesce(p.store, '')), ''),
        nullif(btrim(coalesce(f.store, '')), '')
      ) as tienda
    from recruiting.employee_files f
    left join public.profiles p on p.id = f.profile_id
    where f.date_left is null
  )
  select
    -- El nombre que se ensena es el de la cuenta si la hay, y el del expediente si no:
    -- misma regla que la lista de RR. HH. (`nombreVisible`), para que no digan cosas
    -- distintas de la misma persona.
    coalesce(
      nullif(btrim(coalesce(x.cuenta_nombre, '')), ''),
      nullif(btrim(coalesce(x.full_name, '')), ''),
      '—'
    )::text                  as full_name,
    x.cuenta_titulo::text    as title,
    x.tienda::text           as store,
    o.rank                   as store_rank,
    x.department::text       as department,
    x.phone::text            as phone,
    x.ringcentral_ext::text  as ringcentral_ext,
    x.email::text            as email
  from personas x
  left join orden o on o.nombre = x.tienda;
$$;

comment on function public.phone_book() is
  'Directorio de la compania: nombre, titulo, tienda (con su orden de Ajustes), departamento, telefono, extension y correo de contacto de las personas ACTIVAS. La tienda es la de la cuenta y, sin cuenta, la del expediente (109). Para authenticated. No expone direccion, cumpleanos, dias libres ni notas.';

revoke execute on function public.phone_book() from public, anon;
grant  execute on function public.phone_book() to authenticated;

-- ===========================================================================
-- 3. La lista de tiendas para elegir, para quien no tiene Entregas
-- ===========================================================================
-- El expediente es de RR. HH., y RR. HH. no tiene por que tener Entregas; pero `public.settings`
-- la cierra la 100 a `has_deliveries_access()`. Es la misma pared con la que choco `store_rank`
-- en la 108, y se salta igual: una funcion que lee Ajustes con permisos de dueno y devuelve lo
-- minimo. Aqui, ni siquiera personas: el NOMBRE de cada tienda y su posicion. Direcciones,
-- coordenadas y `auto_approve` se quedan dentro.
create or replace function public.store_names()
returns table (
  name text,
  rank int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (s.value->>'name')::text as name, s.ordinality::int as rank
    from public.settings cfg,
         jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) with ordinality as s(value, ordinality)
   where cfg.id = 1
     and nullif(btrim(coalesce(s.value->>'name', '')), '') is not null
   order by s.ordinality;
$$;

comment on function public.store_names() is
  'Nombres de tienda de Ajustes, en su orden, para elegir la tienda de un expediente sin cuenta. Solo nombre y posicion. Para authenticated.';

revoke execute on function public.store_names() from public, anon;
grant  execute on function public.store_names() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop function if exists public.store_names();
--   -- y volver a crear public.phone_book() con el cuerpo de la 108
--   alter table recruiting.employee_files drop column if exists store;   -- borra el dato

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('109_employee_file_store.sql', '4b9c0530c7d5e792a5196175a67e5caf655eb61d8c956976898eec14c9961151') on conflict (name) do nothing;
