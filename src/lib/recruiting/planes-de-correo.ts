/**
 * Los planes de Microsoft 365 del archivo «RTG EMAILS» del dueño (la esquina superior izquierda de la hoja), D-725.
 * El dueño, 2026-10-28: «When I open an employee's profile and hover over their plan, show a tooltip with the plan
 * details: plan name, what it costs, and what it includes. Pull this info directly from the Excel data».
 *
 * Los precios son los que el archivo pone fila por fila a cada correo (la leyenda de arriba tiene las cifras corridas
 * una fila); «Secure Online Essentials» no está en la leyenda y sale con lo que dice su única fila.
 */
export type PlanDeCorreo = {
  nombre: string;
  /** USD al año, por correo. */
  costoAnual: number;
  /** Qué incluye, tal como lo escribió el dueño en la hoja. */
  incluye: string[];
};

export const PLANES_DE_CORREO: readonly PlanDeCorreo[] = [
  { nombre: "Microsoft 365 Secure Business Professional", costoAnual: 259.8, incluye: ["1 TB of storage", "Teams & Microsoft 365 apps"] },
  { nombre: "Microsoft 365 Email Plus with Security", costoAnual: 129.9, incluye: ["50 GB of storage", "250k emails/mo", "Access when shared (can't open OneDrive)"] },
  { nombre: "Microsoft 365 Email Essentials with Security", costoAnual: 116.91, incluye: ["10 GB of storage", "50k emails/mo", "Access when shared (can't open OneDrive)"] },
  { nombre: "Microsoft 365 Secure Online Essentials", costoAnual: 129.9, incluye: [] },
];

const plano = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** El plan que corresponde al texto guardado en el expediente (sin mayúsculas ni espacios de más); null si no es ninguno. */
export function planDeCorreo(texto: string | null | undefined): PlanDeCorreo | null {
  const p = plano(texto ?? "");
  if (!p) return null;
  return PLANES_DE_CORREO.find((x) => plano(x.nombre) === p) ?? null;
}

/** El texto del tooltip: nombre, costo y qué incluye, en el idioma de quien mira. Null si el plan no se conoce. */
export function tooltipDelPlan(texto: string | null | undefined, lang: "en" | "es"): string | null {
  const plan = planDeCorreo(texto);
  if (!plan) return null;
  const costo = `$${plan.costoAnual.toFixed(2)} ${lang === "es" ? "al año" : "per year"}`;
  const incluye = plan.incluye.length ? plan.incluye.join(" · ") : (lang === "es" ? "sin detalle en el archivo" : "no details in the file");
  return `${plan.nombre}\n${costo}\n${lang === "es" ? "Incluye" : "Includes"}: ${incluye}`;
}
