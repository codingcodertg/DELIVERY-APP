/**
 * El nombre de un departamento en el idioma de quien mira (D-725).
 *
 * Los departamentos son datos de Ajustes de RR. HH. y están escritos en español («Oficina», «Almacén», «Ventas»,
 * «Choferes»); el dueño, 2026-10-28: «Department section headers in the People/Employees view are still showing in
 * Spanish even when the language setting is English». El valor guardado no cambia (es la clave con la que se filtra
 * y se agrupa); cambia solo cómo se pinta. Un departamento que no esté aquí sale tal cual.
 */
const EN_INGLES: Record<string, string> = {
  oficina: "Office",
  almacen: "Warehouse",
  ventas: "Sales",
  choferes: "Drivers",
  chofer: "Driver",
  contabilidad: "Accounting",
  logistica: "Logistics",
  gerencia: "Management",
  "ai developer": "AI Developer",
};

const plano = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function nombreDeDepartamento(departamento: string | null | undefined, lang: "en" | "es"): string {
  const d = (departamento ?? "").trim();
  if (!d) return "";
  if (lang === "es") return d;
  return EN_INGLES[plano(d)] ?? d;
}
