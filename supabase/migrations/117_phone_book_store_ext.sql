-- 117 · El directorio ensena la extension de cada tienda
--
-- La decision que la acompana es la de la rama `directorio-ext-tienda`, en DECISIONS.md. Se cita la rama y
-- no el numero: el checksum congela este cuerpo.
--
-- EL PEDIDO. El dueno quiere ver en el directorio la extension de cada tienda junto a su nombre. La cita
-- literal y lo medido en produccion, con fecha, estan en la decision: son datos del dueno y no van aqui.
--
-- LA EXTENSION ES UN DATO DE AJUSTES, NO UNA CUENTA. Se guarda como clave opcional `directory_ext` en cada
-- objeto de `public.settings.stores`, igual que `directory_code` (D-260, D-261), y se escribe en Datos →
-- Tiendas. No se deduce de las extensiones de la gente: una tienda sin nadie visible, o una persona con una
-- extension doble, la desviarian. Ni un nombre ni un numero de tienda en este fichero: son datos del dueno.
--
-- UN GRUPO CON VARIAS TIENDAS. El directorio agrupa por CODIGO (111): dos tiendas con el mismo codigo son un
-- grupo. Medido: hoy el agrupado es `min(rank) over (partition by codigo)` y cada nombre de tienda tiene su
-- fila en `orden`. La extension de un grupo es la de sus tiendas solo si TODAS tienen una y es la misma; si
-- difieren o a alguna le falta, el grupo no ensena extension. (Si hoy hay algun grupo asi es un dato de
-- produccion: esta, con fecha, en la decision.)
--
-- LA FIRMA CAMBIA: una decima columna, `store_ext`, al final para no mover las demas. `create or replace` no
-- puede cambiar las columnas de una funcion que devuelve tabla: se BORRA y se crea, y los permisos se
-- vuelven a dar. Entre el `drop` y el `create` el directorio no existe: se aplica en UNA transaccion.
--
-- LA FUNCION SE COPIA DE LA VIGENTE (116), generada por programa: lo demas —extension Y telefono, grupos
-- Remote y Sin tienda, quien los ve, codigos, rangos, `security definer`, `search_path`— queda igual, y la
-- prueba lo compara con la 116.

drop function if exists public.phone_book();

create function public.phone_book()
returns table (
  full_name       text,
  title           text,
  store           text,
  store_rank      int,
  department      text,
  phone           text,
  ringcentral_ext text,
  email           text,
  directory_group text,
  store_ext       text
)
language sql
stable
security definer
-- `set search_path` explicito: sin el, una funcion `security definer` es la puerta clasica
-- para que alguien plante un `profiles` suyo en un esquema por delante y se lo lea con
-- permisos de dueno. `pg_temp` va al final, nunca al principio, por lo mismo.
set search_path = public, recruiting, pg_temp
as $$
  with tiendas as (
    -- El codigo es el de Ajustes si lo hay, y el nombre si no.
    select s.value->>'name' as nombre,
           coalesce(
             nullif(btrim(coalesce(s.value->>'directory_code', '')), ''),
             s.value->>'name'
           ) as codigo,
           s.ordinality::int as rank,
           -- La extension de la tienda (117). Un espacio en blanco no es una extension.
           nullif(btrim(coalesce(s.value->>'directory_ext', '')), '') as ext
      from public.settings cfg,
           jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) with ordinality as s(value, ordinality)
     where cfg.id = 1
  ),
  orden as (
    -- Las tiendas que comparten codigo son un solo grupo, y el grupo va donde va la primera.
    select t.nombre, t.codigo, min(t.rank) over (partition by t.codigo) as rank
      from tiendas t
  ),
  ext_por_codigo as (
    -- Un grupo de tienda es un CODIGO, y puede tener varias tiendas. Su extension es la de todas
    -- ellas solo si todas tienen una y es la misma: si difieren, o a alguna le falta, no se ensena
    -- ninguna. Una extension que vale para la mitad del grupo es una llamada a la tienda equivocada.
    select t.codigo,
           case when count(*) = count(t.ext) and count(distinct t.ext) = 1 then min(t.ext) end as ext
      from tiendas t
     group by t.codigo
  ),
  personas as (
    select
      f.full_name,
      f.department,
      f.phone,
      f.ringcentral_ext,
      f.email,
      f.directory_group,
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
      -- Solo quien tiene extension (111) Y telefono (116). Un espacio en blanco no es ni lo uno ni lo otro.
      and nullif(btrim(coalesce(f.ringcentral_ext, '')), '') is not null
      and nullif(btrim(coalesce(f.phone, '')), '') is not null
  ),
  clasificadas as (
    select x.*,
      case
        -- El orden importa: 'remote' es una decision y gana a la falta de tienda.
        when x.directory_group = 'remote' then 'remote'
        when x.directory_group = 'sin_tienda' or x.tienda is null then 'sin_tienda'
      end as grupo
    from personas x
  ),
  quien as (
    select coalesce(public.is_admin(), false)                      as admin,
           coalesce(public.current_user_role() = 'manager', false) as manager
  )
  select
    -- El nombre que se ensena es el de la cuenta si la hay, y el del expediente si no:
    -- misma regla que la lista de RR. HH. (`nombreVisible`).
    coalesce(
      nullif(btrim(coalesce(c.cuenta_nombre, '')), ''),
      nullif(btrim(coalesce(c.full_name, '')), ''),
      '—'
    )::text                                                              as full_name,
    c.cuenta_titulo::text                                                as title,
    -- Una fila de grupo no lleva tienda ni rango: el grupo ES su sitio.
    case when c.grupo is null then coalesce(o.codigo, c.tienda) end::text as store,
    case when c.grupo is null then o.rank end                            as store_rank,
    c.department::text                                                   as department,
    c.phone::text                                                        as phone,
    c.ringcentral_ext::text                                              as ringcentral_ext,
    c.email::text                                                        as email,
    c.grupo::text                                                        as directory_group,
    -- Como la tienda y el rango: una fila de grupo no lleva extension de tienda.
    case when c.grupo is null then e.ext end::text                       as store_ext
  from clasificadas c
  cross join quien q
  left join orden o on o.nombre = c.tienda and c.grupo is null
  left join ext_por_codigo e on e.codigo = o.codigo
  where c.grupo is null
     or (c.grupo = 'remote' and (q.admin or q.manager))
     or (c.grupo = 'sin_tienda' and q.admin);
$$;

comment on function public.phone_book() is
  'Directorio de la compania: personas ACTIVAS con extension de RingCentral y telefono (116). Tienda = codigo de Ajustes (directory_code) o su nombre, con la extension del grupo (directory_ext) si todas sus tiendas tienen la misma (117); las que comparten codigo son un grupo con el menor rango. directory_group remote lo ven manager y admin; sin_tienda (marcado o sin tienda resuelta) solo admin (111). Para authenticated. No expone direccion, cumpleanos, dias libres ni notas.';

revoke execute on function public.phone_book() from public, anon;
grant  execute on function public.phone_book() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop function if exists public.phone_book();
--   -- y crear public.phone_book() con el cuerpo de la 116 (nueve columnas), su comentario, su revoke y su
--   -- grant. En una transaccion. Las extensiones que haya en settings.stores se quedan; nadie las lee.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Se inventan extensiones dentro de la transaccion sobre las tiendas que haya: la primera con una, y dos
-- tiendas forzadas al mismo codigo con extensiones distintas.
--
--   begin;
--   update public.settings set stores = (
--     select jsonb_agg(
--              case s.ordinality
--                when 1 then s.value || '{"directory_ext":"1-ensayo"}'::jsonb
--                when 2 then s.value || '{"directory_code":"GRUPO-ENSAYO","directory_ext":"2-ensayo"}'::jsonb
--                when 3 then s.value || '{"directory_code":"GRUPO-ENSAYO","directory_ext":"3-ensayo"}'::jsonb
--                else s.value
--              end order by s.ordinality)
--       from jsonb_array_elements(stores) with ordinality as s(value, ordinality))
--    where id = 1;
--   set local role authenticated;
--
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   select store, store_ext, directory_group, count(*) from public.phone_book()
--    group by 1, 2, 3 order by 1;
--     -- la tienda 1 con «1-ensayo»; GRUPO-ENSAYO SIN extension (sus dos tiendas difieren);
--     -- las filas de remote y sin_tienda, con store_ext null
--   select count(*) from public.phone_book() where directory_group is not null and store_ext is not null;  -- 0
--   select count(*) from public.phone_book()
--    where nullif(btrim(coalesce(phone, '')), '') is null
--       or nullif(btrim(coalesce(ringcentral_ext, '')), '') is null;                                    -- 0 (116)
--
--   -- el mismo bloque con <uuid-manager> y <uuid-vendedor>: la misma extension por tienda, y los grupos
--   -- que cada rol ve (manager: tienda y remote; vendedor: solo tienda).
--
--   reset role;
--   rollback;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('117_phone_book_store_ext.sql', '0b9f3450a53f0cc721b887be7c9b042bad19300c90d2ba3e72b5ca7771a87c0b') on conflict (name) do nothing;
