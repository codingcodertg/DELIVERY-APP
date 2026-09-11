-- 106 · El expediente deja de depender de la cuenta (D-NEXT)
--
-- El dueno quiere en HR el expediente de TODA la plantilla: cuando ingresaron, cuando
-- se fueron, si estan desactivados, si tienen usuario creado, si lo ocupan, correo,
-- telefono y si tienen RingCentral. Y Reclutamiento dentro, como un boton.
--
-- Hoy no se puede, y el motivo esta en una linea de 093:
--
--   id uuid primary key references public.profiles(id) on delete cascade
--
-- El expediente ES la cuenta. Sin cuenta no hay expediente, y borrar la cuenta borra
-- el expediente con sus documentos. Un empleado que se va deja de existir en RR. HH.
-- justo cuando su expediente empieza a hacer falta.
--
-- Esta migracion invierte la dependencia: el expediente tiene identidad propia y la
-- cuenta pasa a ser un dato opcional dentro de el.
--
-- SE PUEDE EJECUTAR ANTES DE QUE EXISTA EL CODIGO QUE LA USA. Es la condicion que
-- pidio el orquestador y la que evita la caida del 2026-09-10. Y es repetible: cada
-- paso comprueba antes de actuar, asi que ejecutarla dos veces no hace dano.
--
-- OJO A UN DETALLE QUE NO SE VE: `employee_docs.employee_id` apunta hoy a
-- `profiles(id)`. Al mover la identidad hay que reapuntarlo, y si un documento se
-- quedara sin destino la FK nueva fallaria a mitad. Por eso el paso 2 crea el
-- expediente que falte ANTES de tocar la FK, y el paso 5 lo comprueba contando.

-- ===========================================================================
-- 1. El expediente gana identidad propia
-- ===========================================================================
-- `id` ya es uuid, asi que no cambia de tipo ni de valor: lo que se le quita es el
-- ser, ademas, la clave ajena a profiles. Las filas existentes conservan su id.
-- Se busca la restriccion en vez de escribir su nombre: `employee_files_id_fkey` es el
-- nombre que Postgres le habria puesto, pero si en produccion se llamara de otra forma,
-- un `drop constraint if exists` con el nombre equivocado no hace nada Y NO FALLA — el
-- expediente seguiria atado a la cuenta y esto se descubriria el dia que alguien diera
-- de alta a una persona sin usuario.
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'recruiting' and rel.relname = 'employee_files'
       and con.contype = 'f'
       and con.confrelid = 'public.profiles'::regclass
       and con.conkey = array[(select attnum from pg_attribute
                                where attrelid = rel.oid and attname = 'id')]
  loop
    execute format('alter table recruiting.employee_files drop constraint %I', c);
  end loop;
end $$;

alter table recruiting.employee_files
  alter column id set default gen_random_uuid();

-- La cuenta, ahora un dato opcional del expediente. `set null` y no `cascade`: si
-- alguien borra la cuenta, el expediente se queda — que es el objeto de esta rama.
alter table recruiting.employee_files
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

-- Un expediente por cuenta. Parcial, porque los expedientes sin cuenta son varios y
-- todos con null.
create unique index if not exists employee_files_profile_uniq
  on recruiting.employee_files (profile_id) where profile_id is not null;

-- Los datos que ahora tienen que vivir aqui, porque una persona sin cuenta tambien
-- tiene nombre y telefono.
alter table recruiting.employee_files
  add column if not exists full_name       text,
  -- El correo de CONTACTO, que no es el de acceso: quien entra con usuario tiene un
  -- correo sintetico (@users.rdztilegroup.net) que no es de nadie, y quien entra con
  -- correo puede tener otro distinto para RR. HH.
  add column if not exists email           text,
  -- Cuando se fue. El ESTADO no se guarda: se deriva de esta fecha (ver el comentario
  -- de la columna). Un estado guardado aparte de su fecha se desincroniza.
  add column if not exists date_left       date,
  -- Extension de RingCentral, a mano. La integracion es de empresa (un JWT, sin dato
  -- por persona), asi que esto es lo unico que hoy se puede saber.
  add column if not exists ringcentral_ext text;

comment on column recruiting.employee_files.profile_id is
  'La cuenta de esta persona, si tiene. Null = expediente sin cuenta. Solo un admin de RR. HH. la enlaza o la quita (trigger de mas abajo).';
comment on column recruiting.employee_files.date_left is
  'Fecha de baja. El estado se DERIVA: sin fecha = activo, con fecha = baja. No hay columna de estado, a proposito.';
comment on column recruiting.employee_files.email is
  'Correo de contacto de RR. HH. NO es el correo de acceso, que vive en auth y puede ser sintetico.';

-- ===========================================================================
-- 2. Migrar lo que hay: cada fila conserva su id, y su id era su cuenta
-- ===========================================================================
update recruiting.employee_files
   set profile_id = id
 where profile_id is null
   and exists (select 1 from public.profiles p where p.id = recruiting.employee_files.id);

-- Y un expediente para cada persona que aun no lo tenia, con el MISMO id que su
-- cuenta. Dos razones, y la segunda es la que evita una caida:
--   . el expediente pasa a ser la ficha principal, asi que "persona sin expediente"
--     deja de ser un estado que tenga sentido;
--   . `employee_docs.employee_id` apunta hoy a profiles y va a apuntar al expediente.
--     Un documento de alguien sin expediente se quedaria sin destino y la FK nueva
--     fallaria. Creandolos aqui, todos los valores que ya existen siguen siendo
--     validos y no hay que reescribir un solo `employee_id`.
insert into recruiting.employee_files (id, profile_id, full_name)
select p.id, p.id, p.full_name
  from public.profiles p
 where not exists (select 1 from recruiting.employee_files f where f.id = p.id)
   and not exists (select 1 from recruiting.employee_files f where f.profile_id = p.id);

-- El nombre del perfil manda cuando hay cuenta. Se rellena aqui para que la tabla
-- valga por si sola; la app sigue prefiriendo el del perfil cuando hay enlace.
update recruiting.employee_files f
   set full_name = p.full_name
  from public.profiles p
 where f.profile_id = p.id
   and (f.full_name is null or btrim(f.full_name) = '');

-- ===========================================================================
-- 3. Los documentos cuelgan del expediente, no de la cuenta
-- ===========================================================================
-- Lo mismo con la de documentos, y por el mismo motivo: si quedara la vieja apuntando a
-- profiles, un documento de una persona sin cuenta seria imposible de crear.
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'recruiting' and rel.relname = 'employee_docs'
       and con.contype = 'f'
       and con.confrelid = 'public.profiles'::regclass
       -- SOLO la de employee_id. `created_by` tambien apunta a profiles y tiene que
       -- seguir apuntando ahi: quien anadio el papel es una cuenta, no un expediente.
       and con.conkey = array[(select attnum from pg_attribute
                                where attrelid = rel.oid and attname = 'employee_id')]
  loop
    execute format('alter table recruiting.employee_docs drop constraint %I', c);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'employee_docs_file_fkey'
       and conrelid = 'recruiting.employee_docs'::regclass
  ) then
    alter table recruiting.employee_docs
      add constraint employee_docs_file_fkey
      foreign key (employee_id) references recruiting.employee_files(id) on delete cascade;
  end if;
end $$;

comment on column recruiting.employee_docs.employee_id is
  'El EXPEDIENTE al que pertenece (106), no la cuenta. Los valores no cambiaron: cada expediente conservo el id que ya tenia.';

-- ===========================================================================
-- 4. Quien enlaza una cuenta con un expediente
-- ===========================================================================
-- La RLS de 094 deja escribir el expediente entero a admin y gerente de RR. HH. Pero
-- `profile_id` no es un dato mas: es lo que dice de quien es este expediente, y con el
-- viajan el acceso y todo lo que cuelgue del enlace. Solo el admin del modulo.
--
-- Va en un trigger porque la RLS no filtra por columna: una politica solo puede
-- permitir o negar la fila entera.
create or replace function recruiting.guard_employee_file_link()
  returns trigger language plpgsql security definer set search_path = recruiting, public as $$
begin
  if TG_OP = 'INSERT' and NEW.profile_id is null then return NEW; end if;
  if TG_OP = 'UPDATE' and NEW.profile_id is not distinct from OLD.profile_id then return NEW; end if;
  -- service_role y las migraciones no tienen sesion: auth.uid() es null y pasan. El
  -- guard existe para el cliente, que es quien llega con una sesion detras.
  if auth.uid() is null then return NEW; end if;
  if coalesce(public.current_recruiting_role(), '') <> 'admin' then
    raise exception 'Only an HR admin can link or unlink an employee file to an account';
  end if;
  return NEW;
end $$;

drop trigger if exists employee_files_guard_link on recruiting.employee_files;
create trigger employee_files_guard_link
  before insert or update on recruiting.employee_files
  for each row execute function recruiting.guard_employee_file_link();

-- Las politicas de 094 no se tocan: admin y gerente leen y escriben, el reclutador no
-- entra. Lo unico que este trigger anade es la columna del enlace.

-- ===========================================================================
-- 5. Comprobar antes de dar por buena la migracion
-- ===========================================================================
-- Un `alter` que deja documentos huerfanos no falla solo: falla el dia que alguien
-- abre un expediente. Se cuenta aqui, y si no cuadra, la transaccion entera se cae.
do $$
declare
  docs_total    bigint;
  docs_ligados  bigint;
  files_sin_pk  bigint;
  perfiles      bigint;
  files_ligados bigint;
begin
  select count(*) into docs_total from recruiting.employee_docs;
  select count(*) into docs_ligados
    from recruiting.employee_docs d
    join recruiting.employee_files f on f.id = d.employee_id;
  if docs_total <> docs_ligados then
    raise exception '106: % de % documentos se quedaron sin expediente', docs_total - docs_ligados, docs_total;
  end if;

  select count(*) into files_sin_pk from recruiting.employee_files where id is null;
  if files_sin_pk > 0 then
    raise exception '106: % expedientes sin id', files_sin_pk;
  end if;

  select count(*) into perfiles from public.profiles;
  select count(*) into files_ligados from recruiting.employee_files where profile_id is not null;
  if files_ligados <> perfiles then
    raise exception '106: % perfiles pero % expedientes con cuenta; cada perfil deberia tener el suyo', perfiles, files_ligados;
  end if;

  raise notice '106 ok: % documentos, % perfiles, % expedientes con cuenta', docs_total, perfiles, files_ligados;
end $$;

comment on table recruiting.employee_files is
  'Ficha principal de la persona en RR. HH. (D-NEXT). Identidad propia: la cuenta (profile_id) es opcional y puede faltar o irse sin llevarse el expediente. Solo admin y gerente de RR. HH. (094).';

-- ===========================================================================
-- Reversion
-- ===========================================================================
-- No es simetrica y conviene saberlo antes de necesitarla: volver a 093 significa
-- BORRAR los expedientes sin cuenta, porque en aquel modelo no caben.
--
--   delete from recruiting.employee_files where profile_id is null;   -- se pierde
--   alter table recruiting.employee_docs drop constraint employee_docs_file_fkey;
--   alter table recruiting.employee_docs add constraint employee_docs_employee_id_fkey
--     foreign key (employee_id) references public.profiles(id) on delete cascade;
--   drop trigger if exists employee_files_guard_link on recruiting.employee_files;
--   drop function if exists recruiting.guard_employee_file_link();
--   alter table recruiting.employee_files alter column id drop default;
--   alter table recruiting.employee_files add constraint employee_files_id_fkey
--     foreign key (id) references public.profiles(id) on delete cascade;   -- falla si queda alguno sin cuenta
--   alter table recruiting.employee_files
--     drop column profile_id, drop column full_name, drop column email,
--     drop column date_left, drop column ringcentral_ext;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('106_employee_file_identity.sql', '46791ae5a7eb2308a61da2746bf8f8c6966743a1ab35957488a78a08c791e031') on conflict (name) do nothing;
