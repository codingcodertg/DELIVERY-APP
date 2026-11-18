import { escrituraRecogida } from "@/lib/one-tap-stop";
import type { Delivery, Stage } from "@/lib/types";

// ============================================================
// «🔁 Cambiar etapa» en la tabla de paradas del Gestor de rutas (solo admin). El dueño: «add a button that says Cambiar etapa
// up there next to PNG; activating it opens up the stage of the orders so I can mark pickup and delivered myself».
//
// Qué acciones salen en cada etapa, y qué se escribe. La escritura es la MISMA que el admin usa desde la ficha: `setStage`
// (el mismo que llama `OrderModal`), con `escrituraRecogida` para la recogida y sin prueba de entrega para la entrega
// («Marcar entregada ya», `entregar_ya`, que la ficha ofrece al admin en estas mismas etapas). El admin se salta la lista
// de transiciones del cliente (`canTransition`) y el guard de la base (`guard_delivery_stage`: `if r = 'admin' then return NEW`).
// ============================================================

export type AccionDeEtapaAdmin = "recoger" | "entregar";

/** Solo el admin ve el interruptor y sus acciones. Ningún otro rol cambia lo que ve. */
export function puedeCambiarEtapaAqui(rol: string | null | undefined): boolean {
  return rol === "admin";
}

/**
 * Las acciones que salen en la celda de ETAPA para una orden en esta etapa. «Recogido» desde aprobada, preparando o lista;
 * «Entregado» desde aprobada, preparando, lista o en reparto. Entregada y anulada: ninguna (solo la insignia).
 */
export function accionesDeEtapaParaAdmin(stage: string | null | undefined): AccionDeEtapaAdmin[] {
  if (stage === "approved" || stage === "fulfilling" || stage === "ready") return ["recoger", "entregar"];
  if (stage === "picked_up") return ["entregar"];
  return [];
}

const NOTA_DE_ADMIN = { en: "Changed by the admin from the Route Manager", es: "Cambiada por el admin desde el Gestor de rutas" } as const;

/** La pregunta antes de escribir: la factura y la etapa nueva. */
export function preguntaCambiarEtapaAdmin(
  accion: AccionDeEtapaAdmin, factura: string, t: (en: string, es: string) => string,
): { mensaje: string; confirmar: string } {
  if (accion === "recoger") {
    return {
      mensaje: t(`Mark ${factura} as picked up (on the truck)? It's saved in its history as changed by the admin from the Route Manager.`,
        `¿Marcar ${factura} como recogida (en el camión)? Queda en su historial como cambiada por el admin desde el Gestor de rutas.`),
      confirmar: t("Picked up", "Recogido"),
    };
  }
  return {
    mensaje: t(`Mark ${factura} as delivered? It's saved in its history as changed by the admin from the Route Manager.`,
      `¿Marcar ${factura} como entregada? Queda en su historial como cambiada por el admin desde el Gestor de rutas.`),
    confirmar: t("Delivered", "Entregado"),
  };
}

/**
 * Lo que se escribe con `setStage`: la etapa, la nota del historial (con la marca de admin) y los campos extra. La recogida
 * usa la misma escritura que la ficha (`escrituraRecogida`, sin GPS: queda la hora). La entrega no lleva prueba.
 */
export function escrituraCambiarEtapaAdmin(args: {
  accion: AccionDeEtapaAdmin;
  pedido: Delivery;
  me: { role?: string | null; full_name?: string | null } | null | undefined;
  t: (en: string, es: string) => string;
}): { stage: Stage; note: string; extra: Record<string, unknown> } {
  const marca = args.t(NOTA_DE_ADMIN.en, NOTA_DE_ADMIN.es);
  if (args.accion === "recoger") {
    const e = escrituraRecogida({ pedido: args.pedido, me: args.me, gps: null, t: args.t });
    return { stage: "picked_up", note: `${e.note} · ${marca}`, extra: e.extra };
  }
  return { stage: "delivered", note: `${args.t("Delivered", "Entregado")} · ${marca}`, extra: {} };
}
