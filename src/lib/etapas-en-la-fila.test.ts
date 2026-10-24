import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escrituraAlAnular, notaDelSalto, saltosEnLaFila, type ConfirmacionDelSalto } from "./etapas-en-la-fila";
import type { CancelReason, OrderTypeRule, Stage, UserRole } from "./types";

/**
 * La burbuja de «Etapa» como selector en la fila de Almacén (D-573). El dueño, 2026-10-16: «Remove next step column and
 * have the stage column do that dropdown function. Dropdown should give all stage options not just the next one. Whatever
 * stage they choose, if stages required an input it must still ask (like the # of pallets and delivery fee). Also want
 * to keep the colored bubble design».
 *
 * La tabla de abajo está sacada A MANO del tramo de cambio de etapa de `guard_delivery_stage` en la migración 173 (la
 * última que lo redefine), cruzada con `LEGAL_TRANSITIONS` (lo que `setStage` exige a quien no es admin) y con lo que la
 * fila NO ofrece a propósito (recoger, la entrega con firma de almacén, enviar/reenviar de ventas). Si el guard cambia,
 * esta tabla tiene que cambiar con él.
 */

const REGLAS: Record<string, OrderTypeRule> = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true, docRef: "any", homeIsDestination: true },
};
const yo = (role: UserRole, permissions: string[] = []) => ({ id: "u-1", role, full_name: "Persona Prueba", permissions });
const orden = (stage: Stage, order_type = "Customer") => ({ stage, order_type });
const ETAPAS: Stage[] = ["draft", "pending", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"];

type Fila = Partial<Record<Stage, ConfirmacionDelSalto>>;
const mapa = (role: UserRole, stage: Stage, deMiTienda = false, tipo = "Customer"): Fila =>
  Object.fromEntries(saltosEnLaFila(yo(role), orden(stage, tipo), REGLAS, deMiTienda).map((s) => [s.destino, s.confirmacion]));
const tabla = (role: UserRole, deMiTienda = false) => Object.fromEntries(ETAPAS.map((s) => [s, mapa(role, s, deMiTienda)]));

describe("qué etapas ofrece la burbuja, rol por rol, medido contra el guard (173)", () => {
  it("almacén en su tienda: adelante (comenzar, listo) y un paso atrás con motivo; nunca anular, aprobar ni entregar", () => {
    expect(tabla("warehouse", true)).toEqual({
      draft: {}, pending: {}, rejected: {}, canceled: {},
      approved:   { fulfilling: "tarifa" },
      fulfilling: { ready: "pallets", approved: "motivo_deshacer" },
      // «Recoger» (→ picked_up) se queda en la ficha: GPS, cargas partidas y chofer.
      ready:      { fulfilling: "motivo_deshacer" },
      // «Marcar entregado» de almacén lleva firma: en la ficha (y «Recibir» en la fila de Recepción, D-409).
      picked_up:  { ready: "motivo_deshacer" },
      delivered:  { picked_up: "motivo_deshacer" },
    });
  });
  it("almacén en una orden de OTRA tienda: solo adelante y la vuelta de una recogida; el guard rechaza deshacer fuera de su tienda (142)", () => {
    expect(tabla("warehouse", false)).toEqual({
      draft: {}, pending: {}, rejected: {}, canceled: {},
      approved:   { fulfilling: "tarifa" },
      fulfilling: { ready: "pallets" },
      ready:      {},
      picked_up:  { ready: "motivo_deshacer" },
      delivered:  {},
    });
  });
  it("gerente: aprueba, rechaza, desbloquea, hace bodega (D-397), anula, entrega ya y deshace; la tienda no cuenta", () => {
    const esperado = {
      draft:      { canceled: "anular" },
      pending:    { approved: null, rejected: "motivo_rechazo", canceled: "anular" },
      rejected:   { canceled: "anular" },
      approved:   { pending: null, fulfilling: "tarifa", delivered: "motivo_entrega", canceled: "anular" },
      fulfilling: { approved: "motivo_deshacer", ready: "pallets", delivered: "motivo_entrega", canceled: "anular" },
      ready:      { fulfilling: "motivo_deshacer", delivered: "motivo_entrega", canceled: "anular" },
      picked_up:  { ready: "motivo_deshacer", delivered: "motivo_entrega" },
      delivered:  { picked_up: "motivo_deshacer" },
      canceled:   {},
    };
    expect(tabla("manager", false)).toEqual(esperado);
    expect(tabla("manager", true)).toEqual(esperado);
  });
  it("oficina (accounting): como el gerente menos los dos pasos de bodega, que el guard solo le da al gerente", () => {
    const t = tabla("accounting");
    expect(t.approved).toEqual({ pending: null, delivered: "motivo_entrega", canceled: "anular" });
    expect(t.fulfilling).toEqual({ approved: "motivo_deshacer", delivered: "motivo_entrega", canceled: "anular" });
    expect(t.pending).toEqual({ approved: null, rejected: "motivo_rechazo", canceled: "anular" });
    expect(t.ready).toEqual(tabla("manager").ready);
    expect(t.picked_up).toEqual(tabla("manager").picked_up);
  });
  it("admin: todo lo legal menos recoger y lo de ventas; la base no le rechaza nada de esto", () => {
    expect(tabla("admin")).toEqual({
      draft:      { canceled: "anular" },
      pending:    { approved: null, rejected: "motivo_rechazo", canceled: "anular" },
      rejected:   { canceled: "anular" },
      approved:   { pending: null, fulfilling: "tarifa", delivered: "motivo_entrega", canceled: "anular" },
      fulfilling: { approved: "motivo_deshacer", ready: "pallets", delivered: "motivo_entrega", canceled: "anular" },
      ready:      { fulfilling: "motivo_deshacer", delivered: "motivo_entrega", canceled: "anular" },
      // D-676 (196): `picked_up → canceled` existe ahora como salto (para el chofer), y el admin, que ya podía, lo ve.
      picked_up:  { ready: "motivo_deshacer", delivered: "motivo_entrega", canceled: "anular" },
      delivered:  { picked_up: "motivo_deshacer" },
      canceled:   {},
    });
  });
  it("logística, ventas y chofer: nada. Logística tiene `approve` en el cliente, pero el guard no le da ningún cambio de etapa", () => {
    for (const r of ["logistics", "sales", "driver"] as UserRole[]) {
      for (const s of ETAPAS) expect(saltosEnLaFila(yo(r), orden(s), REGLAS, true), `${r} en ${s}`).toEqual([]);
    }
  });
  it("nunca ofrece la etapa en la que ya está, ni una anulada se mueve", () => {
    for (const r of ["admin", "manager", "warehouse", "accounting"] as UserRole[]) {
      for (const s of ETAPAS) expect(mapa(r, s, true)[s], `${r} en ${s}`).toBeUndefined();
      expect(mapa(r, "canceled", true)).toEqual({});
    }
  });
  it("las opciones salen en el orden de las etapas, no en el de la regla", () => {
    expect(saltosEnLaFila(yo("manager"), orden("fulfilling"), REGLAS, false).map((s) => s.destino))
      .toEqual(["approved", "ready", "delivered", "canceled"]);
  });
});

describe("qué confirma cada salto", () => {
  it("comenzar: la tarifa solo en los tipos que cobran (D-450); una Intertienda se escribe al elegirla", () => {
    expect(mapa("warehouse", "approved", false, "Customer").fulfilling).toBe("tarifa");
    expect(mapa("warehouse", "approved", false, "Intertienda").fulfilling).toBeNull();
  });
  it("marcar listo: los pallets siempre, también en una Intertienda (D-287)", () => {
    expect(mapa("warehouse", "fulfilling", false, "Intertienda").ready).toBe("pallets");
  });
  it("las notas de entregar ya y de deshacer son las de la ficha, con el motivo recortado", () => {
    expect(notaDelSalto("motivo_entrega", "  el cliente se la llevó ")).toEqual({
      en: "Delivered by office (no signature): el cliente se la llevó", es: "Entregada por oficina (sin firma): el cliente se la llevó",
    });
    expect(notaDelSalto("motivo_deshacer", "fue un toque")).toEqual({
      en: "Stage undone (was a mistake): fue un toque", es: "Etapa deshecha (fue un error): fue un toque",
    });
  });
  it("anular escribe la clave y el texto libre en sus columnas (122), y la etiqueta legible en la nota", () => {
    const motivos: CancelReason[] = [{ key: "dup", en: "Duplicate", es: "Duplicada" }, { key: "other", en: "Other", es: "Otro" }];
    expect(escrituraAlAnular("dup", "  ", motivos, "es")).toEqual({ extra: { canceled_reason: "dup", canceled_reason_note: null }, nota: "Duplicada" });
    const otro = escrituraAlAnular("other", " se fue ", motivos, "en");
    expect(otro.extra).toEqual({ canceled_reason: "other", canceled_reason_note: "se fue" });
    expect(otro.nota).toContain("se fue");
  });
});

describe("la página, la tabla y la ficha pasan por aquí", () => {
  const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\s+/g, " ");
  const pagina = leer("src/app/(app)/warehouse/page.tsx");
  const fila = leer("src/components/EtapaEnLaFila.tsx");
  const tabla = leer("src/components/OrdersTable.tsx");
  const ficha = leer("src/components/OrderModal.tsx");

  it("Almacén ya no monta la columna «Siguiente paso»: la celda de Etapa de la Cola y de Recepción es la burbuja-selector", () => {
    expect(pagina).not.toContain("columnaSiguientePaso");
    expect(pagina).not.toContain("Siguiente paso");
    expect(pagina).toContain("const etapaEnLaFila = useEtapaEnLaFila();");
    expect(pagina.split("celdaDeEtapa={etapaEnLaFila.celda}").length - 1).toBe(2);
    expect(pagina).toContain("{etapaEnLaFila.dialogo}");
  });
  it("la tabla deja a la página pintar la celda de Etapa, con la misma pastilla de color", () => {
    expect(tabla).toContain("celdaDeEtapa ? celdaDeEtapa(d, p, burbuja) : burbuja");
  });
  it("la celda pregunta a `saltosEnLaFila`; la burbuja de siempre lleva el <select> encima y el toque no abre la ficha", () => {
    expect(fila).toContain("const saltos = saltosEnLaFila(me, d, settings.order_type_rules, ordenDeMisTiendas(d, me.store, settings.stores));");
    expect(fila).toContain('className="sema sema-switch"');
    expect(fila).toContain("onClick={(e) => e.stopPropagation()}");
    expect(fila).toContain("if (salto.confirmacion) { setAbierto({ pedido, salto }); return; }");
  });
  it("los diálogos son los de la ficha y escriben con las mismas funciones", () => {
    for (const s of ["<ConfirmarTarifaAlComenzar", "<ConfirmarPallets", "<ConfirmarAnulacion", "<MotivoDelSalto",
      "escribeComenzar(setStage, pedido.id, escritura, t)", "escribeListo(setStage, pedido.id, escritura, t)",
      'setStage(pedido.id, "canceled", escritura.nota, escritura.extra)', "notaDelSalto(clase, motivo)"]) {
      expect(fila, s).toContain(s);
    }
    // El diálogo de anular arma la escritura con la misma función que la ficha, y lo que falta lo dice `faltaParaAnular`.
    const anular = leer("src/components/ConfirmarAnulacion.tsx");
    expect(anular).toContain("escrituraAlAnular(clave, texto, motivos, lang)");
    expect(anular).toContain("faltaParaAnular(clave, texto, motivos, lang)");
    expect(ficha).toContain("escrituraAlAnular(cancelReason, cancelNote, motivos, lang)");
    expect(ficha).toContain('notaDelSalto("motivo_entrega", motivoDeSalto)');
    expect(ficha).toContain('notaDelSalto("motivo_deshacer", motivoDeSalto)');
  });
  it("el estilo: la burbuja sigue siendo `.sema` y el <select> es la superficie entera, como `.role-switch`", () => {
    const css = leer("src/app/globals.css");
    expect(css).toContain(".sema-switch select { position: absolute; inset: 0;");
    expect(css).not.toContain(".paso-en-la-fila");
  });
});
