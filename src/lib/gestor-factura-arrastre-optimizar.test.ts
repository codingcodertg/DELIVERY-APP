import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { facturaYId, facturaYIdDeLaOrden } from "./route-plan/etiqueta";
import { COLUMNAS_DEL_GESTOR, FACTURA_DEL_PLAN, columnasDeLaTabla, columnasDelSelector, sinLaFacturaDelPlan, COLUMNAS_DEL_GESTOR_POR_DEFECTO } from "./routes-columns";
import { cambiosDeLaLista, cuentaDePallets, listaConOrdenesEn, llevaEnLaLista, mueveEnLaLista, ordenSinRecoger, type ParadaDeLaLista } from "./lista-unica";
import { optimizaLaLista } from "./optimiza-la-ruta";
import { haversineMi } from "./route-batching";
import { FACTOR_DE_RODEO } from "./route-times/proveedores";
import { MEDIDA_FALLIDA, siguienteMedida, textoDeLaLlegada } from "./medida-de-ruta";

/**
 * D-456. El dueño, 2026-10-01: «It's not showing invoice number / Invoice number is more important / When trying to build
 * the routes manually do the drag option / […] / When doing routes manually it assigned to him but it doesn't optimize have
 * the optimize option for every route when selecting a driver and optimize it», «not showing invoice en el logistic manager
 * en todas las tablas», y «el eta estimado en el logistic manager, quiero que muestre el eta siempre que aveces no aparece».
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
const trozo = (desde: string, hasta: string, de = pagina) => {
  const i = de.indexOf(desde);
  expect(i, desde).toBeGreaterThan(-1);
  const j = de.indexOf(hasta, i + desde.length);
  expect(j, hasta).toBeGreaterThan(i);
  return de.slice(i, j);
};

const P = (id: string, tienda: string | null = "RDZ Pharr"): ParadaDeLaLista => ({ tipo: "P", ordenes: [id], tienda });
const D = (id: string): ParadaDeLaLista => ({ tipo: "D", orden: id });
const forma = (l: readonly ParadaDeLaLista[]) => l.map((p) => (p.tipo === "P" ? `P${p.ordenes.join("+")}` : `D${p.orden}`)).join(" ");

// =====================================================================================================================
describe("1 · la FACTURA nombra la orden en todas las tablas del Gestor, con el ID al lado", () => {
  const conFactura = { order_no: 515, order_code: "FS515", order_suffix: null, invoice_num: " 170032 " };
  const sinFactura = { order_no: 77, order_code: "IT77", order_suffix: null, invoice_num: "  " };

  it("con factura: la factura es lo principal y el ID va al lado; sin factura: el ID, en gris, y nada al lado", () => {
    expect(facturaYId(conFactura)).toEqual({ principal: "170032", id: "#FS515", esFactura: true });
    expect(facturaYId(sinFactura)).toEqual({ principal: "#IT77", id: null, esFactura: false });
    expect(facturaYId({ order_no: 9, invoice_num: null })).toEqual({ principal: "#9", id: null, esFactura: false });
  });
  it("desde una referencia del plan: la de una carga (`id#b`) es su orden; una que ya no está, el principio de su referencia", () => {
    const ordenes = [{ id: "abc", ...conFactura }];
    expect(facturaYIdDeLaOrden(ordenes, "abc#b")).toEqual({ principal: "170032", id: "#FS515", esFactura: true });
    expect(facturaYIdDeLaOrden(ordenes, "zzzzzzzzzzzz")).toEqual({ principal: "zzzzzzzz", id: null, esFactura: false });
  });
  it("la tabla de PARADAS de cada chofer pinta la factura (que abre la orden) y el ID debajo; sin factura, el ID en gris", () => {
    const celda = trozo("const facturaConSuId = (d: Delivery) => {", "// ---- Las cargas de una orden");
    expect(celda).toContain("const n = facturaYId(d);");
    expect(celda).toContain("<span {...gesto} data-abre-la-orden data-factura={n.esFactura ? \"\" : undefined}");
    expect(celda).toContain("{n.principal}</span>");
    // D-459: el ID al lado, en la misma línea (`.factura-e-id`); D-456 lo ponía debajo.
    expect(celda).toContain("{n.id && <span data-id-de-la-orden title={n.id}>{n.id}</span>}");
    expect(celda).toContain(": { ...gesto.style, color: \"var(--gray)\" }");
    // Las cuatro filas de la tabla la usan: la recogida, la entrega, la entrega de otra carga y, desde D-459, la ya hecha.
    expect(pagina.split("{facturaConSuId(").length - 1).toBe(4);
    expect(pagina).toContain("<th data-columna-factura");
  });
  it("«Sin asignar» ya la tenía fija y sigue: la factura abre la orden y no se puede quitar", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "invoice")).toMatchObject({ fija: true, tablas: ["sinAsignar"] });
    // Aunque la lista guardada de alguien no la traiga, sale.
    expect(columnasDeLaTabla("sinAsignar", ["account", "_v2"]).map((c) => c.key)).toContain("invoice");
    expect(pagina).toContain('c.key === "invoice" ? enlaceALaOrden(d)');
  });
  it("la tabla del PLAN: la columna fija es la factura con el ID debajo, y «Plan: Factura» no se repite ni se lista", () => {
    expect(FACTURA_DEL_PLAN).toBe("pl_invoice");
    // La clave sigue en el catálogo (está guardada en listas y plantillas), pero la pantalla la aparta de la tabla y del ⚙.
    expect(COLUMNAS_DEL_GESTOR.some((c) => c.key === "pl_invoice")).toBe(true);
    const tabla = sinLaFacturaDelPlan(columnasDeLaTabla("plan", COLUMNAS_DEL_GESTOR_POR_DEFECTO)).map((c) => c.key);
    expect(tabla).toEqual(["pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega", "pl_address", "pl_windows"]);
    expect(sinLaFacturaDelPlan(columnasDelSelector("plan", null)).map((c) => c.key)).not.toContain("pl_invoice");
    // Quien la tenía QUITADA de su lista ve la factura igual: va fija, no depende de la lista.
    expect(sinLaFacturaDelPlan(columnasDeLaTabla("plan", ["pl_clase", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", "_v8"])).map((c) => c.key)).toEqual(["pl_clase"]);
    expect(pagina).toContain('lista: sinLaFacturaDelPlan(columnasDeLaTabla("plan", colsGestor, ordenGestor)),');
    expect(pagina).toContain('columnas={sinLaFacturaDelPlan(columnasDelSelector("plan", ordenGestor))}');
    const ruta = plano(leer("src/components/RutaDelPlan.tsx"));
    expect(ruta).toContain("const n = facturaDeOrden(p.order_ref);");
    expect(ruta).toContain("onClick={() => abrirOrden(p.order_ref)}>{n.principal}</button>");
    expect(ruta).toContain("{n.id && <span data-id-de-la-orden title={n.id}>{n.id}</span>}");      // D-459: al lado, no debajo
    expect(plano(leer("src/components/PlanDelDia.tsx"))).toContain("const facturaDeOrden = (id: string) => facturaYIdDeLaOrden(deliveries, id);");
  });
  it("el tablero y la línea de tiempo nombran la orden por su factura", () => {
    const tablero = plano(leer("src/components/DispatchBoard.tsx"));
    expect(tablero).toContain("const n = facturaYId(d);");
    expect(tablero).toContain("{n.principal}</b>");
    expect(tablero).toContain("{n.id && <span className=\"hint\" data-id-de-la-orden");
    expect(tablero).not.toContain("#{orderLabel(d)}");
    const gantt = plano(leer("src/components/GanttTimeline.tsx"));
    expect(gantt).toContain("m.set(d.id, facturaYId(d).principal);");
    expect(gantt).not.toContain("orderLabel(");
  });
});

// =====================================================================================================================
describe("2 · arrastrar para armar rutas a mano", () => {
  // P1 P2 D1 D2
  const lista = [P("1"), P("2"), D("1"), D("2")];

  it("`ordenSinRecoger`: la primera orden cuya entrega va antes que su recogida; ninguna si la lista vale", () => {
    expect(ordenSinRecoger(lista)).toBeNull();
    expect(ordenSinRecoger([P("1"), D("2"), P("2"), D("1")])).toBe("2");
    // Una entrega sin recogida en la lista (histórico) no rompe nada: no hay recogida que adelantar.
    expect(ordenSinRecoger([D("9"), P("1"), D("1")])).toBeNull();
  });
  it("soltar una parada sobre otra fila: toma SU puesto y las de en medio se corren (hacia abajo y hacia arriba)", () => {
    const abajo = llevaEnLaLista(lista, 1, 2); // P2 sobre D1
    expect(abajo.ok && forma(abajo.paradas)).toBe("P1 D1 P2 D2");
    const arriba = llevaEnLaLista([P("1"), D("1"), P("2"), D("2")], 2, 0); // P2 al principio
    expect(arriba.ok && forma(arriba.paradas)).toBe("P2 P1 D1 D2");
    const varios = llevaEnLaLista([P("1"), P("2"), P("3"), D("1"), D("2"), D("3")], 3, 1); // D1 sube dos puestos
    expect(varios.ok && forma(varios.paradas)).toBe("P1 D1 P2 P3 D2 D3");
  });
  it("un puesto es lo mismo que una flecha", () => {
    const flecha = mueveEnLaLista(lista, 1, 1);
    const arrastre = llevaEnLaLista(lista, 1, 2);
    expect(flecha.ok && arrastre.ok && forma(arrastre.paradas) === forma(flecha.paradas)).toBe(true);
  });
  it("no deja una entrega antes que su recogida, salte los puestos que salte, y dice qué orden lo impide", () => {
    expect(llevaEnLaLista(lista, 2, 0)).toEqual({ ok: false, motivo: "precedencia", orden: "1" }); // D1 al principio
    expect(llevaEnLaLista(lista, 0, 3)).toEqual({ ok: false, motivo: "precedencia", orden: "1" }); // P1 al final
    expect(llevaEnLaLista(lista, 1, 3)).toEqual({ ok: false, motivo: "precedencia", orden: "2" }); // P2 tras D2
  });
  it("soltar sobre sí misma o fuera de la lista no es un movimiento", () => {
    for (const [d, a] of [[1, 1], [-1, 0], [0, 4], [4, 0], [0, -1]]) expect(llevaEnLaLista(lista, d, a)).toEqual({ ok: false, motivo: "borde" });
  });
  it("la capacidad NO bloquea el arrastre: lo mueve, y la cuenta avisa en la parada que se pasa", () => {
    // Camión de 5; cada orden, 4 pallets. P1 D1 P2 D2 cabe; arrastrar P2 delante de D1 lleva 8 a bordo.
    const ordenes = [{ id: "1", est_pallets: 4 }, { id: "2", est_pallets: 4 }];
    const r = llevaEnLaLista([P("1"), D("1"), P("2"), D("2")], 2, 1);
    expect(r.ok && forma(r.paradas)).toBe("P1 P2 D1 D2");
    if (!r.ok) return;
    expect(cuentaDePallets(cambiosDeLaLista(r.paradas, ordenes), 5).totales.paradasConExceso).toBe(1);
  });
  it("a la lista de OTRO chofer entra la orden entera —recogida y, pegada detrás, su entrega— en el puesto o al final", () => {
    const suya = [P("1"), D("1")];
    const nueva = [{ id: "7", store: " RDZ McAllen " }];
    expect(forma(listaConOrdenesEn(suya, nueva, null))).toBe("P1 D1 P7 D7");
    expect(forma(listaConOrdenesEn(suya, nueva, 1))).toBe("P1 P7 D7 D1");
    expect(forma(listaConOrdenesEn(suya, nueva, 0))).toBe("P7 D7 P1 D1");
    expect(forma(listaConOrdenesEn(suya, nueva, 99))).toBe("P1 D1 P7 D7");
    expect(listaConOrdenesEn(suya, nueva, null)[2]).toEqual({ tipo: "P", ordenes: ["7"], tienda: "RDZ McAllen" });
    // Nunca rompe la precedencia, y una orden que ya estaba no se repite.
    expect(ordenSinRecoger(listaConOrdenesEn(suya, nueva, 1))).toBeNull();
    expect(forma(listaConOrdenesEn(suya, [{ id: "1" }], 0))).toBe("P1 D1");
  });

  describe("la pantalla", () => {
    const arrastre = trozo("const filaArrastrable = (a: Arrastrado) => {", "// ---- «🧭 Optimizar» una ruta");
    it("la fila entera se arrastra, pero un arrastre que empieza sobre un control se CANCELA (el fallo de D-007 no vuelve)", () => {
      expect(arrastre).toContain("pulsadoEnControl.current = !!(e.target as HTMLElement).closest(\"button, select, input, textarea, a, label, [data-abre-la-orden], .col-resizer\");");
      expect(arrastre).toContain("if (pulsadoEnControl.current) { e.preventDefault(); return; }");
      expect(arrastre).toContain("draggable: true,");
      // Las flechas siguen en su sitio.
      expect(pagina).toContain("onClick={() => void mueveParada(u.key, f.indice!, -1)}");
      expect(pagina).toContain("onClick={() => void mueveParada(u.key, f.indice!, 1)}");
    });
    it("se arrastran las filas de «Sin asignar» y las paradas que también mueven las flechas (una recogida, solo con la 154)", () => {
      expect(pagina).toContain('data-fila-arrastrable="orden" {...filaArrastrable({ tipo: "orden", id: d.id })}>');
      expect(pagina).toContain('const seArrastra = movible && (f.tipo === "D" || hayRecogidaGuardada);');
      expect(pagina).toContain('const arrastre = seArrastra ? filaArrastrable({ tipo: "parada", ruta: u.key, indice: f.indice! }) : {};');
      expect(pagina.split('data-fila-arrastrable={seArrastra ? "parada" : undefined} {...arrastre} {...soltar}').length - 1).toBe(2);
    });
    it("se suelta en la fila del chofer en el panel, en su tarjeta o en una fila de su lista", () => {
      expect(pagina).toContain("data-suelta-en-ruta={u.key} {...sueltaAqui(u.key, null)}");
      expect(pagina).toContain("data-tarjeta-de-ruta={u.key} {...sueltaAqui(u.key, null)}");
      expect(pagina).toContain("const soltar = movible ? sueltaAqui(u.key, f.indice!) : {};");
      expect(arrastre).toContain("onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); void sueltaEnLaRuta(ruta, indice); },");
    });
    it("una fila de «Sin asignar» soltada en un chofer se ASIGNA (y si es una de varias marcadas, todas)", () => {
      expect(arrastre).toContain("if (selectedOrders.has(a.id) && poolSelectedCount > 1) { await bulkAssign(destino); return; }");
      expect(arrastre).toContain("manualAssign(a.id, destino);");
    });
    it("una parada dentro de su lista: decide `llevaEnLaLista`, avisa de la precedencia y de la capacidad, y guarda por `guardaLaLista`", () => {
      expect(arrastre).toContain("const r = llevaEnLaLista(lectura.paradas, a.indice, indice);");
      expect(arrastre).toContain("if (!r.ok) { if (r.motivo === \"precedencia\") avisaDeLaPrecedencia(stops, lectura, r.orden); return; }");
      expect(arrastre).toContain("if (!(await guardaLaLista(destino, stops, r.paradas, {");
      expect(arrastre).toContain("const n = cuentaDePallets(cambiosDeLaLista(lista, suyas), capacityFor(driverOf(ruta))).totales.paradasConExceso;");
      expect(arrastre).toContain("const ex = avisoDeExceso(r.paradas, stops, destino);");
    });
    it("una parada a OTRO chofer: `listaConOrdenesEn`, y `guardaLaLista` la cambia de chofer y apunta las dos rutas para deshacer", () => {
      expect(arrastre).toContain("const lista = listaConOrdenesEn(lecturaDe(destino, suyas).paradas, movidas, indice);");
      expect(arrastre).toContain("}, movidas))) return;");
      const guarda = trozo("const guardaLaLista = async (", "/** La fila de la Base");
      expect(guarda).toContain("traidas: readonly Delivery[] = []): Promise<boolean> => {");
      expect(guarda).toContain("if (!(await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: desde + e.ids.indexOf(d.id), load_no: null,");
      expect(guarda).toContain("for (const d of traidas) despues[d.id] = { ...despues[d.id], assigned_driver: laneKey };");
      expect(guarda).toContain("await anotaMovimiento(etiqueta, [laneKey, ...origenes], antes, despues);");
    });
  });
});

// =====================================================================================================================
// **Reemplazado en parte por D-NEXT** (2026-10-02, el dueño: «sigamos trabajando en el alrgoritmo de optimizar ruta porque sigue
// muy mal ineficente»). El Optimizar de D-456 decidía en LÍNEA RECTA, con el vecino más cercano y un pulido. El de ahora busca
// el mejor orden por calles, mirando las ventanas: sus pruebas están en `optimiza-la-ruta.test.ts` y
// `optimizar-desde-el-gestor.test.ts`. Estas se quedan, puestas al día, porque lo que fijaban sigue valiendo: las mismas
// paradas, la precedencia, la capacidad por delante, la base, y que lo que hay no se toca si ya es lo mejor. Aquí se llama sin
// tiempos por calles, así que las millas son las ESTIMADAS (la línea recta por `FACTOR_DE_RODEO`), no la línea recta a secas.
describe("3 · «🧭 Optimizar» una ruta", () => {
  // Una línea recta hacia el norte desde la base: cuanto mayor la latitud, más lejos.
  const base = { lat: 26.0, lng: -98.0 };
  const en = (lat: number) => ({ lat, lng: -98.0 });
  const optimiza = (paradas: ParadaDeLaLista[], puntos: ({ lat: number; lng: number } | null)[], cambios: (number | null)[], capacidad: number | null = 99, b: typeof base | null = base) =>
    optimizaLaLista({ paradas, puntos, cambios, base: b, capacidad });

  it("reordena para el menor recorrido saliendo de la base: las mismas paradas, ni una más ni una menos", () => {
    // Recoge las dos en la base y entrega primero la LEJANA y luego la cercana y luego otra lejana: zigzag.
    const paradas = [P("1"), P("2"), P("3"), D("1"), D("2"), D("3")];
    const puntos = [en(26.0), en(26.0), en(26.0), en(26.9), en(26.1), en(26.8)];
    const r = optimiza(paradas, puntos, [1, 1, 1, -1, -1, -1]);
    expect(r.cambio).toBe(true);
    expect(r.millasDespues).toBeLessThan(r.millasAntes);
    expect([...r.paradas].map((p) => forma([p])).sort()).toEqual([...paradas].map((p) => forma([p])).sort());
    // Sin zigzag: en una recta, lo mínimo es ir hasta la más lejana y volver (varios órdenes lo consiguen; se mide el recorrido).
    expect(Math.abs(r.millasDespues - 2 * haversineMi(base, en(26.9)) * FACTOR_DE_RODEO)).toBeLessThan(0.11);
    expect(r.millasAntes).toBeGreaterThan(r.millasDespues + 80);
    // Y ahora es el mejor orden que existe, comprobado; y lo dice.
    expect(r.exacta).toBe(true);
    expect(r.medida).toBe("estimada");
    expect(ordenSinRecoger(r.paradas)).toBeNull();
  });
  it("nunca deja una entrega antes que su recogida, aunque así el recorrido fuera más corto", () => {
    // La tienda de la orden 2 está LEJOS y su entrega al lado de la base: lo más corto sería entregar antes de recoger.
    const paradas = [P("1"), D("1"), P("2"), D("2")];
    const puntos = [en(26.0), en(26.5), en(26.9), en(26.05)];
    const r = optimiza(paradas, puntos, [1, -1, 1, -1]);
    expect(ordenSinRecoger(r.paradas)).toBeNull();
    const i = (x: string) => r.paradas.findIndex((p) => forma([p]) === x);
    expect(i("P2")).toBeLessThan(i("D2"));
    expect(i("P1")).toBeLessThan(i("D1"));
  });
  it("la capacidad manda sobre las millas: si la lista de partida no se pasaba, la optimizada tampoco", () => {
    // Camión de 5; cada orden, 4. Lo más corto sería recoger las dos en la tienda de una vez (8 a bordo): no se hace.
    const paradas = [P("1"), D("1"), P("2"), D("2")];
    const puntos = [en(26.0), en(26.9), en(26.0), en(26.8)];
    const libre = optimiza(paradas, puntos, [4, -4, 4, -4], 99);
    expect(libre.cambio).toBe(true);
    expect(forma(libre.paradas).startsWith("P1 P2") || forma(libre.paradas).startsWith("P2 P1")).toBe(true);
    const justo = optimiza(paradas, puntos, [4, -4, 4, -4], 5);
    expect(justo.excesoAntes).toBe(0);
    expect(justo.excesoDespues).toBe(0);
    expect(cuentaDePallets(justo.paradas.map((p) => (p.tipo === "P" ? 4 : -4)), 5).totales.paradasConExceso).toBe(0);
  });
  it("una lista que SE PASA sale con menos exceso, aunque mida más", () => {
    const paradas = [P("1"), P("2"), D("1"), D("2")];
    const puntos = [en(26.0), en(26.0), en(26.9), en(26.8)];
    const r = optimiza(paradas, puntos, [4, 4, -4, -4], 5);
    expect(r.excesoAntes).toBe(3);
    expect(r.excesoDespues).toBe(0);
    expect(r.cambio).toBe(true);
    expect(r.millasDespues).toBeGreaterThan(r.millasAntes);
  });
  it("si ya está en el mejor orden que encuentra, no cambia nada (y no hay nada que guardar)", () => {
    const paradas = [P("1"), P("2"), D("2"), D("1")];
    const puntos = [en(26.0), en(26.0), en(26.1), en(26.9)];
    const r = optimiza(paradas, puntos, [1, 1, -1, -1]);
    expect(r.cambio).toBe(false);
    expect(forma(r.paradas)).toBe(forma(paradas));
    expect(r.millasDespues).toBe(r.millasAntes);
    // Con menos de tres paradas no hay orden que elegir.
    expect(optimiza([P("1"), D("1")], [en(26.0), en(26.5)], [1, -1]).cambio).toBe(false);
  });
  it("mide desde la BASE y de vuelta a ella; sin base, la ruta es abierta: de la primera parada a la última", () => {
    // Base en 26.0; la tienda a medio grado, la entrega a un grado, y vuelta a la tienda. Un grado de latitud ≈ 69 millas.
    const paradas = [P("1"), D("1"), P("2")];
    const puntos = [en(26.5), en(27.0), en(26.5)];
    const con = optimiza(paradas, puntos, [1, -1, 1]);
    const sin = optimiza(paradas, puntos, [1, -1, 1], 99, null);
    // Con base: 0,5 (salir) + 0,5 + 0,5 + 0,5 (volver) = 2 grados ≈ 138 mi en línea recta, 179,6 con el rodeo.
    expect(con.millasAntes).toBeGreaterThan(136 * FACTOR_DE_RODEO);
    expect(con.millasAntes).toBeLessThan(140 * FACTOR_DE_RODEO);
    // Sin base: solo 0,5 + 0,5 = 1 grado ≈ 69 mi en línea recta.
    expect(sin.millasAntes).toBeGreaterThan(67 * FACTOR_DE_RODEO);
    expect(sin.millasAntes).toBeLessThan(71 * FACTOR_DE_RODEO);
  });
  // Dos casos hallados buscando al azar (2026-10-01), para lo que el vecino más cercano no resuelve solo. Con D-NEXT el
  // resultado es el mismo recorrido que encontraba D-456 (190,5 y 243,2 mi en línea recta), ahora COMPROBADO como óptimo.
  const caso = (coords: [number, number][], capacidad: number) => {
    const n = coords.length / 2;
    const paradas = [...Array.from({ length: n }, (_, i) => P(String(i + 1), "T")), ...Array.from({ length: n }, (_, i) => D(String(i + 1)))];
    return optimizaLaLista({
      paradas, puntos: coords.map(([lat, lng]) => ({ lat, lng })), cambios: paradas.map((p) => (p.tipo === "P" ? 4 : -4)),
      base: { lat: 26.5, lng: -97.5 }, capacidad,
    });
  };
  it("después del vecino más cercano PULE: mueve paradas de una en una mientras el recorrido mejore", () => {
    // El vecino más cercano solo dejaba esta ruta en 230,3 mi; puliendo, 190,5 (de 253,6 que medía). Con el rodeo, 247,6 de 329,7.
    const r = caso([[26.6, -97.7], [26.5, -97], [26.7, -97.5], [26.9, -97.1], [26.1, -97], [26.2, -97.8]], 9);
    expect(r.millasAntes).toBeGreaterThan(250 * FACTOR_DE_RODEO);
    expect(r.millasDespues).toBeLessThan(195 * FACTOR_DE_RODEO);
    expect(r.millasDespues).toBe(247.6);
    expect(r.exacta).toBe(true);
    expect(r.excesoDespues).toBe(0);
    expect(ordenSinRecoger(r.paradas)).toBeNull();
  });
  it("el vecino más cercano solo toma una recogida que QUEPA: así parte de una ruta que no se pasa, y llega más corto", () => {
    // Camión de 9 y órdenes de 4: caben dos a la vez. Sin mirar si cabe, esta ruta se quedaba en 273,1 mi; mirándolo, 243,2
    // (316,2 con el rodeo).
    const r = caso([[27, -98], [26.8, -97.2], [26, -97.6], [26.1, -97.5], [26.1, -97.7], [26.2, -97.6], [26.8, -97.2], [26.9, -97.6]], 9);
    expect(r.millasDespues).toBeLessThan(250 * FACTOR_DE_RODEO);
    expect(r.millasDespues).toBe(316.2);
    expect(r.exacta).toBe(true);
    expect(r.excesoDespues).toBe(0);
    expect(ordenSinRecoger(r.paradas)).toBeNull();
  });
  it("una parada sin punto en el mapa no cuenta en el recorrido, se queda en la lista y se dice cuántas son", () => {
    const paradas = [P("1"), P("2"), P("3", null), D("1"), D("2"), D("3")];
    const puntos = [en(26.0), en(26.0), null, en(26.9), en(26.1), null];
    const r = optimiza(paradas, puntos, [1, 1, 1, -1, -1, -1]);
    expect(r.sinPunto).toBe(2);
    expect(r.paradas).toHaveLength(6);
    expect(ordenSinRecoger(r.paradas)).toBeNull();
  });

  describe("la pantalla", () => {
    const optimizar = trozo("const optimizaLaRuta = async (laneKey: string) => {", "// Friendly display name for a lane key.");
    it("un botón «🧭 Optimizar» en cada tarjeta de chofer con paradas", () => {
      expect(pagina).toContain("<button className=\"btn btn-ghost btn-sm\" data-optimizar={u.key} disabled={optimizando != null || moviendo}");
      expect(pagina).toContain("onClick={(e) => { e.stopPropagation(); void optimizaLaRuta(u.key); }}");
      expect(pagina).toContain("🧭 {optimizando === u.key ? t(\"Optimizing…\", \"Optimizando…\") : t(\"Optimize\", \"Optimizar\")}");
    });
    it("con candado 🔒 no optimiza, y lo dice — antes de calcular nada", () => {
      const candado = optimizar.indexOf("if (bloqueada(laneKey)) {");
      expect(candado).toBeGreaterThan(-1);
      expect(optimizar.indexOf("está bloqueada — Optimizar no la toca")).toBeGreaterThan(candado);
      expect(optimizar.indexOf("const r = optimizaLaLista({")).toBeGreaterThan(optimizar.indexOf("return;", candado));
    });
    it("optimiza SOLO la lista de esa ruta, con sus puntos, sus pallets, su base y su capacidad", () => {
      // **Puesto al día por D-NEXT**: lo que se le pasa lo arma `entradaDeOptimizar` (que añade ventanas y minutos de servicio).
      expect(optimizar).toContain("const lista = lecturaDe(laneKey, stops).paradas;");
      expect(optimizar).toContain("const base = baseDeLaRuta(laneKey);");
      expect(optimizar).toContain("lista, ordenes: stops, base, capacidad: capacityFor(driverOf(laneKey)), coordsDeTienda,");
    });
    it("el ORDEN se decide en el navegador, sin pedírselo a nadie; lo único que se pide son los tiempos por calles, una vez", () => {
      // **Reemplazado en parte por D-NEXT**: D-456 no llamaba a nadie («ni una petición») y medía en línea recta. Ahora pide
      // UNA matriz de tiempos por pulsación (`/api/route-matrix`); el orden lo sigue decidiendo `optimizaLaLista`, aquí.
      expect(optimizar.split("fetch(").length - 1).toBe(1);
      expect(optimizar).toContain('fetch("/api/route-matrix"');
      expect(optimizar).not.toContain("/api/optimize-route");
      expect(optimizar).not.toContain("mideLaRuta(");
      expect(plano(leer("src/lib/optimiza-la-ruta.ts"))).not.toContain("fetch(");
    });
    it("guarda por `guardaLaLista` (deshacer incluido), y si no hay nada mejor no escribe", () => {
      // **Puesto al día por D-NEXT**: el aviso («No se cambió nada») lo escribe ahora `avisoDeOptimizar`.
      expect(optimizar).toContain("if (r.cambio && !(await guardaLaLista(laneKey, stops, r.paradas, {");
      expect(optimizar.split("guardaLaLista(").length - 1).toBe(1);
    });
    it("una pulsación a la vez: mientras guarda, los botones se apagan", () => {
      expect(optimizar).toContain("if (optimizando != null || moviendo) return;");
      expect(optimizar).toContain("setOptimizando(laneKey);");
    });
  });
});

// =====================================================================================================================
describe("4 · la llegada estimada, SIEMPRE", () => {
  const rutas = [{ clave: "Diego", firma: "d1" }, { clave: "Ernesto", firma: "e1" }, { clave: "Julio", firma: "j1" }];

  it("al cargar se piden todas, pero UNA a la vez y en orden", () => {
    const que = siguienteMedida(rutas, {}, new Map());
    expect(que.pide).toEqual({ clave: "Diego", firma: "d1" });
    expect(que.repinta).toEqual([]);
    // Con Diego ya pintado y medido, la siguiente.
    expect(siguienteMedida(rutas, { Diego: "d1" }, new Map([["d1", { millas: 1 }]])).pide).toEqual({ clave: "Ernesto", firma: "e1" });
  });
  it("lo que ya está pintado en su forma de ahora no se pide ni se repinta", () => {
    const todo = new Map([["d1", 1], ["e1", 2], ["j1", 3]]);
    expect(siguienteMedida(rutas, { Diego: "d1", Ernesto: "e1", Julio: "j1" }, todo)).toEqual({ repinta: [], pide: null });
  });
  it("volver a una forma YA MEDIDA (deshacer, subir y bajar) la repinta sin llamar a nadie — era «a veces no aparece»", () => {
    const conocidas = new Map([["d1", { millas: 12 }]]);
    // Diego volvió a `d1` y lo pintado se tiró con el cambio.
    const que = siguienteMedida([{ clave: "Diego", firma: "d1" }], {}, conocidas);
    expect(que.repinta).toEqual([{ clave: "Diego", firma: "d1", medida: { millas: 12 } }]);
    expect(que.pide).toBeNull();
    // Y si lo pintado es de OTRA forma (aún no se tiró), también.
    expect(siguienteMedida([{ clave: "Diego", firma: "d1" }], { Diego: "d0" }, conocidas).repinta).toHaveLength(1);
  });
  it("una forma cuya medida FALLÓ no se vuelve a pedir sola (sin bucle) ni se repinta; las demás siguen", () => {
    const conocidas = new Map<string, number | typeof MEDIDA_FALLIDA>([["d1", MEDIDA_FALLIDA]]);
    const que = siguienteMedida<number>(rutas, {}, conocidas);
    expect(que.repinta).toEqual([]);
    expect(que.pide).toEqual({ clave: "Ernesto", firma: "e1" });
    expect(siguienteMedida<number>([{ clave: "Diego", firma: "d1" }], {}, conocidas)).toEqual({ repinta: [], pide: null });
    // Tras «↻» (se olvida el fallo de esa forma) se pide otra vez: una llamada por pulsación.
    conocidas.delete("d1");
    expect(siguienteMedida<number>([{ clave: "Diego", firma: "d1" }], {}, conocidas).pide).toEqual({ clave: "Diego", firma: "d1" });
  });
  it("la celda: la hora si la hay; si no, POR QUÉ no la hay (y lo que no tiene punto manda sobre «calculando…»)", () => {
    expect(textoDeLaLlegada("09:15", "medida", null, true)).toEqual({ texto: "09:15", falta: false });
    expect(textoDeLaLlegada(undefined, "calculando", "sin_base", true).texto).toBe("calculando…");
    expect(textoDeLaLlegada(undefined, "calculando", "sin_base", false).texto).toBe("calculating…");
    expect(textoDeLaLlegada(undefined, "fallo", "sin_base", true).texto).toBe("sin medida");
    expect(textoDeLaLlegada(undefined, "calculando", "sin_pin", true).texto).toBe("sin pin");
    expect(textoDeLaLlegada(undefined, "medida", "sin_pin", true).texto).toBe("sin pin");
    expect(textoDeLaLlegada(undefined, "fallo", "sin_tienda", true).texto).toBe("tienda sin punto");
    expect(textoDeLaLlegada(undefined, "medida", "sin_base", true).texto).toBe("sin base");
    // Una ruta que no se mide ahora (viendo todas las fechas, sin marcar) se queda con la raya de siempre.
    expect(textoDeLaLlegada(undefined, "sin_pedir", "sin_base", true).texto).toBe("—");
    for (const m of ["sin_pin", "sin_tienda"] as const) expect(textoDeLaLlegada(undefined, "medida", m, true).titulo).toBeTruthy();
    expect(textoDeLaLlegada(undefined, "fallo", null, true).titulo).toContain("↻");
  });

  describe("la pantalla", () => {
    const efecto = trozo("const seMide = (clave: string) =>", "const estadoDeLaMedida =");
    it("se miden TODAS las rutas con paradas del día (no solo las marcadas), las marcadas primero", () => {
      expect(efecto).toContain("const seMide = (clave: string) => (byDriver.get(clave) ?? []).length > 0 && pasaFiltro(clave) && (modo === \"dia\" || selected.has(clave));");
      expect(efecto).toContain("const rutasAMedir = [...lanes.filter((l) => selected.has(l.key)), ...lanes.filter((l) => !selected.has(l.key))].map((l) => l.key).filter(seMide);");
    });
    it("qué se pide lo decide `siguienteMedida`: lo conocido se repinta, y solo se pide si no hay otra medida en curso", () => {
      expect(efecto).toContain("const que = siguienteMedida<MedidaDeLaRuta>(rutas, pintadas, medidas.current);");
      expect(efecto).toContain("for (const r of que.repinta) { firmaPintada.current[r.clave] = r.firma; pintaLaMedida(r.clave, r.medida); }");
      expect(efecto).toContain("if (midiendo == null && que.pide) void mide(que.pide.clave, byDriver.get(que.pide.clave) ?? []);");
    });
    it("cada medida se guarda por la forma de la ruta, y un fallo también (para no pedirlo en bucle)", () => {
      const mide = trozo("const mide = async", "const reintentaLaMedida");
      expect(mide).toContain("medidas.current.set(firma, m);");
      expect(mide).toContain("medidas.current.set(firma, MEDIDA_FALLIDA);");
      expect(mide.split("mideLaRuta(").length - 1).toBe(1);
    });
    it("la forma incluye la lista tal como se pinta: otra capacidad u otro plan publicado es otra forma", () => {
      expect(pagina).toContain("`${firmaDeLaMedida(date, clave, stops)}|${lecturaDe(clave, stops).paradas.map((p) => (p.tipo === \"P\" ? `P${p.ordenes.join(\"+\")}` : `D${p.orden}`)).join(\",\")}`;");
    });
    it("la columna «Llegada» de las filas P y D dice el estado o el motivo, no una raya", () => {
      expect(pagina).toContain("const medida = estadoDeLaMedida(u.key, stops);");
      expect(pagina).toContain("const llegadaP = textoDeLaLlegada(etaP, f.indice != null ? medida : \"sin_pedir\", motivoP, lang === \"es\");");
      expect(pagina).toContain("!coordsDeTienda(paradaP.tienda) ? \"sin_tienda\" : \"sin_base\";");
      expect(pagina).toContain("const llegada = textoDeLaLlegada(eta, medida, d.delivery_lat == null || d.delivery_lng == null ? \"sin_pin\" : \"sin_base\", lang === \"es\");");
      expect(pagina).toContain("{llegadaP.texto}</td>");
      expect(pagina).toContain("{llegada.texto}{late ? \" ⚠️\" : \"\"}");
      expect(pagina).not.toContain("{etaP ?? \"—\"}");
      expect(pagina).not.toContain("{eta ?? \"—\"}");
    });
    it("la tarjeta dice «calculando…» mientras llega, y si falló ofrece «↻», que olvida ESE fallo y pide una vez", () => {
      expect(pagina).toContain("{medida === \"calculando\" && <span className=\"hint\" data-medida=\"calculando\"");
      expect(pagina).toContain("onClick={(e) => { e.stopPropagation(); reintentaLaMedida(u.key); }}>");
      const reintenta = trozo("const reintentaLaMedida = (clave: string) => {", "const toggleOrder");
      expect(reintenta).toContain("medidas.current.delete(firmaDe(clave, byDriver.get(clave) ?? []));");
      expect(reintenta).toContain("setReintentos((n) => n + 1);");
      expect(reintenta).not.toContain("mide(");
    });
  });
});
