-- ===========================================================================
-- 175 - La cotizacion recuerda de que lead salio: estimator_quotes.lead_id
-- ===========================================================================
-- Plan en papel: docs/PLAN-175-cotizacion-de-lead.md. ESCRITA Y NO APLICADA: aplicarla es del
-- orquestador, despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-10-15), a la pregunta de construir la primera conexion del mapa de apps (Leads ->
-- Quote Builder): «si a todo». La pantalla ya rellena la cotizacion con los datos del lead SIN esta
-- migracion; lo que esta anade es que el enlace QUEDE GUARDADO, para que la cotizacion diga «De lead»
-- y el lead cuente sus cotizaciones.
--
-- QUE TRAE:
--   1. Una columna nullable, lead_id, con clave foranea a public.leads (162) y `on delete set null`:
--      borrar un lead no borra ni bloquea una cotizacion, que es historial (la 148 no tiene DELETE).
--   2. Un indice parcial sobre lead_id (solo las filas que lo tienen): el lead busca sus cotizaciones.
--
-- LO QUE NO TOCA:
--   * Ninguna politica. Las tres de estimator_quotes (148) siguen decidiendo quien ve, crea y edita;
--     las de leads (163) siguen decidiendo quien ve un lead. La columna nueva se lee y se escribe con
--     las mismas filas que ya se leian y escribian.
--   * Ningun grant. La 148 concede select, insert, update sobre la TABLA a authenticated, y un
--     privilegio de tabla cubre sus columnas nuevas: no hay que conceder nada, y no se amplia nada.
--   * El disparador estimator_quotes_guard (148) no se reescribe: lead_id no lo pone el disparador; lo
--     manda el navegador al CREAR la cotizacion (y nunca al editarla). Ver el plan, «Lo que se descarto».
--   * Ningun dato: todas las filas existentes quedan con lead_id null.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un
-- commit de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

alter table public.estimator_quotes
  add column if not exists lead_id uuid references public.leads (id) on delete set null;

create index if not exists estimator_quotes_lead_idx
  on public.estimator_quotes (lead_id) where lead_id is not null;

-- Reversion (en este orden):
--   drop index if exists public.estimator_quotes_lead_idx;
--   alter table public.estimator_quotes drop column if exists lead_id;
--   delete from public.schema_migrations where name = '175_cotizacion_de_lead.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('175_cotizacion_de_lead.sql', 'd2e9c39790e26338516df9aaf9c07d6f7f9b4f8e94999dbbefbc9c4d942d951e') on conflict (name) do nothing;
