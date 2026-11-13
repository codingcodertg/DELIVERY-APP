import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseWindow } from "./dispatch";
import { cambiosDeLaLista, listaDelChofer, tiendaDeRecogida, type ParadaDeLaLista } from "./lista-unica";
import { mideLaLista, optimizaLaLista, type EntradaDeOptimizar, type MedidaDeLaLista, type TiemposDeLaRuta } from "./optimiza-la-ruta";
import { entradaEnOrden, jornadaDeTarjeta, noEsPeor, optimizaSinEmpeorar, PATRONES_DE_DESPACHO } from "./optimiza-sin-empeorar";
import { claveDePunto } from "./route-times/claves";
import { FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS, millasEnLineaRecta } from "./route-times/proveedores";
import { serviceMin } from "./trip-timing";
import FIJO from "./rutas-a-mano-anon.json";

/**
 * Las rutas que el equipo armó A MANO, repetidas contra «🧭 Optimizar» (D-1029).
 *
 * Dos partes:
 *   1. **El caso fijo** (`rutas-a-mano-anon.json`, siempre): rutas reales y ANONIMIZADAS —sin fechas, choferes, clientes,
 *      direcciones ni coordenadas; los puntos son números y los tiempos entre ellos, los de la matriz real—. Comprueba que el
 *      Optimizar de D-1029 nunca deja una ruta peor que la del despachador, y que el de antes sí lo hacía (la causa).
 *   2. **El repaso** (solo con `RUTAS_DATOS`, el volcado de `scripts/rutas/vuelca.mjs`): repite TODAS las rutas de los
 *      últimos días, escribe el informe humano / antes / después, mide los patrones del equipo y, con `RUTAS_ESCRIBE=1`,
 *      reescribe el caso fijo y `patrones-de-despacho.json`.
 */

type Punto = { lat: number; lng: number };
interface RutaFija {
  id: string; ordenes: number; capacidad: number; salidaMin: number; base: number | null; fin?: number | null;
  paradas: ([("P"), string, string | null] | ["D", string])[];
  puntos: (number | null)[]; cambios: (number | null)[]; ventanas: ([number, number, 0 | 1] | null)[]; servicios: number[];
  /** `t[a][b] = [minutos, millas]` entre los puntos `a` y `b` (los de la matriz real; lo que faltaba, estimado como el motor). */
  t: [number, number][][];
  humano: { centiMillas: number; tarjetaMin: number; tardeMin: number; exceso: number };
  /** Lo que daba el Optimizar de antes (D-461), medido al generar el caso. */
  viejo: { centiMillas: number; tarjetaMin: number };
}

/** Un punto inventado para el índice `k`: solo hace de clave de la matriz. */
const puntoFijo = (k: number): Punto => ({ lat: 10 + k / 100, lng: -50 });

function entradaFija(r: RutaFija): EntradaDeOptimizar {
  const tiempos: Record<string, Record<string, { minutos: number; millas: number }>> = {};
  r.t.forEach((fila, a) => fila.forEach(([minutos, millas], b) => { if (a !== b) (tiempos[claveDePunto(puntoFijo(a))] ??= {})[claveDePunto(puntoFijo(b))] = { minutos, millas }; }));
  const paradas: ParadaDeLaLista[] = r.paradas.map((p) => (p[0] === "P" ? { tipo: "P", ordenes: [p[1]], tienda: p[2] } : { tipo: "D", orden: p[1] }));
  return {
    paradas, puntos: r.puntos.map((k) => (k == null ? null : puntoFijo(k))), cambios: r.cambios, capacidad: r.capacidad, salidaMin: r.salidaMin,
    base: r.base == null ? null : puntoFijo(r.base), ...(r.fin !== undefined ? { fin: r.fin == null ? null : puntoFijo(r.fin) } : {}),
    ventanas: r.ventanas.map((v) => (v ? { abre: v[0], cierra: v[1], estrecha: v[2] === 1 } : null)), servicios: r.servicios, tiempos,
  };
}

const tardeMin = (m: MedidaDeLaLista) => m.tarde.reduce((s, x) => s + x.minutos, 0);
const peorQue = (a: { centiMillas: number; tarjetaMin: number }, h: { centiMillas: number; tarjetaMin: number }) => a.centiMillas > h.centiMillas + 5 || a.tarjetaMin > h.tarjetaMin;
const mejorQue = (a: { centiMillas: number; tarjetaMin: number }, h: { centiMillas: number; tarjetaMin: number }) => !peorQue(a, h) && (a.centiMillas < h.centiMillas - 5 || a.tarjetaMin < h.tarjetaMin);

// =====================================================================================================================
describe("1 · el caso fijo: rutas hechas a mano, reales y anonimizadas", () => {
  const rutas = (FIJO as unknown as { rutas: RutaFija[] }).rutas;

  it("el caso no lleva nada que identifique a nadie: ni fechas, ni nombres, ni coordenadas", () => {
    const texto = JSON.stringify(FIJO);
    expect(rutas.length).toBeGreaterThanOrEqual(12);
    expect(texto).not.toMatch(/RDZ|Bodega|\d{4}-\d{2}-\d{2}T|"lat"|"lng"|-9[78]\.\d/);
    for (const r of rutas) for (const p of r.paradas) { expect(p[1]).toMatch(/^o\d+$/); if (p[0] === "P") expect(p[2] ?? "Tienda A").toMatch(/^Tienda [A-Z]$/); }
  });

  it("cada ruta mide lo que medía al generar el caso (la ruta del despachador, con la cuenta del optimizador)", () => {
    for (const r of rutas) {
      const m = mideLaLista(entradaFija(r));
      expect({ id: r.id, centiMillas: m.centiMillas, tarjetaMin: jornadaDeTarjeta(m), tardeMin: tardeMin(m), exceso: m.exceso }).toEqual({ id: r.id, ...r.humano });
    }
  });

  it("LA CAUSA · el Optimizar de antes (D-461) dejaba rutas del despachador con más millas o más jornada de tarjeta", () => {
    const peores = rutas.filter((r) => peorQue(r.viejo, r.humano));
    // Lo guardado al generar: las que empeoraba, y cuántas millas de más entre todas.
    expect(peores.length).toBeGreaterThanOrEqual(5);
    expect(peores.reduce((s, r) => s + Math.max(0, r.viejo.centiMillas - r.humano.centiMillas), 0) / 100).toBeGreaterThan(50);
    // Y se repite aquí, con el optimizador de siempre (sin topes), en las tres primeras: sigue dándolo.
    for (const r of peores.slice(0, 3)) {
      const e = entradaFija(r);
      const v = optimizaLaLista(e);
      const m = mideLaLista(entradaEnOrden(e, v.paradas));
      expect({ id: r.id, centiMillas: m.centiMillas, tarjetaMin: jornadaDeTarjeta(m) }).toEqual({ id: r.id, ...r.viejo });
      expect(peorQue({ centiMillas: m.centiMillas, tarjetaMin: jornadaDeTarjeta(m) }, r.humano)).toBe(true);
    }
  });

  it("D-1029 · «🧭 Optimizar» nunca deja la ruta peor que la del despachador, y en conjunto baja millas y jornada", () => {
    let mejora = 0, iguala = 0, millasH = 0, millasN = 0, tarjetaH = 0, tarjetaN = 0, tardeH = 0, tardeN = 0;
    for (const r of rutas) {
      const e = entradaFija(r);
      const n = optimizaSinEmpeorar(e);
      const d = { centiMillas: n.despues.centiMillas, tarjetaMin: jornadaDeTarjeta(n.despues) };
      // Nunca peor: ni que lo que entró (la guarda)…
      expect(noEsPeor(n.antes, n.despues), r.id).toBe(true);
      expect(n.antes.centiMillas, r.id).toBe(r.humano.centiMillas);
      // …ni en lo que enseña la tarjeta, ni en retrasos, ni en carga.
      expect(peorQue(d, r.humano), r.id).toBe(false);
      expect(tardeMin(n.despues), r.id).toBeLessThanOrEqual(r.humano.tardeMin);
      expect(n.despues.exceso, r.id).toBeLessThanOrEqual(r.humano.exceso + 1e-9);
      // Lo que devuelve es lo que mide su orden, y las mismas paradas; y sin cambio no hay nada que guardar.
      expect(mideLaLista(entradaEnOrden(e, n.paradas)).centiMillas, r.id).toBe(n.despues.centiMillas);
      if (!n.cambio) { expect(n.paradas, r.id).toEqual(e.paradas); expect(n.como, r.id).toBeNull(); }
      if (mejorQue(d, r.humano)) mejora++; else iguala++;
      millasH += r.humano.centiMillas; millasN += d.centiMillas; tarjetaH += r.humano.tarjetaMin; tarjetaN += d.tarjetaMin; tardeH += r.humano.tardeMin; tardeN += tardeMin(n.despues);
    }
    expect(mejora + iguala).toBe(rutas.length);
    expect(mejora).toBeGreaterThanOrEqual(Math.ceil(rutas.length / 2));
    expect(millasN).toBeLessThan(millasH);
    expect(tarjetaN).toBeLessThan(tarjetaH);
    expect(tardeN).toBeLessThanOrEqual(tardeH);
    // Y mejor que el de antes en lo que el dueño mira: menos millas en total que lo que dejaba aquél.
    expect(millasN).toBeLessThan(rutas.reduce((s, r) => s + r.viejo.centiMillas, 0));
  }, 60_000);

  it("optimizar lo ya optimizado no cambia nada: «ya está en buen orden»", () => {
    for (const r of rutas.slice(0, 6)) {
      const e = entradaFija(r);
      const uno = optimizaSinEmpeorar(e);
      if (!uno.cambio) continue;
      const dos = optimizaSinEmpeorar(entradaEnOrden(e, uno.paradas));
      expect(noEsPeor(uno.despues, dos.despues), r.id).toBe(true);
      expect(dos.despues.centiMillas, r.id).toBeLessThanOrEqual(uno.despues.centiMillas);
    }
  }, 60_000);

  it("lo medido que justifica las reglas sigue valiendo (`patrones-de-despacho.json`)", () => {
    const p = PATRONES_DE_DESPACHO;
    // Las ventanas estrechas no son duras para el equipo: más de la mitad de las «0830-1000» se entregan tarde…
    expect(p.ventanas.entregadasTardePct["0830-1000"]).toBeGreaterThan(50);
    // …aunque sí las ponen pronto: por eso son un objetivo que no se compra con millas, no algo que se ignora.
    expect(p.ventanas.estrechaEnElPrimerTercioPct).toBeGreaterThan(p.ventanas.otrasEnElPrimerTercioPct + 20);
    // Y la capacidad de Ajustes no es un tope duro: una parte de las rutas hechas a mano la pasa.
    expect(p.capacidad.rutasSobreLaCapacidadPct).toBeGreaterThan(5);
    expect(p.generado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// =====================================================================================================================
// 2 · El repaso con el volcado de producción. No es una prueba: mide, informa y (si se pide) reescribe el caso fijo.

const RUTA = process.env.RUTAS_DATOS ?? "";
type Orden = {
  id: string; order_type: string | null; store: string | null; pickup_name: string | null; d: string; assigned_driver: string | null;
  route_seq: number | null; pickup_seq: number | null; load_no: number | null; delivery_windows: string | null;
  est_pallets: number | null; actual_pallets: number | null; pickup_duration: string | null; delivery_duration: string | null;
  pod_delivered_at: string | null; delivery_lat: number | null; delivery_lng: number | null;
};
type Volcado = {
  volcado?: string; deliveries: Orden[]; cache: { o: string; t: string; m: number; mi: number; traffic?: boolean }[];
  settings: { stores: { name: string; lat: number | null; lng: number | null }[]; route_hard_windows: string[] | null; driver_capacity: Record<string, number> | null; default_truck_capacity: number | null };
  drivers: { id: string; full_name: string; store: string | null; base_store: string | null }[];
  bases: { d: string; driver_id: string; start_store: string | null; end_store: string | null }[];
};

describe.skipIf(!RUTA || !existsSync(RUTA))("2 · el repaso: todas las rutas hechas a mano del volcado", () => {
  it("humano contra Optimizar, antes y después de D-1029; y los patrones del equipo", () => {
    const V = JSON.parse(readFileSync(RUTA, "utf8")) as Volcado;
    const tiendas = V.settings.stores.filter((s) => s.lat != null && s.lng != null) as { name: string; lat: number; lng: number }[];
    const coordsDeTienda = (n: string | null): Punto | null => { const t = tiendas.find((x) => x.name.trim().toLowerCase() === (n ?? "").trim().toLowerCase()); return t ? { lat: t.lat, lng: t.lng } : null; };
    const tiempos: Record<string, Record<string, { minutos: number; millas: number }>> = {};
    for (const r of V.cache) if (!r.traffic) (tiempos[r.o] ??= {})[r.t] = { minutos: r.m, millas: r.mi };
    const duras = V.settings.route_hard_windows ?? [];
    const cap = (chofer: string) => V.settings.driver_capacity?.[chofer] ?? V.settings.default_truck_capacity ?? 10;
    const baseDe = (chofer: string, dia: string) => {
      const c = V.drivers.find((x) => x.full_name === chofer);
      const b = V.bases.find((x) => x.d === dia && x.driver_id === c?.id);
      return { nombre: b?.start_store ?? c?.base_store ?? c?.store ?? null, fin: b?.end_store ?? null };
    };
    const pal = (o: Orden) => o.actual_pallets ?? o.est_pallets ?? 0;
    const zona = (p: Punto) => [...tiendas].sort((a, b) => millasEnLineaRecta(a, p) - millasEnLineaRecta(b, p))[0].name;
    const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

    const porRuta = new Map<string, Orden[]>();
    for (const d of V.deliveries) { if (!d.assigned_driver) continue; const k = `${d.d}|${d.assigned_driver}`; porRuta.set(k, [...(porRuta.get(k) ?? []), d]); }
    const filas: { clave: string; n: number; limpia: boolean; e: EntradaDeOptimizar; ordenes: Orden[]; base: string | null; h: MedidaDeLaLista; v: MedidaDeLaLista; nu: MedidaDeLaLista; como: string | null; ms: number }[] = [];
    for (const [clave, todas] of [...porRuta.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const [dia, chofer] = clave.split("|");
      const ordenes = todas.filter((o) => o.route_seq != null && o.delivery_lat != null && o.delivery_lng != null);
      if (ordenes.length < 2) continue;
      const seqs = ordenes.map((o) => o.route_seq);
      const limpia = new Set(seqs).size === seqs.length && ordenes.length === todas.length;
      const lista = listaDelChofer(ordenes, cap(chofer));
      const porId = new Map(ordenes.map((o) => [o.id, o]));
      const b = baseDe(chofer, dia);
      const e: EntradaDeOptimizar = {
        paradas: lista, cambios: cambiosDeLaLista(lista, ordenes), capacidad: cap(chofer), salidaMin: 480, tiempos: tiempos as TiemposDeLaRuta,
        base: coordsDeTienda(b.nombre), ...(b.fin ? { fin: coordsDeTienda(b.fin) } : {}),
        puntos: lista.map((p) => (p.tipo === "P" ? coordsDeTienda(p.tienda) : { lat: porId.get(p.orden)!.delivery_lat!, lng: porId.get(p.orden)!.delivery_lng! })),
        ventanas: lista.map((p) => { if (p.tipo === "P") return null; const w = parseWindow(porId.get(p.orden)!.delivery_windows); return w ? { abre: w[0], cierra: w[1], estrecha: duras.includes((porId.get(p.orden)!.delivery_windows ?? "").trim()) } : null; }),
        servicios: lista.map((p) => (p.tipo === "P" ? p.ordenes.reduce((s, id) => s + serviceMin(porId.get(id)?.pickup_duration), 0) : serviceMin(porId.get(p.orden)!.delivery_duration))),
      };
      const h = mideLaLista(e);
      const v = mideLaLista(entradaEnOrden(e, optimizaLaLista(e).paradas));
      const t0 = performance.now();
      const n = optimizaSinEmpeorar(e);
      filas.push({ clave, n: ordenes.length, limpia, e, ordenes, base: b.nombre, h, v, nu: n.despues, como: n.como, ms: Math.round(performance.now() - t0) });
    }

    // ---- El informe.
    const de = (m: MedidaDeLaLista) => ({ centiMillas: m.centiMillas, tarjetaMin: jornadaDeTarjeta(m) });
    const linea = (m: MedidaDeLaLista) => `${(m.centiMillas / 100).toFixed(1).padStart(6)} mi ${String(jornadaDeTarjeta(m)).padStart(4)} min tarde ${String(m.tarde.length).padStart(2)}/${String(tardeMin(m)).padStart(4)} exc ${m.exceso}`;
    const informe: string[] = [`Rutas hechas a mano del volcado ${V.volcado ?? ""}: ${filas.length} (limpias: ${filas.filter((f) => f.limpia).length}). Tiempos: caché de la matriz (sin tráfico); lo que falta, estimado.`, ""];
    for (const f of filas) informe.push(`${f.clave.padEnd(30)} ${String(f.n).padStart(2)}${f.limpia ? " " : "*"} | humano ${linea(f.h)} | antes ${linea(f.v)} | D-1029 ${linea(f.nu)} ${f.como ?? "="} ${f.ms}ms`);
    const resumen = (nombre: string, fs: typeof filas) => {
      const tot = (g: (f: (typeof filas)[number]) => MedidaDeLaLista) => `${(fs.reduce((s, f) => s + g(f).centiMillas, 0) / 100).toFixed(0)} mi · ${(fs.reduce((s, f) => s + jornadaDeTarjeta(g(f)), 0) / 60).toFixed(1)} h · tarde ${fs.reduce((s, f) => s + g(f).tarde.length, 0)} entregas / ${fs.reduce((s, f) => s + tardeMin(g(f)), 0)} min`;
      const cuenta = (g: (f: (typeof filas)[number]) => MedidaDeLaLista) => { let m = 0, i = 0, p = 0, mi = 0; for (const f of fs) { if (peorQue(de(g(f)), de(f.h))) { p++; mi += Math.max(0, g(f).centiMillas - f.h.centiMillas); } else if (mejorQue(de(g(f)), de(f.h))) m++; else i++; } return { m, i, p, mi: Math.round(mi / 100) }; };
      const a = cuenta((f) => f.v), d = cuenta((f) => f.nu);
      informe.push("", `== ${nombre}: ${fs.length} rutas`, `humano : ${tot((f) => f.h)}`, `antes  : ${tot((f) => f.v)} — mejora ${a.m} · iguala ${a.i} · EMPEORA ${a.p} (+${a.mi} mi)`, `D-1029 : ${tot((f) => f.nu)} — mejora ${d.m} · iguala ${d.i} · EMPEORA ${d.p}`);
      return { a, d };
    };
    const todas = resumen("todas", filas);
    resumen("limpias (puestos sin repetir)", filas.filter((f) => f.limpia));
    expect(todas.d.p).toBe(0);

    // ---- Los patrones del equipo.
    const con3 = filas.filter((f) => f.n >= 3);
    let baseSiHay = 0, basePrimera = 0, todasPrimero = 0, vuelve = 0, pJunta = 0, pTotal = 0, sobre = 0, sobre12 = 0, contiguas = 0, dirN = 0, lejos1 = 0, cerca1 = 0, finCerca = 0, itSuelta = 0, itN = 0;
    const picos: number[] = [], posE: number[] = [], posO: number[] = [], posIt: number[] = [], posCl: number[] = [];
    for (const f of con3) {
      const L = f.e.paradas, porId = new Map(f.ordenes.map((o) => [o.id, o]));
      const esBase = (p: ParadaDeLaLista) => p.tipo === "P" && (p.tienda ?? "").trim().toLowerCase() === (f.base ?? "").trim().toLowerCase();
      if (L.some(esBase)) { baseSiHay++; if (esBase(L[0])) basePrimera++; }
      const iP = L.flatMap((p, i) => (p.tipo === "P" ? [i] : [])), iD = L.flatMap((p, i) => (p.tipo === "D" ? [i] : []));
      if (Math.max(...iP) < Math.min(...iD)) todasPrimero++;
      const vistas = new Set<string>(); let prev: string | null = null, volvio = false;
      L.forEach((p, i) => {
        if (p.tipo !== "P") { prev = null; return; }
        const t = p.tienda ?? "";
        if (t !== prev) { if (vistas.has(t)) volvio = true; vistas.add(t); }
        prev = t; pTotal++;
        const junto = (q: ParadaDeLaLista | undefined) => q?.tipo === "P" && (q.tienda ?? "") === t;
        if (junto(L[i + 1]) || junto(L[i - 1])) pJunta++;
      });
      if (volvio) vuelve++;
      let c = 0, pico = 0; f.e.cambios.forEach((x) => { c += x ?? 0; if (c > pico) pico = c; }); picos.push(Math.round(pico * 100) / 100);
      if (pico > (f.e.capacidad ?? 10) + 0.001) sobre++; if (pico > 12.001) sobre12++;
      const ds = iD.map((i) => porId.get((L[i] as { orden: string }).orden)!);
      const zs = ds.map((d) => zona({ lat: d.delivery_lat!, lng: d.delivery_lng! }));
      let cz = 0; for (let i = 1; i < zs.length; i++) if (zs[i] !== zs[i - 1]) cz++; if (cz === new Set(zs).size - 1) contiguas++;
      const b = coordsDeTienda(f.base);
      if (b && ds.length >= 3) {
        const dist = ds.map((d) => millasEnLineaRecta(b, { lat: d.delivery_lat!, lng: d.delivery_lng! }));
        if (Math.max(...dist) - Math.min(...dist) > 5) { dirN++; if (dist.indexOf(Math.max(...dist)) === 0) lejos1++; if (dist.indexOf(Math.min(...dist)) === 0) cerca1++; if (dist[dist.length - 1] <= [...dist].sort((x, y) => x - y)[Math.floor(dist.length / 2)]) finCerca++; }
      }
      ds.forEach((d, i) => { const pos = ds.length > 1 ? i / (ds.length - 1) : 0; (d.order_type === "Intertienda" ? posIt : posCl).push(pos); (duras.includes((d.delivery_windows ?? "").trim()) ? posE : posO).push(pos); });
      const tiendaEn = (d: Orden) => tiendas.find((s) => millasEnLineaRecta(s, { lat: d.delivery_lat!, lng: d.delivery_lng! }) < 0.2)?.name ?? null;
      L.forEach((p, i) => {
        if (p.tipo !== "D") return; const d = porId.get(p.orden)!; if (d.order_type !== "Intertienda") return; itN++;
        const destino = tiendaEn(d); if (!destino) return;
        const mismo = (q: ParadaDeLaLista | undefined) => q?.tipo === "D" && tiendaEn(porId.get(q.orden)!) === destino;
        let j = i + 1; while (mismo(L[j])) j++; let k = i - 1; while (mismo(L[k])) k--;
        const recoge = (q: ParadaDeLaLista | undefined) => q?.tipo === "P" && q.tienda === destino;
        if (recoge(L[j]) || recoge(L[k])) itSuelta++;
      });
    }
    // Las ventanas en la calle: la hora real de la entrega (del negocio) contra el cierre de su ventana.
    const horaLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const real: Record<string, { n: number; tarde: number; min: number[] }> = {};
    for (const d of V.deliveries) {
      if (!d.pod_delivered_at || !d.assigned_driver || d.order_type !== "Customer") continue;
      const w = parseWindow(d.delivery_windows); if (!w) continue;
      const p = Object.fromEntries(horaLocal.formatToParts(new Date(d.pod_delivered_at)).map((x) => [x.type, x.value]));
      if (`${p.year}-${p.month}-${p.day}` !== d.d) continue;
      const t = Number(p.hour) * 60 + Number(p.minute), r = (real[d.delivery_windows!.trim()] ??= { n: 0, tarde: 0, min: [] });
      r.n++; if (t > w[1]) { r.tarde++; r.min.push(t - w[1]); }
    }
    const mediana = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);
    const media = (a: number[]) => (a.length ? Math.round((100 * a.reduce((x, y) => x + y, 0)) / a.length) / 100 : 0);
    const tercio = (a: number[]) => pct(a.filter((x) => x <= 0.34).length, a.length);
    // Qué chofer lleva lo de cada tienda: la parte que lleva el chofer con base en ESA tienda.
    const delDeCasa: Record<string, number> = {};
    for (const t of tiendas) {
      const suyas = V.deliveries.filter((d) => d.assigned_driver && tiendaDeRecogida(d) === t.name);
      const deCasa = V.drivers.filter((c) => (c.base_store ?? c.store) === t.name).map((c) => c.full_name);
      if (suyas.length >= 20 && deCasa.length) delDeCasa[t.name] = pct(suyas.filter((d) => deCasa.includes(d.assigned_driver!)).length, suyas.length);
    }
    const dias = [...new Set(filas.map((f) => f.clave.split("|")[0]))].sort();
    const patrones = {
      generado: V.volcado ?? new Date().toISOString().slice(0, 10),
      nota: "Lo medido en las rutas hechas a mano (produccion, solo lectura) con scripts/rutas/vuelca.mjs y src/lib/rutas-a-mano.backtest.test.ts (RUTAS_ESCRIBE=1). Porcentajes enteros. Es la evidencia de las reglas de D-1029 (optimiza-sin-empeorar.ts, mejor-lugar.ts); no se lee en tiempo de ejecucion para decidir nada.",
      periodo: { desde: dias[0], hasta: dias[dias.length - 1], rutas: filas.length, rutasDe3OMas: con3.length },
      ventanas: {
        estrechas: duras,
        entregadasTardePct: Object.fromEntries(Object.entries(real).map(([k, r]) => [k, pct(r.tarde, r.n)])),
        entregasMedidas: Object.fromEntries(Object.entries(real).map(([k, r]) => [k, r.n])),
        medianaDeRetrasoMin: Object.fromEntries(Object.entries(real).map(([k, r]) => [k, mediana(r.min)])),
        estrechaEnElPrimerTercioPct: tercio(posE), otrasEnElPrimerTercioPct: tercio(posO),
        rutasQueYaLleganTardeEnElPlanPct: pct(filas.filter((f) => f.h.tarde.length > 0).length, filas.length),
      },
      capacidad: { rutasSobreLaCapacidadPct: pct(sobre, con3.length), rutasSobre12Pct: pct(sobre12, con3.length), picoMediano: mediana(picos), picoP90: [...picos].sort((a, b) => a - b)[Math.floor(picos.length * 0.9)] ?? 0 },
      forma: {
        laBaseEsLaPrimeraParadaPct: pct(basePrimera, baseSiHay), todasLasRecogidasAntesPct: pct(todasPrimero, con3.length), vuelveAUnaTiendaPct: pct(vuelve, con3.length),
        recogidaJuntoAOtraDeSuTiendaPct: pct(pJunta, pTotal), zonasSeguidasPct: pct(contiguas, con3.length),
        laMasLejanaPrimeroPct: pct(lejos1, dirN), laMasCercanaPrimeroPct: pct(cerca1, dirN), laUltimaEnLaMitadCercanaPct: pct(finCerca, dirN),
        posicionMediaIntertienda: media(posIt), posicionMediaCliente: media(posCl), intertiendaSueltaYRecogeEnLaMismaVisitaPct: pct(itSuelta, itN),
      },
      choferDeCasaPorTiendaPct: delDeCasa,
      optimizar: {
        rutas: filas.length,
        antes: { empeoraba: todas.a.p, millasDeMas: todas.a.mi, mejoraba: todas.a.m, igualaba: todas.a.i, millas: Math.round(filas.reduce((s, f) => s + f.v.centiMillas, 0) / 100) },
        despues: { empeora: todas.d.p, mejora: todas.d.m, iguala: todas.d.i, millas: Math.round(filas.reduce((s, f) => s + f.nu.centiMillas, 0) / 100) },
        humano: { millas: Math.round(filas.reduce((s, f) => s + f.h.centiMillas, 0) / 100) },
      },
    };
    informe.push("", "== patrones", JSON.stringify(patrones, null, 1));
    writeFileSync(process.env.RUTAS_INFORME ?? `${RUTA}.informe.txt`, informe.join("\n"));

    if (process.env.RUTAS_ESCRIBE !== "1") return;
    // ---- El caso fijo: rutas limpias de 4 a 8 órdenes — todas las que el Optimizar de antes empeoraba, y una de cada tres del resto.
    const elegibles = filas.filter((f) => f.limpia && f.n >= 4 && f.n <= 8 && f.e.base);
    let turno = 0;
    const elegidas = elegibles.filter((f) => peorQue(de(f.v), de(f.h)) || turno++ % 3 === 0);
    elegidas.sort((a, b) => Number(peorQue(de(b.v), de(b.h))) - Number(peorQue(de(a.v), de(a.h))) || (b.v.centiMillas - b.h.centiMillas) - (a.v.centiMillas - a.h.centiMillas));
    const rutas: RutaFija[] = elegidas.map((f, k) => {
      const claves: string[] = [], pts: Punto[] = [];
      const idx = (p: Punto | null | undefined): number | null => { if (!p) return null; const c = claveDePunto(p); let i = claves.indexOf(c); if (i < 0) { i = claves.length; claves.push(c); pts.push(p); } return i; };
      const base = idx(f.e.base), puntos = f.e.puntos.map(idx), fin = f.e.fin === undefined ? undefined : idx(f.e.fin);
      const t = claves.map((a, i) => claves.map((b, j): [number, number] => {
        if (i === j) return [0, 0];
        const real = tiempos[a]?.[b];
        if (real) return [real.minutos, real.millas];
        // Lo mismo que hace el optimizador cuando falta un tramo (`problemaDe`).
        const millas = Math.round(millasEnLineaRecta(pts[i], pts[j]) * FACTOR_DE_RODEO * 100) / 100;
        return [Math.round((millas / MILLAS_POR_HORA_ESTIMADAS) * 60), millas];
      }));
      const nombres = new Map<string, string>(), ids = new Map<string, string>();
      const tienda = (n: string | null) => (n == null ? null : nombres.get(n) ?? (nombres.set(n, `Tienda ${String.fromCharCode(65 + nombres.size)}`), nombres.get(n)!));
      const id = (x: string) => ids.get(x) ?? (ids.set(x, `o${ids.size + 1}`), ids.get(x)!);
      return {
        id: `r${String(k + 1).padStart(2, "0")}`, ordenes: f.n, capacidad: f.e.capacidad ?? 10, salidaMin: 480, base, ...(fin !== undefined ? { fin } : {}),
        paradas: f.e.paradas.map((p) => (p.tipo === "P" ? ["P", id(p.ordenes[0]), tienda(p.tienda)] : ["D", id(p.orden)])) as RutaFija["paradas"],
        puntos, cambios: [...f.e.cambios], ventanas: f.e.ventanas!.map((v) => (v ? [v.abre, v.cierra, v.estrecha ? 1 : 0] : null)), servicios: f.e.servicios!.map((s) => s ?? 0), t,
        humano: { ...de(f.h), tardeMin: tardeMin(f.h), exceso: f.h.exceso }, viejo: de(f.v),
      };
    });
    const fijo = {
      nota: "Rutas armadas A MANO por el equipo (D-1029), reales y ANONIMIZADAS: sin fechas, choferes, clientes, direcciones, facturas ni coordenadas. Los puntos son indices; `t[a][b] = [minutos, millas]` es la matriz real entre ellos (lo que faltaba en la cache, estimado como lo estima el optimizador). `humano`: lo que mide la ruta del despachador; `viejo`: lo que dejaba el Optimizar de D-461. Se genera con scripts/rutas/vuelca.mjs + RUTAS_ESCRIBE=1 (rutas-a-mano.backtest.test.ts).",
      generado: patrones.generado, rutas,
    };
    const aqui = join(process.cwd(), "src", "lib");
    writeFileSync(join(aqui, "rutas-a-mano-anon.json"), `${JSON.stringify(fijo).replace(/\{"id":"r/g, '\n{"id":"r')}\n`);
    writeFileSync(join(aqui, "patrones-de-despacho.json"), `${JSON.stringify(patrones, null, 2)}\n`);
  }, 1_800_000);
});
