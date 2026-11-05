/**
 * D-865: la revisión de una solicitud de cliente en su tarjeta (migración 242).
 *
 * El dueño, con la captura de «Solicitudes de cliente»: «quiero que eso se vea mejor, que la parte donde está el customer
 * sea un row y si le doy click se abre la card con la info del customer para revisarlo, y allí mismo le doy approve,
 * denied o needs check y puedo editarlo».
 *
 * - La lista: una fila por solicitud y chips por estado (Pendiente / Revisar / Aprobada / Rechazada), con sus cuentas
 *   (`cuentaPorEstado`, `filtraPorEstado`). Abre en Pendiente.
 * - La tarjeta: la solicitud entera. Un alta, con todos sus campos agrupados como la ficha (`filaDeSolicitud` hace de
 *   «cliente» para `TarjetasDeLaFicha`). Una edición, cada campo con el valor de HOY de la fila → lo pedido
 *   (`cambiosContraLaFila`; sin la fila, lo que vio quien pidió).
 * - Las acciones (`accionesDeSolicitud`): aprobar, rechazar (con nota obligatoria), «Revisar» (242, nota obligatoria) y
 *   corregir (242). Sin la 242 en la base no hay «Revisar» ni corrección: lo de la 216/221 sigue igual.
 * - Corregir: el mismo formulario de la ficha (`formDe`, `parcheDe`, contactos y redes); `payloadCorregido` saca el
 *   nuevo `payload` y se guarda en la solicitud (`erp.corrige_solicitud_de_cliente`); aprobar aplica ese payload con las
 *   funciones de siempre.
 */
import { contactosDe, erroresDeContactos, parcheDeContactos, type ContactoEnEdicion } from "./contactos";
import { cambiosEntre, type Cambio } from "./edicion-como-solicitud";
import { faltanEnElAlta } from "./obligatorios";
import { parcheDeRedes, redesDe, type RedesEnEdicion } from "./redes";
import { clienteDeLaBase, formDe, parcheDe, veElCampo, type Cliente, type Parche } from "./reglas";
import type { EstadoDeSolicitud, SolicitudDeCliente } from "./solicitud-de-cliente";

/** Los chips de la lista, en su orden. */
export const ESTADOS_DE_SOLICITUD: readonly EstadoDeSolicitud[] = ["pending", "review", "approved", "rejected"];

export const ETIQUETA_DE_ESTADO: Readonly<Record<EstadoDeSolicitud, { en: string; es: string }>> = {
  pending: { en: "Pending", es: "Pendiente" },
  review: { en: "Needs check", es: "Revisar" },
  approved: { en: "Approved", es: "Aprobada" },
  rejected: { en: "Rejected", es: "Rechazada" },
};

export function cuentaPorEstado(lista: readonly Pick<SolicitudDeCliente, "status">[]): Record<EstadoDeSolicitud, number> {
  const n: Record<EstadoDeSolicitud, number> = { pending: 0, review: 0, approved: 0, rejected: 0 };
  for (const s of lista) n[s.status]++;
  return n;
}

export const filtraPorEstado = <S extends Pick<SolicitudDeCliente, "status">>(lista: readonly S[], estado: EstadoDeSolicitud): S[] =>
  lista.filter((s) => s.status === estado);

/** Los chips que se pintan: «Revisar» solo con la 242 (o si ya hay alguna en ese estado). */
export function estadosAVer(revision: boolean, cuentas: Record<EstadoDeSolicitud, number>): EstadoDeSolicitud[] {
  return ESTADOS_DE_SOLICITUD.filter((e) => e !== "review" || revision || cuentas.review > 0);
}

export interface Acciones { aprobar: boolean; rechazar: boolean; revisar: boolean; corregir: boolean }

/** Qué puede hacer quien mira con una solicitud en este estado. `revision` = la base tiene la 242. */
export function accionesDeSolicitud(status: EstadoDeSolicitud, q: { esAdmin: boolean; revision: boolean }): Acciones {
  const nada = { aprobar: false, rechazar: false, revisar: false, corregir: false };
  if (!q.esAdmin) return nada;
  if (status === "pending") return { aprobar: true, rechazar: true, revisar: q.revision, corregir: q.revision };
  // «review» solo existe con la 242; desde ahí se decide o se corrige igual. Volver a «Revisar» no hace falta.
  if (status === "review") return { aprobar: q.revision, rechazar: q.revision, revisar: false, corregir: q.revision };
  return nada;
}

/** Rechazar y «Revisar» piden una nota para quien pidió. */
export const notaValida = (nota: string | null | undefined): boolean => (nota ?? "").trim().length > 0;

const COMO_FILA = (c: Cliente): Record<string, unknown> => c as unknown as Record<string, unknown>;

/**
 * La solicitud como si ya fuera un cliente, para pintarla con las tarjetas de la ficha: un alta, su payload en la primera
 * tienda; una edición, la fila de hoy con lo pedido encima (sin la fila, lo que vio quien pidió con lo pedido encima).
 */
export function filaDeSolicitud(s: Pick<SolicitudDeCliente, "kind" | "payload" | "before" | "stores" | "customer_id">, actual: Cliente | null | undefined): Cliente {
  if (s.kind === "edicion") {
    const base = actual ? COMO_FILA(actual) : { id: s.customer_id ?? 0, store: s.stores[0] ?? "", ...(s.before ?? {}) };
    return { ...clienteDeLaBase({ ...base, ...s.payload }), rep_name: actual?.rep_name ?? null };
  }
  return clienteDeLaBase({ ...s.payload, id: 0, store: s.stores[0] ?? "" });
}

/** Contra qué se corrige: en una edición, la fila de hoy (o lo que vio quien pidió); en un alta, la solicitud tal cual. */
export function baseDeCorreccion(s: Pick<SolicitudDeCliente, "kind" | "payload" | "before" | "stores" | "customer_id">, actual: Cliente | null | undefined): Cliente {
  if (s.kind === "edicion") return actual ?? clienteDeLaBase({ id: s.customer_id ?? 0, store: s.stores[0] ?? "", ...(s.before ?? {}) });
  return filaDeSolicitud(s, null);
}

/**
 * Una edición: cada campo pedido con el valor de HOY de la fila → lo pedido. Sin la fila (otra tienda, archivada), lo
 * que vio quien pidió (`before`). `desfasado`: la fila cambió desde que se pidió.
 */
export function cambiosContraLaFila(s: Pick<SolicitudDeCliente, "payload" | "before">, actual: Cliente | null | undefined): (Cambio & { desfasado: boolean })[] {
  const hoy: Record<string, unknown> = {};
  const fila = actual ? COMO_FILA(actual) : null;
  for (const k of Object.keys(s.payload)) hoy[k] = fila && k in fila ? fila[k] : s.before?.[k] ?? null;
  const vistos = cambiosEntre(s.before, s.payload);
  return cambiosEntre(hoy, s.payload).map((c) => ({ ...c, desfasado: !!fila && vistos.find((v) => v.key === c.key)?.antes !== c.antes }));
}

/** Lo que corrigió el admin sobre lo que mandó quien pidió (242): vacío si no corrigió. */
export function correccionesDelAdmin(s: Pick<SolicitudDeCliente, "payload" | "payload_original">): Cambio[] {
  if (!s.payload_original) return [];
  return cambiosEntre(s.payload_original, s.payload).filter((c) => c.antes !== c.despues);
}

/** Igualdad de payloads sin importar el orden de las claves. */
export function mismoPayload(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ordena = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(ordena) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, ordena((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(ordena(a)) === JSON.stringify(ordena(b));
}

export interface Correccion {
  /** El payload que se guardaría en la solicitud. */
  payload: Record<string, unknown>;
  /** ¿Es distinto del que tiene la solicitud? */
  cambiado: boolean;
  /** Lo que está mal escrito o falta y bloquea guardar (las claves de la ficha: `terms`, `contacto.0.phones.0`…). */
  errores: string[];
  /** D-772: lo que un alta debería traer y no trae (términos, nombre y cargo del contacto…): se avisa, no bloquea. */
  faltan: string[];
}

/**
 * El payload corregido, con las reglas de la ficha. Un alta: lo que cambió el admin sobre lo pedido, fundido sobre el
 * payload (lo que la ficha no edita —house_no, etc.— se queda). Una edición: SOLO lo que difiere de la fila de hoy,
 * como al pedirla (`cuerpoDeEdicion`); si ya nada difiere, es un error (no queda nada que aprobar).
 */
export function payloadCorregido(
  s: Pick<SolicitudDeCliente, "kind" | "payload" | "before" | "stores" | "customer_id">,
  actual: Cliente | null | undefined,
  form: Record<string, string>,
  contactos: readonly ContactoEnEdicion[],
  redes: RedesEnEdicion,
): Correccion {
  const base = baseDeCorreccion(s, actual);
  const alta = s.kind === "alta";
  const campos = parcheDe({ ...form, store: base.store }, formDe(base), alta);
  const parche: Parche = { ...campos.parche, ...parcheDeContactos(contactosDe(base), contactos, base), ...parcheDeRedes(redesDe(base), redes) };
  const errores = [...campos.errores, ...erroresDeContactos(contactos)];
  let payload: Record<string, unknown>;
  if (alta) {
    payload = { ...s.payload, ...parche };
    delete payload.store;
    if (!String(payload.account ?? "").trim()) errores.push("account");
  } else {
    payload = { ...parche };
    delete payload.store;
    if (!Object.keys(payload).length) errores.push("nada");
  }
  const faltan = alta ? faltanEnElAlta(form, contactos, true, (k) => veElCampo(k, { esVendedor: false, alta: true })) : [];
  return { payload, cambiado: !mismoPayload(payload, s.payload), errores: [...new Set(errores)], faltan };
}

