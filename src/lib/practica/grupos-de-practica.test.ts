import { describe, expect, it } from "vitest";
import type { Reporte } from "@/lib/almacen-ops/datos";
import {
  crearGrupoDePractica, esGrupoDePractica, firmarGrupoDePractica, grupoDePractica, gruposDePractica, quitarFirmaDePractica,
} from "./grupos-de-practica";

const rep = (id: string) => ({ id, store: "RDZ Pharr" }) as unknown as Reporte;
const yo = { id: "u1", nombre: "Ana" };

describe("grupos de merma en modo enseñanza (en memoria, sin base)", () => {
  it("se crea, sale en la lista y se reconoce por el prefijo", () => {
    const id = crearGrupoDePractica("Nov 10 11:30 PM", [rep("a"), rep("b")], "Ana");
    expect(esGrupoDePractica(id)).toBe(true);
    expect(esGrupoDePractica("8f0c-real")).toBe(false);
    const g = grupoDePractica(id)!;
    expect(g.grupo.store).toBe("RDZ Pharr");
    expect(g.grupo.n_reportes).toBe(2);
    expect(gruposDePractica().some((x) => x.id === id)).toBe(true);
  });
  it("con las dos firmas se aprueba solo (como la 283); quitar firma antes de eso funciona", () => {
    const id = crearGrupoDePractica("g", [rep("a")], null);
    firmarGrupoDePractica(id, "gerente", "data:image/png;base64,x", yo);
    quitarFirmaDePractica(id, "gerente");
    expect(grupoDePractica(id)!.grupo.firmas).toHaveLength(0);
    firmarGrupoDePractica(id, "gerente", "data:image/png;base64,x", yo);
    expect(grupoDePractica(id)!.grupo.approved_at).toBeNull();
    firmarGrupoDePractica(id, "supervisor", "data:image/png;base64,x", yo);
    expect(grupoDePractica(id)!.grupo.approved_at).not.toBeNull();
    expect(grupoDePractica(id)!.grupo.approved_by).toBe("u1");
  });
});
