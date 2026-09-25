import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { esDeMisTiendas, esParaRecibir, filtraLaVistaDeAlmacen, intertiendaSinDestino, reparteLaColaDeAlmacen, tiendasDeAlmacen } from "./almacen";
import type { NamedLocation, Stage } from "./types";

/**
 * El reparto de la cola de almacén (D-374).
 *
 * El dueño pidió dos cosas el 2026-09-23: *«warehouse should only see what they are in charge of»* y
 * *«for warehouse a new view where the loads intertienda going to his store will be visible; these
 * orders will be extracted from his list and passed to that one»*.
 *
 * Nada de esto toca la base: la política de la 131 decide **si** puede leer la orden, y esto decide
 * **en qué lista sale**. Por eso se puede medir entero aquí, sin red y sin datos de producción.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

// Tiendas inventadas. A y B trabajan juntas (D-293); C y D son de fuera del grupo.
const TIENDAS: NamedLocation[] = [
  { name: "Tienda A", address: "1 A St", group: "NORTE" },
  { name: "Tienda B", address: "2 B St", group: "NORTE" },
  { name: "Tienda C", address: "3 C St" },
  { name: "Tienda D", address: "4 D St" },
] as NamedLocation[];

const A_TIENDA = { storeToStore: true } as const;
const A_CLIENTE = { storeToStore: false } as const;

const MIAS = ["tienda a", "tienda b"];

describe("cuáles son «mis tiendas» en almacén", () => {
  it("la suya y las que trabajan con ella, normalizadas (D-293)", () => {
    expect(tiendasDeAlmacen("Tienda A", TIENDAS).sort()).toEqual(["tienda a", "tienda b"]);
  });

  it("una tienda sin grupo es ella sola", () => {
    expect(tiendasDeAlmacen("Tienda C", TIENDAS)).toEqual(["tienda c"]);
  });

  it("sin tienda asignada la lista queda VACÍA, y eso más abajo significa «no repartas»", () => {
    // Importa que sea vacía y no «todas»: quien no tiene tienda no puede tener una bandeja de
    // entrada, y adivinársela sería inventarse el criterio.
    expect(tiendasDeAlmacen(null, TIENDAS)).toEqual([]);
    expect(tiendasDeAlmacen("  ", TIENDAS)).toEqual([]);
  });

  it("y el nombre se compara sin distinguir mayúsculas ni espacios de más", () => {
    expect(tiendasDeAlmacen("  tienda   a ", TIENDAS).sort()).toEqual(["tienda a", "tienda b"]);
  });
});

describe("lo que me toca: «alguna tienda de la orden es mía»", () => {
  it("una orden de cliente vendida desde mi tienda, sí", () => {
    expect(esDeMisTiendas({ store: "Tienda A", pickup_name: null, delivery_name: "Casa" }, A_CLIENTE, MIAS)).toBe(true);
  });

  it("una orden de cliente de OTRA tienda, no — esto es lo que almacén dejó de ver", () => {
    expect(esDeMisTiendas({ store: "Tienda C", pickup_name: null, delivery_name: "Casa" }, A_CLIENTE, MIAS)).toBe(false);
  });

  it("una Intertienda que sale de la mía, sí; y la que ENTRA a la mía, también", () => {
    // Las dos son mías: por eso el corte de «lo que me toca» no basta para partir la cola, y hace
    // falta `esParaRecibir` aparte. Si bastara, la vista de Recepción no tendría de dónde salir.
    expect(esDeMisTiendas({ store: "Tienda A", pickup_name: "Tienda A", delivery_name: "Tienda C" }, A_TIENDA, MIAS)).toBe(true);
    expect(esDeMisTiendas({ store: "Tienda C", pickup_name: "Tienda C", delivery_name: "Tienda A" }, A_TIENDA, MIAS)).toBe(true);
  });

  it("una Intertienda entre dos ajenas, no", () => {
    expect(esDeMisTiendas({ store: "Tienda C", pickup_name: "Tienda C", delivery_name: "Tienda D" }, A_TIENDA, MIAS)).toBe(false);
  });

  it("sin tiendas propias no se gana visibilidad por aquí: es `false`, no «todo»", () => {
    expect(esDeMisTiendas({ store: "Tienda A", pickup_name: null, delivery_name: null }, A_CLIENTE, [])).toBe(false);
  });

  it("en una orden de CLIENTE el destino no cuenta aunque se llame como mi tienda", () => {
    // `tiendasDeLaOrden` solo mira `store` cuando el tipo no es tienda-a-tienda, y así tiene que
    // ser: «Tienda A» escrito en el destino de una entrega a cliente es el nombre de un sitio, no
    // una tienda que reciba mercancía.
    const d = { store: "Tienda C", pickup_name: "Tienda A", delivery_name: "Tienda A" };
    expect(esDeMisTiendas(d, A_CLIENTE, MIAS)).toBe(false);
  });
});

describe("qué va a Recepción: entra a una de mis tiendas y no sale de ellas", () => {
  it("la que viene de fuera del grupo a mi tienda: sí", () => {
    expect(esParaRecibir({ store: "Tienda C", pickup_name: "Tienda C", delivery_name: "Tienda A" }, A_TIENDA, MIAS)).toBe(true);
  });

  it("la que sale de mi tienda: no, aunque el destino sea otra tienda", () => {
    expect(esParaRecibir({ store: "Tienda A", pickup_name: "Tienda A", delivery_name: "Tienda C" }, A_TIENDA, MIAS)).toBe(false);
  });

  it("y la que va de una tienda MÍA a otra MÍA tampoco: no se recibe de fuera", () => {
    // Es el caso que obliga a la condición «entra Y no sale». Si solo se mirara el destino, un
    // movimiento entre dos tiendas del mismo grupo saldría de la cola de quien tiene que prepararlo
    // y aparecería en su bandeja de entrada: se escondería trabajo propio.
    expect(esParaRecibir({ store: "Tienda A", pickup_name: "Tienda A", delivery_name: "Tienda B" }, A_TIENDA, MIAS)).toBe(false);
  });

  it("una orden de CLIENTE nunca es recepción, tenga el destino que tenga", () => {
    expect(esParaRecibir({ store: "Tienda C", pickup_name: "Tienda C", delivery_name: "Tienda A" }, A_CLIENTE, MIAS)).toBe(false);
  });

  it("una Intertienda hacia una tienda que no es mía, no", () => {
    expect(esParaRecibir({ store: "Tienda C", pickup_name: "Tienda C", delivery_name: "Tienda D" }, A_TIENDA, MIAS)).toBe(false);
  });

  it("sin destino, no: no se puede clasificar lo que no dice a dónde va", () => {
    expect(esParaRecibir({ store: "Tienda C", pickup_name: "Tienda C", delivery_name: null }, A_TIENDA, MIAS)).toBe(false);
    expect(esParaRecibir({ store: "Tienda C", pickup_name: "Tienda C", delivery_name: "   " }, A_TIENDA, MIAS)).toBe(false);
  });

  it("y sin tiendas propias tampoco: no hay bandeja de entrada de nadie", () => {
    expect(esParaRecibir({ store: "Tienda C", pickup_name: "Tienda C", delivery_name: "Tienda A" }, A_TIENDA, [])).toBe(false);
  });
});

describe("las Intertiendas sin destino se cuentan, no se pierden", () => {
  it("una Intertienda sin `delivery_name` es una de esas", () => {
    expect(intertiendaSinDestino({ delivery_name: null }, A_TIENDA)).toBe(true);
    expect(intertiendaSinDestino({ delivery_name: "  " }, A_TIENDA)).toBe(true);
  });

  it("con destino, no; y una de cliente sin destino tampoco, que ahí es normal", () => {
    expect(intertiendaSinDestino({ delivery_name: "Tienda A" }, A_TIENDA)).toBe(false);
    expect(intertiendaSinDestino({ delivery_name: null }, A_CLIENTE)).toBe(false);
  });
});

describe("el reparto de la cola en dos listas", () => {
  // Una de cada caso, con el tipo escrito en la propia orden para que `reglaDe` lo resuelva como en
  // la pantalla: allí es `orderTypeRule(d.order_type, ajustes)`.
  const ORDENES = [
    { id: "propia-cliente", order_type: "Cliente", store: "Tienda A", pickup_name: null, delivery_name: "Casa" },
    { id: "sale-de-la-mia", order_type: "Entre", store: "Tienda A", pickup_name: "Tienda A", delivery_name: "Tienda C" },
    { id: "entra-a-la-mia", order_type: "Entre", store: "Tienda C", pickup_name: "Tienda C", delivery_name: "Tienda A" },
    { id: "entre-dos-mias", order_type: "Entre", store: "Tienda A", pickup_name: "Tienda A", delivery_name: "Tienda B" },
    { id: "sin-destino", order_type: "Entre", store: "Tienda C", pickup_name: "Tienda C", delivery_name: null },
  ];
  const reglaDe = (d: { order_type?: string | null }) => ({ storeToStore: d.order_type === "Entre" });
  const ids = (l: { id: string }[]) => l.map((d) => d.id).sort();

  it("lo que entra se saca de la cola y se pasa a Recepción, que es lo que pidió el dueño", () => {
    const r = reparteLaColaDeAlmacen(ORDENES, reglaDe, MIAS);
    expect(ids(r.recepcion)).toEqual(["entra-a-la-mia"]);
    expect(ids(r.cola)).toEqual(["entre-dos-mias", "propia-cliente", "sale-de-la-mia", "sin-destino"]);
  });

  it("ninguna orden se pierde ni sale dos veces", () => {
    // **Esta es la prueba que importa de verdad.** Las otras dicen dónde cae cada caso; esta dice
    // que el reparto no se come nada, que es lo que nadie notaría hasta que faltara una orden.
    const r = reparteLaColaDeAlmacen(ORDENES, reglaDe, MIAS);
    expect(r.cola.length + r.recepcion.length).toBe(ORDENES.length);
    expect([...ids(r.cola), ...ids(r.recepcion)].sort()).toEqual(ids([...ORDENES]));
  });

  it("la que no tiene destino se QUEDA en la cola y además se cuenta aparte", () => {
    // Las dos cosas a la vez: que siga estando donde estaba —para que alguien la vea— y que la
    // pantalla pueda decir cuántas son. Medido en producción el 2026-09-23: son 2 de 123.
    const r = reparteLaColaDeAlmacen(ORDENES, reglaDe, MIAS);
    expect(ids(r.sinDestino)).toEqual(["sin-destino"]);
    expect(ids(r.cola)).toContain("sin-destino");
  });

  it("sin tiendas propias NO se reparte nada: todo se queda en la cola", () => {
    const r = reparteLaColaDeAlmacen(ORDENES, reglaDe, []);
    expect(ids(r.cola)).toEqual(ids([...ORDENES]));
    expect(r.recepcion).toEqual([]);
    expect(r.sinDestino).toEqual([]);
  });

  it("y la lista de entrada no se toca", () => {
    const antes = ids([...ORDENES]);
    reparteLaColaDeAlmacen(ORDENES, reglaDe, MIAS);
    expect(ids([...ORDENES])).toEqual(antes);
  });
});

describe("la pantalla de almacén usa el reparto, y no la lista de antes", () => {
  const pagina = leer("src/app/(app)/warehouse/page.tsx");

  it("la Cola se pinta con `reparto.cola`, que es la lista ya sin lo de Recepción", () => {
    // Se cita la expresión entera y no un trozo: `reparto.cola` a secas aparece en varios sitios de
    // este fichero, y una prueba que se cumple por otro renglón se queda verde para siempre.
    //
    // Desde D-NEXT el orden, las cuentas y la pestaña los hace `filtraLaVistaDeAlmacen` (sus pruebas,
    // más abajo); aquí se fija que la Cola se la pide sobre `reparto.cola` y la pinta.
    expect(pagina).toContain("filtraLaVistaDeAlmacen(reparto.cola, filtroCola, dentroDeLaVentana)");
    expect(pagina).toContain('<OrdersTable rows={cola.filas} resizeKey="warehouse"');
    // Y la de antes ya no está: si vuelve, las dos listas discrepan sin avisar.
    expect(pagina).not.toContain("[...scoped].sort((a, b) => b.order_no - a.order_no)");
    expect(pagina).not.toContain("scoped.filter((d) => d.stage === tab)");
  });

  it("los contadores de las pestañas cuentan sobre la cola repartida, no sobre `scoped`", () => {
    // Si contaran sobre `scoped`, la pestaña diría un número y la tabla enseñaría otro: justo el
    // fallo que el reparto en un solo sitio existe para evitar. Las cuentas salen de la misma
    // llamada que las filas (`vista={cola}`).
    expect(pagina).toContain('<FiltrosDeAlmacen key="cola" pestanas={TABS} filtro={filtroCola} onCambio={setFiltroCola} vista={cola} />');
  });

  it("la vista de Recepción existe", () => {
    expect(pagina).toContain('vista === "recepcion"');
  });

  it("almacén no tiene calendario, y su día se calcula en cada pintado", () => {
    // El dueño: *«warehouse, el botón de cambiar date no lo ocupa»*, y preguntado eligió quitarlo.
    //
    // La fecha se calcula, no se guarda: una pestaña abierta toda la noche amanecería enseñando la
    // ruta de ayer, y eso es peor que no tener calendario porque no se nota.
    expect(pagina).toContain("const loadDate = lockedToOwnStore ? todayISO() : fechaElegida;");
    expect(pagina).not.toContain("const [loadDate, setLoadDate]");
    // El campo sigue existiendo para quien NO está fijado a su tienda —el admin ve esta pantalla—,
    // así que se comprueba que está DENTRO de esa condición.
    //
    // Se cita la cadena ENTERA desde la condición hasta el campo, y no «la condición aparece antes
    // del campo»: `{!lockedToOwnStore && (` sale DOS veces en este fichero —la otra es el selector
    // de tienda— y con la primera forma el mutante que quita la condición al calendario sobrevivía,
    // porque la comprobación se cumplía con el bloque del selector.
    const plano = pagina.replace(/\s+/g, " ");
    expect(plano).toContain('{!lockedToOwnStore && ( <label style={{ margin: 0, textTransform: "none",'
      + ' letterSpacing: 0, display: "flex", alignItems: "center", gap: 6 }}> 📅 <input type="date"');
    // Y solo hay UN campo de fecha en la pantalla: si aparece otro suelto, esto lo canta.
    expect(plano.split('<input type="date"').length - 1).toBe(1);
  });

  it("y el aviso de las que no tienen destino sale en la COLA, que es donde están", () => {
    // Estaba en Recepción, y ahí decía algo cierto en el sitio equivocado: esas órdenes se quedan
    // en la Cola, así que quien puede actuar sobre ellas no lo veía. Se fija el sitio, no solo que
    // el texto exista, porque «existe en alguna parte del fichero» es lo que dejó pasar el fallo.
    // Los anclas llevan el `) : ` delante a propósito. Sin él, `vista === "cola" ?` casa primero
    // con el botón de la pestaña, cincuenta líneas más arriba, y el recorte sale vacío: la prueba
    // se pondría verde sin mirar nada. Es la misma trampa que ya costó un informe falso.
    const iCola = pagina.indexOf(') : vista === "cola" ? (');
    const iRec = pagina.indexOf(') : vista === "recepcion" ? (');
    expect([iCola > 0, iRec > iCola]).toEqual([true, true]);
    const cola = pagina.slice(iCola, iRec);
    // Desde D-NEXT cuenta `sinDestino`, las de `reparto.sinDestino` que la Cola enseña con SU
    // búsqueda (la prueba de eso, en «cada vista con su búsqueda» más abajo).
    expect(cola).toContain("{sinDestino.length}");
    expect(cola).toContain("no se pueden mandar a Recepci");
    expect(pagina.slice(iRec)).not.toContain("{sinDestino.length}");
  });
});

describe("la búsqueda y las pastillas de una vista de almacén (D-NEXT)", () => {
  // El dueño, el 2026-09-25: «THE SAME FILTERS AND SEARCH BAR MOVE IT INTO RECEIVING WAREHOUSE».
  // Estas pruebas miden la función; las de abajo, que las dos vistas la usan.
  const o = (order_no: number, stage: string, invoice_num: string | null, dentro = true) =>
    ({ id: `o${order_no}`, order_no, stage, invoice_num, dentro }) as { id: string; order_no: number; stage: Stage; invoice_num: string | null; dentro: boolean };
  // Desordenadas a propósito: una prueba de orden con datos ya ordenados pasa con cualquier orden.
  const LISTA = [
    o(12, "ready", "INV-500"),
    o(30, "approved", "INV-777"),
    o(5, "approved", "inv-501"),
    o(21, "delivered", "INV-900", false), // vieja y cerrada: fuera de la ventana
  ];
  const ventana = (d: { dentro: boolean }) => d.dentro;
  const nums = (l: { order_no: number }[]) => l.map((d) => d.order_no);

  it("sin buscar, la ventana decide qué entra, y las cuentas son por etapa", () => {
    const v = filtraLaVistaDeAlmacen(LISTA, { q: "", tab: "all" }, ventana);
    expect(nums(v.visibles).sort((a, b) => a - b)).toEqual([5, 12, 30]);
    expect(v.cuentas).toEqual({ ready: 1, approved: 2 });
  });

  it("buscando, se busca en la factura sin distinguir mayúsculas, y SE SALTA la ventana", () => {
    // La de la ventana es la 21: buscarla la trae, que es el camino al historial (D-239).
    expect(nums(filtraLaVistaDeAlmacen(LISTA, { q: " inv-9 ", tab: "all" }, ventana).filas)).toEqual([21]);
    expect(nums(filtraLaVistaDeAlmacen(LISTA, { q: "INV-50", tab: "all" }, ventana).filas)).toEqual([12, 5]);
    // Y lo que no casa no sale, aunque esté dentro de la ventana.
    expect(filtraLaVistaDeAlmacen(LISTA, { q: "nada", tab: "all" }, ventana).visibles).toEqual([]);
  });

  it("«Todas» ordena de la más nueva a la más vieja; una etapa deja solo las suyas", () => {
    expect(nums(filtraLaVistaDeAlmacen(LISTA, { q: "", tab: "all" }, ventana).filas)).toEqual([30, 12, 5]);
    expect(nums(filtraLaVistaDeAlmacen(LISTA, { q: "", tab: "approved" }, ventana).filas)).toEqual([30, 5]);
    expect(nums(filtraLaVistaDeAlmacen(LISTA, { q: "", tab: "ready" }, ventana).filas)).toEqual([12]);
  });

  it("la pestaña no cambia las cuentas: las pastillas cuentan todas las etapas de lo buscado", () => {
    const v = filtraLaVistaDeAlmacen(LISTA, { q: "", tab: "ready" }, ventana);
    expect(v.cuentas).toEqual({ ready: 1, approved: 2 });
    expect(v.visibles.length).toBe(3);
  });
});

describe("Recepción tiene la misma barra y las mismas pastillas que la Cola, con su propio estado", () => {
  const pagina = leer("src/app/(app)/warehouse/page.tsx");
  const barra = leer("src/components/FiltrosDeAlmacen.tsx");

  it("Recepción se filtra con la misma función, sobre `reparto.recepcion` y con SU filtro", () => {
    expect(pagina).toContain("filtraLaVistaDeAlmacen(reparto.recepcion, filtroRecepcion, dentroDeLaVentana)");
    expect(pagina).toContain("rows={recepcion.filas}");
  });

  it("y pinta el MISMO componente de filtros, con el estado de Recepción", () => {
    expect(pagina).toContain('<FiltrosDeAlmacen key="recepcion" pestanas={TABS} filtro={filtroRecepcion} onCambio={setFiltroRecepcion} vista={recepcion} />');
    // Ninguna barra escrita a mano en la página: si vuelve una copia, las dos se separan.
    expect(pagina).not.toContain("<input\n            style={{ maxWidth: 260 }}");
    expect(pagina).not.toContain('placeholder={t("Search invoice #');
  });

  it("cada vista guarda su búsqueda y su pestaña; la búsqueda ya no se aplica antes del reparto", () => {
    expect(pagina).toContain('useState<FiltroDeVista>({ q: "", tab: "approved" })');
    expect(pagina).toContain('useState<FiltroDeVista>({ q: "", tab: "all" })');
    // Lo que se reparte es lo de sus tiendas sin buscar: si la búsqueda volviera a `scoped`, una
    // barra filtraría las dos listas a la vez.
    expect(pagina).toContain("deliveries.filter((d) => atStore(d))");
    expect(pagina).not.toMatch(/const \[q, setQ\]/);
  });

  it("el aviso de sin destino cuenta solo las que la Cola enseña con su búsqueda", () => {
    expect(pagina).toContain("const enLaCola = new Set(cola.visibles);");
    expect(pagina).toContain("return reparto.sinDestino.filter((d) => enLaCola.has(d));");
  });

  it("el contador de la pestaña Recepción cuenta lo que Recepción enseña en todas sus etapas", () => {
    expect(pagina).toContain('{t("Receiving", "Recepción")} <span className="cnt">{recepcion.visibles.length}</span>');
  });

  it("la barra busca, cambia de pestaña y cuenta con lo que le llega, sin estado propio", () => {
    expect(barra).toContain("onChange={(e) => onCambio({ ...filtro, q: e.target.value })}");
    expect(barra).toContain("onClick={() => onCambio({ ...filtro, tab: tb.key })}");
    expect(barra).toContain('{tb.key === "all" ? vista.visibles.length : (vista.cuentas[tb.key] ?? 0)}');
    expect(barra).toContain('className={"chip " + (filtro.tab === tb.key ? "on" : "")}');
    expect(barra).not.toContain("useState");
  });
});
