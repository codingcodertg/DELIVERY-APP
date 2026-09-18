-- 131 - Que tiendas ve cada persona (rama visibilidad-por-tienda)
--
-- Se escribio como la 124 y se renumero a la 131 al descongelarla: mientras esta rama estuvo parada,
-- main se llevo la 125 y la 126, y 127-130 estan tomadas (127 fusionandose, 128-130 reservadas para el
-- motor de rutas). El numero viejo aparece a proposito mas abajo, donde se cuenta lo que paso siendo
-- la 124.
--
-- El dueno pidio poder limitar por persona que tiendas ve, y cuando se le pregunto si era comodidad
-- (menos ruido en la lista) o seguridad, contesto lo segundo: "que no puedan verlo". Por eso esto vive
-- en la base y no en el navegador: lo que decide quien ve que tiene que decidirlo Postgres, o quien
-- sepa pedirle datos a la API los recibe igual aunque la pantalla no se los pinte.
--
-- ---------------------------------------------------------------------------
-- Como se decide
-- ---------------------------------------------------------------------------
-- Una columna nueva, `profiles.visible_stores text[]`, con los nombres de las tiendas que esa persona
-- puede ver. Y tres reglas, todas del dueno:
--
--   * VACIO (null o {}) = ve todas, como hasta hoy. Es lo que tendran todas las filas el dia que esto
--     se aplique, asi que la migracion NO deja a nadie a oscuras: el cambio solo empieza a notarse
--     cuando alguien marca casillas a mano.
--   * Se filtra POR EL DATO, no por el rol: si un gerente tiene tiendas marcadas, ve solo esas, y sus
--     totales pasan a ser de esas tiendas. Tambien es suyo: "igual que office, se elige en el dropdown".
--   * El ADMIN nunca se filtra, tenga lo que tenga marcado: es quien administra esto.
--
-- Chofer y almacen se quedan con su rama de siempre (las suyas / ciertas etapas) y esta regla no les
-- aplica: sumarles la tienda encima podria dejar a un chofer sin ver su propia entrega porque la orden
-- es de otra tienda. Esta escrito en la funcion, no implicito.
--
-- Una orden SIN tienda la ve todo el mundo. Hoy no hay ninguna (152 ordenes, 0 sin tienda, medido en
-- produccion el 2026-09-17), pero el caso tiene que estar decidido: esconderlas dejaria ordenes que
-- nadie ve, que es peor que verlas de mas.
--
-- ---------------------------------------------------------------------------
-- Lo que hace que esto sea seguridad y no decoracion: el guardia
-- ---------------------------------------------------------------------------
-- `profiles update self or admin` (099) deja que CUALQUIERA actualice su propia fila. Lo unico que
-- limita que columnas puede tocar un no-admin es el disparador `profiles_guard_privileged`. O sea que
-- sin tocar el guardia, la persona a la que se le limita la visibilidad podria escribir
-- `visible_stores = '{}'` en su propia fila y volver a verlo todo, con una llamada desde el navegador
-- y sin que nada quedara marcado como raro.
--
-- Por eso la columna entra en el guardia en la MISMA migracion que la crea, no en la siguiente.
--
-- OJO AL PARTIR DE DONDE (lo dice la propia 104): la ultima definicion de
-- `guard_profile_privileged_columns` es la de **104_profile_title.sql**, no la de 099 ni la de 101. Un
-- `create or replace` reemplaza la funcion ENTERA, asi que copiar un cuerpo viejo borraria en silencio
-- la vigilancia de las columnas que se anadieron despues, sin tocar una linea de esas migraciones y
-- sin que nada fallara. Aqui estan las SIETE columnas: las seis de 104 mas `visible_stores`.
--
-- ---------------------------------------------------------------------------
-- Reversion
-- ---------------------------------------------------------------------------
--   -- 0. La de escritura, tal como estaba: UNA sola, de tipo ALL. Revertir solo esto ya devuelve la
--   --    lectura abierta a cualquiera con el modulo, aunque la clausula de tienda siga puesta.
--   --    (El begin/commit de aqui abajo es para pegar A MANO en una sesion; un FICHERO de migracion
--   --     nunca los lleva, ver la nota del bloque 1.)
--   begin;
--   drop policy if exists "deliveries insert" on public.deliveries;
--   drop policy if exists "deliveries update" on public.deliveries;
--   drop policy if exists "deliveries delete" on public.deliveries;
--   create policy "auth write deliveries" on public.deliveries
--     for all to authenticated
--     using ((select public.has_deliveries_access()))
--     with check ((select public.has_deliveries_access()));
--   commit;
--
--   -- 1. La politica de lectura, tal como la dejo 083 (sin la clausula de tienda):
--   alter policy "auth read deliveries" on public.deliveries
--     using (
--       (select public.has_deliveries_access())
--       and (
--         is_training
--         or case (select p.role from public.profiles p where p.id = (select auth.uid()))
--              when 'driver' then (created_by = (select auth.uid())
--                                  or assigned_driver = (select p.full_name from public.profiles p where p.id = (select auth.uid())))
--              when 'warehouse' then (stage = any (array['approved','fulfilling','ready','picked_up','delivered']))
--              else true
--            end
--       )
--     );
--   -- 2. El guardia, con las seis columnas de 104 (copiar su cuerpo tal cual).
--   -- 3. drop function if exists public.tiendas_visibles();
--   -- 4. alter table public.profiles drop column if exists visible_stores;
--   --    (borra el dato: si solo se quiere apagar la funcion, basta con 1 y dejar la columna.)

-- ===========================================================================
-- La columna
-- ===========================================================================
alter table public.profiles
  add column if not exists visible_stores text[];

comment on column public.profiles.visible_stores is
  'Tiendas cuyas ordenes puede ver esta persona, por nombre (settings.stores). Null o vacio = todas, como antes de esta migracion. No aplica a admin (nunca se filtra) ni a chofer/almacen (tienen su propia rama en la politica). Solo admin la escribe (guard_profile_privileged_columns).';

-- ===========================================================================
-- El guardia, con visible_stores anadido
-- ===========================================================================
-- Cuerpo copiado de 104_profile_title.sql, que es la definicion vigente, mas la columna nueva.
create or replace function public.guard_profile_privileged_columns()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Solo un admin cambia permissions/store/username/erp_role/title/title_color/visible_stores. Un
  -- no-admin editando SU fila puede tocar full_name/avatar_url/active_session_id y nada mas. Mismo
  -- patron que guard_role_change.
  if coalesce(public.current_user_role(), 'sales') <> 'admin'
     and auth.uid() is not null
     and ( NEW.permissions    is distinct from OLD.permissions
        or NEW.store          is distinct from OLD.store
        or NEW.username       is distinct from OLD.username
        or NEW.erp_role       is distinct from OLD.erp_role
        or NEW.title          is distinct from OLD.title
        or NEW.title_color    is distinct from OLD.title_color
        or NEW.visible_stores is distinct from OLD.visible_stores ) then
    raise exception 'Only an admin can change permissions, store, username, erp_role, title or visible_stores';
  end if;
  return NEW;
end $$;

-- El trigger de 099 (profiles_guard_privileged) ya apunta a esta funcion: create or replace la cambia
-- por dentro sin tocarlo. No se recrea a proposito, para no dejar un instante sin guardia en una tabla
-- que se escribe en vivo.

-- ===========================================================================
-- Que tiendas ve QUIEN PREGUNTA (una vez por consulta, no por fila)
-- ===========================================================================
-- Devuelve null cuando esa persona lo ve todo, y si no, sus tiendas normalizadas (sin espacios, en
-- minusculas), porque los nombres son texto libre y "McAllen " y "mcallen" son la misma tienda.
--
-- Por que devuelve el ARRAY en vez de responder si-o-no por cada fila: `deliveries` es la tabla mas
-- leida de la app y la 080 existe justo porque un helper por fila se ejecutaba una vez por fila.
-- Envuelta en `(select ...)`, esta se evalua una vez por consulta y la comparacion por fila es SQL
-- plano.
create or replace function public.tiendas_visibles()
  returns text[] language sql stable security definer set search_path = public as $$
  select case
           -- El admin administra esto; chofer y almacen tienen su propia rama en la politica.
           when p.role in ('admin', 'driver', 'warehouse') then null
           when p.visible_stores is null then null
           when cardinality(p.visible_stores) = 0 then null
           else (select array_agg(lower(btrim(x)))
                   from unnest(p.visible_stores) as x
                  where btrim(x) <> '')
         end
    from public.profiles p
   where p.id = (select auth.uid());
$$;

revoke execute on function public.tiendas_visibles() from public, anon;

-- ===========================================================================
-- BLOQUE 1 - Que la politica de LECTURA decida de verdad
-- ===========================================================================
-- Sin esto, todo lo de abajo es decoracion, y no es una sospecha: **D-100 ya lo dejo escrito** en su
-- seccion "Encontrado de paso, NO cambiado".
--
-- `auth write deliveries` es de tipo ALL, y ALL incluye SELECT. Las politicas permisivas se SUMAN con
-- OR, asi que su `using ((select has_deliveries_access()))` deja leer TODAS las filas a cualquiera con
-- el modulo, y la politica de lectura no decide nada. O sea que la rama del chofer ("solo las suyas") y
-- la del almacen ("solo ciertas etapas") de la 083 **llevan muertas desde siempre**, y la clausula de
-- tienda de abajo naceria muerta igual. Se confirmo ensayando esta migracion contra produccion: con una
-- tienda marcada, el vendedor seguia viendo las 153 de 153.
--
-- Postgres no tiene "ALL menos SELECT", asi que la de escritura se parte en tres, con el MISMO permiso
-- que tenia. Nadie gana ni pierde capacidad de escribir; lo unico que cambia es que dejan de otorgar
-- lectura.
--
-- OJO, ESTO CAMBIA LO QUE VE GENTE QUE TRABAJA HOY, y D-100 lo aparco a proposito por eso mismo:
--   * El chofer: su pantalla YA filtra igual en el cliente (driver/page.tsx), asi que no deberia
--     notarlo. Lo que cambia es que ahora no puede pedirle a la API las de otros.
--   * El almacen: su pestana "Todas" dejaria de ensenar borradores, pendientes, rechazadas y anuladas
--     (las cinco pestanas por etapa son justo las cinco que la politica deja pasar).
-- Los numeros que midio D-100 en su dia: el chofer pasaba de 89 a 30, y almacen de 89 a 83.
--
-- ATOMICIDAD: entre el drop y los create no puede haber un instante en el que nadie pueda escribir, y
-- eso lo garantiza **quien aplica**, que envuelve el fichero entero en una transaccion. Este fichero
-- NO lleva `begin`/`commit` propios, y ninguna migracion anterior los lleva tampoco.
--
-- La razon esta medida y costo caro: un `begin` anidado en Postgres es solo un WARNING, pero el
-- `commit` de dentro CIERRA la transaccion de fuera. Un ensayo con ROLLBACK deja de ser un ensayo:
-- esta migracion se aplico a produccion sin querer, en el ensayo del 2026-09-17, por llevarlos.
-- (Entonces se llamaba 124_visibilidad_por_tienda.sql; se revirtio el 2026-09-18, fila del registro
-- incluida, asi que el nombre nuevo no deja huerfana ninguna.)
drop policy if exists "auth write deliveries" on public.deliveries;

create policy "deliveries insert" on public.deliveries
  for insert to authenticated
  with check ((select public.has_deliveries_access()));

create policy "deliveries update" on public.deliveries
  for update to authenticated
  using ((select public.has_deliveries_access()))
  with check ((select public.has_deliveries_access()));

create policy "deliveries delete" on public.deliveries
  for delete to authenticated
  using ((select public.has_deliveries_access()));

-- ===========================================================================
-- BLOQUE 2 - La politica de lectura, con la tienda
-- ===========================================================================
-- Copiada de 083 (su definicion vigente) con UNA clausula mas al final. Lo de arriba no se toca: sigue
-- decidiendo SI entras (has_deliveries_access) y QUE ves por rol (chofer, almacen, el resto).
--
-- La clausula mira las TRES columnas de tienda de una orden -- `store`, `pickup_name` y
-- `delivery_name` --, no solo `store`. La razon esta abajo, junto a la comparacion.
alter policy "auth read deliveries" on public.deliveries
  using (
    (select public.has_deliveries_access())
    and (
      is_training
      or case (select p.role from public.profiles p where p.id = (select auth.uid()))
           when 'driver' then (created_by = (select auth.uid())
                               or assigned_driver = (select p.full_name from public.profiles p where p.id = (select auth.uid())))
           when 'warehouse' then (stage = any (array['approved','fulfilling','ready','picked_up','delivered']))
           else true
         end
    )
    and (
      is_training
      or (select public.tiendas_visibles()) is null
      or btrim(coalesce(store, '')) = ''
      -- El `::text[]` NO es adorno. Sin el, Postgres parsea `x = any ((select f()))` como la forma
      -- SUBCONSULTA de ANY: compara `x` contra cada FILA que devuelve la subconsulta, y la unica fila
      -- es un text[], asi que la migracion revienta al aplicarse con
      -- `operator does not exist: text = text[]`. Los parentesis dobles no la vuelven expresion de
      -- array; el cast si. Se conserva el `(select ...)` para que siga evaluandose una vez por
      -- consulta y no una vez por fila.
      --
      -- LAS TRES COLUMNAS, no solo `store`: en una Intertienda la orden le importa a las DOS tiendas
      -- (D-309, pedido del dueno: "in intertienda orders people from both pickup and delivery store
      -- can see the order"), y desde D-312 `store` y `pickup_name` son la que MANDA el material y
      -- `delivery_name` la que lo RECIBE. Con `store` a secas, a quien se le marcara la tienda que
      -- recibe dejaria de ver las Intertiendas que va a recibir: el filtro las escondia justo a quien
      -- mas le importan.
      --
      -- Se comparan las tres SIN mirar el tipo de orden, y eso es mas ancho que lo que hace la app
      -- (`tiendasDeLaOrden` solo mira las tres en los tipos tienda-a-tienda). A proposito: el tipo
      -- vive en `settings.order_type_rules`, un jsonb, y leerlo POR FILA en la tabla mas leida de la
      -- app es justo lo que la 080 vino a quitar. Y de los dos errores posibles, este filtro solo
      -- puede permitirse el de ensenar de mas: es un TECHO por persona que se suma a los cortes por
      -- rol de la app, no los sustituye. Un techo mas estrecho que la app esconde trabajo; uno mas
      -- ancho lo unico que hace es dejar que el corte de la app siga decidiendo, como hoy.
      or lower(btrim(coalesce(store, ''))) = any ((select public.tiendas_visibles())::text[])
      or lower(btrim(coalesce(pickup_name, ''))) = any ((select public.tiendas_visibles())::text[])
      or lower(btrim(coalesce(delivery_name, ''))) = any ((select public.tiendas_visibles())::text[])
    )
  );

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'deliveries' and policyname = 'auth read deliveries') then
    raise exception 'la politica de lectura de deliveries desaparecio';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'deliveries' and policyname = 'auth read deliveries'
                    and qual like '%tiendas_visibles%') then
    raise exception 'la politica quedo sin la clausula de tienda';
  end if;
  -- Y que mira las TRES columnas. Con solo `store`, a quien se le marque la tienda que RECIBE deja de
  -- ver las Intertiendas que va a recibir, y eso no falla: simplemente no aparecen.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'deliveries' and policyname = 'auth read deliveries'
                    and qual like '%pickup_name%' and qual like '%delivery_name%') then
    raise exception 'la clausula de tienda quedo mirando solo store: la Intertienda se le esconde a la tienda que recibe';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'guard_profile_privileged_columns'
                    and pg_get_functiondef(p.oid) like '%visible_stores%') then
    raise exception 'el guardia de profiles quedo sin visible_stores: la columna seria autoservicio';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'profiles_guard_privileged' and not tgisinternal) then
    raise exception 'el disparador profiles_guard_privileged no esta';
  end if;
  -- Lo que hace que el filtro no sea decoracion: que NINGUNA otra politica permisiva otorgue SELECT
  -- sobre deliveries. Una sola de tipo ALL vuelve a anularlo todo, y no se notaria.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'deliveries'
                and permissive = 'PERMISSIVE' and cmd in ('ALL', 'SELECT')
                and policyname <> 'auth read deliveries') then
    raise exception 'hay otra politica que otorga SELECT sobre deliveries: la de lectura no decide nada';
  end if;
  -- Y que las tres de escritura quedaron puestas: si alguna falto, esa operacion queda denegada.
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'deliveries'
         and policyname in ('deliveries insert', 'deliveries update', 'deliveries delete')) <> 3 then
    raise exception 'faltan politicas de escritura en deliveries';
  end if;
end $$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- Todo dentro de una transaccion que se deshace: no deja filas ni cambia nada. <uuid-...> son cuentas
-- reales de `public.profiles`, y <Tienda A> / <Tienda B> nombres reales de `settings.stores`.
--
--   -- OJO AL ELEGIR AL VENDEDOR: tiene que tener 'deliveries' en `module_access`. Con una cuenta que
--   -- no lo tenga, `has_deliveries_access()` ya devuelve false y TODOS los casos dan 0: el ensayo
--   -- saldria "bien" sin haber medido nada. El primer role='sales' por nombre no sirve.
--
--   -- 0. Punto de partida: cuantas ve hoy cada uno, ANTES de marcar nada.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select count(*) from public.deliveries;                                    -- N (todas)
--   rollback;
--
--   -- 1. Con una tienda marcada, ve solo las de esa tienda (y las sin tienda).
--   begin;
--   update public.profiles set visible_stores = array['<Tienda A>'] where id = '<uuid-vendedor>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select count(*) from public.deliveries;                                    -- solo <Tienda A>
--   select count(*) from public.deliveries where lower(btrim(store)) <> lower('<Tienda A>')
--                                            and btrim(coalesce(store,'')) <> '';  -- 0
--   rollback;
--
--   -- 2. Dos tiendas marcadas suman, no restan.
--   begin;
--   update public.profiles set visible_stores = array['<Tienda A>','<Tienda B>'] where id = '<uuid-vendedor>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select count(distinct store) from public.deliveries;                       -- 2 (mas las sin tienda)
--   rollback;
--
--   -- 3. Vacio = ve todas, que es como queda todo el mundo al aplicar esto.
--   begin;
--   update public.profiles set visible_stores = '{}' where id = '<uuid-vendedor>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select count(*) from public.deliveries;                                    -- N, igual que en 0
--   rollback;
--
--   -- 4. El admin no se filtra aunque tenga tiendas marcadas.
--   begin;
--   update public.profiles set visible_stores = array['<Tienda A>'] where id = '<uuid-admin>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   select count(*) from public.deliveries;                                    -- todas
--   rollback;
--
--   -- 5. El chofer sigue viendo LO SUYO aunque sea de otra tienda: su rama manda.
--   begin;
--   update public.profiles set visible_stores = array['<Tienda A>'] where id = '<uuid-chofer>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-chofer>","role":"authenticated"}';
--   select count(*) from public.deliveries;                                    -- las suyas, de la tienda que sean
--   rollback;
--
--   -- 6. Lo que hace que esto sea seguridad: el vendedor NO puede quitarse el limite.
--   begin;
--   update public.profiles set visible_stores = array['<Tienda A>'] where id = '<uuid-vendedor>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.profiles set visible_stores = '{}' where id = '<uuid-vendedor>';   -- ERROR del guardia
--   update public.profiles set full_name = 'Yo Mismo' where id = '<uuid-vendedor>';  -- 1 fila (esto si puede)
--   rollback;
--
--   -- 7. Y tampoco puede escribirsela a otro.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.profiles set visible_stores = '{}' where id = '<uuid-admin>';      -- 0 filas (RLS)
--   rollback;
--
--   -- ---------------------------------------------------------------------
--   -- Los del BLOQUE 1, que es el que cambia lo que ve gente que trabaja hoy
--   -- ---------------------------------------------------------------------
--
--   -- 8. El chofer pasa a ver SOLO lo suyo (hasta ahora lo veia todo desde la API, y era la
--   --    pantalla la que filtraba). Se compara contra lo que ya filtra el cliente.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-chofer>","role":"authenticated"}';
--   select count(*) from public.deliveries;                                          -- las suyas
--   select count(*) from public.deliveries
--    where assigned_driver is distinct from '<nombre-chofer>' and created_by <> '<uuid-chofer>'
--      and not is_training;                                                          -- 0
--   rollback;
--
--   -- 9. El almacen pasa a ver solo sus cinco etapas: su pestana "Todas" deja de traer borradores,
--   --    pendientes, rechazadas y anuladas. ESTE es el cambio que hay que aprobar antes de aplicar.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-almacen>","role":"authenticated"}';
--   select count(*) from public.deliveries;                                          -- solo las cinco etapas
--   select count(*) from public.deliveries
--    where stage not in ('approved','fulfilling','ready','picked_up','delivered')
--      and not is_training;                                                          -- 0
--   rollback;
--
--   -- 10. Escribir NO cambia para nadie: las tres politicas nuevas llevan el mismo permiso.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set notes = notes where id = '<uuid-orden-suya>';        -- 1 fila
--   rollback;
--
--   -- ---------------------------------------------------------------------
--   -- 11. LA INTERTIENDA LA VEN LAS DOS TIENDAS (D-309/D-312)
--   -- ---------------------------------------------------------------------
--   -- Es el caso que obligo a mirar las tres columnas. Hace falta una Intertienda real, y hay que
--   -- LEERLA antes para saber que tiendas lleva -- no darlas por supuestas:
--   --   select id, store, pickup_name, delivery_name from public.deliveries
--   --    where order_type = 'Intertienda' and coalesce(btrim(delivery_name),'') <> ''
--   --      and lower(btrim(delivery_name)) is distinct from lower(btrim(store))
--   --    order by created_at desc limit 5;
--   -- De ahi salen <uuid-orden-inter>, <Tienda Envia> (store/pickup_name) y <Tienda Recibe>
--   -- (delivery_name). Si la consulta no devuelve ninguna, ESTE CASO NO SE PUEDE MEDIR: se dice, no
--   -- se da por bueno.
--
--   -- 11a. El vendedor de la tienda que MANDA la ve. Esto ya pasaba con `store` a secas; va primero
--   --      para que 11b signifique algo: sin el, un 1 en 11b podria ser que no se filtre nada.
--   begin;
--   update public.profiles set visible_stores = array['<Tienda Envia>'] where id = '<uuid-vendedor>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select count(*) from public.deliveries where id = '<uuid-orden-inter>';           -- 1
--   rollback;
--
--   -- 11b. El de la tienda que RECIBE tambien. **Con la clausula vieja (solo `store`) esto daba 0**,
--   --      y ese 0 era el fallo: al que recibe el material se le escondia la orden que va a recibir.
--   begin;
--   update public.profiles set visible_stores = array['<Tienda Recibe>'] where id = '<uuid-vendedor>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select count(*) from public.deliveries where id = '<uuid-orden-inter>';           -- 1
--   rollback;
--
--   -- 11c. Y no se abrio la puerta a todo: con una tienda que NO es ninguna de las dos, sigue sin
--   --      verla. Sin esto, 11a y 11b los pasaria un filtro que no filtra nada.
--   begin;
--   update public.profiles set visible_stores = array['<Tienda Tercera>'] where id = '<uuid-vendedor>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select count(*) from public.deliveries where id = '<uuid-orden-inter>';           -- 0
--   rollback;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('131_visibilidad_por_tienda.sql', '09ebcd5b6e27cd3c9e59ea01ab6977ed9e22976e9d645c75a0f03bb046b42b21') on conflict (name) do nothing;
