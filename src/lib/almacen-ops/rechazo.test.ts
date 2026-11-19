import { describe, expect, it } from "vitest";
import { perdidaPorEtapa, etapaDe, etapaVisible, etapaDerivada, nombreDeEtapa, fechaDeEtapa, siguienteEtapa, puedeDeshacerEtapa, etapaAlDeshacer, ETAPAS_VISIBLES, ETAPAS_TODAS_PENDIENTES, filtraPorEtapa, FILTRO_TODAS_PENDIENTES, type FilaConEtapa } from "./etapas";
import { EJEMPLO_MOTIVO_RECHAZO, ETAPAS_RECHAZABLES, motivoDeRechazoValido, motivoNoRechazable, puedeDeshacerRechazo, puedeRechazar, sinRechazadas, tieneColumnasDeRechazo } from "./rechazo";
import type { Quien } from "./visibilidad";

/**
 * 327 (merma rechazada, «still sellable — not scrap»). Reglas: quién puede rechazar (la misma puerta que aprobar: quien
 * gestiona la tienda), desde qué etapa, motivo de 3 a 500, la etapa derivada (rechazada manda) y que las rechazadas no
 * cuentan en dinero ni en «Todas pendientes».
 */
type Fila = FilaConEtapa & { kind: "scrap"; store: string; total_loss: number | null; id: string; scrap_group_id?: string | null };

const gerente: Quien = { id: "g1", role: "manager", store: "McAllen", visible_stores: [], permissions: [], module_access: ["warehouse_ops"] };
const supervisor: Quien = { id: "s1", role: "warehouse", store: "McAllen", permissions: ["warehouse_ops_supervisor"], module_access: ["warehouse_ops"] };
const almacenista: Quien = { id: "a1", role: "warehouse", store: "McAllen", permissions: [], module_access: ["warehouse_ops"] };
const gerenteDeOtra: Quien = { id: "g2", role: "manager", store: "Edinburg", module_access: ["warehouse_ops"] };

const base: Fila = {
  id: "11111111-2222-3333-4444-555555555555", kind: "scrap", store: "McAllen", created_at: "2026-11-10T12:00:00Z",
  photos: [], stage: "documented", total_loss: 100, rejected_at: null, rejected_by: null, rejected_reason: null,
};
const fotografiada: Fila = { ...base, photos: ["u/1.jpg"], photographed_at: "2026-11-10T13:00:00Z", stage: "photographed" };
const aprobada: Fila = { ...fotografiada, stage: "approved", approved_at: "2026-11-11T10:00:00Z", approved_by: "g1" };
const desechada: Fila = { ...aprobada, stage: "dumped", dumped_at: "2026-11-12T10:00:00Z", dumped_by: "g1" };
const rechazada: Fila = { ...fotografiada, stage: "rejected", rejected_at: "2026-11-13T09:00:00Z", rejected_by: "g1", rejected_reason: EJEMPLO_MOTIVO_RECHAZO };

describe("motivo del rechazo", () => {
  it("son obligatorios entre 3 y 500 caracteres, sin contar espacios de los extremos", () => {
    expect(motivoDeRechazoValido(undefined)).toBe(false);
    expect(motivoDeRechazoValido("")).toBe(false);
    expect(motivoDeRechazoValido("  ab  ")).toBe(false);
    expect(motivoDeRechazoValido("abc")).toBe(true);
    expect(motivoDeRechazoValido("  Aún se puede vender  ")).toBe(true);
    expect(motivoDeRechazoValido("x".repeat(500))).toBe(true);
    expect(motivoDeRechazoValido("x".repeat(501))).toBe(false);
  });
  it("el ejemplo de la guía dice lo que pidió el dueño", () => {
    expect(EJEMPLO_MOTIVO_RECHAZO).toContain("Still sellable");
    expect(EJEMPLO_MOTIVO_RECHAZO).toContain("no es merma");
  });
});

describe("quién puede rechazar y deshacer", () => {
  it("lo puede quien gestiona la tienda: gerente de esa tienda, sí; otra tienda, no; supervisor y almacenista, no", () => {
    expect(puedeRechazar(gerente, fotografiada)).toBe(true);
    expect(puedeRechazar(gerenteDeOtra, fotografiada)).toBe(false);
    expect(puedeRechazar(supervisor, fotografiada)).toBe(false);
    expect(puedeRechazar(almacenista, fotografiada)).toBe(false);
  });
  it("desde documentada, fotografiada y aprobada; nunca desechada, ajustada ni ya rechazada", () => {
    expect(ETAPAS_RECHAZABLES).toEqual(["documented", "photographed", "approved"]);
    expect(puedeRechazar(gerente, base)).toBe(true);
    expect(puedeRechazar(gerente, aprobada)).toBe(true);
    expect(puedeRechazar(gerente, desechada)).toBe(false);
    expect(puedeRechazar(gerente, { ...desechada, stage: "adjusted", adjusted_at: "2026-11-14T10:00:00Z" })).toBe(false);
    expect(puedeRechazar(gerente, rechazada)).toBe(false);
  });
  it("sin las columnas de la 327 no se ofrece nada (la pantalla sigue cargando)", () => {
    const sinColumnas = { kind: "scrap" as const, store: "McAllen", id: base.id, created_at: base.created_at, photos: [], stage: "documented" };
    expect(tieneColumnasDeRechazo(sinColumnas)).toBe(false);
    expect(puedeRechazar(gerente, sinColumnas)).toBe(false);
    expect(puedeDeshacerRechazo(gerente, sinColumnas)).toBe(false);
  });
  it("deshacer: solo quien puede rechazar, y solo si está rechazada", () => {
    expect(puedeDeshacerRechazo(gerente, rechazada)).toBe(true);
    expect(puedeDeshacerRechazo(supervisor, rechazada)).toBe(false);
    expect(puedeDeshacerRechazo(gerente, fotografiada)).toBe(false);
  });
  it("el motivo que no deja rechazar queda explicado", () => {
    expect(motivoNoRechazable(gerente, fotografiada)).toBeNull();
    expect(motivoNoRechazable(supervisor, fotografiada)).toBe("sin-permiso");
    expect(motivoNoRechazable(gerente, rechazada)).toBe("ya-rechazada");
    expect(motivoNoRechazable(gerente, desechada)).toBe("etapa-posterior");
    expect(motivoNoRechazable(gerente, { ...base, kind: "safety" as never })).toBe("no-es-merma");
  });
});

describe("etapa derivada", () => {
  it("el rechazo manda sobre todas las demás etapas", () => {
    expect(etapaDerivada(rechazada)).toBe("rejected");
    expect(etapaDe(rechazada)).toBe("rejected");
    expect(etapaDe({ ...aprobada, rejected_at: "2026-11-13T09:00:00Z" })).toBe("rejected");
  });
  it("sin rechazo, la etapa sigue saliendo de las fechas (como antes)", () => {
    expect(etapaDe(fotografiada)).toBe("photographed");
    expect(etapaDe(aprobada)).toBe("approved");
    expect(etapaDe(desechada)).toBe("dumped");
  });
  it("deshacer el rechazo deja la etapa de antes sin guardar nada: las fechas siguen ahí", () => {
    // La base recalcula «stage» al quitar el rechazo: aquí se refleja lo que escribe el trigger.
    const deshecha = { ...rechazada, rejected_at: null, rejected_by: null, rejected_reason: null, stage: "photographed" };
    expect(etapaDe(deshecha)).toBe("photographed");
    const deshechaAprobada = { ...aprobada, stage: "rejected", rejected_at: "2026-11-13T09:00:00Z", rejected_by: "g1", rejected_reason: "x-x" };
    expect(etapaDe({ ...deshechaAprobada, rejected_at: null, stage: "approved" })).toBe("approved");
  });
  it("la etapa rechazada tiene nombre bilingüe y su fecha es la del rechazo", () => {
    expect(nombreDeEtapa("rejected", "en")).toBe("Rejected");
    expect(nombreDeEtapa("rejected", "es")).toBe("Rechazada");
    expect(fechaDeEtapa(rechazada, "rejected")).toBe("2026-11-13T09:00:00Z");
  });
  it("no tiene siguiente paso ni se deshace como las demás etapas", () => {
    expect(siguienteEtapa(rechazada)).toBeNull();
    expect(puedeDeshacerEtapa(gerente, rechazada)).toBe(false);
    expect(etapaAlDeshacer(rechazada)).toBeNull();
  });
  it("aparece como filtro DESPUÉS de Adjusted, y no entra en «Todas pendientes»", () => {
    expect(ETAPAS_VISIBLES[ETAPAS_VISIBLES.length - 1]).toBe("rejected");
    expect(ETAPAS_VISIBLES.indexOf("rejected")).toBe(ETAPAS_VISIBLES.indexOf("adjusted") + 1);
    expect(ETAPAS_TODAS_PENDIENTES).not.toContain("rejected");
    expect(etapaVisible(rechazada)).toBe("rejected");
    const filas = [base, fotografiada, aprobada, desechada, rechazada];
    expect(filtraPorEtapa(filas, FILTRO_TODAS_PENDIENTES).map((r) => r.stage)).toEqual(["documented", "photographed"]);
    expect(filtraPorEtapa(filas, "rejected")).toEqual([rechazada]);
  });
});

describe("totales sin las rechazadas", () => {
  it("la pérdida por etapa no cuenta la merma rechazada", () => {
    const filas = [{ ...base, store: "McAllen", total_loss: 100 }, { ...aprobada, total_loss: 50 }, { ...rechazada, total_loss: 300 }];
    const out = perdidaPorEtapa(filas);
    expect(out["*"]).toEqual({ pendiente: 100, aprobada: 50, desechada: 0 });
    expect(out.McAllen).toEqual({ pendiente: 100, aprobada: 50, desechada: 0 });
  });
  it("sinRechazadas quita solo las rechazadas", () => {
    expect(sinRechazadas([base, rechazada, aprobada]).map((r) => r.stage)).toEqual(["documented", "approved"]);
  });
  it("etapaVisible de una rechazada en grupo sigue siendo rechazada (no «pendiente»)", () => {
    expect(etapaVisible({ ...rechazada, scrap_group_id: "g-1" })).toBe("rejected");
  });
});

describe("el trigger y la app dicen lo mismo", () => {
  it("la guardia SQL pone «rejected» primero y la limpieza de campos de rechazo va en lo que no es merma", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/327_merma_rechazo.sql"), "utf8");
    const guardia = sql.slice(sql.indexOf("create or replace function public.warehouse_report_stage_guard"));
    expect(guardia.indexOf("when NEW.rejected_at is not null then 'rejected'")).toBeGreaterThan(0);
    expect(guardia.indexOf("when NEW.rejected_at is not null then 'rejected'")).toBeLessThan(guardia.indexOf("when NEW.adjusted_at is not null then 'adjusted'"));
    expect(sql.trimEnd().endsWith("-- @ledger-below")).toBe(true);
  });
});

describe("migración 327: cuerpos bien citados", () => {
  it("cada función tiene su par de $$ (cinco funciones: guardia, etapa, rechazar, deshacer y KPI)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/327_merma_rechazo.sql"), "utf8");
    expect(sql.split("$$").length - 1).toBe(10);
    expect(sql.match(/create or replace function public\.\w+/g)?.length).toBe(5);
  });
});
