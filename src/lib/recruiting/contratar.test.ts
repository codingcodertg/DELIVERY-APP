import { describe, expect, it } from "vitest";
import { falta201, fichaDesdeCandidato, puedeContratar, veSolicitudesDeUsuario, yaPedido } from "./contratar";

describe("contratar", () => {
  it("solo gerente y admin contratan; solo el admin ve la lista", () => {
    expect(puedeContratar("admin")).toBe(true);
    expect(puedeContratar("manager")).toBe(true);
    expect(puedeContratar("recruiter")).toBe(false);
    expect(puedeContratar("store_manager")).toBe(false);
    expect(puedeContratar(null)).toBe(false);
    expect(veSolicitudesDeUsuario("admin")).toBe(true);
    expect(veSolicitudesDeUsuario("manager")).toBe(false);
  });

  it("la ficha sale del candidato", () => {
    expect(fichaDesdeCandidato({ name: "  Ana   Pérez ", phone: " 956 ", role: "", location: "Tienda X" }, "2026-10-26"))
      .toEqual({ full_name: "Ana Pérez", date_hired: "2026-10-26", phone: "956", job_title: null, store: "Tienda X" });
    expect(fichaDesdeCandidato({ name: "   " }, "2026-10-26")).toBeNull();
  });

  it("reconoce la 201 sin aplicar y el doble clic", () => {
    expect(falta201({ code: "PGRST205" })).toBe(true);
    expect(falta201({ code: "42703" })).toBe(true);
    expect(falta201({ message: 'relation "recruiting.user_creation_requests" does not exist' })).toBe(true);
    expect(falta201({ code: "23505", message: "duplicate" })).toBe(false);
    expect(falta201(null)).toBe(false);
    expect(yaPedido({ code: "23505" })).toBe(true);
    expect(yaPedido({ code: "42501" })).toBe(false);
  });
});
