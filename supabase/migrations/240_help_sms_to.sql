-- 240: a qué móvil se manda un SMS cuando llega una solicitud de ayuda (`/api/help`).
-- Vacío (null) = no se manda nada. Se guarda en la forma del hub, «(956) 555-0100»; el servidor lo pasa a E.164.
-- Lo lee solo el servidor con la llave de servicio; lo escribe el admin desde Ajustes como el resto de `settings`.
alter table public.settings add column if not exists help_sms_to text;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('240_help_sms_to.sql', '3962ee8185c0a5bc02f26152c9a40310ec478b03a9890dda4184a1f606e3e8ac') on conflict (name) do nothing;
