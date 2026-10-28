-- ===========================================================================
-- 208 . Arranque numerado del plan: «estas primero, en este orden»
-- ===========================================================================
-- PEDIDO. El duenio, 2026-10-27: «en el logistic coordinator da la opcion de que al momento de armar rutas, elegir y
-- numerar ciertas ordenes para elegir que el auto assign las asigne de primero entonces vengo yo y hay 10 ordenes
-- entonces yo agarro tres y le pone 1 2 y 3 a las primeras 3 entonces el optimizer va a respetar eso y las va a
-- asignar de inicio en ese orden pero es un boton de accion extra».
--
-- QUE HACE. Una columna nula en public.deliveries: plan_rank, 1, 2, 3… El Gestor la pone con «🔢 Arrancar el plan
-- con estas» (en el orden en que se marcaron) y «Armar las rutas del dia» abre UNA ruta con esas ordenes, en ese
-- orden, y no mete nada delante. Publicar el plan la vacia: el plan ya las respeto. Null = como siempre.
-- Sin valor por defecto: ninguna fila cambia. Sin la columna la app sigue (la lista la pide como opcional).
--
-- NO HACE. No toca politicas, funciones ni triggers; no cambia publish_route_plan (los numeros los vacia la ruta
-- de publicar, en la app).

alter table public.deliveries add column if not exists plan_rank smallint;

alter table public.deliveries drop constraint if exists deliveries_plan_rank_check;
alter table public.deliveries add constraint deliveries_plan_rank_check
  check (plan_rank is null or (plan_rank between 1 and 99));

comment on column public.deliveries.plan_rank is
  'Arranque numerado del plan (208, D-722): 1, 2, 3… = «Armar las rutas del dia» abre una ruta con estas, en este orden, y no mete nada delante. Lo pone el Gestor (🔢) y lo vacia publicar. Null = sin numero.';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('208_arranque_del_plan.sql', '7ffcf110098d64bf313d810a10fbdaf9463398596a0fa3352a708fdf1a24cefe') on conflict (name) do nothing;
