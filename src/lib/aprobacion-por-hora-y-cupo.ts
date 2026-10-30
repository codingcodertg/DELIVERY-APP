import { parseWindow } from "./dispatch";
import { SATURDAY_WINDOW, WEEKDAY_ALL_DAY_WINDOW } from "./constants";
import { formateadorDeFecha } from "@/lib/formateador";

/**
 * Dos razones nuevas para que la orden de un vendedor vaya a aprobación de oficina en vez de nacer aprobada (D-639).
 *
 * Roberto Rodriguez Jr (admin), 2026-10-22, con la captura del Gestor:
 *
 * 1. *«Reps programmed 8 deliveries for the morning. This cannot be possible. Once 2 orders are assigned from 8:30-10am
 *    thats it. After that only 1 can be assigned to 8:30-12pm. This does not include Brownsville»* → **cupo de la
 *    mañana**: en una fecha caben 2 órdenes en «8:30-10» y 1 en «8:30-12», contando todas las tiendas menos las que
 *    tienen su propia flota (Brownsville).
 * 2. *«Cannot assign orders for the same day or for tomorrow morning after 4:30pm, flag it and notify office for
 *    approval. Let rep know it needs to be approved for those reasons»* → **hora de corte**: pasadas las 4:30 pm (hora
 *    de Texas), una orden para hoy, o para la mañana del siguiente día de trabajo, va a aprobación.
 *
 * Ninguna de las dos **prohíbe**: la orden se crea, pero en `pending`, el vendedor ve por qué y la oficina decide.
 * Prohibir dejaría al vendedor sin forma de pedir la excepción, y la oficina ya tiene el botón de aprobar.
 *
 * Lo que entra en la mañana del día siguiente son las ventanas que **acaban** a mediodía o antes (8:30-10 y 8:30-12):
 * «todo el día» y «tarde» no prometen la mañana. El «siguiente día de trabajo» salta el domingo: el sábado a las 5 pm,
 * la mañana que no se puede preparar es la del lunes.
 *
 * Todo vive en funciones puras y los números en Ajustes (`settings.approval_rules`, migración 190; sin la columna, los
 * de aquí): la pantalla que crea, la que envía el borrador y la ruta que cuenta el cupo dicen lo mismo.
 */

export interface ReglasDeAprobacion {
  /** «HH:MM» de Texas a partir del cual hoy y mañana temprano van a aprobación. Vacío = sin corte. */
  corte: string;
  /** Ventana («0830-1000») → cuántas órdenes caben ese día. Una ventana sin número no tiene cupo. */
  cupo: Record<string, number>;
  /** Tiendas que no cuentan para el cupo ni lo gastan (tienen su propia flota). */
  tiendas_sin_cupo: string[];
}

export const REGLAS_DE_APROBACION_POR_DEFECTO: ReglasDeAprobacion = {
  corte: "16:30",
  cupo: { "0830-1000": 2, "0830-1200": 1 },
  tiendas_sin_cupo: ["RDZ Brownsville"],
};

/**
 * Las franjas a las que Ajustes deja poner cupo (D-675). El dueño, a «Cupo en más franjas: Ajustes solo deja 0830-1000 y
 * 0830-1200»: «sí». El cupo siempre fue por ventana (`cupo`, cualquier clave, y así lo cuentan la ruta y la ficha); lo que
 * enseñaba solo dos era la tarjeta. Son las del selector de la orden (`presets`, en su orden) y, detrás, cualquier otra que
 * ya tenga cupo guardado, para que no desaparezca de la tarjeta.
 */
export function ventanasConCupoEditable(presets: readonly string[], reglas: ReglasDeAprobacion): string[] {
  return [...new Set([...presets, ...Object.keys(reglas.cupo)])];
}

/** Las reglas vigentes: lo guardado en Ajustes encima de los defectos, campo a campo. */
export function reglasDeAprobacion(guardadas: Partial<ReglasDeAprobacion> | null | undefined): ReglasDeAprobacion {
  const g = guardadas ?? {};
  return {
    corte: typeof g.corte === "string" ? g.corte : REGLAS_DE_APROBACION_POR_DEFECTO.corte,
    cupo: g.cupo && typeof g.cupo === "object" ? g.cupo : REGLAS_DE_APROBACION_POR_DEFECTO.cupo,
    tiendas_sin_cupo: Array.isArray(g.tiendas_sin_cupo) ? g.tiendas_sin_cupo : REGLAS_DE_APROBACION_POR_DEFECTO.tiendas_sin_cupo,
  };
}

/** La fecha («YYYY-MM-DD») y el minuto del día en Texas para ese instante. */
export function ahoraEnTexas(ahora: Date): { fecha: string; minuto: number } {
  const p = Object.fromEntries(
    formateadorDeFecha("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(ahora).map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, minuto: Number(p.hour) * 60 + Number(p.minute) };
}

/** El día de trabajo que sigue a esa fecha: el siguiente, saltando el domingo. Aritmética de calendario, sin zona. */
export function siguienteDiaDeTrabajo(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  if (t.getUTCDay() === 0) t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

const minutoDe = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** ¿La ventana es de mañana? La que acaba a mediodía o antes. */
export function esVentanaDeManana(ventana: string | null | undefined): boolean {
  const tramo = parseWindow(ventana ?? "");
  return !!tramo && tramo[1] <= 12 * 60;
}

const clave = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** ¿Esta tienda queda fuera del cupo de la mañana? */
export const tiendaSinCupo = (tienda: string | null | undefined, reglas: ReglasDeAprobacion): boolean =>
  !!clave(tienda) && reglas.tiendas_sin_cupo.some((t) => clave(t) === clave(tienda));

export type MotivoDeAprobacion =
  | { tipo: "corte_hoy"; corte: string }
  | { tipo: "corte_manana"; corte: string }
  | { tipo: "cupo"; ventana: string; tope: number; ocupadas: number };

/**
 * ¿Llega tarde para la hora de corte? Pasado el corte, una orden para hoy (o un día ya pasado) o para la mañana del
 * siguiente día de trabajo. Antes del corte, nada.
 */
export function motivoPorHora(
  orden: { delivery_date?: string | null; delivery_windows?: string | null },
  ahora: Date,
  reglas: ReglasDeAprobacion,
): MotivoDeAprobacion | null {
  const corte = minutoDe(reglas.corte);
  const fecha = (orden.delivery_date ?? "").slice(0, 10);
  if (corte == null || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const hoy = ahoraEnTexas(ahora);
  if (hoy.minuto < corte) return null;
  if (fecha <= hoy.fecha) return { tipo: "corte_hoy", corte: reglas.corte };
  if (fecha === siguienteDiaDeTrabajo(hoy.fecha) && esVentanaDeManana(orden.delivery_windows)) return { tipo: "corte_manana", corte: reglas.corte };
  return null;
}

/** Las órdenes que gastan cupo: las vivas —ni borrador, ni anulada, ni rechazada—, reales, de una tienda con cupo. */
const ETAPAS_SIN_CUPO = new Set(["draft", "canceled", "rejected"]);

export interface FilaDeCupo { id: string; store: string | null; delivery_windows: string | null; stage: string | null; is_training?: boolean | null }

/**
 * «Todo el día» se llena con TODAS las órdenes del día (D-712). El dueño: «esas órdenes de la mañana también cuentan para
 * all day… para que sepan cuántas órdenes hay en all day y que haya un límite. O sea, todas juntas». Las otras franjas
 * siguen contando solo las suyas (Mañana no suma Madrugada: es la regla de Roberto, D-639).
 */
export const VENTANAS_DE_TODO_EL_DIA: readonly string[] = [WEEKDAY_ALL_DAY_WINDOW, SATURDAY_WINDOW];
export const esTodoElDia = (v: string | null | undefined): boolean => VENTANAS_DE_TODO_EL_DIA.includes(v ?? "");

/**
 * Cuántas órdenes hay ya en cada ventana con cupo, y en «todo el día» siempre (sin contar `excluir`, que es la propia
 * orden al editarla). «Todo el día» suma las de cualquier ventana.
 */
export function ocupadasPorVentana(filas: readonly FilaDeCupo[], reglas: ReglasDeAprobacion, excluir?: string | null): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const v of [...Object.keys(reglas.cupo), ...VENTANAS_DE_TODO_EL_DIA]) cuenta[v] = 0;
  for (const f of filas) {
    if (f.id === excluir || f.is_training || ETAPAS_SIN_CUPO.has(f.stage ?? "")) continue;
    if (tiendaSinCupo(f.store, reglas)) continue;
    const v = f.delivery_windows ?? "";
    for (const todo of VENTANAS_DE_TODO_EL_DIA) cuenta[todo] += 1;
    if (v in cuenta && !esTodoElDia(v)) cuenta[v] += 1;
  }
  return cuenta;
}

/** ¿Ya está lleno el cupo de la ventana de esta orden? `ocupadas` no incluye a la propia orden. */
export function motivoPorCupo(
  orden: { store?: string | null; delivery_windows?: string | null },
  ocupadas: Record<string, number> | null,
  reglas: ReglasDeAprobacion,
): MotivoDeAprobacion | null {
  const ventana = orden.delivery_windows ?? "";
  const tope = reglas.cupo[ventana];
  if (ocupadas == null || typeof tope !== "number" || tiendaSinCupo(orden.store, reglas)) return null;
  const n = ocupadas[ventana] ?? 0;
  return n >= tope ? { tipo: "cupo", ventana, tope, ocupadas: n } : null;
}

/** Las dos a la vez, en el orden en que se le explican al vendedor. */
export function motivosDeAprobacion(
  orden: { delivery_date?: string | null; delivery_windows?: string | null; store?: string | null },
  ahora: Date,
  ocupadas: Record<string, number> | null,
  reglas: ReglasDeAprobacion,
): MotivoDeAprobacion[] {
  return [motivoPorHora(orden, ahora, reglas), motivoPorCupo(orden, ocupadas, reglas)].filter((m): m is MotivoDeAprobacion => !!m);
}

const enDoce = (m: number): string => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const hora12 = (hhmm: string): string => {
  const m = minutoDe(hhmm);
  return m == null ? hhmm : enDoce(m);
};
const ventanaLegible = (v: string): string => {
  const t = parseWindow(v);
  return t ? `${enDoce(t[0])}-${enDoce(t[1])}` : v;
};

/** Lo que lee el vendedor (y la oficina en el aviso), en una línea por motivo. */
export function textoDelMotivo(m: MotivoDeAprobacion, es: boolean): string {
  switch (m.tipo) {
    case "corte_hoy":
      return es ? `Es para hoy y ya pasaron las ${hora12(m.corte)}` : `It's for today and it's past ${hora12(m.corte)}`;
    case "corte_manana":
      return es ? `Es para mañana temprano y ya pasaron las ${hora12(m.corte)}` : `It's for tomorrow morning and it's past ${hora12(m.corte)}`;
    case "cupo":
      return es
        ? `La ventana ${ventanaLegible(m.ventana)} ya tiene ${m.ocupadas} de ${m.tope} órdenes ese día`
        : `The ${ventanaLegible(m.ventana)} window already has ${m.ocupadas} of ${m.tope} orders that day`;
  }
}
