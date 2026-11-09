/**
 * Checklist de alta y baja (onboarding / offboarding) del empleado — D-934 (migración 275).
 *
 * Roberto en la junta: los pasos del alta son «signed email, RingCentral number, QuickBooks access, SharePoint/app
 * access, and app risk». La baja es el mismo set en reversa: quitar o recuperar cada cosa. La plantilla vive AQUÍ, en
 * código, para poder ajustarla sin tocar la base; la tabla solo guarda, por empleado y por fase, el estado de cada ítem
 * (pendiente / hecho / n-a), quién lo marcó y cuándo.
 *
 * Todo puro: la base y la pantalla están en `actions/checklist.ts` y en el expediente.
 */

export type FaseChecklist = "onboarding" | "offboarding";
export type EstadoItem = "pending" | "done" | "na";

/** Las dos fases, con su etiqueta bilingüe. */
export const FASES: readonly { key: FaseChecklist; en: string; es: string }[] = [
  { key: "onboarding", en: "Onboarding", es: "Alta" },
  { key: "offboarding", en: "Offboarding", es: "Baja" },
];

/** Los estados de un ítem, con su etiqueta bilingüe. */
export const ESTADOS_ITEM: readonly { key: EstadoItem; en: string; es: string }[] = [
  { key: "pending", en: "Pending", es: "Pendiente" },
  { key: "done", en: "Done", es: "Hecho" },
  { key: "na", en: "N/A", es: "N/A" },
];

/**
 * Un paso de la plantilla. El texto del alta y el de la baja se dan por separado porque la baja es la acción en reversa
 * («Signed email» → «Release signed email»). `key` es lo que se guarda y nunca se traduce.
 */
export interface PasoChecklist {
  key: string;
  icon: string;
  on: { en: string; es: string };
  off: { en: string; es: string };
}

/** La plantilla de Roberto (2026-11-09). Ajustar aquí, no en la base. */
export const PASOS_CHECKLIST: readonly PasoChecklist[] = [
  { key: "email_signed", icon: "✉️",
    on: { en: "Signed email", es: "Correo firmado" },
    off: { en: "Release signed email", es: "Liberar correo firmado" } },
  { key: "ringcentral", icon: "📞",
    on: { en: "RingCentral number", es: "Número de RingCentral" },
    off: { en: "Recover RingCentral number", es: "Recuperar número de RingCentral" } },
  { key: "quickbooks", icon: "📒",
    on: { en: "QuickBooks access", es: "Acceso a QuickBooks" },
    off: { en: "Remove QuickBooks access", es: "Quitar acceso a QuickBooks" } },
  { key: "sharepoint", icon: "🗂️",
    on: { en: "SharePoint / app access", es: "Acceso a SharePoint / app" },
    off: { en: "Remove SharePoint / app access", es: "Quitar acceso a SharePoint / app" } },
  { key: "app_risk", icon: "⚠️",
    on: { en: "App risk reviewed", es: "Riesgo del app revisado" },
    off: { en: "App risk cleared", es: "Riesgo del app liberado" } },
] as const;

/** Las claves válidas, para rechazar lo que no esté en la plantilla. */
export const CLAVES_CHECKLIST: readonly string[] = PASOS_CHECKLIST.map((p) => p.key);

export function esFaseValida(v: unknown): v is FaseChecklist {
  return v === "onboarding" || v === "offboarding";
}
export function esItemValido(key: unknown): key is string {
  return typeof key === "string" && CLAVES_CHECKLIST.includes(key);
}

/** Vacío o desconocido = «pendiente»: un ítem sin fila es un paso que falta por hacer. */
export function normalizaEstadoItem(v: string | null | undefined): EstadoItem {
  const limpio = (v ?? "").trim();
  return ESTADOS_ITEM.some((e) => e.key === limpio) ? (limpio as EstadoItem) : "pending";
}

/** La etiqueta de un paso para una fase y un idioma. */
export function etiquetaDePaso(p: PasoChecklist, fase: FaseChecklist, lang: "en" | "es"): string {
  const texto = fase === "offboarding" ? p.off : p.on;
  return lang === "es" ? texto.es : texto.en;
}

export function etiquetaDeEstadoItem(e: EstadoItem, lang: "en" | "es"): string {
  const x = ESTADOS_ITEM.find((s) => s.key === e);
  return x ? (lang === "es" ? x.es : x.en) : e;
}

/** Una fila guardada del checklist (lo que devuelve la base). */
export interface FilaChecklist {
  item_key: string;
  status: string | null;
  done_by_name?: string | null;
  done_at?: string | null;
  note?: string | null;
}

/** Un ítem ya resuelto para pintar: la plantilla + lo guardado (o «pendiente» si nunca se tocó). */
export interface ItemDeChecklist {
  key: string;
  icon: string;
  status: EstadoItem;
  done_by_name: string | null;
  done_at: string | null;
  note: string | null;
}

/**
 * La plantilla de una fase mezclada con lo guardado: devuelve SIEMPRE los cinco pasos, en orden, aunque la base no tenga
 * fila para alguno (ese sale «pendiente»). Así la pantalla no depende de que exista una fila por ítem.
 */
export function combinaChecklist(fase: FaseChecklist, filas: readonly FilaChecklist[]): ItemDeChecklist[] {
  const porClave = new Map(filas.map((f) => [f.item_key, f]));
  return PASOS_CHECKLIST.map((p) => {
    const f = porClave.get(p.key);
    return {
      key: p.key,
      icon: p.icon,
      status: normalizaEstadoItem(f?.status),
      done_by_name: f?.done_by_name ?? null,
      done_at: f?.done_at ?? null,
      note: f?.note ?? null,
    };
  });
}

/** El recuento de una fase: cuántos hechos, pendientes y n-a, y si ya está completa (nada pendiente). */
export function resumenChecklist(items: readonly ItemDeChecklist[]): {
  total: number; hechos: number; pendientes: number; na: number; completo: boolean;
} {
  const hechos = items.filter((i) => i.status === "done").length;
  const na = items.filter((i) => i.status === "na").length;
  const pendientes = items.filter((i) => i.status === "pending").length;
  return { total: items.length, hechos, pendientes, na, completo: items.length > 0 && pendientes === 0 };
}
