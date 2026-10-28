/**
 * Los activos de la empresa (D-730): correos y números de teléfono que se pagan, con su estado y quién los tiene.
 * Todo puro; la base y la pantalla están en `actions/activos.ts` y `(recruiting)/assets/page.tsx`.
 */
// Sin importar `telefonoDeFicha` de employee-file: el guion de una vez (scripts/carga-activos-de-empresa.mjs) importa ESTE
// fichero con node, que no resuelve importaciones de .ts sin extensión. La forma es la misma de la app (D-432) y la prueba
// de formato la fija contra `telefonoDeFicha`.
function telefonoDeActivo(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  const diez = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (diez.length !== 10 || /[a-z]/i.test(v)) return v;
  return `${diez.slice(0, 3)}-${diez.slice(3, 6)}-${diez.slice(6)}`;
}

export type TipoDeActivo = "email" | "phone";
export type EstadoDeActivo = "assigned" | "available" | "not_in_use" | "pending_backup";
export type TipoDeTelefono = "app" | "physical";

export interface Activo {
  id: string;
  kind: TipoDeActivo;
  value: string;
  ext: string | null;
  phone_type: TipoDeTelefono | null;
  status: EstadoDeActivo;
  employee_id: string | null;
  /** El nombre del expediente que lo tiene, resuelto por quien lee. */
  employee_name?: string | null;
  last_employee_id: string | null;
  last_employee_name?: string | null;
  plan: string | null;
  cost_year: number | null;
  note: string | null;
  updated_at: string | null;
}

export const ESTADOS: readonly { key: EstadoDeActivo; en: string; es: string }[] = [
  { key: "assigned", en: "Assigned", es: "Asignado" },
  { key: "available", en: "Available", es: "Disponible" },
  { key: "not_in_use", en: "Not in use", es: "Sin uso" },
  { key: "pending_backup", en: "Pending backup", es: "Pendiente de respaldo" },
];
export const TIPOS_DE_TELEFONO: readonly { key: TipoDeTelefono; en: string; es: string }[] = [
  { key: "app", en: "RingCentral app only", es: "Solo app de RingCentral" },
  { key: "physical", en: "Physical phone", es: "Teléfono físico" },
];

export function etiquetaDeEstado(e: EstadoDeActivo, lang: "en" | "es"): string {
  const x = ESTADOS.find((s) => s.key === e);
  return x ? (lang === "es" ? x.es : x.en) : e;
}
export function etiquetaDeTipoDeTelefono(p: TipoDeTelefono | null, lang: "en" | "es"): string {
  const x = TIPOS_DE_TELEFONO.find((s) => s.key === p);
  return x ? (lang === "es" ? x.es : x.en) : "—";
}

/** El valor como se guarda: un correo en minúsculas; un número con la forma de la app (956-555-0123). */
export function valorDeActivo(kind: TipoDeActivo, raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  return kind === "email" ? v.toLowerCase() : (telefonoDeActivo(v) ?? v);
}

/** El número con su extensión, para enseñarlo: «956-817-1583 · ext. 111». */
export function textoDeTelefono(a: Pick<Activo, "value" | "ext">): string {
  return a.ext ? `${a.value} · ext. ${a.ext}` : a.value;
}

/** Los que se pueden asignar: disponibles de ese tipo (un «pendiente de respaldo» no, hasta que se respalde). */
export function libres(activos: readonly Activo[], kind: TipoDeActivo): Activo[] {
  return activos.filter((a) => a.kind === kind && a.status === "available");
}

export function losDe(activos: readonly Activo[], employeeId: string): Activo[] {
  return activos.filter((a) => a.employee_id === employeeId && a.status === "assigned");
}

export function cuentaPorEstado(activos: readonly Activo[]): Record<EstadoDeActivo, number> {
  const c: Record<EstadoDeActivo, number> = { assigned: 0, available: 0, not_in_use: 0, pending_backup: 0 };
  for (const a of activos) c[a.status] += 1;
  return c;
}

/** Al asignar: el activo pasa a «asignado» con esa persona. Solo si estaba disponible. */
export function parcheAsignar(a: Pick<Activo, "status">, employeeId: string): { status: "assigned"; employee_id: string } | null {
  if (a.status !== "available") return null;
  return { status: "assigned", employee_id: employeeId };
}

/**
 * Al liberar (o al dar de baja a quien lo tiene): un correo queda «pendiente de respaldo» (hay que respaldarlo antes de
 * dárselo a otro); un número vuelve a «disponible» para el siguiente. Quien lo tenía queda en `last_employee_id`.
 */
export function parcheLiberar(a: Pick<Activo, "kind" | "employee_id">, estado?: EstadoDeActivo): { status: EstadoDeActivo; employee_id: null; last_employee_id: string | null } {
  const status = estado && estado !== "assigned" ? estado : (a.kind === "email" ? "pending_backup" : "available");
  return { status, employee_id: null, last_employee_id: a.employee_id ?? null };
}

/** ¿Quién tiene correo y teléfono, y quién no? Para la vista por persona. */
export function porPersona(activos: readonly Activo[], personas: readonly { id: string; full_name: string }[]): { id: string; full_name: string; email: Activo | null; phone: Activo | null }[] {
  return personas.map((p) => ({
    id: p.id, full_name: p.full_name,
    email: activos.find((a) => a.kind === "email" && a.employee_id === p.id && a.status === "assigned") ?? null,
    phone: activos.find((a) => a.kind === "phone" && a.employee_id === p.id && a.status === "assigned") ?? null,
  }));
}

// ---- El archivo «RTG EMAILS» del dueño: de sus filas al inventario --------------------------
/** Una fila del archivo, ya partida por columnas con nombre (la cabecera «DATE HIRED, EMAIL TYPE, …»). */
export type FilaDelArchivo = Record<string, string>;

const SIN_PERSONA = new Set(["", "pending", "extra", "main"]);
const limpio = (s: string | undefined) => (s ?? "").trim();

/** Lo que dice una fila del archivo de su correo y de su número, listo para el inventario (sin la persona resuelta). */
export function activosDeLaFila(r: FilaDelArchivo): { nombre: string | null; terminado: boolean; respaldar: boolean; email: Omit<Activo, "id" | "employee_id" | "last_employee_id" | "updated_at" | "status" | "employee_name"> | null; phone: Omit<Activo, "id" | "employee_id" | "last_employee_id" | "updated_at" | "status" | "employee_name"> | null } {
  const first = limpio(r["FIRST NAME"]);
  const last = limpio(r["LAST NAME"]);
  const sinPersona = SIN_PERSONA.has(first.toLowerCase());
  const terminado = first.toUpperCase() === "TERMINATED" || limpio(r["QB Initials"]).toUpperCase() === "TERMINATED";
  const respaldar = /DELETE-BACKUP/i.test(last) || /DELETE-BACKUP/i.test(first);
  const nombre = sinPersona || terminado ? null : [first, last].filter(Boolean).join(" ").trim() || null;
  const correo = valorDeActivo("email", r["EMAIL"]);
  const plan = limpio(r["EMAIL TYPE"]);
  const costo = Number(limpio(r[" COST/YR "] ?? r["COST/YR"]).replace(/[$,\s]/g, ""));
  const email = correo && correo.includes("@") ? {
    kind: "email" as const, value: correo, ext: null, phone_type: null,
    plan: plan && !/no email/i.test(plan) ? plan : null, cost_year: Number.isFinite(costo) && costo > 0 ? costo : null, note: null,
  } : null;
  const tel = limpio(r["WORK PHONE"]);
  const numero = /^\(?\d/.test(tel) ? valorDeActivo("phone", tel) : null;
  const serie = limpio(r["SERIAL #"]);
  const phone = numero ? {
    kind: "phone" as const, value: numero, ext: limpio(r["EXT #"]).replace(/\D/g, "") || null,
    phone_type: (/^F0/i.test(serie) || /^[0-9A-F]{12}$/i.test(serie) ? "physical" : "app") as TipoDeTelefono,
    plan: null, cost_year: null, note: serie && !/wireless|n\/a|maybe|personal|pending/i.test(serie) ? `serie ${serie}` : null,
  } : null;
  return { nombre, terminado, respaldar, email, phone };
}

/** El estado con que nace cada activo del archivo. */
export function estadoInicial(kind: TipoDeActivo, fila: { nombre: string | null; terminado: boolean; respaldar: boolean }, conPersona: boolean): EstadoDeActivo {
  if (conPersona) return "assigned";
  if (fila.respaldar) return "pending_backup";
  if (fila.terminado) return kind === "email" ? "pending_backup" : "available";
  return "available";
}
