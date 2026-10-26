import type { ValorDeCelda } from "@/lib/orden-y-filtro";

/**
 * D-706: la tabla de Empleados como la de Órdenes. El dueño: «que uno pueda resize las columnas, buscar, sort, todo
 * eso y exportar todo eso». Las piezas son las de siempre (`useOrdenYFiltro`, `CabeceraConMenu`, `useColWidthMap`,
 * `toCSV`); aquí solo lo propio de esta tabla: qué columnas hay, qué valor da cada una, la búsqueda, y qué se exporta.
 * Lo exportado sale de las filas ya cargadas y ya filtradas: la RLS decidió qué llega, y el filtro, qué se ve.
 */
export type ColumnaDeEmpleado = { key: string; en: string; es: string; ancho: number };

export const COLUMNAS_DE_EMPLEADOS: readonly ColumnaDeEmpleado[] = [
  { key: "full_name", en: "Name", es: "Nombre", ancho: 220 },
  { key: "job_title", en: "Position", es: "Puesto", ancho: 150 },
  { key: "department", en: "Department", es: "Departamento", ancho: 140 },
  { key: "store", en: "Store", es: "Tienda", ancho: 130 },
  { key: "phone", en: "Office phone", es: "Tel. de oficina", ancho: 130 },
  { key: "ringcentral_ext", en: "Ext.", es: "Ext.", ancho: 70 },
  { key: "date_hired", en: "Hired", es: "Ingreso", ancho: 110 },
  { key: "date_left", en: "Left", es: "Baja", ancho: 110 },
  { key: "cuenta", en: "Hub user", es: "Usuario", ancho: 120 },
  { key: "expediente", en: "File", es: "Expediente", ancho: 130 },
  { key: "papeles", en: "Paperwork", es: "Papeles", ancho: 120 },
];

/** Lo que la fila sabe de sí misma; lo calculado (campos sin llenar, papeles que faltan) lo pasa quien llama. */
export type FilaDeEmpleado = {
  full_name: string; job_title?: string | null; department?: string | null; store?: string | null;
  phone?: string | null; ringcentral_ext?: string | null; date_hired?: string | null; date_left?: string | null;
  email?: string | null; personal_email?: string | null; profile_id?: string | null;
};
export type Calculado = { sinLlenar: number; papelesQueFaltan: number };

type T = (en: string, es: string) => string;

/** El valor de la columna `clave`: lo mismo ordena, filtra (menú ▾) y se exporta. Vacío → null («—» en el menú). */
export function valorDeEmpleado(clave: string, f: FilaDeEmpleado, c: Calculado, t: T): ValorDeCelda {
  const texto = (v: string | null | undefined) => (v ?? "").trim() || null;
  switch (clave) {
    case "full_name": return texto(f.full_name);
    case "job_title": return texto(f.job_title);
    case "department": return texto(f.department);
    case "store": return texto(f.store);
    case "phone": return texto(f.phone);
    case "ringcentral_ext": return texto(f.ringcentral_ext);
    case "date_hired": return texto(f.date_hired);
    case "date_left": return texto(f.date_left);
    case "cuenta": return f.profile_id ? t("User created", "Con usuario") : t("No user", "Sin usuario");
    case "expediente": return c.sinLlenar === 0 ? t("complete", "completo") : t("incomplete", "incompleto");
    case "papeles": return c.papelesQueFaltan;
    default: return null;
  }
}

/** La caja de buscar mira nombre, puesto, departamento, tienda, teléfono, extensión y correos; sin acentos ni mayúsculas. */
export function coincideBusqueda(f: FilaDeEmpleado, texto: string): boolean {
  const q = normaliza(texto);
  if (!q) return true;
  const campos = [f.full_name, f.job_title, f.department, f.store, f.phone, f.ringcentral_ext, f.email, f.personal_email];
  return campos.some((v) => normaliza(v ?? "").includes(q));
}

function normaliza(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Cabeceras y filas para CSV / Excel, en el orden y con las columnas que se ven. */
export function tablaParaExportar<F>(
  columnas: readonly ColumnaDeEmpleado[], filas: readonly F[], valor: (clave: string, fila: F) => ValorDeCelda, lang: "en" | "es",
): { cabeceras: string[]; filas: ValorDeCelda[][] } {
  return {
    cabeceras: columnas.map((c) => (lang === "es" ? c.es : c.en)),
    filas: filas.map((f) => columnas.map((c) => valor(c.key, f))),
  };
}
