-- 110 · El directorio solo enseña a quien tiene algo que enseñar
--
-- La decision que la acompana es la de la rama `directorio-sin-huecos`, en DECISIONS.md.
--
-- SIN EL MARCADOR DE DECISION SIN NUMERAR, Y NO ES UN OLVIDO. Una migracion se ejecuta a
-- mano y su fila en `schema_migrations` guarda el checksum del cuerpo; sustituir el marcador
-- por el numero despues cambiaria ese cuerpo y `migrate-status` diria «cambiada» para
-- siempre. Por eso se cita la rama, que no cambia al numerar.
--
-- EL HUECO. Cargada la hoja del dueno, `phone_book()` devuelve 49 personas y cuatro de ellas
-- no tienen NI telefono, NI extension, NI correo: cuentas sueltas que no estan en la hoja de
-- RR. HH. Hoy salen en «(sin tienda) → (sin departamento)», y quien baja hasta el final de la
-- cascada llega a una tarjeta con tres rayas. El dueno lo pidio literal: «si no tiene tiendas
-- o puestos y asi entonces omitelo por ahora».
--
-- LA REGLA ES «NO HAY NADA QUE ENSENAR», NO «NO TIENE DEPARTAMENTO». Son dos filtros que con
-- los datos de HOY tacharian a las mismas cuatro personas, y por eso los datos no sirven para
-- elegir entre ellos: hay que elegirlo aqui. Se filtra por los TRES campos de contacto que la
-- tarjeta pinta —telefono, extension y correo— y NO por el departamento, porque alguien puede
-- no tener departamento y aun asi ser a quien buscas: Edgar Ayala no lo tiene, tiene la
-- extension 332, y tiene que seguir saliendo en Pharr. La prueba fija los dos casos.
--
-- Y NADIE SE MARCA COMO DADO DE BAJA. `date_left` es la fecha en que una persona se fue;
-- usarla para esconder una ficha incompleta seria escribir una mentira en el expediente para
-- arreglar una pantalla. El filtro vive en la funcion, que es donde se decide que se ve, y el
-- expediente no se toca: la persona sigue entera en RR. HH. y vuelve al directorio sola el dia
-- que alguien le ponga una extension.
--
-- El filtro mira el mismo dato que se devuelve. Los tres campos salen de `employee_files` (la
-- funcion no lee el correo de la cuenta), asi que «tiene algo que enseñar» y «se enseña algo»
-- no pueden discrepar. Y se comparan con `nullif(btrim(...), '')`, igual que la tienda en la
-- 109: un espacio en blanco es un campo vacio, no un dato de contacto.

-- ===========================================================================
-- El directorio, con el filtro
-- ===========================================================================
-- Parte de la definicion VIGENTE (109), no de otra: `create or replace` reemplaza la funcion
-- entera, y cualquier cosa que no se copie aqui se pierde en produccion. La tienda del
-- expediente de la 109 sigue exactamente igual, en los dos sitios donde se usa.
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
      -- Al menos uno de los tres campos de contacto. Sin ninguno no hay tarjeta que pintar, y
      -- la persona ocupa un sitio en la cascada que no lleva a nada. El departamento NO entra
      -- aqui a proposito: quien no lo tiene pero si una extension sigue saliendo.
      and coalesce(
            nullif(btrim(coalesce(f.phone, '')), ''),
            nullif(btrim(coalesce(f.ringcentral_ext, '')), ''),
            nullif(btrim(coalesce(f.email, '')), '')
          ) is not null
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
  'Directorio de la compania: nombre, titulo, tienda (con su orden de Ajustes), departamento, telefono, extension y correo de contacto de las personas ACTIVAS que tienen al menos un dato de contacto (110). La tienda es la de la cuenta y, sin cuenta, la del expediente (109). Para authenticated. No expone direccion, cumpleanos, dias libres ni notas.';

revoke execute on function public.phone_book() from public, anon;
grant  execute on function public.phone_book() to authenticated;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   -- volver a crear public.phone_book() con el cuerpo de la 109 (el de arriba sin el
--   -- `and coalesce(...) is not null`), y devolver el comentario de la 109.
--   -- No hay dato que restaurar: esta migracion no escribe nada, solo decide que se lee.

-- ===========================================================================
-- Comprobacion despues de aplicarla (de solo lectura, fuera de esta migracion)
-- ===========================================================================
--   select count(*) from public.phone_book();                      -- esperado: 45 (49 - 4)
--   select count(*) from public.phone_book() where full_name in
--     ('Andres Ugarte', 'Elsa Vasquez', 'Jose Perez (Owner)', 'JULIO');   -- esperado: 0
--   select full_name, store, department, ringcentral_ext
--     from public.phone_book() where full_name ilike '%Ayala%';    -- esperado: Pharr, ext 332

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('110_phone_book_con_contacto.sql', '80e47d687f272b001045a1e3df99aa50a75d58cbda4875bc7a07c91063a18337') on conflict (name) do nothing;
