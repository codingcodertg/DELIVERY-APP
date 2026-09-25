import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisoDeFacturaEnOtraOrden, escrituraDeAgregarMaterial, ETAPAS_AGREGA_MATERIAL, facturasDeLaOrden,
  MAX_FACTURAS_EXTRA, MAX_LARGO_FACTURA, notaDeAgregarMaterial, problemaDeFactura, puedeAgregarMaterial,
} from "./agregar-material";
import { mkDelivery } from "./__fixtures";
import type { Delivery, Profile, Stage } from "./types";

/**
 * Ventas agrega material a una orden ya hecha (D-339).
 *
 * Un vendedor: *«a veces agendo un Delivery pero luego el cliente me solicita más material… no voy
 * a poder editar sino que voy a poder agregar más facturas e incrementar # de Pallets»*.
 *
 * Números de factura inventados: los de verdad son datos del dueño y no se afirman en el repo.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const SQL = leer("supabase/migrations/138_agregar_material.sql");

const YO: Pick<Profile, "id" | "role"> = { id: "u-vend", role: "sales" };
const orden = (extra: Partial<Delivery> = {}) => mkDelivery({
  id: "o1", stage: "approved", created_by: "u-vend", invoice_num: "F-1", est_pallets: 4, ...extra,
});

describe("todas las facturas de una orden", () => {
  it("la de siempre primero y las añadidas detrás", () => {
    expect(facturasDeLaOrden(orden({ invoices_extra: ["F-2", "F-3"] }))).toEqual(["F-1", "F-2", "F-3"]);
  });

  it("sin la columna, o vacía, es la de siempre y ya", () => {
    expect(facturasDeLaOrden(orden({ invoices_extra: null }))).toEqual(["F-1"]);
    expect(facturasDeLaOrden(orden({ invoices_extra: [] }))).toEqual(["F-1"]);
    expect(facturasDeLaOrden(orden({ invoice_num: null }))).toEqual([]);
  });

  it("no repite la misma escrita de dos formas, y quita los blancos", () => {
    // `#f-1` es la misma que `F-1`, que ya está la primera, así que se cae; el blanco también.
    expect(facturasDeLaOrden(orden({ invoices_extra: [" #f-1 ", "  ", "F-2"] }))).toEqual(["F-1", "F-2"]);
  });

  it("y NO parte lo que alguien metió a mano con comas: lo enseña tal cual", () => {
    // Medido en producción el 2026-09-19: 15 órdenes ya llevan varios números en `invoice_num` con
    // separadores. No se migran ni se adivinan — partirlas inventaría datos.
    expect(facturasDeLaOrden(orden({ invoice_num: "F-1, F-9" }))).toEqual(["F-1, F-9"]);
  });
});

describe("quién puede agregar material, y cuándo", () => {
  it("el dueño de la orden, en las tres etapas", () => {
    for (const stage of ETAPAS_AGREGA_MATERIAL) {
      expect([stage, puedeAgregarMaterial(YO, orden({ stage }))]).toEqual([stage, true]);
    }
  });

  it("también si se la asignaron a él aunque la creara otro", () => {
    expect(puedeAgregarMaterial(YO, orden({ created_by: "u-office", assigned_sales_rep: "u-vend" }))).toBe(true);
  });

  it("la de otro vendedor, no", () => {
    expect(puedeAgregarMaterial(YO, orden({ created_by: "u-otro" }))).toBe(false);
  });

  it("desde `ready` en adelante, no: ahí manda `actual_pallets` y el estimado ya no mueve nada", () => {
    for (const stage of ["ready", "picked_up", "delivered", "canceled", "draft", "rejected"] as Stage[]) {
      expect([stage, puedeAgregarMaterial(YO, orden({ stage }))]).toEqual([stage, false]);
    }
  });

  it("y ningún otro rol, por mucho que la orden sea suya", () => {
    for (const role of ["admin", "manager", "accounting", "warehouse", "driver", "logistics"] as const) {
      expect([role, puedeAgregarMaterial({ id: "u-vend", role }, orden())]).toEqual([role, false]);
    }
    expect(puedeAgregarMaterial(null, orden())).toBe(false);
  });
});

describe("qué factura se puede añadir", () => {
  it("una nueva, sí", () => {
    expect(problemaDeFactura("F-9", orden())).toBeNull();
  });

  it("vacía no, y demasiado larga tampoco", () => {
    expect(problemaDeFactura("   ", orden())).toBe("vacia");
    expect(problemaDeFactura("X".repeat(MAX_LARGO_FACTURA + 1), orden())).toBe("larga");
    expect(problemaDeFactura("X".repeat(MAX_LARGO_FACTURA), orden())).toBeNull();
  });

  it("repetida en ESTA orden, no — ni la de siempre ni una añadida, ni escrita de otra forma", () => {
    expect(problemaDeFactura("F-1", orden())).toBe("repetida");
    expect(problemaDeFactura(" #f-1 ", orden())).toBe("repetida");
    expect(problemaDeFactura("F-2", orden({ invoices_extra: ["F-2"] }))).toBe("repetida");
  });

  it("y con el tope lleno, no cabe otra", () => {
    const llena = orden({ invoices_extra: Array.from({ length: MAX_FACTURAS_EXTRA }, (_, i) => `F-${i + 10}`) });
    expect(problemaDeFactura("F-99", llena)).toBe("tope");
  });
});

describe("que el número esté en OTRA orden avisa, pero no impide", () => {
  const otras = [
    orden({ id: "o2", order_no: 7, invoice_num: "F-7" }),
    orden({ id: "o3", order_no: 9, invoice_num: null, invoices_extra: ["F-8"] }),
    orden({ id: "o4", order_no: 11, stage: "canceled", invoice_num: "F-5" }),
  ];

  it("la encuentra, mire donde mire la factura", () => {
    expect(avisoDeFacturaEnOtraOrden(otras, "F-7", "o1")?.id).toBe("o2");
    expect(avisoDeFacturaEnOtraOrden(otras, "f-8", "o1")?.id).toBe("o3");
  });

  it("una anulada no cuenta, ni la orden que se está editando", () => {
    expect(avisoDeFacturaEnOtraOrden(otras, "F-5", "o1")).toBeNull();
    expect(avisoDeFacturaEnOtraOrden([orden({ id: "o1", order_no: 3 })], "F-1", "o1")).toBeNull();
  });

  it("y NO es un problema: se puede guardar igual", () => {
    // Es la decisión: cuando un cliente pide más material lo normal es que la factura nueva sea
    // suya. Lo que sí para el guardado es repetirla en la MISMA orden.
    expect(problemaDeFactura("F-7", orden())).toBeNull();
  });
});

describe("lo que se escribe: una sola actualización", () => {
  const minutos = { minutosRecogida: 10, minutosEntrega: 15 };

  it("la factura se AÑADE al final, sin tocar lo que ya estaba", () => {
    const p = escrituraDeAgregarMaterial({ pedido: orden({ invoices_extra: ["F-2"] }), factura: "F-3", pallets: null, ...minutos });
    expect(p).toEqual({ invoices_extra: ["F-2", "F-3"] });
  });

  it("los pallets y las duraciones van juntos, y las duraciones salen de los pallets NUEVOS", () => {
    // Si no viajaran en la misma escritura, el plan de ruta se quedaría con los tiempos de antes.
    const p = escrituraDeAgregarMaterial({ pedido: orden(), factura: "", pallets: 6, ...minutos });
    expect(p).toEqual({ est_pallets: 6, pickup_duration: "60 min", delivery_duration: "90 min" });
  });

  it("las dos cosas a la vez, en un solo parche", () => {
    const p = escrituraDeAgregarMaterial({ pedido: orden(), factura: "F-9", pallets: 6, ...minutos });
    expect(Object.keys(p ?? {}).sort()).toEqual(["delivery_duration", "est_pallets", "invoices_extra", "pickup_duration"]);
  });

  it("bajar los pallets no escribe pallets, y no subirlos tampoco", () => {
    expect(escrituraDeAgregarMaterial({ pedido: orden(), factura: "F-9", pallets: 2, ...minutos })).toEqual({ invoices_extra: ["F-9"] });
    expect(escrituraDeAgregarMaterial({ pedido: orden(), factura: "F-9", pallets: 4, ...minutos })).toEqual({ invoices_extra: ["F-9"] });
  });

  it("sin nada que agregar no se escribe nada", () => {
    expect(escrituraDeAgregarMaterial({ pedido: orden(), factura: "  ", pallets: 4, ...minutos })).toBeNull();
    expect(escrituraDeAgregarMaterial({ pedido: orden(), factura: "", pallets: null, ...minutos })).toBeNull();
  });

  it("y NUNCA toca `invoice_num`, ni la etapa, ni nada más", () => {
    const p = escrituraDeAgregarMaterial({ pedido: orden(), factura: "F-9", pallets: 6, ...minutos })!;
    for (const prohibido of ["invoice_num", "stage", "delivery_fee", "delivery_address", "actual_pallets", "delivery_date"]) {
      expect(Object.keys(p), prohibido).not.toContain(prohibido);
    }
  });
});

describe("la nota que queda en el historial", () => {
  it("dice qué se agregó y DESDE qué número, en los dos idiomas", () => {
    const args = { factura: "F-9", palletsAntes: 4, palletsDespues: 6 };
    expect(notaDeAgregarMaterial({ ...args, lang: "es" })).toBe("Ventas agregó la factura F-9 y subió los pallets de 4 a 6");
    expect(notaDeAgregarMaterial({ ...args, lang: "en" })).toBe("Sales added invoice F-9 and raised pallets from 4 to 6");
  });

  it("solo una de las dos cosas, sin la «y» colgando", () => {
    expect(notaDeAgregarMaterial({ factura: "F-9", palletsAntes: 4, palletsDespues: 4, lang: "es" })).toBe("Ventas agregó la factura F-9");
    expect(notaDeAgregarMaterial({ factura: "", palletsAntes: 4, palletsDespues: 6, lang: "es" })).toBe("Ventas subió los pallets de 4 a 6");
  });

  it("y sin nada, no hay nota", () => {
    expect(notaDeAgregarMaterial({ factura: "", palletsAntes: 4, palletsDespues: 4, lang: "es" })).toBe("");
  });
});

describe("la 138 dice lo mismo que el código", () => {
  const vivo = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("es la definición VIGENTE del guard, y parte de la 127", () => {
    const dir = "supabase/migrations";
    const conGuard = readdirSync(join(process.cwd(), dir))
      .filter((f) => f.endsWith(".sql") && leer(`${dir}/${f}`).includes("function public.guard_delivery_stage"))
      .sort();
    // La 145 (D-397, el gerente hace bodega) es ahora la última que lo define; parte de la 142 (D-377), que
    // partía de la 139 (D-361), que partía de la 138.
    expect(conGuard.at(-1)).toBe("145_gerente_hace_bodega.sql");
    expect(conGuard.at(-2)).toBe("142_deshacer_almacen_y_borrar_borradores.sql");
    expect(conGuard.at(-3)).toBe("139_office_entrega_y_deshace.sql");
    expect(conGuard.at(-4)).toBe("138_agregar_material.sql");
    // Y la vigente sigue llevando el bloque de la 138, tal cual: `create or replace` reemplaza la función ENTERA.
    const vigente = plano(leer(`${dir}/${conGuard.at(-1)}`).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"));
    expect(vigente).toContain(`coalesce(array_length(NEW.invoices_extra, 1), 0) <= ${MAX_FACTURAS_EXTRA} and`);
    expect(vigente).toContain("old_stage in ('pending','approved','fulfilling')");
  });

  it("no se perdió nada de la 127, la 125, la 123 ni la 122", () => {
    // `create or replace` reemplaza la función ENTERA.
    expect(plano(vivo)).toContain("or (old_stage in ('draft','rejected') and new_stage = 'approved')");  // 127
    expect(plano(vivo)).toContain("probe.invoice_num := OLD.invoice_num;");                              // 125
    expect(plano(vivo)).toContain("public.account_requires_approval(NEW.account)");                      // 123
    expect(plano(vivo)).toContain("A delivered order is not canceled");                                  // 122
  });

  it("las etapas son las MISMAS que ofrece la pantalla", () => {
    // Dos listas distintas son un botón que la base rechaza, o un permiso que nadie usa.
    const enSql = /old_stage in \('pending','approved','fulfilling'\)/.test(plano(vivo));
    expect(enSql, "el bloque de la 138 no lleva las tres etapas").toBe(true);
    expect([...ETAPAS_AGREGA_MATERIAL]).toEqual(["pending", "approved", "fulfilling"]);
  });

  it("y los topes también son los mismos", () => {
    // La cláusula ENTERA, no el fragmento: `"<= 2000"` contiene `"<= 20"`, así que un tope inflado
    // pasaba un `toContain` corto. Medido con ese mutante.
    expect(plano(vivo)).toContain(`coalesce(array_length(NEW.invoices_extra, 1), 0) <= ${MAX_FACTURAS_EXTRA} and`);
    expect(plano(vivo)).toContain(`length(btrim(x)) > ${MAX_LARGO_FACTURA})`);
  });

  it("solo deja crecer, y con el prefijo intacto", () => {
    expect(plano(vivo)).toContain("coalesce(array_length(NEW.invoices_extra, 1), 0) >= coalesce(array_length(OLD.invoices_extra, 1), 0)");
    expect(plano(vivo)).toContain("is not distinct from coalesce(OLD.invoices_extra, '{}'::text[])");
    expect(plano(vivo)).toContain("coalesce(NEW.est_pallets, 0) >= coalesce(OLD.est_pallets, 0)");
  });

  it("y el `probe` deja pasar exactamente cuatro columnas, ni una más", () => {
    // Es lo que hace que esto no sea «ventas puede editar su orden». Si aparece una quinta, el
    // permiso dejó de ser el que dice la entrada.
    const bloque = plano(vivo).slice(plano(vivo).indexOf("if r = 'sales' and old_stage in ('pending','approved','fulfilling')"));
    const hasta = bloque.slice(0, bloque.indexOf("if probe is not distinct from OLD then return NEW; end if;"));
    const columnas = [...hasta.matchAll(/probe\.(\w+)\s*:=/g)].map((m) => m[1]).sort();
    expect(columnas).toEqual(["delivery_duration", "est_pallets", "invoices_extra", "pickup_duration", "updated_at"].sort());
  });

  it("la columna nace `not null default '{}'`, y no lleva transacción propia", () => {
    expect(plano(vivo)).toContain("add column if not exists invoices_extra text[] not null default '{}'::text[]");
    expect(vivo).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("trae los quince casos del ensayo y se inscribe", () => {
    for (const caso of ["-- 0. Control", "-- 4. BAJAR los pallets", "-- 5. QUITAR una factura",
      "-- 10. En una orden en 'ready'", "-- 13. El tope", "-- 15. El camino de la 125 sigue vivo"]) {
      expect(SQL, caso).toContain(caso);
    }
    expect(SQL).toContain("-- @ledger-below");
    expect(SQL).toContain("values ('138_agregar_material.sql'");
  });
});

describe("la pantalla llama a la regla, no la copia", () => {
  const modal = plano(leer("src/components/OrderModal.tsx"));

  it("el botón sale de `puedeAgregarMaterial`, no de una condición escrita a mano", () => {
    expect(modal).toContain("if (puedeAgregarMaterial(me, pedido)) {");
    expect(modal).toContain('btns.push(<button key="material"');
  });

  it("y lo que se guarda sale de `escrituraDeAgregarMaterial`, en UNA llamada", () => {
    const guardar = modal.slice(modal.indexOf("const guardarMaterial = async"), modal.indexOf("* Volver de «listo» a «preparando»"));
    expect(guardar).toContain("escrituraDeAgregarMaterial({");
    expect(guardar).toContain("agregarMaterial(existing.id, parche, notaDeAgregarMaterial({");
    // Una sola escritura: si hubiera dos, un fallo entre medias dejaría la factura sin los pallets.
    expect((guardar.match(/agregarMaterial\(/g) ?? []).length).toBe(1);
  });

  it("el proveedor escribe con `.select(\"id\")`, o un 0 filas de la RLS pasaría por guardado", () => {
    // Es la lección de D-310: PostgREST devuelve sin error cuando la política no deja ninguna fila.
    const prov = plano(leer("src/lib/data-provider.tsx"));
    const m = prov.slice(prov.indexOf("const agregarMaterial = useCallback"), prov.indexOf("// Renumber a route's stops"));
    expect(m).toContain('.update(parche).eq("id", id).select("id")');
    expect(m).toContain("falloAlGuardarDocumento(error, data)");
  });

  it("y avisa a almacén SOLO cuando ya la agarró", () => {
    const prov = plano(leer("src/lib/data-provider.tsx"));
    const m = prov.slice(prov.indexOf("const agregarMaterial = useCallback"), prov.indexOf("// Renumber a route's stops"));
    expect(m).toContain('if (antes?.stage === "fulfilling")');
    expect(m).toContain('kind: "material_added"');
    // Sin SMS ni correo: esto es la campana y nada más.
    expect(m).not.toContain("/api/notify");
  });
});

describe("quién enseña todas las facturas y quién sigue con `invoice_num`", () => {
  it("las enseñan los que sirven para PREPARAR o ENTREGAR", () => {
    for (const f of ["src/lib/slip.ts", "src/lib/manifest.ts", "src/app/(app)/my-route/page.tsx", "src/components/OrderModal.tsx"]) {
      expect(leer(f), f).toContain("facturasDeLaOrden");
    }
  });

  it("y la búsqueda encuentra una añadida", () => {
    expect(plano(leer("src/lib/ordenes-visibles.ts"))).toContain("...facturasDeLaOrden(d)");
  });

  it("pero la tabla, el documento del tipo y la factura pendiente siguen con `invoice_num`", () => {
    // A propósito: cambiar ahí movería lo que significa «la factura de la orden» para la columna,
    // el agrupado, la regla del documento y la pestaña de D-338.
    for (const f of ["src/components/OrdersTable.tsx", "src/lib/order-document.ts", "src/lib/documento-pendiente.ts"]) {
      expect(leer(f), f).not.toContain("facturasDeLaOrden");
    }
  });
});
