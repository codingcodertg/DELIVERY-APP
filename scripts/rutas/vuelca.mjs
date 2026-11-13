// Vuelca, SOLO LECTURA, las rutas hechas a mano de los ultimos dias para repetirlas contra el motor (D-1029).
//
//   node scripts/rutas/vuelca.mjs <fichero-de-salida.json> [dias=46]
//
// El fichero lleva datos reales (choferes, coordenadas de clientes): NO va al repo. Escribalo fuera de el. Despues:
//
//   RUTAS_DATOS=<fichero> npx vitest run src/lib/rutas-a-mano.backtest.test.ts
//       imprime humano contra motor, antes y despues de D-1029 (millas, jornada de tarjeta, retrasos), y los patrones.
//   RUTAS_DATOS=<fichero> RUTAS_ESCRIBE=1 npx vitest run src/lib/rutas-a-mano.backtest.test.ts
//       ademas reescribe src/lib/rutas-a-mano-anon.json (el caso fijo y anonimo de la prueba) y
//       src/lib/patrones-de-despacho.json (lo medido, con su fecha).
//
// Sin acentos, como el resto de scripts/db.

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cargaEntorno, ROOT } from "../db/ledger.mjs";

const salida = process.argv[2];
const dias = Number(process.argv[3] ?? 46);
if (!salida || !Number.isFinite(dias) || dias < 1) {
  console.error("uso: node scripts/rutas/vuelca.mjs <fichero-de-salida.json> [dias]");
  process.exit(1);
}
if (resolve(salida).startsWith(resolve(ROOT))) {
  console.error("El volcado lleva datos reales: escribalo FUERA del repo.");
  process.exit(1);
}

cargaEntorno();
const { Client } = createRequire(import.meta.url)("pg");
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
await c.query("set default_transaction_read_only = on");
const filas = async (sql, args = []) => (await c.query(sql, args)).rows;

const deliveries = await filas(
  `select id, order_no, relay_step, order_type, store, pickup_name, delivery_date::text d, assigned_driver, route_seq,
          pickup_seq::float8 pickup_seq, load_no, stage, delivery_windows, est_pallets::float8 est_pallets,
          actual_pallets::float8 actual_pallets, pickup_duration, delivery_duration, morning_priority, priority,
          pickup_gps_at, pod_delivered_at, delivery_lat, delivery_lng
     from deliveries
    where delivery_date > current_date - $1::int and delivery_date <= current_date + 1
      and coalesce(is_training, false) = false and stage <> 'canceled'`, [dias]);
const settings = (await filas(`select stores, route_hard_windows, driver_capacity, default_truck_capacity from settings`))[0];
const drivers = await filas(
  `select p.id, p.full_name, p.store, s.base_store from driver_settings s join profiles p on p.id = s.profile_id`);
const cache = await filas(`select origin_key o, dest_key t, minutes m, miles::float8 mi, traffic from travel_time_cache where traffic = false`);
const bases = await filas(`select plan_date::text d, driver_id, start_store, end_store from driver_day_bases`);
await c.end();

writeFileSync(salida, JSON.stringify({ volcado: new Date().toISOString().slice(0, 10), deliveries, settings, drivers, cache, bases }));
console.log(`${deliveries.length} ordenes, ${cache.length} tramos en cache -> ${salida}`);
