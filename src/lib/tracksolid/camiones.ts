import { hasCap, tieneAccesoAEntregas, type CapUser } from "@/lib/constants";
import { formateadorDeFecha } from "@/lib/formateador";
import { BUSINESS_TZ } from "@/lib/utils";

// ============================================================
// Los camiones de la empresa, vistos por su rastreador GPS (TrackSolid Pro) — D-900.
//
// Sin React, sin red y sin llaves: lo usan el servidor (para traducir lo que manda Jimi) y el navegador
// (para decidir cómo se pinta cada camión). Aquí vive lo que hay que poder probar: las unidades, qué es
// «sin señal» y quién puede verlos.
//
// DOS horas distintas por camión, y no son lo mismo (medido con la cuenta real el 2026-11-06):
//   · `posicionEn`  — cuándo se tomó el punto GPS que se pinta;
//   · `contactoEn`  — la última vez que el rastreador habló (punto GPS o latido).
// Un camión estacionado con el motor apagado sigue latiendo cada pocos minutos pero no manda puntos
// nuevos: su posición puede tener tres días y el aparato estar perfectamente vivo. Por eso «sin señal» se
// decide con `contactoEn`, no con la posición — si no, todo camión estacionado se vería averiado.
// ============================================================

/** Un camión tal como lo devuelve `/api/tracksolid/trucks`. */
export type CamionDeTracksolid = {
  imei: string;
  /** El nombre que tiene en TrackSolid («EDINBURG PETERBIL»). */
  nombre: string;
  lat: number | null;
  lng: number | null;
  velocidadKmh: number;
  /** ISO. Cuándo se tomó el punto que se pinta. */
  posicionEn: string | null;
  /** ISO. Última vez que el rastreador reportó algo (punto o latido). */
  contactoEn: string | null;
  /** Encendido del motor (ACC), si el aparato lo reporta. */
  encendido: boolean | null;
  /** Enlace hecho en Ajustes (257): el chofer y/o la tienda base. */
  choferId: string | null;
  chofer: string | null;
  tienda: string | null;
};

/** Lo que manda Jimi en `jimi.user.device.location.list` (lo que se usa; casi todo llega como texto). */
export type EquipoCrudo = {
  imei?: string | null; deviceName?: string | null; lat?: number | string | null; lng?: number | string | null;
  speed?: number | string | null; gpsTime?: string | null; hbTime?: string | null; accStatus?: number | string | null;
};

/** Pasados estos minutos sin que el rastreador reporte NADA, el camión está «sin señal». */
export const MINUTOS_SIN_SENAL = 15;
/** Por debajo de esto (mph) no se llama «en movimiento»: el GPS parado baila 1-2 km/h. */
export const MPH_EN_MOVIMIENTO = 2;

/** km/h (lo que manda Jimi) a mph (lo que se enseña), al entero. */
export function kmhAMph(kmh: number | string | null | undefined): number {
  const n = Number(kmh);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 0.621371) : 0;
}

/** «2026-11-06 14:39:21» de Jimi, que va en UTC, a ISO. `null` si no es una fecha. */
export function fechaDeJimi(texto: string | null | undefined): string | null {
  if (!texto || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(texto.trim())) return null;
  const d = new Date(texto.trim().replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Un equipo de Jimi, limpio. Sin IMEI no hay camión; con 0,0 (aparato caducado o sin fijar) no hay posición. */
export function camionDesdeJimi(e: EquipoCrudo): Omit<CamionDeTracksolid, "choferId" | "chofer" | "tienda"> | null {
  const imei = String(e.imei ?? "").trim();
  if (!imei) return null;
  const lat = Number(e.lat), lng = Number(e.lng);
  const hayPunto = e.lat != null && e.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  const posicionEn = fechaDeJimi(e.gpsTime), latido = fechaDeJimi(e.hbTime);
  const contactoEn = posicionEn && latido ? (posicionEn > latido ? posicionEn : latido) : posicionEn ?? latido;
  const acc = e.accStatus == null || e.accStatus === "" ? null : String(e.accStatus) === "1";
  return {
    imei, nombre: String(e.deviceName ?? "").trim() || imei,
    lat: hayPunto ? lat : null, lng: hayPunto ? lng : null,
    velocidadKmh: Math.max(0, Number(e.speed) || 0),
    posicionEn, contactoEn, encendido: acc,
  };
}

/** Minutos desde una hora ISO; `Infinity` si no hay. */
export function minutosDesde(iso: string | null | undefined, ahoraMs: number): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Infinity : Math.max(0, (ahoraMs - t) / 60000);
}

export type EstadoDelCamion = "moving" | "idling" | "parked" | "stale";

/**
 * Qué está haciendo el camión AHORA.
 *   · `stale`  — el rastreador lleva más de 15 min callado: lo que se pinta es dónde ESTABA;
 *   · `moving` — motor encendido (o sin dato de motor) y un punto reciente con velocidad;
 *   · `idling` — motor encendido y parado;
 *   · `parked` — motor apagado.
 * La velocidad de un punto viejo no cuenta: «iba a 7 km/h hace diez días» no es moverse.
 */
export function estadoDelCamion(c: Pick<CamionDeTracksolid, "contactoEn" | "posicionEn" | "velocidadKmh" | "encendido">, ahoraMs: number): EstadoDelCamion {
  if (minutosDesde(c.contactoEn, ahoraMs) > MINUTOS_SIN_SENAL) return "stale";
  const puntoReciente = minutosDesde(c.posicionEn, ahoraMs) <= MINUTOS_SIN_SENAL;
  if (c.encendido !== false && puntoReciente && kmhAMph(c.velocidadKmh) >= MPH_EN_MOVIMIENTO) return "moving";
  return c.encendido ? "idling" : "parked";
}

type T = (en: string, es: string) => string;

/** «just now», «4 min ago», «3 h ago», «10 d ago». */
export function haceCuanto(minutos: number, t: T): string {
  if (!Number.isFinite(minutos)) return t("never", "nunca");
  if (minutos < 1) return t("just now", "ahora mismo");
  if (minutos < 60) return t(`${Math.round(minutos)} min ago`, `hace ${Math.round(minutos)} min`);
  if (minutos < 48 * 60) return t(`${Math.round(minutos / 60)} h ago`, `hace ${Math.round(minutos / 60)} h`);
  return t(`${Math.round(minutos / 1440)} d ago`, `hace ${Math.round(minutos / 1440)} d`);
}

/** La hora local de la empresa: «8:39 AM» si es de hoy, «Oct 26, 5:00 PM» si no. */
export function horaLocal(iso: string | null | undefined, ahoraMs: number, lang: "en" | "es" = "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dia = (x: Date) => formateadorDeFecha("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const local = lang === "es" ? "es-US" : "en-US";
  const hora = formateadorDeFecha(local, { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  if (dia(d) === dia(new Date(ahoraMs))) return hora;
  return `${formateadorDeFecha(local, { timeZone: BUSINESS_TZ, month: "short", day: "numeric" }).format(d)}, ${hora}`;
}

/** Lo que el mapa escribe de un camión: la etiqueta corta bajo la marca y las líneas de su tarjeta. */
export function textoDelCamion(c: CamionDeTracksolid, ahoraMs: number, t: T, lang: "en" | "es" = "en"): { estado: EstadoDelCamion; etiqueta: string; titulo: string; lineas: string[] } {
  const estado = estadoDelCamion(c, ahoraMs);
  const mph = kmhAMph(c.velocidadKmh);
  const quien = c.chofer || c.nombre;
  const contacto = minutosDesde(c.contactoEn, ahoraMs), punto = minutosDesde(c.posicionEn, ahoraMs);
  const queHace =
    estado === "stale" ? t(`No signal since ${horaLocal(c.contactoEn, ahoraMs, lang)} (${haceCuanto(contacto, t)})`, `Sin señal desde ${horaLocal(c.contactoEn, ahoraMs, lang)} (${haceCuanto(contacto, t)})`)
    : estado === "moving" ? t(`Moving · ${mph} mph`, `En movimiento · ${mph} mph`)
    : estado === "idling" ? t("Stopped · engine on", "Detenido · motor encendido")
    : t("Parked · engine off", "Estacionado · motor apagado");
  const lineas = [queHace];
  if (estado === "stale") {
    lineas.push(t("This is its last known position, not where it is now.", "Esta es su última posición conocida, no dónde está ahora."));
  } else {
    lineas.push(t(`Last reported ${haceCuanto(contacto, t)} (${horaLocal(c.contactoEn, ahoraMs, lang)})`, `Último reporte ${haceCuanto(contacto, t)} (${horaLocal(c.contactoEn, ahoraMs, lang)})`));
    // Estacionado: el punto es de cuando se detuvo. Se dice, para que nadie lea «posición de hace 3 días» como avería.
    if (punto > MINUTOS_SIN_SENAL) lineas.push(t(`Hasn't moved since ${horaLocal(c.posicionEn, ahoraMs, lang)}`, `No se mueve desde ${horaLocal(c.posicionEn, ahoraMs, lang)}`));
    else if (punto - contacto >= 2) lineas.push(t(`Position from ${haceCuanto(punto, t)}`, `Posición de ${haceCuanto(punto, t)}`));
  }
  if (c.chofer) lineas.push(t(`Driver: ${c.chofer}`, `Chofer: ${c.chofer}`));
  if (c.tienda) lineas.push(t(`Home store: ${c.tienda}`, `Tienda base: ${c.tienda}`));
  const etiqueta = estado === "stale" ? `${quien} · ${t("no signal", "sin señal")}` : estado === "moving" ? `${quien} · ${mph} mph` : quien;
  return { estado, etiqueta, titulo: c.chofer ? `${c.nombre} · ${c.chofer}` : c.nombre, lineas };
}

/** Color de un camión sin chofer enlazado: pizarra oscura, que no es el de ninguna ruta. */
export const COLOR_DE_CAMION_SIN_CHOFER = "#334155";

/**
 * ¿Puede ver los camiones? Los mismos que ven la vista de planificación del Gestor de Rutas: el módulo de
 * Entregas y `route_plan` (admin y logística por rol; cualquier otro, si un admin se lo concedió).
 */
export function puedeVerCamiones(u: (CapUser & { module_access?: string[] | null }) | null | undefined): boolean {
  return !!u && tieneAccesoAEntregas(u) && hasCap(u, "route_plan");
}

/** Enlazar rastreadores a choferes y tiendas es de Ajustes, y Ajustes es del admin. */
export function puedeEnlazarCamiones(u: { role: string } | null | undefined): boolean {
  return u?.role === "admin";
}
