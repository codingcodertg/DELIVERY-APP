-- 271 - La plantilla del texto «¿te puedo llamar?» se edita en Ajustes de Reclutamiento.
--
-- PEDIDO. El duenio, 2026-11-07: "cuando estoy registrando un nuevo candidato abajo sale Guardar candidato,
-- Guardar e iniciar entrevista y Cancelar; entonces le vas a poner ahi tambien Guardar y enviar mensaje de
-- '¿te puedo llamar?'". El boton nuevo manda el mismo texto que el de la ficha; y ese texto, que hasta hoy vivia
-- clavado en el codigo (texto-puedo-llamar.ts), pasa a poder editarse desde Ajustes, un texto por idioma.
--
-- QUE GUARDA. Una columna jsonb en la fila unica de ajustes: {"en": "...", "es": "..."}. Cada idioma puede
-- faltar o ir vacio: entonces vale la plantilla de fabrica del codigo (la que dicto el duenio). Marcadores que
-- entiende: {recruiter}, {first_name}/{name}, {position}/{role}, {phone}.
--
-- ORDEN CON EL DESPLIEGUE. El codigo nuevo funciona SIN la columna: `select *` no la trae, y la app usa la de
-- fabrica; solo fallaria el boton «Guardar plantillas» de Ajustes (aviso de error, nada mas). Se puede aplicar
-- antes o despues de desplegar.
--
-- SEGURIDAD. Misma fila y mismas politicas que app_name/roles/departments (100): la leen quienes entran a
-- Reclutamiento y la escriben admin y gerente de RR. HH.
--
-- Idempotente: se puede correr dos veces.

alter table recruiting.settings
  add column if not exists sms_puedo_llamar jsonb;

comment on column recruiting.settings.sms_puedo_llamar is
  'Plantillas del texto "¿te puedo llamar?" por idioma: {"en": "...", "es": "..."}. Null o idioma vacio = la plantilla de fabrica del codigo. Editable por admin y gerente de RR. HH. en Ajustes.';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('271_sms_puedo_llamar_editable.sql', '7b3e367e9d789cabaa9b7e19a318d29e886ecc98e64953c09073ab3fd5fcdf3b') on conflict (name) do nothing;
