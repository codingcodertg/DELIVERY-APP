-- 111 · El directorio: solo con extension, grupos Remote y Sin tienda, y codigo de tienda
--
-- La decision que la acompana es la de la rama `directorio-sin-huecos`, en DECISIONS.md (la
-- segunda entrada de esa rama; la primera es la de la 110).
--
-- SIN EL MARCADOR DE DECISION SIN NUMERAR, Y NO ES UN OLVIDO: el checksum de una migracion
-- congela su cuerpo, y numerar despues lo cambiaria. Se cita la rama, que no cambia.
--
-- TRES REGLAS DEL DUENO, 2026-09-16.
--
-- 1. SOLO SALE QUIEN TIENE EXTENSION DE RINGCENTRAL. Reemplaza el filtro de la 110 («algun
--    dato de contacto»). Con los datos medidos el 2026-09-15 los dos filtros dejan a las mismas
--    personas —toda la que tiene algun dato tiene extension—, asi que la base no distingue una
--    regla de la otra; lo hace la prueba.
--
-- 2. DOS GRUPOS QUE NO SON UNA TIENDA, con quien los ve:
--      'remote'     -> grupo «Remote», solo lo ven manager y admin;
--      'sin_tienda' -> grupo «Sin tienda», solo lo ve admin.
--    Se marcan en el expediente (`directory_group`), y quien no tiene tienda resuelta cae en
--    «Sin tienda» sin marcarlo. Si un expediente dice 'remote', manda eso aunque no tenga
--    tienda: es una decision explicita, y «no tiene tienda» es solo la ausencia de un dato.
--    `profiles.store` NO se toca: acota lo que alguien ve en Entregas, y una persona puede
--    seguir con su tienda alli y aun asi ir a «Sin tienda» en el directorio. Por eso una
--    fila de grupo sale SIN tienda ni rango: si llevara la tienda de la cuenta, la tarjeta
--    diria una tienda y la cascada otra.
--
-- 3. CODIGO DE TIENDA. Clave opcional `directory_code` en cada objeto de
--    `public.settings.stores`. Con codigo, la funcion devuelve el codigo como tienda, y las
--    tiendas que comparten codigo se funden en un grupo con el MENOR de sus rangos. Sin
--    codigo, el nombre, como hasta ahora. Ni un nombre ni un codigo de tienda en este fichero:
--    son datos del dueno y viven en Ajustes.
--
-- 4. SOLO UN ADMIN DE RR. HH. CAMBIA `directory_group`. La ficha ya lo limita, pero la RLS de la
--    094 deja escribir el expediente entero a admin Y gerente de RR. HH., y un gerente que
--    escriba por REST directo se saltaria la ficha. La barrera va en el guard de la 106, el que
--    ya protege `profile_id`, por la misma razon que alli: la RLS no filtra por columna.
--
-- QUIEN VE QUE SE DECIDE AQUI, EN LA FUNCION, no en la pantalla: la pantalla pinta lo que
-- vuelve. Los helpers de rol, medidos y no supuestos:
--   * `public.is_admin()` (vigente en la 099) = `current_user_role() = 'admin'`;
--   * `public.current_user_role()` (supabase/roles.sql, ninguna migracion la redefine) =
--     `profiles.role` de `auth.uid()`;
--   * NO existe `is_manager()`; manager se lee de `current_user_role()`.
-- Sin sesion (`auth.uid()` null) los dos dan null, que aqui cuenta como false: solo tiendas.
--
-- LA FIRMA CAMBIA: una novena columna, `directory_group`. `create or replace` no puede cambiar
-- las columnas de una funcion que devuelve tabla, asi que se BORRA y se crea, y los permisos se
-- vuelven a dar (una funcion nueva nace ejecutable por PUBLIC). Entre el `drop` y el `create`
-- la funcion no existe: esto se aplica en UNA transaccion, o el directorio falla ese instante.

-- ===========================================================================
-- 1. La marca de grupo en el expediente
-- ===========================================================================
alter table recruiting.employee_files
  add column if not exists directory_group text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'employee_files_directory_group_check'
       and conrelid = 'recruiting.employee_files'::regclass
  ) then
    alter table recruiting.employee_files
      add constraint employee_files_directory_group_check
      check (directory_group in ('remote', 'sin_tienda'));
  end if;
end $$;

comment on column recruiting.employee_files.directory_group is
  'Grupo del directorio que no es una tienda: remote (lo ven manager y admin) o sin_tienda (solo admin). Null = por su tienda. No toca profiles.store ni lo que la persona ve en Entregas (111).';

-- ===========================================================================
-- 2. Quien cambia la marca: solo el admin de RR. HH.
-- ===========================================================================
-- Parte de la definicion VIGENTE del guard, que es la de la 106: ninguna migracion posterior lo
-- redefine (medido con grep sobre supabase/). `current_recruiting_role()` es la de la 055, sin
-- redefinir. El trigger que lo llama (`employee_files_guard_link`, before insert or update) no
-- se toca: `create or replace function` conserva el enlace.
--
-- NO BASTA CON ANADIR UNA LINEA. La 106 sale en cuanto `profile_id` no cambia (`return NEW`), y
-- una comprobacion puesta despues no se ejecutaria nunca en un update que solo toca el grupo:
-- justo el caso a parar. Primero se mira que cambia, y solo se sale si no cambia NINGUNA de las
-- dos columnas.
--
-- La salida por `pg_trigger_depth() > 1` sigue existiendo para el enlace (la cuenta que nace y
-- crea su expediente), pero NO para el grupo: ningun trigger escribe `directory_group`, y una
-- puerta que nadie necesita es una puerta.
create or replace function recruiting.guard_employee_file_link()
  returns trigger language plpgsql security definer set search_path = recruiting, public as $$
declare
  cambia_enlace boolean;
  cambia_grupo  boolean;
begin
  if TG_OP = 'INSERT' then
    cambia_enlace := NEW.profile_id is not null;
    cambia_grupo  := NEW.directory_group is not null;
  else
    cambia_enlace := NEW.profile_id is distinct from OLD.profile_id;
    cambia_grupo  := NEW.directory_group is distinct from OLD.directory_group;
  end if;
  if not (cambia_enlace or cambia_grupo) then return NEW; end if;
  -- Un insert que viene de otro trigger (cuando nace una cuenta) no es alguien enlazando a
  -- mano: es la propia base manteniendo su invariante. Solo vale para el enlace.
  if pg_trigger_depth() > 1 and not cambia_grupo then return NEW; end if;
  -- service_role y las migraciones no tienen sesion: auth.uid() es null y pasan. El
  -- guard existe para el cliente, que es quien llega con una sesion detras.
  if auth.uid() is null then return NEW; end if;
  if coalesce(public.current_recruiting_role(), '') <> 'admin' then
    if cambia_enlace then
      raise exception 'Only an HR admin can link or unlink an employee file to an account';
    end if;
    raise exception 'Only an HR admin can change the directory group of an employee file';
  end if;
  return NEW;
end $$;

-- ===========================================================================
-- 3. El directorio
-- ===========================================================================
-- Parte de la definicion VIGENTE (110). Lo que no cambia se copia tal cual: el nombre visible,
-- la tienda de la cuenta o del expediente (109), `date_left`, `security definer` y su
-- `search_path`.
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
      -- Solo quien tiene extension. Un espacio en blanco no es una extension.
      and nullif(btrim(coalesce(f.ringcentral_ext, '')), '') is not null
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
  'Directorio de la compania: personas ACTIVAS con extension de RingCentral. Tienda = codigo de Ajustes (directory_code) o su nombre; las que comparten codigo son un grupo con el menor rango. directory_group remote lo ven manager y admin; sin_tienda (marcado o sin tienda resuelta) solo admin (111). Para authenticated. No expone direccion, cumpleanos, dias libres ni notas.';

revoke execute on function public.phone_book() from public, anon;
grant  execute on function public.phone_book() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop function if exists public.phone_book();
--   -- y crear public.phone_book() con el cuerpo de la 110 (ocho columnas), con su comentario,
--   -- su `revoke` y su `grant`. En una transaccion, por lo mismo que arriba.
--   -- volver a crear recruiting.guard_employee_file_link() con el cuerpo de la 106, ANTES de
--   -- borrar la columna (el guard de la 111 la lee).
--   alter table recruiting.employee_files drop constraint if exists employee_files_directory_group_check;
--   alter table recruiting.employee_files drop column if exists directory_group;   -- borra el dato

-- ===========================================================================
-- Comprobacion despues de aplicarla: matriz por rol, de solo lectura y con ROLLBACK
-- ===========================================================================
-- Un bloque por rol; <uuid-...> es el id de una cuenta real de ese rol. Nada de esto escribe.
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   select coalesce(directory_group, 'tienda') as grupo, count(*)
--     from public.phone_book() group by 1 order by 1;   -- admin: remote, sin_tienda y tienda
--   rollback;
--
--   -- el mismo bloque con <uuid-manager>                -- manager: remote y tienda; NO sin_tienda
--   -- el mismo bloque con <uuid-vendedor>               -- vendedor: solo tienda
--
--   -- dentro de cualquiera de los bloques:
--   select count(*) from public.phone_book()
--    where directory_group is not null and (store is not null or store_rank is not null);  -- 0
--   select count(*) from public.phone_book()
--    where nullif(btrim(coalesce(ringcentral_ext, '')), '') is null;                       -- 0
--   select store, min(store_rank), max(store_rank), count(*) from public.phone_book()
--    where directory_group is null group by store order by 2;   -- min = max en cada tienda
--
-- Y la barrera de la marca. Esto SI escribe, dentro de la transaccion, y el ROLLBACK lo deshace:
-- el unico trigger de `employee_files` es este guard, que no llama a nada de fuera.
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-gerente-rrhh>","role":"authenticated"}';
--   update recruiting.employee_files set directory_group = 'remote' where id = '<id-expediente>';
--   -- esperado: ERROR  Only an HR admin can change the directory group of an employee file
--   rollback;
--
--   -- el mismo bloque con <uuid-admin-rrhh>:              esperado: UPDATE 1
--   -- gerente, otro campo sin tocar el grupo:             esperado: UPDATE 1 (no se rompe su trabajo)
--   --   update recruiting.employee_files set notes = notes where id = '<id-expediente>';
--   -- admin, valor fuera del vocabulario ('otro'):       esperado: ERROR del check

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('111_phone_book_grupos.sql', '08251256067032c359faf8bce459c0223abb228bb7e26dc8251ff5c3dbeefa49') on conflict (name) do nothing;
