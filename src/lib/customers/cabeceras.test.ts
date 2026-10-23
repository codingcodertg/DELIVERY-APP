import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIN_VALOR } from "@/lib/orden-y-filtro";
import {
  alPulsarCabecera, esOrdenInicial, filtraEmpresas, MAX_NIVELES, nivelDeOrden, opcionesDeColumna, ordenDesdeMenu, ORDENES_INICIALES,
} from "./cabeceras";
import { agrupaEnEmpresas, ordenarEmpresas } from "./empresas";
import {
  colocaColumnaDeClientes, columnasAPintar, columnasDelSelector, FILTRO_INICIAL, ordenarEnNiveles, PREFERENCIA_INICIAL, type Cliente, type Orden,
} from "./reglas";

/** Las cabeceras de Clientes (D-NEXT): orden en tres niveles, filtro por columna y arrastre de columnas. Datos inventados. */
const t = (en: string, _es: string) => en;
const base = (n: number, c: Partial<Cliente>): Cliente => ({
  id: n, store: "MCA", account: `Cuenta ${n}`, unified_account: null, house_no: null, added_batch: null, qb_status: null, activity_status: null,
  status_store: null, status_group: null, history_store: null, history_group: null, crm_type_store: null, crm_type_group: null, associated_with: null,
  rep_history: null, rep_qb: null, rep_store: null, contact_name: null, contact_title: null, address: null, phone: null, email: null,
  credit_limit: null, euler_limit: null, terms: null, account_no: null, notes: null, updated_at: null, updated_by: null, archived_at: null,
  archived_reason: null, company_id: `e${n}`, ...c,
});

// Pensadas para que una implementación mala se note: en McAllen las dos empatan en tienda y en estado, y el nivel 3
// (vendedor) las pone al revés que la cuenta y que el id; en Pharr el nivel 2 descendente pone primero la que tiene el
// vendedor y la cuenta de en medio, y el vendedor solo no daría ese orden.
const LISTA: Cliente[] = [
  base(1, { account: "Delta Pisos", store: "PHR", status_store: "NEW", rep_store: "AA" }),
  base(2, { account: "Alfa Obras", store: "MCA", status_store: "LOST", rep_store: "ZZ" }),
  base(3, { account: "Charlie Casas", store: "PHR", status_store: "NEW", rep_store: "CC" }),
  base(4, { account: "Bravo Tile", store: "PHR", status_store: "LOST", rep_store: "ZZ" }),
  base(5, { account: "Echo Hogar", store: "MCA", status_store: "LOST", rep_store: "BB" }),
  base(6, { account: "Foxtrot Design", store: "PHR", status_store: "NEW", rep_store: "BB" }),
];
const TRES: Orden[] = [{ por: "store", desc: false }, { por: "status_store", desc: true }, { por: "rep_store", desc: false }];
const ids = (l: readonly { id: number }[]) => l.map((c) => c.id);

describe("orden en niveles: el 1 manda, el 2 desempata, el 3 es el último", () => {
  it("con tres niveles, el 2 y el 3 solo deciden entre las que empatan en los de arriba", () => {
    // MCA (2, 5): empatan en tienda y estado; el vendedor BB < ZZ pone la 5 primero, aunque «Alfa» < «Echo» y 2 < 5.
    // PHR (1, 3, 4, 6): LOST antes que NEW (estado descendente); entre las NEW, por vendedor AA, BB, CC.
    expect(ids(ordenarEnNiveles(LISTA, TRES))).toEqual([5, 2, 4, 1, 6, 3]);
  });
  it("la pantalla ordena EMPRESAS por la fila que se pinta, con los mismos niveles", () => {
    const e = ordenarEmpresas(agrupaEnEmpresas(LISTA, FILTRO_INICIAL), TRES);
    expect(e.map((x) => x.principal.id)).toEqual([5, 2, 4, 1, 6, 3]);
  });
  it("cada nivel con su sentido: el 3 descendente da la vuelta solo dentro de los empates", () => {
    const tresAlReves: Orden[] = [TRES[0], TRES[1], { por: "rep_store", desc: true }];
    expect(ids(ordenarEnNiveles(LISTA, tresAlReves))).toEqual([2, 5, 4, 3, 6, 1]);
  });
  it("con un solo nivel, lo de antes: lo empatado va por cuenta", () => {
    expect(ids(ordenarEnNiveles(LISTA, [{ por: "store", desc: false }]))).toEqual([2, 5, 4, 3, 1, 6]);
  });
});

describe("pulsar una cabecera y el menú", () => {
  const dos: Orden[] = [{ por: "store", desc: false }, { por: "status_store", desc: true }];
  it("clic: solo por esa columna; otra vez, al revés (como hasta hoy)", () => {
    expect(alPulsarCabecera(dos, "rep_store", false)).toEqual([{ por: "rep_store", desc: false }]);
    expect(alPulsarCabecera([{ por: "account", desc: false }], "account", false)).toEqual([{ por: "account", desc: true }]);
  });
  it("Mayús+clic: siguiente nivel; con tres puestos, sustituye al tercero", () => {
    const tres = alPulsarCabecera(dos, "rep_store", true);
    expect(tres).toEqual([...dos, { por: "rep_store", desc: false }]);
    expect(tres).toHaveLength(MAX_NIVELES);
    expect(alPulsarCabecera(tres, "phone", true)).toEqual([...dos, { por: "phone", desc: false }]);
  });
  it("pulsar una que ya ordena le da la vuelta en SU nivel, sin tocar los demás", () => {
    expect(alPulsarCabecera(dos, "store", false)).toEqual([{ por: "store", desc: true }, { por: "status_store", desc: true }]);
    expect(alPulsarCabecera(dos, "status_store", true)).toEqual([{ por: "store", desc: false }, { por: "status_store", desc: false }]);
  });
  it("cada cabecera sabe su número y su flecha", () => {
    expect(nivelDeOrden(dos, "status_store")).toEqual({ nivel: 2, desc: true });
    expect(nivelDeOrden(dos, "store")).toEqual({ nivel: 1, desc: false });
    expect(nivelDeOrden(dos, "phone")).toBeNull();
  });
  it("menú: ↑/↓ en una que ordena cambia su sentido en su nivel; en otra, solo por ella", () => {
    expect(ordenDesdeMenu(dos, "status_store", "asc")).toEqual([{ por: "store", desc: false }, { por: "status_store", desc: false }]);
    expect(ordenDesdeMenu(dos, "phone", "desc")).toEqual([{ por: "phone", desc: true }]);
  });
  it("menú «Quitar orden»: esa sale y las de debajo suben; sin ninguna, el de entrada", () => {
    const tres: Orden[] = [...dos, { por: "rep_store", desc: false }];
    expect(ordenDesdeMenu(tres, "status_store", null)).toEqual([{ por: "store", desc: false }, { por: "rep_store", desc: false }]);
    expect(ordenDesdeMenu([{ por: "phone", desc: true }], "phone", null)).toEqual([...ORDENES_INICIALES]);
  });
  it("«Quitar orden» de arriba solo sale si hay algo que quitar", () => {
    expect(esOrdenInicial(ORDENES_INICIALES)).toBe(true);
    expect(esOrdenInicial([{ por: "account", desc: true }])).toBe(false);
    expect(esOrdenInicial([ORDENES_INICIALES[0], { por: "store", desc: false }])).toBe(false);
  });
});

describe("filtro por columna, sobre las empresas", () => {
  // Acme: dos tiendas; se pinta la de Pharr (la más completa), que es NEW; la de Brownsville es LOST.
  const CON_EMPRESA: Cliente[] = [
    ...LISTA,
    base(7, { account: "Acme Pisos", store: "BRO", company_id: "ACME", status_store: "LOST" }),
    base(8, { account: "Acme Pisos", store: "PHR", company_id: "ACME", status_store: "NEW", phone: "956-555-0100", rep_store: "AA" }),
    base(9, { account: "Sin Estado SA", store: "WES", status_store: null, updated_at: "2026-10-20T09:00:00Z" }),
    base(10, { account: "Otra Sin Estado", store: "WES", status_store: null, updated_at: "2026-10-20T17:30:00Z" }),
  ];
  const empresas = agrupaEnEmpresas(CON_EMPRESA, FILTRO_INICIAL);
  const pintadas = (l: ReturnType<typeof filtraEmpresas>) => l.map((e) => e.principal.id).sort((a, b) => a - b);

  it("filtra por la fila que se pinta: Acme pinta NEW, así que «LOST» no la trae", () => {
    expect(pintadas(filtraEmpresas(empresas, { status_store: new Set(["LOST"]) }))).toEqual([2, 4, 5]);
    expect(pintadas(filtraEmpresas(empresas, { status_store: new Set(["NEW"]) }))).toEqual([1, 3, 6, 8]);
  });
  it("«Tienda» mira todas las tiendas que pinta la celda: Brownsville trae a Acme, que se pinta en Pharr", () => {
    expect(pintadas(filtraEmpresas(empresas, { store: new Set(["BRO"]) }))).toEqual([8]);
  });
  it("el «sin valor» se marca como cualquier otro; dos columnas se suman (y las dos tienen que pasar)", () => {
    expect(pintadas(filtraEmpresas(empresas, { status_store: new Set([SIN_VALOR]) }))).toEqual([9, 10]);
    expect(pintadas(filtraEmpresas(empresas, { store: new Set(["PHR"]), status_store: new Set(["NEW"]), rep_store: new Set(["BB"]) }))).toEqual([6]);
  });
  it("un filtro vacío no filtra", () => {
    expect(filtraEmpresas(empresas, { status_store: new Set() })).toHaveLength(empresas.length);
  });
  it("las casillas de un menú: lo que quedaría sin SU filtro, con lo de las otras columnas puesto (en cascada)", () => {
    // Su propio filtro no le quita casillas: con «Lost» marcado, el menú de Estado sigue ofreciendo las tres.
    expect(opcionesDeColumna(empresas, { status_store: new Set(["LOST"]) }, "status_store", t).map((o) => o.label)).toEqual(["—", "Lost", "New"]);
    // El de otra columna, sí: con «Lost», el de Tienda solo ofrece donde hay LOST pintadas.
    expect(opcionesDeColumna(empresas, { status_store: new Set(["LOST"]) }, "store", t).map((o) => o.label)).toEqual(["RDZ McAllen", "RDZ Pharr"]);
    const filtros = { store: new Set(["MCA"]), status_store: new Set(["LOST"]) };
    expect(opcionesDeColumna(empresas, filtros, "rep_store", t).map((o) => o.label)).toEqual(["BB", "ZZ"]);
    expect(opcionesDeColumna(empresas, {}, "status_store", t).map((o) => o.label)).toEqual(["—", "Lost", "New"]);
  });
  it("las casillas dicen lo que la celda: la tienda por su nombre, y «Actualizado» por día", () => {
    expect(opcionesDeColumna(empresas, { status_store: new Set([SIN_VALOR]) }, "store", t)).toEqual([{ key: "WES", label: "RDZ Weslaco" }]);
    const dias = opcionesDeColumna(empresas, { status_store: new Set([SIN_VALOR]) }, "updated_at", t);
    expect(dias).toEqual([{ key: "2026-10-20", label: "10/20/2026" }]);
    expect(pintadas(filtraEmpresas(empresas, { updated_at: new Set(["2026-10-20"]) }))).toEqual([9, 10]);
  });
});

describe("arrastrar una cabecera a otra", () => {
  const pinta = (p: typeof PREFERENCIA_INICIAL) => columnasAPintar(p).map((c) => c.key);
  it("hacia la izquierda queda ANTES de donde se suelta; hacia la derecha, DESPUÉS", () => {
    const izq = colocaColumnaDeClientes(PREFERENCIA_INICIAL, "phone", "store");
    expect(pinta(izq).slice(0, 4)).toEqual(["account", "phone", "store", "status_store"]);
    const der = colocaColumnaDeClientes(PREFERENCIA_INICIAL, "store", "history_store");
    expect(pinta(der).slice(0, 4)).toEqual(["account", "status_store", "history_store", "store"]);
  });
  it("es el mismo orden que el de «⚙ Columnas», y volver a su sitio lo deja sin orden propio", () => {
    const p = colocaColumnaDeClientes(PREFERENCIA_INICIAL, "phone", "store");
    expect(columnasDelSelector(p).map((c) => c.key).indexOf("phone")).toBe(1);
    // «Contacto, cargo» van ocultas entre las de entrada: soltarla tras «Cargo» es su sitio de partida.
    expect(colocaColumnaDeClientes(p, "phone", "contact_title").orden).toBeNull();
  });
  it("soltar sobre sí misma, o una clave que no existe, no cambia nada", () => {
    expect(colocaColumnaDeClientes(PREFERENCIA_INICIAL, "phone", "phone")).toBe(PREFERENCIA_INICIAL);
    expect(colocaColumnaDeClientes(PREFERENCIA_INICIAL, "nada", "phone")).toBe(PREFERENCIA_INICIAL);
  });
});

describe("la pantalla usa todo esto", () => {
  const pantalla = readFileSync("src/app/customers/Clientes.tsx", "utf8").split("\r\n").join("\n");
  it("sin el desplegable «Todos los estados»: el estado se filtra en su columna", () => {
    expect(pantalla).not.toContain("All statuses");
    expect(pantalla).not.toContain("Todos los estados");
  });
  it("lo que se ve pasa por el filtro de columna y por los niveles; Mayús añade nivel; el arrastre guarda donde «⚙ Columnas»", () => {
    expect(pantalla).toContain("ordenarEmpresas(filtraEmpresas(empresas, filtrosCol), ordenes)");
    expect(pantalla).toContain("onClick={(e) => setOrdenes((o) => alPulsarCabecera(o, c.key, e.shiftKey))}");
    expect(pantalla).toContain("cambiaColumnas((p) => colocaColumnaDeClientes(p, arrastrada, destino))");
    expect(pantalla).toContain("onDrop={(e) => { e.preventDefault(); suelta(c.key); }}");
  });
  it("«Quitar filtros» quita también los de columna", () => {
    expect(pantalla).toContain("onClick={() => { setFiltro(FILTRO_INICIAL); setFiltrosCol({}); }}");
  });
});
