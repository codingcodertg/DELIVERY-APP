import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buscaParaAsociar, empresaEnMisTiendas, planDeCambios, resultadoDeLaBase, textoDeSolicitudDeAsociacion, type Asociado } from "./asociaciones";
import { almacenDemoNuevo } from "./demo";
import { cambiosDelHistorial } from "./edicion-como-solicitud";
import { solicitudDeLaBase } from "./solicitud-de-cliente";
import type { Cliente } from "./reglas";

// D-NEXT (250): asociaciones varias a la vez, con aprobación y solo de las tiendas de quien propone.
const fila = (id: number, company_id: string, account: string, store: string): Cliente =>
  ({ id, company_id, account, store, archived_at: null, phone: null, contacts: [] }) as unknown as Cliente;
const t = (en: string) => en;

const sql = readFileSync(join(__dirname, "../../../supabase/migrations/250_asociaciones_con_aprobacion.sql"), "utf8");

describe("asociaciones: tiendas de quien propone", () => {
  const lista = [fila(1, "a", "ALFA SA", "MCA"), fila(2, "b", "BETA SA", "PHR"), fila(3, "b", "BETA SA", "MCA"), fila(4, "c", "CASA SA", "BRO")];
  it("una empresa es de mis tiendas si ALGUNA de sus filas está en una de ellas", () => {
    expect(empresaEnMisTiendas(lista.filter((f) => f.company_id === "b"), ["MCA"], false)).toBe(true);
    expect(empresaEnMisTiendas(lista.filter((f) => f.company_id === "c"), ["MCA"], false)).toBe(false);
    expect(empresaEnMisTiendas(lista.filter((f) => f.company_id === "c"), [], true)).toBe(true);
  });
  it("el vendedor solo encuentra clientes de sus tiendas; el admin, todos", () => {
    expect(buscaParaAsociar(lista, null, [], "sa", ["mca"], false).map((c) => c.company_id).sort()).toEqual(["a", "b", "c"].filter((x) => x !== "c"));
    expect(buscaParaAsociar(lista, null, [], "sa", [], true).map((c) => c.company_id).sort()).toEqual(["a", "b", "c"]);
  });
  it("la base lo exige: el buscador y el proponer miran las tiendas", () => {
    expect(sql).toMatch(/function erp\.busca_clientes_para_asociar[\s\S]*yo\.admin or exists[\s\S]*= any \(yo\.tiendas\)/);
    expect(sql).toMatch(/if not admin and not erp\.empresa_en_mis_tiendas\(otra\) then\s+raise exception/);
    expect(sql).toMatch(/with check \(kind <> 'asociacion'\)/);
    expect(sql).not.toContain("D-NEXT");
  });
});

describe("asociaciones: plan de cambios", () => {
  const asociados: Asociado[] = [{ id: 7, company_id: "x", account: "X", stores: [], crm_type: null, archivado: false }];
  it("varias a la vez, sin repetir las que ya están o esperan", () => {
    const p = planDeCambios(asociados, [{ id: 1, op: "add", company_id: "y", account: "Y", status: "pending" }], ["x", "y", "z", "w", "z"], [7, 99]);
    expect(p).toEqual({ add: ["z", "w"], remove: [7] });
  });
  it("lee el resultado y nombra la solicitud", () => {
    expect(resultadoDeLaBase({ applied: 0, requests: [4, 5] })).toEqual({ aplicadas: 0, solicitudes: [4, 5] });
    expect(textoDeSolicitudDeAsociacion({ op: "remove", associated_customer: "Q" }, t)).toBe("Remove association with Q");
    expect(solicitudDeLaBase({ id: 1, kind: "asociacion", payload: {} }).kind).toBe("asociacion");
  });
});

describe("asociaciones: aprobación en la demo", () => {
  const empresas = async (al: ReturnType<typeof almacenDemoNuevo>) => {
    const l = await al.leer();
    if (!l.ok) throw new Error("demo");
    return l.valor;
  };
  it("el admin aplica directo, varias a la vez", async () => {
    const al = almacenDemoNuevo();
    const lista = await empresas(al);
    const [x, y, z] = [...new Set(lista.map((c) => c.company_id!))];
    const yo = lista.find((c) => c.company_id === x)!;
    const r = await al.proponerAsociaciones!(yo.id, [y, z], [], "");
    expect(r.ok && r.valor).toEqual({ aplicadas: 2, solicitudes: [] });
    const a = await al.asociados!(x);
    expect(a.ok && a.valor.length).toBe(2);
  });
  it("el vendedor propone: queda pendiente; aprobar lo aplica con la solicitud en el historial; rechazar no cambia nada", async () => {
    const base = almacenDemoNuevo();
    const lista = await empresas(base);
    const tiendas = [...new Set(lista.map((c) => c.store ?? ""))];
    const al = almacenDemoNuevo([], { esAdmin: false, misTiendas: tiendas });
    const [x, y, z] = [...new Set(lista.map((c) => c.company_id!))];
    const yo = lista.find((c) => c.company_id === x)!;
    const r = await al.proponerAsociaciones!(yo.id, [y, z], [], "trabajan juntos");
    expect(r.ok && r.valor.solicitudes.length).toBe(2);
    expect((await al.asociados!(x)).ok && ((await al.asociados!(x)) as { valor: unknown[] }).valor).toEqual([]);
    const pend = await al.asociacionesPendientes!(x);
    expect(pend.ok && pend.valor.map((p) => p.company_id).sort()).toEqual([y, z].sort());
    // La otra empresa también lo ve pendiente.
    const deY = await al.asociacionesPendientes!(y);
    expect(deY.ok && deY.valor[0].company_id).toBe(x);

    const [s1, s2] = (r as { valor: { solicitudes: number[] } }).valor.solicitudes;
    expect((await al.aprobarSolicitud(s1)).ok).toBe(false); // no se aprueba como alta
    expect((await al.aprobarAsociacion!(s1, "ok")).ok).toBe(true);
    expect((await al.rechazarSolicitud(s2, "no")).ok).toBe(true);
    const a = await al.asociados!(x);
    expect(a.ok && a.valor.map((v) => v.company_id)).toHaveLength(1);
    const h = await al.historial(yo.id);
    const hechas = h.ok ? h.valor : [];
    expect(hechas.find((e) => e.kind === "associate")?.request_id).toBe(s1);
    const rechazada = hechas.find((e) => e.kind === "rejected")!;
    expect(cambiosDelHistorial(rechazada).map((c) => c.key)).toEqual(["associated_customer"]);
    expect((await al.asociacionesPendientes!(x)).ok && ((await al.asociacionesPendientes!(x)) as { valor: unknown[] }).valor).toEqual([]);
  });
  it("el vendedor no puede proponer un cliente de otra tienda", async () => {
    const lista = await empresas(almacenDemoNuevo());
    const yo = lista[0];
    const ajena = lista.find((c) => c.store !== yo.store && !lista.some((d) => d.company_id === c.company_id && d.store === yo.store));
    if (!ajena) return;
    const al = almacenDemoNuevo([], { esAdmin: false, misTiendas: [yo.store ?? ""] });
    const r = await al.proponerAsociaciones!(yo.id, [ajena.company_id!], [], "");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.sinPermiso).toBe(true);
    const b = await al.buscarParaAsociar!(ajena.account.slice(0, 4));
    expect(b.ok && b.valor.some((c) => c.company_id === ajena.company_id)).toBe(false);
  });
});
