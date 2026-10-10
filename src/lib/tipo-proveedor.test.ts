import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hayClienteDetras, isStoreToStore, missingFields, orderTypeRule, submitBlockers } from "./required";
import { esTipoDeCliente, tipoDeClienteDeLaOrden } from "./customer-type";
import { documentoPrincipal } from "./order-document";
import { facturaPendiente } from "./documento-pendiente";
import { celdaPropiaDelPlan, claseDeLaOrden } from "./route-plan/celdas-del-plan";
import { decidirAviso, type OrdenParaAviso } from "./avisos-cliente";
import type { Delivery, OrderTypeRule, Stage } from "./types";

/**
 * D-511 · El tipo de orden «Proveedor»: sale de una tienda, va a un proveedor, no lleva papel.
 *
 * El dueño: «hay que agregar un tipo de orden diferente que es para cuando se lleva producto a un
 * proveedor, sale de una tienda y se lleva a un proveedor obviamente no lleva invoice ni nada de eso
 * se va a llamar proveedor».
 *
 * Lo que de verdad hay que demostrar son DOS cosas, y las dos se miden contra los tipos que ya
 * existen, no en el vacío:
 *
 *  1. Que «Proveedor» se comporta distinto de Customer (sin papel, sin cliente) **y** distinto de
 *     Intertienda (destino libre, no una de nuestras tiendas). Si una prueba solo lo comparara con
 *     uno de los dos, una implementación que lo tratara como el otro pasaría.
 *  2. Que los TRES tipos de producción no cambian de comportamiento. El respaldo
 *     `hasCustomer ?? !storeToStore` existe para eso, y una prueba que no lo fije dejaría pasar un
 *     cambio que le quita el SMS a los clientes de verdad.
 */

// Las reglas tal como están en producción el 2026-10-10, leídas de `settings.order_type_rules`,
// más la nueva. No se inventan: si esto se desvía de la base, la prueba deja de medir lo que corre.
const REGLAS: Record<string, OrderTypeRule> = {
  Customer: { docRef: "invoice", storeToStore: false },
  Transfer: { docRef: "estimate", storeToStore: true },
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Proveedor: { docRef: "hidden", storeToStore: false, hasCustomer: false },
};

const orden = (p: Partial<Delivery> = {}): Partial<Delivery> => ({
  id: "d1", order_type: "Proveedor", stage: "ready", delivery_name: "", account: "",
  contact: "Bodega del proveedor", delivery_phone: "9561234567", delivery_address: "1 Supplier Rd",
  ...p,
});

describe("Proveedor no es Customer y tampoco es Intertienda", () => {
  it("las tres banderas, una por una, frente a los otros dos tipos", () => {
    const filas = ["Customer", "Intertienda", "Proveedor"].map((t) => {
      const r = orderTypeRule(t, REGLAS);
      return [t, r.docRef, isStoreToStore(t, REGLAS), hayClienteDetras(t, REGLAS)];
    });
    expect(filas).toEqual([
      ["Customer", "invoice", false, true],
      ["Intertienda", "po", true, false],
      // Lo que no se podía describir antes: NI tienda-a-tienda NI con cliente.
      ["Proveedor", "hidden", false, false],
    ]);
  });

  it("no exige factura, ni PO, ni tarifa — y Customer sí, con la misma orden", () => {
    const vacia: Partial<Delivery> = { id: "d1", order_type: "Proveedor", stage: "ready", contact: "A", delivery_phone: "9561234567" };
    const faltan = missingFields(vacia, REGLAS).map((m) => m.key);
    // Hay campos que se exigen SIEMPRE, sea el tipo que sea (tienda, recogida, pallets...), así que
    // no se afirma una lista vacía: se afirma que NINGUNO de los de papel ni la tarifa está.
    for (const k of ["invoice_num", "po2", "so_num", "doc_ref", "delivery_fee"]) {
      expect([k, faltan.includes(k)]).toEqual([k, false]);
    }
    // Y que nada de papel BLOQUEE el envío, que es el único de los dos que impide guardar. Tampoco
    // se afirma lista vacía: `est_pallets` bloquea siempre, y eso no lo decide el tipo de orden.
    const bloquean = submitBlockers(vacia, REGLAS, []).map((m) => m.key);
    expect(bloquean).toEqual(["est_pallets"]);
    // El gemelo, con la misma orden: como Customer, la factura TAMBIÉN bloquea.
    expect(submitBlockers({ ...vacia, order_type: "Customer" }, REGLAS, []).map((m) => m.key)).toContain("invoice_num");
    // El gemelo: la MISMA orden como Customer sí reclama papel y tarifa.
    const comoCliente = missingFields({ ...vacia, order_type: "Customer" }, REGLAS).map((m) => m.key);
    expect(comoCliente).toContain("invoice_num");
    expect(comoCliente).toContain("delivery_fee");
  });

  it("no exige tienda destino — y una Intertienda sí, con la misma orden", () => {
    const sinDestino: Partial<Delivery> = { id: "d1", order_type: "Proveedor", stage: "ready", contact: "A", delivery_phone: "9561234567", delivery_name: "" };
    expect(missingFields(sinDestino, REGLAS).map((m) => m.key)).not.toContain("delivery_name");
    expect(missingFields({ ...sinDestino, order_type: "Intertienda" }, REGLAS).map((m) => m.key)).toContain("delivery_name");
  });

  it("sí pide a quién entregarle: contacto y teléfono, como cualquier destino de fuera", () => {
    // Un proveedor no es cliente, pero el chofer necesita a quién llamar al llegar.
    const casiVacia: Partial<Delivery> = { id: "d1", order_type: "Proveedor", stage: "ready" };
    const faltan = missingFields(casiVacia, REGLAS).map((m) => m.key);
    expect(faltan).toContain("contact");
    expect(faltan).toContain("delivery_phone");
  });
});

describe("no tiene papel, y no se le persigue uno", () => {
  it("sin documento principal, ni de rebote por una factura heredada", () => {
    expect(documentoPrincipal(orden(), REGLAS)).toBeNull();
    // Una orden que arrastra una factura de cuando era Customer tampoco la enseña.
    expect(documentoPrincipal(orden({ invoice_num: "INV-9" }), REGLAS)).toBeNull();
  });

  it("no sale en «Factura pendiente» — y Customer en la misma etapa sí", () => {
    // `OrdenConDocumento` pide los cuatro documentos y la etapa NO opcional, así que no vale
    // `Partial<Delivery>`: se escriben los cuatro en nulo, que es justo el caso que se mide.
    const sinFactura = {
      id: "d1", stage: "ready" as Stage,
      invoice_num: null, po2: null, so_num: null, estimate_num: null,
    };
    expect(facturaPendiente({ ...sinFactura, order_type: "Proveedor" }, REGLAS)).toBe(false);
    expect(facturaPendiente({ ...sinFactura, order_type: "Customer" }, REGLAS)).toBe(true);
    // Y el tipo de al lado, `none`, sigue saliendo: solo `hidden` es la salida nueva.
    expect(facturaPendiente({ ...sinFactura, order_type: "Transfer" }, REGLAS)).toBe(true);
  });

  it("la pantalla no pinta Factura/PO/SO para este tipo", () => {
    // Sin jsdom (vitest corre en `node`) el modal no se renderiza: se fija el discriminador exacto,
    // y que vaya PRIMERO — es la única rama que no pinta nada.
    const p = readFileSync("src/components/OrderModal.tsx", "utf8").split("\r\n").join("\n");
    expect(p).toContain('{docRef === "hidden" ? null : docRef === "estimate" ? (');
    // Y que exista la opción en Datos, o el tipo no se podría configurar desde la app.
    const datos = readFileSync("src/app/(app)/data/page.tsx", "utf8").split("\r\n").join("\n");
    expect(datos).toContain('<option value="hidden">');
  });
});

describe("no tiene cliente detrás", () => {
  it("no se le pone tipo de cliente, así que no hereda prioridad de builder", () => {
    expect(esTipoDeCliente("Proveedor", REGLAS)).toBe(false);
    expect(tipoDeClienteDeLaOrden(orden({ account: "ACME" }), REGLAS)).toBeNull();
    // El gemelo: la misma orden como Customer sí la hereda.
    expect(tipoDeClienteDeLaOrden({ ...orden({ account: "ACME" }), order_type: "Customer" }, REGLAS)).toBe("builder");
  });

  it("no se le manda el aviso de cliente, aunque tenga teléfono bueno", () => {
    // `OrdenParaAviso` escoge campos obligatorios de `Delivery`, así que tampoco vale un
    // `Partial`: se escribe la orden entera que la decisión mira, con el teléfono BUENO a propósito
    // —si la prueba lo dejara vacío, pasaría por el motivo equivocado y no mediría nada—.
    const o: OrdenParaAviso = {
      id: "d1", order_no: 1, order_type: "Proveedor", stage: "ready",
      delivery_date: "2026-10-11", delivery_windows: null, delivery_phone: "9561234567",
      is_training: false, assigned_driver: null, notify_pref: "sms",
    };
    expect(decidirAviso(o, "night_before", REGLAS, new Set())).toEqual({ ok: false, motivo: "sin_cliente" });
  });

  it("en el plan de rutas se llama Proveedor, no Builder ni Intertienda", () => {
    expect(claseDeLaOrden(orden(), REGLAS)).toBe("proveedor");
    const ctx = { reglas: REGLAS, tiendas: [], conocidas: [], es: true };
    expect(celdaPropiaDelPlan("pl_clase", orden(), ctx)).toBe("Proveedor");
    expect(celdaPropiaDelPlan("pl_clase", orden(), { ...ctx, es: false })).toBe("Supplier");
    // Los otros dos no se mueven de su clase.
    expect(claseDeLaOrden({ order_type: "Intertienda" }, REGLAS)).toBe("intertienda");
    expect(claseDeLaOrden({ order_type: "Customer", account: "ACME" }, REGLAS)).toBe("builder");
    // Sin tipo sigue sin inventarse nada.
    expect(claseDeLaOrden({ order_type: "" }, REGLAS)).toBeNull();
  });
});

describe("los tipos que ya existen no cambian", () => {
  it("sin `hasCustomer` declarado, «hay cliente» es exactamente lo contrario de tienda-a-tienda", () => {
    // Esta es la prueba del respaldo. Si alguien quita el `?? storeToStore !== true`, los tres
    // tipos de producción cambian de comportamiento a la vez y esto cae.
    for (const t of ["Customer", "Transfer", "Intertienda"]) {
      expect([t, hayClienteDetras(t, REGLAS)]).toEqual([t, !isStoreToStore(t, REGLAS)]);
    }
  });

  it("un tipo sin regla ninguna sigue cayendo en «factura requerida»", () => {
    expect(orderTypeRule("Loquesea", {})).toEqual({ storeToStore: false, docRef: "invoice" });
  });

  it("pero uno llamado como un proveedor, sin regla, NO cae ahí", () => {
    // El respaldo por palabras clave: si la fila de `settings` se perdiera, o el tipo llegara de un
    // CSV, «proveedor» no debe acabar exigiendo factura y tarifa.
    for (const nombre of ["Proveedor", "proveedor", "Supplier", "vendor"]) {
      expect([nombre, orderTypeRule(nombre, {})]).toEqual([
        nombre, { storeToStore: false, hasCustomer: false, docRef: "hidden" },
      ]);
    }
  });

  it("y «proveedor» gana al respaldo de «tienda», que lo habría hecho tienda-a-tienda", () => {
    // El orden de los `if` de `fallbackRule` importa: /intra|tienda/ no casa con «proveedor», pero
    // un nombre que lleve las dos palabras sí casaría con los dos. Gana proveedor.
    expect(orderTypeRule("Proveedor de tienda", {}).storeToStore).toBe(false);
  });
});

describe("la migración siembra lo mismo que dice el código", () => {
  it("la 164 escribe las tres banderas con los mismos valores", () => {
    const crudo = readFileSync("supabase/migrations/164_tipo_proveedor.sql", "utf8");
    // Los comentarios FUERA. El de esta migración cita el anti-patrón que la comprobación de abajo
    // prohíbe, así que la prueba fallaba contra la propia explicación de lo que no hay que hacer:
    // una prueba que lee el fuente la tumba su propio texto. Se mide el SQL que corre, no la prosa.
    const sql = crudo
      .split("\n")
      .map((l) => l.replace("\r", ""))
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    // Un número copiado a mano en dos sitios se desincroniza; aquí se afirma que no.
    expect(sql).toContain("'storeToStore', false");
    expect(sql).toContain("'hasCustomer',  false");
    expect(sql).toContain("'docRef',       'hidden'");
    // Merge, no reemplazo: reemplazar borraría Customer y rompería la guarda de la 146.
    expect(sql).toContain("order_type_rules || jsonb_build_object");
    expect(sql).not.toMatch(/set\s+order_type_rules\s*=\s*'\{/);
    // Y sin transacción propia, que cierra la de fuera en un ensayo con ROLLBACK (pasó con la 124).
    expect(sql.toLowerCase()).not.toMatch(/^\s*(begin|commit)\s*;/m);
  });
});
