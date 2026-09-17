-- 121 · Almacen lee las posiciones de los choferes
--
-- La decision que la acompana es la de la rama `almacen-mapa-en-vivo`, en DECISIONS.md, y el plan en
-- papel es docs/PLAN-121-almacen-posiciones.md. Se cita la rama y no el numero: el checksum congela
-- este cuerpo.
--
-- EL PEDIDO. Dos quejas del dueno, de la misma tanda de almacen: «almacen: quiero ver el mapa de las
-- rutas como los choferes» y «como supervisor de almacen quiero poder ver la ruta de los choferes».
-- La ruta y el orden de paradas ya se le dieron sin tocar la base (salen de `deliveries`, que almacen
-- ya lee). Lo que falta es «por donde va», que vive en `public.driver_locations`.
--
-- LO QUE SE ABRE, DICHO CLARO. Esto da la ubicacion de los choferes a CUALQUIERA con el rol almacen,
-- no solo al supervisor que lo pidio. Se le dijo al dueno con esas palabras y lo eligio igual.
--
-- LO QUE HABIA. La politica vigente es la de la 080, que reescribio la de la 043 con el patron de
-- `(select ...)` para el initplan. La 103 es posterior y toca `driver_locations`, pero solo el EXECUTE
-- de `prune_driver_locations`; dice expresamente que no toca la RLS de la tabla. Vigente, entonces:
--
--   using ((driver_id = (select auth.uid()))
--           OR (COALESCE((select current_user_role()), ''::text)
--               = ANY (ARRAY['admin'::text, 'logistics'::text, 'manager'::text])))
--
-- LO QUE CAMBIA. Entra 'warehouse' en esa lista, y nada mas. No se toca la de escritura («driver
-- writes own location»), que sigue siendo solo del propio chofer: almacen LEE, no escribe. Tampoco se
-- toca la poda ni los grants de la 103.
--
-- POR QUE `alter policy` Y NO `drop` + `create`: la politica existe y solo cambia su `using`. Un drop
-- deja la tabla un instante sin esa politica, y con RLS activa eso es un instante en el que nadie ve
-- nada. `alter` lo cambia en sitio.

alter policy "read fleet locations" on public.driver_locations
  using (
    (driver_id = (select auth.uid()))
    or (coalesce((select public.current_user_role()), '')
        = any (array['admin', 'logistics', 'manager', 'warehouse']))
  );

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   alter policy "read fleet locations" on public.driver_locations
--     using (
--       (driver_id = (select auth.uid()))
--       or (coalesce((select public.current_user_role()), '')
--           = any (array['admin', 'logistics', 'manager']))
--     );
--   Una sola sentencia, sin drop. Lo que almacen haya visto mientras tanto ya lo vio; no hay dato que
--   deshacer, porque esta migracion no escribe nada.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Contra produccion, dos veces: ANTES de aplicar (almacen no ve ninguna posicion ajena) y con la 121
-- aplicada DENTRO de la misma transaccion (almacen ve las mismas que logistica). Las filas son de
-- ensayo y el rollback se las lleva.
--
--   begin;
--   -- 0. La politica que hay ahora mismo, para compararla con la de esta migracion.
--   select polname, pg_get_expr(polqual, polrelid) as usando
--     from pg_policy where polrelid = 'public.driver_locations'::regclass;
--
--   -- 1. Una posicion de ensayo de un chofer real, como postgres (salta RLS).
--   insert into public.driver_locations (driver_id, lat, lng, accuracy_m, recorded_at)
--   values ('<uuid-chofer>', 26.2, -98.2, 5, now());
--
--   -- 2. Un intento de lectura por rol. Cero filas NO es un error: es «no ve nada».
--   create function pg_temp.cuantas() returns bigint language sql stable as $f$
--     select count(*) from public.driver_locations where driver_id = '<uuid-chofer>';
--   $f$;
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-almacen>","role":"authenticated"}';
--   select 'almacen' as rol, pg_temp.cuantas();      -- ANTES: 0 · DESPUES: 1
--   set local request.jwt.claims = '{"sub":"<uuid-logistica>","role":"authenticated"}';
--   select 'logistica', pg_temp.cuantas();           -- 1 en los dos casos
--   set local request.jwt.claims = '{"sub":"<uuid-gerente>","role":"authenticated"}';
--   select 'gerente', pg_temp.cuantas();             -- 1 en los dos casos
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   select 'admin', pg_temp.cuantas();               -- 1 en los dos casos
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select 'vendedor', pg_temp.cuantas();            -- 0 en los dos casos
--   set local request.jwt.claims = '{"sub":"<uuid-office>","role":"authenticated"}';
--   select 'office', pg_temp.cuantas();              -- 0 en los dos casos
--   set local request.jwt.claims = '{"sub":"<uuid-chofer>","role":"authenticated"}';
--   select 'el propio chofer', pg_temp.cuantas();    -- 1 en los dos casos (es la suya)
--   set local request.jwt.claims = '{"sub":"<uuid-otro-chofer>","role":"authenticated"}';
--   select 'otro chofer', pg_temp.cuantas();         -- 0 en los dos casos
--
--   -- 3. Que almacen siga sin poder ESCRIBIR posiciones ajenas.
--   set local request.jwt.claims = '{"sub":"<uuid-almacen>","role":"authenticated"}';
--   insert into public.driver_locations (driver_id, lat, lng, recorded_at)
--   values ('<uuid-chofer>', 1, 1, now());           -- BLOQUEADO en los dos casos (RLS de escritura)
--
--   reset role;
--   rollback;
--
-- No verificado al escribirlo: que `authenticated` pueda llamar a una funcion de pg_temp creada por
-- postgres en la misma sesion. Si no puede, el mismo `select count(*)` va suelto en cada bloque.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('121_warehouse_lee_posiciones.sql', '5738694aa2a9200d16b8346b0dd1248cbdc93577b012bbf3a868747c2020796a') on conflict (name) do nothing;
