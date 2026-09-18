import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canEditFields, ROLE_ORDER, STAGES } from "./constants";
import { borradorDuplicado } from "./order-duplicate";
import { ventasVeLaOrden } from "./visibilidad-ventas";
import type { Delivery, UserRole } from "./types";

/**
 * El borrador se puede retomar, y duplicar copia lo que hacía falta (D-286).
 *
 * La regla del borrador vive en la app, pero la de verdad la pone la base: por eso la primera prueba
 * compara `canEditFields` con las ramas del `guard_delivery_stage` de la 118, leídas del `.sql`. Si un
 * día se separan, cae aquí y no en producción.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
/** El salto de línea, por su código: escrito como escape, la herramienta que editó este fichero lo
 *  resolvía y partía la línea en dos. */
const SALTO = String.fromCharCode(10);
const guard = leer("supabase/migrations/118_guard_office_como_manager.sql");
/** El tramo de «misma etapa» del guard, que es el que decide si se puede editar sin mover la etapa. */
const mismaEtapa = guard.slice(guard.indexOf("if new_stage is not distinct from old_stage then"), guard.indexOf("if r in ('sales','driver','manager','accounting') then"));

/** ¿La base deja a este rol editar un borrador sin moverlo de etapa? Leído del guard. */
function laBaseDejaEditarBorrador(rol: UserRole): boolean {
  if (rol === "admin") return guard.includes("if r = 'admin' then return NEW; end if;");
  const lineas = mismaEtapa.split("\n").filter((l) => l.includes("return NEW") && l.includes("r ") && l.includes("old_stage"));
  return lineas.some((l) => l.includes(`'${rol}'`) && l.includes("'draft'"))
    || (["manager", "accounting"].includes(rol) && mismaEtapa.includes("if r in ('manager','accounting') then return NEW; end if;"));
}

describe("quién puede retomar un borrador", () => {
  it("el tramo del guard se encontró (control), y nombra a los roles", () => {
    expect(mismaEtapa.length).toBeGreaterThan(200);
    expect(mismaEtapa).toContain("old_stage in ('draft','pending','rejected')");
  });

  it("la app y la base dicen lo mismo, rol por rol", () => {
    for (const rol of ROLE_ORDER) {
      expect([rol, canEditFields(rol, "draft")]).toEqual([rol, laBaseDejaEditarBorrador(rol)]);
    }
  });

  it("en concreto: ventas puede —antes no—, y almacén no", () => {
    expect(canEditFields("sales", "draft")).toBe(true);
    expect(canEditFields("driver", "draft")).toBe(true);
    expect(canEditFields("logistics", "draft")).toBe(true);
    expect(canEditFields("manager", "draft")).toBe(true);
    expect(canEditFields("accounting", "draft")).toBe(true);
    expect(canEditFields("admin", "draft")).toBe(true);
    // Almacén no ve borradores (RLS) y el guard le rechazaría la escritura.
    expect(canEditFields("warehouse", "draft")).toBe(false);
    expect(laBaseDejaEditarBorrador("warehouse")).toBe(false);
  });

  it("las demás etapas no se tocan", () => {
    const fuera = STAGES.map((s) => s.key).filter((s) => s !== "draft");
    for (const s of fuera) {
      expect([s, canEditFields("sales", s)]).toEqual([s, s === "pending" || s === "rejected"]);
      expect([s, canEditFields("warehouse", s)]).toEqual([s, ["approved", "fulfilling", "ready", "picked_up", "delivered"].includes(s)]);
      expect([s, canEditFields("logistics", s)]).toEqual([s, false]);
    }
  });

  it("y un vendedor ve los borradores de cualquiera, solo los borradores", () => {
    // El corte de ventas se mudó entero a `ventasVeLaOrden` (D-NEXT), así que **lo de D-286 se
    // comprueba donde ahora se decide**: en la función, con datos, no en el texto de la pantalla.
    // Un canario que siguiera mirando la línea vieja se habría quedado vigilando un sitio donde ya no
    // pasa nada.
    const comun = { miId: "vendedor-1", miTienda: "Tienda Norte", regla: { storeToStore: false }, tiendas: [] };
    const deOtro = { created_by: "vendedor-2", assigned_sales_rep: null, store: "Tienda Norte" };
    expect(ventasVeLaOrden({ ...comun, orden: { ...deOtro, stage: "draft" } })).toBe(true);
    for (const stage of ["pending", "approved", "ready", "delivered"] as const) {
      expect(ventasVeLaOrden({ ...comun, orden: { ...deOtro, stage } }), stage).toBe(false);
    }
    // Y la pantalla sigue llamándola, con el resto de sus cortes donde estaban.
    const lista = leer("src/app/(app)/page.tsx");
    expect(lista).toContain('if (me?.role === "sales" && !ventasVeLaOrden({');
    expect(lista).toContain('if (me?.role === "sales" && d.stage === "canceled") return false;');
  });
});

// ---- Duplicar -----------------------------------------------------------------------------------

const origen = {
  id: "o1", stage: "delivered", order_type: "Customer", store: "Tienda Norte", account: "Cliente",
  contact: "Quien recibe", delivery_phone: "5550001111", assigned_sales_rep: "vendedor-1",
  po2: "PO-1", so_num: "SO-1", invoice_num: "INV-1", estimate_num: null,
  est_pallets: 4, delivery_fee: 120, actual_pallets: 4,
  pickup_name: "Tienda Norte", pickup_address: "100 Norte", pickup_duration: 20,
  delivery_name: "Obra", delivery_address: "9 Obra Ln", delivery_duration: 30,
  delivery_lat: 26.1, delivery_lng: -98.2, delivery_pin_source: "manual",
  route_miles: 12, route_duration: "25 min", route_provider: "google", route_traffic: "light",
  delivery_date: "2026-09-10", delivery_windows: "0900-1100",
  delivery_notes: "nota vieja", role_notes: [{ id: "n1" }],
  assigned_driver: "Chofer", pod_signature: "firma", order_suffix: "a", redelivery_of: "otra",
} as unknown as Delivery;

describe("duplicar copia lo que hace falta", () => {
  const copia = borradorDuplicado(origen, "2026-09-17");

  it("lo que se perdía y ahora viaja: tarifa, pin, nombre de destino y a quién pertenece", () => {
    expect(copia.delivery_fee).toBe(120);
    expect([copia.delivery_lat, copia.delivery_lng, copia.delivery_pin_source]).toEqual([26.1, -98.2, "manual"]);
    expect(copia.delivery_name).toBe("Obra");
    expect(copia.assigned_sales_rep).toBe("vendedor-1");
  });

  it("nace borrador, con la fecha de hoy y la misma ventana", () => {
    expect(copia.stage).toBe("draft");
    expect(copia.delivery_date).toBe("2026-09-17");
    expect(copia.delivery_windows).toBe("0900-1100");
  });

  it("la factura no se copia; el PO y el SO sí, que suelen ser el mismo pedido", () => {
    expect(copia.invoice_num).toBeNull();
    expect(copia.po2).toBe("PO-1");
    expect(copia.so_num).toBe("SO-1");
  });

  it("no se lleva notas ni nada del flujo, el almacén o la re-entrega", () => {
    for (const campo of [
      "delivery_notes", "role_notes", "actual_pallets", "assigned_driver", "pod_signature",
      "order_suffix", "redelivery_of", "id",
    ] as const) {
      expect([campo, campo in copia]).toEqual([campo, false]);
    }
  });
});

describe("la ficha, al duplicar", () => {
  const modal = leer("src/components/OrderModal.tsx");

  it("arma la copia con la función compartida", () => {
    expect(modal).toContain("const payload: Draft = borradorDuplicado(existing, todayISO());");
  });

  it("avisa si la copia choca con una orden que ya existe, y deja seguir", () => {
    const tramo = modal.slice(modal.indexOf("const duplicate = async"), modal.indexOf("const row = await addDelivery(payload);", modal.indexOf("const duplicate = async")));
    expect(tramo).toContain("const choca = duplicateOf(payload);");
    expect(tramo).toContain("await confirmAction(");
    // El aviso vive aquí, no en `passesChecks`, que es el camino de enviar. Sin comentarios: el
    // porqué sí lo nombra, y mirarlo con ellos mediría el comentario.
    const codigo = tramo.split(SALTO).filter((l) => !l.trim().startsWith("//")).join(SALTO);
    expect(codigo).not.toContain("passesChecks");
  });

  it("y la ficha se queda abierta enseñando la copia, en vez de cerrarse", () => {
    const tramo = modal.slice(modal.indexOf("const duplicate = async"), modal.indexOf("// ---- Saved pickup"));
    expect(tramo).toContain("setCopia(row);");
    expect(tramo).not.toContain("onClose();");
    expect(modal).toContain("const existing = copia ?? abiertaPorLaLista;");
  });
});
