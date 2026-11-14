import { formateadorDeFecha } from "@/lib/formateador";
import { BUSINESS_TZ } from "@/lib/utils";

/**
 * RTG PROMOS — cuándo se subió el archivo de una ronda, dicho para quien mira la tabla.
 *
 * **Por qué existe.** Las existencias (QOH) son una foto del Excel que se subió; no se actualizan
 * solas. Sin la fecha, quien decide no puede saber si el número que ve es de hoy o de hace un mes.
 *
 * **Qué fecha es.** `promo_rounds.uploaded_at`, el momento en que se escribió la ronda. No hay
 * `updated_at` en la tabla y las filas de producto no llevan marca de tiempo, así que una ronda
 * «re-subida» no existe como tal: se sube otra ronda nueva. Cerrar o reabrir (`closed_at`,
 * `reopened_at`) no cambia las existencias, así que no cuenta como subida.
 *
 * La hora sale en `America/Chicago` (`BUSINESS_TZ`), igual que el resto de la app, y con el
 * formateador cacheado de `formateador.ts`.
 */

export type LenguaDePromos = "en" | "es";

/** La fecha de subida, legible. `conHora: false` para las opciones del selector, donde sobra. */
export function fechaDeSubida(iso: string, lang: LenguaDePromos, conHora = true): string {
  const fmt = formateadorDeFecha(lang === "es" ? "es-MX" : "en-US", {
    timeZone: BUSINESS_TZ,
    dateStyle: "medium",
    ...(conHora ? { timeStyle: "short" as const } : {}),
  });
  return fmt.format(new Date(iso));
}

/**
 * «Uploaded Nov 14, 2026, 3:05 PM by Ana» / «Subido el 14 nov 2026, 15:05 por Ana».
 *
 * `nombre`: `null` cuando no hay quién subió (una ronda cargada por el script, sin usuario); la
 * cadena vacía o `"?"` no se usan. Si hubo usuario pero no se pudo leer su nombre, el llamante pasa
 * `""` y aquí sale «alguien» / «someone», igual que el panel de votos.
 */
export function lineaDeSubida(args: { iso: string; lang: LenguaDePromos; nombre: string | null }): string {
  const fecha = fechaDeSubida(args.iso, args.lang);
  if (args.nombre === null) return args.lang === "es" ? `Subido el ${fecha}` : `Uploaded ${fecha}`;
  const quien = args.nombre.trim() || (args.lang === "es" ? "alguien" : "someone");
  return args.lang === "es" ? `Subido el ${fecha} por ${quien}` : `Uploaded ${fecha} by ${quien}`;
}

/** El tooltip de la cabecera QOH: la misma fecha, con la advertencia de que no es en vivo. */
export function tooltipDeQoh(iso: string, lang: LenguaDePromos): string {
  const fecha = fechaDeSubida(iso, lang);
  return lang === "es"
    ? `Existencias al ${fecha} (archivo subido; no se actualizan)`
    : `QOH as of ${fecha} (uploaded file; not live)`;
}
