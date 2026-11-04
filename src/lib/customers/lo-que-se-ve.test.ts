import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORDENES_INICIALES, opcionesDeColumna } from "./cabeceras";
import { agrupaEnEmpresas } from "./empresas";
import { conLaTiendaFiltrada, empresasQueSeVen, filtrosQueSeVen, ordenesQueSeVen } from "./lo-que-se-ve";
import { FILTRO_INICIAL, type Cliente, type Orden } from "./reglas";

/**
 * «Clientes: no me gustan las ocultas, porque afectan los filtros y el orden». Lo que filtra y ordena la lista tiene que
 * ser lo que se VE: ni una columna escondida con «⚙ Columnas» ni una tienda metida en el «+N» de la celda (D-673) pueden
 * decidir qué filas salen ni en qué orden. Datos inventados.
 */
const t = (en: string, _es: string) => en;
const base = (n: number, c: Partial<Cliente>): Cliente => ({
  id: n, store: "MCA", account: `Cuenta ${n}`, unified_account: null, house_no: null, added_batch: null, qb_status: null, activity_status: null,
  status_store: null, status_group: null, history_store: null, history_group: null, crm_type_store: null, crm_type_group: null, associated_with: null,
  rep_history: null, rep_qb: null, rep_store: null, contact_name: null, contact_title: null, address: null, phone: null, email: null,
  credit_limit: null, euler_limit: null, terms: null, account_no: null, notes: null, updated_at: null, updated_by: null, archived_at: null,
  archived_reason: null, company_id: `e${n}`, ...c,
});

// Acme compra en dos tiendas: la fila de Pharr es la más completa (la que se pinta sin filtro), NEW; la de
// Brownsville, LOST. Los teléfonos van al revés que las cuentas, para que ordenar por teléfono se note.
const LISTA: Cliente[] = [
  base(1, { account: "Alfa Obras", store: "MCA", status_store: "LOST", terms: "Net 30", phone: "956-555-0109" }),
  base(2, { account: "Bravo Tile", store: "PHR", status_store: "NEW", terms: "COD", phone: "956-555-0108" }),
  base(7, { account: "Acme Pisos", store: "BRO", company_id: "ACME", status_store: "LOST" }),
  base(8, { account: "Acme Pisos", store: "PHR", company_id: "ACME", status_store: "NEW", phone: "956-555-0100", rep_store: "AA", terms: "Net 30" }),
];
const empresas = agrupaEnEmpresas(LISTA, FILTRO_INICIAL);
const pintadas = (l: readonly { principal: Cliente }[]) => l.map((e) => e.principal.id);
/** Las columnas de entrada de la lista, sin «Términos» ni «Teléfono»: las dos quedan escondidas. */
const SIN_TERMINOS_NI_TELEFONO = ["account", "store", "store_count", "status_store", "rep_store"];
const CON_TODO = [...SIN_TERMINOS_NI_TELEFONO, "terms", "phone"];

describe("una columna escondida no filtra ni ordena (como Órdenes, D-360)", () => {
  it("el filtro de una columna que se escondió deja de esconder filas; al volver a enseñarla, vuelve a filtrar", () => {
    const filtros = { terms: new Set(["Net 30"]) };
    // Antes: «Términos = Net 30» y luego se escondía «Términos»: seguían faltando Bravo, sin ▾ con el que quitarlo.
    expect(pintadas(empresasQueSeVen(empresas, filtros, ORDENES_INICIALES, SIN_TERMINOS_NI_TELEFONO))).toEqual([8, 1, 2]);
    expect(pintadas(empresasQueSeVen(empresas, filtros, ORDENES_INICIALES, CON_TODO))).toEqual([8, 1]);
  });
  it("el orden por una columna escondida no manda: se ordena por las que se ven, o por Cuenta", () => {
    const porTelefono: Orden[] = [{ por: "phone", desc: false }];
    // Por teléfono: Acme (0100), Bravo (0108), Alfa (0109). Escondido, por cuenta: Acme, Alfa, Bravo.
    expect(pintadas(empresasQueSeVen(empresas, {}, porTelefono, CON_TODO))).toEqual([8, 2, 1]);
    expect(pintadas(empresasQueSeVen(empresas, {}, porTelefono, SIN_TERMINOS_NI_TELEFONO))).toEqual([8, 1, 2]);
    // El nivel 1 escondido no deja al 2 desempatando a ciegas: el 2 pasa a mandar.
    const dosNiveles: Orden[] = [{ por: "phone", desc: false }, { por: "status_store", desc: false }];
    expect(ordenesQueSeVen(dosNiveles, SIN_TERMINOS_NI_TELEFONO)).toEqual([{ por: "status_store", desc: false }]);
  });
  it("sin ningún nivel a la vista, el orden de entrada; los filtros escondidos no salen en «Filtrado por»", () => {
    expect(ordenesQueSeVen([{ por: "phone", desc: true }], SIN_TERMINOS_NI_TELEFONO)).toEqual([...ORDENES_INICIALES]);
    expect(Object.keys(filtrosQueSeVen({ terms: new Set(["COD"]), status_store: new Set(["NEW"]) }, SIN_TERMINOS_NI_TELEFONO))).toEqual(["status_store"]);
  });
});

describe("la tienda del «+N» no decide a escondidas (D-673)", () => {
  it("filtrar Tienda = Brownsville pinta la fila de Brownsville, no la de Pharr con Brownsville dentro del «+1»", () => {
    // Antes: Acme salía como «RDZ Pharr +1», NEW, con el teléfono de Pharr: nada de lo que se veía era de Brownsville.
    const e = empresasQueSeVen(empresas, { store: new Set(["BRO"]) }, ORDENES_INICIALES, CON_TODO);
    expect(pintadas(e)).toEqual([7]);
  });
  it("los demás filtros miran esa misma fila: Brownsville + «New» ya no trae a Acme, cuya fila de Brownsville es LOST", () => {
    expect(pintadas(empresasQueSeVen(empresas, { store: new Set(["BRO"]), status_store: new Set(["NEW"]) }, ORDENES_INICIALES, CON_TODO))).toEqual([]);
    expect(pintadas(empresasQueSeVen(empresas, { store: new Set(["BRO"]), status_store: new Set(["LOST"]) }, ORDENES_INICIALES, CON_TODO))).toEqual([7]);
  });
  it("las casillas de Estado, con Brownsville puesto, ofrecen lo que se ve: «Lost», no el «New» de la fila escondida", () => {
    const filtros = { store: new Set(["BRO"]) };
    expect(opcionesDeColumna(conLaTiendaFiltrada(empresas, filtros), filtros, "status_store", t).map((o) => o.label)).toEqual(["Lost"]);
  });
  it("si la fila que se pinta ya está en una tienda marcada, se queda: no salta de fila sin motivo", () => {
    expect(pintadas(conLaTiendaFiltrada(empresas, { store: new Set(["BRO", "PHR"]) })).sort()).toEqual([1, 2, 8].sort());
  });
  it("con la pastilla de una tienda arriba, manda la pastilla: la fila de esa tienda se queda", () => {
    const enPharr = agrupaEnEmpresas(LISTA, { ...FILTRO_INICIAL, tienda: "PHR" });
    expect(pintadas(conLaTiendaFiltrada(enPharr, { store: new Set(["BRO"]) })).sort()).toEqual([2, 8]);
  });
});

describe("la pantalla usa todo esto", () => {
  const pantalla = readFileSync("src/app/customers/Clientes.tsx", "utf8").split("\r\n").join("\n");
  it("la lista, las casillas y «Filtrado por» salen de las columnas que se ven", () => {
    expect(pantalla).toContain("empresasQueSeVen(empresas, filtrosVistos, ordenesVistas, clavesVistas)");
    expect(pantalla).toContain("opcionesDeColumna(conLaTiendaFiltrada(empresas, filtrosVistos), filtrosVistos, abierta, t)");
    expect(pantalla).toContain("columnasFiltradas(filtrosVistos, clavesVistas)");
    expect(pantalla).toContain("nivelDeOrden(ordenesVistas, c.key)");
  });
});
