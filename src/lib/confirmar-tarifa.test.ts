import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escrituraAlComenzar, llegaSinTarifa, pideConfirmarTarifa } from "./confirmar-tarifa";
import type { OrderTypeRule } from "./types";

/**
 * Confirmar el monto al «Comenzar preparación», sin bloqueo (D-450). El dueño: «they just need to confirm the
 * amount»; preguntado, «confirmar el monto, sin bloqueo». Datos inventados; las reglas de tipo son las del demo,
 * que es la forma que tienen en Ajustes.
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const ficha = plano(leer("src/components/OrderModal.tsx"));

const REGLAS: Record<string, OrderTypeRule> = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true, docRef: "any", homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" },
};

describe("a quién se le pide confirmar: a los tipos que cobran tarifa", () => {
  it("una Customer sí", () => {
    expect(pideConfirmarTarifa({ order_type: "Customer" }, REGLAS)).toBe(true);
  });
  it("una Intertienda o un Transfer no: no cobran a nadie", () => {
    expect(pideConfirmarTarifa({ order_type: "Intertienda" }, REGLAS)).toBe(false);
    expect(pideConfirmarTarifa({ order_type: "Transfer" }, REGLAS)).toBe(false);
  });
  it("un tipo sin configurar sigue el respaldo de `required.ts`: entrega normal sí, traslado no", () => {
    expect(pideConfirmarTarifa({ order_type: "Entrega obra" }, undefined)).toBe(true);
    expect(pideConfirmarTarifa({ order_type: "Intra-Tienda" }, undefined)).toBe(false);
  });
});

describe("qué se escribe al comenzar", () => {
  it("confirmar la misma tarifa NO reescribe la tarifa: solo mueve la etapa", () => {
    const e = escrituraAlComenzar(126, 126);
    expect(e?.caso).toBe("confirmada");
    expect(e?.extra).toBeUndefined();
    expect(e?.nota.es).toBe("Tarifa confirmada $126.00");
  });
  it("corregirla la escribe, en la misma escritura, con el rastro de D-372", () => {
    const e = escrituraAlComenzar(126, 80);
    expect(e?.caso).toBe("corregida");
    expect(e?.extra).toEqual({ delivery_fee: 80 });
    expect(e?.nota.es).toBe("Tarifa corregida — Changed: Delivery Fee: 126 → 80");
    expect(e?.nota.en).toBe("Fee corrected — Changed: Delivery Fee: 126 → 80");
  });
  it("poner tarifa donde no había también es corregir, y el rastro dice que venía vacía", () => {
    const e = escrituraAlComenzar(null, 95.5);
    expect(e?.extra).toEqual({ delivery_fee: 95.5 });
    expect(e?.nota.es).toContain("Delivery Fee: — → 95.5");
  });
  it("cero es una tarifa que se confirma, no un hueco", () => {
    expect(escrituraAlComenzar(0, 0)?.caso).toBe("confirmada");
    expect(escrituraAlComenzar(null, 0)?.extra).toEqual({ delivery_fee: 0 });
  });
  it("vacío o negativo no se puede confirmar (el botón sale desactivado)", () => {
    expect(escrituraAlComenzar(126, null)).toBeNull();
    expect(escrituraAlComenzar(126, -5)).toBeNull();
  });
  it("SIN bloqueo: sin tarifa se continúa igual, y no se inventa ninguna", () => {
    const e = escrituraAlComenzar(null, null, true);
    expect(e).not.toBeNull();
    expect(e?.caso).toBe("sin");
    expect(e?.extra).toBeUndefined();
    expect(e?.nota.es).toContain("Sin tarifa");
  });
  it("«llega sin tarifa» es vacía o $0, como la 🚩 de D-147", () => {
    expect([llegaSinTarifa(null), llegaSinTarifa(undefined), llegaSinTarifa(0), llegaSinTarifa(126)]).toEqual([true, true, true, false]);
  });
});

/*
 * Nota D-551 (2026-10-14): el diálogo salió de la ficha a `ConfirmarTarifaAlComenzar`, y la escritura a
 * `escribeComenzar` (`lib/pasos-de-bodega`), porque los usa también la columna «Siguiente paso» de Almacén. El dueño:
 * «It would be easier if changing the stage for warehouse was a dropdown as a next column instead of having to open the
 * orders one by one». Lo que estas pruebas miraban dentro de la ficha se mira ahora donde vive, con las mismas citas
 * (cambia `existing` por `pedido` y `busy` por `ocupado`); lo que escribe se prueba EJECUTÁNDOLO en
 * `pasos-de-bodega.test.ts`.
 */
const dialogo = plano(leer("src/components/ConfirmarTarifaAlComenzar.tsx"));

describe("la ficha usa todo esto, y no otra cosa", () => {
  it("el botón llama a `comenzarPreparacion`, que abre el diálogo solo si el tipo cobra; si no, mueve la etapa", () => {
    const abrir = ficha.slice(ficha.indexOf("const comenzarPreparacion = () => {"), ficha.indexOf("const confirmarYComenzar"));
    expect(abrir.length).toBeGreaterThan(0);
    // Nota D-551: sin diálogo, la escritura de `escribeComenzar` con `null` (antes `move("fulfilling")`: la misma).
    expect(abrir).toContain("if (!pideConfirmarTarifa(existing, settings.order_type_rules)) { void confirmarYComenzar(null); return; }");
    expect(abrir).toContain("setShowStartConfirm(true);");
  });
  it("confirmar es UNA escritura: la etapa, la nota y el `extra` que decide `escrituraAlComenzar`", () => {
    const conf = ficha.slice(ficha.indexOf("const confirmarYComenzar = async"), ficha.indexOf("Guardar «agregar material»"));
    expect(conf.length).toBeGreaterThan(0);
    expect(conf).toContain("escribeComenzar(setStage, existing.id, escritura, t)");
    expect(conf).not.toContain("setStage(existing");
  });
  it("el diálogo: campo decimal, los precios Lista/Descuento, y el principal dice el monto", () => {
    expect(ficha).toContain("{showStartConfirm && existing && ( <ConfirmarTarifaAlComenzar pedido={existing} sugerencia={feeSuggestion}");
    expect(ficha).toContain("onConfirmar={(escritura) => void confirmarYComenzar(escritura)}");
    expect(dialogo).toContain("const escritura = escrituraAlComenzar(pedido.delivery_fee, tarifaAlComenzar);");
    expect(dialogo).toContain("useState<number | null>(pedido.delivery_fee ?? null)");
    expect(dialogo).toContain("<CampoDecimal value={tarifaAlComenzar} onValor={setTarifaAlComenzar}");
    expect(dialogo).toContain("<BotonesDeTarifa tarifa={tarifaAlComenzar} list={sugerencia.list} discount={sugerencia.discount} elegir={setTarifaAlComenzar}");
    expect(dialogo).toContain("onClick={() => { if (escritura) onConfirmar(escritura); }} disabled={ocupado || !escritura}>");
    expect(dialogo).toContain("t(`Confirm ${fmtMoney(tarifaAlComenzar)} and start`, `Confirmar ${fmtMoney(tarifaAlComenzar)} y comenzar`)");
  });
  it("la salida sin tarifa sale cuando la orden llega sin tarifa, y no depende de lo tecleado", () => {
    expect(dialogo).toContain("const sinTarifa = escrituraAlComenzar(pedido.delivery_fee, tarifaAlComenzar, true);");
    expect(dialogo).toContain('{sinCobrar && sinTarifa && ( <button className="btn btn-ghost" onClick={() => onConfirmar(sinTarifa)}');
    expect(dialogo).toContain("const sinCobrar = llegaSinTarifa(pedido.delivery_fee);");
  });
});
