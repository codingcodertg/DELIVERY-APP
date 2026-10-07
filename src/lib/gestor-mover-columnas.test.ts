import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMN_WIDTHS } from "./use-col-widths";
import {
  ANCHO_FIJO_DE_PARADAS, COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, LLAVE_DE_ANCHOS_DE_PARADAS, MARCA_V2, MARCA_V3, MARCA_V4, MARCA_V5, MARCA_V6, MARCA_V7, MARCA_V8,
  ORDEN_DE_PARTIDA_DEL_GESTOR, anchoDePartidaDeParada, anchosDeParadasHeredados, claveDelOrdenEnElNavegador, columnasDeLaTabla,
  columnasDelSelector, componeOrdenDelGestor, fotoDePlantillaDelGestor, mueveEnElGestor, ordenDeLaTabla, ordenDePlantillaDelGestor,
  ordenDelGestorEnElNavegador, restableceOrdenDelGestor, seMueveEnElGestor, siembraAnchosDeParadas, tieneOrdenPropio,
} from "./routes-columns";
import { guardaPlantilla, bytesEnLaBase, cabeEnLaFila, TOPE_DE_LA_BASE, RESERVA_PARA_LO_DEMAS } from "./plantillas-de-columnas";
import {
  CLAVE_DE_COLUMNAS_DEL_GESTOR, MAX_NOMBRE_DE_PLANTILLA, MAX_PLANTILLAS, ROLES_QUE_ELIGEN, guardaColumnas, plantillasDeValor, prefsDeValor,
  valorDeColumnas, type ClienteDePrefs, type PlantillaDeColumnas,
} from "./user-prefs";

/**
 * D-410: mover columnas en el Gestor de Rutas, y que las plantillas guarden el orden. El dueño, literal: «Route manager
 * view to be able to move columns and save template IN THE COLUMNS». Mismo mecanismo que Órdenes (D-332) y Promos (D-385).
 */

const SIN = ORDEN_DE_PARTIDA_DEL_GESTOR.sinAsignar;
const PAR = ORDEN_DE_PARTIDA_DEL_GESTOR.paradas;
const TODAS = COLUMNAS_DEL_GESTOR.map((c) => c.key);
const MARCAS = [MARCA_V2, MARCA_V3, MARCA_V4, MARCA_V5, MARCA_V6, MARCA_V7, MARCA_V8];
const sinAsignar = (elegidas: readonly string[], orden: readonly string[] | null) => columnasDeLaTabla("sinAsignar", elegidas, orden).map((c) => c.key);
const paradas = (elegidas: readonly string[], orden: readonly string[] | null) => columnasDeLaTabla("paradas", elegidas, orden).map((c) => c.key);
/** Mover `clave` n puestos (negativo = arriba), como lo haría la persona pulsando la flecha n veces. */
const mueve = (tabla: "sinAsignar" | "paradas", orden: string[] | null, clave: string, veces: number, elegidas: readonly string[] = COLUMNAS_DEL_GESTOR_POR_DEFECTO) => {
  for (let i = 0; i < Math.abs(veces); i++) orden = mueveEnElGestor(tabla, orden, clave, veces < 0 ? -1 : 1, elegidas);
  return orden;
};

describe("mover columnas en «Sin asignar»", () => {
  it("de partida, el orden de ventas de D-402; «Tienda» dos puestos arriba queda delante de Contacto y Etapa", () => {
    expect(sinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO, null)).toEqual(["po", "so", "invoice", "type", "account", "contact", "status", "store", "date", "pallets", "fee", "pickup", "address", "windows"]);
    const orden = mueve("sinAsignar", null, "store", -2);
    expect(sinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden)).toEqual(["po", "so", "invoice", "type", "account", "store", "contact", "status", "date", "pallets", "fee", "pickup", "address", "windows"]);
  });
  it("una flecha salta por encima de las escondidas: sin Contacto ni Etapa, UNA pulsación pone Tienda delante de Cuenta", () => {
    const elegidas = COLUMNAS_DEL_GESTOR_POR_DEFECTO.filter((k) => k !== "contact" && k !== "status");
    const orden = mueve("sinAsignar", null, "store", -1, elegidas);
    expect(sinAsignar(elegidas, orden)).toEqual(["po", "so", "invoice", "type", "store", "account", "date", "pallets", "fee", "pickup", "address", "windows"]);
    // Y ocultar y volver a mostrar no le hace perder su sitio a nadie: Contacto vuelve donde estaba.
    expect(sinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden).indexOf("contact")).toBe(sinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden).indexOf("account") + 1);
  });
  it("la FACTURA, fija, se mueve como las demás —puede dejar de ir tras SO, y hasta ser la primera—, y sigue sin poder quitarse", () => {
    const orden = mueve("sinAsignar", null, "invoice", -2);
    expect(sinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden)[0]).toBe("invoice");
    // Una lista sin ella la enseña igual, en el sitio que la persona le dio.
    expect(sinAsignar(["pallets", "po"], orden)).toEqual(["invoice", "po", "pallets"]);
    // Cuenta como vista para saltar: una pulsación de Pallets hacia arriba pasa por encima de las escondidas hasta ella.
    expect(sinAsignar(["pallets"], mueve("sinAsignar", orden, "pallets", -1, ["pallets"]))).toEqual(["pallets", "invoice"]);
  });
  it("mover en una tabla NO toca la otra, y nunca cruza de una tabla a la otra", () => {
    const orden = mueve("paradas", mueve("sinAsignar", null, "store", -2), "p_eta", -1);
    expect(sinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden).indexOf("store")).toBe(5);
    // D-445: la ciudad de recogida va pegada delante de la de entrega; la llegada, un puesto arriba, salta por encima de las dos.
    expect(paradas(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden)).toEqual(["p_type", "p_ciudad_recogida", "p_eta", "p_address", "p_windows"]);
    // La última de «Sin asignar» hacia abajo no se va a la tabla de paradas: no se mueve, y la flecha se apaga.
    // Con TODAS puestas la última es la prioridad (D-412, `alFinal`); hasta entonces era «Ventanas».
    expect(SIN[SIN.length - 1]).toBe("priority");
    expect(mueveEnElGestor("sinAsignar", null, "priority", 1, TODAS)).toBeNull();
    expect(seMueveEnElGestor("sinAsignar", null, "priority", 1, TODAS)).toBe(false);
    expect(seMueveEnElGestor("sinAsignar", null, "po", -1, TODAS)).toBe(false);
    expect(seMueveEnElGestor("sinAsignar", null, "so", -1, TODAS)).toBe(true);
    expect(seMueveEnElGestor("paradas", null, "p_type", -1, TODAS)).toBe(false);
  });
});

describe("lo que se guarda en `_orden`", () => {
  it("sin mover nada no se guarda nada (`null`), y solo se guarda la tabla que se movió", () => {
    expect(componeOrdenDelGestor({ sinAsignar: SIN, paradas: PAR, plan: ORDEN_DE_PARTIDA_DEL_GESTOR.plan })).toBeNull();
    const orden = mueve("sinAsignar", null, "store", -2)!;
    expect(orden).toHaveLength(SIN.length);
    expect(orden.some((k) => PAR.includes(k))).toBe(false);
    // Devolverla a su sitio la saca de la lista: vuelve a `null`.
    expect(mueve("sinAsignar", orden, "store", 2)).toBeNull();
  });
  it("«Restablecer orden» de una tabla la devuelve a su partida y deja la otra como estaba; «¿tiene orden propio?» lo dice", () => {
    const orden = mueve("paradas", mueve("sinAsignar", null, "store", -2), "p_eta", -1);
    expect(tieneOrdenPropio("sinAsignar", orden)).toBe(true);
    expect(tieneOrdenPropio("paradas", orden)).toBe(true);
    const sinSin = restableceOrdenDelGestor("sinAsignar", orden);
    expect(tieneOrdenPropio("sinAsignar", sinSin)).toBe(false);
    expect(paradas(COLUMNAS_DEL_GESTOR_POR_DEFECTO, sinSin)).toEqual(["p_type", "p_ciudad_recogida", "p_eta", "p_address", "p_windows"]);   // D-445: con la de recogida
    expect(restableceOrdenDelGestor("paradas", sinSin)).toBeNull();
    expect(tieneOrdenPropio("sinAsignar", null)).toBe(false);
  });
  it("lo guardado se lee con cuidado: una clave que ya no existe se cae, y una columna que no conoce entra al final", () => {
    const guardado = ["store", "columna_retirada", "po", "p_eta"];
    const sin = ordenDeLaTabla("sinAsignar", guardado);
    expect(sin.slice(0, 2)).toEqual(["store", "po"]);
    expect(sin).not.toContain("columna_retirada");
    expect(sin).toHaveLength(SIN.length);
    expect(ordenDeLaTabla("paradas", guardado)[0]).toBe("p_eta");
  });
  it("va y vuelve por la fila igual, al lado de las columnas y las plantillas", () => {
    const orden = mueve("sinAsignar", null, "store", -2)!;
    const plantillas: PlantillaDeColumnas[] = [{ n: "Mía", v: ["po", "store"] }];
    const valor = valorDeColumnas({ visibles: { logistics: [...COLUMNAS_DEL_GESTOR_POR_DEFECTO] }, orden: { logistics: orden }, plantillas });
    const leido = prefsDeValor(valor);
    expect(leido.orden.logistics).toEqual(orden);
    expect(leido.visibles.logistics).toEqual([...COLUMNAS_DEL_GESTOR_POR_DEFECTO]);
    expect(plantillasDeValor(valor)).toEqual(plantillas);
  });
});

describe("un solo escritor: mover no borra columnas ni plantillas, y al revés", () => {
  const cliente = (escrito: unknown[]) => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      upsert: (fila: { value: unknown }) => { escrito.push(fila.value); return { select: async () => ({ data: [{ user_id: "yo" }], error: null }) }; },
    }),
  }) as unknown as ClienteDePrefs;
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  it("la página escribe por `escribeElGestor` con las TRES mitades leídas, al mover y al marcar", () => {
    expect(pagina).toContain("const escribeElGestor = () => guardaColumnas(createClient() as unknown as ClienteDePrefs, me!.id, prefsDelGestor.current ?? {}, CLAVE_DE_COLUMNAS_DEL_GESTOR, ordenDelGestor.current, {}, plantillasDelGestor.current);");
    const pon = pagina.slice(pagina.indexOf("const ponOrdenDelGestor = "), pagina.indexOf("const moverEn = "));
    expect(pon).toContain("if (prefsDelGestor.current === null) return;");
    expect(pon).toContain("const todos: ColumnasPorRol = { ...ordenDelGestor.current };");
    expect(pon).toContain("if (next) todos[me.role] = next; else delete todos[me.role];");
    expect(pon).toContain("ordenDelGestor.current = todos; void escribeElGestor();");
    // Lo leído llega a la `ref` que se escribe.
    expect(pagina).toContain("ordenDelGestor.current = leido.orden; plantillasDelGestor.current = leido.plantillas;");
    // D-434: el orden que se pinta es el que devuelve la tanda del plan, y si la tanda cambió algo, llega a las `ref` y se escribe.
    expect(pagina).toContain("setOrdenGestor(al.orden);");
    expect(pagina).toContain("if (al.escribe && al.columnas) { prefsDelGestor.current = { ...leido.columnas, [rol]: al.columnas }; const orden: ColumnasPorRol = { ...leido.orden }; if (al.orden) orden[rol] = al.orden; else delete orden[rol]; ordenDelGestor.current = orden; void escribeElGestor(); }");
  });
  it("con lo que manda ese escritor, la fila guardada lleva columnas, orden y plantillas; sin el orden, lo borraría", async () => {
    const escrito: unknown[] = [];
    const orden = { logistics: mueve("sinAsignar", null, "store", -2)! };
    const plantillas: PlantillaDeColumnas[] = [{ n: "A", v: ["po"] }];
    await guardaColumnas(cliente(escrito), "yo", { logistics: ["po"] }, CLAVE_DE_COLUMNAS_DEL_GESTOR, orden, {}, plantillas);
    expect(prefsDeValor(escrito[0]).orden).toEqual(orden);
    expect(plantillasDeValor(escrito[0])).toEqual(plantillas);
    // Lo que hacía el Gestor hasta D-410 (`{}` en el hueco del orden): marcar una casilla le habría borrado el orden.
    await guardaColumnas(cliente(escrito), "yo", { logistics: ["po"] }, CLAVE_DE_COLUMNAS_DEL_GESTOR, {}, {}, plantillas);
    expect(prefsDeValor(escrito[1]).orden).toEqual({});
  });
});

describe("las plantillas guardan también el orden", () => {
  it("la foto lleva `o` si la persona movió algo, y no lo lleva si no", () => {
    const orden = mueve("sinAsignar", null, "store", -2);
    expect(fotoDePlantillaDelGestor(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden)).toEqual({ v: COLUMNAS_DEL_GESTOR_POR_DEFECTO.filter((k) => !MARCAS.includes(k)), o: orden });
    expect(fotoDePlantillaDelGestor(COLUMNAS_DEL_GESTOR_POR_DEFECTO, null)).not.toHaveProperty("o");
    // Y `guardaPlantilla` la guarda tal cual.
    const r = guardaPlantilla([], "Log A", fotoDePlantillaDelGestor(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden));
    expect(r.ok && r.lista[0].o).toEqual(orden);
  });
  it("aplicar: la de D-410 devuelve su orden; una VIEJA, sin orden, da el de partida; y lo que ya no existe se cae", () => {
    const orden = mueve("sinAsignar", null, "store", -2)!;
    expect(ordenDePlantillaDelGestor(orden)).toEqual(orden);
    expect(ordenDePlantillaDelGestor(undefined)).toBeNull();
    expect(ordenDePlantillaDelGestor(["columna_retirada", ...orden])).toEqual(orden);
    // Una foto que solo trae el orden de partida no es un orden propio.
    expect(ordenDePlantillaDelGestor([...SIN, ...PAR])).toBeNull();
  });
  it("la página: aplicar pone el orden de la foto, y «Default» (`null`) el de partida, en la misma escritura que las columnas", () => {
    const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
    const a = pagina.slice(pagina.indexOf("const aplicaPlantillaDelGestor = "), pagina.indexOf("const destinoDelGestor = "));
    expect(a).toContain("const orden = p ? ordenDePlantillaDelGestor(p.o) : null;");
    expect(a).toContain("if (me && !SIN_BASE && prefsDelGestor.current !== null) prefsDelGestor.current = { ...prefsDelGestor.current, [me.role]: next }; ponOrdenDelGestor(orden);");
    expect(pagina).toContain("const r = guardaPlantilla(plantillasDelGestor.current, nombre, fotoDePlantillaDelGestor(colsGestor, ordenGestor));");
  });
});

describe("el tope de la fila (8 192 bytes de jsonb, 136) con el orden dentro", () => {
  const nombre = (i: number) => `${i}`.padStart(MAX_NOMBRE_DE_PLANTILLA, "x");
  const ordenLleno = [...[...SIN].reverse(), ...[...PAR].reverse(), ...[...ORDEN_DE_PARTIDA_DEL_GESTOR.plan].reverse()];
  const visiblesLlenas = [...TODAS, ...MARCAS];
  const plantillaLlena = (i: number): PlantillaDeColumnas => ({ n: nombre(i), v: [...TODAS], o: ordenLleno });
  it("un rol lleno —todas las columnas, todo movido— y plantillas llenas con orden: caben 4; la quinta, la guarda la para", () => {
    const con = (n: number) => valorDeColumnas({ visibles: { logistics: visiblesLlenas }, orden: { logistics: ordenLleno }, plantillas: Array.from({ length: n }, (_, i) => plantillaLlena(i)) });
    // Medido con `bytesEnLaBase`, que da lo mismo que Postgres (D-394). 6 939 bytes el 2026-09-26 con las 10 plantillas: cabían.
    // D-412 añadió las dos columnas de prioridad («priority» y «p_priority»): 7 553 con 10, y con la reserva de 800 ya no
    // caben (8 353 de 8 192). Con 9, sí. La guarda lo dice al guardar la décima; no falla en silencio.
    // D-429 sumó la tabla del plan (19 columnas más: las 15 de Órdenes y 4 propias): 12 753 con 10 (modelo, no medida). Una
    // plantilla LLENA —las 48 columnas y las tres tablas movidas— pesa ~1,2 KB: caben 5, y la sexta la para la guarda.
    // D-434 sumó dos columnas al plan (tipo de cliente y ciudad de recogida) y una marca (`_v6`): 13467 con 10 (modelo).
    // D-435 sumó la ciudad de entrega al plan y la marca `_v7`: 13916 con 10 (modelo). En este peor caso ya caben 4 plantillas
    // llenas, no 5: la quinta la para la guarda, que lo dice al guardar.
    // D-443 quitó una (`pl_bordo`: la cuenta de pallets pasó a columna fija): 13916 → 13652 con 10 (modelo). Lo mismo: caben 4.
    // D-444 (sin `p_pallets`: la cuenta ya dice lo de cada parada): 13652 → 13387 con 10 (modelo). Lo mismo: caben 4.
    // D-445 (la ciudad de recogida en paradas y la marca `_v8`): 13387 → 13836 con 10 (modelo).
    expect(bytesEnLaBase(con(MAX_PLANTILLAS))).toBe(13836);
    expect(cabeEnLaFila(con(MAX_PLANTILLAS))).toBe(false);
    // Con D-444 volvían a caber 5 (7 327 + 800 < 8 192). D-445: 5 pesan 7 576 (modelo), 7 576 + 800 = 8 376 > 8 192; caben 4,
    // como tras D-435, y la quinta la para la guarda, que lo dice al guardar. Es el PEOR caso (todo marcado y todo movido).
    expect(cabeEnLaFila(con(4))).toBe(true);
    expect(cabeEnLaFila(con(5))).toBe(false);
    expect(MAX_PLANTILLAS).toBe(10);
  });
  it("los 6 roles llenos + plantillas llenas: la guarda dice cuántas no caben en vez de fallar en silencio", () => {
    const porRol = <T,>(v: T) => Object.fromEntries(ROLES_QUE_ELIGEN.map((r) => [r, v]));
    const con = (n: number) => valorDeColumnas({ visibles: porRol(visiblesLlenas), orden: porRol(ordenLleno), plantillas: Array.from({ length: n }, (_, i) => plantillaLlena(i)) });
    // Con las dos de prioridad (D-412): 3 648 → 3 982 y 9 951 → 10 845; caben 4 y no 5.
    // Con la tabla del plan (D-429): 3 982 → 6 861 sin plantillas, y 18 445 con 10. Los seis roles con TODO marcado y movido
    // aún caben (6 861 + 800 de reserva < 8 192), pero ya no una plantilla llena más. Lo normal —logística y admin con las de
    // por defecto y 10 plantillas de esas— son 4 312 bytes (la prueba de abajo).
    // Con las dos del plan de D-434 y la marca `_v6`: 6 861 → 7 294 sin plantillas y 18 445 → 19 519 con 10. Siguen cabiendo sin plantillas.
    // D-435 (la ciudad de entrega y `_v7`): 7 294 → 7 582 sin plantillas. La FILA sigue cabiendo en la base (< 8 192, que es
    // lo que la 136 rechaza), pero ya no con la reserva de 800 de la guarda: en este peor caso no se puede guardar ninguna
    // plantilla — que ya era así (caben 0, abajo). Marcar, mover o quitar columnas no pasa por la guarda y sigue escribiéndose.
    // D-443 (sin `pl_bordo`): 7 582 → 7 438 sin plantillas.
    // D-444 (sin `p_pallets`: la cuenta ya dice lo de cada parada): 7 438 → 7 293.
    // D-445 (la ciudad de recogida en paradas y `_v8`): 7 293 → 7 581.
    expect(bytesEnLaBase(con(0))).toBe(7581);
    expect(bytesEnLaBase(con(0))).toBeLessThan(TOPE_DE_LA_BASE);
    // Con 7 293 + 800 = 8 093 < 8 192, sin plantillas la guarda volvía a dejar (D-444). D-445: 7 581 + 800 = 8 381 > 8 192,
    // como tras D-435: la fila CABE en la base, pero la guarda para la primera plantilla. Marcar, mover o quitar columnas no
    // pasa por la guarda y sigue escribiéndose.
    expect(cabeEnLaFila(con(0))).toBe(false);
    // D-443 (sin `pl_bordo`): 20 208 → 19 824 con 10. D-444 (sin `p_pallets`): 19 824 → 19 439. D-445: 19 439 → 20 128.
    expect(bytesEnLaBase(con(10))).toBe(20128);
    expect(bytesEnLaBase(con(10))).toBeGreaterThan(TOPE_DE_LA_BASE - RESERVA_PARA_LO_DEMAS);
    expect(cabeEnLaFila(con(10))).toBe(false);
    // Cuántas caben en ese peor caso: lo que cuenta la entrada de DECISIONS.md.
    const caben = Array.from({ length: MAX_PLANTILLAS + 1 }, (_, n) => n).filter((n) => cabeEnLaFila(con(n))).pop();
    // Hasta D-434, 0 (sin plantillas la guarda aún dejaba); desde D-435, ninguna cuenta —ni 0—: la guarda para la primera.
    // Desde D-444, 0 otra vez: sin plantillas cabe, y la primera ya no. D-445: ninguna cuenta otra vez, como tras D-435.
    expect(caben).toBeUndefined();
  });
  it("lo normal con la tabla del plan (D-429): logística y admin con las de por defecto y 10 plantillas de esas caben con holgura", () => {
    const porDefecto = COLUMNAS_DEL_GESTOR_POR_DEFECTO.filter((k) => !MARCAS.includes(k));
    const v = valorDeColumnas({ visibles: { logistics: [...COLUMNAS_DEL_GESTOR_POR_DEFECTO], admin: [...COLUMNAS_DEL_GESTOR_POR_DEFECTO] }, orden: {},
      plantillas: Array.from({ length: MAX_PLANTILLAS }, (_, i) => ({ n: `Logística ${i + 1}`, v: porDefecto })) });
    // D-434: el plan de partida pasa de 10 columnas a 5, así que lo normal pesa menos (4 312 → 3 752).
    // D-435: una columna más de partida (la ciudad de entrega) y la marca `_v7`.
    // D-444 (sin `p_pallets`: la cuenta ya dice lo de cada parada): 25 → 24. D-445 (la ciudad de recogida en paradas): 24 → 25.
    expect(porDefecto).toHaveLength(25);
    expect(bytesEnLaBase(v)).toBe(4157);   // 3 752 → 4 045; D-444 (sin `p_pallets`): 4 045 → 3 864; D-445: 3 864 → 4 157
    expect(cabeEnLaFila(v)).toBe(true);
  });
});

describe("los anchos de paradas, por clave", () => {
  it("de partida, los MISMOS que tenía la tabla por posición (D-408), columna por columna", () => {
    const porPosicion = [40, 110, 140, 70, 120, 56, 110, 150];
    const claves = ["_n", "_factura", "p_type", "p_pallets", "p_address", "p_eta", "p_windows", "_acciones"];
    // D-444 (sin `p_pallets`: la cuenta ya dice lo de cada parada): la del puesto 3 ya no tiene ancho; las demás, los mismos.
    expect(claves.map((k) => anchoDePartidaDeParada(k, COLUMN_WIDTHS))).toEqual(porPosicion.map((w, i) => (i === 3 ? undefined : w)).map((w, i) =>
      // D-446: la partida, más pegada (ID 84, Tipo 100, Ciudad de entrega 172 —cabe «Recoger en RDZ McAllen»—, Llegada 60,
      // Ventanas 100). Lo heredado de `stops8` (la prueba de abajo) no cambia: eso es lo que la persona arrastró.
      // D-456: Llegada 84 (era 60): cuando aún no hay hora la celda dice por qué («calculando…», «tienda sin punto»).
      // D-459: la factura 124 (era 84): lleva su ID al lado, en la misma línea. Y el número de parada 46 (era 40): «✓P».
      // D-485: el número de parada 96 (era 46): el número de PARADA va delante de la P/D de la orden.
      [96, 124, 100, undefined, 172, 84, 100, 150][i] ?? w));
    expect(ANCHO_FIJO_DE_PARADAS._cuenta).toBe(100);
    // Las de Órdenes, con el ancho de Órdenes, como antes (`stopExtraCols.widthOf(deOrdenes)`).
    expect(anchoDePartidaDeParada("p_stage", COLUMN_WIDTHS)).toBe(COLUMN_WIDTHS.stage);
    expect(anchoDePartidaDeParada("p_account", COLUMN_WIDTHS)).toBe(COLUMN_WIDTHS.account);
    // D-443 sumó la cuenta de pallets, fija (`_cuenta`), entre la factura y las elegidas.
    expect(Object.keys(ANCHO_FIJO_DE_PARADAS)).toEqual(["_n", "_factura", "_cuenta", "_acciones"]);
  });
  it("lo arrastrado antes se hereda: por posición de `stops8` y por clave de Órdenes de `stops_extra1`", () => {
    expect(anchosDeParadasHeredados([41, 111, 141, 71, 121, 57, 111, 151], { stage: 200, fee: 90, raro: 5 }))
      .toEqual({ _n: 41, _factura: 111, _acciones: 151, p_type: 141, p_address: 121, p_eta: 57, p_windows: 111, p_stage: 200, p_fee: 90 });   // sin p_pallets (D-444)
    // Lo que no vale no se hereda: una lista de otro largo (la de `stops7` tenía 8, pero otra cosa no), números rotos.
    expect(anchosDeParadasHeredados([1, 2, 3], null)).toEqual({});
    expect(anchosDeParadasHeredados([40, "x", 140, null, 120, 56, 110, 150], "roto")).toEqual({ _n: 40, p_type: 140, p_address: 120, p_eta: 56, p_windows: 110, _acciones: 150 });
  });
  it("se siembra UNA vez: si la llave nueva ya existe no se toca, y sin nada que heredar no se escribe", () => {
    const almacen = (d: Record<string, string>) => ({ d, getItem: (k: string) => d[k] ?? null, setItem: (k: string, v: string) => { d[k] = v; } });
    const a = almacen({ rtg_routes_stops8: JSON.stringify([40, 110, 300, 70, 120, 56, 110, 150]) });
    siembraAnchosDeParadas(a);
    expect(JSON.parse(a.d[LLAVE_DE_ANCHOS_DE_PARADAS]).p_type).toBe(300);
    a.d.rtg_routes_stops8 = JSON.stringify([40, 110, 999, 70, 120, 56, 110, 150]);
    siembraAnchosDeParadas(a);
    expect(JSON.parse(a.d[LLAVE_DE_ANCHOS_DE_PARADAS]).p_type).toBe(300);
    const b = almacen({});
    siembraAnchosDeParadas(b);
    expect(b.d).toEqual({});
  });
});

describe("las pantallas usan las funciones", () => {
  const plano = (s: string) => s.split("\r\n").join("\n").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n").replace(/\s+/g, " ");
  const pagina = plano(readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8"));
  const selector = plano(readFileSync(join(process.cwd(), "src/components/SelectorDeColumnas.tsx"), "utf8"));
  it("los dos ⚙ llevan las flechas de su tabla, con las funciones probadas", () => {
    expect(pagina).toContain('mover={moverEn("sinAsignar")}');
    expect(pagina).toContain('mover={moverEn("paradas")}');
    const m = pagina.slice(pagina.indexOf("const moverEn = "), pagina.indexOf("const alternaColumnaDelGestor"));
    expect(m).toContain("seMueve: (clave: string, delta: -1 | 1) => seMueveEnElGestor(tabla, ordenGestor, clave, delta, colsGestor),");
    expect(m).toContain("onMueve: (clave: string, delta: -1 | 1) => ponOrdenDelGestor(mueveEnElGestor(tabla, ordenGestor, clave, delta, colsGestor)),");
    expect(m).toContain("ordenPropio: tieneOrdenPropio(tabla, ordenGestor),");
    expect(m).toContain("onRestablece: () => ponOrdenDelGestor(restableceOrdenDelGestor(tabla, ordenGestor)),");
  });
  it("el ⚙ pinta las flechas de Órdenes —mismo marcado, mismos rótulos— y «Restablecer orden»", () => {
    expect(selector).toContain('<button type="button" className="btn btn-ghost btn-sm" disabled={!mover.seMueve(c.key, -1)} aria-label={t(`Move ${c.en} up`, `Subir ${c.es}`)} onClick={() => mover.onMueve(c.key, -1)}>↑</button>');
    expect(selector).toContain('<button type="button" className="btn btn-ghost btn-sm" disabled={!mover.seMueve(c.key, 1)} aria-label={t(`Move ${c.en} down`, `Bajar ${c.es}`)} onClick={() => mover.onMueve(c.key, 1)}>↓</button>');
    expect(selector).toContain("{mover?.ordenPropio && <button className=\"notif-clear\" onClick={mover.onRestablece}>{t(\"Reset order\", \"Restablecer orden\")}</button>}");
    expect(selector).toContain('<label className="col-opt" style={{ flex: 1 }}');
  });
  it("el demo guarda el orden en este navegador, por rol, y lo lee saneado", () => {
    expect(pagina).toContain("setOrdenGestor(ordenDelGestorEnElNavegador(localStorage.getItem(claveDelOrdenEnElNavegador(me.role))));");
    expect(pagina).toContain("if (next) localStorage.setItem(claveDelOrdenEnElNavegador(me.role), JSON.stringify(next)); else localStorage.removeItem(claveDelOrdenEnElNavegador(me.role));");
    expect(claveDelOrdenEnElNavegador("logistics")).toBe("rtg_routes_orden_logistics");
    const orden = mueve("sinAsignar", null, "store", -2);
    expect(ordenDelGestorEnElNavegador(JSON.stringify(orden))).toEqual(orden);
    expect(ordenDelGestorEnElNavegador("{roto")).toBeNull();
    expect(ordenDelGestorEnElNavegador(JSON.stringify({ a: 1 }))).toBeNull();
    expect(ordenDelGestorEnElNavegador(null)).toBeNull();
  });
  it("el ⚙ lista la tabla en el orden de la persona: lo movido sale movido en el menú", () => {
    const orden = mueve("sinAsignar", null, "store", -2);
    expect(columnasDelSelector("sinAsignar", orden).map((c) => c.key)).toEqual(sinAsignar(TODAS, orden));
  });
});
