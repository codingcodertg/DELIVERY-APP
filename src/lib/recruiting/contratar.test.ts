import { describe, expect, it } from "vitest";
import { ROLES_DE_INVITE, falta201, fichaDesdeCandidato, precargaDeUsuario, puedeContratar, rolDesdePuesto, usuarioSugerido, veSolicitudesDeUsuario, yaPedido } from "./contratar";

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

describe("D-710: precarga del usuario al contratar", () => {
  it("rol desde el puesto, solo si es obvio", () => {
    expect(rolDesdePuesto("Delivery Driver")).toBe("driver");
    expect(rolDesdePuesto("Chofer")).toBe("driver");
    expect(rolDesdePuesto("Almacén")).toBe("warehouse");
    expect(rolDesdePuesto("Sales Manager")).toBe("manager");
    expect(rolDesdePuesto("Vendedora")).toBe("sales");
    expect(rolDesdePuesto("Contador")).toBe("accounting");
    expect(rolDesdePuesto("Dispatcher")).toBe("logistics");
    expect(rolDesdePuesto("Cajera")).toBeNull();
    expect(rolDesdePuesto(null)).toBeNull();
  });
  it("usuario sugerido: inicial + último apellido, sin acentos", () => {
    expect(usuarioSugerido("Juan  Castañón")).toBe("jcastanon");
    expect(usuarioSugerido("Juan Carlos Pérez López")).toBe("jlopez");
    expect(usuarioSugerido("Cher")).toBe("cher");
    expect(usuarioSugerido("  ")).toBe("");
  });
  it("con correo va el correo; sin él, un usuario", () => {
    expect(precargaDeUsuario({ name: "Juan Castañón", email: " JC@Mail.com ", role: "Driver", location: "Weslaco" }))
      .toEqual({ full_name: "Juan Castañón", email: "jc@mail.com", username: "", store: "Weslaco", role: "driver" });
    expect(precargaDeUsuario({ name: "Juan Castañón", email: "no-es-correo", role: "Cajero", location: " " }))
      .toEqual({ full_name: "Juan Castañón", email: "", username: "jcastanon", store: null, role: null });
  });
  it("el rol propuesto siempre es uno que /api/invite acepta", () => {
    for (const p of ["driver", "warehouse", "manager", "sales", "accounting", "logistics"]) {
      expect(ROLES_DE_INVITE).toContain(rolDesdePuesto(p));
    }
  });
});
