import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PALLETS_DE_UN_VIAJE, palletsAConfirmar } from "./muchos-pallets";

// D-541. El dueño, 2026-10-13: «anything over 10 pallets ask the user are you sure this is this x amount because this
// order will requiere multuple trips».
describe("más de un camión de pallets pide confirmación", () => {
  it("el tope es 10", () => {
    expect(PALLETS_DE_UN_VIAJE).toBe(10);
  });

  it("10 no pregunta; 10.5, 11 y 40 sí, con su número", () => {
    expect(palletsAConfirmar(10)).toBeNull();
    expect(palletsAConfirmar(10.5)).toBe(10.5);
    expect(palletsAConfirmar(11)).toBe(11);
    expect(palletsAConfirmar("40")).toBe(40);
  });

  it("vacío, nulo o no numérico, no pregunta", () => {
    expect(palletsAConfirmar(null)).toBeNull();
    expect(palletsAConfirmar(undefined)).toBeNull();
    expect(palletsAConfirmar("")).toBeNull();
    expect(palletsAConfirmar("abc")).toBeNull();
  });

  it("la ficha lo pregunta al enviar, con el número", () => {
    const ficha = readFileSync("src/components/OrderModal.tsx", "utf8");
    const enviar = ficha.slice(ficha.indexOf("const passesChecks = async"), ficha.indexOf("// Scheduling capacity rules"));
    expect(enviar).toContain("const muchos = palletsAConfirmar(draft.est_pallets);");
    expect(enviar).toContain("if (muchos != null && !(await confirmAction(t(");
  });
});

// D-541. El dueño, 2026-10-13: «remove that message that you location will be recorded».
describe("al entregar ya no se avisa de que se guarda la ubicación", () => {
  it("la ficha no tiene el texto, y el aviso de https sigue", () => {
    const ficha = readFileSync("src/components/OrderModal.tsx", "utf8");
    expect(ficha).not.toContain("Your location will be recorded with this delivery.");
    expect(ficha).toContain("{!geoAvailable() && (");
  });
});

// D-541. El dueño, 2026-10-13: «people should not see this message just admin and logistic manager but from the
// logistic manager view not rutas de hoy» — el aviso «N chofer(es) en turno no están reportando su ubicación».
describe("el aviso de choferes sin señal, solo en el Gestor", () => {
  it("se pinta solo si la pantalla no es de solo lectura («Ruta de hoy» y el mapa del chofer lo son)", () => {
    const gestor = readFileSync("src/app/(app)/routes/page.tsx", "utf8");
    expect(gestor).toContain("{!soloLectura && trackingIssues.length > 0 && !oculto(AVISOS_DEL_GESTOR.choferesSinSenal) && (");
  });
});
