-- 342 · Los crons de RingCentral salen de la base (pg_cron + pg_net), no de GitHub Actions.
--
-- Por qué (D-1129, 2026-11-22): los workflows programados de GitHub (`rc-comms.yml`, `rc-choferes.yml`, pensados para
-- cada 10 minutos) están corriendo cada 6–8 horas: GitHub reparte una sola corrida programada cada ~1–2 h entre todos los
-- workflows del repo. Las llamadas de choferes y de leads llegaban con medio día de retraso.
--
-- Cómo: pg_cron (ya instalado desde la 060) llama cada 10 minutos a `public.llama_cron(ruta)`, que le pide a pg_net un GET
-- a la ruta de Vercel. Para que la ruta sepa que la llamada viene de aquí SIN guardar el CRON_SECRET en la base, cada
-- llamada lleva un BOLETO de un solo uso: una fila en `cron_tickets` con un token al azar. La ruta (con la llave de
-- servicio) busca ese token, comprueba que es para esa ruta y que tiene menos de 3 minutos, y lo borra. Nadie fuera de
-- la base puede fabricar uno: la tabla tiene RLS sin políticas (solo postgres y service_role).
--
-- Los workflows de GitHub se quedan como respaldo (no estorban: el cursor de cada sincronización evita repetir trabajo).
--
-- Vuelta atrás:
--   select cron.unschedule('rc-comms'); select cron.unschedule('rc-choferes');
--   drop function public.llama_cron(text); drop table public.cron_tickets;
--   delete from public.schema_migrations where name = '342_cron_desde_la_base.sql';

create extension if not exists pg_net;

create table if not exists public.cron_tickets (
  token       text primary key,
  ruta        text not null,
  created_at  timestamptz not null default now()
);
alter table public.cron_tickets enable row level security;
-- Sin políticas a propósito: ni anon ni authenticated la leen ni la escriben.
revoke all on table public.cron_tickets from anon, authenticated;

create or replace function public.llama_cron(p_ruta text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  boleto text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  -- Solo rutas de cron de esta app: la función no sirve para llamar a otra parte.
  if p_ruta !~ '^/api/cron/[a-z0-9/-]+$' then
    raise exception 'llama_cron: ruta no permitida' using errcode = '22023';
  end if;
  delete from public.cron_tickets where created_at < now() - interval '1 hour';
  insert into public.cron_tickets (token, ruta) values (boleto, p_ruta);
  perform net.http_get(
    url := 'https://rtg-hub.vercel.app' || p_ruta,
    headers := jsonb_build_object('Authorization', 'Bearer boleto:' || boleto),
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.llama_cron(text) from public, anon, authenticated;

-- Cada 10 minutos, escalonados para que no caigan a la vez.
select cron.schedule('rc-comms', '*/10 * * * *', $cron$select public.llama_cron('/api/cron/rc-comms')$cron$);
select cron.schedule('rc-choferes', '5-59/10 * * * *', $cron$select public.llama_cron('/api/cron/rc-choferes')$cron$);
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('342_cron_desde_la_base.sql', '650bcfe9801a0287b2926daf10348bf0554038bc71610b65044c0423aa8bf642') on conflict (name) do nothing;
