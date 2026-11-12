import { describe, expect, it } from "vitest";
import { eventosDeHistorial, textoDeEntrada } from "./historial";
import { puedeIniciarAprobacion, siguientePasoDeMerma } from "./etapas";
import type { EntradaDeHistorial } from "./datos";

const fila = { created_at: "2026-11-10T10:00:00Z", author_name: "Baudelio", photographed_at: "2026-11-10T10:00:00Z", approved_at: "2026-11-11T09:00:00Z", approved_by: "u1" };
const nombre = (id: string | null | undefined) => (id === "u1" ? "Rosa" : null);

describe("historial de la merma (297)", () => {
  it("sin bitácora: deriva alta y etapas de la fila", () => {
    const ev = eventosDeHistorial(fila, [], nombre, "es");
    expect(ev.map((e) => e.texto)).toEqual(["Reporte creado", "Etapa: Aprobada"]);
    expect(ev[1].quien).toBe("Rosa");
  });
  it("con bitácora de etapas: no repite las derivadas y ordena por fecha", () => {
    const b: EntradaDeHistorial[] = [
      { at: "2026-11-11T08:00:00Z", actor_name: "Rosa", kind: "group", detail: { de: null, a: "g1", nombre: "Nov 11" } },
      { at: "2026-11-11T09:00:00Z", actor_name: "Rosa", kind: "stage", detail: { de: "photographed", a: "approved" } },
      { at: "2026-11-11T08:30:00Z", actor_name: "Bio", kind: "signature", detail: { slot: "supervisor", accion: "firmada", firmante: "Bio" } },
    ];
    expect(eventosDeHistorial(fila, b, nombre, "es").map((e) => e.texto)).toEqual([
      "Reporte creado", "Agregada al grupo «Nov 11»", "Firmó como supervisor (Bio)", "Etapa: Fotografiada → Aprobada",
    ]);
  });
  it("ediciones: campo antes → después", () => {
    expect(textoDeEntrada({ at: "x", actor_name: null, kind: "edited", detail: { boxes: [2, 3], product_name: ["A", "B"] } }, "es"))
      .toBe("Editado — cajas: 2 → 3 · producto: A → B");
  });
});

describe("solo el gerente inicia la aprobación (297)", () => {
  const r = { kind: "scrap" as const, stage: "photographed", created_at: "2026-11-11T00:00:00Z", store: "RDZ Pharr", author_id: "x", scrap_group_id: null, photos: ["a"] };
  const gerente = { id: "g", role: "manager", store: "RDZ Pharr", module_access: ["warehouse_ops"] };
  const supervisor = { id: "s", role: "warehouse", store: "RDZ Pharr", warehouse_ops_role: "full", permissions: ["warehouse_ops_supervisor"], module_access: ["warehouse_ops"] };
  const otraTienda = { id: "o", role: "manager", store: "RDZ McAllen", module_access: ["warehouse_ops"] };
  it("gerente sí; supervisor y gerente de otra tienda no", () => {
    expect(puedeIniciarAprobacion(gerente, r)).toBe(true);
    expect(puedeIniciarAprobacion(supervisor, r)).toBe(false);
    expect(puedeIniciarAprobacion(otraTienda, r)).toBe(false);
    expect(siguientePasoDeMerma(gerente, r)).toBe("iniciar-aprobacion");
    expect(siguientePasoDeMerma(supervisor, r)).toBe("lo-sigue-el-gerente");
  });
});
