import { KIND_TOMADA_POR_CHOFER } from "@/lib/tomar-orden";
import { stageInfo } from "@/lib/constants";
import { ASSIGNED_KIND, AYUDA_ATENDIDA_KIND } from "@/lib/notifications";
import { AYUDA_MENSAJE_KIND, AYUDA_RESPUESTA_KIND } from "@/lib/help-thread";
import { AVISO_SOLICITUD_APROBADA, AVISO_SOLICITUD_NUEVA, AVISO_SOLICITUD_RECHAZADA } from "@/lib/solicitud-de-asignacion";
import { AVISO_CLIENTE_APROBADA, AVISO_CLIENTE_NUEVA, AVISO_CLIENTE_RECHAZADA, AVISO_CLIENTE_REVISAR } from "@/lib/customers/avisos-de-solicitud";
import type { AppAviso } from "@/lib/notificaciones-todas";

// ============================================================
// Lo que se pinta de cada aviso, compartido por la campana y el centro de avisos (D-M24): el tiempo relativo, el punto
// de color de su tipo y la etiqueta de cada app. Así los dos muestran lo mismo, sin copiar nada.
// ============================================================

/** Tiempo relativo compacto: «3m», «2h», «4d» (o «hace 3 min», «hace 2 h», «hace 4 d» en español). */
export function ago(iso: string, t: (en: string, es: string) => string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return t("just now", "ahora");
  const mins = Math.round(secs / 60);
  if (mins < 60) return t(`${mins}m ago`, `hace ${mins} min`);
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t(`${hrs}h ago`, `hace ${hrs} h`);
  const dias = Math.round(hrs / 24);
  return t(`${dias}d ago`, `hace ${dias} d`);
}

// El punto de cada aviso: el color de su tipo. Un `kind` que no es etapa se pinta con uno explícito (`stageInfo` cae a
// la primera etapa sin avisar).
export function colorDelAviso(kind: string): string {
  return kind === ASSIGNED_KIND ? "var(--accent)"
    : kind === AYUDA_ATENDIDA_KIND ? "var(--green)"
    : kind === AYUDA_RESPUESTA_KIND || kind === AYUDA_MENSAJE_KIND ? "var(--amber)"
    : kind === AVISO_SOLICITUD_NUEVA ? "var(--amber)"
    : kind === AVISO_SOLICITUD_APROBADA ? "var(--green)"
    : kind === AVISO_SOLICITUD_RECHAZADA ? "var(--red)"
    : kind === KIND_TOMADA_POR_CHOFER ? "var(--amber)"
    : kind === AVISO_CLIENTE_NUEVA || kind === AVISO_CLIENTE_REVISAR ? "var(--amber)"
    : kind === AVISO_CLIENTE_APROBADA ? "var(--green)"
    : kind === AVISO_CLIENTE_RECHAZADA ? "var(--red)"
    : stageInfo(kind).color;
}

// El color de la etiqueta de cada app en la vista «Todas».
export const COLOR_DE_APP: Record<AppAviso, string> = { entregas: "var(--accent)", clientes: "var(--amber)", rrhh: "var(--green)" };

/** El nombre de cada app, en el idioma de la pantalla. */
export function etiquetaDeApp(app: AppAviso, t: (en: string, es: string) => string): string {
  return app === "entregas" ? t("Deliveries", "Entregas")
    : app === "clientes" ? t("Customers", "Clientes")
    : t("HR", "RRHH");
}
