import { describe, expect, it } from "vitest";
import { PERMISO_POOL_PRIVADO, privadosVisibles, veElPoolPrivado } from "./alcance";
import { almacenDemo, leadsDemo, PERSONAS_DEMO, personaDeLaPractica } from "./demo";
import { esPrivado, etapaDe, type Persona } from "./reglas";

/**
 * El modo enseñanza de Leads (D-770): quien mira es la persona de verdad, y la práctica trae privados (STXP) en
 * varias etapas. Antes, con sesión, la práctica caía en Ana (sin la casilla del STXP) y el STXP Pool no salía.
 */

const real: Persona = { id: "u-real", name: "Lupe Real", store: "RDZ Weslaco", admin: false, role: "sales", permissions: [PERMISO_POOL_PRIVADO] };
const sinCasilla: Persona = { ...real, id: "u-sin", permissions: [] };
const admin: Persona = { id: "u-admin", name: "Dueño Real", store: null, admin: true, role: "admin", permissions: [] };
const leads = () => leadsDemo(new Date("2026-11-18T12:00:00Z"));

describe("modo enseñanza: quién mira", () => {
  it("con sesión, la práctica enseña a la persona de verdad, no a la inventada del desplegable", () => {
    expect(personaDeLaPractica(real, "demo-ana")).toBe(real);
  });
  it("sin sesión sigue la persona elegida, y si no existe, la primera (la demo de siempre)", () => {
    expect(personaDeLaPractica(null, "demo-hugo").id).toBe("demo-hugo");
    expect(personaDeLaPractica(null, "no-existe").id).toBe(PERSONAS_DEMO[0].id);
  });
  it("quien tiene la casilla ve el STXP Pool de su tienda en la práctica; quien no, nada", () => {
    const yo = personaDeLaPractica(real, "demo-ana");
    expect(veElPoolPrivado(yo)).toBe(true);
    const privados = privadosVisibles(leads(), yo);
    expect(privados.length).toBeGreaterThan(0);
    expect(privados.some((l) => l.pool === "RDZ Weslaco")).toBe(true);
    expect(privadosVisibles(leads(), personaDeLaPractica(sinCasilla, "demo-hugo"))).toEqual([]);
  });
  it("el admin de verdad ve todos los privados del demo", () => {
    const todos = leads().filter(esPrivado).length;
    expect(privadosVisibles(leads(), personaDeLaPractica(admin, "demo-ana"))).toHaveLength(todos);
  });
});

describe("modo enseñanza: el STXP con etapas", () => {
  it("los privados enseñan varias etapas, y alguno sin ninguna (New)", () => {
    const etapas = new Set(leads().filter(esPrivado).map((l) => etapaDe(l)));
    expect(etapas.size).toBeGreaterThanOrEqual(4);
    expect(etapas.has("new")).toBe(true);
  });
  it("anotar con etapa en un privado, por la persona de verdad, cambia la etapa y queda en el historial", async () => {
    const yo = personaDeLaPractica(real, "demo-ana");
    const a = almacenDemo(() => yo);
    const r = await a.leer();
    if (!r.ok) throw new Error("no lee");
    const libre = r.valor.leads.find((l) => esPrivado(l) && etapaDe(l) === "new")!;
    expect(libre).toBeDefined();
    expect(await a.anotar(libre.id, "", "quote")).toMatchObject({ ok: true, valor: { follow_up_action: "quote", last_by: real.id, status: "free", holder: null } });
    const h = await a.historial(libre.id);
    expect(h.ok && h.valor.at(-1)).toMatchObject({ kind: "progress", action: "quote", actor: real.id });
  });
  it("quien no tiene la casilla no alcanza un privado: anotar en él se rechaza", async () => {
    const privado = leads().find((l) => esPrivado(l))!;
    const a = almacenDemo(() => personaDeLaPractica(sinCasilla, "demo-ana"));
    expect(await a.anotar(privado.id, "Hola", null)).toMatchObject({ ok: false, motivo: "otra_tienda" });
  });
});
