# Plan 160 · Las rutas del día para todos los del módulo de entregas, con lo mínimo de cada parada

Plan en papel exigido por `CLAUDE.md` («Antes de tocar RLS, triggers o permisos en producción»). Esta migración **no toca
ninguna política, tabla ni trigger**: añade **dos funciones**. El plan existe porque una de ellas es `security definer` y
enseña, a quien la RLS de `deliveries` no deja leer una orden, **una parte** de esa orden. Lo que hay que demostrar es que
esa parte es solo la de la lista blanca y que la tabla sigue cerrada como estaba. Molde: `docs/PLAN-156-competencia-suelta.md`.

**Estado (2026-10-04):** escrito por un worker en el worktree `feat/mapa-ruta-de-hoy`. Producción se **leyó**
(`begin transaction read only`) y la migración y la matriz de §6 se **ensayaron contra producción dentro de una transacción
con `ROLLBACK`** (resultado en §6; comprobado después que no quedó nada: 0 funciones, 0 filas en el registro, 4 políticas).
**Nada aplicado. Pendiente de aprobar.**

**Pedido del dueño (2026-10-04; citas tal como las pasó el orquestador en el encargo, no extraídas del fichero de sesión):**

> *«este mapa lo quiero en el map view que ya esta y que todos los puedan ver y se lo cambias de map a today's route»*

(con la captura del bloque de arriba del Gestor de Rutas: el panel «Choferes y rutas» y el mapa con la ruta de cada chofer).
Se le preguntó si cada rol vería solo lo que ya lee o las rutas completas:

> *«si rutas completas pero solo ver nada mas»*

**La migración está escrita y NO aplicada:** `supabase/migrations/160_rutas_del_dia.sql`.

---

## 0 · Resumen

| | Hoy (medido 2026-10-04) | Con la 160 |
|---|---|---|
| Políticas de `public.deliveries` | 4 (`auth read deliveries`, `deliveries insert`, `deliveries update`, `deliveries delete`) | **las mismas 4, idénticas** (la matriz compara sus expresiones antes y después) |
| Qué lee de la TABLA un chofer | lo que creó o tiene asignado | **lo mismo** |
| Qué lee de la TABLA almacén | las etapas `approved` … `delivered` (no las pendientes) | **lo mismo** |
| Qué lee de la TABLA quien tiene tiendas marcadas (2 vendedores hoy) | solo las órdenes de esas tiendas | **lo mismo** |
| Funciones nuevas | — | `public.rutas_del_dia(date)` (`security definer`) y `public.ciudad_de_la_direccion(text)` |
| Quién ejecuta `rutas_del_dia` | — | `authenticated` **con el módulo de entregas** (o admin). `anon` y `public`, no. Sin el módulo, error 42501 |
| Qué devuelve | — | de las órdenes de UN día (hoy±7), 23 columnas (§2). Sin cliente, sin dirección, sin factura |
| La pantalla antes de aplicar | — | funciona: cada rol ve las rutas con lo que su RLS ya le deja leer, y al admin se le dice que falta la 160 |

## 1 · Decisiones (para validar)

1. **No se abre la RLS de `deliveries`.** Una política más ancha daría la fila ENTERA (cliente, teléfono, dirección, tarifa)
   a quien solo tiene que ver por dónde va un camión. Una función `security definer` con un `returns table` explícito es la
   única forma de dar columnas sueltas sin dar la fila.
2. **La lista blanca es el `returns table`**, no un `select *` filtrado: una columna nueva en `deliveries` no sale por aquí
   aunque nadie se acuerde de esta función. La misma lista está en `src/lib/rutas-del-dia.ts`
   (`COLUMNAS_DE_RUTAS_DEL_DIA`), una prueba compara las dos, la migración se autocomprueba contra el catálogo, y la app
   tira cualquier otra clave que llegue (`paradaDeLaFila`).
3. **Siete columnas más que la lista del encargo, y por qué** (a validar): `order_no` (desempate al ordenar, es el contador
   interno), `order_suffix` (la letra de una carga partida: «FA100b»; sin ella dos cargas se llaman igual), `load_no`
   (histórico de D-443: ordena una ruta guardada con viajes que nadie ha tocado), `delivery_duration` y `pickup_duration`
   (lo que el camión pasa parado: sin ellas la llegada estimada de «Ruta de hoy» no sería la del Gestor), y
   `pod_delivered_at` y `pickup_gps_at` (la hora real de lo ya hecho: «entregada 10:42»). Ninguna identifica al cliente.
   Quitarlas es borrar su línea del `returns table`, del `select` y de la lista de la app.
4. **El techo por persona de la 131 (`visible_stores`) NO se aplica en la función.** El pedido es «rutas completas»: un
   vendedor con tiendas marcadas ve aquí las paradas de todas las tiendas, con lo mínimo. En la tabla sigue viendo solo las
   suyas (T3 de la matriz).
5. **El punto de entrega (lat/lng) sí sale**, porque sin él no hay pin. Es la casa del cliente en el mapa, sin su nombre ni
   su dirección escrita. Si esto es más de lo que se quiere enseñar a todos, la alternativa es redondear el punto en la
   función (a ~100 m), y el pin deja de caer en la casa.
6. **De la dirección, solo la ciudad**, calculada en la base (`ciudad_de_la_direccion`) con la misma lectura que la app
   (`ciudadDeEntrega`, D-408) para direcciones con comas. La app, además, resuelve las escritas sin comas con una lista de
   ciudades conocidas (D-423); la función **no**: si el trozo lleva un número, es la calle y devuelve `''`. De los dos
   errores posibles (no decir la ciudad, o enseñar la calle) aquí solo cabe el primero. Medido en el ensayo: **21 de 418**
   direcciones quedan sin ciudad («—» en la pantalla), y **0** devuelven algo con números.
7. **Hoy±7, en la hora del negocio** (`America/Chicago`). Fuera, cero filas (no un error): es la ruta del día, no un
   historial. La pantalla acota su selector al mismo rango, y además a la ventana de D-239 para quien no es exento.
8. **`stable`, sin escritura**: la función solo lee `deliveries` y `settings.stores` (el punto de la tienda de recogida).
9. **`ciudad_de_la_direccion` es `immutable` y no es `security definer`**: no lee ninguna tabla. Se le quita a `anon`
   igualmente, porque no hay motivo para que la llame.

## 2 · Las columnas que devuelve, exactas

`id`, `order_no`, `order_code`, `order_suffix`, `stage`, `assigned_driver`, `route_seq`, `pickup_seq`, `load_no`,
`actual_pallets`, `est_pallets`, `store`, `store_lat`, `store_lng`, `delivery_lat`, `delivery_lng`, `delivery_city`,
`delivery_windows`, `delivery_date`, `delivery_duration`, `pickup_duration`, `pod_delivered_at`, `pickup_gps_at`.

**Lo que NO devuelve** (y pedirlo a la función es un error 42703, T4 y T5): `account`, contacto, teléfonos, correo,
`invoice_num`, `invoices_extra`, `po2`, `so_num`, `estimate_num`, `delivery_fee`, notas, `delivery_address`,
`pickup_address`, `delivery_name`, `pickup_name`, `created_by`, fotos, firma.

## 3 · Inventario de lecturas y escrituras que toca

| Objeto | Antes | Después |
|---|---|---|
| `public.deliveries` | leída por RLS | igual; además, leída por `rutas_del_dia` con los derechos de su dueño |
| `public.settings` (`stores`) | leída por todos los del módulo | igual; `rutas_del_dia` saca de ahí el punto de la tienda |
| `public.has_deliveries_access()` | la usan las políticas | además la llama `rutas_del_dia` |
| Escrituras | — | **ninguna** |

La pantalla: `src/lib/usa-rutas-del-dia.ts` llama a `rpc("rutas_del_dia", { p_fecha })` — una consulta al entrar, al cambiar
de día, al volver a la pestaña, cuando cambia algo que la persona ya recibe en vivo y cada minuto con la pestaña a la vista.

## 4 · Qué NO debe romperse

- Órdenes, Almacén, Chofer, «Mi ruta» y el Gestor de Rutas leen la tabla como antes: ninguno usa la función.
- Un chofer sigue sin poder pedir a la API las órdenes de otro (T1, T2). Almacén sigue sin las pendientes en la tabla.
- Quien no tiene el módulo de entregas no ve nada (S1), ni `anon` (S3).

## 5 · El SQL, literal

`supabase/migrations/160_rutas_del_dia.sql`. Sin `begin`/`commit` propios (nota de la 131): la transacción la pone quien
aplica. Lleva su autocomprobación (las 23 columnas contra el catálogo, `security definer`, `anon` sin EXECUTE,
`authenticated` con él, las 4 políticas de `deliveries`, y dos ejemplos de ciudad) y el bloque `-- @ledger-below`.

## 6 · Matriz de pruebas por rol, con ROLLBACK (la corre el orquestador)

**48 comprobaciones**, más dos líneas informativas (C2, C3). Sustituir los `<UUID-…>` por un perfil de cada clase: `<UUID-VENTAS>` (vendedor con el módulo, sin
tiendas marcadas), `<UUID-VENTAS-TIENDAS>` (vendedor con `visible_stores`), `<UUID-ALMACEN>`, `<UUID-CHOFER>` (uno con
órdenes en el día de ensayo), `<UUID-OFICINA>` (`accounting`), `<UUID-GERENTE>`, `<UUID-LOGISTICA>`, `<UUID-ADMIN>` y
`<UUID-SIN-MODULO>` (un perfil sin `deliveries` en `module_access` y que no sea admin). Pegar entero en `psql` desde la raíz
del repo. **Sin `commit` en ningún sitio.** El día de ensayo lo elige la propia matriz: el de hoy±7 con más órdenes con chofer.

```sql
begin;

-- A. ANTES de la migración: el día de ensayo, las políticas de `deliveries` y lo que cada uno lee de la TABLA.
select set_config('ensayo.fecha', (
  select delivery_date::text from public.deliveries
   where not is_training and delivery_date between (now() at time zone 'America/Chicago')::date - 7 and (now() at time zone 'America/Chicago')::date + 7
   group by 1 order by count(*) filter (where assigned_driver is not null) desc, 1 limit 1), true);
select set_config('ensayo.total', (
  select count(*)::text from public.deliveries
   where delivery_date = current_setting('ensayo.fecha')::date and not is_training and stage not in ('draft', 'rejected', 'canceled')), true);
select set_config('ensayo.politicas', (
  select string_agg(polname || ':' || polcmd::text || ':' || md5(coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '')), ',' order by polname)
    from pg_policy where polrelid = 'public.deliveries'::regclass), true);

set local role authenticated;
do $$ declare r record; begin
  for r in select * from (values ('ventas', '<UUID-VENTAS>'), ('ventas_tiendas', '<UUID-VENTAS-TIENDAS>'), ('almacen', '<UUID-ALMACEN>'),
      ('chofer', '<UUID-CHOFER>'), ('oficina', '<UUID-OFICINA>'), ('gerente', '<UUID-GERENTE>'), ('logistica', '<UUID-LOGISTICA>'),
      ('admin', '<UUID-ADMIN>')) v(clase, id) loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    perform set_config('ensayo.antes_' || r.clase, (select count(*) from public.deliveries where delivery_date = current_setting('ensayo.fecha')::date)::text, true);
  end loop;
end $$;
reset role;

\i supabase/migrations/160_rutas_del_dia.sql

do $$ begin
  raise notice 'D0  día de ensayo % con % paradas (no canceladas/rechazadas/borrador, sin enseñanza)', current_setting('ensayo.fecha'), current_setting('ensayo.total');
  raise notice 'D1  hay algo que ensayar                                 esperado > 0: %', case when current_setting('ensayo.total')::int > 0 then 'OK' else 'MAL' end;
end $$;

-- B. Cada rol con el módulo ejecuta, ve TODAS las paradas del día y solo las columnas de la lista blanca;
--    y de la TABLA lee lo mismo que antes.
set local role authenticated;
do $$ declare r record; n int; cols text[]; tabla int; malas int;
  blanca text[] := array['actual_pallets','assigned_driver','delivery_city','delivery_date','delivery_duration','delivery_lat','delivery_lng',
    'delivery_windows','est_pallets','id','load_no','order_code','order_no','order_suffix','pickup_duration','pickup_gps_at','pickup_seq',
    'pod_delivered_at','route_seq','stage','store','store_lat','store_lng'];
begin
  for r in select * from (values ('ventas', '<UUID-VENTAS>'), ('ventas_tiendas', '<UUID-VENTAS-TIENDAS>'), ('almacen', '<UUID-ALMACEN>'),
      ('chofer', '<UUID-CHOFER>'), ('oficina', '<UUID-OFICINA>'), ('gerente', '<UUID-GERENTE>'), ('logistica', '<UUID-LOGISTICA>'),
      ('admin', '<UUID-ADMIN>')) v(clase, id) loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    select count(*) into n from public.rutas_del_dia(current_setting('ensayo.fecha')::date);
    raise notice 'R1  % ve todas las paradas del día         esperado %: %', rpad(r.clase, 15), current_setting('ensayo.total'), case when n = current_setting('ensayo.total')::int then 'OK' else 'MAL ' || n end;
    select array_agg(distinct k order by k) into cols from public.rutas_del_dia(current_setting('ensayo.fecha')::date) f, jsonb_object_keys(to_jsonb(f)) k;
    raise notice 'R2  % solo columnas de la lista blanca    esperado 23: %', rpad(r.clase, 15), case when cols = blanca then 'OK' else 'MAL ' || coalesce(array_to_string(cols, ','), 'null') end;
    select count(*) into malas from public.rutas_del_dia(current_setting('ensayo.fecha')::date) f where f.stage in ('draft', 'rejected', 'canceled') or f.delivery_date <> current_setting('ensayo.fecha')::date;
    raise notice 'R3  % ni canceladas ni de otro día         esperado 0: %', rpad(r.clase, 15), case when malas = 0 then 'OK' else 'MAL ' || malas end;
    select count(*) into tabla from public.deliveries where delivery_date = current_setting('ensayo.fecha')::date;
    raise notice 'R4  % lee de la TABLA lo mismo que antes   esperado %: %', rpad(r.clase, 15), current_setting('ensayo.antes_' || r.clase), case when tabla::text = current_setting('ensayo.antes_' || r.clase) then 'OK' else 'MAL ' || tabla end;
  end loop;
end $$;

-- C. La función no abre la tabla: el chofer sigue leyendo solo lo suyo, y quien tiene tiendas marcadas solo esas.
do $$ declare tabla int; ajenas int; begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<UUID-CHOFER>', 'role', 'authenticated')::text, true);
  select count(*) into tabla from public.deliveries where delivery_date = current_setting('ensayo.fecha')::date and not is_training;
  select count(*) into ajenas from public.deliveries d where not d.is_training
     and d.assigned_driver is distinct from (select full_name from public.profiles where id = '<UUID-CHOFER>') and d.created_by is distinct from '<UUID-CHOFER>';
  raise notice 'T1  el chofer lee de la tabla menos que la función (% de %): %', tabla, current_setting('ensayo.total'), case when tabla < current_setting('ensayo.total')::int then 'OK' else 'MAL' end;
  raise notice 'T2  el chofer NO lee órdenes ajenas en la tabla          esperado 0: %', case when ajenas = 0 then 'OK' else 'MAL ' || ajenas end;
  perform set_config('request.jwt.claims', json_build_object('sub', '<UUID-VENTAS-TIENDAS>', 'role', 'authenticated')::text, true);
  select count(*) into ajenas from public.deliveries d where not d.is_training and btrim(coalesce(d.store, '')) <> ''
     and not (lower(btrim(coalesce(d.store, ''))) = any ((select public.tiendas_visibles())::text[])
           or lower(btrim(coalesce(d.pickup_name, ''))) = any ((select public.tiendas_visibles())::text[])
           or lower(btrim(coalesce(d.delivery_name, ''))) = any ((select public.tiendas_visibles())::text[]));
  raise notice 'T3  ventas con tiendas marcadas NO lee las de otras      esperado 0: %', case when ajenas = 0 then 'OK' else 'MAL ' || ajenas end;
end $$;
-- Y las columnas privadas no existen en lo que devuelve: pedirlas es un error.
do $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<UUID-VENTAS>', 'role', 'authenticated')::text, true);
  begin execute 'select delivery_address from public.rutas_del_dia(current_setting(''ensayo.fecha'')::date)';
    raise notice 'T4  pedir delivery_address a la función                  esperado ERROR: MAL, paso';
  exception when others then raise notice 'T4  pedir delivery_address a la función  esperado ERROR 42703: %', case when sqlstate = '42703' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end;
  begin execute 'select account from public.rutas_del_dia(current_setting(''ensayo.fecha'')::date)';
    raise notice 'T5  pedir account a la función                           esperado ERROR: MAL, paso';
  exception when others then raise notice 'T5  pedir account a la función           esperado ERROR 42703: %', case when sqlstate = '42703' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end;
end $$;

-- D. Fuera del rango hoy±7: nada.
do $$ declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<UUID-ADMIN>', 'role', 'authenticated')::text, true);
  select count(*) into n from public.rutas_del_dia(((now() at time zone 'America/Chicago')::date - 8));
  raise notice 'F1  hace 8 días                                          esperado 0: %', case when n = 0 then 'OK' else 'MAL ' || n end;
  select count(*) into n from public.rutas_del_dia(((now() at time zone 'America/Chicago')::date + 8));
  raise notice 'F2  dentro de 8 días                                     esperado 0: %', case when n = 0 then 'OK' else 'MAL ' || n end;
  select count(*) into n from public.rutas_del_dia(null);
  raise notice 'F3  sin fecha                                            esperado 0: %', case when n = 0 then 'OK' else 'MAL ' || n end;
end $$;

-- E. Sin el módulo, y sin sesión: no ejecutan.
do $$ declare n int; begin
  perform set_config('request.jwt.claims', json_build_object('sub', '<UUID-SIN-MODULO>', 'role', 'authenticated')::text, true);
  begin select count(*) into n from public.rutas_del_dia(current_setting('ensayo.fecha')::date);
    raise notice 'S1  sin el módulo                                        esperado ERROR: MAL, vio %', n;
  exception when others then raise notice 'S1  sin el módulo                        esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin select count(*) into n from public.rutas_del_dia(current_setting('ensayo.fecha')::date);
    raise notice 'S2  authenticated sin perfil                             esperado ERROR: MAL, vio %', n;
  exception when others then raise notice 'S2  authenticated sin perfil             esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end;
end $$;
reset role;
set local role anon;
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin select count(*) into n from public.rutas_del_dia(current_setting('ensayo.fecha')::date);
    raise notice 'S3  anon                                                 esperado ERROR: MAL, vio %', n;
  exception when others then raise notice 'S3  anon                                 esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end;
  begin perform public.ciudad_de_la_direccion('1 Main St, McAllen, TX');
    raise notice 'S4  anon lee la ciudad de una dirección                  esperado ERROR: MAL, paso';
  exception when others then raise notice 'S4  anon, ciudad_de_la_direccion         esperado ERROR 42501: %', case when sqlstate = '42501' then 'OK' else 'MAL (' || sqlstate || ' ' || sqlerrm || ')' end; end;
end $$;
reset role;

-- F. `deliveries` conserva sus políticas, idénticas; y la ciudad nunca es la calle.
do $$ declare ahora text; n int; conCalle int; begin
  select string_agg(polname || ':' || polcmd::text || ':' || md5(coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '')), ',' order by polname)
    into ahora from pg_policy where polrelid = 'public.deliveries'::regclass;
  select count(*) into n from pg_policy where polrelid = 'public.deliveries'::regclass;
  raise notice 'P1  deliveries conserva sus políticas                    esperado 4: %', case when n = 4 then 'OK' else 'MAL ' || n end;
  raise notice 'P2  y son las mismas expresiones que antes: %', case when ahora = current_setting('ensayo.politicas') then 'OK' else 'MAL' end;
  select count(*) into conCalle from public.deliveries where not is_training and public.ciudad_de_la_direccion(delivery_address) ~ '\d';
  raise notice 'C1  ninguna ciudad lleva números (sería la calle)        esperado 0: %', case when conCalle = 0 then 'OK' else 'MAL ' || conCalle end;
  select count(*) into n from public.deliveries where not is_training and btrim(coalesce(delivery_address, '')) <> '';
  select count(*) into conCalle from public.deliveries where not is_training and btrim(coalesce(delivery_address, '')) <> '' and public.ciudad_de_la_direccion(delivery_address) = '';
  raise notice 'C2  direcciones sin ciudad legible (informativo): % de %', conCalle, n;
  raise notice 'C3  «%» · «%» · «%» (esperado «McAllen» · «Pharr» · «»)', public.ciudad_de_la_direccion('4500 N 23rd St, McAllen, TX 78504, USA'),
    public.ciudad_de_la_direccion('1 Calle Uno, Pharr, Hidalgo County, Texas, 78577, United States'),
    public.ciudad_de_la_direccion('9 W ROBLES EDINBURG TX');
end $$;

ROLLBACK;
```

**Resultado del ensayo (2026-10-04, contra producción, dentro de `begin … ROLLBACK`, con la matriz de arriba extraída de
este fichero):** las 48 en `OK`. Salida literal:

```
D0  día de ensayo 2026-09-29 con 33 paradas (no canceladas/rechazadas/borrador, sin enseñanza)
D1  hay algo que ensayar                                 esperado > 0: OK
R1  ventas          ve todas las paradas del día         esperado 33: OK
R2  ventas          solo columnas de la lista blanca    esperado 23: OK
R3  ventas          ni canceladas ni de otro día         esperado 0: OK
R4  ventas          lee de la TABLA lo mismo que antes   esperado 33: OK
R1  ventas_tiendas  ve todas las paradas del día         esperado 33: OK
R2  ventas_tiendas  solo columnas de la lista blanca    esperado 23: OK
R3  ventas_tiendas  ni canceladas ni de otro día         esperado 0: OK
R4  ventas_tiendas  lee de la TABLA lo mismo que antes   esperado 17: OK
R1  almacen         ve todas las paradas del día         esperado 33: OK
R2  almacen         solo columnas de la lista blanca    esperado 23: OK
R3  almacen         ni canceladas ni de otro día         esperado 0: OK
R4  almacen         lee de la TABLA lo mismo que antes   esperado 33: OK
R1  chofer          ve todas las paradas del día         esperado 33: OK
R2  chofer          solo columnas de la lista blanca    esperado 23: OK
R3  chofer          ni canceladas ni de otro día         esperado 0: OK
R4  chofer          lee de la TABLA lo mismo que antes   esperado 10: OK
R1  oficina         ve todas las paradas del día         esperado 33: OK
R2  oficina         solo columnas de la lista blanca    esperado 23: OK
R3  oficina         ni canceladas ni de otro día         esperado 0: OK
R4  oficina         lee de la TABLA lo mismo que antes   esperado 33: OK
R1  gerente         ve todas las paradas del día         esperado 33: OK
R2  gerente         solo columnas de la lista blanca    esperado 23: OK
R3  gerente         ni canceladas ni de otro día         esperado 0: OK
R4  gerente         lee de la TABLA lo mismo que antes   esperado 33: OK
R1  logistica       ve todas las paradas del día         esperado 33: OK
R2  logistica       solo columnas de la lista blanca    esperado 23: OK
R3  logistica       ni canceladas ni de otro día         esperado 0: OK
R4  logistica       lee de la TABLA lo mismo que antes   esperado 33: OK
R1  admin           ve todas las paradas del día         esperado 33: OK
R2  admin           solo columnas de la lista blanca    esperado 23: OK
R3  admin           ni canceladas ni de otro día         esperado 0: OK
R4  admin           lee de la TABLA lo mismo que antes   esperado 33: OK
T1  el chofer lee de la tabla menos que la función (10 de 33): OK
T2  el chofer NO lee órdenes ajenas en la tabla          esperado 0: OK
T3  ventas con tiendas marcadas NO lee las de otras      esperado 0: OK
T4  pedir delivery_address a la función  esperado ERROR 42703: OK
T5  pedir account a la función           esperado ERROR 42703: OK
F1  hace 8 días                                          esperado 0: OK
F2  dentro de 8 días                                     esperado 0: OK
F3  sin fecha                                            esperado 0: OK
S1  sin el módulo                        esperado ERROR 42501: OK
S2  authenticated sin perfil             esperado ERROR 42501: OK
S3  anon                                 esperado ERROR 42501: OK
S4  anon, ciudad_de_la_direccion         esperado ERROR 42501: OK
P1  deliveries conserva sus políticas                    esperado 4: OK
P2  y son las mismas expresiones que antes: OK
C1  ninguna ciudad lleva números (sería la calle)        esperado 0: OK
C2  direcciones sin ciudad legible (informativo): 21 de 418
C3  «McAllen» · «Pharr» · «» (esperado «McAllen» · «Pharr» · «»)
== terminado (ROLLBACK del bloque)
```

Leído: el día de ensayo fue el 2026-09-29 (33 paradas). Los ocho roles con el módulo vieron las 33 por la función y solo
las 23 columnas; de la TABLA cada uno leyó lo mismo que antes de la migración (el chofer, 10 de 33; el vendedor con tiendas
marcadas, 17 de 33; los demás, 33). Después del ensayo se comprobó, en otra conexión de solo lectura: **0** funciones con
esos nombres, **0** filas `160%` en `schema_migrations`, **4** políticas en `deliveries`.

## 7 · Mediciones de solo lectura (2026-10-04, `begin transaction read only`)

| Qué | Valor |
|---|---|
| Perfiles por rol (con el módulo `deliveries`) | admin 4 (4) · logistics 1 (1) · manager 6 (6) · accounting 8 (8) · sales 14 (**13**) · warehouse 4 (4) · driver 4 (4) |
| Perfiles con `visible_stores` | 2, los dos de ventas |
| Políticas de `deliveries` | 4 |
| Tiendas en `settings.stores` | 7, las 7 con punto (lat/lng) |
| Órdenes del 2026-10-03 / 10-04 / 10-05 | 9 (0 con chofer) / 0 / 12 (11 con chofer, 2 choferes, 1 fuera por etapa) |
| Tipos de las columnas | `order_no` bigint · `route_seq`, `load_no` integer · `pickup_seq`, pallets numeric · lat/lng double precision · duraciones y ventana text · horas timestamptz |

## 8 · Reversión

No hay datos que perder: son dos funciones.

```sql
begin;
drop function if exists public.rutas_del_dia(date);
drop function if exists public.ciudad_de_la_direccion(text);
delete from public.schema_migrations where name = '160_rutas_del_dia.sql';
commit;
```

La app no se rompe: sin la función, «Ruta de hoy» pinta lo que cada rol ya podía leer y se lo dice al admin.

## 9 · Lo que NO se ha medido

- **La función llamada desde la app** (PostgREST, `rpc`): el ensayo la llamó por SQL con `request.jwt.claims` puesto a mano.
  Que PostgREST la exponga y devuelva los `numeric` como número no se ha visto; `paradaDeLaFila` convierte texto a número
  por si acaso.
- **El plan de ejecución** con el día más cargado: la consulta filtra por `delivery_date` (33 filas en el día de ensayo) y
  hace un `left join lateral` contra las 7 tiendas de `settings`; no se midió con `explain analyze`.
- **La ciudad en SQL contra la de la app, dirección por dirección**: se comprobó que ninguna de las 418 devuelve números y
  que 21 quedan vacías; no se comparó el texto de las otras 397 con `ciudadDeEntrega`.
- **El punto de entrega a la vista de todos** (decisión 5) no lo ha visto el dueño.
