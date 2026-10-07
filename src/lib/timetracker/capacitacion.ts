import type { Idioma } from "@/lib/idioma";

/**
 * El modo capacitación de Time Tracker (D-NEXT).
 *
 * El dueño, el 2026-10-07: «teaching mode, quiero que hagas un teaching mode en modo de capacitación y
 * en el time tracker también para todos». Es el modo enseñanza de Entregas (D-274, `rtg_teaching`)
 * llevado a Time Tracker: mientras está encendido, **lo que la persona hace no se guarda en la base**
 * —fichar, comida, «Voy a salir», viajes y fotos, notas, tiempo libre, solicitudes, el cronómetro—, lo
 * ve igual que si se hubiera guardado, y al apagarlo todo vuelve a lo real.
 *
 * **Dónde se corta, en tres capas**, porque una sola no basta para decir «imposible»:
 *
 * 1. **La pantalla no llama a nadie.** Las acciones de fichar (`capacitacion-fichar.ts`) y las del
 *    proveedor de datos (`capacitacion-datos.ts`) tienen una versión de práctica que apunta lo hecho
 *    en una capa local —la misma idea que el `overlay` de Entregas— y la pinta encima de lo real. Es
 *    la capa que hace que practicar se parezca a trabajar.
 * 2. **El navegador no deja salir una escritura.** Los dos clientes de Supabase de Time Tracker y de
 *    fichaje llevan `fetchConCorte`: con la cookie puesta, cualquier petición que escribe —insertar,
 *    cambiar, borrar, subir una foto— vuelve con un 403 sin haber salido del equipo. Cubre también las
 *    pantallas del gerente, que no tienen versión de práctica.
 * 3. **El servidor no escribe.** Toda acción de servidor de fichaje que escribe empieza con
 *    `corteDeCapacitacion()` (`capacitacion-servidor.ts`) y contesta «no se guardó» si la petición
 *    trae la cookie. Una prueba recorre las acciones y exige la guarda en cada una que no esté en la
 *    lista de lecturas. Es la capa que protege de lo que nadie previó: avisos al gerente, la
 *    geocodificación de una parada, una acción nueva el mes que viene.
 *
 * **La cookie es la fuente de verdad**, y lleva dentro el idioma (`es`/`en`) para que el servidor
 * conteste en el de la persona. Va en la ruta `/timetracker`: el navegador solo la manda a Time
 * Tracker, así que encender la práctica aquí no frena nada en el hub ni en las demás apps (los ajustes
 * de fichaje que el admin cambia desde Usuarios, por ejemplo, siguen siendo de verdad). La lee el
 * servidor (el layout la pinta ya encendida, sin parpadeo) y la lee el navegador en cada petición.
 *
 * Distinta de la de Entregas a propósito: allí es un entorno de órdenes; aquí es la jornada de cada uno.
 * Encender una no enciende la otra.
 */

export const COOKIE_CAPACITACION = "rtg_capacitacion_tt";
/** Solo Time Tracker la recibe: el navegador no la manda a `/home`, `/erp`, `/recruiting`… */
export const RUTA_DE_LA_COOKIE = "/timetracker";

/** El idioma guardado en la cookie, o `null` si no está puesta. Cualquier otro valor no vacío cuenta como puesta. */
export function valorDeCapacitacion(valor: string | null | undefined): Idioma | null {
  if (valor == null) return null;
  const v = valor.trim();
  if (!v) return null;
  return v === "es" ? "es" : "en";
}

/** Busca la cookie en `document.cookie` (o en una cabecera `Cookie`). */
export function capacitacionDeLasCookies(cookies: string | null | undefined): Idioma | null {
  if (!cookies) return null;
  for (const trozo of cookies.split(";")) {
    const i = trozo.indexOf("=");
    if (i < 0) continue;
    if (trozo.slice(0, i).trim() === COOKIE_CAPACITACION) return valorDeCapacitacion(decodeURIComponent(trozo.slice(i + 1)));
  }
  return null;
}

/**
 * Lo que se asigna a `document.cookie` para encender (con el idioma) o apagar (`null`). Sin caducidad
 * al encender, como el modo enseñanza de Entregas: dura hasta que se apaga. El aviso fijo de arriba es
 * lo que impide olvidarlo.
 */
export function cookieDeCapacitacion(idioma: Idioma | null): string {
  const base = `Path=${RUTA_DE_LA_COOKIE}; SameSite=Lax`;
  return idioma ? `${COOKIE_CAPACITACION}=${idioma}; ${base}` : `${COOKIE_CAPACITACION}=; ${base}; Max-Age=0`;
}

/** Lo que se le dice a quien intenta guardar algo que no tiene práctica (pantallas del gerente, la cuenta…). */
export function mensajeDeCapacitacion(idioma: Idioma | null): string {
  return idioma === "es"
    ? "Modo capacitación: esto no se guardó. Apágalo en el menú de tu nombre para hacerlo de verdad."
    : "Training mode: this was not saved. Turn it off from the menu on your name to do it for real.";
}

/**
 * ¿Esta petición escribe? Solo se mira lo que llega a los datos de Time Tracker y fichaje:
 *
 * - `/rest/v1/…` con cualquier método que no sea leer (POST, PATCH, PUT, DELETE): insertar, cambiar,
 *   borrar, `upsert` y las funciones `rpc` (Time Tracker no usa ninguna para leer; si algún día lo hace,
 *   la prueba de esta función es donde se dice).
 * - `/storage/v1/object/…` igual, salvo firmar una URL y listar, que van por POST pero solo leen.
 *
 * Lo demás pasa: refrescar la sesión (`/auth/v1/token`), el tiempo real… Bloquear el refresco del
 * token sacaría a la persona de la app a la hora de practicar.
 */
export function esEscrituraBloqueada(metodo: string | null | undefined, url: string): boolean {
  const m = (metodo || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  let ruta = url;
  try { ruta = new URL(url, "http://local").pathname; } catch { /* se mira el texto tal cual */ }
  if (ruta.includes("/rest/v1/")) return true;
  if (ruta.includes("/storage/v1/object/")) {
    if (ruta.includes("/storage/v1/object/sign/") || ruta.includes("/storage/v1/object/list/")) return false;
    return true;
  }
  return false;
}

/**
 * Un `fetch` para `createClient` que, con la práctica encendida, devuelve un 403 a toda escritura sin
 * dejarla salir. El cuerpo tiene la forma de un error de PostgREST, así que supabase-js lo entrega como
 * `error` con el mensaje dentro y cada pantalla lo enseña como enseña cualquier otro fallo.
 *
 * `activa` se pregunta EN CADA PETICIÓN, no al crear el cliente: el cliente vive lo que vive la página
 * y la práctica se enciende y se apaga sin recargar.
 */
export function fetchConCorte(
  fetchReal: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  activa: () => Idioma | null,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const metodo = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    const idioma = activa();
    if (idioma && esEscrituraBloqueada(metodo, url)) {
      const cuerpo = { code: "CAPACITACION", message: mensajeDeCapacitacion(idioma), details: null, hint: null, statusCode: "403", error: "capacitacion" };
      return new Response(JSON.stringify(cuerpo), { status: 403, headers: { "content-type": "application/json" } });
    }
    return fetchReal(input, init);
  };
}

/** Lo que el navegador le da a `fetchConCorte`: la cookie, leída en el momento. Fuera del navegador, nunca. */
export function capacitacionDelNavegador(): Idioma | null {
  return typeof document === "undefined" ? null : capacitacionDeLasCookies(document.cookie);
}

// ---------------------------------------------------------------------------------------------------
// Lo hecho en práctica: una capa local sobre lo real, como el `overlay` de Entregas.
// ---------------------------------------------------------------------------------------------------

/** Los ids de lo hecho en práctica empiezan así; nunca coinciden con un uuid de la base. */
export const PREFIJO_DE_PRACTICA = "practica-";
export const esIdDePractica = (id: string | null | undefined): boolean => !!id && id.startsWith(PREFIJO_DE_PRACTICA);

/** Fichar, en orden. Se aplican sobre el día y el viaje REALES cada vez que se leen. */
export type EventoDeFichar =
  | { k: "entrada"; id: string; at: string }
  | { k: "salida"; at: string }
  | { k: "descanso"; id: string; at: string; reason: string }
  | { k: "fin-descanso"; at: string }
  | { k: "viaje"; id: string; at: string; vehicleId: string | null }
  | { k: "parada"; id: string; at: string; label: string | null }
  | { k: "fin-parada"; at: string }
  | { k: "fin-viaje"; at: string };

/** Lo que `getMyDay` devuelve y la práctica toca. Genérico para no copiar el tipo entero de la acción. */
type DiaBase = {
  open: { id: string; clockInAt: string } | null;
  leave: { id: string; reason: string; leftAt: string } | null;
  today: { id: string; clockInAt: string; clockOutAt: string | null; minutes: number }[];
  breaks: { id: string; reason: string; leftAt: string; returnedAt: string | null; minutes: number }[];
  todayMinutes: number;
  weekMinutes: number;
  lunchMinutes: number;
  outMinutes: number;
};

const minutosEntre = (desde: string, hasta: string | null, ahora: number) =>
  Math.max(0, Math.round(((hasta ? Date.parse(hasta) : ahora) - Date.parse(desde)) / 60000));

/**
 * El día que se ve en práctica: el real, con lo practicado encima.
 *
 * Solo se recalculan los minutos de lo que la práctica tocó (lo que creó o lo que cerró). Lo demás se
 * queda con lo que contó el servidor, que descuenta el almuerzo y sabe cosas que aquí no se saben.
 * Los totales se mueven por la diferencia, para que «Hoy» y «Semana» cuadren con las filas.
 *
 * Las reglas son las de la pantalla, no más: no se entra dos veces, no se sale sin haber entrado,
 * no se empieza un descanso con otro abierto. Salir cierra el descanso abierto.
 */
export function diaConPractica<D extends DiaBase>(dia: D, eventos: readonly EventoDeFichar[], ahora: number): D {
  if (eventos.length === 0) return dia;
  let open = dia.open;
  let leave = dia.leave;
  const today = dia.today.map((e) => ({ ...e }));
  const breaks = dia.breaks.map((b) => ({ ...b }));
  const turnosTocados = new Set<string>();
  const pausasTocadas = new Set<string>();
  const cierraDescanso = (at: string) => {
    if (!leave) return;
    const b = breaks.find((x) => x.id === leave!.id);
    if (b) { b.returnedAt = at; pausasTocadas.add(b.id); }
    leave = null;
  };
  for (const ev of eventos) {
    switch (ev.k) {
      case "entrada":
        if (open) break;
        open = { id: ev.id, clockInAt: ev.at };
        today.push({ id: ev.id, clockInAt: ev.at, clockOutAt: null, minutes: 0 });
        turnosTocados.add(ev.id);
        break;
      case "salida": {
        if (!open) break;
        const e = today.find((x) => x.id === open!.id);
        if (e) { e.clockOutAt = ev.at; turnosTocados.add(e.id); }
        cierraDescanso(ev.at);
        open = null;
        break;
      }
      case "descanso":
        if (!open || leave) break;
        leave = { id: ev.id, reason: ev.reason, leftAt: ev.at };
        breaks.push({ id: ev.id, reason: ev.reason, leftAt: ev.at, returnedAt: null, minutes: 0 });
        pausasTocadas.add(ev.id);
        break;
      case "fin-descanso":
        cierraDescanso(ev.at);
        break;
      default:
        // Los viajes y las paradas no cambian el día: los lleva `viajeConPractica`.
        break;
    }
  }
  let deltaTurnos = 0;
  for (const e of today) {
    if (!turnosTocados.has(e.id)) continue;
    const antes = e.minutes;
    e.minutes = minutosEntre(e.clockInAt, e.clockOutAt, ahora);
    deltaTurnos += e.minutes - antes;
  }
  let deltaAlmuerzo = 0;
  let deltaFuera = 0;
  for (const b of breaks) {
    if (!pausasTocadas.has(b.id)) continue;
    const antes = b.minutes;
    b.minutes = minutosEntre(b.leftAt, b.returnedAt, ahora);
    if (b.reason === "lunch") deltaAlmuerzo += b.minutes - antes;
    else deltaFuera += b.minutes - antes;
  }
  return {
    ...dia,
    open,
    leave,
    today,
    breaks,
    todayMinutes: dia.todayMinutes + deltaTurnos,
    weekMinutes: dia.weekMinutes + deltaTurnos,
    lunchMinutes: dia.lunchMinutes + deltaAlmuerzo,
    outMinutes: dia.outMinutes + deltaFuera,
  };
}

type ViajeBase = {
  trip: { id: string; startedAt: string; vehicleId: string | null; paused: boolean } | null;
  stops: { id: string; label: string | null; arrivedAt: string; departedAt: string | null }[];
  clockedIn: boolean;
};

/**
 * El viaje que se ve en práctica. Mismas reglas que la pantalla: sin estar dentro no hay viaje, una
 * parada solo dentro de un viaje, y salir del turno deja el viaje cerrado.
 */
export function viajeConPractica<V extends ViajeBase>(v: V, eventos: readonly EventoDeFichar[]): V {
  if (eventos.length === 0) return v;
  let { trip, clockedIn } = v;
  let stops = v.stops.map((s) => ({ ...s }));
  for (const ev of eventos) {
    switch (ev.k) {
      case "entrada":
        clockedIn = true;
        break;
      case "salida":
        clockedIn = false;
        trip = null;
        stops = [];
        break;
      case "viaje":
        if (!clockedIn || trip) break;
        trip = { id: ev.id, startedAt: ev.at, vehicleId: ev.vehicleId, paused: false };
        stops = [];
        break;
      case "parada":
        if (!trip) break;
        stops.push({ id: ev.id, label: ev.label, arrivedAt: ev.at, departedAt: null });
        break;
      case "fin-parada": {
        const abierta = [...stops].reverse().find((s) => !s.departedAt);
        if (abierta) abierta.departedAt = ev.at;
        break;
      }
      case "fin-viaje":
        trip = null;
        stops = [];
        break;
      default:
        break;
    }
  }
  return { ...v, trip, stops, clockedIn };
}

/** Fila de tiempo libre como la devuelve `getMyTimeOff`. */
export type TiempoLibreDePractica = {
  id: string; type: string; start_date: string; end_date: string;
  note: string | null; status: string; manager_comment: string | null;
};

/** Todo lo practicado. Se guarda en el navegador mientras dura la práctica, y se tira al apagarla. */
export type Practica = {
  fichar: EventoDeFichar[];
  notas: { id: string; note: string; created_at: string }[];
  tiempoLibre: TiempoLibreDePractica[];
  /** «Marcar avisos como leídos» en práctica: se ven leídos, la base no se entera. */
  avisosLeidos: boolean;
  /** El cronómetro: sesiones que solo existen aquí. Tipo abierto para no atar esto a `types.ts`. */
  sesiones: Record<string, unknown>[];
  /** Solicitudes de tiempo («Mis solicitudes»), igual. */
  solicitudes: Record<string, unknown>[];
};

export const practicaVacia = (): Practica => ({ fichar: [], notas: [], tiempoLibre: [], avisosLeidos: false, sesiones: [], solicitudes: [] });

/** Clave del navegador donde se guarda lo practicado, por persona: en un equipo compartido no se mezcla. */
export const claveDePractica = (uid: string) => `rtg_capacitacion_tt_datos:${uid}`;

/** Lee lo practicado guardado, tolerando cualquier cosa rota: ante la duda, una práctica vacía. */
export function practicaGuardada(raw: string | null | undefined): Practica {
  const vacia = practicaVacia();
  if (!raw) return vacia;
  try {
    const o = JSON.parse(raw) as Partial<Practica> | null;
    if (!o || typeof o !== "object") return vacia;
    return {
      fichar: Array.isArray(o.fichar) ? o.fichar : [],
      notas: Array.isArray(o.notas) ? o.notas : [],
      tiempoLibre: Array.isArray(o.tiempoLibre) ? o.tiempoLibre : [],
      avisosLeidos: o.avisosLeidos === true,
      sesiones: Array.isArray(o.sesiones) ? o.sesiones : [],
      solicitudes: Array.isArray(o.solicitudes) ? o.solicitudes : [],
    };
  } catch {
    return vacia;
  }
}
