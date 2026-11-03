-- 233: Security en tiempo real (D-820, 2026-11-03).
--
-- El dueño: «la parte de security quiero que esté en tiempo real». Las cuatro tablas de Security entran en la
-- publicación de tiempo real (como chat_messages, 184): el panel se suscribe y se refresca solo cuando alguien entra,
-- se registra un dispositivo, se pide autorización, se cierra la web a alguien o se toca un interruptor. La RLS de
-- las 229/232 (solo admin) filtra también lo que la suscripción entrega: nadie más recibe nada.
--
-- Sin begin/commit propios. Para deshacer: alter publication supabase_realtime drop table public.security_devices,
-- public.security_device_users, public.security_policy, public.security_web_blocks; borrar la fila del registro.
do $$
declare t text;
begin
  foreach t in array array['security_devices', 'security_device_users', 'security_policy', 'security_web_blocks'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
declare t text;
begin
  foreach t in array array['security_devices', 'security_device_users', 'security_policy', 'security_web_blocks'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      raise exception '233: % no está en la publicación de tiempo real', t;
    end if;
  end loop;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('233_security_tiempo_real.sql', 'ce7bb2a1a31ca187b2f36a80d318e73505f94a543bbc07c9ca476b70eeeb0466') on conflict (name) do nothing;
