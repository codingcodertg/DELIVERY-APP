-- 108 · Directorio telefonico de la compania: el departamento, y quien puede leer la lista
--
-- La decision que la acompana es la de la rama `directorio-telefonico`, en DECISIONS.md.
--
-- SIN EL MARCADOR DE DECISION SIN NUMERAR, Y NO ES UN OLVIDO. Una migracion se ejecuta a
-- mano y su fila en `schema_migrations` guarda el checksum del cuerpo; sustituir el marcador
-- por el numero despues cambiaria ese cuerpo y `migrate-status` diria «cambiada» para
-- siempre. Por eso se cita la rama, que no cambia al numerar.
--
-- El dueno quiere un directorio en el hub que vea TODA la plantilla: buscar a alguien y ver
-- su telefono y su correo. Dos cosas lo impedian:
--
--   1. NO EXISTIA «DEPARTAMENTO» en ninguna parte. El expediente (106) guarda nombre,
--      correo de contacto, telefono y extension; la tienda vive en `profiles.store`; el
--      titulo de la pastilla en `profiles.title` (104). Departamento, en ningun sitio.
--   2. `recruiting.employee_files` es de RR. HH. y solo de RR. HH.: la 094 la deja en
--      admin y gerente del modulo. Un vendedor no puede leer esa tabla, y no debe poder
--      —ahi viven direccion, cumpleanos, dias libres y notas—, pero el directorio tiene
--      que verlo todo el mundo.
--
-- POR QUE UNA FUNCION Y NO UNA POLITICA NUEVA
--
-- Abrir `employee_files` a `authenticated` con una politica de lectura expondria la FILA
-- ENTERA: la RLS permite o niega filas, no columnas. Esta funcion expone SIETE COLUMNAS y
-- ninguna mas, y se lee de una sola forma. La 094 no se toca: quien no era de RR. HH.
-- sigue sin poder leer la tabla directamente.
--
-- Y SOLO LAS PERSONAS ACTIVAS: `date_left is null`. El estado se deriva de esa fecha (106),
-- asi que quien se fue desaparece del directorio el mismo dia, sin que nadie tenga que
-- acordarse de borrarlo de una lista aparte.

-- ===========================================================================
-- 1. El departamento, donde vive el resto de lo que RR. HH. mantiene
-- ===========================================================================
alter table recruiting.employee_files
  add column if not exists department text;

comment on column recruiting.employee_files.department is
  'Departamento al que pertenece, para el directorio de la compania. Texto libre elegido de la lista de recruiting.settings.departments; null = sin departamento, y el directorio lo agrupa aparte.';

-- La lista para elegir, en los ajustes del modulo que edita el expediente. Es una lista y no
-- una tabla de catalogo por lo mismo que `roles`: son media docena de nombres que cambian una
-- vez al ano, y una tabla con su RLS seria mas aparato que dato. Los de partida los dijo el
-- dueno; la cierra el desde Ajustes.
alter table recruiting.settings
  add column if not exists departments text[] not null
  default array['Ventas','Almacen','Oficina','Choferes','Contabilidad','Logistica']::text[];

comment on column recruiting.settings.departments is
  'Departamentos que se pueden elegir en el expediente (directorio de la compania). Editable por admin y gerente de RR. HH.';

-- ===========================================================================
-- 2. La lectura que si es de todos
-- ===========================================================================
-- `security definer` porque tiene que leer tres sitios que quien llama no puede: el
-- expediente (094), `profiles` de otra persona y `settings`. Devuelve lo que cabe en una
-- tarjeta de contacto y nada mas.
--
-- `store_rank` sale del ORDEN de las tiendas en Ajustes, no del alfabeto: ese orden lo puso
-- alguien y es el que tiene en la cabeza quien busca. Se calcula aqui porque `public.settings`
-- tampoco la puede leer todo el mundo —la 100 la deja en `has_deliveries_access()`— y sin
-- esto la pantalla tendria que pedirla aparte y quedarse sin ella justo para quien no tiene
-- Entregas, que es parte de la gente a la que esto viene a servir.
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
  )
  select
    -- El nombre que se ensena es el de la cuenta si la hay, y el del expediente si no:
    -- misma regla que la lista de RR. HH. (`nombreVisible`), para que no digan cosas
    -- distintas de la misma persona.
    coalesce(
      nullif(btrim(coalesce(p.full_name, '')), ''),
      nullif(btrim(coalesce(f.full_name, '')), ''),
      '—'
    )::text                as full_name,
    p.title::text          as title,
    p.store::text          as store,
    o.rank                 as store_rank,
    f.department::text     as department,
    f.phone::text          as phone,
    f.ringcentral_ext::text as ringcentral_ext,
    f.email::text          as email
  from recruiting.employee_files f
  left join public.profiles p on p.id = f.profile_id
  left join orden o on o.nombre = p.store
  where f.date_left is null;
$$;

comment on function public.phone_book() is
  'Directorio de la compania: nombre, titulo, tienda, departamento, telefono, extension y correo de contacto de las personas ACTIVAS. Para authenticated. No expone direccion, cumpleanos, dias libres ni notas.';

revoke execute on function public.phone_book() from public, anon;
grant  execute on function public.phone_book() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop function if exists public.phone_book();
--   alter table recruiting.settings drop column if exists departments;
--   alter table recruiting.employee_files drop column if exists department;   -- borra el dato

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('108_phone_book.sql', 'a72880204a19d66ecedb92fecd318ab8138773e2b93c8fd9118f633b64575b11') on conflict (name) do nothing;
