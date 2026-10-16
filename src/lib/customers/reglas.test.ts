import { describe, expect, it } from "vitest";
import {
  alOrdenarPor, alternaColumna, CAMPOS, celda, clienteDeLaBase, coincide, COLUMNAS, COLUMNAS_INICIALES, columnasValidas, cuentaPor,
  estadoClase, estadoLabel, filtrar, FILTRO_INICIAL, formDe, mailUrl, nombreDeTienda, ordenar, parcheDe, puedeEditar, telUrl, TIENDAS,
  type Cliente,
} from "./reglas";

const t = (en: string, _es: string) => en;

const base = (n: number, c: Partial<Cliente>): Cliente => ({
  id: n, store: "MCA", account: `Cuenta ${n}`, unified_account: null, house_no: n, added_batch: null, qb_status: "ACTIVE", activity_status: null,
  status_store: null, status_group: null, history_store: null, history_group: null, rep_history: null, rep_qb: null, rep_store: null,
  contact_name: null, contact_title: null, address: null, phone: null, email: null, credit_limit: null, euler_limit: null, terms: null,
  account_no: null, notes: null, updated_at: null, updated_by: null, ...c,
});

// A propósito desordenados y con los estados en orden inverso al rango, para que una ordenación equivocada se note.
const LISTA: Cliente[] = [
  base(1, { account: "Zeta Builders", store: "PHR", status_store: "LOST", history_store: "SMALL", phone: "956-555-0101", email: "zeta@example.com", credit_limit: 500, rep_store: "IM" }),
  base(2, { account: "alfa homes", store: "MCA", status_store: "NEW", history_store: "LARGE", phone: "(956) 555-0202", contact_name: "Ana Pérez", credit_limit: 20000 }),
  base(3, { account: "Beta Tile", store: "MCA", status_store: "ACTIVE INC", history_store: "INSIGNIFICANT", qb_status: "NOT FOUND IN UPDATE", unified_account: "BETA GROUP", account_no: "EULER 50K" }),
  base(4, { account: "Gamma LLC", store: "BRO", status_store: null, history_store: null, credit_limit: 10000, notes: "llamar en enero" }),
];

describe("tiendas", () => {
  it("los cinco códigos del Excel se traducen al nombre del hub; uno desconocido sale tal cual; vacío, raya", () => {
    expect(TIENDAS.map((x) => x.code)).toEqual(["BRO", "EDG", "MCA", "PHR", "WES"]);
    expect(nombreDeTienda("MCA")).toBe("RDZ McAllen");
    expect(nombreDeTienda(" bro ")).toBe("RDZ Brownsville");
    expect(nombreDeTienda("RHC")).toBe("RHC");
    expect(nombreDeTienda(null)).toBe("—");
  });
});

describe("buscar", () => {
  it("casa por cuenta, cuenta unificada, contacto, correo, cuenta/crédito, vendedor y notas, sin acentos ni mayúsculas", () => {
    expect(coincide(LISTA[1], "ALFA")).toBe(true);
    expect(coincide(LISTA[2], "beta group")).toBe(true);
    expect(coincide(LISTA[1], "perez")).toBe(true);
    expect(coincide(LISTA[0], "zeta@")).toBe(true);
    expect(coincide(LISTA[2], "euler")).toBe(true);
    expect(coincide(LISTA[0], "im")).toBe(true);
    expect(coincide(LISTA[3], "enero")).toBe(true);
    expect(coincide(LISTA[3], "zeta")).toBe(false);
  });
  it("el teléfono se busca por dígitos, escrito de cualquier manera, con tres o más", () => {
    expect(coincide(LISTA[1], "5550202")).toBe(true);
    expect(coincide(LISTA[1], "(956) 555")).toBe(true);
    expect(coincide(LISTA[1], "0202")).toBe(true);
    // Dos dígitos no bastan: casarían con media lista.
    expect(coincide(LISTA[1], "02")).toBe(false);
    expect(coincide(LISTA[1], "0303")).toBe(false);
  });
  it("vacío casa con todo", () => {
    expect(LISTA.every((c) => coincide(c, "  "))).toBe(true);
  });
});

describe("filtrar", () => {
  it("por tienda, por estado (incluido «sin estado») y por QuickBooks; combinados", () => {
    expect(filtrar(LISTA, { ...FILTRO_INICIAL, tienda: "MCA" }).map((c) => c.id)).toEqual([2, 3]);
    expect(filtrar(LISTA, { ...FILTRO_INICIAL, estado: "LOST" }).map((c) => c.id)).toEqual([1]);
    expect(filtrar(LISTA, { ...FILTRO_INICIAL, estado: "none" }).map((c) => c.id)).toEqual([4]);
    expect(filtrar(LISTA, { ...FILTRO_INICIAL, qb: "NOT FOUND IN UPDATE" }).map((c) => c.id)).toEqual([3]);
    expect(filtrar(LISTA, { ...FILTRO_INICIAL, tienda: "MCA", estado: "NEW" }).map((c) => c.id)).toEqual([2]);
    expect(filtrar(LISTA, { ...FILTRO_INICIAL, tienda: "MCA", busca: "beta" }).map((c) => c.id)).toEqual([3]);
    expect(filtrar(LISTA, FILTRO_INICIAL)).toHaveLength(4);
  });
});

describe("ordenar", () => {
  it("por cuenta, sin distinguir mayúsculas, y al revés", () => {
    expect(ordenar(LISTA, { por: "account", desc: false }).map((c) => c.account)).toEqual(["alfa homes", "Beta Tile", "Gamma LLC", "Zeta Builders"]);
    expect(ordenar(LISTA, { por: "account", desc: true }).map((c) => c.account)).toEqual(["Zeta Builders", "Gamma LLC", "Beta Tile", "alfa homes"]);
  });
  it("el estado va por su rango (NEW primero, LOST último, sin estado al final), no alfabético", () => {
    expect(ordenar(LISTA, { por: "status_store", desc: false }).map((c) => c.id)).toEqual([2, 3, 1, 4]);
  });
  it("el historial va de mayor a menor, y los nulos al final también al invertir", () => {
    expect(ordenar(LISTA, { por: "history_store", desc: false }).map((c) => c.id)).toEqual([2, 1, 3, 4]);
    expect(ordenar(LISTA, { por: "history_store", desc: true }).map((c) => c.id)).toEqual([4, 3, 1, 2]);
  });
  it("los números como números (500 antes que 10000), los nulos al final; y no toca la lista", () => {
    const copia = [...LISTA];
    expect(ordenar(LISTA, { por: "credit_limit", desc: false }).map((c) => c.id)).toEqual([1, 4, 2, 3]);
    expect(LISTA).toEqual(copia);
  });
  it("pulsar la misma cabecera invierte; otra empieza ascendente", () => {
    expect(alOrdenarPor({ por: "account", desc: false }, "account")).toEqual({ por: "account", desc: true });
    expect(alOrdenarPor({ por: "account", desc: true }, "store")).toEqual({ por: "store", desc: false });
  });
});

describe("columnas", () => {
  it("las de entrada existen todas, y `account` es fija", () => {
    const claves = COLUMNAS.map((c) => c.key as string);
    for (const k of COLUMNAS_INICIALES) expect(claves).toContain(k);
    expect(COLUMNAS.find((c) => c.key === "account")?.fija).toBe(true);
  });
  it("lo guardado en el navegador se sanea: claves inventadas fuera, `account` siempre, en el orden de la tabla", () => {
    expect(columnasValidas(["phone", "inventada", "store"])).toEqual(["account", "store", "phone"]);
    expect(columnasValidas(null)).toEqual(["account"]);
  });
  it("alternar quita o pone; `account` no se puede quitar", () => {
    expect(alternaColumna(["account", "store"], "store")).toEqual(["account"]);
    expect(alternaColumna(["account"], "phone")).toEqual(["account", "phone"]);
    expect(alternaColumna(["account", "store"], "account")).toEqual(["account", "store"]);
  });
  it("cuentaPor agrupa y deja los nulos como cadena vacía", () => {
    expect(cuentaPor(LISTA, "store").get("MCA")).toBe(2);
    expect(cuentaPor(LISTA, "status_store").get("")).toBe(1);
  });
});

describe("quién edita", () => {
  it("admin y manager editan; los demás, y sin rol, no (espejo de erp.customers_can_write())", () => {
    expect(puedeEditar("admin")).toBe(true);
    expect(puedeEditar("manager")).toBe(true);
    for (const r of ["sales", "warehouse", "driver", "logistics", "accounting"] as const) expect(puedeEditar(r), r).toBe(false);
    expect(puedeEditar(null)).toBe(false);
  });
});

describe("la ficha y el parche", () => {
  it("formDe pone todos los campos como texto, y null como vacío", () => {
    const f = formDe(LISTA[0]);
    expect(Object.keys(f).sort()).toEqual(CAMPOS.map((c) => c.key as string).sort());
    expect(f.credit_limit).toBe("500");
    expect(f.notes).toBe("");
  });
  it("solo lo que cambió viaja: vacío → null, números como número, la tienda en mayúsculas", () => {
    const original = formDe(LISTA[0]);
    const { parche, errores } = parcheDe({ ...original, notes: " hola ", credit_limit: "$1,500", email: "", store: "mca" }, original);
    expect(errores).toEqual([]);
    expect(parche).toEqual({ notes: "hola", credit_limit: 1500, email: null, store: "MCA" });
  });
  it("sin cambios, parche vacío (no se reenvía lo leído)", () => {
    const original = formDe(LISTA[0]);
    expect(parcheDe({ ...original }, original).parche).toEqual({});
  });
  it("un número que no lo es, o negativo, es error y no viaja; cuenta o tienda en blanco, igual", () => {
    const original = formDe(LISTA[0]);
    const r = parcheDe({ ...original, credit_limit: "mucho", euler_limit: "-5", account: "  " }, original);
    expect(r.errores.sort()).toEqual(["account", "credit_limit", "euler_limit"]);
    expect(r.parche).toEqual({});
  });
  it("un alta exige cuenta y tienda aunque «no hayan cambiado» (vacío → vacío)", () => {
    const vacio = formDe(null);
    expect(parcheDe({ ...vacio }, vacio, true).errores.sort()).toEqual(["account", "store"]);
    const r = parcheDe({ ...vacio, account: "Nueva", store: "bro" }, vacio, true);
    expect(r.errores).toEqual([]);
    expect(r.parche).toEqual({ account: "Nueva", store: "BRO" });
  });
});

describe("de la base y formato", () => {
  it("clienteDeLaBase tipa lo que llega: numeric como texto vale, vacío es null, el id es número", () => {
    const c = clienteDeLaBase({ id: "7", store: "WES", account: "X", credit_limit: "12.5", euler_limit: null, phone: "", house_no: 3 });
    expect(c.id).toBe(7);
    expect(c.credit_limit).toBe(12.5);
    expect(c.euler_limit).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.house_no).toBe(3);
  });
  it("celda: tienda por nombre, estados traducidos, dinero redondeado, fecha sin zona horaria, nulos como raya", () => {
    const c = base(9, { store: "EDG", status_store: "ACTIVE DEC", credit_limit: 1234.6, updated_at: "2026-10-16T23:59:00Z" });
    expect(celda(c, "store", t)).toBe("RDZ Edinburg");
    expect(celda(c, "status_store", t)).toBe("Active, declining");
    expect(celda(c, "credit_limit", t)).toBe("$1,235");
    expect(celda(c, "updated_at", t)).toBe("10/16/2026");
    expect(celda(c, "phone", t)).toBe("—");
  });
  it("estado: etiqueta y color por valor; desconocido sale tal cual", () => {
    expect(estadoLabel("NEW", t)).toBe("New");
    expect(estadoLabel(null, t)).toBe("No status");
    expect(estadoLabel("RARO", t)).toBe("RARO");
    expect(estadoClase("LOST")).toContain("red");
    expect(estadoClase("ACTIVE INC")).toContain("emerald");
    expect(estadoClase(null)).toContain("slate");
  });
  it("tel: y mailto: solo cuando lo parecen (el Excel trae «0» y nombres en esas columnas)", () => {
    expect(telUrl("956 555-0101")).toBe("tel:9565550101");
    expect(telUrl("JOSE LLORENTE")).toBeNull();
    expect(telUrl("0")).toBeNull();
    expect(mailUrl("a@b.co")).toBe("mailto:a@b.co");
    expect(mailUrl("0")).toBeNull();
    expect(mailUrl(null)).toBeNull();
  });
});
