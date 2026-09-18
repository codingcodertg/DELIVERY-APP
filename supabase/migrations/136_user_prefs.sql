-- ===========================================================================
-- 136 · user_prefs: las preferencias de cada persona, en la base y no en el navegador
-- ===========================================================================
-- Plan: docs/PLAN-136-user-prefs.md. La decision que la acompana: «las columnas de Ordenes, por usuario».
--
-- QUE HACE: una tabla nueva, `user_prefs`, con una fila por (persona, preferencia). Hoy guarda UNA cosa: que
-- columnas de la tabla de Ordenes eligio cada quien, que hasta ahora vivian en el localStorage — o sea, por
-- navegador y por rol, no por persona.
--
-- LO QUE NO ES: un cajon. La lista de `key` es CERRADA (anadir una es una migracion de una linea, a proposito) y
-- cada valor tiene tope de tamano. Sin esas dos cosas, cualquiera con sesion tendria almacenamiento arbitrario.
--
-- QUIEN LEE Y QUIEN ESCRIBE: cada uno SU fila, y nadie mas. Tampoco un admin: no hay para que, y una politica de
-- admin seria la unica forma de que esto filtrara algo. Tres politicas, una por comando; ninguna ALL. Sin DELETE:
-- una preferencia se sobrescribe. `user_id` va forzado a `auth.uid()` en el using Y en el with check: nadie escribe
-- la fila de otro ni regala la suya.
--
-- UNA COSA QUE HAY QUE SABER: durante una suplantacion la sesion ES la del suplantado, asi que un admin dentro de
-- otro usuario lee y escribe la fila de ESE usuario. Es lo correcto —ve lo que ve esa persona— y por eso la
-- pantalla no siembra desde el navegador mientras dura la suplantacion (eso vive en el codigo, no aqui).
--
-- No lleva `has_deliveries_access()`: es de la persona, no de Entregas.
-- Sin begin/commit: una migracion no lleva su propia transaccion.
-- ===========================================================================

create table if not exists public.user_prefs (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  key         text not null,
  -- Para `order_columns`: { "<rol>": ["stage", "type", ...] }. Por rol, porque quien cambia de papel no quiere
  -- las columnas de almacen cuando mira como gerente.
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key),
  constraint user_prefs_key_permitida check (key in ('order_columns')),
  constraint user_prefs_tamano check (pg_column_size(value) < 8192)
);

alter table public.user_prefs enable row level security;

-- En esta base una tabla nueva nace con todo concedido a `anon` y `authenticated` (medido al ensayar la 126).
revoke all on public.user_prefs from anon, authenticated;
grant select, insert, update on public.user_prefs to authenticated;

drop policy if exists "user_prefs select own" on public.user_prefs;
drop policy if exists "user_prefs insert own" on public.user_prefs;
drop policy if exists "user_prefs update own" on public.user_prefs;

create policy "user_prefs select own" on public.user_prefs for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_prefs insert own" on public.user_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_prefs update own" on public.user_prefs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- La fila es de quien es, y es la preferencia que es: ni una cosa ni la otra cambian. Vale tambien para la llave
-- de servicio, que se salta RLS pero no los disparadores.
create or replace function public.user_prefs_guard()
  returns trigger language plpgsql set search_path = public as $$
begin
  if NEW.user_id is distinct from OLD.user_id or NEW.key is distinct from OLD.key then
    raise exception 'A preference keeps its owner and its key';
  end if;
  NEW.updated_at := now();
  return NEW;
end $$;

drop trigger if exists user_prefs_guard on public.user_prefs;
create trigger user_prefs_guard
  before update on public.user_prefs
  for each row execute function public.user_prefs_guard();

revoke execute on function public.user_prefs_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Autocomprobacion (mira definiciones, no cuenta filas: sobrevive a re-aplicar)
-- ---------------------------------------------------------------------------
do $comprueba$
declare
  n integer;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.user_prefs'::regclass) then
    raise exception '136: user_prefs sin RLS';
  end if;

  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'user_prefs';
  if n <> 3 then raise exception '136: user_prefs debe tener 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_prefs' and cmd = 'ALL') then
    raise exception '136: user_prefs no debe tener ninguna politica ALL';
  end if;
  -- Las tres miran `auth.uid()`, y ninguna nombra un rol: tampoco un admin lee la fila de otro.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_prefs'
              and coalesce(qual, '') || coalesce(with_check, '') !~ 'auth\.uid\(\)') then
    raise exception '136: una politica de user_prefs no esta atada a auth.uid()';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_prefs'
              and coalesce(qual, '') || coalesce(with_check, '') ~ 'is_admin|current_user_role') then
    raise exception '136: ninguna politica de user_prefs debe mirar el rol';
  end if;
  -- El UPDATE lleva with check: sin el, alguien podria regalar su fila.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_prefs' and cmd = 'UPDATE' and with_check is null) then
    raise exception '136: la politica de UPDATE necesita with check';
  end if;

  if has_table_privilege('anon', 'public.user_prefs', 'select') or has_table_privilege('anon', 'public.user_prefs', 'insert') then
    raise exception '136: anon no debe tener nada sobre user_prefs';
  end if;
  if has_table_privilege('authenticated', 'public.user_prefs', 'delete') then
    raise exception '136: authenticated no debe poder borrar en user_prefs';
  end if;
  if not (has_table_privilege('authenticated', 'public.user_prefs', 'select') and has_table_privilege('authenticated', 'public.user_prefs', 'insert')
          and has_table_privilege('authenticated', 'public.user_prefs', 'update')) then
    raise exception '136: authenticated debe poder leer, insertar y actualizar user_prefs';
  end if;

  select count(*) into n from pg_constraint where conrelid = 'public.user_prefs'::regclass and conname in ('user_prefs_key_permitida', 'user_prefs_tamano');
  if n <> 2 then raise exception '136: faltan las restricciones de clave permitida o de tamano'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_prefs'::regclass and contype = 'p' and array_length(conkey, 1) = 2) then
    raise exception '136: la clave primaria debe ser (user_id, key)';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.user_prefs'::regclass and tgname = 'user_prefs_guard' and not tgisinternal) then
    raise exception '136: falta el disparador user_prefs_guard';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop table if exists public.user_prefs;
--   drop function if exists public.user_prefs_guard();
-- Borra las elecciones guardadas en la base. Nadie pierde nada visible: el codigo nunca borra el localStorage, y
-- cae a el si la tabla no existe.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- A y B son dos usuarios cualesquiera; «total» se cuenta ANTES como postgres.
--   1   A inserta ('order_columns', '{"logistics":["stage"]}') con su user_id; la lee          -> 1 fila
--   2   B inserta la suya. A lee                                                                -> 1 fila, la SUYA — MENOS que el total (2)
--   3   A inserta una fila con user_id de B                                                     -> BLOQUEADO (RLS)
--   4   A actualiza la fila de B                                                                -> 0 filas
--   5   A cambia user_id de su fila al de B                                                     -> BLOQUEADO (with check)
--   5b  lo mismo como service role                                                              -> BLOQUEADO (disparador)
--   6   A cambia la key de su fila                                                              -> BLOQUEADO (disparador)
--   7   A borra su fila                                                                         -> permission denied (sin grant de DELETE)
--   8   un admin lee la fila de A                                                               -> 0 filas: tampoco un admin
--   9   anon: select / insert                                                                   -> permission denied
--   10  key = 'lo_que_sea'                                                                      -> BLOQUEADO (lista cerrada)
--   11  value de 20 KB                                                                          -> BLOQUEADO (tamano)
--   12  A actualiza su value                                                                    -> 1 fila; updated_at avanza
--   13  borrar el perfil de A                                                                   -> su fila se va en cascada; no bloquea el borrado
--   14  un admin SUPLANTANDO a A lee y escribe                                                  -> la fila de A: la sesion es la de A (es lo esperado)
--   15  re-aplicar la 136                                                                       -> sin error; 3 politicas, ninguna ALL

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('136_user_prefs.sql', '4cfc10f12b2ec05a37fbbd980452aa4235ff62f471ea6bdb6a42b83f75f9b5f2') on conflict (name) do nothing;
