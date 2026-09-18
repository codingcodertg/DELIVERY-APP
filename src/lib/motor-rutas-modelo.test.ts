import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TIPOS_DE_CLIENTE, esTipoDeCliente, laBaseTieneCustomerType, parcheDeTipoDeCliente, tipoDeClienteDeLaOrden, tipoDeClientePorDefecto,
} from "./customer-type";
import {
  CAPACIDAD_POR_DEFECTO, PESOS_DE_RUTA_POR_DEFECTO, TOPE_DE_RETRASO_POR_DEFECTO_MIN, TURNO_POR_DEFECTO, VENTANAS_DURAS_POR_DEFECTO,
  choferParaElMotor, erroresDeAjustesDeChofer, esVentanaDura, laBaseTieneAjustesDeRuta, minutosDeHora, pesosDeRuta, topeDeRetrasoMin,
  ventanasDuras,
} from "./route-settings";
import { DELIVERY_WINDOW_PRESETS } from "./constants";
import { blankDelivery } from "./blank-delivery";
import type { OrderTypeRules } from "./required";
import type { AccountRecord, DriverSettings, NamedLocation } from "./types";

/**
 * Motor de rutas, incremento 1: el modelo (D-NEXT). Chofer, tipo de cliente y ajustes.
 * Tipos de orden, cuentas, tiendas y choferes inventados: los de verdad son datos del dueño.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
const ejecutable = (sql: string) => plano(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));

const reglas = { ACliente: { storeToStore: false }, EntreTiendas: { storeToStore: true } } as OrderTypeRules;
const cuentas: AccountRecord[] = [
  { name: "Constructora Uno", contact: "", phone: "", customer_type: "builder" },
  { name: "Ferretería Dos", contact: "", phone: "", customer_type: "counter_sale" },
  { name: "Sin Marcar", contact: "", phone: "" },
];

describe("builder o mostrador", () => {
  it("solo existe en las órdenes que van a un cliente", () => {
    expect(esTipoDeCliente("ACliente", reglas)).toBe(true);
    expect(esTipoDeCliente("EntreTiendas", reglas)).toBe(false);
    expect(esTipoDeCliente(null, reglas)).toBe(false);
    expect(esTipoDeCliente("  ", reglas)).toBe(false);
  });

  it("por defecto: Builder si la cuenta guardada lo es; Mostrador en cualquier otro caso, también sin cuenta", () => {
    expect(tipoDeClientePorDefecto("Constructora Uno", cuentas)).toBe("builder");
    expect(tipoDeClientePorDefecto("  constructora uno ", cuentas)).toBe("builder");
    expect(tipoDeClientePorDefecto("Ferretería Dos", cuentas)).toBe("counter_sale");
    expect(tipoDeClientePorDefecto("Sin Marcar", cuentas)).toBe("counter_sale");
    expect(tipoDeClientePorDefecto("No Guardada", cuentas)).toBe("counter_sale");
    expect(tipoDeClientePorDefecto(null, cuentas)).toBe("counter_sale");
    expect(tipoDeClientePorDefecto("", null)).toBe("counter_sale");
  });

  it("lo que alguien eligió en la orden manda sobre la cuenta, en los dos sentidos", () => {
    expect(tipoDeClienteDeLaOrden({ order_type: "ACliente", account: "Constructora Uno", customer_type: "counter_sale" }, reglas, cuentas)).toBe("counter_sale");
    expect(tipoDeClienteDeLaOrden({ order_type: "ACliente", account: null, customer_type: "builder" }, reglas, cuentas)).toBe("builder");
    expect(tipoDeClienteDeLaOrden({ order_type: "ACliente", account: "Constructora Uno" }, reglas, cuentas)).toBe("builder");
    // Un valor que no es ninguno de los dos no se guarda: cae al de la cuenta.
    expect(tipoDeClienteDeLaOrden({ order_type: "ACliente", account: null, customer_type: "vip" as never }, reglas, cuentas)).toBe("counter_sale");
  });

  it("un movimiento entre tiendas no es ni lo uno ni lo otro, aunque traiga una marca", () => {
    expect(tipoDeClienteDeLaOrden({ order_type: "EntreTiendas", account: "Constructora Uno", customer_type: "builder" }, reglas, cuentas)).toBeNull();
  });

  it("el selector ofrece los dos, con Mostrador primero", () => {
    expect(TIPOS_DE_CLIENTE.map((o) => o.key)).toEqual(["counter_sale", "builder"]);
  });
});

describe("la red: no se manda customer_type a una base que todavía no lo tiene", () => {
  const vieja = [{ id: "1", stage: "draft" }];
  const nueva = [{ id: "1", stage: "draft" }, { id: "2", customer_type: null }];

  it("si alguna orden cargada trae la clave, la columna existe; si ninguna, no se sabe y se contesta que no", () => {
    expect(laBaseTieneCustomerType(nueva)).toBe(true);
    expect(laBaseTieneCustomerType(vieja)).toBe(false);
    expect(laBaseTieneCustomerType([])).toBe(false);
  });

  it("contra la base vieja el parche va VACÍO: ni la clave, para que el guardado de la orden no falle", () => {
    expect(parcheDeTipoDeCliente({ order_type: "ACliente", account: "Constructora Uno" }, reglas, cuentas, vieja)).toEqual({});
    expect("customer_type" in parcheDeTipoDeCliente({ order_type: "ACliente" }, reglas, cuentas, [])).toBe(false);
  });

  it("contra la nueva lleva el tipo, y null en lo que no va a un cliente", () => {
    expect(parcheDeTipoDeCliente({ order_type: "ACliente", account: "Constructora Uno" }, reglas, cuentas, nueva)).toEqual({ customer_type: "builder" });
    expect(parcheDeTipoDeCliente({ order_type: "EntreTiendas", customer_type: "builder" }, reglas, cuentas, nueva)).toEqual({ customer_type: null });
  });

  it("una orden en blanco (modo enseñanza) trae la clave, a null", () => {
    expect(blankDelivery()).toHaveProperty("customer_type", null);
  });

  it("el formulario guarda con el parche y pinta el selector con las funciones, solo en tipos de cliente", () => {
    const f = plano(sinComentarios(leer("src/components/OrderModal.tsx")));
    expect(f).toContain("...parcheDeTipoDeCliente(d, settings.order_type_rules, settings.accounts, deliveries),");
    expect(f).toContain("{esTipoDeCliente(d.order_type, settings.order_type_rules) && (");
    expect(f).toContain('value={tipoDeClienteDeLaOrden(d, settings.order_type_rules, settings.accounts) ?? "counter_sale"}');
    expect(f).toContain('onChange={(e) => set("customer_type", e.target.value as CustomerType)}');
  });

  it("en Datos, la cuenta se marca como builder; una de sucursal no lleva tipo", () => {
    const d = plano(sinComentarios(leer("src/app/(app)/data/page.tsx")));
    expect(d).toContain('builder: a.customer_type === "builder"');
    expect(d).toContain('customer_type: r.intertienda ? undefined : (r.builder ? "builder" as const : "counter_sale" as const),');
  });
});

describe("pesos, ventanas duras y tope", () => {
  it("sin nada guardado, los valores por defecto; y su orden es el del dueño", () => {
    expect(pesosDeRuta({})).toEqual(PESOS_DE_RUTA_POR_DEFECTO);
    const p = PESOS_DE_RUTA_POR_DEFECTO;
    expect(p.builder).toBeGreaterThan(p.manejo);
    expect(p.manejo).toBeGreaterThan(p.tarde);
    expect(p.tarde).toBeGreaterThan(p.balance);
    expect(p.balance).toBeGreaterThan(0);
    expect(p.millas).toBeGreaterThan(0);
  });

  it("lo guardado manda peso a peso; lo que falta, o no es un número ≥ 0, cae al de por defecto", () => {
    expect(pesosDeRuta({ route_weights: { builder: 5, balance: 0 } })).toEqual({ ...PESOS_DE_RUTA_POR_DEFECTO, builder: 5, balance: 0 });
    expect(pesosDeRuta({ route_weights: { manejo: -1, tarde: Number.NaN, millas: "3" as never } })).toEqual(PESOS_DE_RUTA_POR_DEFECTO);
    expect(pesosDeRuta({ route_weights: null })).toEqual(PESOS_DE_RUTA_POR_DEFECTO);
  });

  it("las duras por defecto son dos slots de la app, y 08:30–12:00 es una: por eso es una lista y no una duración", () => {
    expect(ventanasDuras({})).toEqual(["0830-1000", "0830-1200"]);
    const slots = DELIVERY_WINDOW_PRESETS.map((p) => p.value);
    for (const v of VENTANAS_DURAS_POR_DEFECTO) expect(slots).toContain(v);
  });

  it("una lista VACÍA guardada es «ninguna es dura», no «las de por defecto»; y lo que no es un slot se descarta", () => {
    expect(ventanasDuras({ route_hard_windows: [] })).toEqual([]);
    expect(ventanasDuras({ route_hard_windows: null })).toEqual(["0830-1000", "0830-1200"]);
    expect(ventanasDuras({ route_hard_windows: ["1200-1730", "0830-0930", " 1200-1730 "] })).toEqual(["1200-1730"]);
    expect(esVentanaDura("0830-1200", {})).toBe(true);
    expect(esVentanaDura("0830-1730", {})).toBe(false);
    expect(esVentanaDura(null, {})).toBe(false);
    expect(esVentanaDura("0830-1200", { route_hard_windows: [] })).toBe(false);
  });

  it("el tope: 60 por defecto, cero es un valor legítimo, y lo que no es un número cae a 60", () => {
    expect(topeDeRetrasoMin({})).toBe(60);
    expect(TOPE_DE_RETRASO_POR_DEFECTO_MIN).toBe(60);
    expect(topeDeRetrasoMin({ route_late_cap_min: 0 })).toBe(0);
    expect(topeDeRetrasoMin({ route_late_cap_min: 45.4 })).toBe(45);
    expect(topeDeRetrasoMin({ route_late_cap_min: -5 })).toBe(60);
  });

  it("se sabe si la base tiene las tres columnas mirando si `settings` trae las claves", () => {
    expect(laBaseTieneAjustesDeRuta({ route_weights: {}, route_hard_windows: [], route_late_cap_min: 60 })).toBe(true);
    expect(laBaseTieneAjustesDeRuta({ route_weights: {}, route_hard_windows: [] })).toBe(false);
    expect(laBaseTieneAjustesDeRuta({})).toBe(false);
  });
});

describe("el chofer para el motor", () => {
  const tiendas: NamedLocation[] = [
    { name: "Tienda Norte", address: "1 Calle", lat: 26.2, lng: -98.2 },
    { name: "Tienda Sin Punto", address: "2 Calle" },
  ];
  const perfil = { id: "p1", full_name: "Chofer De Prueba" };
  const fila = (extra: Partial<DriverSettings> = {}): DriverSettings => ({
    profile_id: "p1", base_store: "Tienda Norte", capacity_pallets: 9.5, shift_start: "07:30:00", shift_end: "16:00", returns_to_base: false, routable: true, ...extra,
  });

  it("con su fila: base, capacidad con decimales, turno en minutos", () => {
    expect(choferParaElMotor(perfil, fila(), { stores: tiendas })).toEqual({
      id: "p1", nombre: "Chofer De Prueba", base: "Tienda Norte", capacidad: 9.5, entradaMin: 450, salidaMin: 960,
      vuelveABase: false, rutea: true, falta: [],
    });
  });

  it("la capacidad: su fila → la que tenía por NOMBRE → la de flota → 12, en ese orden", () => {
    const s = { stores: tiendas, driver_capacity: { "Chofer De Prueba": 10 }, default_truck_capacity: 14 };
    expect(choferParaElMotor(perfil, fila(), s).capacidad).toBe(9.5);
    expect(choferParaElMotor(perfil, fila({ capacity_pallets: null }), s).capacidad).toBe(10);
    expect(choferParaElMotor(perfil, fila({ capacity_pallets: null }), { ...s, driver_capacity: {} }).capacidad).toBe(14);
    expect(choferParaElMotor(perfil, fila({ capacity_pallets: null }), { stores: tiendas }).capacidad).toBe(12);
    expect(CAPACIDAD_POR_DEFECTO).toBe(12);
    // Un cero o un negativo no es una capacidad: se salta.
    expect(choferParaElMotor(perfil, fila({ capacity_pallets: 0 }), s).capacidad).toBe(10);
  });

  it("sin fila: turno por defecto, vuelve a la base, y NO rutea porque no tiene base", () => {
    const c = choferParaElMotor(perfil, null, { stores: tiendas });
    expect([c.entradaMin, c.salidaMin, c.vuelveABase]).toEqual([480, 1050, true]);
    expect(TURNO_POR_DEFECTO).toEqual({ entrada: "08:00", salida: "17:30" });
    expect([c.rutea, c.falta, c.base]).toEqual([false, ["base"], null]);
  });

  it("una base que no es una tienda con punto tampoco sirve, y se dice cuál de las dos cosas falta", () => {
    expect(choferParaElMotor(perfil, fila({ base_store: "Tienda Sin Punto" }), { stores: tiendas })).toMatchObject({ rutea: false, falta: ["base_sin_punto"] });
    expect(choferParaElMotor(perfil, fila({ base_store: "No Existe" }), { stores: tiendas })).toMatchObject({ rutea: false, falta: ["base_sin_punto"] });
    expect(choferParaElMotor(perfil, fila({ base_store: " tienda norte " }), { stores: tiendas })).toMatchObject({ rutea: true, base: "Tienda Norte" });
  });

  it("marcado como que no rutea, no rutea aunque lo tenga todo", () => {
    expect(choferParaElMotor(perfil, fila({ routable: false }), { stores: tiendas })).toMatchObject({ rutea: false, falta: [] });
  });

  it("las horas: con o sin segundos; lo que no es una hora, null", () => {
    expect([minutosDeHora("08:00"), minutosDeHora("17:30:00"), minutosDeHora("7:05")]).toEqual([480, 1050, 425]);
    expect([minutosDeHora("24:00"), minutosDeHora("08:60"), minutosDeHora("ocho"), minutosDeHora(null)]).toEqual([null, null, null, null]);
  });

  it("antes de guardar: capacidad > 0, la salida después de la entrada, y la base una tienda de Ajustes", () => {
    const ok = { base_store: "Tienda Norte", capacity_pallets: 10, shift_start: "08:00", shift_end: "17:30" };
    expect(erroresDeAjustesDeChofer(ok, tiendas)).toEqual([]);
    expect(erroresDeAjustesDeChofer({ ...ok, capacity_pallets: null, base_store: null }, tiendas)).toEqual([]);
    expect(erroresDeAjustesDeChofer({ ...ok, capacity_pallets: 0 }, tiendas)).toEqual(["capacidad"]);
    expect(erroresDeAjustesDeChofer({ ...ok, shift_end: "08:00" }, tiendas)).toEqual(["turno"]);
    expect(erroresDeAjustesDeChofer({ ...ok, shift_start: "" }, tiendas)).toEqual(["turno"]);
    expect(erroresDeAjustesDeChofer({ ...ok, base_store: "Otra" }, tiendas)).toEqual(["base"]);
  });

  it("la tarjeta de Ajustes guarda pidiendo las filas, y no deja editar lo que la base aún no tiene", () => {
    const c = plano(sinComentarios(leer("src/components/RouteEngineSettings.tsx")));
    expect(c).toContain('.upsert({ profile_id: id, ...f, base_store: (f.base_store ?? "").trim() || null }, { onConflict: "profile_id" }) .select("profile_id");');
    expect(c).toContain("if (error || !data || data.length !== 1) {");
    expect(c).toContain("const errores = erroresDeAjustesDeChofer(f, settings.stores ?? []);");
    expect(c).toContain("const hayColumnas = laBaseTieneAjustesDeRuta(settings);");
    expect(c.match(/disabled=\{!hayColumnas\}/g)?.length).toBe(3);
    expect(plano(leer("src/app/(app)/settings/page.tsx"))).toContain("<RouteEngineSettings />");
  });
});

describe("las tres migraciones", () => {
  const dir = "supabase/migrations";
  const m128 = leer(`${dir}/128_driver_settings.sql`), m129 = leer(`${dir}/129_customer_type.sql`), m130 = leer(`${dir}/130_route_settings.sql`);
  const todas: [string, string][] = [["128_driver_settings.sql", m128], ["129_customer_type.sql", m129], ["130_route_settings.sql", m130]];

  it("ninguna lleva transacción propia, todas se autocomprueban y se auto-registran, y ninguna lleva el marcador sin numerar", () => {
    for (const [nombre, sql] of todas) {
      const codigo = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
      expect(codigo, nombre).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
      expect(codigo, nombre).toContain("do $comprueba$");
      expect(sql.split("-- @ledger-below")[1], nombre).toContain(`'${nombre}'`);
      expect(sql.split("-- @ledger-below")[1], nombre).toMatch(/'[0-9a-f]{64}'/);
      expect(sql, nombre).not.toContain("D-" + "NEXT");
      expect(sql, nombre).toContain("--   rollback;");
    }
  });

  it("128: primero se quita todo y después se da; una política por comando y ninguna FOR ALL", () => {
    const e = ejecutable(m128);
    const quita = e.indexOf("revoke all on public.driver_settings from anon, authenticated;");
    const da = e.indexOf("grant select, insert, update, delete on public.driver_settings to authenticated;");
    expect(quita).toBeGreaterThan(0);
    expect(da).toBeGreaterThan(quita);
    expect(e).toContain("alter table public.driver_settings enable row level security;");
    const politicas = [...e.matchAll(/create policy "[^"]+" on public\.driver_settings for (\w+)/g)].map((x) => x[1]).sort();
    expect(politicas).toEqual(["delete", "insert", "select", "update"]);
  });

  it("128: leen cinco roles con acceso a Entregas; escriben admin y logística — y el chofer, ni lee", () => {
    const e = ejecutable(m128);
    const politica = (n: string) => { const i = e.indexOf(`create policy "driver_settings ${n}"`); return e.slice(i, e.indexOf(";", i)); };
    const roles = (txt: string) => [...txt.matchAll(/current_user_role\(\)\) in \(([^)]*)\)/g)].map((x) => x[1].split(",").map((r) => r.trim().replace(/'/g, "")).sort().join(","));
    expect(roles(politica("select"))).toEqual(["accounting,admin,logistics,manager,warehouse"]);
    for (const n of ["insert", "delete"]) expect(roles(politica(n)), n).toEqual(["admin,logistics"]);
    // En UPDATE, las dos cláusulas: `using` (qué filas) y `with check` (cómo quedan).
    expect(roles(politica("update"))).toEqual(["admin,logistics", "admin,logistics"]);
    for (const n of ["select", "insert", "update", "delete"]) expect(politica(n), n).toContain("(select public.has_deliveries_access())");
  });

  it("128: por profile_id, con las mismas comprobaciones que la pantalla, y los mismos valores por defecto que el código", () => {
    const e = ejecutable(m128);
    expect(e).toContain("profile_id uuid primary key references public.profiles(id) on delete cascade,");
    expect(e).toContain("check (capacity_pallets is null or capacity_pallets > 0)");
    expect(e).toContain("check (shift_end > shift_start)");
    expect(e).toContain(`shift_start time not null default '${TURNO_POR_DEFECTO.entrada}',`);
    expect(e).toContain(`shift_end time not null default '${TURNO_POR_DEFECTO.salida}',`);
    expect(e).toContain("capacity_pallets numeric,");
    expect(e).toContain("routable boolean not null default true,");
  });

  it("128: no siembra datos ni toca deliveries, profiles, settings ni ninguna política ajena", () => {
    const e = ejecutable(m128).split("do $comprueba$")[0];
    expect(e).not.toMatch(/insert into public\.driver_settings|alter table public\.(deliveries|profiles|settings)|(alter|drop|create) policy "[^"]*" on public\.(?!driver_settings)/);
    expect(e).toContain("if auth.uid() is not null then NEW.updated_by := auth.uid(); end if;");
  });

  it("129: una columna que admite null, con sus dos valores, sin rellenar nada hacia atrás y sin tocar guards ni políticas", () => {
    const e = ejecutable(m129);
    expect(e).toContain("alter table public.deliveries add column if not exists customer_type text;");
    const valores = /customer_type in \(([^)]*)\)/.exec(e)![1].split(",").map((v) => v.trim().replace(/'/g, "")).sort();
    expect(valores).toEqual(TIPOS_DE_CLIENTE.map((o) => o.key).sort());
    expect(e).toContain("check (customer_type is null or customer_type in");
    expect(e.split("do $comprueba$")[0]).not.toMatch(/\bupdate\s+public\.|create or replace function|policy|\bgrant\b|\brevoke\b|create trigger/);
  });

  it("129: el ensayo repite, con la columna ya puesta, los casos del guard que comparan la fila entera", () => {
    expect(m129).toContain("B1 update ... set invoice_num = 'ENSAYO-1'");
    expect(m129).toContain("B2 update ... set invoice_num = 'ENSAYO-2', customer_type = 'builder'");
    expect(m129).toContain("B4 update ... set pod_lat = 26.2, pod_lng = -98.2");
  });

  it("130: tres columnas declaradas, con los MISMOS valores por defecto que el código", () => {
    const e = ejecutable(m130);
    const json = /add column if not exists route_weights jsonb not null default '([^']*)'::jsonb/.exec(e)![1];
    expect(JSON.parse(json)).toEqual(PESOS_DE_RUTA_POR_DEFECTO);
    const lista = /add column if not exists route_hard_windows text\[\] not null default '\{([^}]*)\}'::text\[\]/.exec(e)![1].split(",");
    expect(lista).toEqual([...VENTANAS_DURAS_POR_DEFECTO]);
    expect(e).toContain(`add column if not exists route_late_cap_min integer not null default ${TOPE_DE_RETRASO_POR_DEFECTO_MIN};`);
    expect(e.split("do $comprueba$")[0]).not.toMatch(/policy|\bgrant\b|\brevoke\b|\bupdate\s+public\./);
  });

  it("130: la autocomprobación mira los valores por defecto de las COLUMNAS, no la fila que el admin afinará", () => {
    const auto = ejecutable(m130).slice(ejecutable(m130).indexOf("do $comprueba$"));
    expect(auto).toContain("execute 'select (' || expresion || ')::jsonb' into pesos;");
    expect(auto).toContain("(pesos->>'builder')::numeric > (pesos->>'manejo')::numeric");
    expect(auto).not.toContain("f.route_late_cap_min <> 60");
  });
});
