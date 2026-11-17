-- ===========================================================================
-- 319 - Los crons cada pocos minutos pasan de GitHub Actions a Supabase (pg_cron + pg_net) (D-1072)
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueño.
--
-- POR QUÉ. El repositorio va a ser PRIVADO (auditoría de seguridad D-1070): GitHub solo da 2,000 minutos al mes a un
-- repo privado y estos dos crons gastan ~11,000. pg_cron ya está instalado en el proyecto; pg_net hace la llamada
-- HTTPS al hub, igual que hacía GitHub.
--
-- QUÉ HACE.
--   - Activa pg_net.
--   - public.llama_cron_del_hub(ruta): GET a https://rtg-hub.vercel.app<ruta> con «Authorization: Bearer <secreto>»,
--     leyendo el secreto del Vault de Supabase (nombre «hub_cron_secret»). EL SECRETO NO ESTÁ EN ESTE ARCHIVO (el repo
--     es público mientras tanto): se guarda aparte con vault.create_secret, y tiene que ser el mismo valor que la
--     variable CRON_SECRET de Vercel. Sin el secreto la función no llama (avisa con NOTICE).
--   - Programa: Time Tracker cada 2 min; Outlook→Indeed y Gmail→Indeed cada 15 min.
--   - Solo la ejecuta postgres (pg_cron); fuera de anon/authenticated.
--
-- DESPUÉS DE APLICARLA. Quitar los «schedule» de .github/workflows/tt-cron.yml y outlook-indeed.yml (lo hace el mismo
-- cambio de código) y comprobar en cron.job_run_details y net._http_response que responden 200.
--
-- Deshacer:
--   select cron.unschedule(j) from unnest(array['hub-tt-cron','hub-outlook-indeed','hub-gmail-indeed']) j;
--   drop function if exists public.llama_cron_del_hub(text);
-- ===========================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.llama_cron_del_hub(ruta text)
  returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  secreto text;
begin
  select decrypted_secret into secreto from vault.decrypted_secrets where name = 'hub_cron_secret' limit 1;
  if secreto is null or secreto = '' then
    raise notice 'llama_cron_del_hub: falta el secreto hub_cron_secret en el Vault; no se llama a %', ruta;
    return;
  end if;
  perform net.http_get(
    url := 'https://rtg-hub.vercel.app' || ruta,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secreto),
    timeout_milliseconds := 60000
  );
end $$;

revoke execute on function public.llama_cron_del_hub(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('hub-tt-cron', 'hub-outlook-indeed', 'hub-gmail-indeed');
select cron.schedule('hub-tt-cron', '*/2 * * * *', $$select public.llama_cron_del_hub('/timetracker/clock-in/api/cron')$$);
select cron.schedule('hub-outlook-indeed', '*/15 * * * *', $$select public.llama_cron_del_hub('/api/cron/outlook-indeed')$$);
select cron.schedule('hub-gmail-indeed', '3-59/15 * * * *', $$select public.llama_cron_del_hub('/api/cron/gmail-indeed')$$);
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('319_crons_en_supabase.sql', '7fde1dfa3786f5b12cedf3f21eca14d42427f3bf25900a48a3a755a4ff6785a0') on conflict (name) do nothing;
