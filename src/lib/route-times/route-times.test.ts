import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluaPlan, planifica, PARAMETROS_POR_DEFECTO, bloqueDe, type ChoferEntrada, type Entrada, type OrdenEntrada, type Tramo } from "@/lib/route-engine";
import { CADUCIDAD_DIAS, SIN_BLOQUE, SIN_DIA, claveDePunto, claveSinTrafico, diaDeLaSemana, puntoDeClave, textoDeClave, type LatLng } from "./claves";
import {
  FACTOR_DE_RODEO, MAX_ELEMENTOS_POR_PETICION, MILLAS_POR_HORA_ESTIMADAS, millasEnLineaRecta, proveedorEstimado, proveedorGoogle, proveedorOSRM,
  type FetchFn, type ProveedorDeTiempos,
} from "./proveedores";
import {
  MAX_VUELTAS_DE_TRAFICO, PRESUPUESTO_POR_DEFECTO, cacheEnMemoria, estaVigente, instanteLocalISO, matrizBase, planificaConTrafico, traficoDeTramos,
  tramosDelPlan, type FilaDeCache,
} from "./tiempos";
import { cacheEnSupabase } from "./cache-supabase";

/**
 * Tiempos de viaje del motor de rutas (D-318). **Ninguna prueba llama a un servicio de verdad:** `fetch` es
 * un doble que apunta lo que se le pide, y los proveedores de las pruebas de la matriz ni siquiera usan
 * `fetch`. Coordenadas inventadas.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const AHORA = "2026-03-02T12:00:00.000Z";     // lunes
const ZONA = "America/Chicago";
const P: Record<string, LatLng> = { tienda: { lat: 26.2, lng: -98.2 }, a: { lat: 26.3, lng: -98.1 }, b: { lat: 26.25, lng: -98.3 } };

/** Un proveedor de mentira que apunta cada pregunta. `minutos` decide qué contesta. */
function doble(nombre: ProveedorDeTiempos["nombre"], opciones: { conTrafico?: boolean; falla?: boolean; minutos?: (o: LatLng, d: LatLng, salida?: string) => number } = {}) {
  const pedidos = { elementos: 0, peticionesDeMatriz: 0, tramos: [] as (string | undefined)[] };
  const t = (o: LatLng, d: LatLng, s?: string): Tramo => ({ minutos: opciones.minutos?.(o, d, s) ?? 10, millas: 6 });
  const p: ProveedorDeTiempos = {
    nombre, conTrafico: opciones.conTrafico ?? false,
    async matriz(os, ds) { if (opciones.falla) throw new Error("caído"); pedidos.peticionesDeMatriz++; pedidos.elementos += os.length * ds.length; return os.map((o) => ds.map((d) => t(o, d))); },
    async tramo(o, d, s) { if (opciones.falla) throw new Error("caído"); pedidos.tramos.push(s); return t(o, d, s); },
  };
  return { p, pedidos };
}

describe("las claves de la caché", () => {
  it("un punto es lat,lng a 5 decimales, y se puede volver atrás", () => {
    expect(claveDePunto({ lat: 26.2034567, lng: -98.2300001 })).toBe("26.20346,-98.23000");
    expect(puntoDeClave("26.20346,-98.23000")).toEqual({ lat: 26.20346, lng: -98.23 });
    expect(puntoDeClave("no es un punto")).toBeNull();
  });

  it("el día de la semana sale de las partes de la fecha, no de la zona de la máquina; una fecha imposible no es ningún día", () => {
    expect(diaDeLaSemana("2026-03-01")).toBe(0);   // domingo
    expect(diaDeLaSemana("2026-03-02")).toBe(1);
    expect(diaDeLaSemana("2026-03-07")).toBe(6);
    expect(diaDeLaSemana("2026-02-31")).toBeNull();
    expect(diaDeLaSemana("02/03/2026")).toBeNull();
  });

  it("sin tráfico no hay día ni bloque; el bloque es la media hora de salida", () => {
    expect(claveSinTrafico("x", "y")).toEqual({ origen: "x", destino: "y", dia: SIN_DIA, bloque: SIN_BLOQUE, trafico: false });
    expect([SIN_DIA, SIN_BLOQUE]).toEqual([-1, -1]);
    expect([bloqueDe(480), bloqueDe(509), bloqueDe(510), bloqueDe(0), bloqueDe(1439)]).toEqual([16, 16, 17, 0, 47]);
    expect(textoDeClave({ origen: "x", destino: "y", dia: 1, bloque: 16, trafico: true })).not.toBe(textoDeClave({ origen: "x", destino: "y", dia: 1, bloque: 16, trafico: false }));
  });

  it("caduca a los 90 días sin tráfico y a los 28 con él; lo fechado en el futuro no vale", () => {
    const hace = (dias: number) => new Date(Date.parse(AHORA) - dias * 86400000).toISOString();
    expect(CADUCIDAD_DIAS).toEqual({ sinTrafico: 90, conTrafico: 28 });
    expect(estaVigente({ trafico: false, pedidoEl: hace(90) }, AHORA)).toBe(true);
    expect(estaVigente({ trafico: false, pedidoEl: hace(91) }, AHORA)).toBe(false);
    expect(estaVigente({ trafico: true, pedidoEl: hace(28) }, AHORA)).toBe(true);
    expect(estaVigente({ trafico: true, pedidoEl: hace(29) }, AHORA)).toBe(false);
    expect(estaVigente({ trafico: false, pedidoEl: hace(-1) }, AHORA)).toBe(false);
    expect(estaVigente({ trafico: false, pedidoEl: "ayer" }, AHORA)).toBe(false);
  });
});

describe("la matriz base", () => {
  it("la primera vez se pide todo; la segunda, NADA: sale de la caché", async () => {
    const g = doble("google"), cache = cacheEnMemoria();
    const deps = { cache, proveedores: [g.p, proveedorEstimado()], ahoraISO: AHORA };
    const una = await matrizBase(P, deps);
    expect(una.informe).toEqual({ deCache: 0, pedidos: 6, proveedor: "google", presupuestoAgotado: false });
    expect(g.pedidos.elementos).toBe(6);             // 3 puntos → 6 pares ordenados; nunca la diagonal
    expect(Object.keys(una.matriz.tienda).sort()).toEqual(["a", "b"]);
    const otra = await matrizBase(P, deps);
    expect(otra.informe).toEqual({ deCache: 6, pedidos: 0, proveedor: "cache", presupuestoAgotado: false });
    expect(g.pedidos.elementos).toBe(6);
    expect(otra.matriz).toEqual(una.matriz);
  });

  it("con un punto nuevo se pagan SOLO sus pares, no la matriz entera otra vez", async () => {
    const g = doble("google"), cache = cacheEnMemoria();
    const deps = { cache, proveedores: [g.p], ahoraISO: AHORA };
    await matrizBase(P, deps);
    const r = await matrizBase({ ...P, nuevo: { lat: 26.4, lng: -98.0 } }, deps);
    expect(r.informe.deCache).toBe(6);
    expect(r.informe.pedidos).toBe(6);               // 3 de ida y 3 de vuelta
    expect(g.pedidos.elementos).toBe(12);
  });

  it("una respuesta caducada se vuelve a pedir", async () => {
    const g = doble("google"), cache = cacheEnMemoria();
    await matrizBase(P, { cache, proveedores: [g.p], ahoraISO: AHORA });
    const despues = new Date(Date.parse(AHORA) + 91 * 86400000).toISOString();
    expect((await matrizBase(P, { cache, proveedores: [g.p], ahoraISO: despues })).informe).toMatchObject({ deCache: 0, pedidos: 6 });
  });

  it("si el preferido falla, contesta el respaldo — y lo del respaldo NO se guarda", async () => {
    const g = doble("google", { falla: true }), o = doble("osrm", { minutos: () => 12 }), cache = cacheEnMemoria();
    const r = await matrizBase(P, { cache, proveedores: [g.p, o.p, proveedorEstimado()], ahoraISO: AHORA });
    expect(r.informe.proveedor).toBe("osrm");
    expect(r.matriz.tienda.a.minutos).toBe(12);
    expect(cache.filas.size).toBe(0);
  });

  it("si fallan los dos, la estimación en línea recta — y el informe lo dice para que el plan lo enseñe", async () => {
    const r = await matrizBase(P, { cache: cacheEnMemoria(), proveedores: [doble("google", { falla: true }).p, doble("osrm", { falla: true }).p, proveedorEstimado()], ahoraISO: AHORA });
    expect(r.informe.proveedor).toBe("estimado");
    const millas = Math.round(millasEnLineaRecta(P.tienda, P.a) * FACTOR_DE_RODEO * 100) / 100;
    expect(r.matriz.tienda.a).toEqual({ minutos: Math.round((millas / MILLAS_POR_HORA_ESTIMADAS) * 60), millas });
    // Y con números, no solo con las mismas constantes que usa el código (eso sería un espejo): una
    // carretera es más larga que la línea recta, y a 30 mph una milla son dos minutos.
    expect([FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS]).toEqual([1.3, 30]);
    const recta = millasEnLineaRecta(P.tienda, P.a);
    expect(recta).toBeGreaterThan(9);
    expect(recta).toBeLessThan(10);
    expect(r.matriz.tienda.a.millas).toBeGreaterThan(recta * 1.25);
    expect(r.matriz.tienda.a.minutos).toBe(Math.round(r.matriz.tienda.a.millas * 2));
  });

  it("el tope por corrida: si lo que falta no cabe, el de pago NO se toca y se dice", async () => {
    const g = doble("google"), o = doble("osrm");
    const r = await matrizBase(P, { cache: cacheEnMemoria(), proveedores: [g.p, o.p], ahoraISO: AHORA, presupuesto: { ...PRESUPUESTO_POR_DEFECTO, elementosPorCorrida: 5 } });
    expect(g.pedidos.elementos).toBe(0);
    expect(r.informe).toMatchObject({ proveedor: "osrm", presupuestoAgotado: true, pedidos: 6 });
    // Y justo en el tope, sí cabe.
    const g2 = doble("google");
    await matrizBase(P, { cache: cacheEnMemoria(), proveedores: [g2.p], ahoraISO: AHORA, presupuesto: { ...PRESUPUESTO_POR_DEFECTO, elementosPorCorrida: 6 } });
    expect(g2.pedidos.elementos).toBe(6);
  });

  it("el tope por día cuenta lo que YA se pagó hoy, no lo de ayer ni lo gratis", async () => {
    const fila = (n: number, pedidoEl: string, proveedor: FilaDeCache["proveedor"] = "google"): FilaDeCache =>
      ({ ...claveSinTrafico(`x${n}`, `y${n}`), minutos: 1, millas: 1, proveedor, pedidoEl });
    const hoy = Array.from({ length: 10 }, (_, n) => fila(n, "2026-03-02T01:00:00.000Z"));
    const ayer = Array.from({ length: 50 }, (_, n) => fila(100 + n, "2026-03-01T23:00:00.000Z"));
    const gratis = Array.from({ length: 50 }, (_, n) => fila(200 + n, "2026-03-02T01:00:00.000Z", "osrm"));
    const presupuesto = { ...PRESUPUESTO_POR_DEFECTO, elementosPorDia: 15 };
    const g = doble("google"), o = doble("osrm");
    const r = await matrizBase(P, { cache: cacheEnMemoria([...hoy, ...ayer, ...gratis]), proveedores: [g.p, o.p], ahoraISO: AHORA, presupuesto });
    expect([g.pedidos.elementos, r.informe.presupuestoAgotado]).toEqual([0, true]);   // 10 + 6 > 15
    const g2 = doble("google");
    await matrizBase(P, { cache: cacheEnMemoria([...hoy.slice(0, 9), ...ayer, ...gratis]), proveedores: [g2.p], ahoraISO: AHORA, presupuesto });
    expect(g2.pedidos.elementos).toBe(6);                                                // 9 + 6 = 15
  });

  it("los topes por defecto dejan pasar el día más grande medido (14 órdenes ≈ 17 puntos) y sus tres corridas", () => {
    expect(PRESUPUESTO_POR_DEFECTO.elementosPorCorrida).toBeGreaterThanOrEqual(17 * 16);
    expect(PRESUPUESTO_POR_DEFECTO.elementosPorDia).toBeGreaterThanOrEqual(PRESUPUESTO_POR_DEFECTO.elementosPorCorrida);
    expect(PRESUPUESTO_POR_DEFECTO.tramosPorCorrida).toBeGreaterThanOrEqual(64);
    expect(PRESUPUESTO_POR_DEFECTO.tramosPorDia).toBeGreaterThanOrEqual(3 * 64);
    // Un solo día, por raro que sea, no puede comerse la franja gratuita del mes (10 000 elementos y 5 000
    // tramos). Lo que protege el MES no es este tope sino que casi todo sale de la caché.
    expect(PRESUPUESTO_POR_DEFECTO.elementosPorDia).toBeLessThanOrEqual(10000);
    expect(PRESUPUESTO_POR_DEFECTO.tramosPorDia).toBeLessThanOrEqual(5000);
  });
});

describe("el tráfico, tramo a tramo", () => {
  it("la hora local del negocio, con su cambio de hora", () => {
    expect(instanteLocalISO("2026-01-15", 480, ZONA)).toBe("2026-01-15T14:00:00.000Z");   // invierno: UTC-6
    expect(instanteLocalISO("2026-07-15", 480, ZONA)).toBe("2026-07-15T13:00:00.000Z");   // verano: UTC-5
    expect(instanteLocalISO("2026-07-15", 495, ZONA)).toBe("2026-07-15T13:15:00.000Z");
    expect(instanteLocalISO("2026-02-31", 480, ZONA)).toBeNull();
  });

  it("cada tramo se pide a la MITAD de su media hora y para su día de la semana; los repetidos, una vez", async () => {
    const g = doble("google", { conTrafico: true }), cache = cacheEnMemoria();
    const tramos = [{ a: "tienda", b: "a", salidaMin: 500 }, { a: "tienda", b: "a", salidaMin: 505 }, { a: "a", b: "b", salidaMin: 545 }];
    const r = await traficoDeTramos(tramos, "2026-03-04", P, ZONA, { cache, proveedores: [g.p], ahoraISO: AHORA });
    expect(g.pedidos.tramos.sort()).toEqual(["2026-03-04T14:15:00.000Z", "2026-03-04T15:15:00.000Z"]);   // 08:15 y 09:15 locales
    expect(r.informe).toMatchObject({ pedidos: 2, deCache: 0 });
    expect(Object.keys(r.porHora.tienda.a)).toEqual(["16"]);
    expect([...cache.filas.values()].map((f) => [f.dia, f.bloque, f.trafico]).sort()).toEqual([[3, 16, true], [3, 18, true]]);
  });

  it("otro miércoles a la misma media hora sale de la caché; un jueves, no", async () => {
    const g = doble("google", { conTrafico: true }), cache = cacheEnMemoria();
    const deps = { cache, proveedores: [g.p], ahoraISO: AHORA };
    const t = [{ a: "tienda", b: "a", salidaMin: 500 }];
    await traficoDeTramos(t, "2026-03-04", P, ZONA, deps);
    expect((await traficoDeTramos(t, "2026-03-11", P, ZONA, deps)).informe).toMatchObject({ deCache: 1, pedidos: 0 });
    expect((await traficoDeTramos(t, "2026-03-05", P, ZONA, deps)).informe).toMatchObject({ deCache: 0, pedidos: 1 });
  });

  it("una hora que ya pasó no se pide (Google rechaza el pasado): ese tramo se queda con el tiempo base", async () => {
    const g = doble("google", { conTrafico: true });
    const r = await traficoDeTramos([{ a: "tienda", b: "a", salidaMin: 300 }], "2026-03-02", P, ZONA, { cache: cacheEnMemoria(), proveedores: [g.p], ahoraISO: AHORA });
    expect(g.pedidos.tramos).toEqual([]);
    expect(r.porHora).toEqual({});
  });

  it("sin un proveedor que sepa de tráfico no se pide nada; y si falla, el plan no se cae", async () => {
    const o = doble("osrm");
    expect((await traficoDeTramos([{ a: "tienda", b: "a", salidaMin: 500 }], "2026-03-04", P, ZONA, { cache: cacheEnMemoria(), proveedores: [o.p], ahoraISO: AHORA })).porHora).toEqual({});
    expect(o.pedidos.tramos).toEqual([]);
    const roto = doble("google", { conTrafico: true, falla: true });
    expect((await traficoDeTramos([{ a: "tienda", b: "a", salidaMin: 500 }], "2026-03-04", P, ZONA, { cache: cacheEnMemoria(), proveedores: [roto.p], ahoraISO: AHORA })).porHora).toEqual({});
  });

  it("el tope de tramos por corrida y por día", async () => {
    const tramos = [480, 510, 540, 570].map((salidaMin) => ({ a: "tienda", b: "a", salidaMin }));
    const g = doble("google", { conTrafico: true });
    const r = await traficoDeTramos(tramos, "2026-03-04", P, ZONA, { cache: cacheEnMemoria(), proveedores: [g.p], ahoraISO: AHORA, presupuesto: { ...PRESUPUESTO_POR_DEFECTO, tramosPorCorrida: 3 } });
    expect([g.pedidos.tramos.length, r.informe.presupuestoAgotado]).toEqual([3, true]);
    const ya = Array.from({ length: 5 }, (_, n): FilaDeCache => ({ origen: `x${n}`, destino: "y", dia: 1, bloque: 16, trafico: true, minutos: 1, millas: 1, proveedor: "google", pedidoEl: "2026-03-02T01:00:00.000Z" }));
    const g2 = doble("google", { conTrafico: true });
    const r2 = await traficoDeTramos(tramos, "2026-03-04", P, ZONA, { cache: cacheEnMemoria(ya), proveedores: [g2.p], ahoraISO: AHORA, presupuesto: { ...PRESUPUESTO_POR_DEFECTO, tramosPorDia: 6 } });
    expect([g2.pedidos.tramos.length, r2.informe.presupuestoAgotado]).toEqual([1, true]);
  });
});

describe("planificar con tráfico en cascada", () => {
  const orden = (id: string, destino: string, extra: Partial<OrdenEntrada> = {}): OrdenEntrada =>
    ({ id, codigo: id, entrada: "2026-03-03 0800", origen: "tienda", destino, pallets: 1, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra });
  const chofer: ChoferEntrada = { id: "c1", nombre: "c1", base: "tienda", capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true };
  const parametros = PARAMETROS_POR_DEFECTO;

  it("el motor usa el tiempo con tráfico de la media hora en que SALE de cada sitio, y el base donde no lo hay", () => {
    const matriz = { tienda: { a: { minutos: 10, millas: 6 } }, a: { tienda: { minutos: 10, millas: 6 } } };
    const sec = { c1: [{ orden: "o", tipo: "P" as const }, { orden: "o", tipo: "D" as const }] };
    // Cargar le lleva 45 minutos: entra a las 08:00 (media hora 16) pero SALE de la tienda a las 08:45, que es
    // la 17. Si el motor mirase la hora de entrada, o la de otro punto, cogería el tráfico de otra media hora.
    const ordenes = [orden("o", "a", { servicioRecogidaMin: 45 })];
    const base = evaluaPlan({ secuencias: sec, ordenes, choferes: [chofer], matriz });
    expect([base.rutas[0].paradas[0].salida, base.rutas[0].paradas[1].tramoMin]).toEqual([525, 10]);
    const con = (bloque: number) => evaluaPlan({ secuencias: sec, ordenes, choferes: [chofer], matriz, porHora: { tienda: { a: { [bloque]: { minutos: 25, millas: 6 } } } } });
    expect(con(17).rutas[0].paradas[1].tramoMin).toBe(25);
    expect(con(16).rutas[0].paradas[1].tramoMin).toBe(10);
    expect(con(18).rutas[0].paradas[1].tramoMin).toBe(10);
    expect(con(17).rutas[0].manejoMin).toBe(35);      // 25 de ida con tráfico + 10 de vuelta, base
  });

  it("los tramos de un plan llevan la hora a la que el camión sale del punto anterior, vuelta a la base incluida", () => {
    const e: Entrada = { ordenes: [orden("o", "a")], choferes: [chofer], matriz: { tienda: { a: { minutos: 10, millas: 6 } }, a: { tienda: { minutos: 10, millas: 6 } } } };
    expect(tramosDelPlan(planifica(e), e)).toEqual([{ a: "tienda", b: "a", salidaMin: 500 }, { a: "a", b: "tienda", salidaMin: 520 }]);
    const sinVuelta: Entrada = { ...e, choferes: [{ ...chofer, vuelveABase: false }] };
    expect(tramosDelPlan(planifica(sinVuelta), sinVuelta)).toEqual([{ a: "tienda", b: "a", salidaMin: 500 }]);
  });

  it("si con tráfico el plan aguanta, UNA vuelta: mismas paradas, horas corregidas, y el `porHora` para guardar", async () => {
    const e: Entrada = { ordenes: [orden("o", "a")], choferes: [chofer], matriz: (await matrizBase(P, { cache: cacheEnMemoria(), proveedores: [doble("google").p], ahoraISO: AHORA })).matriz };
    const g = doble("google", { conTrafico: true, minutos: () => 17 });
    const r = await planificaConTrafico(e, parametros, "2026-03-04", P, ZONA, { cache: cacheEnMemoria(), proveedores: [g.p], ahoraISO: AHORA });
    expect(r.vueltas).toBe(1);
    expect(r.plan.rutas[0].paradas.map((p) => p.tramoMin)).toEqual([0, 17]);
    expect(r.plan.rutas[0].manejoMin).toBe(34);
    expect(g.pedidos.tramos).toHaveLength(2);
    // Con UNA sola secuencia posible, planificar de nuevo con ese `porHora` da lo mismo. No es la garantía
    // general (el `porHora` solo cubre los tramos probados): la garantía es EVALUAR la secuencia guardada,
    // y está en `route-plan/plan.test.ts`.
    expect(planifica({ ...e, porHora: r.porHora }, parametros).rutas).toEqual(r.plan.rutas);
  });

  it("si el tráfico rompe una ventana estrecha, se vuelve a planificar con esos tiempos — y nunca más de dos vueltas", async () => {
    const matriz = { tienda: { a: { minutos: 10, millas: 6 }, b: { minutos: 10, millas: 6 } }, a: { tienda: { minutos: 10, millas: 6 }, b: { minutos: 5, millas: 3 } }, b: { tienda: { minutos: 10, millas: 6 }, a: { minutos: 5, millas: 3 } } };
    // Sin tráfico da igual el orden; «a» entró antes y va primero, y «b» (estrecha, cierra 08:50) llega justo.
    const e: Entrada = { ordenes: [orden("oa", "a", { entrada: "2026-03-03 0700" }), orden("ob", "b", { ventana: [480, 530], estrecha: true })], choferes: [chofer], matriz };
    const sinTrafico = planifica(e, parametros);
    expect(sinTrafico.rutas[0].paradas.filter((p) => p.tipo === "D").map((p) => p.orden)).toEqual(["oa", "ob"]);
    // Con tráfico, de «a» a «b» se tarda 40: por «a» primero ya no se llega. Yendo antes a «b», sí.
    const g = doble("google", { conTrafico: true, minutos: (o, d) => (claveDePunto(o) === claveDePunto(P.a) && claveDePunto(d) === claveDePunto(P.b) ? 40 : 10) });
    const r = await planificaConTrafico(e, parametros, "2026-03-04", P, ZONA, { cache: cacheEnMemoria(), proveedores: [g.p], ahoraISO: AHORA });
    expect(r.plan.rutas[0].paradas.filter((p) => p.tipo === "D").map((p) => p.orden)).toEqual(["ob", "oa"]);
    expect(r.plan.violaciones).toEqual([]);
    expect(r.plan.sinAsignar).toEqual([]);
    expect(r.vueltas).toBe(2);
    expect(MAX_VUELTAS_DE_TRAFICO).toBe(2);
  });

  it("si tras las dos vueltas sigue sin caber, lo DICE — y el plan lleva las horas con tráfico, no las optimistas", async () => {
    const matriz = { tienda: { a: { minutos: 10, millas: 6 }, b: { minutos: 10, millas: 6 } }, a: { tienda: { minutos: 10, millas: 6 }, b: { minutos: 5, millas: 3 } }, b: { tienda: { minutos: 10, millas: 6 }, a: { minutos: 5, millas: 3 } } };
    const estrecha = { ventana: [480, 530] as [number, number], estrecha: true };
    const e: Entrada = { ordenes: [orden("oa", "a", { ...estrecha, entrada: "2026-03-03 0700" }), orden("ob", "b", estrecha)], choferes: [chofer], matriz };
    expect(planifica(e, parametros).violaciones).toEqual([]);
    // Entre «a» y «b» se tarda 40 en los DOS sentidos: no hay orden que llegue. Cada vuelta descubre un sentido.
    const entreClientes = (o: LatLng, d: LatLng) => [claveDePunto(P.a), claveDePunto(P.b)].includes(claveDePunto(o)) && [claveDePunto(P.a), claveDePunto(P.b)].includes(claveDePunto(d));
    const g = doble("google", { conTrafico: true, minutos: (o, d) => (entreClientes(o, d) ? 40 : 10) });
    const r = await planificaConTrafico(e, parametros, "2026-03-04", P, ZONA, { cache: cacheEnMemoria(), proveedores: [g.p], ahoraISO: AHORA });
    expect([r.vueltas, r.sinResolver]).toEqual([2, true]);
    expect(r.plan.violaciones.length).toBeGreaterThan(0);
    expect(r.plan.rutas[0].paradas.filter((p) => p.tipo === "D").map((p) => p.tramoMin)).toEqual([10, 40]);
  });

  it("cuando el tráfico aguanta, no hay nada sin resolver", async () => {
    const e: Entrada = { ordenes: [orden("o", "a")], choferes: [chofer], matriz: { tienda: { a: { minutos: 10, millas: 6 } }, a: { tienda: { minutos: 10, millas: 6 } } } };
    const r = await planificaConTrafico(e, parametros, "2026-03-04", P, ZONA, { cache: cacheEnMemoria(), proveedores: [doble("google", { conTrafico: true, minutos: () => 17 }).p], ahoraISO: AHORA });
    expect(r.sinResolver).toBe(false);
  });

  it("sin nadie que sepa de tráfico, el plan es el de la matriz base y no se pide nada", async () => {
    const e: Entrada = { ordenes: [orden("o", "a")], choferes: [chofer], matriz: { tienda: { a: { minutos: 10, millas: 6 } }, a: { tienda: { minutos: 10, millas: 6 } } } };
    const r = await planificaConTrafico(e, parametros, "2026-03-04", P, ZONA, { cache: cacheEnMemoria(), proveedores: [proveedorEstimado()], ahoraISO: AHORA });
    expect([r.vueltas, r.informe.pedidos, r.porHora]).toEqual([0, 0, {}]);
    expect(r.plan.rutas).toEqual(planifica(e, parametros).rutas);
  });
});

describe("los proveedores de verdad, con un `fetch` de mentira", () => {
  function fetchDoble(respuesta: (url: string, cuerpo: Record<string, unknown> | null) => unknown, status = 200) {
    const llamadas: { url: string; cabeceras: Record<string, string>; cuerpo: Record<string, unknown> | null }[] = [];
    const f: FetchFn = async (url, init) => {
      const cuerpo = init?.body ? JSON.parse(init.body) : null;
      llamadas.push({ url, cabeceras: init?.headers ?? {}, cuerpo });
      return { ok: status < 400, status, json: async () => respuesta(url, cuerpo), text: async () => "" };
    };
    return { f, llamadas };
  }

  it("Google, la matriz: SIN tráfico, por la API de matrices, con la llave en cabecera y no en la URL", async () => {
    const { f, llamadas } = fetchDoble(() => [
      { originIndex: 0, destinationIndex: 0, duration: "600s", distanceMeters: 16093, condition: "ROUTE_EXISTS" },
      { originIndex: 0, destinationIndex: 1, condition: "ROUTE_NOT_FOUND" },
    ]);
    const r = await proveedorGoogle("LLAVE-DE-PRUEBA", f).matriz([P.tienda], [P.a, P.b]);
    expect(r).toEqual([[{ minutos: 10, millas: 10 }, null]]);
    expect(llamadas[0].url).toBe("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix");
    expect(llamadas[0].url).not.toContain("LLAVE");
    expect(llamadas[0].cabeceras["X-Goog-Api-Key"]).toBe("LLAVE-DE-PRUEBA");
    expect(llamadas[0].cuerpo).toMatchObject({ routingPreference: "TRAFFIC_UNAWARE", travelMode: "DRIVE" });
    expect(llamadas[0].cuerpo).not.toHaveProperty("departureTime");
  });

  it("Google, la matriz: se trocea para no pasar de 625 elementos por petición", async () => {
    const { f, llamadas } = fetchDoble(() => []);
    const muchos = Array.from({ length: 30 }, (_, n) => ({ lat: 26 + n / 100, lng: -98 }));
    await proveedorGoogle("k", f).matriz(muchos, muchos);
    expect(MAX_ELEMENTOS_POR_PETICION).toBe(625);
    expect(llamadas.map((l) => (l.cuerpo!.origins as unknown[]).length)).toEqual([20, 10]);   // 20 × 30 = 600 ≤ 625
  });

  it("Google, el tramo: CON tráfico y con su hora de salida; sin hora, sin tráfico", async () => {
    const { f, llamadas } = fetchDoble(() => ({ routes: [{ duration: "1500s", distanceMeters: 16093 }] }));
    const g = proveedorGoogle("k", f);
    expect(await g.tramo(P.tienda, P.a, "2026-03-04T14:15:00.000Z")).toEqual({ minutos: 25, millas: 10 });
    expect(llamadas[0].cuerpo).toMatchObject({ routingPreference: "TRAFFIC_AWARE", departureTime: "2026-03-04T14:15:00.000Z" });
    await g.tramo(P.tienda, P.a);
    expect(llamadas[1].cuerpo).toMatchObject({ routingPreference: "TRAFFIC_UNAWARE" });
    expect(llamadas[1].cuerpo).not.toHaveProperty("departureTime");
    expect(g.conTrafico).toBe(true);
  });

  it("si Google contesta con error, se lanza: es lo que hace saltar al respaldo", async () => {
    await expect(proveedorGoogle("k", fetchDoble(() => ({}), 403).f).matriz([P.tienda], [P.a])).rejects.toThrow("google matrix 403");
    await expect(proveedorGoogle("k", fetchDoble(() => ({}), 429).f).tramo(P.tienda, P.a)).rejects.toThrow("google route 429");
  });

  it("OSRM: la tabla con fuentes y destinos, lng antes que lat, y declara que no sabe de tráfico", async () => {
    const { f, llamadas } = fetchDoble(() => ({ durations: [[600, null]], distances: [[16093, null]] }));
    const o = proveedorOSRM(f);
    expect(await o.matriz([P.tienda], [P.a, P.b])).toEqual([[{ minutos: 10, millas: 10 }, null]]);
    expect(llamadas[0].url).toBe("https://router.project-osrm.org/table/v1/driving/-98.2,26.2;-98.1,26.3;-98.3,26.25?annotations=duration,distance&sources=0&destinations=1;2");
    expect(o.conTrafico).toBe(false);
  });
});

describe("la caché de verdad, con un cliente de mentira", () => {
  it("lee por orígenes y destinos y se queda SOLO con las claves pedidas; una caché que falla es una caché vacía", async () => {
    const filas = [
      { origin_key: "x", dest_key: "y", weekday: -1, block: -1, traffic: false, minutes: 10, miles: "6.5" as unknown as number, provider: "google", fetched_at: AHORA },
      { origin_key: "x", dest_key: "y", weekday: 3, block: 16, traffic: true, minutes: 14, miles: 6.5, provider: "google", fetched_at: AHORA },
    ];
    const pedidos: [string, string[]][] = [];
    const cliente = (error: { message: string } | null) => ({
      from: () => ({
        select: () => ({ in: (c1: string, v1: string[]) => ({ in: async (c2: string, v2: string[]) => { pedidos.push([c1, v1], [c2, v2]); return { data: error ? null : filas, error }; } }) }),
        upsert: async () => ({ error: null }),
      }),
    });
    const gasto = { cuentaDePago: async (_d: string, conTrafico: boolean) => (conTrafico ? 7 : 42) };
    const cache = cacheEnSupabase(cliente(null), gasto);
    expect(await cache.lee([claveSinTrafico("x", "y")])).toEqual([{ origen: "x", destino: "y", dia: -1, bloque: -1, trafico: false, minutos: 10, millas: 6.5, proveedor: "google", pedidoEl: AHORA }]);
    expect(pedidos).toEqual([["origin_key", ["x"]], ["dest_key", ["y"]]]);
    expect(await cacheEnSupabase(cliente({ message: "relation does not exist" }), gasto).lee([claveSinTrafico("x", "y")])).toEqual([]);
    expect(await cache.lee([])).toEqual([]);
    expect(await cache.gastoDesde(AHORA)).toEqual({ elementos: 42, tramos: 7 });
  });

  it("escribe con upsert sobre la clave entera, que es la clave primaria de la 132", async () => {
    let visto: { filas: unknown[]; opciones: { onConflict: string } } | null = null;
    const cliente = { from: () => ({ select: () => ({ in: () => ({ in: async () => ({ data: [], error: null }) }) }), upsert: async (filas: unknown[], opciones: { onConflict: string }) => { visto = { filas, opciones }; return { error: null }; } }) };
    await cacheEnSupabase(cliente, { cuentaDePago: async () => 0 }).escribe([{ origen: "x", destino: "y", dia: 3, bloque: 16, trafico: true, minutos: 14, millas: 6.5, proveedor: "google", pedidoEl: AHORA }]);
    expect(visto!.opciones.onConflict).toBe("origin_key,dest_key,weekday,block,traffic");
    expect(visto!.filas).toEqual([{ origin_key: "x", dest_key: "y", weekday: 3, block: 16, traffic: true, minutes: 14, miles: 6.5, provider: "google", fetched_at: AHORA }]);
    const sql = plano(leer("supabase/migrations/132_travel_time_cache.sql"));
    expect(sql).toContain("primary key (origin_key, dest_key, weekday, block, traffic),");
  });
});

describe("132 y las reglas de la casa", () => {
  const sql = leer("supabase/migrations/132_travel_time_cache.sql");
  const e = plano(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));

  it("RLS activada y NINGUNA política: ningún navegador; al servidor se le da explícito", () => {
    expect(e).toContain("alter table public.travel_time_cache enable row level security;");
    expect(e).not.toMatch(/create policy/);
    const quita = e.indexOf("revoke all on public.travel_time_cache from anon, authenticated;");
    expect(quita).toBeGreaterThan(0);
    expect([...e.matchAll(/grant [^;]* to (\w+);/g)].map((m) => m[1])).toEqual(["service_role"]);
  });

  it("la forma de la clave la hace cumplir la base: sin tráfico, -1 y -1; con tráfico, día y bloque", () => {
    expect(e).toContain("check ((traffic and weekday >= 0 and block >= 0) or (not traffic and weekday = -1 and block = -1))");
    expect(e).toContain("check (block between -1 and 47)");
    expect(e).toContain("check (provider in ('google', 'osrm', 'estimado'))");
    expect(e).toContain("(fetched_at) where provider = 'google'");
  });

  it("sin transacción propia, con autocomprobación (también del permiso del servidor), ensayo, ledger y sin marcador", () => {
    expect(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n")).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    const auto = e.slice(e.indexOf("do $comprueba$"));
    expect(auto).toContain("if n <> 0 then raise exception '132: travel_time_cache tiene % politicas");
    expect(auto).toContain("if not has_table_privilege('service_role', 'public.travel_time_cache', privilegio) then");
    expect(sql).toContain("--   rollback;");
    expect(sql.split("-- @ledger-below")[1]).toMatch(/'132_travel_time_cache\.sql', '[0-9a-f]{64}'/);
    expect(sql).not.toContain("D-" + "NEXT");
  });

  it("en esta librería no hay reloj ni red sueltos: la hora y `fetch` llegan inyectados", () => {
    const dir = join(process.cwd(), "src/lib/route-times");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const codigo = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
      expect(codigo, f).not.toMatch(/Date\.now|new Date\(\)|Math\.random|(?<![\w.])fetch\(|process\.env|createAdminClient/);
    }
  });
});
