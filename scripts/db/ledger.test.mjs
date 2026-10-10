import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  MARK, MIG_DIR, checksum, cuerpoYRegistro, lineaDeRegistro,
  llevaTransaccionPropia, problemasParaAplicar, shaDeclarado, sqlDesnudo,
} from "./ledger.mjs";

/**
 * D-512 · Los guardas de `aplica-migracion.mjs`.
 *
 * Esto no prueba que una migracion se aplique -eso necesita produccion-. Prueba lo que DECIDE si se
 * aplica, que es donde han estado los errores de verdad de este repo:
 *
 *  - la 124 se aplico sola en un ensayo con ROLLBACK porque su `commit` cerro la transaccion de fuera;
 *  - numerar un D-NEXT dentro de un .sql cambio su checksum y dejo la linea de registro declarando
 *    el viejo, dos veces el 2026-10-10.
 *
 * El caso que mas dice es el primero del segundo bloque: un `do $$ ... begin ... end $$;` NO es una
 * transaccion, y una implementacion que busque `begin` con un grep rechazaria migraciones validas.
 */

const SHA_CERO = "0".repeat(64);
const sinRegistrar = new Map();

const conRegistro = (nombre, cuerpo) => {
  const texto = `${cuerpo}\n${MARK}\n`;
  return `${texto}${lineaDeRegistro(nombre, checksum(texto))}\n`;
};

describe("el checksum es del cuerpo, no del fichero", () => {
  it("la linea de registro no cambia el checksum que ella misma declara", () => {
    const cuerpo = "update public.settings set x = 1;";
    const a = checksum(`${cuerpo}\n${MARK}\n`);
    const b = checksum(`${cuerpo}\n${MARK}\n${lineaDeRegistro("1_x.sql", a)}\n`);
    expect(b).toBe(a);
  });

  it("CRLF y LF dan el mismo checksum — no puede depender del editor", () => {
    const cuerpo = "select 1;\nselect 2;";
    expect(checksum(cuerpo.split("\n").join("\r\n"))).toBe(checksum(cuerpo));
  });

  it("cambiar el cuerpo SI lo cambia", () => {
    expect(checksum("select 1;")).not.toBe(checksum("select 2;"));
  });

  it("sin marcador, `registro` es null y el cuerpo es el fichero entero", () => {
    expect(cuerpoYRegistro("select 1;")).toEqual({ cuerpo: "select 1;", registro: null });
  });
});

describe("una transaccion propia se distingue de un begin dentro de un bloque", () => {
  it("un `do $$ ... begin ... end $$;` NO es una transaccion propia", () => {
    // El caso real: asi se escribe una comprobacion al final de una migracion en este repo. Un
    // grep de `begin` la rechazaria.
    const sql = [
      "update public.settings set a = 1;",
      "do $$",
      "declare faltan text;",
      "begin",
      "  if faltan is not null then raise exception 'mal'; end if;",
      "end $$;",
    ].join("\n");
    expect(llevaTransaccionPropia(sql)).toBe(false);
  });

  it("un `commit;` de verdad si lo es, y un `begin;` tambien", () => {
    expect(llevaTransaccionPropia("begin;\nupdate t set a = 1;\ncommit;")).toBe(true);
    expect(llevaTransaccionPropia("update t set a = 1;\ncommit;")).toBe(true);
    expect(llevaTransaccionPropia("start transaction;\nselect 1;")).toBe(true);
  });

  it("un `begin` comentado no cuenta: es prosa", () => {
    expect(llevaTransaccionPropia("-- antes esto llevaba begin; y commit;\nselect 1;")).toBe(false);
  });

  it("`case ... end` no cuenta: `end` solo cierra transaccion al principio de sentencia", () => {
    expect(llevaTransaccionPropia("select case when a then 1 else 2 end from t;")).toBe(false);
  });

  it("una etiqueta de dolar con nombre tambien se quita", () => {
    expect(llevaTransaccionPropia("do $cuerpo$ begin null; end $cuerpo$;")).toBe(false);
  });

  it("el SQL desnudo se queda sin el bloque y sin los comentarios", () => {
    const d = sqlDesnudo("-- nota\nselect 1;\ndo $$ begin null; end $$;");
    expect(d).toContain("select 1;");
    expect(d).not.toContain("nota");
    expect(d).not.toContain("null");
  });
});

describe("el sha declarado dentro del fichero", () => {
  it("se lee de la linea de registro de ESE fichero, no de otra", () => {
    const texto = `select 1;\n${MARK}\n${lineaDeRegistro("9_otra.sql", SHA_CERO)}\n`;
    expect(shaDeclarado(texto, "9_otra.sql")).toBe(SHA_CERO);
    // Una linea que nombra otro fichero no vale como registro de este.
    expect(shaDeclarado(texto, "9_esta.sql")).toBeNull();
  });

  it("un punto del nombre no se trata como comodin", () => {
    const texto = `select 1;\n${MARK}\n${lineaDeRegistro("9_a.sql", SHA_CERO)}\n`;
    expect(shaDeclarado(texto, "9_aXsql")).toBeNull();
  });
});

describe("problemasParaAplicar", () => {
  it("una migracion bien formada no da ninguno", () => {
    const texto = conRegistro("9_ok.sql", "update public.settings set a = 1;");
    expect(problemasParaAplicar({ nombre: "9_ok.sql", texto, registradas: sinRegistrar })).toEqual([]);
  });

  it("sin marcador: lo dice, porque si no quedaria pendiente para siempre", () => {
    const malos = problemasParaAplicar({ nombre: "9_x.sql", texto: "select 1;", registradas: sinRegistrar });
    expect(malos).toHaveLength(1);
    expect(malos[0]).toContain(MARK);
  });

  it("checksum declarado que no es el del cuerpo: el error de numerar un D-NEXT", () => {
    // Se construye el fichero bien y luego se le toca el cuerpo, que es exactamente lo que pasa al
    // sustituir el marcador por el numero real.
    const bueno = conRegistro("9_x.sql", "update t set a = 1; -- D-NEXT");
    const tocado = bueno.split("D-NEXT").join("D-999");
    const malos = problemasParaAplicar({ nombre: "9_x.sql", texto: tocado, registradas: sinRegistrar });
    expect(malos).toHaveLength(1);
    expect(malos[0]).toContain("el checksum declarado no es el del cuerpo");
    expect(malos[0]).toContain(checksum(tocado));
  });

  it("con transaccion propia: lo dice, y explica que el ensayo se aplicaria de verdad", () => {
    const texto = conRegistro("9_x.sql", "begin;\nupdate t set a = 1;\ncommit;");
    const malos = problemasParaAplicar({ nombre: "9_x.sql", texto, registradas: sinRegistrar });
    expect(malos.some((m) => m.includes("su propia transaccion"))).toBe(true);
  });

  it("ya aplicada con el mismo checksum: no hay nada que hacer", () => {
    const texto = conRegistro("9_x.sql", "select 1;");
    const malos = problemasParaAplicar({
      nombre: "9_x.sql", texto, registradas: new Map([["9_x.sql", checksum(texto)]]),
    });
    expect(malos).toEqual(["ya esta aplicada y su checksum coincide: no hay nada que hacer"]);
  });

  it("ya aplicada con OTRO checksum: avisa de que el fichero cambio despues de correr", () => {
    const texto = conRegistro("9_x.sql", "select 1;");
    const malos = problemasParaAplicar({
      nombre: "9_x.sql", texto, registradas: new Map([["9_x.sql", SHA_CERO]]),
    });
    expect(malos).toHaveLength(1);
    expect(malos[0]).toContain("con OTRO checksum");
  });

  it("--otra-vez salta solo el guarda de «ya aplicada», no los demas", () => {
    const yaCon = new Map([["9_x.sql", SHA_CERO]]);
    const bien = conRegistro("9_x.sql", "select 1;");
    expect(problemasParaAplicar({ nombre: "9_x.sql", texto: bien, registradas: yaCon, otraVez: true })).toEqual([]);
    // Pero un fichero sin marcador sigue dando problema con --otra-vez.
    const malos = problemasParaAplicar({ nombre: "9_x.sql", texto: "select 1;", registradas: yaCon, otraVez: true });
    expect(malos).toHaveLength(1);
  });

  it("acumula varios problemas en vez de parar en el primero", () => {
    const texto = `begin;\nselect 1;\ncommit;\n${MARK}\n${lineaDeRegistro("9_x.sql", SHA_CERO)}\n`;
    const malos = problemasParaAplicar({ nombre: "9_x.sql", texto, registradas: sinRegistrar });
    expect(malos).toHaveLength(2);
  });
});

describe("contra las migraciones de verdad del repo", () => {
  const todas = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();

  it("hay migraciones que leer", () => {
    expect(todas.length).toBeGreaterThan(100);
  });

  it("ninguna de las que ya corrieron lleva transaccion propia", () => {
    // Si alguna la llevara, aplicarla con este script seria peligroso y hay que saberlo por nombre.
    const culpables = todas.filter((f) => llevaTransaccionPropia(readFileSync(join(MIG_DIR, f), "utf8")));
    expect(culpables).toEqual([]);
  });

  it("la 164 pasa los guardas: es la que tiene el `do $$ ... begin ... end $$;`", () => {
    const nombre = "164_tipo_proveedor.sql";
    const texto = readFileSync(join(MIG_DIR, nombre), "utf8");
    // Primero, que el caso difícil esté de verdad en el fichero: sin esto la prueba pasaría
    // igual si alguien quitara el bloque, y entonces no mediría nada.
    expect(texto).toContain("do $$");
    expect(texto).toMatch(/^begin$/m);
    expect(problemasParaAplicar({ nombre, texto, registradas: sinRegistrar })).toEqual([]);
  });
});
