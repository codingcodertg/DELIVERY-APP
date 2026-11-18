import { describe, expect, it } from "vitest";
import { ETAPAS_TODAS_PENDIENTES, ETAPAS_VISIBLES, FILTRO_TODAS_PENDIENTES, enFiltroDeEtapa, etapaVisible, filtraPorEtapa, nombreDeEtapaVisible, pendienteDeAprobar } from "./etapas";

const base = { kind: "scrap", photos: [], approved_at: null, dumped_at: null, adjusted_at: null } as const;

describe("«⏳ Pendiente» = en un grupo y sin aprobar (Roberto, 11 nov)", () => {
  it("solo las que YA tienen grupo y no están aprobadas", () => {
    expect(pendienteDeAprobar({ ...base, stage: "photographed", scrap_group_id: "g1" } as never)).toBe(true);
    expect(pendienteDeAprobar({ ...base, stage: "documented", scrap_group_id: "g1" } as never)).toBe(true);
    // Sin grupo NO es pendiente: sigue siendo documentada o fotografiada.
    expect(pendienteDeAprobar({ ...base, stage: "photographed" } as never)).toBe(false);
    expect(pendienteDeAprobar({ ...base, stage: "documented" } as never)).toBe(false);
    // Aprobada (o después) ya no es pendiente aunque esté en un grupo.
    expect(pendienteDeAprobar({ ...base, stage: "approved", scrap_group_id: "g1" } as never)).toBe(false);
    expect(pendienteDeAprobar({ ...base, stage: "dumped", scrap_group_id: "g1" } as never)).toBe(false);
  });
  it("modo enseñanza: un grupo de práctica cuenta por id (no trae scrap_group_id)", () => {
    expect(pendienteDeAprobar({ ...base, id: "r1", stage: "photographed" } as never, new Set(["r1"]))).toBe(true);
    expect(pendienteDeAprobar({ ...base, id: "r2", stage: "photographed" } as never, new Set(["r1"]))).toBe(false);
  });
  it("la etapa visible va entre fotografiada y aprobada", () => {
    expect(ETAPAS_VISIBLES.indexOf("pending")).toBe(ETAPAS_VISIBLES.indexOf("photographed") + 1);
    expect(ETAPAS_VISIBLES.indexOf("approved")).toBe(ETAPAS_VISIBLES.indexOf("pending") + 1);
    expect(etapaVisible({ ...base, stage: "photographed", scrap_group_id: "g" } as never)).toBe("pending");
    expect(etapaVisible({ ...base, stage: "photographed" } as never)).toBe("photographed");
    expect(nombreDeEtapaVisible("pending", "es")).toBe("Pendiente");
    expect(nombreDeEtapaVisible("pending", "en")).toBe("Pending");
  });
});

describe("filtro «Todas pendientes» (dueño, 2026-11-17): documentada, fotografiada y pendiente", () => {
  const id = (r: unknown) => (r as { id: string }).id;
  const fila = (rid: string, stage: string, extra: Record<string, unknown> = {}) =>
    ({ ...base, id: rid, stage, photos: stage === "documented" ? [] : ["u/1.jpg"], ...extra }) as never;
  const filas = [
    fila("doc", "documented"),
    fila("foto", "photographed"),
    fila("pend", "photographed", { scrap_group_id: "g1" }),
    fila("apro", "approved", { approved_at: "2026-11-10T10:00:00Z", scrap_group_id: "g1" }),
    fila("dese", "dumped", { approved_at: "2026-11-10T10:00:00Z", dumped_at: "2026-11-11T10:00:00Z" }),
    fila("ajus", "adjusted", { approved_at: "2026-11-10T10:00:00Z", dumped_at: "2026-11-11T10:00:00Z", adjusted_at: "2026-11-12T10:00:00Z" }),
  ];

  it("el valor del filtro y sus etapas son exactamente documentada, fotografiada y pendiente", () => {
    expect(FILTRO_TODAS_PENDIENTES).toBe("todas-pendientes");
    expect([...ETAPAS_TODAS_PENDIENTES]).toEqual(["documented", "photographed", "pending"]);
  });

  it("enFiltroDeEtapa: solo esas tres entran; desechada, aprobada y ajustada no", () => {
    for (const e of ["documented", "photographed", "pending"] as const) expect(enFiltroDeEtapa(e, FILTRO_TODAS_PENDIENTES)).toBe(true);
    for (const e of ["approved", "dumped", "adjusted"] as const) expect(enFiltroDeEtapa(e, FILTRO_TODAS_PENDIENTES)).toBe(false);
  });

  it("enFiltroDeEtapa: una etapa concreta entra solo sí misma, también «dumped» (se llega eligiéndola)", () => {
    expect(enFiltroDeEtapa("dumped", "dumped")).toBe(true);
    expect(enFiltroDeEtapa("approved", "dumped")).toBe(false);
    expect(enFiltroDeEtapa("pending", "photographed")).toBe(false);
    expect(enFiltroDeEtapa("photographed", "photographed")).toBe(true);
  });

  it("filtraPorEtapa por defecto deja fuera las desechadas y conserva el orden", () => {
    expect(filtraPorEtapa(filas, FILTRO_TODAS_PENDIENTES).map(id)).toEqual(["doc", "foto", "pend"]);
  });

  it("filtraPorEtapa con una etapa concreta enseña esa etapa, incluida «dumped»", () => {
    expect(filtraPorEtapa(filas, "dumped").map(id)).toEqual(["dese"]);
    expect(filtraPorEtapa(filas, "pending").map(id)).toEqual(["pend"]);
  });

  it("filtraPorEtapa usa el conjunto de práctica para la etapa pendiente", () => {
    const practica = new Set(["foto"]);
    expect(filtraPorEtapa(filas, "pending", practica).map(id)).toEqual(["foto", "pend"]);
    expect(filtraPorEtapa(filas, FILTRO_TODAS_PENDIENTES, practica).map(id)).toEqual(["doc", "foto", "pend"]);
  });

  it("la cuenta de «Todas pendientes» es la suma de sus tres etapas", () => {
    const cuenta = filtraPorEtapa(filas, FILTRO_TODAS_PENDIENTES).length;
    const suma = ETAPAS_TODAS_PENDIENTES.reduce((s, e) => s + filtraPorEtapa(filas, e).length, 0);
    expect(cuenta).toBe(suma);
  });
});
