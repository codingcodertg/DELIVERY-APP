-- ===========================================================================
-- 317 - Una cuenta nueva nunca toma su rol de lo que diga quien se registra (D-1070, auditoría de seguridad)
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueño.
--
-- EL HUECO. `handle_new_user()` (disparador AFTER INSERT en auth.users) copiaba a public.profiles el `role` y el
-- `recruiting_role` de `raw_user_meta_data`, que escribe QUIEN SE REGISTRA. Con el registro abierto y la llave anon
-- pública, cualquiera podía darse de alta como admin. Además la política «profiles insert self» dejaba a una cuenta sin
-- ficha insertarse la suya con el rol que quisiera (los guardias de profiles solo vigilan UPDATE).
--
-- QUÉ HACE.
--   1. handle_new_user: la ficha nace con rol «sales», sin rol de RR. HH. y sin módulos. El rol de verdad lo pone el
--      servidor con la llave de servicio después de crear la cuenta (/api/invite ya lo hace: update de role, store,
--      username). El nombre sí se sigue tomando del registro.
--   2. Quita la política «profiles insert self»: el disparador es SECURITY DEFINER y no la necesita.
--
-- LO QUE NO TOCA. Las fichas existentes, los guardias de UPDATE, el resto de políticas.
-- Deshacer: volver a la definición anterior de handle_new_user (migración que la creó) y
--   create policy "profiles insert self" on public.profiles for insert to authenticated with check (id = auth.uid());
-- ===========================================================================

create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, recruiting_role, module_access)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    'sales',
    null,
    '{}'::text[]
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop policy if exists "profiles insert self" on public.profiles;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('317_alta_sin_rol_del_cliente.sql', 'e38fdab5024e4b786d464e9ee4d91b4fede776722ca9e90ef23c92e4f6237527') on conflict (name) do nothing;
