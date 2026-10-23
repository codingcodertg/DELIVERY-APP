import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ETAPAS_QUE_REPROGRAMA_ALMACEN, fechaPropuesta, notaDeReprogramacion, puedeReprogramar, reprogramacionValida } from "./reprogramar-orden";

describe("«📅 Reprogramar» en el Gestor (D-500)", () => {
  it("quién puede: logística, gerente y oficina en las etapas abiertas; admin también en camino; nadie en entregada o anulada", () => {
    for (const rol of ["logistics", "manager", "accounting"]) {
      for (const etapa of ["draft", "pending", "approved", "fulfilling", "ready"]) expect([rol, etapa, puedeReprogramar(rol, etapa)]).toEqual([rol, etapa, true]);
      expect(puedeReprogramar(rol, "picked_up")).toBe(false);
    }
    expect(puedeReprogramar("admin", "picked_up")).toBe(true);
    for (const rol of ["admin", "logistics"]) {
      expect(puedeReprogramar(rol, "delivered")).toBe(false);
      expect(puedeReprogramar(rol, "canceled")).toBe(false);
    }
    // Nota D-549: ventas reprograma SU orden (tercer argumento, `esSuya`); sin decir que es suya, sigue en no.
    expect(puedeReprogramar("sales", "approved")).toBe(false);
    expect(puedeReprogramar("sales", "approved", true)).toBe(true);
    expect(puedeReprogramar("driver", "ready")).toBe(false);
    expect(puedeReprogramar("driver", "ready", true)).toBe(false);
    expect(puedeReprogramar("logistics", null)).toBe(false);
  });
  // D-534 · «warehouse as an option to rescheduled and or change delivery dates» (el dueño, 2026-10-12).
  it("D-534: almacén reprograma en aprobada, preparando y lista (su cola, donde el guard le deja escribir); no en las demás", () => {
    for (const etapa of ["approved", "fulfilling", "ready"]) expect([etapa, puedeReprogramar("warehouse", etapa)]).toEqual([etapa, true]);
    for (const etapa of ["draft", "pending", "rejected", "picked_up", "delivered", "canceled"]) expect([etapa, puedeReprogramar("warehouse", etapa)]).toEqual([etapa, false]);
    expect(ETAPAS_QUE_REPROGRAMA_ALMACEN).toEqual(["approved", "fulfilling", "ready"]);
    // Y la base se lo permite: la rama de almacén del guard deja la misma etapa en esas tres.
    const guard = readFileSync("supabase/migrations/169_fotos_del_chofer.sql", "utf8");
    expect(guard).toContain("if r = 'warehouse'  and old_stage in ('approved','fulfilling','ready','picked_up','delivered') then return NEW; end if;");
  });
  it("D-534: Almacén monta el MISMO cuadro del Gestor en la Cola, en Recepción y en la Ruta del día, sin abrir la ficha", () => {
    const wh = readFileSync("src/app/(app)/warehouse/page.tsx", "utf8").split("\r\n").join("\n");
    expect(wh).toContain('import { ReprogramarOrden } from "@/components/ReprogramarOrden";');
    expect(wh).toContain("const reprogramar = (d: Delivery) => puedeReprogramar(me?.role, d.stage)");
    // Nota D-549: el cuadro ya no recibe `updateDelivery`/`addNote` sino `reprogramarOrden` (la función de la base 173, con
    // el camino de antes como respaldo).
    // Nota D-572: en las filas va `compacto` (solo el icono 📅, junto a la factura).
    expect(wh).toContain("<ReprogramarOrden pedido={d} rol={me?.role} lang={lang} t={t} reprogramarOrden={reprogramarOrden} notify={notify} compacto />");
    expect(wh.split("accionDeFila={reprogramar}").length - 1).toBe(1);
    expect(wh).toContain("const repro = reprogramar(d);");
    expect(wh).toContain("<td onClick={(e) => e.stopPropagation()}>{reprogramar(d)}</td>");
  });

  it("la fecha que propone: el día siguiente al más tarde entre hoy y la que tiene", () => {
    expect(fechaPropuesta("2026-10-05", "2026-10-08")).toBe("2026-10-09");
    expect(fechaPropuesta("2026-10-12", "2026-10-08")).toBe("2026-10-13");
    expect(fechaPropuesta(null, "2026-10-08")).toBe("2026-10-09");
  });

  it("se guarda con fecha válida, no antes de hoy, distinta de la actual y con nota", () => {
    expect(reprogramacionValida("2026-10-09", "2026-10-08", "2026-10-08", "cliente no está")).toBe(true);
    expect(reprogramacionValida("2026-10-07", "2026-10-05", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-08", "2026-10-08", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-09", "2026-10-08", "2026-10-08", " x ")).toBe(false);
    expect(reprogramacionValida("", "2026-10-08", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-08", null, "2026-10-08", "sin fecha antes")).toBe(true);
  });

  it("la nota del historial dice de dónde a dónde y por qué", () => {
    expect(notaDeReprogramacion("2026-10-08", "2026-10-09", "  cliente   no está ", "es")).toBe("Reprogramada de 2026-10-08 a 2026-10-09: cliente no está");
    expect(notaDeReprogramacion(null, "2026-10-09", "site closed", "en")).toBe("Rescheduled from no date to 2026-10-09: site closed");
  });

  it("la tabla del Gestor lleva el botón en las filas que se pueden reprogramar, y no en solo lectura", () => {
    const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8");
    expect(pagina).toContain("{!hecha && !soloLectura && puedeReprogramar(me?.role, d.stage) && (");
    expect(pagina).toContain("<ReprogramarOrden pedido={d}");
  });
  // D-574: el dueño, «Calendar button needs to be on Invoice column instead of Assign to column. Its making the row bigger
  // so it needs to be on the same line».
  it("D-574 · en el Gestor el 📅 va en la celda de la factura, en línea, y ya no en «Asignar a»", () => {
    const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8").split("\r\n").join("\n");
    const celda = pagina.indexOf('if (c.key === "invoice") return (');
    expect(celda).toBeGreaterThan(0);
    const cuerpo = pagina.slice(celda, pagina.indexOf("</td>", celda));
    expect(cuerpo).toContain("{facturaConSuId(d)}");
    expect(cuerpo).toContain('<span className="accion-de-fila" onClick={(e) => e.stopPropagation()}>');
    expect(cuerpo).toContain("<ReprogramarOrden pedido={d} rol={me?.role} lang={lang} t={t} reprogramarOrden={reprogramarOrden} notify={notify} compacto />");
    // En la tabla de órdenes, una sola vez: la de «Asignar a» se fue. (D-592 añade las de la tabla de paradas, abajo.)
    const tablaDeOrdenes = pagina.slice(0, pagina.indexOf("tabla-de-paradas"));
    expect(tablaDeOrdenes.split("<ReprogramarOrden pedido={d}").length - 1).toBe(1);
  });
  // D-592: el dueño, «Route Manager view needs the calendar icon to reschedule»: la tabla de PARADAS (la vista por chofer
  // del Gestor) no lo tenía; solo la tabla de órdenes de D-574.
  it("D-592 · en la tabla de paradas el 📅 va junto a cada factura: en la fila P (una por orden recogida), en la D y en la D de otra carga", () => {
    const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8").split("\r\n").join("\n");
    const paradas = pagina.slice(pagina.indexOf("tabla-de-paradas"));
    expect(paradas).toContain("{facturaConSuId(x)}{iconoDeReprogramar(x)}");
    expect(paradas.split("{facturaConSuId(d)}{iconoDeReprogramar(d)}").length - 1).toBe(2);
    // La función, una sola, con la misma condición que la tabla de órdenes y dentro de un `.accion-de-fila` que no deja que
    // el clic seleccione la fila. (Una función y no JSX inline: el type-check del build de Vercel se quedaba sin memoria.)
    const fn = pagina.slice(pagina.indexOf("const iconoDeReprogramar = (o: Delivery): React.ReactNode =>"), pagina.indexOf("const facturaConSuId = (d: Delivery) => {"));
    expect(fn).toContain("!ETAPAS_HECHAS.has(o.stage) && !soloLectura && puedeReprogramar(me?.role, o.stage) ? (");
    expect(fn).toContain('<span className="accion-de-fila" onClick={(e) => e.stopPropagation()}>');
    expect(fn).toContain("<ReprogramarOrden pedido={o} rol={me?.role} lang={lang} t={t} reprogramarOrden={reprogramarOrden} notify={notify} compacto />");
    expect(fn).toContain(") : null;");
  });
});

describe("D-572 · en las filas, solo el icono 📅 junto al número de factura", () => {
  const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
  it("el cuadro tiene cara compacta: el mismo data-reprogramar, sin texto, con aria-label", () => {
    const c = leer("src/components/ReprogramarOrden.tsx");
    expect(c).toContain("compacto?: boolean;");
    expect(c).toContain('<button type="button" className="btn-icono-fila" data-reprogramar={pedido.id} onClick={abrir}');
    expect(c).toContain('aria-label={t("Reschedule", "Reprogramar")}');
    // Solo el icono: el cuerpo del botón compacto es «📅» y nada más (sin el texto «Reschedule»).
    const i = c.indexOf('className="btn-icono-fila"');
    const cuerpo = c.slice(i, c.indexOf("</button>", i));
    // lo que hay entre el cierre de la etiqueta y </button> es el icono, y nada más
    expect(cuerpo.slice(cuerpo.lastIndexOf(">") + 1).trim()).toBe("📅");
  });
  it("las filas de Almacén y del Gestor piden la cara compacta; la ficha conserva el botón con texto", () => {
    expect(leer("src/app/(app)/warehouse/page.tsx")).toContain("notify={notify} compacto />");
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("notify={notify} compacto />");
    expect(leer("src/components/OrderModal.tsx")).toContain("<ReprogramarOrden pedido={existing} rol={me.role} lang={lang} t={t} reprogramarOrden={reprogramarOrden} notify={notify} />");
  });
  it("la tabla pinta la acción EN LÍNEA con la factura, en las dos caras de la celda, y ya no debajo", () => {
    const tabla = leer("src/components/OrdersTable.tsx");
    const i = tabla.indexOf('<span className="inv-short">');
    expect(i).toBeGreaterThan(0);
    expect(tabla.slice(i, i + 400)).toContain("{accionEnLinea}");
    expect(tabla).toContain("#{orderLabel(d)}\n            {accionEnLinea}");
    expect(tabla).not.toContain("const accion = accionDeFila(d);");
    const css = leer("src/app/globals.css");
    expect(css).toMatch(/\.accion-de-fila \{ display: inline-flex;/);
    expect(css).toContain(".btn-icono-fila {");
  });
});
