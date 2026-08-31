import { describe, it, expect } from "vitest";
import { DOC_KINDS, REQUIRED_FORMS, docKind } from "./hr";

/**
 * El catálogo de documentos del expediente (D-145).
 *
 * Se prueba el catálogo y no la pantalla porque el catálogo es lo que decide **quién sale en
 * rojo**: la lista marca "faltan N" contando REQUIRED_FORMS, así que una entrada mal puesta
 * aquí marca en rojo —o deja de marcar— a la plantilla entera sin que nadie lo note.
 */
describe("catálogo del expediente", () => {
  it("no repite claves — dos entradas con la misma clave se pisarían en la ficha", () => {
    const claves = DOC_KINDS.map((d) => d.key);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("todo documento cae en HR o en FORMS, y la pantalla pinta los dos grupos", () => {
    const hr = DOC_KINDS.filter((d) => d.group === "hr");
    const forms = DOC_KINDS.filter((d) => d.group === "forms");
    expect(hr.length + forms.length).toBe(DOC_KINDS.length);
    expect(hr.length).toBeGreaterThan(0);
    expect(forms.length).toBeGreaterThan(0);
  });

  it("la baja NO se exige: solo existe si la persona se fue", () => {
    // Contarla como pendiente pondría "falta 1" a toda la plantilla en activo, que es
    // justo al revés de lo que la pantalla viene a decir.
    expect(REQUIRED_FORMS.some((f) => f.key === "quit_form")).toBe(false);
    expect(DOC_KINDS.some((f) => f.key === "quit_form")).toBe(true);
  });

  it("lo exigido son formularios, nunca documentos de HR", () => {
    // Un currículum o una amonestación no son un papel pendiente de firmar; si se colaran
    // en REQUIRED_FORMS, media empresa saldría incompleta por no tener amonestaciones.
    expect(REQUIRED_FORMS.every((f) => f.group === "forms")).toBe(true);
  });

  it("todo lo que es lista o caduca está declarado, y docKind lo encuentra", () => {
    expect(docKind("warning")?.many).toBe(true);
    expect(docKind("license")?.expires).toBe(true);
    expect(docKind("handbook")?.many).toBeUndefined();
    expect(docKind("no-existe")).toBeUndefined();
  });

  it("cada documento tiene rótulo en los dos idiomas", () => {
    for (const d of DOC_KINDS) {
      expect(d.label.trim()).not.toBe("");
      expect(d.label_es.trim()).not.toBe("");
    }
  });
});
