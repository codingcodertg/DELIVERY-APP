import { describe, expect, it } from "vitest";
import { COLUMNAS_DE_EMPLEADOS, type FilaDeEmpleado, coincideBusqueda, tablaParaExportar, valorDeEmpleado } from "@/lib/recruiting/tabla-de-empleados";

const t = (en: string, es: string) => es;
const ana = { full_name: "Ana Núñez", job_title: "Cajera", department: "Ventas", store: "RDZ Edinburg", phone: "956-555-0101",
  ringcentral_ext: "204", date_hired: "2025-01-02", date_left: null, email: "ana@x.com", personal_email: null, profile_id: "p1" };
const beto = { full_name: "Beto Ruiz", job_title: " ", department: null, store: null, phone: null, ringcentral_ext: null,
  date_hired: null, date_left: "2026-10-01", email: null, personal_email: "beto@gmail.com", profile_id: null };

describe("D-706: tabla de Empleados", () => {
  it("cada columna da su valor; vacío o en blanco es null", () => {
    const c = { sinLlenar: 0, papelesQueFaltan: 2 };
    expect(COLUMNAS_DE_EMPLEADOS.map((k) => valorDeEmpleado(k.key, ana, c, t))).toEqual(
      ["Ana Núñez", "Cajera", "Ventas", "RDZ Edinburg", "956-555-0101", "204", "2025-01-02", null, "Con usuario", "completo", 2]);
    expect(valorDeEmpleado("job_title", beto, c, t)).toBeNull();
    expect(valorDeEmpleado("cuenta", beto, c, t)).toBe("Sin usuario");
    expect(valorDeEmpleado("expediente", beto, { sinLlenar: 3, papelesQueFaltan: 0 }, t)).toBe("incompleto");
    expect(valorDeEmpleado("date_left", beto, c, t)).toBe("2026-10-01");
    expect(valorDeEmpleado("no-existe", ana, c, t)).toBeNull();
  });

  it("buscar mira varios campos, sin acentos ni mayúsculas", () => {
    expect(coincideBusqueda(ana, "")).toBe(true);
    expect(coincideBusqueda(ana, "nunez")).toBe(true);
    expect(coincideBusqueda(ana, "CAJERA")).toBe(true);
    expect(coincideBusqueda(ana, "edinburg")).toBe(true);
    expect(coincideBusqueda(ana, "0101")).toBe(true);
    expect(coincideBusqueda(ana, "204")).toBe(true);
    expect(coincideBusqueda(beto, "gmail")).toBe(true);
    expect(coincideBusqueda(ana, "beto")).toBe(false);
  });

  it("exportar: cabeceras en el idioma y las filas que se le pasan, en ese orden", () => {
    const cols = COLUMNAS_DE_EMPLEADOS.slice(0, 2);
    const v = (k: string, f: FilaDeEmpleado) => valorDeEmpleado(k, f, { sinLlenar: 0, papelesQueFaltan: 0 }, t);
    expect(tablaParaExportar(cols, [beto, ana], v, "es")).toEqual({ cabeceras: ["Nombre", "Puesto"], filas: [["Beto Ruiz", null], ["Ana Núñez", "Cajera"]] });
    expect(tablaParaExportar(cols, [], v, "en").cabeceras).toEqual(["Name", "Position"]);
  });
});
