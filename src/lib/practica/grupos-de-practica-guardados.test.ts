import { describe, expect, it } from "vitest";
import type { Reporte } from "@/lib/almacen-ops/datos";
import {
  borrarPractica, cargaPractica, claveDePractica, crearGrupoDePractica, firmarGrupoDePractica, grupoDePractica,
  grupoDePracticaPorReporte, gruposDePractica,
} from "./grupos-de-practica";

const almacen = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const rep = (id: string) => ({ id, store: "RDZ Pharr" }) as unknown as Reporte;

describe("grupos de práctica guardados en el navegador (11 nov)", () => {
  it("aguantan «recargar»: se vuelven a cargar con sus firmas y su aprobación", () => {
    const a = almacen();
    cargaPractica("u-guardados", a);
    const id = crearGrupoDePractica("g", [rep("r1")], "Ana");
    firmarGrupoDePractica(id, "gerente", "data:image/png;base64,x", { id: "u-guardados", nombre: "Ana" });
    firmarGrupoDePractica(id, "supervisor", "data:image/png;base64,x", { id: "u2", nombre: "Beto" });
    expect(a.m.has(claveDePractica("u-guardados"))).toBe(true);
    // otra persona, luego de vuelta: se recarga desde el almacén
    cargaPractica("otra", a);
    expect(gruposDePractica()).toHaveLength(0);
    cargaPractica("u-guardados", a);
    expect(grupoDePractica(id)?.grupo.approved_at).not.toBeNull();
    expect(grupoDePracticaPorReporte().get("r1")).toBe(id);
  });
  it("«Borrar práctica» los quita del navegador", () => {
    const a = almacen();
    cargaPractica("u-borra", a);
    crearGrupoDePractica("g", [rep("r9")], null);
    borrarPractica("u-borra", a);
    expect(gruposDePractica()).toHaveLength(0);
    expect(a.m.has(claveDePractica("u-borra"))).toBe(false);
  });
});
