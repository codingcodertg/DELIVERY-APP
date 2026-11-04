-- 236: Security — cerrar todas las sesiones de una persona (D-828, 2026-11-03).
--
-- El dueño, tras la baja de Melissa Garza: quedaron 23 sesiones vivas en Auth aunque la cuenta estaba apagada. El ban
-- las vuelve inútiles (no se renuevan), pero lo limpio es borrarlas: la baja (D-709) lo hace sola, y el admin tiene
-- un botón en Security para cualquier persona («perdió el teléfono», «sospecho de esa cuenta»).
--
-- `auth.sessions` solo la toca el dueño de la base. Esta función es SECURITY DEFINER (corre como quien la creó, el
-- dueño) y la puede llamar un admin del hub (security_is_admin, 229) o la llave de servicio (la baja, desde el
-- servidor). Borra las sesiones; los refresh tokens caen en cascada. Deja rastro en security_events (053).
--
-- Sin begin/commit propios. Para deshacer: drop function public.security_sign_out_user(uuid); borrar la fila del registro.
create or replace function public.security_sign_out_user(p_user uuid)
  returns integer
  language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  n integer;
  nombre text;
begin
  if not (public.security_is_admin() or auth.role() = 'service_role') then
    raise exception 'security_sign_out_user: solo un admin' using errcode = '42501';
  end if;
  select full_name into nombre from public.profiles where id = p_user;
  delete from auth.sessions s where s.user_id = p_user;
  get diagnostics n = row_count;
  insert into public.security_events (actor_id, target_id, target_name, kind, detail)
    values (auth.uid(), p_user, nombre, 'sessions_closed', n || ' session(s) closed');
  return n;
end $$;
revoke execute on function public.security_sign_out_user(uuid) from public, anon;
grant  execute on function public.security_sign_out_user(uuid) to authenticated, service_role;

comment on function public.security_sign_out_user(uuid) is
  'D-828: borra todas las sesiones de Auth de una persona (y sus refresh tokens, en cascada). Solo admin o la llave de servicio. Devuelve cuántas cerró.';

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'security_sign_out_user' and p.prosecdef) then
    raise exception '236: security_sign_out_user no existe o no es security definer';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('236_security_cierra_sesiones.sql', '3e173aef67bf551e91fc8fe7cd21f1afe21f0cba4c6f98b7f2d467b291657da6') on conflict (name) do nothing;
