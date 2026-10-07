// ============================================================
// El presencial no necesita proyecto: su «proyecto» es su tienda y su puesto (D-NEXT).
//
// El dueño, dictado el 2026-10-07: «la gente que está presencial, no ocupa que se les asignen
// proyectos. […] con el proyecto de ellos prácticamente es la tienda y el puesto que ellos tienen.
// Entonces, para ellos tienen esa, esa excepción para el time tracker».
//
// Time Tracker nació para quien cronometra PROYECTOS (el remoto: `assignments`, `sessions.project_id`).
// El presencial ficha en una tienda (D-123, D-125) y nunca tuvo proyecto: medido el 2026-10-07, los
// 6 presenciales tienen 0 asignaciones. Aquí vive, pura y sin React, la regla de la excepción y la
// etiqueta que ocupa el sitio del proyecto en cualquier listado de horas por proyecto. Las pantallas
// la llaman; ninguna decide por su cuenta.
//
// DE DÓNDE SALE CADA MITAD (medido en producción el 2026-10-07, en solo lectura):
//
//  · TIENDA: la de FICHAJE —`clockin.employee_settings.store_id` → `clockin.job_sites.name`
//    («Pharr»)—, que es donde ficha (la geocerca la usa), la que agrupa Nómina › En sitio («📍 Pharr»)
//    y la que se cambia en Usuarios › Time Tracker. Si no tiene, la del hub (`public.profiles.store`,
//    «RDZ Pharr»). 5 de 6 presenciales tienen las dos y dicen la misma tienda; el sexto, ninguna.
//  · PUESTO: el campo «Puesto» de fichaje (`clockin.employee_settings.position`), el que está en esa
//    misma sección de Usuarios. Sin poner cuenta como «Ventas», PORQUE ES LO QUE ESA FICHA YA ENSEÑA
//    para un puesto vacío (`PUESTO_POR_DEFECTO`, que ahora usa ella también): lo que se ve en Usuarios
//    es lo que sale aquí. Solo 2 de 6 lo tienen puesto; los otros 3 con ficha y sin puesto figuran en
//    su expediente de RR. HH. como «Ventas», así que el defecto no contradice a nadie hoy.
//    Descartados: el rol del hub (`profiles.role`, «sales»/«accounting»: decide qué pantallas de
//    Entregas ve, no qué hace) y el departamento del expediente (`recruiting.employee_files`: solo lo
//    lee el gerente de RR. HH., así que el empleado no vería su propia etiqueta).
// ============================================================

import { effWorkerType } from "@/lib/timetracker/helpers";

export type Idioma = "en" | "es";

/** Lo que hace falta de una persona para decidir y para rotular. Encaja con `Employee`. */
export type PersonaConTienda = {
  workerType?: string | null;
  tienda?: string | null;
  puesto?: string | null;
};

/**
 * ¿Se le pide proyecto a esta persona? Al remoto sí, como siempre. Al presencial no: ni para
 * registrar tiempo, ni para pedirlo, ni avisos de «no tienes proyecto», ni ofrecerle para asignar.
 * El tipo es el efectivo (`effWorkerType`): sin elegir cuenta el de la empresa, que hoy es remoto.
 */
export function necesitaProyecto(p: PersonaConTienda | null | undefined): boolean {
  return effWorkerType(p) !== "inhouse";
}

/** El puesto que la ficha de Usuarios enseña cuando nadie lo puso (`ClockinSettings`). */
export const PUESTO_POR_DEFECTO = "sales";

/** Los puestos de fichaje (`lib/clockin/positions.ts`), con el texto de la ficha de Usuarios. */
export const ETIQUETAS_DE_PUESTO: Record<string, { en: string; es: string }> = {
  office: { en: "Office", es: "Oficina" },
  sales: { en: "Sales", es: "Ventas" },
  warehouse: { en: "Warehouse", es: "Almacén" },
  manager: { en: "Manager", es: "Gerente" },
  owner: { en: "Owner", es: "Dueño" },
};

/**
 * La tienda: la de fichaje y, si no tiene, la del hub. Vacío cuenta como no tener.
 * @param tiendaDeFichaje nombre del `job_site` de su `store_id`
 * @param tiendaDelHub `public.profiles.store`
 */
export function elegirTienda(tiendaDeFichaje: string | null | undefined, tiendaDelHub: string | null | undefined): string | null {
  const f = (tiendaDeFichaje ?? "").trim();
  if (f) return f;
  const h = (tiendaDelHub ?? "").trim();
  return h || null;
}

/**
 * El puesto (el código: `sales`, `office`…). Sin ficha de fichaje no hay ninguno —ni campo donde
 * ponerlo—; con ficha y sin poner, el mismo que enseña la ficha.
 */
export function elegirPuesto(tieneFichaDeFichaje: boolean, position: string | null | undefined): string | null {
  if (!tieneFichaDeFichaje) return null;
  const p = (position ?? "").trim();
  return p || PUESTO_POR_DEFECTO;
}

/**
 * Las dos a la vez, desde las filas tal como llegan de la base. Lo usan el layout (la propia
 * persona) y el proveedor de datos (todas, para el gerente): una sola regla para las dos vistas.
 */
export function resolverTiendaYPuesto(args: {
  /** Su fila de `clockin.employee_settings`, o null si no tiene ficha de fichaje. */
  fichaje: { store_id?: string | null; position?: string | null } | null | undefined;
  /** `clockin.job_sites`: id → nombre. */
  tiendas: Map<string, string>;
  /** `public.profiles.store`. */
  tiendaDelHub: string | null | undefined;
}): { tienda: string | null; puesto: string | null } {
  const f = args.fichaje ?? null;
  const deFichaje = f?.store_id ? args.tiendas.get(f.store_id) ?? null : null;
  return { tienda: elegirTienda(deFichaje, args.tiendaDelHub), puesto: elegirPuesto(!!f, f?.position) };
}

/** «Ventas» / «Sales». Un código que no está en la lista se enseña tal cual, no se esconde. */
export function etiquetaDePuesto(codigo: string | null | undefined, lang: Idioma): string | null {
  if (!codigo) return null;
  const e = ETIQUETAS_DE_PUESTO[codigo];
  return e ? e[lang] : codigo;
}

const SIN_DATOS: Record<Idioma, string> = {
  en: "In-house — no store or position set",
  es: "Presencial — sin tienda ni puesto",
};

/** «Pharr · Ventas». Con una sola de las dos, esa. Sin ninguna, lo dice (y se arregla en Usuarios). */
export function tiendaYPuesto(p: PersonaConTienda, lang: Idioma): string {
  const partes = [p.tienda?.trim() || null, etiquetaDePuesto(p.puesto, lang)].filter((x): x is string => !!x);
  return partes.length ? partes.join(" · ") : SIN_DATOS[lang];
}

/**
 * El nombre de una línea de horas en un listado POR PROYECTO (Mi semana, Nómina › Remoto y su CSV y
 * recibo, el Panel, Ahora mismo, las solicitudes).
 *
 * Con proyecto, el proyecto: también la de un presencial que lo tuviera. Sin proyecto y presencial,
 * su tienda y su puesto. Sin proyecto y remoto, lo de siempre (`sinProyecto`: «(eliminado)», «—»):
 * al remoto no le cambia nada.
 */
export function nombreDeLinea(
  proyecto: string | null | undefined,
  persona: PersonaConTienda | null | undefined,
  lang: Idioma,
  sinProyecto: string,
): string {
  if (proyecto) return proyecto;
  if (persona && !necesitaProyecto(persona)) return tiendaYPuesto(persona, lang);
  return sinProyecto;
}

/**
 * El campo «Proyecto» del formulario de «Agregar tiempo» (Mis solicitudes) y del de «Agregar
 * entrada» del gerente (Nómina › Remoto):
 *  · `obligatorio`: remoto, como siempre («Elige un proyecto»).
 *  · `fijo`: presencial sin proyectos: no hay nada que elegir; se enseña su tienda y su puesto.
 *  · `opcional`: presencial que además tiene alguno: puede elegirlo, y si no, va a su tienda y su puesto.
 */
export type CampoDeProyecto = "obligatorio" | "opcional" | "fijo";

export function campoDeProyecto(p: PersonaConTienda | null | undefined, cuantosProyectos: number): CampoDeProyecto {
  if (necesitaProyecto(p)) return "obligatorio";
  return cuantosProyectos > 0 ? "opcional" : "fijo";
}

/**
 * Quién sale en el desplegable de «Nueva asignación»: solo quien necesita proyecto. Al presencial no
 * se le ofrece —sale aparte, con su tienda y su puesto—, salvo al editar una asignación que ya tenga
 * (hoy ninguno: 0 de 6), que tiene que poder verse para cambiarla o quitarla.
 */
export function seOfreceParaAsignar(p: PersonaConTienda & { id: string }, editandoA: string | null | undefined): boolean {
  return necesitaProyecto(p) || p.id === editandoA;
}
