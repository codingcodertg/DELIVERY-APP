import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  cabeceraNormal, claveDe, COLUMNAS, filaACliente, filasDeHoja, fusiona, MAPA, parametrosDe, preparar, sqlDeUpsert, valorDeCelda,
} from "./importa-clientes.mjs";

// Las cabeceras del Excel real, como las devuelve exceljs (con el punto en «DATE. ADDED», el salto de linea en
// «HISTORY \nTYPE» y una columna 28 sin nombre). Copiadas del fichero el 2026-10-16.
const CABECERAS = [undefined, "HOUSE", "DATE. ADDED", "CONCATENATE", "STORE", "QB INACTIVE", "ACTIVITY STATUS", "ACCOUNT", "UNIFIED ACCOUNT",
  "Max Group Rep History", "Max Group Rep QB", "Assigned Store Rep QB", "STATUS TYPE: STORE", "STATUS TYPE: GROUP", "HISTORY \nTYPE: STORE",
  "HISTORY \nTYPE: GROUP", "CRM TYPE: STORE", "CRM TYPE: GROUP", "Associated with", "CONTACT", "TITLE", "ADRESS", "Main Phone", "Main Email",
  "QB Credit Limit", "Terms", "Euler", "Account No.", undefined];

const fila = (o) => {
  const f = [undefined];
  for (let i = 1; i < CABECERAS.length; i++) f.push(o[CABECERAS[i]]);
  return f;
};

describe("celdas", () => {
  it("texto recortado, numero, fecha como AAAA-MM-DD, formula por su resultado, #N/A y vacio como null", () => {
    expect(valorDeCelda("  Net 30 ")).toBe("Net 30");
    expect(valorDeCelda(20000)).toBe(20000);
    expect(valorDeCelda(new Date(Date.UTC(2026, 8, 24)))).toBe("2026-09-24");
    expect(valorDeCelda({ formula: "A1", result: 5 })).toBe(5);
    expect(valorDeCelda({ error: "#N/A" })).toBeNull();
    expect(valorDeCelda({ richText: [{ text: "Paseo " }, { text: "Residencial" }] })).toBe("Paseo Residencial");
    expect(valorDeCelda("   ")).toBeNull();
    expect(valorDeCelda(null)).toBeNull();
  });
  it("las cabeceras se normalizan: mayusculas, sin puntos, saltos y espacios dobles a uno", () => {
    expect(cabeceraNormal("DATE. ADDED")).toBe("DATE ADDED");
    expect(cabeceraNormal("HISTORY \nTYPE: STORE")).toBe("HISTORY TYPE: STORE");
    expect(cabeceraNormal("Account No.")).toBe("ACCOUNT NO");
    expect(cabeceraNormal("Max Group Rep History")).toBe("MAX GROUP REP HISTORY");
  });
  it("las 27 cabeceras reales con nombre (la 28.a no tiene): 23 se cargan y 4 se dejan fuera a proposito", () => {
    const reales = CABECERAS.filter(Boolean).map(cabeceraNormal);
    const cargadas = reales.filter((c) => MAPA[c]);
    const fuera = reales.filter((c) => !MAPA[c]);
    expect(cargadas).toHaveLength(23);
    expect(fuera).toEqual(["CONCATENATE", "CRM TYPE: STORE", "CRM TYPE: GROUP", "ASSOCIATED WITH"]);
    expect(COLUMNAS).toHaveLength(23);
  });
});

describe("filasDeHoja", () => {
  it("encuentra la fila de cabeceras (ACCOUNT y STORE) aunque haya titulo encima, y mapea por columna de la base", () => {
    const crudas = [
      [undefined, "Rodriguez Home Center LLC"],
      [undefined],
      CABECERAS,
      fila({ HOUSE: 328, "DATE. ADDED": 1, STORE: "MCA", "QB INACTIVE": "ACTIVE", ACCOUNT: "ACME LLC", "UNIFIED ACCOUNT": "ACME LLC", "STATUS TYPE: STORE": "NEW", "HISTORY \nTYPE: STORE": "SMALL", "Main Phone": "956-555-0101", "QB Credit Limit": 5000, Euler: { error: "#N/A" }, "Account No.": "INTERNAL CREDIT" }),
      [undefined],
    ];
    const filas = filasDeHoja(crudas);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toEqual({ house_no: 328, added_batch: 1, store: "MCA", qb_status: "ACTIVE", account: "ACME LLC", unified_account: "ACME LLC", status_store: "NEW", history_store: "SMALL", phone: "956-555-0101", credit_limit: 5000, account_no: "INTERNAL CREDIT" });
  });
  it("una hoja sin ACCOUNT y STORE (la RHC, cuya cabecera es «Customer») no es la de clientes", () => {
    expect(filasDeHoja([[undefined, "Active Status", "Customer", "Main Phone"], [undefined, "Active", "X", "1"]])).toBeNull();
  });
});

describe("filaACliente", () => {
  it("un «0» en texto es sin dato; la tienda en mayusculas; la tanda como texto; los numeros como numero y nunca negativos", () => {
    const c = filaACliente({ store: "mca", account: " Acme ", added_batch: 1, contact_name: 0, phone: "0", email: "0", rep_qb: "0", credit_limit: "1,500", euler_limit: -3, house_no: 12.0 });
    expect(c.store).toBe("MCA");
    expect(c.account).toBe("Acme");
    expect(c.added_batch).toBe("1");
    expect(c.contact_name).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.email).toBeNull();
    expect(c.rep_qb).toBeNull();
    expect(c.credit_limit).toBe(1500);
    expect(c.euler_limit).toBeNull();
    expect(c.house_no).toBe(12);
    // Todas las columnas presentes, con null donde no hay dato: el INSERT las nombra todas.
    for (const col of COLUMNAS) expect(col in c, col).toBe(true);
    expect(c.terms).toBeNull();
  });
  it("un HOUSE 0 si vale: es numerico y no es «sin dato»", () => {
    expect(filaACliente({ store: "BRO", account: "X", house_no: 0 }).house_no).toBe(0);
  });
});

describe("la clave natural y la fusion", () => {
  it("tienda en mayusculas + cuenta en minusculas, recortadas; sin una de las dos, no hay clave", () => {
    expect(claveDe({ store: " bro", account: "Paseo Residencial " })).toBe("BRO|paseo residencial");
    expect(claveDe({ store: "BRO", account: null })).toBeNull();
    expect(claveDe({ store: null, account: "X" })).toBeNull();
  });
  it("fusiona: la primera manda y la segunda rellena los huecos", () => {
    const a = filaACliente({ store: "BRO", account: "Paseo", rep_qb: "CRR", email: "a@b.co", phone: null });
    const b = filaACliente({ store: "BRO", account: "PASEO", rep_qb: "XX", email: "otro@b.co", phone: "956 909-5665" });
    const f = fusiona(a, b);
    expect(f.rep_qb).toBe("CRR");
    expect(f.email).toBe("a@b.co");
    expect(f.phone).toBe("956 909-5665");
  });
  it("preparar: dedupe por clave, cuenta fusionadas y saltadas, y agrupa por tienda y estado", () => {
    const p = preparar([
      { store: "BRO", account: "Paseo", status_store: "NEW" },
      { store: "bro", account: "PASEO ", phone: "1" },
      { store: "MCA", account: "Acme", status_store: "LOST" },
      { store: "MCA", account: null },
      { store: null, account: "Sin tienda" },
    ]);
    expect(p.clientes).toHaveLength(2);
    expect(p.fusionadas).toBe(1);
    expect(p.saltadas).toBe(2);
    expect(p.leidas).toBe(5);
    expect(p.porTienda).toEqual({ BRO: 1, MCA: 1 });
    expect(p.porEstado).toEqual({ NEW: 1, LOST: 1 });
  });
  it("preparar es idempotente: dos veces lo mismo da lo mismo", () => {
    const filas = [{ store: "BRO", account: "Paseo" }, { store: "MCA", account: "Acme" }];
    expect(preparar(filas)).toEqual(preparar(filas));
  });
});

describe("el upsert", () => {
  it("dedupe por el indice unico de la 180; las columnas del Excel solo si traen valor; cuenta y tienda no se reescriben; devuelve si fue nueva", () => {
    const sql = sqlDeUpsert(2);
    expect(sql).toContain("insert into erp.customers (" + [...COLUMNAS, "source", "imported_at"].join(", ") + ")");
    expect(sql).toContain("on conflict (upper(btrim(store)), lower(btrim(account))) do update set");
    expect(sql).toContain("phone = coalesce(excluded.phone, erp.customers.phone)");
    expect(sql).not.toMatch(/\baccount = /);
    expect(sql).not.toMatch(/\bstore = /);
    expect(sql).not.toMatch(/\bnotes = /);
    expect(sql).toContain("returning (xmax = 0) as nueva");
    // Dos filas = dos tuplas, con los marcadores seguidos y el source al final.
    expect(sql).toContain(`($1, $2`);
    expect(sql).toContain(`$${COLUMNAS.length * 2 + 1}, now())`);
    const p = parametrosDe([filaACliente({ store: "BRO", account: "A" }), filaACliente({ store: "MCA", account: "B" })], "xlsx hoy");
    expect(p).toHaveLength(COLUMNAS.length * 2 + 1);
    expect(p[p.length - 1]).toBe("xlsx hoy");
  });
  it("sin bandera no toca la base; --ensayo hace ROLLBACK y solo --escribe hace COMMIT; nunca borra", () => {
    const g = readFileSync("scripts/importa-clientes.mjs", "utf8");
    expect(g).toContain("if (!escribe && !ensayo) {");
    expect(g).toContain('if (escribe) { await c.query("commit");');
    expect(g).toContain('else { await c.query("rollback");');
    expect(g).not.toMatch(/delete from erp\.customers/i);
    expect(g).not.toMatch(/truncate/i);
  });
});
