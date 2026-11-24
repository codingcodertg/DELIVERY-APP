import { APPS_AVISO, type AppAviso, type AvisoUnificado, type FiltroDeApp } from "@/lib/notificaciones-todas";

// ============================================================
// El centro de avisos (pantalla completa, desde la campana): agrupa los avisos por app y por tipo, con sus cuentas.
//
// Es la primera versión: solo deja VER el ruido por grupos, para que el dueño diga qué quitar (reunión del 23 nov 2026).
// Aquí no se apaga nada todavía: ni se filtra lo que llega, ni se cambia quién recibe qué (D-NEXT).
//
// El tipo de un aviso de la tabla común es su `kind`; el de un aviso de RRHH, su `type`. Un `kind` sin etiqueta aquí
// se enseña con su nombre crudo: no se oculta nada.
// ============================================================

/** Un texto en los dos idiomas. */
export interface EtiquetaBilingue { en: string; es: string }

const ETIQUETAS_DE_TIPO = new Map<string, EtiquetaBilingue>([
  // Entregas: las etapas de una orden (`notificationsForStage`, lib/notifications.ts).
  ["pending", { en: "Awaiting approval", es: "Por aprobar" }],
  ["approved", { en: "Approved", es: "Aprobada" }],
  ["rejected", { en: "Rejected order", es: "Orden rechazada" }],
  ["ready", { en: "Ready for delivery", es: "Lista para entregar" }],
  ["picked_up", { en: "Picked up", es: "Recogida" }],
  ["delivered", { en: "Delivered", es: "Entregada" }],
  ["canceled", { en: "Canceled", es: "Anulada" }],
  ["rescheduled", { en: "Rescheduled", es: "Reprogramada" }],
  // Entregas: otros avisos de una orden o de una parada.
  ["assigned", { en: "Assigned to you", es: "Asignada a ti" }],
  ["tomada_por_chofer", { en: "Taken by a driver", es: "Tomada por un chofer" }],
  ["customer_rejected", { en: "Rejected by the customer", es: "Rechazada por el cliente" }],
  ["chat", { en: "Chat", es: "Chat" }],
  // Entregas: solicitudes de asignación (lib/solicitud-de-asignacion.ts).
  ["assign_request", { en: "Assignment request", es: "Solicitud de asignación" }],
  ["assign_request_approved", { en: "Assignment request approved", es: "Solicitud de asignación aprobada" }],
  ["assign_request_rejected", { en: "Assignment request rejected", es: "Solicitud de asignación rechazada" }],
  // Entregas: solicitudes de ayuda (lib/help-thread.ts, lib/notifications.ts).
  ["ayuda_atendida", { en: "Help request handled", es: "Ayuda atendida" }],
  ["ayuda_respuesta", { en: "Help reply", es: "Respuesta de ayuda" }],
  ["ayuda_mensaje", { en: "Help message", es: "Mensaje de ayuda" }],
  // Clientes: solicitudes de cliente (lib/customers/avisos-de-solicitud.ts).
  ["cliente_solicitud_nueva", { en: "New customer request", es: "Solicitud de cliente nuevo" }],
  ["cliente_solicitud_aprobada", { en: "Customer approved", es: "Cliente aprobado" }],
  ["cliente_solicitud_rechazada", { en: "Customer request rejected", es: "Solicitud de cliente rechazada" }],
  ["cliente_solicitud_revisar", { en: "Customer request to review", es: "Solicitud de cliente a revisar" }],
  // Recursos Humanos: el `type` de `clockin.notifications` (los que escribe el fichaje).
  ["out_of_radius", { en: "Clock-in out of range", es: "Fichaje fuera de rango" }],
  ["leaving_while_clocked_in", { en: "Left while clocked in", es: "Salida con el fichaje abierto" }],
  ["other", { en: "Other", es: "Otros" }],
]);

/** La etiqueta de un tipo. Un tipo sin etiqueta sale con su nombre crudo; uno vacío, «Sin tipo». */
export function etiquetaDelTipo(tipo: string): EtiquetaBilingue {
  if (!tipo) return { en: "No type", es: "Sin tipo" };
  return ETIQUETAS_DE_TIPO.get(tipo) ?? { en: tipo, es: tipo };
}

/** El tipo de un aviso de la lista unida: su `kind` si es de la tabla común, su `type` si es de RRHH. */
export function tipoDelAviso(n: AvisoUnificado): string {
  return n.base ? n.base.kind : (n.tipo ?? "");
}

export interface GrupoDeTipo { tipo: string; total: number; sinLeer: number }
export interface GrupoDeApp { app: AppAviso; total: number; sinLeer: number; tipos: GrupoDeTipo[] }
export interface GruposDelCentro { total: number; sinLeer: number; apps: GrupoDeApp[] }

/**
 * Cuenta los avisos por app y, dentro de cada app, por tipo. Las apps van en el orden de siempre (solo las que tienen
 * avisos); los tipos, del más numeroso al menos, para que el más ruidoso quede arriba.
 */
export function gruposDelCentro(avisos: readonly AvisoUnificado[]): GruposDelCentro {
  const porApp = new Map<AppAviso, Map<string, GrupoDeTipo>>();
  let total = 0;
  let sinLeer = 0;
  for (const n of avisos) {
    total++;
    if (!n.read) sinLeer++;
    let tipos = porApp.get(n.app);
    if (!tipos) { tipos = new Map(); porApp.set(n.app, tipos); }
    const tipo = tipoDelAviso(n);
    let g = tipos.get(tipo);
    if (!g) { g = { tipo, total: 0, sinLeer: 0 }; tipos.set(tipo, g); }
    g.total++;
    if (!n.read) g.sinLeer++;
  }
  const apps: GrupoDeApp[] = APPS_AVISO.filter((a) => porApp.has(a)).map((app) => {
    const tipos = [...porApp.get(app)!.values()].sort((a, b) => b.total - a.total || a.tipo.localeCompare(b.tipo));
    return {
      app,
      total: tipos.reduce((s, g) => s + g.total, 0),
      sinLeer: tipos.reduce((s, g) => s + g.sinLeer, 0),
      tipos,
    };
  });
  return { total, sinLeer, apps };
}

/** Lo que el centro tiene seleccionado: una app (o «todas») y, opcionalmente, un tipo dentro de esa app. */
export interface SeleccionDelCentro { app: FiltroDeApp; tipo: string | null }

export const SELECCION_INICIAL: SeleccionDelCentro = { app: "todas", tipo: null };

/** Los avisos de la selección, en el mismo orden (el más nuevo primero), y solo los sin leer si se pide. */
export function avisosDelCentro(avisos: readonly AvisoUnificado[], sel: SeleccionDelCentro, soloSinLeer: boolean): AvisoUnificado[] {
  return avisos.filter((n) =>
    (sel.app === "todas" || n.app === sel.app)
    && (sel.tipo === null || tipoDelAviso(n) === sel.tipo)
    && (!soloSinLeer || !n.read));
}
