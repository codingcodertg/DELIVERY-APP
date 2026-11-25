import { describe, expect, it } from "vitest";
import { almacenDemo, leadsDemo, PERSONAS_DEMO } from "./demo";
import { cuentaPorEtapa, ETAPAS, etapaDe, tableroPorVendedor, TIPOS_DE_ACCION } from "./reglas";

/** El demo (modo enseñanza) con las etapas: que enseñe todas, que las veces vistas sean reales, y que anotar se porte como la base. */
describe("el demo con etapas", () => {
  const leads = leadsDemo(new Date("2026-11-18T12:00:00Z"));
  const ana = PERSONAS_DEMO.find((p) => p.id === "demo-ana")!;
  const beto = PERSONAS_DEMO.find((p) => p.id === "demo-beto")!;
  const admin = PERSONAS_DEMO.find((p) => p.id === "demo-admin")!;

  it("enseña todas las etapas, y también un lead sin ninguna (New)", () => {
    const usadas = new Set(leads.map((l) => etapaDe(l)));
    for (const e of ETAPAS) expect([e, usadas.has(e)]).toEqual([e, true]);
  });
  it("tiene leads vistos en varias cargas, y uno archivado que no sale en el banco", () => {
    expect(leads.some((l) => (l.times_seen ?? 1) > 1)).toBe(true);
    expect(leads.filter((l) => l.status === "archived")).toHaveLength(1);
  });
  it("la venta es de Beto y deja el lead como won; ningún otro lead tiene dueño", () => {
    const ventas = leads.filter((l) => l.status === "won");
    expect(ventas).toHaveLength(1);
    expect(ventas[0]).toMatchObject({ holder: beto.id, follow_up_action: "closed" });
    expect(leads.filter((l) => l.status === "free" && l.holder !== null)).toEqual([]);
  });
  it("cuenta por etapa del demo cubre todas las que se eligen", () => {
    const n = cuentaPorEtapa(leads);
    expect(TIPOS_DE_ACCION.every((e) => n[e] >= 1)).toBe(true);
  });

  it("anotar con etapa cambia la etapa, deja a quien anota de último contacto y aparece en el historial", async () => {
    let yo = ana;
    const a = almacenDemo(() => yo);
    const libre = leads.find((l) => l.pool === "RDZ Brownsville" && l.follow_up_action === null && l.status === "free")!;
    const r = await a.anotar(libre.id, "", "quote");
    expect(r).toMatchObject({ ok: true, valor: { follow_up_action: "quote", last_by: ana.id, status: "free", holder: null } });
    const h = await a.historial(libre.id);
    expect(h.ok && h.valor.at(-1)).toMatchObject({ kind: "progress", action: "quote", actor: ana.id });
  });
  it("cerrar (closed) da una venta a quien anota; después, lost la devuelve libre sin dueño", async () => {
    let yo = beto;
    const a = almacenDemo(() => yo);
    const libre = leads.find((l) => l.pool === "RDZ Edinburg" && l.status === "free" && l.follow_up_action === null)!;
    expect(await a.anotar(libre.id, "", "closed")).toMatchObject({ ok: true, valor: { status: "won", holder: beto.id } });
    expect(await a.anotar(libre.id, "", "lost")).toMatchObject({ ok: true, valor: { status: "free", holder: null, follow_up_action: "lost" } });
  });
  it("sin etapa, la nota es obligatoria; con una vacía no se guarda", async () => {
    const a = almacenDemo(() => ana);
    const l = leads.find((x) => x.pool === "RDZ Brownsville" && x.status === "free")!;
    expect(await a.anotar(l.id, "  ", null)).toMatchObject({ ok: false, motivo: "falta_nota" });
    expect((await a.anotar(l.id, "Dejé mensaje", null)).ok).toBe(true);
  });
  it("el tablero del admin cuenta notas y ventas por persona desde el historial del demo", async () => {
    const a = almacenDemo(() => admin);
    const r = await a.eventos();
    if (!r.ok) throw new Error("no lee");
    const filas = tableroPorVendedor(r.valor);
    expect(filas.some((f) => f.id === beto.id && f.ventas >= 1)).toBe(true);
    expect(filas.some((f) => f.cotizaciones >= 1)).toBe(true);
  });
  it("ya no hay acción de archivar en el demo (ni siquiera para el admin)", () => {
    expect("archivar" in almacenDemo(() => admin)).toBe(false);
  });
});
