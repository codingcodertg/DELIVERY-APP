import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avisoDeTienda, filaDeAsignacion, vendedorAlCambiarTienda, vendedoresParaElegir } from "./vendedor-de-la-cotizacion";
import { almacenDemo, VENDEDORES_DEMO } from "./demo";
import { borradorVacio } from "./modelo";

const REPS = [
  { id: "a", full_name: "Ana", store: "Edinburg" },
  { id: "p", full_name: "Pablo", store: "Pharr" },
  { id: "b", full_name: "beto", store: "pharr " },
];

describe("vendedoresParaElegir", () => {
  it("filtra por tienda (sin distinguir mayúsculas) y ordena por nombre", () => {
    expect(vendedoresParaElegir(REPS, "Pharr", null).map((v) => v.id)).toEqual(["b", "p"]);
    expect(vendedoresParaElegir(REPS, null, null).map((v) => v.id)).toEqual(["a", "b", "p"]);
  });
  it("el elegido ahora siempre sale, aunque sea de otra tienda", () => {
    const yo = { id: "adm", full_name: "Admin", store: "Brownsville" };
    expect(vendedoresParaElegir(REPS, "Pharr", yo).map((v) => v.id)).toContain("adm");
  });
});

describe("vendedorAlCambiarTienda", () => {
  it("si el elegido no es de la tienda nueva, propone el primero de ella", () => {
    expect(vendedorAlCambiarTienda(REPS, "Pharr", "a")).toBe("b");
    expect(vendedorAlCambiarTienda(REPS, "Pharr", "p")).toBe("p");
  });
  it("sin vendedores en la tienda, o sin tienda, se queda el que estaba", () => {
    expect(vendedorAlCambiarTienda(REPS, "Mission", "a")).toBe("a");
    expect(vendedorAlCambiarTienda(REPS, null, "a")).toBe("a");
  });
});

describe("filaDeAsignacion", () => {
  it("el no-admin nunca manda dueño ni tienda", () => {
    expect(filaDeAsignacion(false, { owner_id: "p", store: "Pharr" }, null)).toEqual({});
  });
  it("nueva: el admin manda dueño y tienda", () => {
    expect(filaDeAsignacion(true, { owner_id: "p", store: " Pharr " }, null)).toEqual({ owner_id: "p", store: "Pharr" });
  });
  it("edición: solo lo que cambió", () => {
    const antes = { owner_id: "a", store: "Edinburg" };
    expect(filaDeAsignacion(true, antes, antes)).toEqual({});
    expect(filaDeAsignacion(true, { owner_id: "p", store: "Edinburg" }, antes)).toEqual({ owner_id: "p" });
    expect(filaDeAsignacion(true, { owner_id: "a", store: "Pharr" }, antes)).toEqual({ store: "Pharr" });
    expect(filaDeAsignacion(true, { owner_id: "a", store: null }, antes)).toEqual({ store: null });
  });
});

describe("avisoDeTienda", () => {
  it("null si quedó la elegida; si no, la que quedó", () => {
    expect(avisoDeTienda("Pharr", "pharr")).toBeNull();
    expect(avisoDeTienda(null, "Edinburg")).toBeNull();
    expect(avisoDeTienda("Pharr", "Edinburg")).toBe("Edinburg");
    expect(avisoDeTienda("Pharr", null)).toBe("");
  });
});

describe("el demo, como el guardia de la 148 + 246", () => {
  const borrador = (n: string) => ({ ...borradorVacio(), estimate_num: n });
  it("el admin crea a nombre de un vendedor de Pharr, con su tienda", async () => {
    const a = almacenDemo(() => ({ id: "u-admin", name: "Admin", admin: true, store: "Brownsville" }), false);
    const r = await a.guardar(null, borrador("T-1"), null, { owner_id: "u-sales3", store: "Pharr" });
    expect(r.ok && r.store).toBe("Pharr");
    const c = await a.cargar(r.ok ? r.valor : "");
    expect(c.ok && c.valor.owner_id).toBe("u-sales3");
    expect(VENDEDORES_DEMO.some((v) => v.id === "u-sales3")).toBe(true);
  });
  it("el no-admin no puede poner otro dueño", async () => {
    const a = almacenDemo(() => ({ id: "u-sales", name: "Sam", admin: false, store: "Edinburg" }), false);
    const r = await a.guardar(null, borrador("T-2"), null, { owner_id: "u-sales3", store: "Pharr" });
    const c = await a.cargar(r.ok ? r.valor : "");
    expect(c.ok && c.valor.owner_id).toBe("u-sales");
    expect(c.ok && c.valor.store).toBe("Edinburg");
  });
});

describe("la migración 246 y la pantalla", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/246_cotizacion_tienda_del_admin.sql"), "utf8");
  it("solo el admin fija la tienda; el no-admin sigue sin poder cambiar el dueño", () => {
    expect(sql).toContain("when admin and new.store is distinct from old.store");
    expect(sql).toContain("Only an admin can change who owns an estimate");
    expect(sql).toContain("-- @ledger-below");
    expect(sql).not.toContain("D-NEXT");
  });
  it("el selector del vendedor va dentro de «me.admin &&»", () => {
    const e = readFileSync(join(process.cwd(), "src/app/estimator/Estimador.tsx"), "utf8");
    const i = e.indexOf('{t("Sales rep", "Vendedor")}');
    expect(e.slice(e.lastIndexOf("{me.admin && (", i), i)).not.toContain(")}");
  });
});
