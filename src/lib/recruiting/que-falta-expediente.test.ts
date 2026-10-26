import { describe, it, expect } from "vitest";
import { camposQueFaltan, cuentaIncompletos } from "./employee-file";

// D-703: la ventana «qué falta» enseña exactamente esta lista; la insignia «incompleto» es lista no vacía.
const lleno = {
  date_hired: "2024-01-02", date_left: null, department: "Sales", store: "Harlingen", directory_group: null,
  account_store: null, job_title: "Rep", personal_phone: "9565550000",
  emergency_name: "Ana", emergency_phone: "9565550001", left_reason: null,
};

describe("camposQueFaltan (qué falta en el expediente)", () => {
  it("completo ⇒ lista vacía y no cuenta como incompleto", () => {
    expect(camposQueFaltan(lleno, true)).toEqual([]);
    expect(cuentaIncompletos([lleno], true)).toBe(0);
  });
  const casos: [string, Partial<typeof lleno>, string][] = [
    ["fecha de ingreso", { date_hired: " " }, "date_hired"],
    ["departamento", { department: null as unknown as string }, "department"],
    ["tienda", { store: null as unknown as string }, "store"],
    ["puesto", { job_title: "" }, "job_title"],
    ["teléfono personal", { personal_phone: "" }, "personal_phone"],
    ["nombre de emergencia", { emergency_name: "" }, "emergency"],
    ["teléfono de emergencia", { emergency_phone: "" }, "emergency"],
    ["motivo de baja", { date_left: "2025-01-01" as unknown as null }, "left_reason"],
  ];
  for (const [nombre, cambio, campo] of casos) {
    it(`falta ${nombre} ⇒ solo «${campo}»`, () => {
      const f = { ...lleno, ...cambio };
      expect(camposQueFaltan(f, true)).toEqual([campo]);
      expect(cuentaIncompletos([f], true)).toBe(1);
    });
  }
  it("con grupo del directorio no pide tienda", () => {
    expect(camposQueFaltan({ ...lleno, store: null as unknown as string, directory_group: "remote" as unknown as null }, true)).toEqual([]);
  });
  it("sin la 159 no pide los campos nuevos", () => {
    expect(camposQueFaltan({ ...lleno, job_title: "", personal_phone: "" }, false)).toEqual([]);
  });
});
