import type { AppNotification } from "@/lib/notifications";
import { esAvisoDeCliente } from "@/lib/customers/avisos-de-solicitud";
import { destinoDelAviso } from "@/lib/destino-del-aviso";
import { claseDelAviso, type ClaseDelAviso } from "@/lib/clase-del-aviso";

// ============================================================
// La vista «Todas» de la campana: los avisos de las tres apps en una sola lista.
//
// Entregas y Clientes leen la MISMA tabla (`public.notifications`); Recursos Humanos (fichaje) tiene la suya
// (`clockin.notifications`, con `employee_id`). Aquí se juntan, se etiquetan con su app y se filtran por app. No hay
// columna nueva ni consulta nueva: la app de un aviso de la tabla común sale de su `kind`.
// ============================================================

export type AppAviso = "entregas" | "clientes" | "rrhh";
export type FiltroDeApp = "todas" | AppAviso;

export const APPS_AVISO: readonly AppAviso[] = ["entregas", "clientes", "rrhh"];

/** Un aviso de Recursos Humanos, tal como lo devuelve `getMyNotifications` (con su `type`, para el centro de avisos). */
export interface AvisoRrhh {
  id: string;
  message: string;
  read: boolean;
  created_at: string;
  /** El tipo del aviso (`type` de la tabla de RRHH: `out_of_radius`, `other`…). Para agrupar en el centro de avisos. */
  type?: string;
}

/** Un aviso de la lista unida. `base` está si viene de `public.notifications`; si no, es de Recursos Humanos. */
export interface AvisoUnificado {
  /** Único en la lista: los de la tabla común y los de RRHH tienen ids distintos, pero se prefija por si acaso. */
  key: string;
  app: AppAviso;
  id: string;
  read: boolean;
  created_at: string;
  base: AppNotification | null;
  /** El texto de un aviso de RRHH. Para los de la tabla común, lo pone `mensajeDelAviso` en la campana. */
  message: string | null;
  /** El tipo de un aviso de RRHH (su `type`). Los de la tabla común no lo usan: agrupan por su `kind`. */
  tipo?: string;
}

/** La app a la que pertenece un aviso de la tabla común, por su `kind`. Lo que no es de Clientes es de Entregas. */
export function appDelAviso(kind: string | null | undefined): AppAviso {
  return kind && esAvisoDeCliente(kind) ? "clientes" : "entregas";
}

/** Une los avisos de Entregas/Clientes con los de RRHH, el más nuevo primero. No toca los originales. */
export function unificarAvisos(args: {
  base: readonly AppNotification[];
  rrhh: readonly AvisoRrhh[];
}): AvisoUnificado[] {
  const unidos: AvisoUnificado[] = [
    ...args.base.map((n): AvisoUnificado => ({
      key: `base-${n.id}`,
      app: appDelAviso(n.kind),
      id: n.id,
      read: n.read,
      created_at: n.created_at,
      base: n,
      message: null,
    })),
    ...args.rrhh.map((n): AvisoUnificado => ({
      key: `rrhh-${n.id}`,
      app: "rrhh",
      id: n.id,
      read: n.read,
      created_at: n.created_at,
      base: null,
      message: n.message,
      tipo: n.type ?? "",
    })),
  ];
  return unidos.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Los de una app, o todos si el filtro es «todas». */
export function filtrarPorApp(items: readonly AvisoUnificado[], filtro: FiltroDeApp): AvisoUnificado[] {
  return filtro === "todas" ? [...items] : items.filter((n) => n.app === filtro);
}

/** Los de la tabla común en una sección (importantes o secundarios, D-880). RRHH no tiene sección: no entra aquí. */
export function avisosDeLaClase(items: readonly AvisoUnificado[], clase: ClaseDelAviso): AvisoUnificado[] {
  return items.filter((n) => n.base !== null && claseDelAviso(n.base.kind) === clase);
}

/** Cuántos sin leer hay en cada app, para el número de cada filtro. */
export function sinLeerPorApp(items: readonly AvisoUnificado[]): Record<AppAviso, number> {
  const c: Record<AppAviso, number> = { entregas: 0, clientes: 0, rrhh: 0 };
  for (const n of items) if (!n.read) c[n.app]++;
  return c;
}

/** Las apps que tienen al menos un aviso, en el orden de siempre. Para no mostrar filtros vacíos. */
export function appsConAvisos(items: readonly AvisoUnificado[]): AppAviso[] {
  const hay = new Set(items.map((n) => n.app));
  return APPS_AVISO.filter((a) => hay.has(a));
}

/**
 * Qué pasa al pulsar un aviso de la lista:
 * - «ir»: su destino está en ESTA app (una orden de Entregas desde Entregas): se va allí, como siempre.
 * - «tarjeta»: es de otra app, o no tiene destino: se abre una tarjeta en el mismo panel con el aviso entero. Solo
 *   entonces hay un enlace «Abrir en <app>», secundario (regla «abrir en tarjeta»: no se salta de app sin pedirlo).
 */
export type AccionDelAviso =
  | { tipo: "ir"; href: string }
  | { tipo: "tarjeta"; app: AppAviso; href: string | null };

export function accionDelAviso(item: AvisoUnificado, appActual: AppAviso): AccionDelAviso {
  const href = item.base ? destinoDelAviso(item.base) : null;
  if (href && item.app === appActual) return { tipo: "ir", href };
  return { tipo: "tarjeta", app: item.app, href };
}
