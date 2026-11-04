-- 240: a qué móvil se manda un SMS cuando llega una solicitud de ayuda (`/api/help`).
-- Vacío (null) = no se manda nada. Se guarda en la forma del hub, «(956) 555-0100»; el servidor lo pasa a E.164.
-- Lo lee solo el servidor con la llave de servicio; lo escribe el admin desde Ajustes como el resto de `settings`.
alter table public.settings add column if not exists help_sms_to text;
