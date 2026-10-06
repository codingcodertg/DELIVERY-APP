import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ajustesConBaseDelPerfil, choferesParaRepartir, etiquetaDelReparto, listaDeLasParadas, matrizDelGestor, movimientosDelReparto, paradasDeLaLista,
  puntosDelReparto, resumenDelReparto, textoDeNoRepartir, tramoEstimado,
} from "./reparto-desde-el-gestor";
import { proveedorEstimado } from "./route-times/proveedores";
import { claveDePunto } from "./route-times/claves";
import { demoSettings } from "./demo-data";
import type { Reparto, RutaEvaluada } from "./route-engine";
import type { DriverSettings } from "./types";

/**
 * «Asignar a…» varios choferes desde el Gestor (D-474): lo que la pantalla pone alrededor de `reparteEntre`, y que la pantalla
 * lo USA (las pruebas se alimentan de quien llama). El dueño, 2026-10-06: «en routes manager quiero que puede select multiple
 * orders y asignarla a los ocnductos que yo elija asi como el autoassign».
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
const trozo = (desde: string, hasta: string, de = pagina) => {
  const i = de.indexOf(desde);
  expect(i, `no está: ${desde}`).toBeGreaterThan(-1);
  const j = de.indexOf(hasta, i + desde.length);
  expect(j, `no está: ${hasta}`).toBeGreaterThan(i);
  return de.slice(i, j);
};

const fila = (profile_id: string, base_store: string | null, extra: Partial<DriverSettings> = {}): DriverSettings =>
  ({ profile_id, base_store, capacity_pallets: 10, shift_start: "07:00", shift_end: "16:00", returns_to_base: true, routable: true, ...extra });

describe("los choferes, como los ve «Armar rutas» (y con la base del perfil si no tienen la de Ajustes, D-461)", () => {
  it("la fila de Ajustes manda; sin base en ella, la tienda del perfil; sin fila, una de partida con la tienda del perfil; sin nada, sin base", () => {
    const r = ajustesConBaseDelPerfil(
      [fila("a", "Norte"), fila("b", "  "), fila("d", null, { capacity_pallets: 7 })],
      [{ id: "a", store: "Sur" }, { id: "b", store: "Sur" }, { id: "c", store: "Este" }, { id: "d", store: null }],
    );
    expect(r.map((f) => [f.profile_id, f.base_store])).toEqual([["a", "Norte"], ["b", "Sur"], ["c", "Este"], ["d", null]]);
    expect(r[0]).toMatchObject({ capacity_pallets: 10, shift_start: "07:00" });
    expect(r[2]).toEqual({ profile_id: "c", base_store: "Este", capacity_pallets: null, shift_start: "", shift_end: "", returns_to_base: true, routable: true });
    expect(r[3].capacity_pallets).toBe(7);
  });
  it("se puede repartir con los que entran al motor; los de ruta bloqueada 🔒 y los que el motor dejó fuera salen apagados con su porqué; el no disponible sale marcado", () => {
    const dia = {
      entrada: { choferes: [{ id: "a", nombre: "Ana" }, { id: "b", nombre: "Beto" }] },
      choferesFuera: [{ id: "c", nombre: "Ceci", motivo: "base" as const }, { id: "d", nombre: "Dani", motivo: "no_rutea" as const }],
    };
    const r = choferesParaRepartir(dia as never, [
      { id: "d", full_name: "Dani" }, { id: "a", full_name: "Ana" }, { id: "b", full_name: "Beto" }, { id: "c", full_name: "Ceci" }, { id: "x", full_name: "Nadie" },
    ], (nombre) => nombre === "Beto", new Set(["Ana"]));
    expect(r).toEqual([
      { id: "d", nombre: "Dani", puede: false, motivo: "no_rutea", noDisponible: false },
      { id: "a", nombre: "Ana", puede: true, noDisponible: true },
      { id: "b", nombre: "Beto", puede: false, motivo: "ruta_bloqueada", noDisponible: false },
      { id: "c", nombre: "Ceci", puede: false, motivo: "base", noDisponible: false },
    ]);
  });
  it("cada porqué tiene su texto en los dos idiomas", () => {
    for (const m of ["no_rutea", "base", "base_sin_punto", "no_disponible", "ruta_bloqueada"] as const) {
      const t = textoDeNoRepartir(m);
      expect(t.en.length).toBeGreaterThan(0); expect(t.es.length).toBeGreaterThan(0); expect(t.en).not.toBe(t.es);
    }
    expect(textoDeNoRepartir("ruta_bloqueada").es).toContain("🔒");
  });
});

describe("los tiempos", () => {
  const puntos = { "tienda:n": { lat: 26.3, lng: -98.2 }, "orden:a": { lat: 26.31, lng: -98.21 }, "orden:b": { lat: 26.32, lng: -98.19 }, "orden:c": { lat: 26.3, lng: -98.2 } };
  it("los puntos que entran: las bases de los elegidos y la tienda y el pin de cada orden; sin punto, o sin coordenadas, no", () => {
    const r = puntosDelReparto({
      // La base de Beto («tienda:s») no es la tienda de ninguna orden: entra solo por ser base de un elegido.
      choferes: [{ base: "tienda:n" }, { base: "tienda:s" }, { base: "tienda:sin-coords" }] as never,
      ordenes: [{ origen: "tienda:n", destino: "orden:a" }, { origen: null, destino: "orden:b" }, { origen: "tienda:n", destino: null }] as never,
    }, { ...puntos, "tienda:s": { lat: 26.1, lng: -98.2 }, "orden:z": { lat: 1, lng: 1 } });
    expect(Object.keys(r).sort()).toEqual(["orden:a", "orden:b", "tienda:n", "tienda:s"]);
  });
  it("la matriz del motor sale de los tiempos por calles, por la clave lat,lng de cada punto; lo que falta se estima en línea recta como el motor, y se cuenta", async () => {
    const kn = claveDePunto(puntos["tienda:n"]), ka = claveDePunto(puntos["orden:a"]);
    const r = matrizDelGestor(puntos, { [kn]: { [ka]: { minutos: 7, millas: 2.5 } } });
    expect(r.matriz["tienda:n"]["orden:a"]).toEqual({ minutos: 7, millas: 2.5 });
    const est = await proveedorEstimado().tramo(puntos["orden:a"], puntos["tienda:n"]);
    expect(r.matriz["orden:a"]["tienda:n"]).toEqual(est);
    expect(r.matriz["orden:a"]["tienda:n"]).toEqual(tramoEstimado(puntos["orden:a"], puntos["tienda:n"]));
    // Dos puntos en el MISMO sitio (orden:c cae en la tienda): cero, y no cuentan como par.
    expect(r.matriz["tienda:n"]["orden:c"]).toEqual({ minutos: 0, millas: 0 });
    // 4 puntos → 12 pares, menos los 2 del mismo sitio = 10; por calles vinieron DOS (tienda→a, y c→a: c comparte clave con la tienda).
    expect(r.matriz["orden:c"]["orden:a"]).toEqual({ minutos: 7, millas: 2.5 });
    expect(r.pares).toBe(10);
    expect(r.estimados).toBe(8);
  });
  it("sin respuesta del servidor, todo estimado", () => {
    const r = matrizDelGestor(puntos, null);
    expect(r.estimados).toBe(r.pares);
    expect(r.matriz["orden:a"]["orden:b"].millas).toBeGreaterThan(0);
  });
});

describe("de la lista del Gestor al motor y de vuelta", () => {
  it("una fila P con varias órdenes son varias P del motor; una D, una D", () => {
    expect(paradasDeLaLista([{ tipo: "P", ordenes: ["a", "b"], tienda: "N" }, { tipo: "D", orden: "a" }, { tipo: "D", orden: "b" }]))
      .toEqual([{ orden: "a", tipo: "P" }, { orden: "b", tipo: "P" }, { orden: "a", tipo: "D" }, { orden: "b", tipo: "D" }]);
  });
  it("las paradas del motor vuelven como lista: cada recogida en su fila con su tienda; y lo obligatorio que el motor no vio, al final, sin repetir", () => {
    const lista = listaDeLasParadas([{ orden: "a", tipo: "P" }, { orden: "a", tipo: "D" }], (o) => (o === "a" ? "Norte" : "Sur"), ["a", "z"]);
    expect(lista).toEqual([{ tipo: "P", ordenes: ["a"], tienda: "Norte" }, { tipo: "D", orden: "a" }, { tipo: "P", ordenes: ["z"], tienda: "Sur" }, { tipo: "D", orden: "z" }]);
  });
  it("qué se mueve de ruta: solo lo que cambia de chofer, con de dónde sale («null» = sin asignar)", () => {
    const r = { rutas: [{ nombre: "Ana", nuevas: ["a", "b"] }, { nombre: "Beto", nuevas: ["c"] }] } as unknown as Reparto;
    const rutaDe = (o: string) => ({ a: "Ana", b: null, c: "Ceci" } as Record<string, string | null>)[o];
    expect(movimientosDelReparto(r, rutaDe)).toEqual([{ orden: "b", de: null, a: "Ana" }, { orden: "c", de: "Ceci", a: "Beto" }]);
  });
});

describe("el resumen antes de confirmar", () => {
  const ruta = (millas: number, duracionMin: number, tardeMin = 0): RutaEvaluada => ({ chofer: "", paradas: [], inicio: 480, fin: 480 + duracionMin, duracionMin, manejoMin: 0, millas, tardeMin, builderMin: 0, violaciones: [] });
  const r: Pick<Reparto, "rutas" | "sinAsignar" | "ignoradas"> = {
    rutas: [
      { chofer: "a", nombre: "Ana", paradas: [{ orden: "x", tipo: "P" }, { orden: "x", tipo: "D" }, { orden: "a", tipo: "P" }, { orden: "a", tipo: "D" }, { orden: "b", tipo: "P" }, { orden: "b", tipo: "D" }], nuevas: ["a", "b"], ruta: ruta(52.34, 250) },
      { chofer: "b", nombre: "Beto", paradas: [{ orden: "c", tipo: "P" }, { orden: "c", tipo: "D" }], nuevas: ["c"], ruta: ruta(20, 75, 12) },
    ],
    sinAsignar: [{ orden: "d", motivo: "supera_capacidad" }, { orden: "e", motivo: "falta_requisito", faltan: ["liftgate"] }],
    ignoradas: ["f"],
  };
  const nombreDe = (o: string) => `#${o}`;
  it("cuántas a cada quien y cómo queda su ruta (órdenes, millas, horas, retraso); lo que se mueve de otra ruta; lo que no cabe, con su porqué; y con qué se midió", () => {
    const s = resumenDelReparto({ r, nombreDe, movimientos: [{ orden: "a", de: null, a: "Ana" }, { orden: "c", de: "Ceci", a: "Beto" }], medida: { estimados: 3, pares: 20 }, totalSeleccionadas: 6 });
    expect(s.es).toBe([
      "🧭 3 orden(es) entre 2 chofer(es), cada una en el mejor sitio de su ruta:",
      "• Ana: +2 → 3 orden(es) · 52.3 mi · 4 h 10 min",
      "• Beto: +1 → 1 orden(es) · 20.0 mi · 1 h 15 min · ⚠ 12 min tarde",
      "Se mueven de otra ruta: #c (Ceci → Beto).",
      "⚠ 3 no caben y se quedan donde están: #d (mayor que el camión), #e (el camión no tiene lo que pide), #f (no está en la lista de este día).",
      "⚠ Medido en línea recta (estimado): 3 de 20 tramos sin tiempos por calles.",
    ].join("\n"));
    expect(s.en).toContain("• Ana: +2 → 3 order(s) · 52.3 mi · 4 h 10 min");
    expect(s.en).toContain("Moved from another route: #c (Ceci → Beto).");
    expect(s.en).toContain("3 don't fit and stay where they are");
    expect(s.en).toContain("Measured in a straight line");
  });
  it("sin movidas, sin fuera y con todo por calles, solo las líneas de los choferes", () => {
    const s = resumenDelReparto({ r: { ...r, sinAsignar: [], ignoradas: [] }, nombreDe, movimientos: [{ orden: "a", de: null, a: "Ana" }], medida: { estimados: 0, pares: 20 }, totalSeleccionadas: 3 });
    expect(s.es.split("\n")).toHaveLength(3);
    expect(s.es).not.toContain("⚠ Medido");
    expect(s.es).not.toContain("Se mueven");
  });
  it("si nada se puede asignar, la cabecera lo dice", () => {
    const s = resumenDelReparto({ r: { rutas: [{ ...r.rutas[0], nuevas: [] }], sinAsignar: [{ orden: "a", motivo: "sin_punto" }], ignoradas: [] }, nombreDe, movimientos: [], medida: { estimados: 0, pares: 0 }, totalSeleccionadas: 1 });
    expect(s.es.startsWith("🧭 Ninguna de las 1 orden(es) seleccionadas se puede asignar.")).toBe(true);
    expect(s.es).toContain("#a (sin punto en el mapa)");
  });
  it("la etiqueta de deshacer es UNA para el lote", () => {
    expect(etiquetaDelReparto(4, ["Ana", "Beto"])).toEqual({ en: "Assign 4 order(s) to Ana, Beto", es: "Asignar 4 orden(es) a Ana, Beto" });
  });
});

describe("la pantalla usa cada pieza (se alimenta de quien llama)", () => {
  const reparte = trozo("const reparte = async () => {", "const seccionDeReparto = ");
  const guarda = trozo("const guardaElReparto = async (r: Reparto): Promise<boolean> => {", "/** «🧭 Asignar N entre…»");
  const seccion = trozo("const seccionDeReparto = (sola: boolean) => {", "const recuadroDeReparto = ");

  it("lo que se reparte es lo marcado en cualquier tabla (`selectedOrders` ∪ `marcadas`), pendiente y de ESTE día", () => {
    expect(pagina).toContain("const [marcadas, setMarcadas] = useState<Set<string>>(new Set());");
    expect(pagina).toContain("() => dayOrders.filter((d) => d.delivery_date === date && ROUTE_STAGES.includes(d.stage) && (selectedOrders.has(d.id) || marcadas.has(d.id))),");
  });
  it("el día entra al motor por `entradaDelDia` —las mismas reglas que «Armar rutas»— con las seleccionadas libres y los choferes con la base del perfil si no tienen la de Ajustes", () => {
    expect(pagina).toContain("import { entradaDelDia } from \"@/lib/route-plan/entrada\";");
    const dia = trozo("const diaParaElMotor = useMemo(() => {", "}, [deliveries, date, seleccionDelReparto, drivers, ajustesDeChofer, settings]);");
    expect(dia).toContain("ordenes: deliveries.filter((d) => d.delivery_date === date && ROUTE_STAGES.includes(d.stage)).map((d) => (sel.has(d.id) ? { ...d, assigned_driver: null } : d)),");
    expect(dia).toContain("choferes: drivers, ajustesDeChofer: ajustesConBaseDelPerfil(ajustesDeChofer, drivers), settings,");
    expect(pagina).toContain("const ajustesDeChofer = useAjustesDeChofer();");
    expect(pagina).toContain("const choferesDelReparto = choferesParaRepartir(diaParaElMotor, drivers, bloqueada, unavailableToday);");
  });
  it("el hook lee las MISMAS columnas de `driver_settings` que el servidor, y en el demo no lee nada", () => {
    const hook = leer("src/lib/usa-ajustes-de-chofer.ts");
    expect(hook).toContain("leeConOpcionales((columnas) => createClient().from(\"driver_settings\").select(columnas), COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER)");
    expect(hook).toContain("if (LOCAL_MODE) return;");
  });
  it("al repartir: lo que cada elegido ya lleva es su lista de la tarjeta; los tiempos, UNA petición a /api/route-matrix con la memoria de Optimizar; la matriz, con lo que falte estimado; y el motor, `reparteEntre` con los parámetros del día", () => {
    expect(reparte).toContain("const yaLlevan = Object.fromEntries(elegidos.map((c) => [c.id, paradasDeLaLista(lecturaDe(c.nombre, byDriver.get(c.nombre) ?? []).paradas)]));");
    expect(reparte).toContain("const puntos = puntosDelReparto(entradaDelReparto(peticion).entrada, diaParaElMotor.puntos);");
    expect(reparte).toContain("const tiempos = await tiemposDeLaRuta(Object.values(puntos), tiemposPedidos.current, (pts) => fetch(\"/api/route-matrix\",");
    expect(reparte).toContain("const medida = matrizDelGestor(puntos, tiempos?.tiempos ?? null);");
    expect(reparte).toContain("const r = reparteEntre({ ...peticion, entrada: { ...diaParaElMotor.entrada, matriz: medida.matriz }, parametros: diaParaElMotor.parametros });");
  });
  it("antes de escribir, el resumen: se confirma con él delante; si nada se puede asignar, solo se avisa y no se escribe", () => {
    expect(reparte).toContain("const resumen = resumenDelReparto({ r, nombreDe, movimientos, medida, totalSeleccionadas: seleccionadas.length });");
    expect(reparte).toContain("if (!r.rutas.some((x) => x.nuevas.length)) { await confirmAction(t(resumen.en, resumen.es), { alertOnly: true }); return; }");
    expect(reparte).toContain("if (!(await confirmAction(t(resumen.en, resumen.es), { confirmLabel: t(\"Assign\", \"Asignar\") }))) return;");
    expect(reparte.indexOf("confirmAction(")).toBeLessThan(reparte.indexOf("guardaElReparto(r)"));
    expect(reparte).toContain("if (!(await guardaElReparto(r))) return;");
    expect(reparte).toContain("setMarcadas(new Set()); clearSelection(); setElegidosDelReparto(new Set());");
  });
  it("se guarda por el camino de siempre: el chofer y el puesto de las que llegan, la lista ENTERA con `reorderStops` (recogidas si la base las guarda), y UNA anotación en deshacer con todas las rutas tocadas", () => {
    expect(guarda).toContain("const lista = listaDeLasParadas(x.paradas, (id) => porId.get(id)?.store ?? null, suyas.map((d) => d.id));");
    expect(guarda).toContain("const desde = inicioDeLaRuta(laneKey, stops);");
    expect(guarda).toContain("const e = escrituraDeLaLista(lista, desde);");
    expect(guarda).toContain("const recogidas = hayRecogidaGuardada ? e.pickupSeqById : undefined;");
    expect(guarda).toContain("if (!(await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: desde + e.ids.indexOf(d.id), load_no: null, ...(recogidas ? { pickup_seq: recogidas[d.id] ?? null } : {}) }))) return false;");
    expect(guarda).toContain("if (!(await reorderStops(e.ids, e.loadNoById, undefined, desde, recogidas))) return false;");
    expect(guarda).toContain("despues = fotoTrasReordenar(despues, e.ids, e.loadNoById, desde, recogidas);");
    expect(guarda).toContain("if (origen && origen !== laneKey) { tocadas.add(origen); clearRouteFor(origen); }");
    expect(guarda).toContain("await anotaMovimiento(etiquetaDelReparto(rutas.reduce((n, x) => n + x.nuevas.length, 0), rutas.map((x) => x.nombre)), [...tocadas], antes, despues);");
    expect(guarda.split("anotaMovimiento(").length - 1).toBe(1);
    // La foto de antes se toma de TODAS las afectadas antes de la primera escritura.
    expect(guarda.indexOf("const antes: Foto = fotoDe(")).toBeLessThan(guarda.indexOf("await updateDelivery("));
  });
  it("las casillas: en cada fila D de la tarjeta (la orden), sin que el clic aísle la parada ni limpie la tarjeta; y «marcar todas» en la cabecera de la ruta", () => {
    expect(pagina).toContain("<input type=\"checkbox\" data-marca-orden={d.id} checked={marcadas.has(d.id)} onChange={() => alternaMarca(d.id)} onClick={(e) => e.stopPropagation()}");
    expect(pagina).toContain("<input type=\"checkbox\" data-marca-todas={u.key} checked={stops.length > 0 && stops.every((d) => marcadas.has(d.id))} disabled={stops.length === 0}");
    // Las de «Sin asignar» y «Todas» siguen siendo las de siempre (`toggleOrder`), y entran por `selectedOrders`.
    expect(pagina).toContain("onClick={hecha ? undefined : () => toggleOrder(d.id)}");
  });
  it("la sección: la cuenta «N seleccionadas», un chofer por casilla (apagado si no puede, con su porqué; 🔒 si está bloqueado) y el botón solo con elegidos", () => {
    expect(seccion).toContain("<b data-cuenta-seleccionadas");
    expect(seccion).toContain("t(`${n} selected`, `${n} seleccionadas`)");
    expect(seccion).toContain("<input type=\"checkbox\" data-elige-para-repartir={c.id} disabled={!c.puede || repartiendo} checked={c.puede && elegidosDelReparto.has(c.id)}");
    expect(seccion).toContain("const porque = c.motivo ? textoDeNoRepartir(c.motivo) : null;");
    expect(seccion).toContain("{c.nombre}{c.motivo === \"ruta_bloqueada\" ? \" 🔒\" : \"\"}");
    expect(seccion).toContain("<button className=\"btn btn-primary\" data-reparte disabled={!elegidos.length || n === 0 || repartiendo || moviendo} onClick={() => void reparte()}");
    expect(seccion).toContain("const elegidos = choferesDelReparto.filter((c) => c.puede && elegidosDelReparto.has(c.id));");
  });
  it("dónde sale: dentro del recuadro «Elige conductor» (plegada), sola cuando no hay nada sin asignar marcado, y en «Rutas» con algo marcado; nunca una barra arriba (D-459)", () => {
    // Puesto al día por D-NEXT: nada de esto en «Ruta de hoy» (solo lectura).
    const recuadro = trozo("{!soloLectura && poolSelectedCount > 0 && ( <div className=\"card\" data-elige-conductor", "{!soloLectura && poolSelectedCount === 0 && seleccionDelReparto.length > 0 && recuadroDeReparto()}");
    expect(recuadro).toContain("{seleccionDelReparto.length > 0 && seccionDeReparto(false)}");
    expect(recuadro.indexOf("data-nueva-ruta-del-recuadro")).toBeLessThan(recuadro.indexOf("seccionDeReparto(false)"));
    expect(pagina).toContain("{!soloLectura && tab === \"routes\" && seleccionDelReparto.length > 0 && recuadroDeReparto()}");
    expect(pagina).toContain("<div className=\"card\" data-recuadro-de-reparto role=\"group\"");
    expect(pagina).toContain("style={{ position: \"sticky\", bottom: 8, zIndex: 6, margin: \"10px 0 0\", padding: \"12px 14px\", border: \"2px solid var(--accent)\", background: \"var(--accent-soft)\", maxWidth: \"100%\", boxSizing: \"border-box\" }}> {seccionDeReparto(true)}");
    expect(seccion).toContain(": <button className=\"btn btn-ghost btn-sm\" data-abre-reparto aria-expanded={abierto} onClick={() => setRepartoAbierto((v) => !v)}");
  });
  it("cambiar de día olvida las marcas y los elegidos", () => {
    expect(pagina).toContain("useEffect(() => { setMarcadas(new Set()); setElegidosDelReparto(new Set()); }, [date]);");
  });
  it("el demo rutea: sus tiendas tienen punto en el mapa (sin él ningún chofer entra al motor)", () => {
    for (const s of demoSettings().stores) { expect(s.lat, s.name).toBeTypeOf("number"); expect(s.lng, s.name).toBeTypeOf("number"); }
  });
});
