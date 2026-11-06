import type { Bilingue, ParteDeContexto } from "@/lib/ayuda-ubicacion";
import { STAGE_ES, stageInfo } from "@/lib/constants";
import { orderLabel } from "@/lib/utils";

/**
 * Lo que cada pantalla grande dice de sí misma en una solicitud de ayuda (D-NEXT), fuera de la pantalla para poder
 * probarlo: cada función recibe el estado que importa (pestaña, filtro, ficha abierta, paso) y devuelve las partes que
 * `useContextoDeAyuda` publica. La ruta ya la nombra `ayuda-ubicacion.ts`; esto es lo que va DETRÁS.
 *
 * Qué registro se nombra: solo el identificador que la persona ya tiene en pantalla —número de factura o de orden,
 * nombre de la cuenta, número de cotización, nombre del empleado en su expediente—. Nunca lo escrito en un buscador o en
 * un formulario (ahí puede haber un teléfono o una dirección): de una búsqueda solo se dice que la hay.
 */

const b = (en: string, es: string): Bilingue => ({ en, es });

/** Una fecha `YYYY-MM-DD` tal cual: no se traduce ni se mueve de zona, y es la que sale en el selector. */
function fecha(iso: string | null | undefined): string {
  return (iso ?? "").slice(0, 10);
}

// ---- La ficha de la orden (Entregas, Gestor, Chofer, Almacén, Clientes…) --------------------------------------

type OrdenAbierta = { invoice_num?: string | null; order_code?: string | null; order_no: number; order_suffix?: string | null; relay_step?: number | null };

/** «Order form open: invoice 171838», o por su número de orden si aún no tiene factura. Sin orden, es la ficha nueva. */
export function contextoDeOrden(orden: OrdenAbierta | null | undefined, editando = false): Bilingue {
  if (!orden) return b("New order form open", "Formulario de orden nueva abierto");
  const factura = (orden.invoice_num ?? "").trim();
  const cual = factura ? b(`invoice ${factura}`, `factura ${factura}`) : b(`order #${orderLabel(orden)}`, `orden #${orderLabel(orden)}`);
  return editando
    ? b(`Order form open (editing): ${cual.en}`, `Ficha de orden abierta (editando): ${cual.es}`)
    : b(`Order form open: ${cual.en}`, `Ficha de orden abierta: ${cual.es}`);
}

// ---- Entregas: la página principal ----------------------------------------------------------------------------

export function contextoDeEntregas(e: {
  /** La pastilla de etapa elegida («all» = todas). */
  etapa: string;
  preset: "all" | "today" | "tomorrow" | string;
  vista: "table" | "board";
  buscando: boolean;
  seleccionadas: number;
  importando: boolean;
  columnasAbiertas?: boolean;
}): ParteDeContexto[] {
  const fechas = e.preset === "today" ? b("Today", "Hoy") : e.preset === "tomorrow" ? b("Tomorrow", "Mañana") : b("All dates", "Todas las fechas");
  const etapa = e.etapa === "all"
    ? b("all stages", "todas las etapas")
    : b(stageInfo(e.etapa).label, STAGE_ES[stageInfo(e.etapa).key] ?? stageInfo(e.etapa).label);
  return [
    e.vista === "board" ? b("Board view", "Vista de tablero") : b("Table view", "Vista de tabla"),
    b(`Dates: ${fechas.en}`, `Fechas: ${fechas.es}`),
    b(`Stage filter: ${etapa.en}`, `Filtro de etapa: ${etapa.es}`),
    e.buscando && b("with a search typed", "con una búsqueda escrita"),
    e.seleccionadas > 0 && b(`${e.seleccionadas} order(s) selected`, `${e.seleccionadas} orden(es) seleccionada(s)`),
    e.columnasAbiertas && b("Columns menu open", "Menú de columnas abierto"),
    e.importando && b("Import orders window open", "Ventana de importar órdenes abierta"),
  ];
}

// ---- El Gestor de Rutas ---------------------------------------------------------------------------------------

const PESTANAS_DEL_GESTOR: Record<string, Bilingue> = {
  routes: b("Routes tab", "Pestaña Rutas"),
  orders: b("Unassigned tab", "Pestaña Sin asignar"),
  todas: b("All orders tab", "Pestaña Todas"),
  board: b("Board tab", "Pestaña Tablero"),
  timeline: b("Timeline tab", "Pestaña Horario"),
};
const CHIPS_DEL_GESTOR: Record<string, Bilingue> = {
  dia: b("this day", "este día"),
  todas: b("any day", "cualquier día"),
  overdue: b("overdue", "expiradas"),
  windowed: b("windowed", "con ventana"),
  noloc: b("no location", "sin ubicación"),
};

export function contextoDelGestor(e: {
  pestana: string;
  /** El chip de «Sin asignar» (solo cuenta en esa pestaña). */
  chip: string;
  fecha: string;
  todasLasFechas?: boolean;
  vistaEficiente?: boolean;
  soloLectura?: boolean;
  planAbierto?: boolean;
  incidenciasAbiertas?: boolean;
  repartoAbierto?: boolean;
  seleccionadas?: number;
}): ParteDeContexto[] {
  const chip = CHIPS_DEL_GESTOR[e.chip];
  return [
    PESTANAS_DEL_GESTOR[e.pestana] ?? e.pestana,
    e.pestana === "orders" && chip && e.chip !== "dia" && b(`filter: ${chip.en}`, `filtro: ${chip.es}`),
    e.todasLasFechas ? b("Date: all dates", "Fecha: todas") : b(`Date: ${fecha(e.fecha)}`, `Fecha: ${fecha(e.fecha)}`),
    e.vistaEficiente && b("Efficient view", "Vista eficiente"),
    e.soloLectura && b("read-only", "solo lectura"),
    (e.seleccionadas ?? 0) > 0 && b(`${e.seleccionadas} order(s) selected`, `${e.seleccionadas} orden(es) seleccionada(s)`),
    e.planAbierto && b("Route plan window open", "Ventana del plan de ruta abierta"),
    e.incidenciasAbiertas && b("Incidents window open", "Ventana de incidencias abierta"),
    e.repartoAbierto && b("Distribute orders window open", "Ventana de repartir órdenes abierta"),
  ];
}

// ---- Clientes -------------------------------------------------------------------------------------------------

export function contextoDeClientes(e: {
  ficha: { tipo: "ver"; cuenta: string; editar?: boolean } | { tipo: "nuevo" } | null;
  solicitudes: boolean;
  borradores: boolean;
  /** El cliente para el que se está pidiendo vendedor (su cuenta), si ese diálogo está abierto. */
  pidiendoVendedorPara?: string | null;
  buscando: boolean;
  elegidos: number;
}): ParteDeContexto[] {
  const f = e.ficha;
  return [
    e.buscando && b("with a search typed", "con una búsqueda escrita"),
    e.elegidos > 0 && b(`${e.elegidos} customer(s) selected`, `${e.elegidos} cliente(s) seleccionado(s)`),
    e.solicitudes && b("Requests panel", "Panel de solicitudes"),
    e.borradores && b("Saved drafts panel", "Panel de borradores guardados"),
    f?.tipo === "nuevo" && b("New customer form open", "Formulario de cliente nuevo abierto"),
    f?.tipo === "ver" && (f.editar
      ? b(`Customer file open (editing): ${f.cuenta}`, `Ficha de cliente abierta (editando): ${f.cuenta}`)
      : b(`Customer file open: ${f.cuenta}`, `Ficha de cliente abierta: ${f.cuenta}`)),
    !!e.pidiendoVendedorPara && b(`Request a salesperson window open: ${e.pidiendoVendedorPara}`, `Ventana de pedir vendedor abierta: ${e.pidiendoVendedorPara}`),
  ];
}

// ---- Leads ----------------------------------------------------------------------------------------------------

const PESTANAS_DE_LEADS: Record<string, Bilingue> = {
  banco: b("Lead bank tab", "Pestaña Banco de leads"),
  mio: b("My pool tab", "Pestaña Mi pool"),
  admin: b("Admin tab", "Pestaña Admin"),
  privado: b("STXP Pool tab", "Pestaña STXP Pool"),
};
const DIALOGOS_DE_LEADS: Record<string, Bilingue> = {
  cerrar: b("Close lead window open", "Ventana de cerrar lead abierta"),
  nota: b("Lead note / action window open", "Ventana de nota o acción del lead abierta"),
  admin: b("Lead admin window open", "Ventana de administrar lead abierta"),
  cliente: b("Matching customer card open", "Ficha del cliente coincidente abierta"),
};

/** De un lead NO se nombra a la persona: es un prospecto, no un registro de la casa. Se dice la pestaña y qué se abrió. */
export function contextoDeLeads(e: {
  pestana: string;
  /** El pool (la tienda) que se mira, o `null`. */
  pool: string | null;
  vista: string;
  buscando: boolean;
  dialogo: string | null;
  historialAbierto: boolean;
  demo?: boolean;
}): ParteDeContexto[] {
  return [
    PESTANAS_DE_LEADS[e.pestana] ?? e.pestana,
    e.pestana === "banco" && !!e.pool && b(`pool: ${e.pool}`, `pool: ${e.pool}`),
    e.pestana === "banco" && (e.vista === "todas" ? b("showing all leads", "viendo todos los leads") : b("showing free leads", "viendo los leads libres")),
    e.buscando && b("with a search typed", "con una búsqueda escrita"),
    e.historialAbierto && b("Lead history open", "Historial del lead abierto"),
    !!e.dialogo && (DIALOGOS_DE_LEADS[e.dialogo] ?? e.dialogo),
    e.demo && b("practice data (teaching mode)", "datos de práctica (modo enseñanza)"),
  ];
}

// ---- Operaciones de almacén: el asistente ---------------------------------------------------------------------

/**
 * El paso del asistente: «step 3 of 7 'How many pieces?'». La ruta ya dijo el tipo de reporte («New report · Scrap /
 * damage»); aquí va por dónde iba. Se nombra la PREGUNTA, nunca lo que contestó.
 */
export function contextoDelAsistente(e: {
  paso: { en: string; es: string } | null;
  indice: number;
  total: number;
  enResumen: boolean;
  enviado: boolean;
  tienda?: string | null;
}): ParteDeContexto[] {
  const donde: ParteDeContexto = e.enviado
    ? b("report sent (confirmation screen)", "reporte enviado (pantalla de confirmación)")
    : e.enResumen
      ? b("summary before sending", "resumen antes de enviar")
      : e.paso
        ? b(`step ${e.indice + 1} of ${e.total} '${e.paso.en}'`, `paso ${e.indice + 1} de ${e.total} «${e.paso.es}»`)
        : null;
  return [donde, !!e.tienda && b(`store: ${e.tienda}`, `tienda: ${e.tienda}`)];
}

// ---- Quote Builder --------------------------------------------------------------------------------------------

const PESTANAS_DEL_ESTIMADOR: Record<string, Bilingue> = {
  cotizacion: b("Quote tab", "Pestaña Cotización"),
  competencia: b("Competitors tab", "Pestaña Competencia"),
  todas: b("All quotes tab (admin)", "Pestaña Todas las cotizaciones (admin)"),
};

export function contextoDelEstimador(e: {
  pestana: string;
  /** El número de la cotización que se ve (el que sale impreso), o `null` si es una nueva sin guardar. */
  numero: string | number | null;
  guardada: boolean;
  lineas: number;
  vistaPrevia: boolean;
  politicaAbierta: boolean;
  desdeLead: boolean;
}): ParteDeContexto[] {
  const enCotizacion = e.pestana === "cotizacion";
  return [
    PESTANAS_DEL_ESTIMADOR[e.pestana] ?? e.pestana,
    enCotizacion && (e.numero !== null && `${e.numero}`.trim()
      ? b(`quote ${e.numero}${e.guardada ? "" : " (not saved yet)"}`, `cotización ${e.numero}${e.guardada ? "" : " (sin guardar)"}`)
      : b("new quote, not saved yet", "cotización nueva, sin guardar")),
    enCotizacion && b(`${e.lineas} line(s)`, `${e.lineas} línea(s)`),
    enCotizacion && e.desdeLead && b("started from a lead", "abierta desde un lead"),
    e.vistaPrevia && b("Print preview open", "Vista previa de impresión abierta"),
    e.politicaAbierta && b("Policy window open", "Ventana de la política abierta"),
  ];
}

// ---- RR. HH.: expedientes -------------------------------------------------------------------------------------

const ESTADOS_DE_EXPEDIENTE: Record<string, Bilingue> = {
  activos: b("active employees", "empleados activos"),
  bajas: b("former employees", "bajas"),
  todos: b("all employees", "todos los empleados"),
};

export function contextoDeExpedientes(e: {
  estado: string;
  buscando: boolean;
  /** El nombre del empleado cuyo expediente está abierto: es el registro que la persona tiene delante. */
  abierto: string | null;
  dialogo: "agregar" | "baja" | "reactivar" | "amonestar" | "que-falta" | null;
}): ParteDeContexto[] {
  const dialogos: Record<string, Bilingue> = {
    agregar: b("Add employee window open", "Ventana de agregar empleado abierta"),
    baja: b("Termination window open", "Ventana de baja abierta"),
    reactivar: b("Reactivate window open", "Ventana de reactivar abierta"),
    amonestar: b("Disciplinary action window open", "Ventana de acción disciplinaria abierta"),
    "que-falta": b("'What is missing' window open", "Ventana «Qué falta» abierta"),
  };
  const estado = ESTADOS_DE_EXPEDIENTE[e.estado];
  return [
    estado ? b(`showing ${estado.en}`, `viendo ${estado.es}`) : null,
    e.buscando && b("with a search typed", "con una búsqueda escrita"),
    !!e.abierto && b(`Employee file open: ${e.abierto}`, `Expediente abierto: ${e.abierto}`),
    !!e.dialogo && dialogos[e.dialogo],
  ];
}
