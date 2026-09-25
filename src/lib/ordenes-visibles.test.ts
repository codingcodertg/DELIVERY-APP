import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { coincideConLaBusqueda, leTocaPorRol, ordenesVisibles, pasaLaVentana, type ContextoDeLista } from "./ordenes-visibles";
import { documentoPendiente } from "./documento-pendiente";
import { mkDelivery } from "./__fixtures";
import { seesAllHistory, shiftDateISO, todayISO } from "./utils";
import type { OrderTypeRules } from "./required";
import type { Delivery, NamedLocation } from "./types";

/**
 * Las dos listas de Órdenes (D-313).
 *
 * El dueño: *«invoice pending must be visible for office too»*. No era permiso: la pestaña cuenta
 * sobre lo que la persona ve, y lo que office ve lo corta la ventana de D-239. Las pendientes están
 * todas entregadas —o sea, viejas—, así que la cuenta era 0 y la pestaña ni se pintaba.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

const HOY = todayISO();
const ANTIER = shiftDateISO(HOY, -20);
const AYER = shiftDateISO(HOY, -1);
const HACE_CINCUENTA = shiftDateISO(HOY, -50);

// Tipos inventados: qué documento pide cada tipo es dato del dueño (Ajustes) y no se afirma aquí.
const REGLAS: OrderTypeRules = {
  ConFactura: { docRef: "invoice" },
  SinDocumento: { docRef: "none" },
  Entre: { docRef: "po", storeToStore: true },
};
const TIENDAS: NamedLocation[] = [{ name: "Norte" }, { name: "Sur" }] as NamedLocation[];

const ctx = (over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
  me: { id: "u-office", role: "accounting", store: null },
  teaching: false,
  veTodoElHistorial: false,
  busqueda: "",
  reglas: REGLAS,
  tiendas: TIENDAS,
  // Vacío por defecto: estas pruebas son de oficina, y con la lista vacía el corte de almacén no
  // recorta nada (`reparteLaColaDeAlmacen` no reparte sin saber cuál es «mi tienda»). Quien quiera
  // medir ese corte lo pasa explícito, que es lo que hace el bloque de almacén de más abajo.
  tiendasDeAlmacen: [],
  ...over,
});

/** Entregada hace 20 días, de tipo «pide factura», sin factura: trabajo vivo con la orden ya vieja. */
const pendienteVieja = (over: Partial<Delivery> = {}) => mkDelivery({
  id: "vieja", stage: "delivered", order_type: "ConFactura", invoice_num: null,
  delivery_date: ANTIER, store: "Norte", created_by: "u-otro", ...over,
});

const ids = (l: Delivery[]) => l.map((d) => d.id).sort();

describe("lo que el dueño pidió: office ve sus facturas pendientes", () => {
  it("una entregada de hace 20 días sin factura sale en la pestaña y NO en «Todas»", () => {
    const d = pendienteVieja();
    // Control: sin la exención se caería por la ventana, que es lo que pasaba.
    expect(documentoPendiente(d, REGLAS)).not.toBeNull();
    const { visibles, conPendientes } = ordenesVisibles([d], ctx());
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual(["vieja"]);
  });

  it("con la factura puesta no sale en ninguna de las dos: ya no es trabajo vivo", () => {
    const d = pendienteVieja({ invoice_num: "F-1" });
    expect(documentoPendiente(d, REGLAS)).toBeNull();
    const { visibles, conPendientes } = ordenesVisibles([d], ctx());
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual([]);
  });

  it("la vista normal NO se relaja: una entregada vieja CON su factura sigue fuera", () => {
    // Si la exención valiera para toda la tabla, a office se le llenaría la lista de entregadas de
    // hace un mes, que es justo lo que D-239 vino a quitar.
    const conDoc = pendienteVieja({ id: "condoc", invoice_num: "F-2" });
    const sinDoc = pendienteVieja({ id: "sindoc", order_type: "SinDocumento" });
    const { visibles } = ordenesVisibles([conDoc, sinDoc], ctx());
    expect(ids(visibles)).toEqual([]);
  });

  it("lo de dentro de la ventana sigue en las dos listas", () => {
    const reciente = pendienteVieja({ id: "reciente", delivery_date: AYER });
    const { visibles, conPendientes } = ordenesVisibles([reciente], ctx());
    expect(ids(visibles)).toEqual(["reciente"]);
    expect(ids(conPendientes)).toEqual(["reciente"]);
  });

  it("`conPendientes` contiene a `visibles`: la pestaña nunca enseña menos que la lista", () => {
    const lista = [
      pendienteVieja({ id: "a" }),
      pendienteVieja({ id: "b", delivery_date: AYER }),
      pendienteVieja({ id: "c", invoice_num: "F-3" }),
      pendienteVieja({ id: "d", delivery_date: AYER, invoice_num: "F-4" }),
    ];
    const { visibles, conPendientes } = ordenesVisibles(lista, ctx());
    for (const v of visibles) expect([v.id, conPendientes.includes(v)]).toEqual([v.id, true]);
  });
});

describe("una factura pendiente no es una llave para ver órdenes de otro", () => {
  const vendedor = { id: "u-vend", role: "sales" as const, store: "Norte" };

  it("la orden de otro vendedor no sale, ni en la pestaña", () => {
    const deOtro = pendienteVieja({ id: "de-otro", created_by: "u-otro", assigned_sales_rep: "u-otro", store: "Sur" });
    // Control: le falta el documento, así que lo único que la deja fuera es el corte por rol.
    expect(documentoPendiente(deOtro, REGLAS)).not.toBeNull();
    const { visibles, conPendientes } = ordenesVisibles([deOtro], ctx({ me: vendedor }));
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual([]);
  });

  it("la suya, vieja y sin factura, sí sale en la pestaña", () => {
    const suya = pendienteVieja({ id: "suya", created_by: "u-vend", assigned_sales_rep: "u-vend" });
    const { visibles, conPendientes } = ordenesVisibles([suya], ctx({ me: vendedor }));
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual(["suya"]);
  });

  it("una anulada suya sigue sin salir, y es el corte por rol quien la quita", () => {
    // Dentro de la ventana A PROPÓSITO: con una anulada vieja la prueba pasaría igual sin el corte
    // —la ventana ya la tiraba— y no mediría nada. Medido: con el corte quitado, esta cae.
    const anulada = pendienteVieja({ id: "anulada", stage: "canceled", delivery_date: AYER, created_by: "u-vend" });
    expect(pasaLaVentana(anulada, ctx({ me: vendedor }), false)).toBe(true);
    const { visibles, conPendientes } = ordenesVisibles([anulada], ctx({ me: vendedor }));
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual([]);
  });

  it("almacén sigue sin ver lo anterior a la aprobación aunque le falte el documento", () => {
    const almacen = { id: "u-alm", role: "warehouse" as const, store: "Norte" };
    const pendiente = pendienteVieja({ id: "pend", stage: "pending", delivery_date: AYER });
    const aprobada = pendienteVieja({ id: "apr", stage: "approved", delivery_date: AYER });
    const { visibles, conPendientes } = ordenesVisibles([pendiente, aprobada], ctx({ me: almacen }));
    expect(ids(visibles)).toEqual(["apr"]);
    expect(ids(conPendientes)).toEqual(["apr"]);
  });
});

// Este bloque se llamaba «el suelo de 30 días de ventas»: buscando, ventas llegaba 30 días atrás y
// los demás al historial entero. Desde D-392 buscar tiene el mismo suelo que navegar —ayer— para
// todos menos admin y logística, así que el tope de ventas ya no decidía nada y se quitó.
describe("buscando, el suelo es ayer para todos menos admin y logística (D-392)", () => {
  const vendedor = { id: "u-vend", role: "sales" as const, store: "Norte" };
  const suya = (over: Partial<Delivery> = {}) => pendienteVieja({ created_by: "u-vend", assigned_sales_rep: "u-vend", ...over });

  it("ventas no encuentra ni lo de hace 50 días ni lo de hace 20, que antes sí encontraba", () => {
    const antigua = suya({ id: "antigua", delivery_date: HACE_CINCUENTA, invoice_num: "F-9", account: "ACME" });
    const reciente = suya({ id: "de-hace-20", delivery_date: ANTIER, invoice_num: "F-8", account: "ACME" });
    const deAyer = suya({ id: "de-ayer", delivery_date: AYER, invoice_num: "F-7", account: "ACME" });
    const { visibles } = ordenesVisibles([antigua, reciente, deAyer], ctx({ me: vendedor, busqueda: "acme" }));
    // Control: la de ayer sí sale, así que la búsqueda casa y lo que corta es la fecha.
    expect(ids(visibles)).toEqual(["de-ayer"]);
  });

  it("pero no tapa la pestaña: su pendiente de hace 50 días se busca igual ahí dentro (D-313 sigue)", () => {
    // Una factura pendiente es trabajo vivo; D-392 deja en pie esa exención, solo en su pestaña.
    const antigua = suya({ id: "antigua", delivery_date: HACE_CINCUENTA, account: "ACME" });
    const { visibles, conPendientes } = ordenesVisibles([antigua], ctx({ me: vendedor, busqueda: "acme" }));
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual(["antigua"]);
  });

  it("office buscando tampoco llega a una entregada vieja; logística sí", () => {
    const antigua = pendienteVieja({ id: "antigua", delivery_date: HACE_CINCUENTA, invoice_num: "F-9", account: "ACME" });
    expect(seesAllHistory("accounting")).toBe(false);
    expect(ids(ordenesVisibles([antigua], ctx({ busqueda: "acme", veTodoElHistorial: seesAllHistory("accounting") })).visibles)).toEqual([]);
    const logistica = ctx({ me: { id: "u-log", role: "logistics", store: null }, busqueda: "acme", veTodoElHistorial: seesAllHistory("logistics") });
    expect(ids(ordenesVisibles([antigua], logistica).visibles)).toEqual(["antigua"]);
  });
});

describe("las piezas por separado", () => {
  it("`pasaLaVentana` sin la exención es la retención de siempre", () => {
    const vieja = pendienteVieja();
    expect(pasaLaVentana(vieja, ctx(), false)).toBe(false);
    expect(pasaLaVentana(vieja, ctx(), true)).toBe(true);
    // Y la exención no inventa nada donde no hay documento pendiente.
    expect(pasaLaVentana(pendienteVieja({ invoice_num: "F-1" }), ctx(), true)).toBe(false);
  });

  it("quien ve el historial entero pasa las dos, y el sandbox de enseñanza también", () => {
    const vieja = pendienteVieja({ invoice_num: "F-1" });
    expect(pasaLaVentana(vieja, ctx({ veTodoElHistorial: true }), false)).toBe(true);
    expect(pasaLaVentana(vieja, ctx({ teaching: true }), false)).toBe(true);
    expect(leTocaPorRol(vieja, ctx({ me: { id: "x", role: "sales", store: "Sur" }, teaching: true }))).toBe(true);
  });

  it("`coincideConLaBusqueda` mira los campos de la orden, y sin búsqueda todo coincide", () => {
    const d = mkDelivery({ account: "Ferretería Sur", invoice_num: "F-77" });
    expect(coincideConLaBusqueda(d, "")).toBe(true);
    expect(coincideConLaBusqueda(d, "  ")).toBe(true);
    expect(coincideConLaBusqueda(d, "ferretería")).toBe(true);
    expect(coincideConLaBusqueda(d, "F-77")).toBe(true);
    expect(coincideConLaBusqueda(d, "norte")).toBe(false);
  });

  it("la búsqueda se aplica ANTES de la exención: la pestaña no ignora lo tecleado", () => {
    const vieja = pendienteVieja({ account: "ACME" });
    const { conPendientes } = ordenesVisibles([vieja], ctx({ busqueda: "otra cosa" }));
    expect(ids(conPendientes)).toEqual([]);
  });
});

describe("almacén: solo sus tiendas, también en el tablero (D-374)", () => {
  // El dueño: *«warehouse should only see what they are in charge of»*. El corte ya existía, pero
  // **solo en su propia cola** (`warehouse/page.tsx`): en Órdenes veía las de todas las tiendas. Es
  // el mismo corte, en la otra pantalla, con la misma función —`esDeMisTiendas`— y no una copia.
  const almacen = (over: Partial<ContextoDeLista> = {}) => ctx({
    me: { id: "u-almacen", role: "warehouse", store: "Norte" },
    tiendasDeAlmacen: ["norte"],
    ...over,
  });
  const aprobada = (over: Partial<Delivery> = {}) => mkDelivery({
    id: "x", stage: "approved", order_type: "SinDocumento", delivery_date: HOY, ...over,
  });

  it("una aprobada de su tienda sí, y la misma de otra tienda NO", () => {
    expect(leTocaPorRol(aprobada({ id: "mia", store: "Norte" }), almacen())).toBe(true);
    expect(leTocaPorRol(aprobada({ id: "ajena", store: "Sur" }), almacen())).toBe(false);
  });

  it("y la Intertienda que ENTRA a su tienda también: es la que luego sale en Recepción", () => {
    // Si este corte la dejara fuera, la vista de Recepción no tendría de dónde sacarla: reparte lo
    // que ya es visible, no abre nada.
    const entra = aprobada({ id: "entra", order_type: "Entre", store: "Sur", pickup_name: "Sur", delivery_name: "Norte" });
    expect(leTocaPorRol(entra, almacen())).toBe(true);
  });

  it("sin tienda asignada NO se acota: se ve todo, en vez de la pantalla en blanco", () => {
    // Cero órdenes se lee como una app rota; todas se lee como una configuración que falta, y eso
    // se arregla en Usuarios. Es la misma elección que hace `reparteLaColaDeAlmacen`.
    expect(leTocaPorRol(aprobada({ store: "Sur" }), almacen({ me: { id: "u", role: "warehouse", store: null }, tiendasDeAlmacen: [] }))).toBe(true);
  });

  it("el corte por etapa de siempre sigue: un borrador de su propia tienda tampoco", () => {
    expect(leTocaPorRol(aprobada({ stage: "draft", store: "Norte" }), almacen())).toBe(false);
  });

  it("y una ENTREGADA vieja ya no le sale, porque vuelve a entrar en la ventana", () => {
    // Esto es lo que revierte D-356 desde la otra punta. Mientras almacén trajo `history` de
    // fábrica, `veTodoElHistorial` era `true` en esta pantalla y la orden entregada de hace 50 días
    // salía igual. La cadena entera: `ROLE_CAPS` → `seesAllHistory` → `veTodoElHistorial` (que el
    // tablero calcula en `page.tsx:47`) → esta función.
    //
    // Se afirma el primer eslabón aquí mismo: si esta prueba solo pusiera `veTodoElHistorial: false`
    // a mano, mediría un booleano que me he inventado yo, y seguiría verde aunque `ROLE_CAPS` le
    // devolviera el historial a almacén mañana.
    expect(seesAllHistory("warehouse")).toBe(false);
    const vieja = aprobada({ id: "agosto", stage: "delivered", store: "Norte", delivery_date: HACE_CINCUENTA });
    const { visibles } = ordenesVisibles([vieja], almacen({ veTodoElHistorial: seesAllHistory("warehouse") }));
    expect(ids(visibles)).toEqual([]);
    // Y con la casilla marcada a esa persona, vuelve: la capacidad suelta no se quitó.
    const { visibles: conLlave } = ordenesVisibles([vieja], almacen({ veTodoElHistorial: seesAllHistory("warehouse", ["history"]) }));
    expect(ids(conLlave)).toEqual(["agosto"]);
  });
});

describe("la pantalla le pide las dos listas a la función", () => {
  const pagina = leer("src/app/(app)/page.tsx");
  const llano = plano(pagina);

  it("no arma la lista a mano: la pide, con sus datos", () => {
    // D-384 añadió la tercera lista, `atrasadas`, para la pastilla «Outdated».
    // D-392 quitó `sueloDeVentas`: con el suelo en ayer para todos, el tope de 30 días no decidía nada.
    expect(llano).toContain("const { visibles: visible, conPendientes, atrasadas } = useMemo(");
    const i = llano.indexOf("ordenesVisibles(deliveries, {");
    expect(i).toBeGreaterThan(-1);
    const args = llano.slice(i, llano.indexOf("})", i));
    for (const dato of ["me,", "teaching,", "veTodoElHistorial,", "busqueda: q,",
      "reglas: settings.order_type_rules ?? {},", "tiendas: settings.stores,"]) {
      expect(args, dato).toContain(dato);
    }
  });

  it("la cuenta de la pestaña y sus filas salen de `conPendientes`, no de `visible`", () => {
    // Las dos tienen que salir de la MISMA lista: con la cuenta sobre una y las filas sobre otra, la
    // pestaña diría un número y enseñaría otro.
    // D-380 partió la línea: el CONJUNTO que se cuenta sigue siendo `conPendientes`, que es lo
    // que esta prueba defiende; encima se le añadió el chip de fecha, pero solo cuando la pestaña
    // está puesta, y entonces las filas pasan por el mismo chip. Siguen saliendo de la misma lista.
    // D-384 llevó las cuentas y las filas a `filas-de-ordenes.ts`, donde además se prueban con
    // datos; las líneas que esta prueba defendía están allí, y la pantalla le pasa las listas.
    const filas = plano(leer("src/lib/filas-de-ordenes.ts"));
    expect(filas).toContain("const pendientes = listas.conPendientes.filter((d) => facturaPendiente(d, reglas));");
    expect(filas).toContain("c[PESTANA_DOCUMENTO_PENDIENTE] = (filtro === PESTANA_DOCUMENTO_PENDIENTE ? pendientes.filter(pasaElPreset) : pendientes).length;");
    expect(filas).toContain("return listas.conPendientes.filter((d) => facturaPendiente(d, reglas) && pasaElPreset(d));");
    expect(llano).toContain("const listas = useMemo(() => ({ visibles: visible, conPendientes, atrasadas }), [visible, conPendientes, atrasadas]);");
  });

  it("y las cuentas de etapa y «Todas» siguen saliendo de la lista normal", () => {
    // Si «Todas» contara sobre `conPendientes`, su número dejaría de cuadrar con lo que la tabla
    // enseña al pulsarla.
    // Desde D-357 pasan además por el chip de fechas, el mismo que filtra la lista; siguen sin mirar `conPendientes`.
    const filas = plano(leer("src/lib/filas-de-ordenes.ts"));
    expect(filas).toContain("const enElPreset = listas.visibles.filter(pasaElPreset);");
    expect(filas).toContain("const c: Record<string, number> = { [PASTILLA_TODAS]: enElPreset.length };");
    expect(filas).not.toContain("enElPreset = listas.conPendientes");
  });
});
