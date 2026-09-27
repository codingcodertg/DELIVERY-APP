import { planifica, type MotivoSinAsignar } from "@/lib/route-engine";
import { textoDeClave } from "@/lib/route-times/claves";
import { cacheEnMemoria, type CacheDeTiempos, type Dependencias } from "@/lib/route-times/tiempos";
import type { Delivery, DriverSettings, Profile } from "@/lib/types";
import { planificaElDia, type Borrador } from "./borrador";
import { entradaDelDia, type DatosDelDia, type EntradaDelDia } from "./entrada";
import { ETAPAS_RUTEABLES, ordenDeLaParte } from "./publicar";

/**
 * «✨ Auto-asignar» con el motor de «Planificar el día» (D-NEXT). Puro: sin base ni red; la caché y los proveedores
 * de tiempos llegan inyectados, como en `planificaElDia`.
 *
 * El dueño, 2026-09-27: *«quioero que hagamos mucho emfasis porque todo funciona bien pero estmaos teniendo probemas en
 * el autoassign investiga como lo hace para hacerlo mejro y que funcione perfectamente»*.
 *
 * Hasta aquí Auto-asignar era `autoAssign` (`lib/dispatch.ts`, ya quitado): un reparto voraz en línea recta que trataba
 * cualquier solape de ventanas como choque —con el 77 % de las órdenes en 08:30–17:30, un clic colocaba UNA orden por
 * chofer—, empezaba a cada chofer en 0 pallets aunque ya llevara carga, y no miraba ni su base, ni su turno, ni si
 * rutea. Ahora reparte el MISMO motor que «Planificar el día», en «modo reparto»:
 *
 *   · entran SOLO las órdenes marcadas (libres) y los choferes elegidos en el diálogo;
 *   · lo que cada elegido YA lleva ese día entra con su chofer FIJADO (`choferFijado`): cuenta para su capacidad, su
 *     turno y sus ventanas, y ninguna orden cambia de chofer. El ORDEN de su ruta sí lo rehace el motor con lo nuevo
 *     dentro — como hacía «Optimizar al terminar» (D-401) con las rutas que recibían. Se probó fijar también la
 *     secuencia (`secuenciaFijada`) y se descartó, medido con los días reales: la ruta guardada no dice dónde iban las
 *     recogidas, y rehacerla «recoger todo, luego entregar» pasaba de la capacidad (15,6 pallets con tope 12) y
 *     multiplicaba las millas (288 → 714 el 09-27, en dos tandas);
 *   · si con lo nuevo a un chofer se le quedara fuera algo de lo que YA llevaba (el motor coloca antes una nueva de más
 *     prioridad o un builder, y a lo suyo no le queda hueco), su ruta se CONGELA: el motor planifica primero solo lo
 *     suyo —su secuencia P/D, que sí cabe— y en la vuelta siguiente lo nuevo entra alrededor sin quitarle nada
 *     (`secuenciaFijada`). Si ni lo suyo solo cabe, ese chofer no recibe nada y se dice («lleno»). Medido con los días
 *     reales en dos tandas: sacar al chofer entero en vez de congelarlo dejaba 18 de 24 el 09-19;
 *   · un solo día por petición: quien llama parte la selección por fecha (`auto-asignar.ts`);
 *   · los choferes que no rutean, no están ese día, no tienen base o tienen la ruta 🔒 los deja fuera `entradaDelDia`,
 *     y se dice (`choferesFuera`);
 *   · lo que se escribe sale de la secuencia P/D del motor con la misma cuenta que publicar (`escriturasAlPublicar`):
 *     chofer, viaje y puesto. Solo en las rutas que RECIBEN algo; y en ellas, a lo que ya llevaban solo se le reescribe
 *     el puesto o el viaje si cambió.
 *
 * No guarda ningún plan: no es un borrador de «Planificar el día», es una asignación. Tampoco escribe: devuelve qué
 * escribir, con la `updated_at` con la que se planificó cada orden, y quien llama escribe «solo si no cambió desde
 * entonces» (`updateDelivery(…, { siNoCambioDesde })`).
 */

/** Lo que pide el diálogo: UN día, qué órdenes (ids) y a qué choferes (NOMBRES, como los guarda `assigned_driver`). */
export interface PeticionDeReparto { fecha: string; ordenes: string[]; choferes: string[] }

/** Una orden del día tal como la lee el reparto: lo del motor más dónde va hoy en su ruta. */
export type FilaDelReparto = DatosDelDia["ordenes"][number] &
  Pick<Delivery, "delivery_date" | "route_seq" | "load_no"> & { order_no?: number | null; morning_priority?: boolean | null };

/** El día entero, leído: las órdenes de esa fecha (cualquier chofer), los perfiles, los ajustes y quién no está. */
export interface DiaParaElReparto extends Omit<DatosDelDia, "ordenes" | "publicadoAntes" | "fijadas"> {
  ordenes: readonly FilaDelReparto[];
}

/** Por qué una orden marcada no recibió chofer: los motivos del motor, y los de antes de llegar a él. */
export type MotivoDelReparto =
  | MotivoSinAsignar
  | EntradaDelDia["fuera"][number]["motivo"]
  /** Pidió otra fecha, o ya no existe / no se ve. */
  | "no_encontrada"
  /** Ya no está en una etapa que se rutea (se recogió, se entregó, se anuló). */
  | "no_ruteable"
  /** Alguien le puso chofer entretanto: el reparto no se lo cambia. */
  | "ya_tiene_chofer"
  /** Sin fecha de entrega: no hay día en el que repartirla. */
  | "sin_fecha"
  /** El servidor no contestó: no se repartió. */
  | "error";

export interface EscrituraDelReparto {
  id: string;
  /** El chofer de la ruta en la que queda (para limpiar su dibujo y contar). */
  chofer: string;
  /** `true`: una orden marcada que recibe chofer. `false`: una que ya llevaba y cambia de puesto o de viaje. */
  nueva: boolean;
  /** Lo que se escribe: las columnas del Gestor, con su convenio (viaje 1 = `null`, como `applyPlan`). */
  patch: { assigned_driver?: string; route_seq: number; load_no: number | null; load_auto?: true };
  /** Con la que se planificó: si la orden cambió después, no se escribe. */
  updated_at: string;
}

export interface RespuestaDelReparto {
  fecha: string;
  escrituras: EscrituraDelReparto[];
  /** Órdenes marcadas que no recibieron chofer, con su porqué. */
  sinColocar: { id: string; motivo: MotivoDelReparto }[];
  /** Choferes elegidos que el motor no pudo usar, y por qué. */
  choferesFuera: { nombre: string; motivo: string }[];
  /** Millas del plan de los elegidos (lo que ya llevaban más lo nuevo), estimadas por el proveedor que contestó. */
  millas: number;
  proveedor: string;
}

const igual = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
/** Viaje 1 es `null` en el Gestor (`route-lanes`, `applyPlan`). */
const viajeDe = (n: number | null | undefined) => (n && n > 1 ? n : 1);

/**
 * De la petición a lo que entiende `planificaElDia`: solo las marcadas (libres), los elegidos, y lo que los elegidos ya
 * llevan ese día, con su chofer fijado. Lo demás del día —otros choferes, sin asignar no marcadas— no entra: no cambia
 * nada de lo que se reparte. `sinEstos`: choferes (por id) que ya no entran porque están llenos (ver `repartoConDetalle`).
 */
export function datosParaElReparto(dia: DiaParaElReparto, pet: PeticionDeReparto, sinEstos: ReadonlySet<string> = new Set(),
  congeladas: DatosDelDia["fijadas"] = {}): {
  datos: DatosDelDia; elegidas: string[]; descartadas: { id: string; motivo: MotivoDelReparto }[];
  previas: Map<string, { route_seq: number | null; load_no: number | null }>;
} {
  const delDia = dia.ordenes.filter((o) => o.delivery_date === pet.fecha && !o.is_training);
  const porId = new Map(delDia.map((o) => [o.id, o]));
  const elegidas: string[] = [];
  const descartadas: { id: string; motivo: MotivoDelReparto }[] = [];
  for (const id of [...new Set(pet.ordenes)]) {
    const o = porId.get(id);
    if (!o) descartadas.push({ id, motivo: "no_encontrada" });
    else if (!ETAPAS_RUTEABLES.includes(o.stage)) descartadas.push({ id, motivo: "no_ruteable" });
    else if ((o.assigned_driver ?? "").trim()) descartadas.push({ id, motivo: "ya_tiene_chofer" });
    else elegidas.push(id);
  }

  const choferes = dia.choferes.filter((c) => c.role === "driver" && !sinEstos.has(c.id) && pet.choferes.some((n) => igual(n, c.full_name)));
  const deUnElegido = (o: FilaDelReparto) => choferes.some((c) => igual(c.full_name, o.assigned_driver));
  const yaLlevan = delDia.filter((o) => ETAPAS_RUTEABLES.includes(o.stage) && (o.assigned_driver ?? "").trim() && deUnElegido(o));

  const libres = new Set(elegidas);
  return {
    datos: {
      ...dia,
      ordenes: [...delDia.filter((o) => libres.has(o.id)).map((o) => ({ ...o, assigned_driver: null })), ...yaLlevan],
      choferes,
      // Vacío a propósito: así TODO lo que ya lleva un elegido cuenta como puesto por una persona (`choferFijado`), también
      // lo que escribió un plan publicado. El reparto no mueve a nadie de chofer; eso es «Planificar el día».
      publicadoAntes: [],
      fijadas: congeladas,
    },
    elegidas,
    descartadas,
    previas: new Map(yaLlevan.map((o) => [o.id, { route_seq: o.route_seq ?? null, load_no: o.load_no ?? null }])),
  };
}

/** Lo que devuelve el reparto y, para las pruebas y la medición, el borrador del motor del que sale. */
export async function repartoConDetalle(dia: DiaParaElReparto, pet: PeticionDeReparto, zona: string, depsDeFuera: Dependencias): Promise<{ respuesta: RespuestaDelReparto; borrador: Borrador | null }> {
  const llenos = new Set<string>();
  const congeladas: Record<string, { orden: string; tipo: "P" | "D" }[]> = {};
  let prep = datosParaElReparto(dia, pet);
  const vacia: RespuestaDelReparto = { fecha: pet.fecha, escrituras: [], sinColocar: prep.descartadas, choferesFuera: [], millas: 0, proveedor: "cache" };
  if (!prep.elegidas.length) return { respuesta: vacia, borrador: null };
  // Las vueltas de abajo vuelven a pedir la misma matriz: lo que contestó el proveedor se guarda en memoria para esta
  // petición, y así no se le pregunta dos veces.
  const deps: Dependencias = { ...depsDeFuera, cache: conMemoria(depsDeFuera.cache) };

  // Lo que ya llevaba un chofer no se puede quedar fuera por lo nuevo. Si pasa, se congela su ruta (o, si ni lo suyo
  // cabe, sale del reparto) y se vuelve a repartir. Cada vuelta congela o saca a uno al menos, así que acaba.
  let borrador = await planificaElDia(prep.datos, pet.fecha, zona, deps);
  for (;;) {
    const { entrada } = borrador.plan.input;
    // Solo lo que se quedó fuera por FALTA DE SITIO (`chofer_fijado_sin_hueco`: sola en su ruta sí cabría). Una que no
    // cabe ni sola (sin punto, más grande que el camión…) tampoco cabía antes: no es culpa de lo nuevo.
    const sinSitio = new Set(borrador.plan.result.sinAsignar.filter((x) => x.motivo === "chofer_fijado_sin_hueco").map((x) => ordenDeLaParte(x.orden)));
    const afectados = [...new Set(entrada.ordenes.filter((o) => o.choferFijado && sinSitio.has(ordenDeLaParte(o.id))).map((o) => o.choferFijado!))]
      .filter((id) => !llenos.has(id));
    if (!afectados.length) break;
    for (const id of afectados) {
      // Ya congelado y aun así se le cae algo: ni lo suyo solo le cabe. Sale del reparto («lleno»).
      if (congeladas[id]) { llenos.add(id); delete congeladas[id]; continue; }
      // Lo suyo, solo: la secuencia que el motor le daría sin nada nuevo, con la misma matriz y los mismos parámetros. Si
      // ni así cabe todo, lo que se quede fuera vuelve a caer en la vuelta siguiente, y entonces es «lleno» (arriba). Se
      // quitó un atajo que lo marcaba «lleno» ya aquí: daba lo mismo con una vuelta menos, y lo delató un mutante vivo.
      const chofer = entrada.choferes.find((c) => c.id === id)!;
      const suyas = entrada.ordenes.filter((o) => o.choferFijado === id);
      const solo = planifica({ ordenes: suyas, choferes: [chofer], matriz: entrada.matriz }, entradaDelDia(prep.datos).parametros);
      congeladas[id] = solo.rutas[0]?.paradas.map((x) => ({ orden: x.orden, tipo: x.tipo })) ?? [];
    }
    prep = datosParaElReparto(dia, pet, llenos, congeladas);
    borrador = await planificaElDia(prep.datos, pet.fecha, zona, deps);
  }
  const { plan } = borrador;
  const elegidas = new Set(prep.elegidas);
  const foto = new Map(plan.input.ordenes.map((f) => [f.id, f.updated_at]));
  const receptores = new Set(plan.writes.filter((w) => elegidas.has(w.id)).map((w) => w.assigned_driver));

  const escrituras: EscrituraDelReparto[] = [];
  for (const w of plan.writes) {
    if (!receptores.has(w.assigned_driver)) continue;
    const load_no = w.load_no > 1 ? w.load_no : null;
    const updated_at = foto.get(w.id) ?? "";
    if (elegidas.has(w.id)) {
      escrituras.push({ id: w.id, chofer: w.assigned_driver, nueva: true, updated_at, patch: { assigned_driver: w.assigned_driver, route_seq: w.route_seq, load_no, load_auto: true } });
      continue;
    }
    const antes = prep.previas.get(w.id);
    if (antes && (antes.route_seq !== w.route_seq || viajeDe(antes.load_no) !== viajeDe(load_no))) {
      escrituras.push({ id: w.id, chofer: w.assigned_driver, nueva: false, updated_at, patch: { route_seq: w.route_seq, load_no } });
    }
  }

  const colocadas = new Set(escrituras.filter((e) => e.nueva).map((e) => e.id));
  const motivoDe = (id: string): MotivoDelReparto =>
    plan.result.sinAsignar.find((s) => ordenDeLaParte(s.orden) === id)?.motivo
    ?? plan.result.fuera.find((f) => f.id === id)?.motivo
    ?? "no_cabe_con_el_resto";
  const sinColocar = [...prep.descartadas, ...prep.elegidas.filter((id) => !colocadas.has(id)).map((id) => ({ id, motivo: motivoDe(id) }))];

  return {
    respuesta: {
      fecha: pet.fecha, escrituras, sinColocar,
      choferesFuera: [
        ...dia.choferes.filter((c) => llenos.has(c.id)).map((c) => ({ nombre: String(c.full_name ?? ""), motivo: "lleno" })),
        ...plan.result.choferesFuera.map((c) => ({ nombre: c.nombre, motivo: c.motivo })),
      ],
      millas: Number(plan.total_miles), proveedor: plan.provider,
    },
    borrador,
  };
}

export async function repartoDelDia(dia: DiaParaElReparto, pet: PeticionDeReparto, zona: string, deps: Dependencias): Promise<RespuestaDelReparto> {
  return (await repartoConDetalle(dia, pet, zona, deps)).respuesta;
}

/**
 * La caché de tiempos, solo para LEER. El reparto usa lo que «Planificar el día» ya pagó, pero no guarda nada: sin
 * Google delante, lo que contestara OSRM se guardaría 90 días como si fuera la respuesta buena (`matrizBase` guarda lo
 * del primer proveedor), y «Planificar el día» dejaría de preguntarle a Google por esos tramos.
 */
export function cacheSoloLectura(c: CacheDeTiempos): CacheDeTiempos {
  return { lee: (k) => c.lee(k), escribe: async () => undefined, gastoDesde: (d) => c.gastoDesde(d) };
}

/** Una capa en memoria delante de la caché: lo que se escribe queda aquí (y se le pasa a la de debajo, que en el reparto
 *  no guarda nada), y lo que se lee sale primero de aquí. Vive lo que dura una petición. */
function conMemoria(c: CacheDeTiempos): CacheDeTiempos {
  const memoria = cacheEnMemoria();
  return {
    async lee(claves) {
      const aqui = await memoria.lee(claves);
      const ya = new Set(aqui.map((f) => textoDeClave(f)));
      const faltan = claves.filter((k) => !ya.has(textoDeClave(k)));
      return faltan.length ? [...aqui, ...(await c.lee(faltan))] : aqui;
    },
    async escribe(filas) { await memoria.escribe(filas); await c.escribe(filas); },
    gastoDesde: (d) => c.gastoDesde(d),
  };
}

/**
 * Los ajustes de chofer del DEMO, que no tiene `driver_settings`: la tienda del perfil como base, y lo demás por defecto.
 * Solo lo usa el modo local (`NEXT_PUBLIC_LOCAL_MODE`); con base, los ajustes son los de la tabla.
 */
export function ajustesDelDemo(perfiles: readonly Pick<Profile, "id" | "role" | "store">[]): DriverSettings[] {
  return perfiles.filter((p) => p.role === "driver").map((p) => ({
    profile_id: p.id, base_store: p.store ?? null, capacity_pallets: null, shift_start: "08:00", shift_end: "17:30", returns_to_base: true, routable: true,
  }));
}

/** Qué dice el aviso de cada motivo. Los del motor, con las palabras de «Planificar el día» (`PlanDelDia`). */
export const TEXTO_DEL_MOTIVO: Record<string, [string, string]> = {
  falta_requisito: ["no routed driver's truck has what it needs", "ningún camión que rutea tiene lo que pide"],
  sin_punto: ["no map point", "sin punto en el mapa"], sin_chofer_disponible: ["no driver available", "sin chofer disponible"],
  supera_capacidad: ["larger than any truck", "mayor que cualquier camión"], ventana_imposible: ["hard window can't be met", "no se llega a su ventana dura"],
  retraso_sobre_el_tope: ["would be too late", "llegaría demasiado tarde"], fuera_de_turno: ["doesn't fit in a shift", "no cabe en un turno"],
  chofer_fijado_sin_hueco: ["its driver has no room", "su chofer no tiene hueco"], no_cabe_con_el_resto: ["no room left today", "hoy no queda sitio"],
  en_un_carril_manual: ["in a manual lane", "en un carril manual"], chofer_no_rutea: ["its driver isn't routed today", "su chofer hoy no rutea"],
  en_ruta_bloqueada: ["on a locked route 🔒", "en una ruta bloqueada 🔒"],
  no_encontrada: ["not found for that day", "no está en ese día"], no_ruteable: ["no longer in a routable stage", "ya no está en una etapa que se rutea"],
  ya_tiene_chofer: ["already has a driver", "ya tiene chofer"], sin_fecha: ["no delivery date", "sin fecha de entrega"], error: ["server error", "error del servidor"],
  // Los de los choferes (`choferesFuera`).
  no_rutea: ["not routed", "no rutea"], base: ["no base store", "sin tienda base"], base_sin_punto: ["base store has no map point", "su tienda base no tiene punto"],
  no_disponible: ["off today", "hoy no está"], ruta_bloqueada: ["route locked 🔒", "ruta bloqueada 🔒"],
  lleno: ["full: more would leave out something they already carry", "lleno: con más se le quedaría fuera algo de lo que ya lleva"],
};

export const textoDelMotivo = (motivo: string, lang: "en" | "es"): string => TEXTO_DEL_MOTIVO[motivo]?.[lang === "es" ? 1 : 0] ?? motivo;
