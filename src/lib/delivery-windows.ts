import { DELIVERY_WINDOW_PRESETS, SATURDAY_WINDOW, WEEKDAY_ALL_DAY_WINDOW, type WindowPreset } from "./constants";
import { parseWindow } from "./dispatch";

/**
 * Qué ventanas de entrega se ofrecen según el día (D-296).
 *
 * El dueño: *«delivery window: la ventana de sábado solo debe estar disponible cuando se elige un
 * sábado»*. El selector las enseñaba las cinco siempre, así que se podía pedir «sábado 8:30-3:30» para
 * un martes y «todo el día 8:30-5:30» para un sábado, que son horarios que no existen ese día.
 *
 * Se quitan dos cosas, y la segunda la decidió el dueño al preguntarle:
 *
 * 1. **La pareja de «todo el día»**, una por tipo de día: en sábado no se ofrece la de entre semana, y
 *    el resto de días no se ofrece la de sábado.
 * 2. **Ninguna ventana que termine después del cierre de ese día.** En sábado eso deja fuera «Tarde
 *    (12-5:30)», porque el sábado se cierra a las 3:30 y ofrecerla sería prometer una entrega después
 *    del cierre. Quedan madrugada, mañana y la de sábado.
 *
 * **La hora de cierre no es una constante nueva**: es el final de la ventana «todo el día» de ese día
 * — sábado 15:30 (`SATURDAY_WINDOW`), resto 17:30 (`WEEKDAY_ALL_DAY_WINDOW`). Si algún día cambia el
 * horario, se cambia ahí y esto lo sigue solo.
 *
 * Y la ventana **que la orden ya tiene se ofrece siempre**, aunque no toque ese día (D-267): una orden
 * vieja tiene que poder abrirse sin que el selector la borre ni la enseñe vacía.
 */

/**
 * ¿Esta fecha cae en sábado?
 *
 * **Sin zona horaria, a propósito.** `delivery_date` es una fecha sin hora, y una fecha sin hora no
 * tiene zona: su día de la semana es el mismo en todo el mundo. Lo que introduce el error es
 * convertirla a un instante — medido el 2026-09-17: `new Date("2026-09-19").getDay()` devuelve
 * **viernes** en America/Chicago, America/Guatemala y Pacific/Niue, y sábado en UTC y en Kiritimati.
 * O sea que el fallo clásico solo asoma en los husos negativos, que son los nuestros, y una prueba
 * corrida en UTC —como la de CI— lo dejaría pasar. Por eso aquí se leen las partes y se arma el día
 * con aritmética, y por eso la prueba cambia `process.env.TZ` en vez de fiarse del huso de quien corra.
 */
export function esSabado(iso: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? "").trim());
  if (!m) return false;
  const [, y, mes, dia] = m;
  const d = new Date(Date.UTC(Number(y), Number(mes) - 1, Number(dia)));
  // Una fecha imposible (31 de febrero) se desborda al mes siguiente: no se acepta como válida.
  if (d.getUTCMonth() !== Number(mes) - 1 || d.getUTCDate() !== Number(dia)) return false;
  return d.getUTCDay() === 6;
}

/** La ventana «todo el día» que le toca a esa fecha. */
export function ventanaDeTodoElDia(iso: string | null | undefined): string {
  return esSabado(iso) ? SATURDAY_WINDOW : WEEKDAY_ALL_DAY_WINDOW;
}

/** La otra: la que ese día NO se ofrece, y la que el formulario sustituye al cambiar la fecha. */
export function ventanaDelOtroTipoDeDia(iso: string | null | undefined): string {
  return esSabado(iso) ? WEEKDAY_ALL_DAY_WINDOW : SATURDAY_WINDOW;
}

/**
 * Las ventanas que ofrece el selector para esa fecha, más la que la orden ya tiene.
 *
 * Sin fecha se ofrecen **todas**: mientras no se sabe qué día es, esconder una sería adivinar.
 */
export function ventanasParaLaFecha(iso: string | null | undefined, actual?: string | null): WindowPreset[] {
  const presets = DELIVERY_WINDOW_PRESETS;
  const fecha = (iso ?? "").trim();
  if (!fecha) return [...presets];
  const fuera = ventanaDelOtroTipoDeDia(fecha);
  const cierre = cierraA(fecha);
  return presets.filter((p) => {
    if (p.value === (actual ?? "")) return true;          // la que la orden ya tiene, siempre
    if (p.value === fuera) return false;                  // la «todo el día» del otro tipo de día
    const tramo = parseWindow(p.value);
    return !tramo || tramo[1] <= cierre;                  // y nada que acabe después del cierre
  });
}

/** El minuto en que cierra ese día: el final de su ventana de «todo el día». */
export function cierraA(iso: string | null | undefined): number {
  return parseWindow(ventanaDeTodoElDia(iso))?.[1] ?? Infinity;
}
