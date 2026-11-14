/**
 * Exportar TODOS los campos del expediente (Excel y CSV), no solo las columnas que se ven en la tabla.
 *
 * Lo pide RR. HH. («need to be able to download all field information, not just the columns shown on this table»).
 * La tabla de Empleados exporta las columnas visibles (`tabla-de-empleados.ts`); esta exporta el expediente entero,
 * para las filas que están en pantalla (con su búsqueda, filtro y orden).
 *
 * Es pura y se prueba sin base. La regla que la sostiene: cada campo de la fila (`EmployeeFile` más lo que la lista
 * añade: `docKinds`, `licencia_vence`) tiene que estar **o exportado** en `CAMPOS_TODOS` **o excluido a propósito** en
 * `EXCLUIDOS`, con su razón. Si alguien añade un campo al tipo y no decide, el tipo de la prueba no compila y la
 * prueba de cobertura falla: un campo nuevo no se pierde en silencio.
 */

import type { EmployeeFile } from "@/app/recruiting/actions/hr";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { nombreDeDepartamento } from "@/lib/departamentos";
import {
  ETIQUETAS_CAMPO, camposQueFaltan, costoMensual, estadoEmpleado, etiquetaEstado, etiquetaMotivoBaja, telefonoDeFicha,
} from "./employee-file";
import { REQUIRED_FORMS } from "./hr";
import { puntuacionTotal } from "./puntuacion-total";

/** Lo que cada fila de la lista trae: el expediente más lo que la pantalla le añade. */
export type FilaParaExportar = EmployeeFile & { docKinds: string[]; licencia_vence: string | null };

/** Todas las claves que una fila puede traer. Si `EmployeeFile` gana un campo, esta unión lo gana también. */
export type ClaveDeFila = keyof EmployeeFile | "docKinds" | "licencia_vence";

export interface ContextoDeExportacion {
  /** El idioma de la pantalla: decide cómo se escriben los valores de texto cerrado (Activo/Active, Remoto/Remote). */
  lang: "en" | "es";
  /** ¿Está aplicada la 159? Sin ella «incompleto» no mira puesto, teléfono personal, emergencia ni motivo de baja. */
  con159: boolean;
}

export interface CampoTodos {
  /** Clave de la columna (estable; no se traduce). */
  clave: string;
  /** Qué campo de la fila lee tal cual. Las columnas calculadas no tienen fuente. */
  fuente?: ClaveDeFila;
  /** Encabezado bilingüe: «Inglés / Español». Es el mismo en las dos pantallas de idioma. */
  en: string;
  es: string;
  valor: (f: FilaParaExportar, ctx: ContextoDeExportacion) => ValorDeCelda;
}

// ---- Conversores de valor -------------------------------------------------------------

const texto = (v: string | null | undefined): string | null => (v ?? "").trim() || null;
const numero = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Fecha «AAAA-MM-DD» en el formato que usa el resto de la app (`fmtDate`, como el Excel de Entregas). */
const fecha = (v: string | null | undefined): string | null => (v ? fmtDate(v) : null);
const fechaHora = (v: string | null | undefined): string | null => (v ? fmtDateTime(v) : null);

/** El grupo del directorio, como lo enseña el selector de la ficha («Normal» si no tiene grupo especial). */
const GRUPO_DIRECTORIO: Record<string, { en: string; es: string }> = {
  remote: { en: "Remote", es: "Remoto" },
  sin_tienda: { en: "No store", es: "Sin tienda" },
};
const GRUPO_NORMAL = { en: "Normal", es: "Normal" };

// ---- Las columnas, en el orden de las secciones de la ficha --------------------------------

/** Columna que copia un campo de la fila tal cual (con su conversión). */
function directa(
  clave: string, fuente: ClaveDeFila, en: string, es: string,
  convierte: (v: unknown, ctx: ContextoDeExportacion) => ValorDeCelda = (v) => texto(v as string | null),
): CampoTodos {
  return { clave, fuente, en, es, valor: (f, ctx) => convierte(f[fuente as keyof FilaParaExportar], ctx) };
}

/** Columna calculada: no copia un campo, lo deriva de la fila. */
function calculada(clave: string, en: string, es: string, valor: CampoTodos["valor"]): CampoTodos {
  return { clave, en, es, valor };
}

const num = (v: unknown) => numero(v as number | null);
const fch = (v: unknown) => fecha(v as string | null);

export const CAMPOS_TODOS: readonly CampoTodos[] = [
  // ---- DATOS (la sección de la ficha) --------------------------------------------------
  directa("full_name", "full_name", "Full name", "Nombre completo"),
  directa("job_title", "job_title", "Position", "Puesto"),
  directa("employee_code", "employee_code", "ID", "ID"),
  directa("date_hired", "date_hired", "Date hired", "Fecha de ingreso", fch),
  directa("birthday", "birthday", "Birthday", "Cumpleaños", fch),
  directa("store", "store", "Store (file)", "Tienda (expediente)"),
  directa("account_store", "account_store", "Store (hub account)", "Tienda (cuenta del hub)"),
  directa("directory_group", "directory_group", "Directory", "Directorio",
    (v, ctx) => (GRUPO_DIRECTORIO[(v as string | null) ?? ""] ?? GRUPO_NORMAL)[ctx.lang]),
  directa("department", "department", "Department", "Departamento",
    (v, ctx) => nombreDeDepartamento(v as string | null, ctx.lang) || null),
  directa("address", "address", "Address", "Dirección"),
  directa("notes", "notes", "Notes", "Notas"),
  directa("days_off", "days_off", "Days off", "Días libres", num),

  // ---- CONTACTO ---------------------------------------------------------------------
  directa("phone", "phone", "Office phone (phone book)", "Teléfono de oficina (directorio)", (v) => telefonoDeFicha(v as string | null)),
  directa("ringcentral_ext", "ringcentral_ext", "Extension (phone book)", "Extensión (directorio)"),
  directa("email", "email", "Work email (phone book)", "Correo de trabajo (directorio)"),
  directa("personal_phone", "personal_phone", "Personal phone (HR only)", "Teléfono personal (solo RR. HH.)", (v) => telefonoDeFicha(v as string | null)),
  directa("personal_email", "personal_email", "Personal email (HR only)", "Correo personal (solo RR. HH.)"),

  // ---- CONTACTO DE EMERGENCIA -------------------------------------------------------
  directa("emergency_name", "emergency_name", "Emergency contact name", "Contacto de emergencia: nombre"),
  directa("emergency_relation", "emergency_relation", "Emergency contact relationship", "Contacto de emergencia: parentesco"),
  directa("emergency_phone", "emergency_phone", "Emergency contact phone", "Contacto de emergencia: teléfono", (v) => telefonoDeFicha(v as string | null)),

  // ---- HERRAMIENTAS Y COSTO ---------------------------------------------------------
  directa("email_plan", "email_plan", "Email plan (Microsoft 365)", "Plan del correo (Microsoft 365)"),
  directa("email_cost_year", "email_cost_year", "Email cost / year (USD)", "Costo del correo al año (USD)", num),
  directa("email_renewal_date", "email_renewal_date", "Email renewal date", "Renovación del correo", fch),
  directa("second_email", "second_email", "Second work email", "Segundo correo de trabajo"),
  directa("onepassword", "onepassword", "1Password", "1Password"),
  directa("previous_phone", "previous_phone", "Previous office number", "Número de oficina anterior", (v) => telefonoDeFicha(v as string | null)),
  directa("device_serial", "device_serial", "Desk phone serial", "Serie del teléfono de escritorio"),
  directa("qb_initials", "qb_initials", "QuickBooks initials", "Iniciales en QuickBooks"),
  directa("remote_pc_name", "remote_pc_name", "Remote PC name", "PC de Remote PC"),
  directa("remote_pc_status", "remote_pc_status", "Remote PC status", "Estado del PC de Remote PC"),
  directa("rc_user_created", "rc_user_created", "RingCentral user created", "Usuario de RingCentral creado"),
  directa("rc_device_assigned", "rc_device_assigned", "RingCentral device assigned", "Aparato de RingCentral asignado"),
  directa("app_username", "app_username", "App username", "Usuario de la app"),
  directa("tools_cost_year", "tools_cost_year", "Other tools / year (USD)", "Otras herramientas al año (USD)", num),
  directa("tools_note", "tools_note", "Tools note", "Nota de herramientas"),
  calculada("costo_mensual", "Tools cost / month (USD)", "Costo de herramientas al mes (USD)",
    (f) => costoMensual(f)),

  // ---- PUNTUACIÓN DE RR. HH. --------------------------------------------------------
  directa("risk_score", "risk_score", "Risk", "Riesgo", num),
  directa("performance_score", "performance_score", "Performance", "Desempeño", num),
  directa("person_score", "person_score", "Person", "Persona", num),
  calculada("tot_score", "Tot Score", "Puntuación total",
    (f) => puntuacionTotal({ risk: f.risk_score, performance: f.performance_score, person: f.person_score }).total),
  directa("score_status", "score_status", "Score status", "Estado de la puntuación"),
  directa("score_action", "score_action", "Score action", "Acción de la puntuación"),

  // ---- ESTADO Y BAJA ----------------------------------------------------------------
  calculada("estado", "Status", "Estado", (f, ctx) => etiquetaEstado(estadoEmpleado(f), ctx.lang)),
  directa("date_left", "date_left", "Date left", "Fecha de baja", fch),
  directa("left_reason", "left_reason", "Reason for leaving", "Motivo de baja", (v, ctx) => etiquetaMotivoBaja(v as string | null, ctx.lang) || null),
  directa("left_note", "left_note", "Leaving note", "Nota de la baja"),
  directa("left_by_name", "left_by_name", "Left recorded by", "Baja registrada por"),
  directa("left_recorded_at", "left_recorded_at", "Left recorded at", "Baja registrada el", (v) => fechaHora(v as string | null)),
  calculada("cuenta", "Hub account", "Cuenta del hub",
    (f, ctx) => (f.profile_id ? (ctx.lang === "es" ? "Con usuario" : "User created") : (ctx.lang === "es" ? "Sin usuario" : "No user"))),

  // ---- EXPEDIENTE -------------------------------------------------------------------
  directa("licencia_vence", "licencia_vence", "License expires", "Licencia vence", fch),
  calculada("papeles_pendientes", "Missing paperwork", "Papeles pendientes",
    (f, ctx) => REQUIRED_FORMS
      .filter((d) => !f.docKinds.includes(d.key))
      .map((d) => (ctx.lang === "es" ? d.label_es : d.label))
      .join(", ") || null),
  calculada("campos_por_llenar", "Fields to fill", "Campos por llenar",
    (f, ctx) => camposQueFaltan(f, ctx.con159).map((c) => ETIQUETAS_CAMPO[c][ctx.lang]).join(", ") || null),
  directa("id", "id", "Record ID", "ID del expediente"),
];

/**
 * Lo que NO sale, y por qué. Cada una lleva su razón: la prueba exige que esté escrita.
 * No hay aquí ninguna ruta de archivo, token ni contraseña: el expediente no los guarda (los documentos viven en
 * `employee_docs` y la lista no los carga).
 */
export const EXCLUIDOS: Partial<Record<ClaveDeFila, string>> = {
  profile_id:
    "Id interno de la cuenta de acceso al hub. No es un dato de la persona; su estado ya sale en «Cuenta del hub».",
  left_by:
    "Id interno de quien registró la baja. Sale su nombre, en «Baja registrada por».",
  docKinds:
    "Lista cruda de códigos de papeles. Sale como «Papeles pendientes», en texto que se lee.",
};

/** Las columnas del Excel/CSV de todos los campos. */
export function columnasTodosLosCampos(): readonly CampoTodos[] {
  return CAMPOS_TODOS;
}

/** Encabezados y filas, en el orden de `CAMPOS_TODOS`. Las filas llegan ya filtradas y ordenadas por la pantalla. */
export function tablaTodosLosCampos(
  filas: readonly FilaParaExportar[],
  ctx: ContextoDeExportacion,
): { cabeceras: string[]; filas: ValorDeCelda[][] } {
  return {
    cabeceras: CAMPOS_TODOS.map((c) => `${c.en} / ${c.es}`),
    filas: filas.map((f) => CAMPOS_TODOS.map((c) => c.valor(f, ctx))),
  };
}
