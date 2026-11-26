import { describe, it, expect } from "vitest";
import { APP_VERSIONS } from "@/lib/app-versions";
import {
  appDeLaRuta,
  cabeEnElCuerpo,
  Desduplicador,
  fallasDelCuerpo,
  huellaDeFalla,
  LIMITES,
  limpiarRuta,
  limpiarTexto,
  normalizarFalla,
  VENTANA_DE_DEDUPE_MS,
} from "./reglas";

describe("limpiarTexto: lo que sale hacia la base no lleva correos, tokens ni query strings", () => {
  it("quita correos", () => {
    const t = limpiarTexto("Falla para ana.lopez@correo.com en la orden", 500);
    expect(t).toBe("Falla para [correo] en la orden");
  });

  it("quita cabeceras Bearer y claves con valor", () => {
    expect(limpiarTexto("Authorization: Bearer eyJhbGciOi.payload.firma", 500)).not.toContain("eyJ");
    expect(limpiarTexto("password=hunter2 y api_key: abc", 500)).toBe("password=[oculto] y api_key: [oculto]");
  });

  it("quita tokens largos con letras y cifras, y deja los UUID", () => {
    const token = "sesion=q8Zk2LmN9pXr4TvW7yBc3DfG6HjK1mNo";
    expect(limpiarTexto(`error en ${token}`, 500)).not.toContain("q8Zk2");
    const uuid = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
    expect(limpiarTexto(`orden ${uuid}`, 500)).toContain(uuid);
  });

  it("quita el query string y el fragmento de las URL que salen en el texto", () => {
    expect(limpiarTexto("GET https://app.ejemplo.com/cb?code=123&token=zz falló", 500))
      .toBe("GET https://app.ejemplo.com/cb falló");
    expect(limpiarTexto("en /home/users?next=/x#top", 500)).toBe("en /home/users");
  });

  it("recorta a su tope, con puntos suspensivos al final", () => {
    const largo = limpiarTexto("a".repeat(600), LIMITES.mensaje);
    expect(largo.length).toBe(LIMITES.mensaje);
    expect(largo.endsWith("…")).toBe(true);
  });

  it("no lanza con entradas raras", () => {
    expect(limpiarTexto(null, 10)).toBe("");
    expect(limpiarTexto(42, 10)).toBe("42");
    expect(limpiarTexto({ a: 1 }, 100)).toBe("[object Object]");
  });
});

describe("limpiarRuta", () => {
  it("quita la query y el fragmento, y empieza por /", () => {
    expect(limpiarRuta("/home/users?next=/x")).toBe("/home/users");
    expect(limpiarRuta("home#x")).toBe("/home");
    expect(limpiarRuta(undefined)).toBe("/");
  });

  it("sustituye los segmentos que son token o correo", () => {
    expect(limpiarRuta("/reset-password/3f2a9c8b7d6e5f4a3b2c1d0e9f8a7b6cX1")).toBe("/reset-password/:token");
    expect(limpiarRuta("/erp/ana@correo.com")).toBe("/erp/:correo");
    expect(limpiarRuta("/home/users/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed")).toBe("/home/users/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed");
  });
});

describe("huellaDeFalla: lo que hace que dos fallas sean la misma", () => {
  const base = { origen: "cliente", ruta: "/timetracker/clock-in", mensaje: "boom", pila: "TypeError: boom\n    at f (a.ts:1:1)" };

  it("es estable y de 16 caracteres hex", () => {
    const h = huellaDeFalla(base);
    expect(h).toBe(huellaDeFalla({ ...base }));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("cambia con el origen, la ruta o el mensaje", () => {
    const h = huellaDeFalla(base);
    expect(huellaDeFalla({ ...base, origen: "api" })).not.toBe(h);
    expect(huellaDeFalla({ ...base, ruta: "/erp" })).not.toBe(h);
    expect(huellaDeFalla({ ...base, mensaje: "otro" })).not.toBe(h);
  });

  it("no cambia con las líneas de la pila que no son la primera", () => {
    const h = huellaDeFalla(base);
    expect(huellaDeFalla({ ...base, pila: base.pila + "\n    at g (b.ts:9:9)" })).toBe(h);
  });
});

describe("normalizarFalla", () => {
  const cruda = { origen: "cliente", ruta: "/timetracker/clock-in?x=1", mensaje: "Falla de ana@correo.com", pila: "Error: boom\n    at f (a.ts:1:1)", componente: "ficha" };

  it("produce exactamente las columnas de la tabla, y ninguna de usuario", () => {
    const f = normalizarFalla(cruda, { rol: "sales", navegador: "UA/1.0", escritorio: true });
    expect(f).not.toBeNull();
    expect(Object.keys(f!).sort()).toEqual(
      ["origen", "app", "ruta", "mensaje", "pila", "componente", "rol", "version", "navegador", "escritorio", "huella"].sort(),
    );
    expect(f!.ruta).toBe("/timetracker/clock-in");
    expect(f!.mensaje).toBe("Falla de [correo]");
    expect(f!.app).toBe("timetracker");
    expect(f!.version).toBe(APP_VERSIONS.timetracker);
    expect(f!.escritorio).toBe(true);
  });

  it("el query string no cambia la huella", () => {
    const a = normalizarFalla({ ...cruda, ruta: "/erp/x?a=1" });
    const b = normalizarFalla({ ...cruda, ruta: "/erp/x?a=2" });
    expect(a!.huella).toBe(b!.huella);
  });

  it("rechaza lo que no sirve: origen desconocido, sin mensaje, no es objeto", () => {
    expect(normalizarFalla({ ...cruda, origen: "hacker" })).toBeNull();
    expect(normalizarFalla({ ...cruda, mensaje: "   " })).toBeNull();
    expect(normalizarFalla(null)).toBeNull();
    expect(normalizarFalla([cruda])).toBeNull();
    expect(normalizarFalla("boom")).toBeNull();
  });

  it("no lanza nunca, ni con un objeto raro", () => {
    const raro = { origen: "cliente", ruta: { toString() { throw new Error("x"); } }, mensaje: "m" };
    expect(() => normalizarFalla(raro)).not.toThrow();
  });

  it("el navegador y el escritorio no salen del cuerpo sino del contexto", () => {
    const f = normalizarFalla({ ...cruda, navegador: "falso", escritorio: true }, { navegador: undefined, escritorio: false });
    expect(f!.navegador).toBeNull();
    expect(f!.escritorio).toBe(false);
  });

  it("la app sale de la ruta, o del contexto si lo declara el servidor", () => {
    expect(normalizarFalla({ ...cruda, ruta: "/leads/pool" })!.app).toBe("leads");
    expect(normalizarFalla({ ...cruda, ruta: "/api/cron/x" })!.app).toBe("deliveries");
    expect(normalizarFalla({ ...cruda, ruta: "/api/cron/x" }, { app: "hub" })!.app).toBe("hub");
  });
});

describe("appDeLaRuta", () => {
  it("cada zona del hub cae en su app; lo demás es Entregas", () => {
    expect(appDeLaRuta("/home/users")).toBe("hub");
    expect(appDeLaRuta("/recruiting/x")).toBe("recruiting");
    expect(appDeLaRuta("/")).toBe("deliveries");
  });
});

describe("Desduplicador: la misma huella, una vez por minuto", () => {
  it("deja pasar la primera, bloquea la repetida dentro de la ventana y la deja pasar después", () => {
    const d = new Desduplicador();
    const t0 = 1_000_000;
    expect(d.debeEnviarse("h1", t0)).toBe(true);
    expect(d.debeEnviarse("h1", t0 + 1000)).toBe(false);
    expect(d.debeEnviarse("h2", t0 + 1000)).toBe(true);
    expect(d.debeEnviarse("h1", t0 + VENTANA_DE_DEDUPE_MS)).toBe(true);
  });

  it("tiene tope de memoria: olvida la huella más vieja", () => {
    const d = new Desduplicador(60_000, 2);
    d.debeEnviarse("a", 0);
    d.debeEnviarse("b", 1);
    d.debeEnviarse("c", 2);
    expect(d.debeEnviarse("a", 3)).toBe(true);
  });
});

describe("tamaño del envío", () => {
  it("cabe hasta el tope y no más", () => {
    expect(cabeEnElCuerpo("x".repeat(LIMITES.cuerpo))).toBe(true);
    expect(cabeEnElCuerpo("x".repeat(LIMITES.cuerpo + 1))).toBe(false);
  });

  it("un lote saca como mucho diez fallas; una sola falla también vale", () => {
    const muchas = { fallas: Array.from({ length: 25 }, (_, i) => ({ i })) };
    expect(fallasDelCuerpo(muchas)).toHaveLength(LIMITES.lote);
    expect(fallasDelCuerpo({ origen: "cliente", mensaje: "x" })).toHaveLength(1);
    expect(fallasDelCuerpo("basura")).toEqual([]);
    expect(fallasDelCuerpo(null)).toEqual([]);
  });
});
