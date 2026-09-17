-- 116 · El directorio: solo quien tiene extension Y telefono
--
-- La decision que la acompana es la de la rama `directorio-con-telefono`, en DECISIONS.md. Se cita la rama
-- y no el numero: el checksum congela este cuerpo.
--
-- EL PEDIDO. El dueno: «si no tienen numero de telefono, quitalos del directorio». AMPLIA la regla del
-- 2026-09-16 (111, «solo sale quien tiene extension de RingCentral»), no la reemplaza: hace falta la
-- extension Y el telefono. Medido en produccion por el orquestador el 2026-09-17: de las 45 personas que
-- devolvia la funcion como admin, 15 no tienen telefono (todas con extension): dos de Remote, tres de
-- Sin tienda y diez de tiendas. Ningun telefono con formato raro.
--
-- UN TELEFONO DE SOLO ESPACIOS NO CUENTA: se compara con `nullif(btrim(...), '')`, igual que la extension.
--
-- LA FUNCION SE COPIA ENTERA DE LA VIGENTE (111) y cambia SOLO el filtro y su comentario: los grupos
-- Remote y Sin tienda, quien los ve, el codigo de tienda, los rangos, `security definer`, el
-- `search_path` y los permisos quedan igual. La prueba compara la copia con la 111. La firma no cambia (las
-- nueve columnas), asi que basta `create or replace`: el directorio no deja de existir mientras se aplica.
--
-- LO QUE NO CAMBIA: el expediente. Quien no tiene telefono sigue entero en RR. HH., y vuelve al directorio
-- solo el dia que alguien se lo ponga. Ni `date_left` ni nada del expediente se toca para esconderlo (D-259).

create or replace function public.phone_book()
returns table (
  full_name       text,
  title           text,
  store           text,
  store_rank      int,
  department      text,
  phone           text,
  ringcentral_ext text,
  email           text,
  directory_group text
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
           s.ordinality::int as rank
      from public.settings cfg,
           jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) with ordinality as s(value, ordinality)
     where cfg.id = 1
  ),
  orden as (
    -- Las tiendas que comparten codigo son un solo grupo, y el grupo va donde va la primera.
    select t.nombre, t.codigo, min(t.rank) over (partition by t.codigo) as rank
      from tiendas t
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
    c.grupo::text                                                        as directory_group
  from clasificadas c
  cross join quien q
  left join orden o on o.nombre = c.tienda and c.grupo is null
  where c.grupo is null
     or (c.grupo = 'remote' and (q.admin or q.manager))
     or (c.grupo = 'sin_tienda' and q.admin);
$$;

comment on function public.phone_book() is
  'Directorio de la compania: personas ACTIVAS con extension de RingCentral y telefono (116). Tienda = codigo de Ajustes (directory_code) o su nombre; las que comparten codigo son un grupo con el menor rango. directory_group remote lo ven manager y admin; sin_tienda (marcado o sin tienda resuelta) solo admin (111). Para authenticated. No expone direccion, cumpleanos, dias libres ni notas.';

revoke execute on function public.phone_book() from public, anon;
grant  execute on function public.phone_book() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   create or replace function public.phone_book() con el cuerpo de la 111 (misma firma), su comentario,
--   su revoke y su grant. No hay dato que restaurar: esta migracion no escribe nada.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- De solo lectura: no hace falta inventar datos. Un bloque por rol (<uuid-...> son cuentas reales).
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   select count(*) from public.phone_book()
--    where nullif(btrim(coalesce(phone, '')), '') is null;             -- 0 sin telefono
--   select count(*) from public.phone_book()
--    where nullif(btrim(coalesce(ringcentral_ext, '')), '') is null;   -- 0 sin extension
--   select coalesce(directory_group, 'tienda') as grupo, count(*)
--     from public.phone_book() group by 1 order by 1;                  -- admin: tienda, remote y sin_tienda
--   rollback;
--
--   -- el mismo bloque con <uuid-manager> (tienda y remote) y con <uuid-vendedor> (solo tienda):
--   -- en los dos, 0 sin telefono y 0 sin extension.
--
--   -- y el total, como admin: el de antes menos los que no tienen telefono (medido: 45 - 15 = 30).

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('116_phone_book_with_phone.sql', 'f3c837b9ddc177b5206fad261ff08a7a1d3499a8f938a9813b73d612e75f6892') on conflict (name) do nothing;
