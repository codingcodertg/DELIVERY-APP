-- 190: Hora de corte y cupo de la mañana para la aprobación de oficina (2026-10-22, la decision de este dia en DECISIONS.md).
--
-- Roberto Rodriguez Jr (admin): «Once 2 orders are assigned from 8:30-10am thats it. After that only 1 can be assigned
-- to 8:30-12pm. This does not include Brownsville» y «Cannot assign orders for the same day or for tomorrow morning
-- after 4:30pm, flag it and notify office for approval». La regla vive en la app (`aprobacion-por-hora-y-cupo.ts`);
-- aqui solo se guarda lo que el admin edita en Ajustes:
--
--   settings.approval_rules jsonb, nula = los defectos de la app ({"corte":"16:30","cupo":{"0830-1000":2,
--   "0830-1200":1},"tiendas_sin_cupo":["RDZ Brownsville"]}).
--
-- Solo agrega una columna nula: nada cambia hasta que alguien guarde en Ajustes. La app ya lee `*` y cae en los
-- defectos sin la columna; lo que falla sin ella es GUARDAR esa tarjeta.
-- Para deshacer: alter table public.settings drop column approval_rules;

alter table public.settings add column if not exists approval_rules jsonb;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('190_reglas_de_aprobacion.sql', 'f2231cbad75a414b51003c96f1df2ec232fb27337879ef7c109c6808f9119ed1') on conflict (name) do nothing;
