import { describe, expect, it } from "vitest";
import { siguientePasoDeMerma } from "./etapas";

/** Dueño, 11 nov: «abrir la orden y continuar los pasos» — el siguiente paso de una merma para quien la abre. */
const admin = { id: "a", role: "admin", module_access: ["warehouse_ops"] };
const almacen = { id: "w", role: "warehouse", store: "RDZ Pharr", module_access: ["warehouse_ops"] };
const base = { kind: "scrap" as const, store: "RDZ Pharr", created_at: "2026-11-11T10:00:00Z", author_id: "w", stage: null as string | null };

describe("siguiente paso de la merma", () => {
  it("sin foto: el que la reportó agrega la foto; otro sin permiso, «lo sigue el gerente»", () => {
    expect(siguientePasoDeMerma(almacen, { ...base, photos: [] })).toBe("foto");
    expect(siguientePasoDeMerma({ ...almacen, id: "otro" }, { ...base, photos: [] })).toBe("lo-sigue-el-gerente");
  });
  it("fotografiada sin grupo: quien gestiona inicia la aprobación; el almacén no", () => {
    expect(siguientePasoDeMerma(admin, { ...base, photos: ["x.jpg"] })).toBe("iniciar-aprobacion");
    expect(siguientePasoDeMerma(almacen, { ...base, photos: ["x.jpg"] })).toBe("lo-sigue-el-gerente");
  });
  it("en un grupo pendiente: abrir el grupo (para firmar)", () => {
    expect(siguientePasoDeMerma(admin, { ...base, photos: ["x.jpg"], scrap_group_id: "g1" })).toBe("abrir-grupo");
    expect(siguientePasoDeMerma(almacen, { ...base, photos: ["x.jpg"], scrap_group_id: "g1" })).toBe("abrir-grupo");
  });
  it("aprobada → desechar; desechada → ajustar; ajustada → nada", () => {
    expect(siguientePasoDeMerma(admin, { ...base, photos: ["x.jpg"], stage: "approved", approved_at: "2026-11-11" })).toBe("desechar");
    expect(siguientePasoDeMerma(admin, { ...base, photos: ["x.jpg"], stage: "dumped", approved_at: "2026-11-11", dumped_at: "2026-11-11" } as never)).toBe("ajustar");
    expect(siguientePasoDeMerma(admin, { ...base, photos: ["x.jpg"], stage: "adjusted" } as never)).toBeNull();
    expect(siguientePasoDeMerma(almacen, { ...base, photos: ["x.jpg"], stage: "approved", approved_at: "2026-11-11" })).toBe("lo-sigue-el-gerente");
  });
});
