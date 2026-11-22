-- 344 · El cron del Gmail de Indeed también sale de la base.
--
-- Por qué (D-1132, 2026-11-22): la 343 programó `/api/cron/outlook-indeed`, pero el buzón que está CONECTADO es el de
-- Gmail (desde el 17 nov; Outlook nunca se conectó). El workflow de GitHub llamaba a las dos rutas en la misma corrida, y
-- con GitHub corriendo cada 6–8 horas los candidatos de Indeed entraban con ese retraso. Faltaba la de Gmail.
--
-- `llama_cron` ya deja pasar cualquier `/api/cron/...` (342): aquí solo se programa. La de Outlook se queda: sin buzón
-- conectado contesta enseguida «no conectado», y si un día se conecta ya está andando.
--
-- Vuelta atrás: select cron.unschedule('gmail-indeed');
--   delete from public.schema_migrations where name = '344_cron_de_gmail_indeed.sql';

select cron.schedule('gmail-indeed', '8-59/15 * * * *', $cron$select public.llama_cron('/api/cron/gmail-indeed')$cron$);
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('344_cron_de_gmail_indeed.sql', '9d0976fc9b6e0406f148291cb72b0001d2ee7bd21026f8614046999685797405') on conflict (name) do nothing;
