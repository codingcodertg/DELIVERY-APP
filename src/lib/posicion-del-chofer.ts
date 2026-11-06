import type { DriverLocation } from "@/lib/types";
import { estadoDelCamion, minutosDesde, type CamionDeTracksolid } from "@/lib/tracksolid/camiones";
import { metrosEntre } from "@/lib/route-plan/llegadas";

// ============================================================
// UNA posición por chofer, de DOS fuentes: su teléfono y el rastreador de su camión (D-NEXT).
//
// El dueño: «give me the option to assign trucks to drivers so the phone and the truck support each other».
// El teléfono se queda sin datos, sin batería o con la app cerrada; el rastreador del camión no depende de
// nada de eso, pero es del CAMIÓN, no de la persona, y solo vale si hoy el chofer lleva ese camión.
//
// Todo lo que quiera saber «dónde está el chofer ahora» pasa por `posicionesDeChoferes`: devuelve la lista
// en la MISMA forma que `driver_locations` (una fila por chofer), así que entra donde ya entraba la del
// teléfono —`choferesEnVivo`, la etiqueta EN VIVO, el «ubícame a este chofer»— sin que cada pantalla
// vuelva a escribir la regla.
//
// LA REGLA (`posicionFusionada`), en orden:
//   1. Una fuente VALE si su dato tiene 10 minutos o menos (`MINUTOS_FRESCO`).
//        · teléfono: la hora del fijo;
//        · camión: con el motor encendido, la hora de su último punto GPS; con el motor apagado (o sin dato
//          de motor), la de su último contacto — un camión estacionado no manda puntos nuevos, pero su
//          rastreador sigue latiendo, y mientras lata el camión sigue donde se detuvo.
//   2. Si solo vale una, esa.
//   3. Si no vale ninguna, la menos vieja de las dos mientras tenga menos de una hora (el mapa la pinta gris,
//      como hacía ya con el teléfono). Con más de una hora no hay posición.
//   4. Si valen las dos y están JUNTAS (a menos de ~1 milla, más lo que un camión recorre en el tiempo que
//      separa los dos datos):
//        · teléfono con mala precisión (dice estar a más de 200 m) → el camión;
//        · si no, la más nueva; a menos de 30 s de diferencia, el camión (un GPS fijo con antena).
//   5. Si valen las dos y están SEPARADAS, no se adivina:
//        · una se mueve y la otra no → la que se mueve (un teléfono olvidado en la tienda, o un camión que
//          hoy no es el suyo y sigue estacionado);
//        · si no → el teléfono, que es de la persona; el camión es suyo solo porque alguien lo asignó.
//      Y si siguen separadas varios minutos, la marca lo avisa: «¿camión equivocado?».
// ============================================================

/** Lo que se necesita del camión que el chofer lleva hoy. */
export type CamionDelChofer = Pick<CamionDeTracksolid, "imei" | "nombre" | "lat" | "lng" | "velocidadKmh" | "posicionEn" | "contactoEn" | "encendido"> & { driverId: string };

export type FuenteDePosicion = "phone" | "truck";
export type MotivoDeLaFuente = "only" | "fresher" | "accuracy" | "other_is_still" | "person" | "old";

/** Un dato con más minutos que esto ya no «vale»: la otra fuente, si está fresca, manda. */
export const MINUTOS_FRESCO = 10;
/** Pasado esto, ni como «última posición conocida» (el mismo corte de `choferesEnVivo`). */
export const MINUTOS_MAXIMOS = 60;
/** Un teléfono que dice estar a más de esto no gana a un rastreador fresco. */
export const PRECISION_MALA_M = 200;
/** ~1 milla: más lejos que esto, teléfono y camión no están en el mismo sitio. */
export const METROS_SEPARADOS = 1609;
/** Lo que se le perdona por segundo de diferencia entre los dos datos (~70 mph). */
export const HOLGURA_MPS = 31;
/** Menos diferencia que esto es «a la vez»: gana el camión. */
export const EMPATE_S = 30;
/** El teléfono se mueve a partir de aquí (~2 mph), igual que el camión (`MPH_EN_MOVIMIENTO`). */
export const TELEFONO_SE_MUEVE_MPS = 1;
/** Separados durante estos minutos seguidos, se avisa. */
export const MINUTOS_PARA_AVISAR = 3;

export type Fusion = {
  lat: number;
  lng: number;
  fuente: FuenteDePosicion;
  motivo: MotivoDeLaFuente;
  /** ISO: de cuándo es el dato elegido. */
  en: string;
  /** Solo del teléfono: el rastreador no dice su precisión. */
  accuracy_m: number | null;
  /** Minutos de cada fuente; `null` si esa fuente no tiene dato. */
  telefonoMin: number | null;
  camionMin: number | null;
  /** Las dos valen y no están en el mismo sitio. */
  separados: boolean;
  /** Metros entre las dos, si las dos tienen punto. */
  metros: number | null;
};

/** ISO de cuándo «vale» la posición del camión (ver la regla 1), o `null` si no tiene punto. */
export function horaDelCamion(c: Pick<CamionDelChofer, "lat" | "lng" | "posicionEn" | "contactoEn" | "encendido">): string | null {
  if (c.lat == null || c.lng == null) return null;
  return c.encendido === true ? c.posicionEn : c.contactoEn ?? c.posicionEn;
}

type Telefono = Pick<DriverLocation, "lat" | "lng" | "accuracy_m" | "speed_mps" | "recorded_at">;

export function posicionFusionada(tel: Telefono | null | undefined, cam: CamionDelChofer | null | undefined, ahoraMs: number): Fusion | null {
  const horaCam = cam ? horaDelCamion(cam) : null;
  const tMin = tel ? minutosDesde(tel.recorded_at, ahoraMs) : Infinity;
  const cMin = horaCam ? minutosDesde(horaCam, ahoraMs) : Infinity;
  const hayTel = !!tel && Number.isFinite(tMin), hayCam = !!cam && Number.isFinite(cMin);
  const metros = hayTel && hayCam ? metrosEntre(tel!, { lat: cam!.lat!, lng: cam!.lng! }) : null;
  const comun = { telefonoMin: hayTel ? tMin : null, camionMin: hayCam ? cMin : null, metros };
  const delTelefono = (motivo: MotivoDeLaFuente, separados = false): Fusion =>
    ({ lat: tel!.lat, lng: tel!.lng, fuente: "phone", motivo, en: tel!.recorded_at, accuracy_m: tel!.accuracy_m ?? null, separados, ...comun });
  const delCamion = (motivo: MotivoDeLaFuente, separados = false): Fusion =>
    ({ lat: cam!.lat!, lng: cam!.lng!, fuente: "truck", motivo, en: horaCam!, accuracy_m: null, separados, ...comun });

  const telVale = hayTel && tMin <= MINUTOS_FRESCO, camVale = hayCam && cMin <= MINUTOS_FRESCO;
  if (telVale && !camVale) return delTelefono("only");
  if (camVale && !telVale) return delCamion("only");
  if (!telVale && !camVale) {
    const mejor = Math.min(tMin, cMin);
    if (mejor > MINUTOS_MAXIMOS) return null;
    return tMin <= cMin ? delTelefono("old") : delCamion("old");
  }

  const segundosEntre = Math.abs(tMin - cMin) * 60;
  if (metros! > METROS_SEPARADOS + HOLGURA_MPS * segundosEntre) {
    const camSeMueve = estadoDelCamion(cam!, ahoraMs) === "moving";
    const telSeMueve = (tel!.speed_mps ?? 0) >= TELEFONO_SE_MUEVE_MPS;
    if (camSeMueve && !telSeMueve) return delCamion("other_is_still", true);
    if (telSeMueve && !camSeMueve) return delTelefono("other_is_still", true);
    return delTelefono("person", true);
  }
  if ((tel!.accuracy_m ?? 0) > PRECISION_MALA_M) return delCamion("accuracy");
  if (segundosEntre <= EMPATE_S) return delCamion("fresher");
  return tMin < cMin ? delTelefono("fresher") : delCamion("fresher");
}

/** La posición de un chofer, en la forma de `driver_locations` y con lo que dijo la fusión. */
export interface PosicionDeChofer extends DriverLocation {
  /** `undefined`: chofer sin camión hoy (sale como siempre, solo teléfono). */
  fusion?: Fusion & { camion: { imei: string; nombre: string }; /** Llevan separados varios minutos seguidos. */ aviso: boolean };
}

/** Desde cuándo se ve separado cada chofer (por `driver_id`). La de la app es una sola, para todas las pantallas. */
export type MemoriaDeSeparados = Map<string, number>;
const memoriaDeLaApp: MemoriaDeSeparados = new Map();

/** La posición más nueva del teléfono de cada chofer. */
function ultimaPorChofer(posiciones: readonly DriverLocation[]): Map<string, DriverLocation> {
  const out = new Map<string, DriverLocation>();
  for (const p of posiciones) {
    const ya = out.get(p.driver_id);
    if (!ya || p.recorded_at > ya.recorded_at) out.set(p.driver_id, p);
  }
  return out;
}

/**
 * LA función: dónde está cada chofer ahora, con la mejor fuente. Una fila por chofer.
 *
 *   · chofer SIN camión hoy → su última posición de teléfono, tal cual (como antes de este cambio);
 *   · chofer CON camión hoy → la fusión de las dos; si el teléfono no ha reportado nunca, sale igual, por el
 *     camión. Si ninguna de las dos fuentes tiene menos de una hora, queda la del teléfono (vieja), como antes.
 *
 * `camiones` son SOLO los asignados a un chofer hoy y que quien mira puede ver (los da
 * `/api/tracksolid/assignments?live=1`). Sin camiones, devuelve lo mismo que entró: quien no tiene
 * TrackSolid no nota nada.
 */
export function posicionesDeChoferes(
  posiciones: readonly DriverLocation[],
  camiones: readonly CamionDelChofer[],
  ahoraMs: number = Date.now(),
  memoria: MemoriaDeSeparados = memoriaDeLaApp,
): PosicionDeChofer[] {
  const telefonos = ultimaPorChofer(posiciones);
  const camionDe = new Map(camiones.map((c) => [c.driverId, c]));
  const out: PosicionDeChofer[] = [];
  const pon = (driverId: string, tel: DriverLocation | undefined) => {
    const cam = camionDe.get(driverId);
    if (!cam) { if (tel) out.push(tel); return; }
    const f = posicionFusionada(tel, cam, ahoraMs);
    if (!f) { memoria.delete(driverId); if (tel) out.push(tel); return; }
    let aviso = false;
    if (f.separados) {
      const desde = memoria.get(driverId) ?? ahoraMs;
      memoria.set(driverId, desde);
      aviso = ahoraMs - desde >= MINUTOS_PARA_AVISAR * 60_000;
    } else memoria.delete(driverId);
    const fusion = { ...f, camion: { imei: cam.imei, nombre: cam.nombre }, aviso };
    out.push(f.fuente === "phone"
      ? { ...tel!, fusion }
      : {
        id: `truck-${cam.imei}`, driver_id: driverId, lat: f.lat, lng: f.lng, accuracy_m: null,
        speed_mps: cam.velocidadKmh > 0 ? cam.velocidadKmh / 3.6 : 0, heading: null, battery_pct: null,
        recorded_at: f.en, created_at: f.en, fusion,
      });
  };
  for (const [driverId, tel] of telefonos) pon(driverId, tel);
  for (const c of camiones) if (!telefonos.has(c.driverId)) pon(c.driverId, undefined);
  return out;
}

type T = (en: string, es: string) => string;

/** «20 s ago», «6 min ago», «3 h ago». */
export function haceCuantoCorto(minutos: number, t: T): string {
  if (minutos < 1) { const s = Math.max(1, Math.round(minutos * 60)); return t(`${s} s ago`, `hace ${s} s`); }
  if (minutos < 60) return t(`${Math.round(minutos)} min ago`, `hace ${Math.round(minutos)} min`);
  if (minutos < 48 * 60) return t(`${Math.round(minutos / 60)} h ago`, `hace ${Math.round(minutos / 60)} h`);
  return t(`${Math.round(minutos / 1440)} d ago`, `hace ${Math.round(minutos / 1440)} d`);
}

/** Lo que la tarjeta de la marca dice de un chofer con camión: qué camión, qué fuente se usa y la edad de cada una. */
export function textoDeLaFusion(f: NonNullable<PosicionDeChofer["fusion"]>, t: T): { lineas: string[]; aviso: string | null } {
  const tel = f.telefonoMin == null ? t("Phone: no data", "Teléfono: sin datos") : t(`Phone, ${haceCuantoCorto(f.telefonoMin, t)}`, `Teléfono, ${haceCuantoCorto(f.telefonoMin, t)}`);
  const cam = f.camionMin == null ? t("Truck GPS: no data", "GPS del camión: sin datos") : t(`Truck GPS, ${haceCuantoCorto(f.camionMin, t)}`, `GPS del camión, ${haceCuantoCorto(f.camionMin, t)}`);
  const porQue: Record<MotivoDeLaFuente, string> = {
    only: f.fuente === "truck" ? t("the phone is not reporting", "el teléfono no está reportando") : t("the truck tracker is not reporting", "el rastreador del camión no está reportando"),
    fresher: t("the newest of the two", "la más nueva de las dos"),
    accuracy: t("the phone's fix is imprecise", "el teléfono da una posición imprecisa"),
    other_is_still: f.fuente === "truck" ? t("the truck is moving and the phone is not", "el camión se mueve y el teléfono no") : t("the phone is moving and the truck is not", "el teléfono se mueve y el camión no"),
    person: t("they disagree; the phone is the driver's", "no coinciden; el teléfono es del chofer"),
    old: t("last known position; neither is reporting now", "última posición conocida; ninguna reporta ahora"),
  };
  const lineas = [
    t(`Truck: ${f.camion.nombre}`, `Camión: ${f.camion.nombre}`),
    // La que se usa, primero: «Truck GPS, 20 s ago · Phone, 6 min ago».
    f.fuente === "truck" ? `${cam} · ${tel}` : `${tel} · ${cam}`,
    t(`Using the ${f.fuente === "truck" ? "truck GPS" : "phone"}: ${porQue[f.motivo]}.`, `Se usa ${f.fuente === "truck" ? "el GPS del camión" : "el teléfono"}: ${porQue[f.motivo]}.`),
  ];
  const millas = f.metros == null ? null : f.metros / 1609.344;
  const aviso = f.aviso && millas != null
    ? t(`Phone and truck are ${millas < 10 ? millas.toFixed(1) : Math.round(millas)} mi apart: wrong truck assigned?`, `El teléfono y el camión están a ${millas < 10 ? millas.toFixed(1) : Math.round(millas)} mi: ¿camión equivocado?`)
    : null;
  return { lineas, aviso };
}
