import { describe, expect, it } from "vitest";
import {
  alternaColumna, CAMPOS, celda, clienteDeLaBase, coincide, COLUMNAS, COLUMNAS_INICIALES, columnasValidas, cuentaArchivados, cuentaPor,
  estaArchivado, estadoClase, estadoLabel, filtrar, FILTRO_INICIAL, formDe, mailUrl, MOTIVOS_DE_ARCHIVO, motivoLabel, nombreDeTienda, ordenar,
  PARCHE_DESARCHIVAR, parcheArchivar, parcheDe, puedeEditar, telUrl, TIENDAS,
  type Cliente,
} from "./reglas";

const t = (en: string, _es: string) => en;

const base = (n: number, c: Partial<Cliente>): Cliente => ({
  id: n, store: "MCA", account: `Cuenta ${n}`, unified_account: null, house_no: n, added_batch: null, qb_status: "ACTIVE", activity_status: null,
  status_store: null, status_group: null, history_store: null, history_group: null, crm_type_store: null, crm_type_group: null, associated_with: null,
  rep_history: null, rep_qb: null, rep_store: null,
  contact_name: null, contact_title: null, address: null, phone: null, email: null, credit_limit: null, euler_limit: null, terms: null,
  account_no: null, notes: null, updated_at: null, updated_by: null, archived_at: null, archived_reason: null, ...c,
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

describe("archivados (181)", () => {
  const ARCHIVADA = base(5, { account: "VENTA AL MOSTRADOR", store: "MCA", status_store: "NEW", archived_at: "2026-10-16T13:00:00Z", archived_reason: "comodin de QuickBooks" });
  const SIN_MOTIVO = base(6, { account: "SO 10873", store: "MCA", archived_at: "2026-10-16T13:00:00Z", archived_reason: null });
  const CON = [...LISTA, ARCHIVADA, SIN_MOTIVO];

  it("la lista esconde los archivados por defecto, aunque casen con la tienda, el estado o la búsqueda", () => {
    expect(filtrar(CON, FILTRO_INICIAL).map((c) => c.id)).toEqual([1, 2, 3, 4]);
    expect(filtrar(CON, { ...FILTRO_INICIAL, tienda: "MCA" }).map((c) => c.id)).toEqual([2, 3]);
    expect(filtrar(CON, { ...FILTRO_INICIAL, estado: "NEW" }).map((c) => c.id)).toEqual([2]);
    expect(filtrar(CON, { ...FILTRO_INICIAL, busca: "mostrador" })).toEqual([]);
  });
  it("con el chip, SOLO los archivados, y los demás filtros siguen valiendo encima", () => {
    expect(filtrar(CON, { ...FILTRO_INICIAL, archivados: true }).map((c) => c.id)).toEqual([5, 6]);
    expect(filtrar(CON, { ...FILTRO_INICIAL, archivados: true, busca: "mostrador" }).map((c) => c.id)).toEqual([5]);
    expect(filtrar(CON, { ...FILTRO_INICIAL, archivados: true, tienda: "PHR" })).toEqual([]);
  });
  it("estaArchivado va por la fecha, no por el motivo; cuentaArchivados cuenta sobre la lista entera", () => {
    expect(estaArchivado(ARCHIVADA)).toBe(true);
    expect(estaArchivado(SIN_MOTIVO)).toBe(true);
    expect(estaArchivado(LISTA[0])).toBe(false);
    expect(cuentaArchivados(CON)).toBe(2);
    expect(cuentaArchivados(LISTA)).toBe(0);
  });
  it("el motivo se traduce; sin motivo lo dice; uno escrito a mano sale tal cual; los tres del script están en la lista", () => {
    expect(motivoLabel("comodin de QuickBooks", t)).toBe("QuickBooks placeholder");
    expect(motivoLabel("sin nombre", t)).toBe("No real name");
    expect(motivoLabel("interno/proveedor/competencia", t)).toBe("Internal / supplier / competitor");
    expect(motivoLabel(null, t)).toBe("No reason given");
    expect(motivoLabel("cerró en 2024", t)).toBe("cerró en 2024");
    expect([...MOTIVOS_DE_ARCHIVO]).toEqual(["sin nombre", "comodin de QuickBooks", "interno/proveedor/competencia"]);
    expect(celda(ARCHIVADA, "archived_reason", t)).toBe("QuickBooks placeholder");
    expect(celda(LISTA[0], "archived_reason", t)).toBe("—");
  });
  it("archivar escribe la hora y el motivo (vacío → null); desarchivar pone los dos a null; es reversible", () => {
    const ahora = () => new Date("2026-10-16T15:30:00Z");
    expect(parcheArchivar("  cerró  ", ahora)).toEqual({ archived_at: "2026-10-16T15:30:00.000Z", archived_reason: "cerró" });
    expect(parcheArchivar("", ahora)).toEqual({ archived_at: "2026-10-16T15:30:00.000Z", archived_reason: null });
    expect(PARCHE_DESARCHIVAR).toEqual({ archived_at: null, archived_reason: null });
    const vuelta = { ...ARCHIVADA, ...PARCHE_DESARCHIVAR } as Cliente;
    expect(estaArchivado(vuelta)).toBe(false);
    expect(filtrar([vuelta], FILTRO_INICIAL)).toHaveLength(1);
  });
  it("clienteDeLaBase lee las dos columnas de la 181", () => {
    const c = clienteDeLaBase({ id: 1, store: "MCA", account: "X", archived_at: "2026-10-16T13:00:00+00:00", archived_reason: "sin nombre" });
    expect(c.archived_at).toBe("2026-10-16T13:00:00+00:00");
    expect(c.archived_reason).toBe("sin nombre");
    expect(clienteDeLaBase({ id: 2, store: "MCA", account: "Y" }).archived_at).toBeNull();
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
    const { parche, errores } = parcheDe({ ...original, notes: " hola ", credit_limit: "$1,500", rep_store: "", store: "mca" }, original);
    expect(errores).toEqual([]);
    expect(parche).toEqual({ notes: "hola", credit_limit: 1500, rep_store: null, store: "MCA" });
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
    expect(r.parche).toEqual({ account: "NUEVA", store: "BRO" });
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

/**
 * 2026-10-18. El dueño: «in cusotmer tab haz un cuztomizable order thing so we can all columsn if we wanted to that were
 * on the excel» y «the crm stuff in the customer is missing». Medido ese día en el Excel: 27 cabeceras con nombre; 23
 * estaban en la tabla y 4 no (CRM TYPE ×2, Associated with, CONCATENATE). CONCATENATE = STORE+ACCOUNT en las 1.349.
 */
describe("todas las columnas del Excel (182), y el orden por persona", async () => {
  const {
    cierraLaFicha, claveDeColumnasDeClientes, CLAVE_HEREDADA_DE_COLUMNAS, columnasAPintar, columnasDelSelector, GRUPOS, mueveColumnaDeClientes,
    PREFERENCIA_INICIAL, preferenciaDeTexto, seMueveColumnaDeClientes, textoDeCampo, textoDeFila, tieneOrdenPropio, valorDeColumna,
    filasOcultas, filasPorGrupo, GRUPO_OCULTO,
  } = await import("./reglas");
  // El MAPA del importador, leído como texto (un .mjs de scripts/ no carga bajo vitest en esta laptop: SyntaxError al
  // importar, también en los que no se tocaron). Una cabecera por línea: `"CABECERA": "columna",`.
  const { readFileSync } = await import("node:fs");
  const mapa = /export const MAPA = \{([\s\S]*?)\n\};/.exec(readFileSync("scripts/importa-clientes.mjs", "utf8"))![1];
  const cabecerasDelExcel = [...mapa.matchAll(/^\s*"[^"]+": "(\w+)",/gm)].map((m) => m[1]);
  const claves = COLUMNAS.map((c) => c.key as string);

  it("las 26 columnas que el importador guarda son elegibles en la tabla, y CONCATENATE también (calculada): 27 del Excel", () => {
    expect(cabecerasDelExcel).toHaveLength(26);
    for (const col of cabecerasDelExcel) expect(claves, col).toContain(col);
    expect(claves).toContain("concatenate");
    // Y las tres del CRM están, con etiqueta en los dos idiomas.
    for (const k of ["crm_type_store", "crm_type_group", "associated_with"]) {
      const c = COLUMNAS.find((x) => x.key === k)!;
      expect(c.en).not.toBe("");
      expect(c.es).not.toBe(c.en);
    }
  });
  it("la ficha (CAMPOS) edita las 26 guardadas, menos house_no (número de fila del maestro, se enseña aparte) y las cuatro del contacto (D-668: van en la lista de contactos)", () => {
    const editables = new Set(CAMPOS.map((c) => c.key as string));
    const delContacto = ["contact_name", "contact_title", "phone", "email"];
    for (const col of cabecerasDelExcel.filter((c) => c !== "house_no" && !delContacto.includes(c))) expect(editables, col).toContain(col);
    for (const col of delContacto) { expect(cabecerasDelExcel, col).toContain(col); expect(editables, col).not.toContain(col); }
    for (const k of ["crm_type_store", "crm_type_group", "associated_with"]) expect(CAMPOS.find((c) => c.key === k)?.grupo).toBe("otros");
  });
  it("concatenate es tienda + cuenta pegadas: se pinta, se ordena y clienteDeLaBase lee las tres del CRM", () => {
    const c = base(1, { store: "BRO", account: "Paseo", crm_type_store: "LOST" });
    expect(valorDeColumna(c, "concatenate")).toBe("BROPaseo");
    expect(celda(c, "concatenate", t)).toBe("BROPaseo");
    expect(celda(c, "crm_type_store", t)).toBe("LOST");
    expect(celda(base(2, {}), "associated_with", t)).toBe("—");
    const lista = [base(1, { store: "MCA", account: "B" }), base(2, { store: "BRO", account: "Z" }), base(3, { store: "BRO", account: "A" })];
    expect(ordenar(lista, { por: "concatenate", desc: false }).map((x) => x.id)).toEqual([3, 2, 1]);
    const leido = clienteDeLaBase({ id: 1, store: "MCA", account: "A", crm_type_store: "MID", crm_type_group: "", associated_with: "ACERO-SYNERGY" });
    expect(leido.crm_type_store).toBe("MID");
    expect(leido.crm_type_group).toBeNull();
    expect(leido.associated_with).toBe("ACERO-SYNERGY");
  });

  it("la clave del navegador lleva el id de la persona; la heredada es la vieja sin usuario", () => {
    expect(claveDeColumnasDeClientes("u-1")).toBe("rtg_customers_cols_u-1");
    expect(claveDeColumnasDeClientes("u-1")).not.toBe(claveDeColumnasDeClientes("u-2"));
    expect(CLAVE_HEREDADA_DE_COLUMNAS).toBe("customers_cols");
  });
  it("lo guardado se lee saneado: el formato nuevo, la lista heredada, y la basura vuelve a lo de entrada", () => {
    expect(preferenciaDeTexto(JSON.stringify({ elegidas: ["phone", "inventada"], orden: ["phone", "account", "nada"] }))).toEqual({
      elegidas: ["account", "phone"], orden: ["phone", "account", ...claves.filter((k) => k !== "phone" && k !== "account")],
    });
    expect(preferenciaDeTexto(JSON.stringify(["store", "phone"]))).toEqual({ elegidas: ["account", "store", "phone"], orden: null });
    expect(preferenciaDeTexto("{basura")).toEqual(PREFERENCIA_INICIAL);
    expect(preferenciaDeTexto(null)).toEqual(PREFERENCIA_INICIAL);
    expect(preferenciaDeTexto(JSON.stringify({ elegidas: 5, orden: [1, 2] }))).toEqual(PREFERENCIA_INICIAL);
  });
  it("sin orden propio se pinta en el orden de partida; con él, en el de la persona; y una columna nueva entra al final", () => {
    expect(columnasAPintar({ elegidas: ["phone", "store", "account"], orden: null }).map((c) => c.key)).toEqual(["account", "store", "phone"]);
    expect(columnasAPintar({ elegidas: ["phone", "store", "account"], orden: ["phone", "store", "account"] }).map((c) => c.key)).toEqual(["phone", "store", "account"]);
    // Un orden guardado que no conoce `notes` la deja al final, y el selector la enseña igual.
    const viejo = claves.filter((k) => k !== "notes").reverse();
    expect(columnasDelSelector({ elegidas: [], orden: viejo }).map((c) => c.key).at(-1)).toBe("notes");
    expect(columnasDelSelector({ elegidas: [], orden: null })).toEqual([...COLUMNAS]);
  });
  it("mover: una visible salta por encima de las escondidas; en el tope no se mueve; «account» se mueve pero no se quita", () => {
    const p = { elegidas: ["account", "store", "phone"], orden: null };
    const m = mueveColumnaDeClientes(p, "phone", -1);
    expect(columnasAPintar(m).map((c) => c.key)).toEqual(["account", "phone", "store"]);
    expect(tieneOrdenPropio(m.orden)).toBe(true);
    expect(seMueveColumnaDeClientes(p, "account", -1)).toBe(false);
    expect(seMueveColumnaDeClientes(p, "phone", -1)).toBe(true);
    expect(mueveColumnaDeClientes(p, "account", -1)).toEqual({ ...p, orden: null });
    // Volver a bajarla la pone tras Tienda otra vez, pero el orden ya es suyo (el teléfono quedó por delante de las
    // escondidas, no en su sitio de partida): «Restablecer orden» es lo que lo devuelve a null.
    const vuelta = mueveColumnaDeClientes(m, "phone", 1);
    expect(columnasAPintar(vuelta).map((c) => c.key)).toEqual(["account", "store", "phone"]);
    expect(tieneOrdenPropio(vuelta.orden)).toBe(true);
    expect(tieneOrdenPropio(null)).toBe(false);
    // Un movimiento que no cambia nada (subir la primera) no inventa orden propio.
    expect(mueveColumnaDeClientes({ elegidas: ["account"], orden: null }, "account", -1).orden).toBeNull();
    expect(columnasAPintar(mueveColumnaDeClientes(p, "account", 1)).map((c) => c.key)).toEqual(["store", "account", "phone"]);
  });
  it("guardar y restaurar: lo que se escribe en el navegador vuelve igual", () => {
    const p = mueveColumnaDeClientes({ elegidas: ["account", "crm_type_store"], orden: null }, "crm_type_store", -1);
    const vuelto = preferenciaDeTexto(JSON.stringify(p));
    expect(vuelto).toEqual(p);
    expect(columnasAPintar(vuelto).map((c) => c.key)).toEqual(["crm_type_store", "account"]);
  });

  it("la ficha completa: cada campo sale UNA vez, en un grupo o en «Campos ocultos», menos la cuenta y la tienda (van arriba); ningún grupo vacío", () => {
    const grupos = filasPorGrupo();
    expect(grupos.map((g) => g.grupo.key)).toEqual(GRUPOS.map((g) => g.key));
    const vistos = [...grupos.flatMap((g) => g.filas), ...filasOcultas()].filter((f) => f.campo).map((f) => f.key);
    const deLasTarjetas = CAMPOS.filter((c) => c.key !== "account" && c.key !== "store").map((c) => c.key);
    expect([...vistos].sort()).toEqual([...deLasTarjetas].sort());
    expect(new Set(vistos).size).toBe(vistos.length);
    for (const g of grupos) expect(g.filas.length, g.grupo.key).toBeGreaterThan(0);
    // Cada línea que se edita lleva SU campo (la etiqueta y el control son de esa clave).
    for (const f of grupos.flatMap((g) => g.filas)) if (f.campo) expect(f.campo.key).toBe(f.key);
  });
  it("D-662: las tarjetas van Cuenta, Contacto, Crédito / Estado, Otros (la plantilla del dueño); «Cuenta» abre con el nombre (solo lectura), lleva los vendedores y no la tienda", () => {
    expect(GRUPOS.map((g) => g.key)).toEqual(["cuenta", "contacto", "credito", "estado", "otros"]);
    expect(GRUPOS.at(-1)).toEqual({ key: "otros", en: "Other", es: "Otros" });
    const cuenta = filasPorGrupo()[0];
    expect(cuenta.grupo.key).toBe("cuenta");
    expect(cuenta.filas.map((f) => [f.key, f.campo === null])).toEqual([["account", true], ["unified_account", false], ["rep_store", false], ["rep_qb", false], ["rep_history", false]]);
    // Los rótulos de «Estado e historial» de la plantilla.
    expect(filasPorGrupo().find((g) => g.grupo.key === "estado")!.filas.map((f) => f.en)).toEqual(
      ["Current Status (store)", "Current Status (group)", "Historical Type (store)", "Historical Type (group)", "QuickBooks Status"]);
    // D-669 puso el «Type» al final de «Credit & terms»; D-672 pone ahí los impuestos de la tienda («Tax terms»), un desplegable.
    const credito = filasPorGrupo().find((g) => g.grupo.key === "credito")!.filas;
    expect(credito.map((f) => [f.key, f.en])).toEqual([["terms", "Terms"], ["credit_limit", "Credit limit"], ["euler_limit", "Euler limit"], ["account_no", "Account / credit"], ["tax_terms", "Tax terms"]]);
    expect(credito.at(-1)?.campo?.tipo).toBe("impuesto");
    // Y el sitio web en «Contacto», delante de la dirección.
    expect(filasPorGrupo().find((g) => g.grupo.key === "contacto")!.filas.map((f) => f.key)).toEqual(["website", "address"]);
    const todas = filasPorGrupo().flatMap((g) => g.filas.map((f) => f.key));
    expect(todas.filter((k) => k === "account")).toHaveLength(1);
    expect(todas).not.toContain("store");
    // La cuenta y la tienda se siguen corrigiendo (arriba): siguen en CAMPOS, en la cabecera.
    expect(CAMPOS.filter((c) => c.grupo === "cabecera").map((c) => c.key)).toEqual(["account", "store"]);
  });
  it("D-660 y D-662: «Otros» lleva el CRM y las notas (la cuenta unificada volvió a «Cuenta»); ni Añadido (tanda), ni House #, ni la CONCATENATE", () => {
    const otros = filasPorGrupo().find((g) => g.grupo.key === "otros")!.filas;
    // D-672: con el «Type» (la «Activity») encima de las notas: «Type will move to Other above Notes».
    expect(otros.map((f) => f.key)).toEqual(["crm_type_store", "crm_type_group", "associated_with", "activity_status", "notes"]);
    expect(otros.find((f) => f.key === "activity_status")?.en).toBe("Type");
    // Y en ninguna otra tarjeta: solo en «Campos ocultos».
    const visibles = filasPorGrupo().flatMap((g) => g.filas.map((f) => f.key as string));
    for (const k of ["added_batch", "house_no", "concatenate"]) expect(visibles, k).not.toContain(k);
  });
  it("D-660: «Campos ocultos» lleva Añadido (tanda), N.º House y Tienda + cuenta (CONCATENATE), en ese orden; House # y la CONCATENATE se leen", () => {
    expect(GRUPO_OCULTO).toEqual({ key: "ocultos", en: "Hidden fields", es: "Campos ocultos" });
    const ocultas = filasOcultas();
    // D-669: sin la actividad (D-662 la ponía detrás): es el «Type» de «Credit & terms».
    expect(ocultas.map((f) => f.key)).toEqual(["added_batch", "house_no", "concatenate"]);
    expect(ocultas.filter((f) => f.campo === null).map((f) => f.key)).toEqual(["house_no", "concatenate"]);
    // «Añadido (tanda)» se sigue corrigiendo: lleva SU campo.
    expect(ocultas[0].campo?.key).toBe("added_batch");
    expect(ocultas[0].es).toBe("Añadido (tanda)");
    expect(ocultas.find((f) => f.key === "concatenate")!.es).toBe("Tienda + cuenta (CONCATENATE)");
    // No son tarjeta: GRUPOS no las lleva.
    expect(GRUPOS.map((g) => g.key as string)).not.toContain("ocultos");
  });
  it("D-660: ni Añadido, ni House #, ni Tienda + cuenta son columnas de entrada en la lista (el selector las sigue ofreciendo)", () => {
    for (const k of ["added_batch", "house_no", "concatenate"]) {
      expect(COLUMNAS_INICIALES, k).not.toContain(k);
      expect(PREFERENCIA_INICIAL.elegidas, k).not.toContain(k);
      expect(claves, k).toContain(k);
    }
  });
  it("textoDeFila: House # y la CONCATENATE de la fila, «—» sin House #, y los demás como textoDeCampo", () => {
    const c = base(7, { store: "BRO", account: "PASEO", house_no: 412, added_batch: "LOTE 3" });
    const fila = (k: string) => [...filasPorGrupo().flatMap((g) => g.filas), ...filasOcultas()].find((f) => f.key === k)!;
    expect(textoDeFila(c, fila("house_no"), t)).toBe("412");
    expect(textoDeFila(base(8, { house_no: null }), fila("house_no"), t)).toBe("—");
    expect(textoDeFila(c, fila("concatenate"), t)).toBe("BROPASEO");
    expect(textoDeFila(c, fila("added_batch"), t)).toBe("LOTE 3");
    expect(textoDeFila(base(9, { credit_limit: 2500 }), fila("credit_limit"), t)).toBe("$2,500");
  });
  it("D-654: la ventana se cierra con Escape y con un clic en el fondo que empezó en el fondo; nada más la cierra", () => {
    expect(cierraLaFicha({ tecla: "Escape" })).toBe(true);
    expect(cierraLaFicha({ tecla: "Enter" })).toBe(false);
    expect(cierraLaFicha({ tecla: "Esc" })).toBe(false);
    expect(cierraLaFicha({ clicEnElFondo: true, empezoEnElFondo: true })).toBe(true);
    // Un clic dentro de la ventana no cierra.
    expect(cierraLaFicha({ clicEnElFondo: false, empezoEnElFondo: false })).toBe(false);
    // Un arrastre que empezó dentro (seleccionar texto) y se suelta en el fondo, tampoco.
    expect(cierraLaFicha({ clicEnElFondo: true, empezoEnElFondo: false })).toBe(false);
    expect(cierraLaFicha({ clicEnElFondo: false, empezoEnElFondo: true })).toBe(false);
  });
  it("textoDeCampo: etiquetas para los cerrados, dinero, tienda con su código, y «—» sin dato", () => {
    const c = base(1, { store: "PHR", status_store: "LOST", history_group: "MID", qb_status: "ACTIVE", credit_limit: 1500, crm_type_group: null, notes: "ok" });
    const campo = (k: string) => CAMPOS.find((x) => x.key === k)!;
    expect(textoDeCampo(c, campo("store"), t)).toBe("RDZ Pharr (PHR)");
    expect(textoDeCampo(c, campo("status_store"), t)).toBe("Lost");
    expect(textoDeCampo(c, campo("history_group"), t)).toBe("Mid");
    expect(textoDeCampo(c, campo("qb_status"), t)).toBe("Active in QB");
    expect(textoDeCampo(c, campo("credit_limit"), t)).toBe("$1,500");
    expect(textoDeCampo(c, campo("crm_type_group"), t)).toBe("—");
    expect(textoDeCampo(c, campo("notes"), t)).toBe("ok");
  });
});
