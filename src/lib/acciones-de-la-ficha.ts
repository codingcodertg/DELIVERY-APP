import {
  canApprove, canCreate, canDeliver, etapaAnterior, ordersLikeOfficeManager, preparaEnLaFicha, puedeAnular, puedeEntregarYa,
  recogeEnLaFicha, stageLabel,
} from "@/lib/constants";
import { puedeAgregarMaterial } from "@/lib/agregar-material";
import { puedeDejarEnTienda } from "@/lib/leave-at-store";
import type { AlcanceDeEdicion } from "@/lib/edicion-de-ventas";
import type { Delivery, Profile, Stage } from "@/lib/types";

// ============================================================
// Los botones de acción de la ficha, en UN menú «Acciones ▾» (D-497).
//
// El dueño (2026-10-07): «The action buttons will be a drop-down in the form view in the delivery app
// because is taking to many buttoms so now make it a dropdown».
//
// La ficha llegó a enseñar ocho botones seguidos a un gerente en una orden aprobada (Comprobante, Editar,
// Desbloquear, Comenzar preparación, Cancelar orden, Duplicar, y arriba Marcar entregada ya y Deshacer
// etapa). Aquí se decide, en un solo sitio:
//
//   1. QUÉ acciones hay para esta persona en esta orden — las mismas condiciones que tenía cada botón,
//      copiadas de donde vivían (`StageActions` y el pie de `OrderModal`), sin cambiar ninguna.
//   2. CUÁL se queda fuera, a la vista: la PRINCIPAL (`accionPrincipal`). Todas las demás van al menú.
//   3. En qué ORDEN salen en el menú, con lo destructivo al final, separado y en rojo.
//
// Qué hace cada acción NO se decide aquí: la ficha las enchufa a las mismas funciones de antes.
// ============================================================

export type IdDeAccion =
  // Las que pueden ser la principal: el paso que hace avanzar la orden.
  | "enviar" | "reenviar" | "aprobar" | "comenzar" | "marcar_listo" | "recoger" | "recibir" | "marcar_entregado"
  // Las del menú.
  | "editar" | "agregar_material" | "iniciar_viaje" | "llegue" | "dejar_en_tienda" | "desbloquear"
  | "entregar_ya" | "deshacer" | "reentrega" | "imprimir" | "duplicar"
  // Las destructivas: al final, en rojo.
  | "rechazar" | "anular" | "eliminar";

export type Texto = { en: string; es: string };

/** Clase del botón cuando la acción sale fuera, como principal. La misma que tenía su botón. */
export type EstiloDeBoton = "btn-primary" | "btn-green" | "btn-ghost" | "btn-amber" | "btn-danger";

export interface AccionDeLaFicha {
  id: IdDeAccion;
  texto: Texto;
  /** El `title` de antes, si el botón lo tenía. Si está deshabilitada, manda el motivo. */
  titulo: Texto | null;
  /** Destructiva: va al final del menú, separada y en rojo. Sigue pidiendo su confirmación como antes. */
  peligro: boolean;
  estilo: EstiloDeBoton;
  /** Por qué no se puede pulsar ahora. `null` = se puede. */
  deshabilitada: Texto | null;
}

/**
 * Un paso a medio hacer, con sus dos botones (Atrás / Confirmar) a la vista. Mientras hay uno abierto no hay
 * principal: lo que se tiene delante es esa confirmación, y la principal pasa al menú.
 *   - `anular`: el motivo de la anulación (Atrás · Confirmar cancelación).
 *   - `rechazar`: el motivo del rechazo (Atrás · Confirmar rechazo).
 *   - `recoger`: el recuento de pallets de la oficina (Atrás · Confirmar carga y salir).
 *   - `dejar`: la tienda donde se deja (D-224: Atrás · Confirmar entrega en tienda).
 */
export type PasoAbierto = "anular" | "rechazar" | "recoger" | "dejar";

/** Un dato de la etapa, no un botón: «En camino desde 10:21», «Llegó 11:05». Se queda a la vista. */
export type Aviso = { id: "en_camino" | "llego"; desde: string };

export interface EntradaDeAcciones {
  yo: Pick<Profile, "id" | "role" | "full_name" | "permissions">;
  pedido: Pick<Delivery, "stage" | "created_by" | "assigned_sales_rep" | "assigned_driver" | "store">;
  /** Qué abre «Editar» para esta persona (D-480). */
  edicion: AlcanceDeEdicion;
  /** Dónde aterriza si se envía (D-313): el botón lo dice. */
  etapaDeEnvio: Stage;
  /** Almacén, en `picked_up`, y la orden va a su tienda (D-409). Necesita las tiendas: lo calcula la ficha. */
  puedeRecibirla: boolean;
  /** Puede deshacer un paso en esta orden (D-361/D-383). Necesita las tiendas: lo calcula la ficha. */
  deshaceAqui: boolean;
  /** Puede borrarla (D-383, espejo de la 142). Necesita las tiendas: lo calcula la ficha. */
  borraAqui: boolean;
  /** Se está guardando algo: todos los botones que antes llevaban `disabled={busy}`, apagados. */
  ocupado: boolean;
  /** `departed_at` del chofer, si ya salió a recoger. */
  salidaEn: string | null;
  /** `arrived_at` del chofer, si ya llegó a la parada. */
  llegadaEn: string | null;
  /** Lo que está abierto en la ficha ahora mismo. Cada cosa abierta quita su botón, como antes. */
  abierto: {
    anular: boolean;
    rechazar: boolean;
    recoger: boolean;
    dejar: boolean;
    /** El formulario de firma (POD): con él abierto no hay botones de la parada. */
    pod: boolean;
    /** El motivo de «Marcar entregada ya» o de «Deshacer etapa» (D-361). */
    motivoDeSalto: boolean;
    /** El formulario de reentrega. */
    reentrega: boolean;
  };
}

export interface AccionesDeLaFicha {
  principal: AccionDeLaFicha | null;
  /** En el orden en que se pintan: primero las normales, luego las destructivas. */
  menu: AccionDeLaFicha[];
  pasos: PasoAbierto[];
  avisos: Aviso[];
}

/** El motivo de cualquier botón apagado mientras se guarda: antes estaban apagados sin decir por qué. */
export const MOTIVO_OCUPADO: Texto = {
  en: "Wait — the last change is still saving",
  es: "Espere — todavía se está guardando el último cambio",
};

/**
 * Qué acción se queda FUERA del menú, a la vista: **el paso que hace avanzar la orden para quien la mira**.
 * Es el botón que se pulsa casi siempre al abrir la ficha en esa etapa, y por eso no se esconde:
 *
 *   | etapa       | quién (el que tiene el botón)                    | principal                    |
 *   |-------------|--------------------------------------------------|------------------------------|
 *   | `draft`     | quien crea órdenes (ventas, gerente, office, admin) | Enviar a aprobación / Enviar (aprobada) |
 *   | `rejected`  | quien crea órdenes                               | Reenviar                     |
 *   | `pending`   | quien aprueba (gerente, office, logística, admin)| Aprobar                      |
 *   | `approved`  | almacén, gerente (D-397), admin                  | Comenzar preparación         |
 *   | `fulfilling`| almacén, gerente, admin                          | Marcar listo                 |
 *   | `ready`     | chofer, almacén, gerente, admin                  | Recoger                      |
 *   | `picked_up` | almacén de la tienda que la recibe (D-409)       | Recibir                      |
 *   | `picked_up` | chofer, almacén, admin                           | Marcar entregado             |
 *
 * Quien no tiene ninguno de esos botones en esa etapa (ventas en una pendiente, cualquiera en una entregada
 * o anulada) no tiene principal: todo va al menú. Menos botones fuera es lo que pidió el dueño.
 *
 * El orden de esta lista solo desempata si a alguien le tocaran dos a la vez; por etapa no pasa.
 */
export const ORDEN_DE_PRINCIPAL: readonly IdDeAccion[] = [
  "enviar", "reenviar", "aprobar", "comenzar", "marcar_listo", "recoger", "recibir", "marcar_entregado",
];

/** Orden del menú: lo de su etapa primero, luego lo que se usa de vez en cuando, y lo destructivo al final. */
export const ORDEN_DEL_MENU: readonly IdDeAccion[] = [
  ...ORDEN_DE_PRINCIPAL,
  "editar", "agregar_material", "iniciar_viaje", "llegue", "dejar_en_tienda",
  "desbloquear", "entregar_ya", "deshacer", "reentrega", "imprimir", "duplicar",
  "rechazar", "anular", "eliminar",
];

const PELIGRO: ReadonlySet<IdDeAccion> = new Set<IdDeAccion>(["rechazar", "anular", "eliminar"]);

/** La principal, si la hay: la primera de `ORDEN_DE_PRINCIPAL` que esté. Con un paso abierto, ninguna. */
export function accionPrincipal(ids: readonly IdDeAccion[], pasos: readonly PasoAbierto[]): IdDeAccion | null {
  if (pasos.length > 0) return null;
  return ORDEN_DE_PRINCIPAL.find((id) => ids.includes(id)) ?? null;
}

/** Los roles que pueden registrar una reentrega: los que deja el guard de la base (ver el comentario en la ficha). */
function registraReentrega(rol: string): boolean {
  return ["admin", "warehouse", "driver"].includes(rol) || ordersLikeOfficeManager(rol);
}

/**
 * Todas las acciones de la ficha de esta orden para esta persona, repartidas en principal, menú, pasos abiertos
 * y avisos. Cada condición es la que tenía su botón; el comentario de al lado dice de dónde viene.
 */
export function accionesDeLaFicha(e: EntradaDeAcciones): AccionesDeLaFicha {
  const { yo, pedido, abierto } = e;
  const stage = pedido.stage;
  const esChofer = yo.role === "driver";
  const hay: { id: IdDeAccion; texto: Texto; titulo?: Texto; estilo: EstiloDeBoton; siempreActiva?: true }[] = [];
  const pasos: PasoAbierto[] = [];
  const avisos: Aviso[] = [];

  // El comprobante imprimible. No para el chofer: no hay impresora en el camión.
  if (!esChofer) hay.push({ id: "imprimir", texto: { en: "🖨 Slip", es: "🖨 Comprobante" }, estilo: "btn-ghost" });

  // «Editar» dice lo único que va a poder tocar (D-480): el formulario, o solo la fecha.
  if (e.edicion !== "nada") {
    hay.push({
      id: "editar",
      texto: e.edicion === "solo_fecha" ? { en: "Edit date", es: "Editar fecha" } : { en: "Edit", es: "Editar" },
      estilo: "btn-ghost",
    });
  }

  // Quien crea órdenes lleva sus borradores y sus rechazadas a aprobación. El botón dice dónde aterriza (D-313).
  if (canCreate(yo)) {
    const aprueba = e.etapaDeEnvio === "approved";
    if (stage === "draft") {
      hay.push({ id: "enviar", estilo: "btn-primary",
        texto: aprueba ? { en: "Submit (approved)", es: "Enviar (aprobada)" } : { en: "Submit for approval", es: "Enviar a aprobación" } });
    }
    if (stage === "rejected") {
      hay.push({ id: "reenviar", estilo: "btn-primary",
        texto: aprueba ? { en: "Resubmit (approved)", es: "Reenviar (aprobada)" } : { en: "Resubmit", es: "Reenviar" } });
    }
  }

  // Anular: quién y desde qué etapa, la regla compartida con el guard (`puedeAnular`, 122).
  if (puedeAnular(yo.role, stage)) {
    if (abierto.anular) pasos.push("anular");
    else hay.push({ id: "anular", texto: { en: "Cancel order", es: "Cancelar orden" }, estilo: "btn-danger" });
  }

  // Quien aprueba, en una pendiente.
  if (canApprove(yo) && stage === "pending") {
    if (abierto.rechazar) {
      pasos.push("rechazar");
    } else {
      hay.push({ id: "rechazar", texto: { en: "Reject…", es: "Rechazar…" }, estilo: "btn-danger" });
      hay.push({ id: "aprobar", texto: { en: "Approve", es: "Aprobar" }, estilo: "btn-green" });
    }
  }
  if (canApprove(yo) && stage === "approved") {
    hay.push({ id: "desbloquear", texto: { en: "Unlock (back to pending)", es: "Desbloquear (volver a pendiente)" }, estilo: "btn-amber" });
  }

  // El vendedor agrega material a SU orden (D-339), con la regla del guard de la 138.
  if (puedeAgregarMaterial(yo, pedido)) {
    hay.push({ id: "agregar_material", texto: { en: "➕ Add material", es: "➕ Agregar material" }, estilo: "btn-ghost" });
  }

  // Almacén, y el gerente que hace bodega (D-397): `preparaEnLaFicha`, espejo del guard.
  if (preparaEnLaFicha(yo)) {
    if (stage === "approved") hay.push({ id: "comenzar", texto: { en: "Start preparing", es: "Comenzar preparación" }, estilo: "btn-primary" });
    if (stage === "fulfilling") hay.push({ id: "marcar_listo", texto: { en: "Mark ready", es: "Marcar listo" }, estilo: "btn-green" });
  }

  // Recoger una lista: quien entrega, o el gerente (D-397). «Iniciar viaje» solo quien entrega: es un tiempo
  // del chofer, y estamparlo desde la oficina falsearía el KPI.
  if (recogeEnLaFicha(yo) && stage === "ready") {
    if (abierto.recoger) {
      pasos.push("recoger");
    } else {
      if (canDeliver(yo) && !e.salidaEn) {
        hay.push({ id: "iniciar_viaje", texto: { en: "🚗 Start drive", es: "🚗 Iniciar viaje" }, estilo: "btn-ghost",
          titulo: { en: "Start the drive to the pickup point", es: "Iniciar el viaje al punto de recolección" } });
      } else if (canDeliver(yo) && e.salidaEn) {
        avisos.push({ id: "en_camino", desde: e.salidaEn });
      }
      hay.push({ id: "recoger", texto: { en: "🚚 Pick up", es: "🚚 Recoger" }, estilo: "btn-primary",
        titulo: { en: "Mark loaded and go out for delivery", es: "Marcar cargada y salir en reparto" } });
    }
  }

  // En reparto. Almacén RECIBE la que llega a su tienda (D-409) en lugar de marcarla entregada.
  if (e.puedeRecibirla && stage === "picked_up" && !abierto.pod) {
    hay.push({ id: "recibir", texto: { en: "📥 Receive", es: "📥 Recibir" }, estilo: "btn-green" });
  } else if (canDeliver(yo) && stage === "picked_up" && !abierto.pod) {
    if (!e.llegadaEn) {
      hay.push({ id: "llegue", texto: { en: "🚦 Arrived at stop", es: "🚦 Llegué a la parada" }, estilo: "btn-ghost" });
    } else {
      avisos.push({ id: "llego", desde: e.llegadaEn });
    }
    // Dejar en tienda (D-224): la misma regla que el control compartido usa para enseñarse.
    if (puedeDejarEnTienda(pedido, yo, canDeliver(yo))) {
      if (abierto.dejar) pasos.push("dejar");
      else hay.push({ id: "dejar_en_tienda", texto: { en: "🏬 Leave at store", es: "🏬 Dejar en tienda" }, estilo: "btn-amber",
        titulo: { en: "Drop it at one of our stores so another driver can take it", es: "Déjelo en una de nuestras tiendas para que otro chofer lo lleve" } });
    }
    hay.push({ id: "marcar_entregado", texto: { en: "Mark delivered", es: "Marcar entregado" }, estilo: "btn-green" });
  }

  // Entregar ya / deshacer un paso (D-361, D-383): estaban en su propia fila, encima del pie.
  if (!abierto.motivoDeSalto) {
    if (puedeEntregarYa(yo.role, stage)) {
      hay.push({ id: "entregar_ya", texto: { en: "✓ Mark delivered now", es: "✓ Marcar entregada ya" }, estilo: "btn-ghost",
        titulo: { en: "Close it as delivered, without a signature", es: "Cerrarla como entregada, sin firma" } });
    }
    const anterior = etapaAnterior(stage);
    if (e.deshaceAqui && anterior) {
      hay.push({ id: "deshacer", texto: { en: "↩ Undo stage", es: "↩ Deshacer etapa" }, estilo: "btn-ghost",
        titulo: { en: `Back to ${stageLabel(anterior, "en")}`, es: `Volver a ${stageLabel(anterior, "es")}` } });
    }
  }

  // La reentrega, en una entregada, para los roles que deja el guard. Su botón nunca se apagaba: sigue igual.
  if (stage === "delivered" && registraReentrega(yo.role) && !abierto.reentrega) {
    hay.push({ id: "reentrega", texto: { en: "🔁 Record re-delivery", es: "🔁 Registrar reentrega" }, estilo: "btn-amber", siempreActiva: true,
      titulo: { en: "Log a repeat of this delivery (warehouse error, damage…) as a new linked order.",
        es: "Registra una repetición de esta entrega (error de almacén, daño…) como una nueva orden vinculada." } });
  }

  // Duplicar y borrar: estaban a la izquierda del pie.
  if (canCreate(yo)) {
    hay.push({ id: "duplicar", texto: { en: "⧉ Duplicate", es: "⧉ Duplicar" }, estilo: "btn-ghost",
      titulo: { en: "Create a new draft order from this one", es: "Crear una nueva orden borrador a partir de esta" } });
  }
  if (e.borraAqui) hay.push({ id: "eliminar", texto: { en: "Delete", es: "Eliminar" }, estilo: "btn-danger" });

  const acciones: AccionDeLaFicha[] = hay
    .map((a) => ({
      id: a.id,
      texto: a.texto,
      titulo: a.titulo ?? null,
      peligro: PELIGRO.has(a.id),
      estilo: a.estilo,
      deshabilitada: e.ocupado && !a.siempreActiva ? MOTIVO_OCUPADO : null,
    }))
    .sort((a, b) => ORDEN_DEL_MENU.indexOf(a.id) - ORDEN_DEL_MENU.indexOf(b.id));

  const idPrincipal = accionPrincipal(acciones.map((a) => a.id), pasos);
  return {
    principal: acciones.find((a) => a.id === idPrincipal) ?? null,
    menu: acciones.filter((a) => a.id !== idPrincipal),
    pasos,
    avisos,
  };
}
