import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  ajustesDelDia, baseTrasElCambio, basesDeFilas, basesPorNombreDelDia, extremosDeLaRuta, extremosDelChofer, faltaLaTablaDeBases, guardaBaseDelDia,
  leeBasesDelDia, opcionesDeFin, opcionesDeSalida, TABLA_DE_BASES_DEL_DIA, zonasDelDia, type BaseDelDia, type ClienteDeBasesDelDia, type FilaDeBaseDelDia,
} from "./base-del-dia";
import { basesPorNombre, entradaDeOptimizar, puntosDeLaEntrada, tiendaBaseDelChofer } from "./optimizar-desde-el-gestor";
import { entradaDelDia, type DatosDelDia } from "./route-plan/entrada";
import { planificaElDia } from "./route-plan/borrador";
import { cacheEnMemoria, tramosDelPlan } from "./route-times/tiempos";
import { proveedorEstimado } from "./route-times/proveedores";
import { evaluaRuta, PARAMETROS_POR_DEFECTO, recogidaFueraDeZona, zonasReclamadas, type ChoferEntrada, type OrdenEntrada } from "./route-engine";
import { puntosDelReparto } from "./reparto-desde-el-gestor";
import { cuerpoDeLaMedida } from "./medida-de-ruta";
import { firmaDeLaForma, mideLaLista } from "./usa-medida-de-rutas";
import { puntosDeLasRutas, type CarrilDeRuta } from "./mapa-de-rutas";
import { costeDeLaRuta, mejorLugar } from "./mejor-lugar";
import { BaseDelDiaDelChofer } from "@/components/BaseDelDiaDelChofer";
import { PanelDeChoferes } from "@/components/PanelDeChoferes";
import type { DriverSettings, NamedLocation } from "./types";

/**
 * De qué tienda SALE y en cuál TERMINA cada chofer, un día (migración 166, `driver_day_bases`; `base-del-dia.ts`).
 *
 * El dueño, 2026-10-11: «choose the driver strarting position LOGISTIC MANAGER, DEFAULT IS THE ONE HE ALREADY WORKS ON» y
 * «Need to be able to assign store where driver is starting/ ending at. For example, Julio will start in mcallen 10/12/26 to
 * use other truck since his is in maintenance».
 *
 * Su ejemplo, anonimizado, es el hilo de casi todo: el chofer «A» tiene su base en «Pharr»; el 2026-10-12 sale y termina en
 * «McAllen»; al día siguiente, sin tocar nada, vuelve a salir de su base. Ninguna tienda, chofer ni dirección es real.
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
const trozo = (desde: string, hasta: string, de = pagina) => {
  const i = de.indexOf(desde);
  expect(i, desde).toBeGreaterThan(-1);
  const j = de.indexOf(hasta, i + desde.length);
  expect(j, hasta).toBeGreaterThan(i);
  return de.slice(i, j);
};

const PHARR: NamedLocation = { name: "Pharr", address: "1 Calle Uno, Pharr, TX 78577", lat: 26.19, lng: -98.18 };
const MCALLEN: NamedLocation = { name: "McAllen", address: "2 Calle Dos, McAllen, TX 78501", lat: 26.22, lng: -98.23 };
const BROWNSVILLE: NamedLocation = { name: "Brownsville", address: "3 Calle Tres, Brownsville, TX 78520", lat: 25.93, lng: -97.49 };
const SIN_PUNTO: NamedLocation = { name: "Bodega sin punto", address: "4 Calle Cuatro, Weslaco, TX 78596" };
const TIENDAS = [PHARR, MCALLEN, BROWNSVILLE, SIN_PUNTO];

const DIA = "2026-10-12", OTRO_DIA = "2026-10-13";
const fila = (profile_id: string, base_store: string | null, zonas: string[] = [], extra: Partial<DriverSettings> = {}): DriverSettings => ({
  profile_id, base_store, capacity_pallets: 12, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true, preferred_zones: zonas, ...extra,
});
const USUARIOS = [
  { id: "a", full_name: "Chofer A", store: null, role: "driver" as const },
  { id: "b", full_name: "Chofer B", store: null, role: "driver" as const },
  { id: "c", full_name: "Chofer C", store: "Brownsville", role: "driver" as const },
];
const AJUSTES = [fila("a", "Pharr", ["Pharr", "Edinburg"]), fila("b", "McAllen", ["McAllen"])];
/** Lo guardado para el 2026-10-12: «A» sale (y termina) en McAllen. Para el 13, nada. */
const DEL_DIA: Record<string, Record<string, BaseDelDia>> = { [DIA]: { a: { salida: "McAllen", fin: null } }, [OTRO_DIA]: {} };

// =====================================================================================================================
describe("1 · QUÉ MANDA: la salida elegida para ese día > la base de Ajustes > la tienda del perfil; el fin elegido > donde sale", () => {
  it("sin nada elegido, sale de su base de Ajustes y termina en ella: lo de siempre", () => {
    const x = extremosDelChofer({ deAjustes: "Pharr", dePerfil: "McAllen", tiendas: TIENDAS });
    expect([x.salida?.tienda.name, x.salida?.origen, x.fin?.tienda.name, x.fin?.origen, x.base?.tienda.name, x.base?.origen]).toEqual(["Pharr", "ajustes", "Pharr", "salida", "Pharr", "ajustes"]);
  });
  it("lo elegido para ESE día manda sobre Ajustes y sobre el perfil; su base sigue siendo la de siempre (para marcarla «su base»)", () => {
    const x = extremosDelChofer({ delDia: { salida: "mcallen ", fin: null }, deAjustes: "Pharr", dePerfil: "Brownsville", tiendas: TIENDAS });
    expect([x.salida?.tienda.name, x.salida?.origen, x.base?.tienda.name]).toEqual(["McAllen", "dia", "Pharr"]);
  });
  it("sin base de Ajustes, la del perfil (D-461); sin ninguna, sin base y sin fin (ruta abierta)", () => {
    expect(extremosDelChofer({ dePerfil: "Brownsville", tiendas: TIENDAS }).salida).toEqual({ tienda: BROWNSVILLE, origen: "perfil" });
    const nada = extremosDelChofer({ tiendas: TIENDAS });
    expect([nada.salida, nada.fin, nada.base]).toEqual([null, null, null]);
    // Pero si para ese día se le elige una, sale de ella (y termina en ella).
    const hoy = extremosDelChofer({ delDia: { salida: "McAllen", fin: null }, tiendas: TIENDAS });
    expect([hoy.salida?.tienda.name, hoy.fin?.tienda.name, hoy.base]).toEqual(["McAllen", "McAllen", null]);
  });
  it("un nombre que ya no es una tienda de Ajustes se salta: cae a lo siguiente", () => {
    expect(extremosDelChofer({ delDia: { salida: "Tienda cerrada", fin: "Otra cerrada" }, deAjustes: "Pharr", tiendas: TIENDAS }).salida?.tienda.name).toBe("Pharr");
    expect(extremosDelChofer({ delDia: { salida: "Tienda cerrada", fin: "Otra cerrada" }, deAjustes: "Pharr", tiendas: TIENDAS }).fin?.tienda.name).toBe("Pharr");
    expect(extremosDelChofer({ deAjustes: "Tienda cerrada", dePerfil: "McAllen", tiendas: TIENDAS }).salida?.tienda.name).toBe("McAllen");
  });
  it("el FIN: el elegido manda; si no se elige, termina DONDE SALE ese día (no en su base): el camión vuelve a donde lo tomó", () => {
    const soloSalida = extremosDelChofer({ delDia: { salida: "McAllen", fin: null }, deAjustes: "Pharr", tiendas: TIENDAS });
    expect([soloSalida.fin?.tienda.name, soloSalida.fin?.origen]).toEqual(["McAllen", "salida"]);
    const soloFin = extremosDelChofer({ delDia: { salida: null, fin: "Brownsville" }, deAjustes: "Pharr", tiendas: TIENDAS });
    expect([soloFin.salida?.tienda.name, soloFin.fin?.tienda.name, soloFin.fin?.origen]).toEqual(["Pharr", "Brownsville", "dia"]);
  });
  it("si no vuelve a base (Ajustes, `returns_to_base` en falso), no hay fin, aunque se haya elegido uno", () => {
    const x = extremosDelChofer({ delDia: { salida: "McAllen", fin: "Brownsville" }, deAjustes: "Pharr", vuelve: false, tiendas: TIENDAS });
    expect([x.salida?.tienda.name, x.fin]).toEqual(["McAllen", null]);
  });
  it("en el Gestor, por el NOMBRE de la ruta (`extremosDeLaRuta`): el caso del dueño, el 12 sale de McAllen y el 13 de su base", () => {
    const fuentes = (fecha: string) => ({
      delDia: basesPorNombreDelDia(DEL_DIA[fecha], USUARIOS), deAjustes: basesPorNombre(AJUSTES, USUARIOS), usuarios: USUARIOS, tiendas: TIENDAS,
    });
    const el12 = extremosDeLaRuta("Chofer A", fuentes(DIA)), el13 = extremosDeLaRuta("Chofer A", fuentes(OTRO_DIA));
    expect([el12.salida?.tienda.name, el12.fin?.tienda.name]).toEqual(["McAllen", "McAllen"]);
    expect([el13.salida?.tienda.name, el13.fin?.tienda.name]).toEqual(["Pharr", "Pharr"]);
    // Los demás, su base; uno sin Ajustes, la de su perfil; una ruta temporal, nada.
    expect(extremosDeLaRuta("Chofer B", fuentes(DIA)).salida?.tienda.name).toBe("McAllen");
    expect(extremosDeLaRuta("Chofer C", fuentes(DIA)).salida?.tienda.name).toBe("Brownsville");
    expect(extremosDeLaRuta("Ruta 1", fuentes(DIA)).salida).toBeNull();
    // Y quien no vuelve a base, sin fin.
    expect(extremosDeLaRuta("Chofer A", { ...fuentes(DIA), noVuelven: new Set(["Chofer A"]) }).fin).toBeNull();
  });
  it("`tiendaBaseDelChofer` (D-461) es la base DE SIEMPRE, sin lo del día: la misma regla, por dentro", () => {
    expect(tiendaBaseDelChofer("Chofer A", basesPorNombre(AJUSTES, USUARIOS), USUARIOS, TIENDAS)?.name).toBe("Pharr");
    expect(tiendaBaseDelChofer("Chofer C", basesPorNombre(AJUSTES, USUARIOS), USUARIOS, TIENDAS)?.name).toBe("Brownsville");
    expect(plano(leer("src/lib/optimizar-desde-el-gestor.ts"))).toContain("return extremosDelChofer({ deAjustes: bases.get(nombre), dePerfil:");
  });
});

// =====================================================================================================================
describe("2 · el selector: qué ofrece y qué guarda", () => {
  it("«Sale de»: primero su base, marcada «(su base)»; luego las demás tiendas; la que no tiene punto, apagada", () => {
    const o = opcionesDeSalida(TIENDAS, PHARR);
    expect(o.map((x) => [x.valor, x.es, x.apagada])).toEqual([
      ["", "Pharr (su base)", false], ["McAllen", "McAllen", false], ["Brownsville", "Brownsville", false], ["Bodega sin punto", "Bodega sin punto — sin punto en el mapa", true],
    ]);
    expect(o[0].en).toBe("Pharr (their base)");
    expect(opcionesDeSalida(TIENDAS, null)[0].es).toBe("— sin base —");
  });
  it("«Termina en»: primero donde sale ese día («(como la salida)», o «(su base)» si sale de ella); su base, marcada", () => {
    const o = opcionesDeFin(TIENDAS, MCALLEN, PHARR);
    expect(o.map((x) => [x.valor, x.es])).toEqual([
      ["", "McAllen (como la salida)"], ["Pharr", "Pharr (su base)"], ["Brownsville", "Brownsville"], ["Bodega sin punto", "Bodega sin punto — sin punto en el mapa"],
    ]);
    expect(opcionesDeFin(TIENDAS, PHARR, PHARR)[0].es).toBe("Pharr (su base)");
  });
  it("lo que se guarda, limpio: elegir su base es «lo de siempre»; el fin igual a la salida, también; las dos así, se BORRA la fila", () => {
    expect(baseTrasElCambio(undefined, { salida: "McAllen" }, PHARR)).toEqual({ salida: "McAllen", fin: null });
    expect(baseTrasElCambio({ salida: "McAllen", fin: null }, { fin: "McAllen" }, PHARR)).toEqual({ salida: "McAllen", fin: null });
    expect(baseTrasElCambio({ salida: "McAllen", fin: null }, { fin: "Pharr" }, PHARR)).toEqual({ salida: "McAllen", fin: "Pharr" });
    expect(baseTrasElCambio({ salida: "McAllen", fin: "Pharr" }, { salida: "pharr" }, PHARR)).toEqual(null);
    expect(baseTrasElCambio({ salida: "McAllen", fin: null }, { salida: null }, PHARR)).toBeNull();
    expect(baseTrasElCambio(undefined, { fin: "Brownsville" }, PHARR)).toEqual({ salida: null, fin: "Brownsville" });
    expect(baseTrasElCambio({ salida: null, fin: "Brownsville" }, { fin: "Pharr" }, PHARR)).toBeNull();
  });
});

// =====================================================================================================================
describe("3 · la zona (D-479) sigue a la SALIDA del día", () => {
  it("la ciudad de su base se cambia por la de la tienda de la que sale; lo demás, igual", () => {
    expect(zonasDelDia(["Pharr", "Edinburg"], "Pharr", "McAllen")).toEqual(["Edinburg", "McAllen"]);
    expect(zonasDelDia(["PHARR", "Edinburg"], "pharr", "McAllen")).toEqual(["Edinburg", "McAllen"]);
    // Si ya la tenía, no se repite; si su base no estaba entre sus zonas, solo se añade la de la salida.
    expect(zonasDelDia(["Pharr", "McAllen"], "Pharr", "mcallen")).toEqual(["McAllen"]);
    expect(zonasDelDia(["Edinburg"], "Pharr", "McAllen")).toEqual(["Edinburg", "McAllen"]);
  });
  it("sin zonas, sin zonas (darle una le haría pagar por las de los demás); misma ciudad o sin ciudad, las de siempre", () => {
    expect(zonasDelDia([], "Pharr", "McAllen")).toEqual([]);
    expect(zonasDelDia(["Pharr"], "Pharr", "pharr")).toEqual(["Pharr"]);
    expect(zonasDelDia(["Pharr"], "Pharr", "")).toEqual(["Pharr"]);
  });
  it("`ajustesDelDia`: la fila de ese día lleva la base y las zonas de la salida; las demás, iguales; sin nada elegido, las mismas", () => {
    const d = ajustesDelDia(AJUSTES, USUARIOS, DEL_DIA[DIA], TIENDAS);
    expect(d.filas.find((f) => f.profile_id === "a")).toMatchObject({ base_store: "McAllen", preferred_zones: ["Edinburg", "McAllen"] });
    expect(d.filas.find((f) => f.profile_id === "b")).toEqual(AJUSTES[1]);
    expect(d.fin.size).toBe(0);
    expect(AJUSTES[0].base_store).toBe("Pharr");           // no toca lo que recibe
    expect(ajustesDelDia(AJUSTES, USUARIOS, {}, TIENDAS).filas).toEqual(AJUSTES);
    // Un fin distinto de la salida va aparte, por id.
    expect([...ajustesDelDia(AJUSTES, USUARIOS, { a: { salida: "McAllen", fin: "Pharr" } }, TIENDAS).fin]).toEqual([["a", "Pharr"]]);
  });
  it("un chofer SIN fila de Ajustes al que se le elige salida entra con los valores de partida; uno que no rutea, sigue sin rutear", () => {
    const d = ajustesDelDia(AJUSTES, USUARIOS, { c: { salida: "McAllen", fin: null } }, TIENDAS);
    expect(d.filas.find((f) => f.profile_id === "c")).toMatchObject({ base_store: "McAllen", routable: true, returns_to_base: true });
    const quieto = ajustesDelDia([fila("a", "Pharr", [], { routable: false })], USUARIOS, { a: { salida: "McAllen", fin: null } }, TIENDAS);
    expect(quieto.filas[0]).toMatchObject({ base_store: "McAllen", routable: false });
  });
});

// =====================================================================================================================
describe("4 · el motor: «Armar rutas» y «Asignar a…» salen de la tienda del día y vuelven a la del fin", () => {
  const ordenes = [
    { id: "o1", order_code: "#1", stage: "approved", store: "McAllen", pickup_name: "McAllen", delivery_address: "10 Uno St, McAllen, TX 78501", delivery_lat: 26.25, delivery_lng: -98.25 },
    { id: "o2", order_code: "#2", stage: "approved", store: "Pharr", pickup_name: "Pharr", delivery_address: "20 Dos St, Pharr, TX 78577", delivery_lat: 26.2, delivery_lng: -98.19 },
  ].map((o) => ({
    order_type: "Customer", delivery_name: "Cliente", delivery_windows: null, est_pallets: 1, actual_pallets: null, pickup_duration: "10", delivery_duration: "10",
    assigned_driver: null, input_date: "2026-10-10", input_time: "0800", account: null, customer_type: null, is_training: false, updated_at: "2026-10-10T08:00:00Z", ...o,
  })) as unknown as DatosDelDia["ordenes"];
  const datos = (fecha: string, extra: Partial<DatosDelDia> = {}): DatosDelDia => ({
    ordenes, choferes: USUARIOS, ajustesDeChofer: AJUSTES, settings: { stores: TIENDAS, order_type_rules: { Customer: { storeToStore: false } } } as unknown as DatosDelDia["settings"],
    basesDelDia: DEL_DIA[fecha], ...extra,
  });
  const chofer = (fecha: string, id: string, extra: Partial<DatosDelDia> = {}) => entradaDelDia(datos(fecha, extra)).entrada.choferes.find((c) => c.id === id)!;

  it("el caso del dueño: el 12 «A» sale de McAllen (y no lleva fin aparte: termina donde sale); el 13, de su base", () => {
    expect(chofer(DIA, "a")).toMatchObject({ base: "tienda:mcallen", zonas: ["Edinburg", "McAllen"] });
    expect(chofer(DIA, "a").fin).toBeUndefined();
    expect(chofer(OTRO_DIA, "a")).toMatchObject({ base: "tienda:pharr", zonas: ["Pharr", "Edinburg"] });
    // Sin nada del día la entrada es la de siempre, byte a byte.
    expect(entradaDelDia(datos(OTRO_DIA))).toEqual(entradaDelDia({ ...datos(OTRO_DIA), basesDelDia: undefined }));
  });
  it("con un fin distinto, el chofer lleva `fin` (su punto, en la matriz); sin vuelta a base, no", () => {
    const d = { basesDelDia: { a: { salida: "McAllen", fin: "Brownsville" } } };
    expect(chofer(DIA, "a", d)).toMatchObject({ base: "tienda:mcallen", fin: "tienda:brownsville" });
    expect(entradaDelDia(datos(DIA, d)).puntos["tienda:brownsville"]).toEqual({ lat: 25.93, lng: -97.49 });
    expect(chofer(DIA, "a", { ...d, ajustesDeChofer: [fila("a", "Pharr", [], { returns_to_base: false }), AJUSTES[1]] }).fin).toBeUndefined();
    // Un fin en una tienda sin punto no vale: vuelve a la base (la del día).
    expect(chofer(DIA, "a", { basesDelDia: { a: { salida: "McAllen", fin: "Bodega sin punto" } } }).fin).toBeUndefined();
  });
  it("la zona: el 12, recoger en McAllen NO le cuesta a «A» la punta cara de D-479; el 13, sí (McAllen es de «B»)", () => {
    const e12 = entradaDelDia(datos(DIA)), e13 = entradaDelDia(datos(OTRO_DIA));
    const o1 = (e: typeof e12) => e.entrada.ordenes.find((o) => o.id === "o1")!;
    const a = (e: typeof e12) => e.entrada.choferes.find((c) => c.id === "a")!;
    expect(o1(e12).zonaRecogida).toBe("McAllen");
    expect(recogidaFueraDeZona(a(e12), o1(e12), zonasReclamadas(e12.entrada.choferes))).toBe(0);
    expect(recogidaFueraDeZona(a(e13), o1(e13), zonasReclamadas(e13.entrada.choferes))).toBe(1);
  });
  it("la vuelta va a donde TERMINA (`evaluaRuta`): sin fin, a la base; con fin, al fin; si no vuelve, a ningún sitio", () => {
    const orden: OrdenEntrada = { id: "x", origen: "a", destino: "b", pallets: 1, ventana: null, servicioRecogidaMin: 0, servicioEntregaMin: 0 };
    const matriz = { a: { b: { minutos: 10, millas: 5 }, c: { minutos: 50, millas: 25 } }, b: { a: { minutos: 10, millas: 5 }, c: { minutos: 30, millas: 15 } }, c: { a: { minutos: 50, millas: 25 }, b: { minutos: 30, millas: 15 } } };
    const ctx = { ordenes: new Map([["x", orden]]), matriz, parametros: PARAMETROS_POR_DEFECTO };
    const c: ChoferEntrada = { id: "a", nombre: "A", base: "a", capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true };
    const paradas = [{ orden: "x", tipo: "P" as const }, { orden: "x", tipo: "D" as const }];
    expect(evaluaRuta(c, paradas, ctx).manejoMin).toBe(20);
    expect(evaluaRuta({ ...c, fin: "c" }, paradas, ctx).manejoMin).toBe(40);
    expect(evaluaRuta({ ...c, fin: "c" }, paradas, ctx).millas).toBe(20);
    expect(evaluaRuta({ ...c, fin: "c", vuelveABase: false }, paradas, ctx).manejoMin).toBe(10);
    // Y el tráfico del plan pide ESE tramo, el de la vuelta al fin.
    const plan = { rutas: [{ chofer: "a", paradas: [{ punto: "a", salida: 490 }, { punto: "b", salida: 500 }] }] } as unknown as Parameters<typeof tramosDelPlan>[0];
    expect(tramosDelPlan(plan, { choferes: [{ ...c, fin: "c" }] }).at(-1)).toMatchObject({ a: "b", b: "c" });
    expect(tramosDelPlan(plan, { choferes: [c] }).at(-1)).toMatchObject({ a: "b", b: "a" });
  });
  it("«Armar rutas» (`planificaElDia`): el 12 el plan guarda a «A» saliendo de McAllen; el 13, de Pharr; y con otro fin, con él", async () => {
    const plan = async (fecha: string, extra: Partial<DatosDelDia> = {}) =>
      planificaElDia(datos(fecha, extra), fecha, "America/Chicago", { cache: cacheEnMemoria(), proveedores: [proveedorEstimado()], ahoraISO: "2026-10-11T12:00:00Z" });
    const el12 = await plan(DIA), el13 = await plan(OTRO_DIA);
    const a = (b: Awaited<ReturnType<typeof plan>>) => b.plan.input.entrada.choferes.find((c) => c.id === "a")!;
    expect(a(el12).base).toBe("tienda:mcallen");
    expect(a(el13).base).toBe("tienda:pharr");
    // Con otro fin, el plan lo guarda con él (lo que cuesta la vuelta al fin lo fija `evaluaRuta`, arriba), y su punto entra
    // en la matriz que se pidió.
    const conFin = await plan(DIA, { basesDelDia: { a: { salida: "McAllen", fin: "Brownsville" } } });
    expect(a(conFin).fin).toBe("tienda:brownsville");
    expect(conFin.plan.input.entrada.matriz["tienda:mcallen"]?.["tienda:brownsville"]).toBeTruthy();
  });
  it("«Asignar a…» varios (D-474): el punto del fin entra en lo que se mide (`puntosDelReparto`)", () => {
    const e = entradaDelDia(datos(DIA, { basesDelDia: { a: { salida: "McAllen", fin: "Brownsville" } } }));
    const p = puntosDelReparto({ ordenes: [], choferes: e.entrada.choferes.filter((c) => c.id === "a") }, e.puntos);
    expect(Object.keys(p).sort()).toEqual(["tienda:brownsville", "tienda:mcallen"]);
  });
  it("el servidor de «Armar rutas» lee lo del día (`leeBasesDelDia`) y se lo pasa al motor; si falla por otra cosa que la tabla, NO planifica", () => {
    const ruta = plano(leer("src/app/api/route-plan/route.ts"));
    expect(ruta).toContain("const bases = await leeBasesDelDia(supabase as unknown as ClienteDeBasesDelDia, fecha);");
    expect(ruta).toContain('if (bases.fuente === "error") return { ok: false, respuesta: NextResponse.json({ error: "Could not read the drivers\' start/end stores for the day.", detail: bases.detalle }, { status: 500 }) };');
    expect(ruta).toContain('basesDelDia: bases.fuente === "base" ? bases.bases : {},');
    const entrada = plano(leer("src/lib/route-plan/entrada.ts"));
    expect(entrada).toContain("const delDia = ajustesDelDia(datos.ajustesDeChofer, datos.choferes, datos.basesDelDia, tiendas);");
    expect(entrada).toContain("const filaDe = new Map(delDia.filas.map((f) => [f.profile_id, f]));");
  });
});

// =====================================================================================================================
describe("5 · el Gestor: la medida, el Optimizar, «Mejor lugar» y el mapa usan la salida y el fin del día", () => {
  it("la medida (`cuerpoDeLaMedida`): sin fin, ida y vuelta; con otro, una parada `__fin__` al final y sin vuelta; con `null`, sin vuelta", () => {
    const paradas = [{ id: "o1", lat: 26.25, lng: -98.25 }];
    const base: [number, number] = [26.22, -98.23];
    expect(cuerpoDeLaMedida(paradas, base, DIA)).toMatchObject({ roundtrip: true, stops: [{ id: "__depot__" }, { id: "o1" }] });
    expect(cuerpoDeLaMedida(paradas, base, DIA, base)).toMatchObject({ roundtrip: true });
    const conFin = cuerpoDeLaMedida(paradas, base, DIA, [25.93, -97.49]);
    expect(conFin.roundtrip).toBe(false);
    expect(conFin.stops.map((s) => s.id)).toEqual(["__depot__", "o1", "__fin__"]);
    expect(conFin.stops[2]).toEqual({ id: "__fin__", lat: 25.93, lng: -97.49 });
    expect(cuerpoDeLaMedida(paradas, base, DIA, null)).toMatchObject({ roundtrip: false, stops: [{ id: "__depot__" }, { id: "o1" }] });
    // Sin base, nada cambia: abierta, sin fin.
    expect(cuerpoDeLaMedida(paradas, null, DIA, [25.93, -97.49]).stops.map((s) => s.id)).toEqual(["o1"]);
  });
  it("`mideLaLista` pide con ese cuerpo, y la hora de acabar cuenta la vuelta al fin (y nada si no vuelve)", async () => {
    const pedidos: unknown[] = [];
    const pide = async (_url: string, init: RequestInit) => { pedidos.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ miles: 30, duration_seconds: 3600, legs: [600, 1200, 1800] }) }; };
    const comun = { lista: [{ tipo: "D" as const, orden: "o1" }, { tipo: "D" as const, orden: "o2" }], ordenes: [{ id: "o1", delivery_lat: 26.25, delivery_lng: -98.25, delivery_duration: "1" }, { id: "o2", delivery_lat: 26.3, delivery_lng: -98.3, delivery_duration: "1" }], base: [26.22, -98.23] as [number, number], coordsDeTienda: () => null, fecha: DIA, pide };
    const conFin = await mideLaLista({ ...comun, fin: [25.93, -97.49] });
    expect((pedidos[0] as { stops: { id: string }[] }).stops.map((s) => s.id)).toEqual(["__depot__", "o1", "o2", "__fin__"]);
    // 08:00 + 10 + 1 (descarga) + 20 + 1 + 30 de la vuelta al fin.
    expect(conFin.medida.stat?.end).toBe("09:02");
    const sinVuelta = await mideLaLista({ ...comun, fin: null });
    expect((pedidos[1] as { roundtrip: boolean }).roundtrip).toBe(false);
    expect(sinVuelta.medida.stat?.end).toBe("08:32");
  });
  it("cambiar la salida o el fin es OTRA forma de la ruta: se vuelve a medir", () => {
    const stops = [{ id: "o1" }], lista = [{ tipo: "D" as const, orden: "o1" }];
    expect(firmaDeLaForma(DIA, "Chofer A", stops, lista, "Pharr>Pharr")).not.toBe(firmaDeLaForma(DIA, "Chofer A", stops, lista, "McAllen>McAllen"));
    expect(firmaDeLaForma(DIA, "Chofer A", stops, lista, "McAllen>McAllen")).not.toBe(firmaDeLaForma(DIA, "Chofer A", stops, lista, "McAllen>Pharr"));
    const hook = plano(leer("src/lib/usa-medida-de-rutas.ts"));
    expect(hook).toContain("const firmaDe = (clave: string, stops: T[]): string => firmaDeLaForma(date, clave, stops, e.listaDe(clave, stops), extremosDe(clave));");
    expect(hook).toContain("const extremosDe = (laneKey: string): string => `${tiendaBaseDe(laneKey)?.name ?? \"\"}>${tiendaDelFin(laneKey)?.name ?? \"·\"}`;");
    // Y como cambiar la salida no cambia las paradas, los efectos que miden miran los extremos.
    expect(hook.split(", extremosAhora]);").length - 1).toBe(3);
  });
  it("la medida del Gestor sale de la tienda del día y vuelve a la del fin (`mideLaRuta`)", () => {
    const hook = plano(leer("src/lib/usa-medida-de-rutas.ts"));
    const mide = trozo("const mideLaRuta = async", "const pintaLaMedida =", hook);
    expect(mide).toContain("const tiendaFin = tiendaDelFin(laneKey), finC = finDeLaRuta(laneKey);");
    expect(mide).toContain("base: depot, fin: depot ? fin : undefined,");
    expect(hook).toContain("const tiendaDelFin = (laneKey: string): NamedLocation | null => (!tiendaBaseDe(laneKey) ? null : e.tiendaFinDe ? e.tiendaFinDe(laneKey) : tiendaBaseDe(laneKey));");
  });
  it("Optimizar: el fin entra en la entrada y en los puntos que se piden por calles", () => {
    const e = entradaDeOptimizar({ lista: [], ordenes: [], base: { lat: 1, lng: 1 }, fin: { lat: 2, lng: 2 }, capacidad: 10, coordsDeTienda: () => null, esEstrecha: () => false, salidaMin: 480 });
    expect(e.fin).toEqual({ lat: 2, lng: 2 });
    expect(puntosDeLaEntrada(e)).toEqual([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]);
    expect("fin" in entradaDeOptimizar({ lista: [], ordenes: [], base: { lat: 1, lng: 1 }, capacidad: 10, coordsDeTienda: () => null, esEstrecha: () => false, salidaMin: 480 })).toBe(false);
  });
  it("«📍 Mejor lugar» (en línea recta): la vuelta va al fin, y eso cambia las millas", () => {
    const base = { lat: 26.22, lng: -98.23 }, fin = { lat: 25.93, lng: -97.49 };
    const viajes = [[{ id: "o1", lat: 26.25, lng: -98.25, pallets: 1, ventana: null, servicioMin: 0 }]];
    expect(costeDeLaRuta(viajes, base, 480, fin).millas).toBeGreaterThan(costeDeLaRuta(viajes, base, 480).millas + 30);
    expect(costeDeLaRuta(viajes, base, 480, null).millas).toBeLessThan(costeDeLaRuta(viajes, base, 480).millas);
    // Con el fin lejos, la orden nueva que queda de camino al fin va al final.
    const nueva = { id: "n", lat: 26.0, lng: -97.6, pallets: 1, ventana: null, servicioMin: 0 };
    const r = mejorLugar({ viajes, nueva, base, fin, capacidad: 10, inicioMin: 480 });
    expect(r.ok && r.hueco.puesto).toBe(1);
  });
  it("el mapa: la «P» en la tienda de la que sale; y si termina en otra, su marca «F» en ella", () => {
    const carriles: CarrilDeRuta[] = [{ id: "a", key: "Chofer A", label: "Chofer A", driver: "Chofer A", isBucket: false } as unknown as CarrilDeRuta];
    const comun = {
      carriles, porChofer: new Map([["Chofer A", [{ id: "o1", delivery_lat: 26.25, delivery_lng: -98.25 }]]]), delDia: [], hechas: new Map(), pasaFiltro: () => true, soloUnChofer: false,
      enfocado: false, atenuada: () => false, colorDe: () => "#123456", colorSinChofer: "#999", coordsDeTienda: () => null, t: (en: string) => en,
      paradasDe: () => [], baseDe: () => ({ coords: [26.22, -98.23] as [number, number], direccion: "McAllen" }),
    } as unknown as Parameters<typeof puntosDeLasRutas>[0];
    const conFin = puntosDeLasRutas({ ...comun, finDe: () => ({ coords: [25.93, -97.49], direccion: "Brownsville" }) });
    expect(conFin.filter((p) => p.badge === "P").map((p) => [p.lat, p.lng])).toEqual([[26.22, -98.23]]);
    expect(conFin.filter((p) => p.badge === "F").map((p) => [p.id, p.lat, p.lng, p.label])).toEqual([["__fin__a", 25.93, -97.49, "Ends the day here (Chofer A) — Brownsville"]]);
    // Termina donde sale: sin «F».
    expect(puntosDeLasRutas({ ...comun, finDe: () => ({ coords: [26.22, -98.23], direccion: "McAllen" }) }).some((p) => p.badge === "F")).toBe(false);
    expect(puntosDeLasRutas(comun).some((p) => p.badge === "F")).toBe(false);
  });
});

// =====================================================================================================================
describe("6 · la pantalla usa cada pieza (se alimenta de quien llama)", () => {
  it("lee lo del día que se mira (`useBasesDelDia`) y decide los extremos de cada ruta con `extremosDeLaRuta`", () => {
    expect(pagina).toContain('const basesDelDia = useBasesDelDia(date, modo === "dia");');
    expect(pagina).toContain('const basesDelDiaPorNombre = useMemo(() => (modo === "dia" ? basesPorNombreDelDia(basesDelDia.bases, users) : new Map<string, BaseDelDia>()), [basesDelDia.bases, users, modo]);');
    expect(pagina).toContain("const extremosDe = (laneKey: string) => extremosDeLaRuta(driverOf(laneKey), { delDia: basesDelDiaPorNombre, deAjustes: basesDeChofer, usuarios: users, noVuelven, tiendas: settings.stores ?? [] });");
    expect(pagina).toContain("const tiendaBaseDe = (laneKey: string) => extremosDe(laneKey).salida?.tienda ?? null;");
    expect(pagina).toContain("const tiendaFinDe = (laneKey: string) => extremosDe(laneKey).fin?.tienda ?? null;");
    expect(pagina).toContain('return new Set(ajustesDeChofer.filter((f) => f.returns_to_base === false).map((f) => nombreDe.get(f.profile_id) ?? "").filter(Boolean));');
  });
  it("la medida recibe el fin; Optimizar, «Mejor lugar» y el horario le pasan el fin; «Asignar a…», lo del día; el mapa, la «F»", () => {
    expect(pagina).toContain("tiendaBaseDe, coordsDeTienda, // Dónde termina cada ruta ese día (166): la vuelta va ahí. Cambiar la salida o el fin vuelve a medir esa ruta. tiendaFinDe,");
    expect(pagina).toContain("const finParaEstimar = (laneKey: string): { lat: number; lng: number } | null | undefined => (tiendaFinDe(laneKey) ? finDeLaRuta(laneKey) ?? undefined : null);");
    expect(trozo("const optimizaLaRuta = async (laneKey: string) => {", "// Friendly display name for a lane key.")).toContain("lista, ordenes: stops, base, fin: finParaEstimar(laneKey),");
    expect(pagina).toContain("mejorLugar({ viajes: [entregas.map(aParada)], nueva: aParada(d), base, fin: finParaEstimar(laneKey),");
    expect(pagina).toContain("base: baseDeLaRuta(l.key), fin: finParaEstimar(l.key),");
    expect(trozo("const diaParaElMotor = useMemo(() => {", "const choferesDelReparto")).toContain("basesDelDia: basesDelDia.bases,");
    expect(pagina).toContain("finDe: (clave) => { const tienda = tiendaFinDe(clave), fin = finDeLaRuta(clave); return tienda && fin ? { coords: [fin.lat, fin.lng], direccion: tienda.name } : null; },");
    expect(plano(leer("src/lib/arrastre-de-paradas.ts"))).toContain("mejorLugar({ viajes: sin, nueva: laMovida, base: dest.base, fin: dest.fin,");
  });
  it("el panel: cada chofer con su «Sale de · Termina en»; solo admin y logística lo cambian, viendo UN día; los sin órdenes, plegados debajo", () => {
    expect(pagina).toContain("extremosDe={(clave) => (isRealDriver(driverOf(clave)) ? baseDelDiaDe(driverOf(clave)) : null)}");
    expect(pagina).toContain('const puedeElegirBase = !soloLectura && modo === "dia" && !!me && ["admin", "logistics"].includes(me.role);');
    expect(pagina).toContain("const choferesSinRutaHoy = drivers.filter((d) => !filasDelPanel.some((u) => u.key === d.full_name));");
    expect(pagina).toContain("pie={puedeElegirBase && choferesSinRutaHoy.length > 0 ? (");
    const cambia = trozo("const cambiaBaseDelDia = async", "/** «Sale de · Termina en» de un chofer");
    expect(cambia).toContain("const nueva = baseTrasElCambio(basesDelDiaPorNombre.get(chofer), cambio, ex.base?.tienda ?? null);");
    expect(cambia).toContain("const r = await basesDelDia.guarda(perfil.id, nueva);");
    expect(pagina).toContain("<BaseDelDiaDelChofer t={t} extremos={extremosDe(chofer)} tiendas={settings.stores ?? []} editable={puedeElegirBase}");
  });
  it("la tarjeta: la fila del regreso dice dónde TERMINA ese día («Termina en …»), o que no vuelve", () => {
    const fila = trozo("const finDeLaFila = (laneKey: string)", "/** La clave de una fila de la lista");
    expect(fila).toContain("const fin = tiendaFinDe(laneKey);");
    expect(fila).toContain('if (!fin) return { otra: true, texto: t("(doesn’t return to base: the route ends at its last stop)", "(no vuelve a base: la ruta acaba en su última parada)") };');
    expect(fila).toContain('finDeLaFila(laneKey)?.otra ? t("Ends at", "Termina en") : t("Base: returns", "Base: regreso")');
    expect(fila).toContain('const direccion = (cual === "regreso" ? finDeLaFila(laneKey)?.texto : null) ?? pickupAddressFor(laneKey) ??');
  });
  it("sin la 166 el selector se apaga y dice por qué; la lectura en el navegador es `leeBasesDelDia`, y el demo lo guarda en la pestaña (`sessionStorage`)", () => {
    expect(pagina).toContain('if (basesDelDia.fuente === "sin_tabla") return t("Needs migration 166 (driver_day_bases)');
    const hook = plano(leer("src/lib/usa-base-del-dia.ts"));
    expect(hook).toContain("const r = await leeBasesDelDia(cliente(), fecha);");
    expect(hook).toContain("const r = await guardaBaseDelDia(cliente(), fecha, choferId, nueva);");
    expect(hook).toContain('if (LOCAL_MODE) return { bases: { ...(leeDelDemo()[fecha] ?? {}) }, fuente: "demo" };');
  });
});

// =====================================================================================================================
describe("7 · el selector, pintado", () => {
  const t = (_en: string, es: string) => es;
  const extremos = extremosDelChofer({ delDia: { salida: "McAllen", fin: null }, deAjustes: "Pharr", tiendas: TIENDAS });
  it("en el Gestor: dos selectores con lo elegido; la salida cambiada, resaltada; el clic no sube a la fila", () => {
    const html = renderToStaticMarkup(createElement(BaseDelDiaDelChofer, { t, extremos, tiendas: TIENDAS, editable: true }));
    expect(html).toContain('data-base-del-dia="selector"');
    expect(html).toMatch(/<select data-sale-de="true"[^>]*>/);
    expect(html).toContain('<option value="McAllen" selected="">McAllen</option>');
    expect(html).toContain('<option value="">Pharr (su base)</option>');
    expect(html).toContain('<option value="" selected="">McAllen (como la salida)</option>');
    expect(html).toContain("Cambiada solo para este día. Su base: Pharr.");
    expect(html).toContain('<option value="Bodega sin punto" disabled="">');
    // Apagado, con su porqué.
    expect(renderToStaticMarkup(createElement(BaseDelDiaDelChofer, { t, extremos, tiendas: TIENDAS, editable: true, apagado: "Falta la migración 166" }))).toContain('title="Falta la migración 166"');
    // Sin vuelta a base, «no vuelve» en vez del selector del fin.
    const noVuelve = extremosDelChofer({ deAjustes: "Pharr", vuelve: false, tiendas: TIENDAS });
    const h2 = renderToStaticMarkup(createElement(BaseDelDiaDelChofer, { t, extremos: noVuelve, tiendas: TIENDAS, editable: true }));
    expect(h2).toContain("data-no-vuelve");
    expect(h2).not.toContain("data-termina-en");
  });
  it("en «Ruta de hoy» (D-481): solo se lee, sin selector", () => {
    const html = renderToStaticMarkup(createElement(BaseDelDiaDelChofer, { t, extremos, tiendas: TIENDAS, editable: false }));
    expect(html).toContain('data-base-del-dia="lectura"');
    expect(html).not.toContain("<select");
    expect(html).toContain("Sale de McAllen");
    expect(html).toContain("Termina en McAllen");
  });
  it("el panel lo pinta en cada fila, y debajo lo de los choferes sin órdenes", () => {
    const html = renderToStaticMarkup(createElement(PanelDeChoferes, {
      t, filas: [{ id: "a", clave: "Chofer A", etiqueta: "Chofer A", color: "#123", paradas: 2, carga: { pallets: 1, cap: 10, pct: 10, over: false }, marcada: true, enVivo: false }],
      onEnfoca: () => {}, onAlterna: () => {}, todas: true, onAlternaTodas: () => {}, vacio: "", sinRutas: false,
      extremosDe: (clave: string) => createElement("span", { "data-prueba-extremos": clave }), pie: createElement("div", { "data-prueba-pie": "1" }),
    }));
    expect(html).toContain('data-prueba-extremos="Chofer A"');
    expect(html).toContain('data-prueba-pie="1"');
  });
});

// =====================================================================================================================
describe("8 · la base de datos: `driver_day_bases` (166), y sin ella todo como siempre", () => {
  function cliente(o: { filas?: FilaDeBaseDelDia[]; error?: { code?: string; message?: string } | null }) {
    const llamadas: { op: string; args: unknown[] }[] = [];
    const respuesta = <T>(data: T) => Promise.resolve({ data: o.error ? null : data, error: o.error ?? null });
    const c: ClienteDeBasesDelDia = {
      from: (tabla: string) => {
        llamadas.push({ op: "from", args: [tabla] });
        return {
          select: (col: string) => ({ eq: (k: string, v: string) => { llamadas.push({ op: "select", args: [col, k, v] }); return respuesta(o.filas ?? []); } }),
          upsert: (fila: FilaDeBaseDelDia, op: { onConflict: string }) => { llamadas.push({ op: "upsert", args: [fila, op] }); return respuesta(null); },
          delete: () => ({ eq: (k1: string, v1: string) => ({ eq: (k2: string, v2: string) => { llamadas.push({ op: "delete", args: [k1, v1, k2, v2] }); return respuesta(null); } }) }),
        };
      },
    };
    return { c, llamadas };
  }
  it("lee UN día; las filas, por chofer; una fila sin nada que decir no cuenta", async () => {
    const { c, llamadas } = cliente({ filas: [
      { plan_date: DIA, driver_id: "a", start_store: "McAllen", end_store: null }, { plan_date: DIA, driver_id: "b", start_store: " ", end_store: null },
    ] });
    expect(await leeBasesDelDia(c, DIA)).toEqual({ fuente: "base", bases: { a: { salida: "McAllen", fin: null } } });
    expect(llamadas).toEqual([{ op: "from", args: [TABLA_DE_BASES_DEL_DIA] }, { op: "select", args: ["plan_date, driver_id, start_store, end_store", "plan_date", DIA] }]);
    expect(basesDeFilas([{ plan_date: DIA, driver_id: "a", start_store: null, end_store: "Pharr " }])).toEqual({ a: { salida: null, fin: "Pharr" } });
  });
  it("sin la tabla (la 166 sin aplicar): «sin_tabla»; cualquier otro fallo es un fallo, y se dice", async () => {
    expect(await leeBasesDelDia(cliente({ error: { code: "PGRST205", message: "Could not find the table 'public.driver_day_bases'" } }).c, DIA)).toEqual({ fuente: "sin_tabla" });
    expect(await leeBasesDelDia(cliente({ error: { code: "42P01" } }).c, DIA)).toEqual({ fuente: "sin_tabla" });
    expect(await leeBasesDelDia(cliente({ error: { code: "42501", message: "permission denied" } }).c, DIA)).toEqual({ fuente: "error", detalle: "permission denied" });
    expect(faltaLaTablaDeBases({ message: 'relation "driver_day_bases" does not exist' })).toBe(true);
    expect(faltaLaTablaDeBases({ message: 'relation "route_locks" does not exist' })).toBe(false);
  });
  it("guardar: con algo, UNA fila por chofer y día (upsert); «lo de siempre», se BORRA", async () => {
    const { c, llamadas } = cliente({});
    expect(await guardaBaseDelDia(c, DIA, "a", { salida: "McAllen", fin: null })).toEqual({ ok: true });
    expect(llamadas[1]).toEqual({ op: "upsert", args: [{ plan_date: DIA, driver_id: "a", start_store: "McAllen", end_store: null }, { onConflict: "plan_date,driver_id" }] });
    expect(await guardaBaseDelDia(c, DIA, "a", null)).toEqual({ ok: true });
    expect(llamadas[3]).toEqual({ op: "delete", args: ["plan_date", DIA, "driver_id", "a"] });
    expect(await guardaBaseDelDia(cliente({ error: { code: "PGRST205" } }).c, DIA, "a", null)).toMatchObject({ ok: false, faltaLaTabla: true });
  });
  it("la migración 166: una tabla con salida y fin en la MISMA fila (chofer + fecha), RLS por comando, escriben admin y logística, el chofer lee lo suyo", () => {
    const sql = leer("supabase/migrations/166_base_del_dia.sql");
    const codigo = plano(sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"));
    expect(codigo).toContain("create table if not exists public.driver_day_bases ( plan_date date not null, driver_id uuid not null references public.profiles(id) on delete cascade, start_store text, end_store text,");
    expect(codigo).toContain("constraint driver_day_bases_pkey primary key (plan_date, driver_id)");
    expect(codigo).toContain("constraint driver_day_bases_algo check (start_store is not null or end_store is not null)");
    expect(codigo).toContain("using (driver_id = (select auth.uid()) or ((select public.has_deliveries_access()) and (select public.current_user_role()) <> 'driver'));");
    expect(codigo.split("(select public.current_user_role()) in ('admin', 'logistics')").length - 1).toBe(4);
    expect(codigo).toContain("revoke all on public.driver_day_bases from anon, authenticated;");
    expect(codigo).not.toMatch(/create policy[^;]*\bfor all\b/i);
    expect(codigo).not.toMatch(/^\s*(begin|commit)\s*;/im);
    // Sin el marcador de la decisión dentro: numerarlo al fusionar cambiaría el checksum (D-512).
    expect(sql).not.toContain("D-519");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    // La fila del registro, con el checksum de su cuerpo (el de `migrate-status --sum`).
    expect(registro).toContain(`('166_base_del_dia.sql', '${createHash("sha256").update(cuerpo, "utf8").digest("hex")}')`);
  });
});
