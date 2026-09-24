import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ESTADOS, ESTADO_FINAL, ESTADO_INICIAL, ahoraLocal, busca, diaLocal, normalizaEstado, palabras, tapaSecretos,
  tareaNueva, valida,
} from "./tarea.mjs";

/**
 * El tracker se vigila desde la misma suite que la app, aunque viva fuera de `src/`.
 *
 * Lo que se mide aquí es lo que lo hace útil o inútil: que «Completado» no se pueda poner solo, que
 * los secretos no lleguen al repo, que la fecha sea la del negocio y no la de UTC, y que buscar
 * encuentre lo parecido sin salir de esta máquina.
 */

const CLI = join(process.cwd(), "tracker", "cli.mjs");
const corre = (args, opciones = {}) =>
  execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...opciones });

describe("los cuatro estados son los que dijo el dueño, con sus palabras", () => {
  it("se guardan con acento y con el guion largo", () => {
    // Guardarlos «como se teclean» sería cambiar sus palabras por las mías. El guion es U+2013.
    expect(ESTADOS).toHaveLength(4);
    expect(ESTADOS[0]).toBe("En revisi" + String.fromCharCode(0xf3) + "n " + String.fromCharCode(0x2013) + " desplegado");
    expect(ESTADOS).toContain("Completado");
    expect(ESTADO_INICIAL).toBe("Ocupa revisi" + String.fromCharCode(0xf3) + "n");
  });

  it("pero se aceptan tecleados de cualquier forma", () => {
    expect(normalizaEstado("en revision - desplegado")).toBe(ESTADOS[0]);
    expect(normalizaEstado("  EN REVISION  -  NO DESPLEGADO ")).toBe(ESTADOS[1]);
    expect(normalizaEstado("ocupa revisión")).toBe(ESTADOS[2]);
    expect(normalizaEstado("terminado")).toBeNull();
  });
});

describe("«Completado» no se pone solo — la regla que sostiene el resto", () => {
  // Se prueba por las DOS puertas que pueden escribirlo. Una regla que solo vigila una puerta no
  // vigila nada, y aquí las puertas son el CLI y la app.
  //
  // El CLI corre **contra una carpeta temporal**, no contra `tracker/tareas/`. La primera versión de
  // esto escribía donde escribe el programa y dejó dos tareas «de prueba» dentro del repo, una por
  // cada vez que corrió la suite.
  let dir;
  let entorno;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tracker-"));
    entorno = { env: { ...process.env, TRACKER_TAREAS: dir } };
    corre(["add", "--resumen", "una tarea para cerrarla"], entorno);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const rechaza = (args) => {
    try {
      corre(args, entorno);
      return "(el CLI lo dejó pasar)";
    } catch (e) {
      return String(e.stderr ?? e.message);
    }
  };

  it("el CLI se niega sin la confirmación del dueño", () => {
    expect(rechaza(["update", "T-0001", "--estado", "Completado"])).toContain("solo lo pone el dueño");
  });

  it("y con la confirmación sigue exigiendo una nota que diga cuándo lo dijo", () => {
    expect(rechaza(["update", "T-0001", "--estado", "Completado", "--confirmado-por-el-dueno"])).toContain("nota");
  });

  it("con las dos cosas, sí se cierra — para que la prueba mida la puerta y no un muro", () => {
    // Sin este caso, las dos de arriba pasarían igual con un CLI que rechazara SIEMPRE.
    const salida = corre(["update", "T-0001", "--estado", "Completado",
      "--confirmado-por-el-dueno", "--nota", "lo confirmo el 2026-09-23 por mensaje"], entorno);
    expect(salida).toContain(ESTADO_FINAL);
    expect(JSON.parse(readFileSync(join(dir, "T-0001.json"), "utf8")).estado).toBe(ESTADO_FINAL);
  });

  it("el servidor lleva la misma regla escrita, no una parecida", () => {
    const src = readFileSync(join(process.cwd(), "tracker", "server.mjs"), "utf8");
    expect(src).toContain("if (!c.confirmadoPorElDueno) return json(res, 400,");
    expect(src).toContain("if (!String(c.nota ?? \"\").trim()) return json(res, 400,");
  });
});

describe("el puerto ocupado se dice en una línea, no con una traza", () => {
  it("y sale con código 1 sin soltar «Unhandled error event»", async () => {
    // El caso normal: varias sesiones trabajan en este repo a la vez. El 2026-09-23 una levantó el
    // tracker, se encontró el puerto ocupado por otra, leyó la traza como «está roto», midió el
    // servidor ajeno creyendo que era el suyo y acabó matándolo por PID.
    //
    // Se ocupa un puerto EFÍMERO de verdad en vez del 4319: así la prueba no depende de que nadie
    // más lo tenga cogido, ni lo coge ella.
    const { createServer } = await import("node:net");
    const cerrojo = createServer();
    const puerto = await new Promise((r) => cerrojo.listen(0, "127.0.0.1", () => r(cerrojo.address().port)));
    try {
      const salida = (() => {
        try {
          execFileSync(process.execPath, [join(process.cwd(), "tracker", "server.mjs")],
            { encoding: "utf8", env: { ...process.env, TRACKER_PUERTO: String(puerto) }, timeout: 10000 });
          return "(arrancó igual, que es lo que no debe pasar)";
        } catch (e) {
          return String(e.stderr ?? "") + "|codigo:" + e.status;
        }
      })();
      expect(salida).toContain("Ya hay un tracker escuchando");
      expect(salida).toContain("TRACKER_PUERTO");
      expect(salida).toContain("|codigo:1");
      expect(salida).not.toContain("Unhandled");
      expect(salida).not.toContain("at Server.");
    } finally {
      cerrojo.close();
    }
  });
});

describe("los secretos no llegan al repo", () => {
  it("tapa los tokens que de verdad se han pegado en este chat", () => {
    const casos = [
      ["ntn_" + "A".repeat(30), "[token-notion-tapado]"],
      ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u", "[jwt-tapado]"],
      ["postgresql://usuario:clave@servidor:5432/base", "[cadena-de-conexion-tapada]"],
      ["escribe a alguien@ejemplo.com", "[correo-tapado]"],
      ["llama al 956-555-0123", "[telefono-tapado]"],
    ];
    for (const [entrada, esperado] of casos) {
      const { texto, tapados } = tapaSecretos(entrada);
      expect([entrada, texto], entrada).toEqual([entrada, expect.stringContaining(esperado)]);
      expect(tapados, entrada).toContain(esperado);
    }
  });

  it("el texto sigue contando qué se pidió: se tapa el secreto, no la frase", () => {
    const { texto } = tapaSecretos("corre el sync con NOTION_TOKEN=ntn_" + "B".repeat(30) + " y avisame");
    expect(texto).toContain("corre el sync con NOTION_TOKEN=");
    expect(texto).toContain("y avisame");
    expect(texto).not.toContain("BBBB");
  });

  it("un texto normal no se toca", () => {
    const t = "quiero que almacen vea solo lo de su tienda";
    expect(tapaSecretos(t)).toEqual({ texto: t, tapados: [] });
  });
});

describe("la fecha es la del negocio, no la de UTC", () => {
  it("a las 7 de la tarde en Texas sigue siendo hoy, aunque UTC ya esté en mañana", () => {
    // El caso exacto que se vio en la primera captura de la app: una nota de la tarde del 23 salía
    // fechada el 24. `slice(0,10)` sobre el ISO es UTC; esto no.
    const laTarde = new Date("2026-09-24T00:30:00Z");   // 19:30 del 23 en America/Chicago
    expect(laTarde.toISOString().slice(0, 10)).toBe("2026-09-24");
    expect(diaLocal(laTarde)).toBe("2026-09-23");
  });

  it("y una tarea nueva nace con esa fecha", () => {
    expect(tareaNueva().fecha).toBe(diaLocal());
  });

  it("las horas se guardan con el desfase de Texas dentro, no en Z", () => {
    // `Z` apunta al mismo instante, pero el JSON se lee A OJO —con `show`, en un diff— y
    // «2026-09-24T02:11:38Z» se lee como «el 24». Con el desfase delante no hay que convertir nada.
    expect(ahoraLocal(new Date("2026-09-24T02:11:38Z"))).toBe("2026-09-23T21:11:38-05:00");
    expect(ahoraLocal()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // Y el dia que lleva dentro es el mismo que da `diaLocal`, que es lo que ordena la tabla.
    expect(ahoraLocal().slice(0, 10)).toBe(diaLocal());
  });

  it("ninguna tarea guardada quedo con una hora en Z", () => {
    // Las quince primeras se escribieron antes de este arreglo y hubo que migrarlas. Esto impide
    // que vuelva a colarse una por otro camino.
    const dir = join(process.cwd(), "tracker", "tareas");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const horas = [t.creado, t.modificado, ...(t.notas ?? []).map((n) => n.fecha)];
      for (const h of horas) expect([f, h], f).toEqual([f, expect.stringMatching(/[+-]\d{2}:\d{2}$/)]);
    }
  });
});

describe("una tarea mal formada no se guarda", () => {
  it("dice todo lo que le falta, no solo lo primero", () => {
    const problemas = valida({ id: "xxx", fecha: "ayer", resumen: "", estado: "inventado", lo_hizo_claude: "quiza" });
    expect(problemas).toHaveLength(5);
  });

  it("y una tarea que es su propia madre tampoco", () => {
    expect(valida({ ...tareaNueva({ id: "T-0001", resumen: "x" }), padre: "T-0001" }))
      .toContain("una tarea no puede ser su propia madre");
  });
});

describe("buscar parecidos, sin salir de esta máquina", () => {
  const tareas = [
    tareaNueva({ id: "T-0001", resumen: "almacen ve solo lo de sus tiendas y recibe las intertiendas" }),
    tareaNueva({ id: "T-0002", resumen: "el chofer firma la entrega con el dedo en el movil" }),
    tareaNueva({ id: "T-0003", resumen: "las ordenes de almacen se filtran por tienda" }),
  ];

  it("encuentra la que habla de lo mismo y deja fuera la que no", () => {
    const r = busca("quiero que almacen vea solo las de su tienda", tareas);
    expect(r.map((x) => x.tarea.id)).toContain("T-0001");
    expect(r.map((x) => x.tarea.id)).not.toContain("T-0002");
  });

  it("y dice POR QUÉ se parece, que es lo que hace que sirva de aviso", () => {
    // Un porcentaje suelto no se puede discutir; «por: almacen, tienda» sí.
    const [primero] = busca("almacen tienda", tareas);
    expect(primero.comunes.sort()).toEqual(["almacen", "tienda"]);
  });

  it("las palabras de relleno no cuentan como parecido", () => {
    // Sin esto, «quiero que por favor hagas esto» se parecería a todo.
    expect(palabras("quiero que por favor hagas esto")).toEqual(["hagas"]);
    expect(busca("quiero que por favor", tareas)).toEqual([]);
  });

  it("y no hay ninguna llamada de red en el camino", () => {
    // La regla del dueño es que su texto no salga de aquí. Se mide sobre el fuente, porque una
    // prueba de comportamiento no distingue «no llamó» de «no llamó esta vez».
    const src = readFileSync(join(process.cwd(), "tracker", "tarea.mjs"), "utf8");
    for (const rastro of ["fetch(", "https://", "http://", "node:https", "node:http"]) {
      expect(src, rastro).not.toContain(rastro);
    }
  });
});

describe("un fichero por tarea, y los ids no se pisan", () => {
  it("las tareas de ejemplo están cada una en su fichero", () => {
    const dir = join(process.cwd(), "tracker", "tareas");
    const ficheros = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(ficheros.length).toBeGreaterThanOrEqual(4);
    for (const f of ficheros) {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8"));
      expect(f, f).toBe(t.id + ".json");
      expect(valida(t), f).toEqual([]);
    }
  });

  it("y ninguna tarea de ejemplo se declara Completada", () => {
    // El dueño aún no ha confirmado nada. Que el propio repo arranque con ceros es parte del punto.
    const dir = join(process.cwd(), "tracker", "tareas");
    const estados = readdirSync(dir).filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).estado);
    expect(estados).not.toContain(ESTADO_FINAL);
  });
});
