import { describe, expect, it } from "vitest";
import type { Reporte } from "@/lib/almacen-ops/datos";
import {
  aprobarGrupoDePractica, borrarGrupoDePractica, crearGrupoDePractica, firmarGrupoDePractica, grupoDePractica, sacarDeGrupoDePractica,
} from "./grupos-de-practica";

const rep = (id: string) => ({ id, store: "RDZ Pharr" }) as unknown as Reporte;
const yo = { id: "u1", nombre: "Ana" };

describe("296 · deshacer en práctica", () => {
  it("sacar una merma de un grupo pendiente borra las firmas; la última borra el grupo", () => {
    const id = crearGrupoDePractica("g", [rep("a"), rep("b")], "Ana");
    firmarGrupoDePractica(id, "gerente", "data:image/png;base64,x", yo);
    sacarDeGrupoDePractica(id, "a");
    expect(grupoDePractica(id)!.reportes.map((r) => r.id)).toEqual(["b"]);
    expect(grupoDePractica(id)!.grupo.firmas).toHaveLength(0);
    expect(grupoDePractica(id)!.grupo.n_reportes).toBe(1);
    sacarDeGrupoDePractica(id, "b");
    expect(grupoDePractica(id)).toBeNull();
  });
  it("borrar un grupo pendiente; uno aprobado no se toca", () => {
    const p = crearGrupoDePractica("p", [rep("a")], null);
    borrarGrupoDePractica(p);
    expect(grupoDePractica(p)).toBeNull();
    const ok = crearGrupoDePractica("ok", [rep("a"), rep("b")], null);
    aprobarGrupoDePractica(ok, "u1");
    borrarGrupoDePractica(ok);
    sacarDeGrupoDePractica(ok, "a");
    expect(grupoDePractica(ok)!.reportes).toHaveLength(2);
  });
});
