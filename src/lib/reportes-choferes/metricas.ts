import type { ClaseDeVisita, InformeDelDia, ParadaDelInforme, VisitaDelInforme } from "./dia";

/**
 * Los números de «Reportes de choferes» (D-907), sacados de los días ya calculados (`informeDelDia`).
 *
 * La regla que manda en todo el fichero: **cada número lleva al lado de cuánto dato sale** (`n` y `de`), y un número con
 * poco dato detrás se enseña pero NO se usa para comparar choferes (`fiable: false`). Poco dato es:
 *   · menos de `MINIMO_DE_CASOS` casos (10 paradas, toques o visitas), o menos de `MINIMO_DE_DIAS` días (3) en lo que se
 *     mide por día; o
 *   · menos de la mitad de lo que se podía medir (`COBERTURA_MINIMA`): con 4 de 30 paradas con hora, la media es de esas 4.
 * Y no se ordena a nadie si no hay al menos dos choferes con dato fiable en esa medida.
 *
 * Puro: sin base, sin red, sin reloj, sin React (lo usan la pantalla y las pruebas).
 */

export const MINIMO_DE_CASOS = 10, MINIMO_DE_DIAS = 3, COBERTURA_MINIMA = 0.5;

export const mediana = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b), m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
export const percentil = (xs: readonly number[], q: number): number | null => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.ceil(q * o.length) - 1))];
};
const media = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r1 = (x: number | null): number | null => (x == null ? null : Math.round(x * 10) / 10);
const r0 = (x: number | null): number | null => (x == null ? null : Math.round(x));

// ---------------------------------------------------------------------------------------------------------------
// 2. Estimado contra real
// ---------------------------------------------------------------------------------------------------------------

export type BaseDeEstimado = "primera" | "plan";

export interface EstimadoContraReal {
  /** Paradas que entran en la cuenta: con estimación válida, con hora real y hechas en su puesto del plan. */
  n: number;
  dentroDe15: number; dentroDe30: number; dentroDe60: number;
  /** De las que llegaron más tarde de lo estimado: cuántas, y por cuánto de media. */
  tarde: number; retrasoMedioMin: number | null;
  /** La media con signo (positivo = el plan se queda corto) y la mediana. */
  sesgoMin: number | null; medianaMin: number | null;
  /** De dónde sale la hora real de las `n`. */
  porRastro: number; porToque: number;
  /** Lo que se quedó fuera, y por qué. */
  fuera: { sinEstimado: number; sinHoraReal: number; estimadoDespues: number; fueraDeOrden: number };
  paradas: number;
}

/** ¿Entra esta parada en «estimado contra real»? Devuelve la diferencia en minutos, o el motivo por el que no. */
export function difDe(p: ParadaDelInforme, base: BaseDeEstimado): { min: number } | { fuera: keyof EstimadoContraReal["fuera"] } {
  const est = base === "primera" ? p.primeraEta : p.eta, dif = base === "primera" ? p.difPrimera : p.difPlan;
  if (est == null) return { fuera: "sinEstimado" };
  if (p.llegada == null || dif == null) return { fuera: "sinHoraReal" };
  if (base === "primera" ? p.primeraPosterior : p.etaPosterior) return { fuera: "estimadoDespues" };
  // La estimación era para hacerla en su puesto (D-906): hecha antes que las de delante, «−357 min» no dice nada.
  if (p.fueraDeOrden) return { fuera: "fueraDeOrden" };
  return { min: dif };
}

export function estimadoContraReal(paradas: readonly ParadaDelInforme[], base: BaseDeEstimado): EstimadoContraReal {
  const difs: number[] = [];
  const fuera = { sinEstimado: 0, sinHoraReal: 0, estimadoDespues: 0, fueraDeOrden: 0 };
  let porRastro = 0, porToque = 0;
  for (const p of paradas) {
    const d = difDe(p, base);
    if ("fuera" in d) { fuera[d.fuera]++; continue; }
    difs.push(d.min);
    if (p.fuente === "camion" || p.fuente === "telefono") porRastro++; else porToque++;
  }
  const abs = difs.map(Math.abs), tarde = difs.filter((d) => d > 0);
  return {
    n: difs.length, dentroDe15: abs.filter((x) => x <= 15).length, dentroDe30: abs.filter((x) => x <= 30).length, dentroDe60: abs.filter((x) => x <= 60).length,
    tarde: tarde.length, retrasoMedioMin: r0(media(tarde)), sesgoMin: r0(media(difs)), medianaMin: r0(mediana(difs)),
    porRastro, porToque, fuera, paradas: paradas.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Tiempo por parada
// ---------------------------------------------------------------------------------------------------------------

export type GrupoDeTiempo = "clase" | "tienda" | "cliente" | "chofer";

export interface FilaDeTiempo {
  grupo: GrupoDeTiempo; clave: string;
  /** Visitas medidas de principio a fin. */
  n: number;
  medianaMin: number | null; mediaMin: number | null; p90Min: number | null; maxMin: number | null;
  /** La mediana de lo que el planificador suponía para esas mismas visitas. */
  planeadoMin: number | null;
  atipicas: number;
  fiable: boolean;
}

export interface VisitaMedida extends VisitaDelInforme { fecha: string; chofer: string; atipica: boolean }

/**
 * Atípica: una visita que dura más que el tercer cuartil de su clase + 1,5 veces el rango intercuartílico, y al menos 20
 * minutos más que la mediana de su clase. Con menos de 8 visitas en la clase no se marca ninguna.
 */
export function marcaAtipicas(visitas: readonly (VisitaDelInforme & { fecha: string; chofer: string })[]): VisitaMedida[] {
  const umbral = new Map<ClaseDeVisita, number>();
  for (const clase of new Set(visitas.map((v) => v.clase))) {
    const xs = visitas.filter((v) => v.clase === clase && !v.truncada).map((v) => v.minutos);
    if (xs.length < 8) continue;
    const q1 = percentil(xs, 0.25)!, q3 = percentil(xs, 0.75)!, med = mediana(xs)!;
    umbral.set(clase, Math.max(q3 + 1.5 * (q3 - q1), med + 20));
  }
  return visitas.map((v) => ({ ...v, atipica: !v.truncada && umbral.has(v.clase) && v.minutos > umbral.get(v.clase)! }));
}

/** Todas las visitas de los días, con su fecha y chofer, y las atípicas marcadas. */
export function visitasDe(dias: readonly InformeDelDia[]): VisitaMedida[] {
  return marcaAtipicas(dias.flatMap((d) => d.visitas.map((v) => ({ ...v, fecha: d.fecha, chofer: d.chofer }))));
}

export function tiempoPorParada(visitas: readonly VisitaMedida[], grupo: GrupoDeTiempo): FilaDeTiempo[] {
  const claveDe = (v: VisitaMedida): string | null =>
    grupo === "clase" ? v.clase : grupo === "tienda" ? (v.clase === "entrega_cliente" ? null : v.tienda ?? v.lugar) : grupo === "cliente" ? v.cliente : v.chofer;
  const por = new Map<string, VisitaMedida[]>();
  for (const v of visitas) {
    if (v.truncada) continue;
    const k = claveDe(v);
    if (!k) continue;
    por.set(k, [...(por.get(k) ?? []), v]);
  }
  return [...por.entries()].map(([clave, vs]): FilaDeTiempo => {
    const xs = vs.map((v) => v.minutos);
    return {
      grupo, clave, n: xs.length, medianaMin: r1(mediana(xs)), mediaMin: r1(media(xs)), p90Min: r1(percentil(xs, 0.9)), maxMin: r1(Math.max(...xs)),
      planeadoMin: r1(mediana(vs.map((v) => v.minPlaneados))), atipicas: vs.filter((v) => v.atipica).length, fiable: xs.length >= MINIMO_DE_CASOS,
    };
  }).sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave));
}

// ---------------------------------------------------------------------------------------------------------------
// 4. La tarjeta de cada chofer
// ---------------------------------------------------------------------------------------------------------------

/** Un número de la tarjeta con lo que tiene detrás. `de`: cuántos casos podían haberse medido. */
export interface Medida {
  valor: number | null;
  n: number; de: number;
  /** `false`: poco dato. Se enseña en gris, con su «n de N», y no entra en ninguna comparación. */
  fiable: boolean;
  /** Puesto entre los choferes con dato fiable (1 = el mejor). `null` si no es fiable o no hay con quién comparar. */
  puesto: number | null;
}

export type ClaveDeMedida = "aTiempo" | "dentroDe30" | "minPorEntrega" | "minPorRecogida" | "toquesEnLaParada" | "fueraDeOrden" | "paradoMinPorDia" | "primeraSalidaMin" | "millasPorDia";

export interface TarjetaDeChofer {
  chofer: string; choferId: string | null;
  dias: number; diasConRastro: number; diasConCamion: number; diasConTelefono: number;
  paradas: number; paradasHechas: number; paradasConHora: number; paradasPorRastro: number;
  millas: number | null;
  medidas: Record<ClaveDeMedida, Medida>;
}

/** ¿Hay dato suficiente? `porDia`: la medida se cuenta en días (salida, parado, millas), no en casos. */
export function esFiable(n: number, de: number, porDia = false): boolean {
  if (n < (porDia ? MINIMO_DE_DIAS : MINIMO_DE_CASOS)) return false;
  return de > 0 && n / de >= COBERTURA_MINIMA;
}

/** En qué sentido es «mejor» cada medida, para el puesto. `null`: no se ordena (no es ni buena ni mala). */
const MEJOR: Record<ClaveDeMedida, "alto" | "bajo" | null> = {
  aTiempo: "alto", dentroDe30: "alto", minPorEntrega: "bajo", minPorRecogida: null, toquesEnLaParada: "alto", fueraDeOrden: "bajo",
  paradoMinPorDia: "bajo", primeraSalidaMin: null, millasPorDia: null,
};

export function tarjetasDeChoferes(dias: readonly InformeDelDia[], minutoLocal: (ms: number) => number): TarjetaDeChofer[] {
  const por = new Map<string, InformeDelDia[]>();
  for (const d of dias) por.set(d.chofer, [...(por.get(d.chofer) ?? []), d]);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const tarjetas = [...por.entries()].map(([chofer, ds]): TarjetaDeChofer => {
    const paradas = ds.flatMap((d) => d.paradas), conRastro = ds.filter((d) => d.rastro.fuente);
    const visitas = ds.flatMap((d) => d.visitas).filter((v) => !v.truncada);
    const m = (valor: number | null, n: number, de: number, porDia = false): Medida => ({ valor: n ? valor : null, n, de, fiable: esFiable(n, de, porDia), puesto: null });

    const entregas = paradas.filter((p) => p.tipo === "D" && p.hecha);
    const conVentana = entregas.filter((p) => p.sobreLaVentana != null);
    const est = estimadoContraReal(paradas.filter((p) => p.hecha), "plan");
    const conEstimado = paradas.filter((p) => p.hecha && p.eta != null).length;
    const vEntrega = visitas.filter((v) => v.clase === "entrega_cliente"), vRecogida = visitas.filter((v) => v.clase === "recogida_tienda");
    const visitasPosibles = (clase: ClaseDeVisita) => new Set(ds.flatMap((d) => d.paradas.filter((p) => p.hecha && (clase === "entrega_cliente" ? p.tipo === "D" && !p.esTienda : p.tipo === "P" && p.esTienda)).map((p) => `${d.fecha}|${p.lat?.toFixed(3)},${p.lng?.toFixed(3)}`))).size;
    const toques = ds.reduce((s, d) => ({ propios: s.propios + d.toques.propios, con: s.con + d.toques.conPosicion, en: s.en + d.toques.enLaParada, otros: s.otros + d.toques.deOtraPersona }), { propios: 0, con: 0, en: 0, otros: 0 });
    const comparadas = ds.reduce((s, d) => s + d.orden.comparadas, 0), fuera = ds.reduce((s, d) => s + d.orden.fueraDeOrden, 0);
    const conPlanYHechas = paradas.filter((p) => p.hecha && p.eta != null).length;
    const parados = ds.filter((d) => d.parado.minutos != null), salidas = ds.filter((d) => d.real.primeraSalida != null);
    const conMillas = ds.filter((d) => d.real.millasDelDia != null);
    const millas = conMillas.length ? Math.round(conMillas.reduce((s, d) => s + d.real.millasDelDia!, 0) * 10) / 10 : null;

    return {
      chofer, choferId: ds[0].choferId, dias: ds.length, diasConRastro: conRastro.length,
      diasConCamion: ds.filter((d) => d.rastro.fuente === "camion").length, diasConTelefono: ds.filter((d) => d.rastro.fuente === "telefono").length,
      paradas: paradas.length, paradasHechas: paradas.filter((p) => p.hecha).length, paradasConHora: paradas.filter((p) => p.llegada != null).length,
      paradasPorRastro: paradas.filter((p) => p.fuente === "camion" || p.fuente === "telefono").length, millas,
      medidas: {
        aTiempo: m(pct(conVentana.filter((p) => p.sobreLaVentana! <= 0).length, conVentana.length), conVentana.length, entregas.length),
        dentroDe30: m(pct(est.dentroDe30, est.n), est.n, conEstimado),
        minPorEntrega: m(r1(mediana(vEntrega.map((v) => v.minutos))), vEntrega.length, visitasPosibles("entrega_cliente")),
        minPorRecogida: m(r1(mediana(vRecogida.map((v) => v.minutos))), vRecogida.length, visitasPosibles("recogida_tienda")),
        // Sobre los toques del propio chofer cuya posición se conoce; `de` cuenta además los que marcó otra persona.
        toquesEnLaParada: m(pct(toques.en, toques.con), toques.con, toques.propios + toques.otros),
        fueraDeOrden: m(pct(fuera, comparadas), comparadas, conPlanYHechas),
        paradoMinPorDia: m(r0(media(parados.map((d) => d.parado.minutos!))), parados.length, ds.length, true),
        primeraSalidaMin: m(r0(mediana(salidas.map((d) => minutoLocal(d.real.primeraSalida!)))), salidas.length, ds.length, true),
        millasPorDia: m(conMillas.length && millas != null ? Math.round((millas / conMillas.length) * 10) / 10 : null, conMillas.length, ds.length, true),
      },
    };
  }).sort((a, b) => a.chofer.localeCompare(b.chofer));

  // Los puestos: solo entre los que tienen dato fiable, y solo si son dos o más.
  for (const clave of Object.keys(MEJOR) as ClaveDeMedida[]) {
    const sentido = MEJOR[clave];
    if (!sentido) continue;
    const fiables = tarjetas.filter((t) => t.medidas[clave].fiable && t.medidas[clave].valor != null);
    if (fiables.length < 2) continue;
    const orden = [...fiables].sort((a, b) => (sentido === "alto" ? b.medidas[clave].valor! - a.medidas[clave].valor! : a.medidas[clave].valor! - b.medidas[clave].valor!));
    orden.forEach((t, i) => {
      const prev = orden[i - 1];
      t.medidas[clave].puesto = prev && prev.medidas[clave].valor === t.medidas[clave].valor ? prev.medidas[clave].puesto : i + 1;
    });
  }
  return tarjetas;
}

// ---------------------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------------------

/** Una celda de CSV: comillas dobladas, y un apóstrofo delante de lo que Excel tomaría por fórmula (`=`, `+`, `-`, `@`). */
export function celdaCsv(v: string | number | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function aCsv(cabeceras: readonly string[], filas: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [cabeceras, ...filas].map((f) => f.map(celdaCsv).join(",")).join("\r\n") + "\r\n";
}
