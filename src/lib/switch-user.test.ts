import { describe, it, expect } from "vitest";
import { agruparPorTienda, totalFilas } from "./switch-user";
import type { NamedLocation, Profile } from "@/lib/types";
import { readFileSync } from "node:fs";

const u = (id: string, full_name: string, role: string, store: string | null): Profile =>
  ({ id, full_name, role, store, username: null } as unknown as Profile);

const TIENDAS: NamedLocation[] = [
  { name: "McAllen", address: "" },
  { name: "Brownsville", address: "" },
  { name: "Harlingen", address: "" },
];

const GENTE = [
  u("1", "Patricia Hernández", "sales", "McAllen"),
  u("2", "Ana Ruiz", "driver", "McAllen"),
  u("3", "Beto Salinas", "warehouse", "Brownsville"),
  u("4", "Carla Vega", "admin", "McAllen"),
  u("5", "Diego Mora", "logistics", null),
  u("6", "Elsa Prieto", "sales", "Weslaco"), // tienda que ya no está en Ajustes
];

describe("el orden: tiendas como en Ajustes, y dentro por nombre", () => {
  const grupos = agruparPorTienda(GENTE, TIENDAS);

  it("las tiendas salen en el orden de Ajustes, no alfabético", () => {
    // Alfabético sería Brownsville, Harlingen, McAllen. El orden que vale es el que puso
    // alguien, porque es el que tiene en la cabeza quien mira.
    expect(grupos.map((g) => g.tienda)).toEqual(["McAllen", "Brownsville", null]);
  });

  it("dentro de cada tienda, por nombre", () => {
    expect(grupos[0].filas.map((f) => f.user.full_name)).toEqual([
      "Ana Ruiz", "Carla Vega", "Patricia Hernández",
    ]);
  });

  it("una tienda sin gente no sale: Harlingen no está", () => {
    expect(grupos.map((g) => g.tienda)).not.toContain("Harlingen");
  });

  it("los sin tienda van al final, en su propio grupo", () => {
    expect(grupos[grupos.length - 1].tienda).toBeNull();
  });

  it("y con ellos los de una tienda que ya no existe en Ajustes", () => {
    // Si alguien borra «Weslaco», su gente no puede desaparecer de la lista.
    const sueltos = grupos[grupos.length - 1].filas.map((f) => f.user.full_name);
    expect(sueltos).toContain("Elsa Prieto");
    expect(sueltos).toContain("Diego Mora");
  });

  it("no se pierde ni se duplica a nadie", () => {
    expect(totalFilas(grupos)).toBe(GENTE.length);
    const ids = grupos.flatMap((g) => g.filas.map((f) => f.user.id));
    expect(new Set(ids).size).toBe(GENTE.length);
  });
});

describe("un admin sale en la lista, pero sin botón", () => {
  it("Carla es admin: aparece y no se puede entrar como ella", () => {
    const carla = agruparPorTienda(GENTE, TIENDAS)
      .flatMap((g) => g.filas).find((f) => f.user.id === "4");
    expect(carla).toBeDefined();
    expect(carla!.puedeEntrar).toBe(false);
  });

  it("y todos los demás sí", () => {
    const otros = agruparPorTienda(GENTE, TIENDAS)
      .flatMap((g) => g.filas).filter((f) => f.user.id !== "4");
    expect(otros).toHaveLength(GENTE.length - 1);
    for (const f of otros) expect(f.puedeEntrar, f.user.full_name).toBe(true);
  });
});

describe("el buscador filtra antes de agrupar", () => {
  it("una tienda cuya gente no casa desaparece, sin cabecera huérfana", () => {
    const grupos = agruparPorTienda(GENTE, TIENDAS, "beto");
    expect(grupos.map((g) => g.tienda)).toEqual(["Brownsville"]);
    expect(totalFilas(grupos)).toBe(1);
  });

  it("no distingue mayúsculas y busca dentro del nombre", () => {
    expect(totalFilas(agruparPorTienda(GENTE, TIENDAS, "HERNÁNDEZ".toLowerCase()))).toBe(1);
    expect(totalFilas(agruparPorTienda(GENTE, TIENDAS, "a"))).toBeGreaterThan(1);
  });

  it("sin resultados devuelve cero grupos, no grupos vacíos", () => {
    expect(agruparPorTienda(GENTE, TIENDAS, "zzzz")).toEqual([]);
  });

  it("y sin filtro está toda la gente", () => {
    expect(totalFilas(agruparPorTienda(GENTE, TIENDAS, "   "))).toBe(GENTE.length);
  });
});

describe("casos de borde que no deben romper la lista", () => {
  it("sin tiendas configuradas, todos en el grupo sin tienda", () => {
    const grupos = agruparPorTienda(GENTE, []);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].tienda).toBeNull();
    expect(totalFilas(grupos)).toBe(GENTE.length);
  });

  it("sin gente, ningún grupo", () => {
    expect(agruparPorTienda([], TIENDAS)).toEqual([]);
  });

  it("una tienda con nombre vacío no se traga a los que no tienen tienda", () => {
    const conVacia = [...TIENDAS, { name: "  ", address: "" }];
    const grupos = agruparPorTienda(GENTE, conVacia);
    expect(grupos.map((g) => g.tienda)).toEqual(["McAllen", "Brownsville", null]);
  });
});

// ---- Lo que cuesta preguntar, que es lo que casi se cuela ----------------------------------
// `/api/impersonate/state` la llama el banner en CADA carga de página de las cinco apps, para
// todo el mundo. Meter ahí la consulta del rol le habría cobrado a cada persona una ida al
// servidor de auth y otra a `profiles` en cada carga, para calcular un `habilitado` que hoy
// —bandera apagada— es siempre `false`. El parámetro existe para no cobrárselo a quien no
// pregunta.
describe("el coste de /api/impersonate/state", () => {
  const src = readFileSync("src/app/api/impersonate/state/route.ts", "utf8");
  const codigo = src.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

  it("la salida sin cookie va ANTES de tocar la base", () => {
    const iSalida = codigo.indexOf("if (!guardado && !(preguntanPorElBoton && activa))");
    const iAuth = codigo.indexOf("auth.getUser()");
    const iPerfil = codigo.indexOf('.from("profiles")');
    expect(iSalida).toBeGreaterThan(-1);
    expect(iAuth).toBeGreaterThan(-1);
    expect(iPerfil).toBeGreaterThan(-1);
    expect(iSalida).toBeLessThan(iAuth);
    expect(iSalida).toBeLessThan(iPerfil);
  });

  it("y la bandera se lee antes que nada, porque es gratis", () => {
    // Es una lectura de entorno; ponerla después de la consulta no ahorraría nada.
    expect(codigo.indexOf("impersonacionActiva()")).toBeLessThan(codigo.indexOf("auth.getUser()"));
  });

  it("solo la página del hub pide el dato caro; ni la barra de Entregas ni el banner", () => {
    // Desde D-306 el panel es una herramienta del hub: la pregunta viaja con él. La barra ya no
    // la hace —no tiene botón—, y el banner sigue sin hacerla, que era lo que fijaba D-247.
    const pagina = readFileSync("src/app/home/switch-user/page.tsx", "utf8");
    expect(pagina).toContain("/api/impersonate/state?ask=switch");
    const barra = readFileSync("src/components/TopBar.tsx", "utf8");
    expect(barra).not.toContain("impersonate/state");
    const banner = readFileSync("src/components/ImpersonationBanner.tsx", "utf8");
    expect(banner).toContain('fetch("/api/impersonate/state")');
    expect(banner).not.toContain("ask=switch");
  });
});

// El panel se leía mal en pantalla, y el motivo no estaba en el panel: cuelga de la barra
// superior, que es oscura y pinta su texto de blanco, y el panel no decía ningún color propio,
// así que HEREDABA ese blanco sobre su fondo claro. Los nombres eran invisibles; los roles se
// leían porque `hint` sí trae color. Tampoco tenía fondo: por detrás se veía la página.
//
// Lo que se fija aquí es que el panel diga sus tres colores y su fondo, y que un nombre largo no
// pueda volver a partirse en tres líneas. El aspecto no se prueba desde aquí; la herencia sí.
describe("el panel de «Switch usuario» no hereda el color de la barra", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const panel = readFileSync("src/components/SwitchUserPanel.tsx", "utf8");
  const regla = (nombre: string) => {
    const i = css.indexOf(`.${nombre} {`);
    return i === -1 ? "" : css.slice(i, css.indexOf("}", i));
  };

  it("las reglas existen (control)", () => {
    expect(regla("switch-panel").length).toBeGreaterThan(50);
    expect(regla("switch-row").length).toBeGreaterThan(30);
    expect(regla("switch-row-name").length).toBeGreaterThan(30);
  });

  it("dice su color y su fondo, con tokens y no con un hex suelto", () => {
    const r = regla("switch-panel");
    expect(r).toMatch(/color:\s*var\(--/);
    expect(r).toMatch(/background:\s*var\(--/);
    expect(r).not.toMatch(/#[0-9a-fA-F]{3,6}\b(?![^;]*rgba)/);
  });

  it("es opaco y va por encima de la página: borde, sombra y `z-index`", () => {
    const r = regla("switch-panel");
    expect(r).toMatch(/border:\s*1px solid var\(--/);
    expect(r).toContain("box-shadow");
    expect(r).toMatch(/z-index:\s*\d/);
  });

  it("un nombre largo se recorta, no envuelve ni empuja al rol", () => {
    const nombre = regla("switch-row-name");
    expect(nombre).toContain("white-space: nowrap");
    expect(nombre).toContain("text-overflow: ellipsis");
    expect(regla("switch-row-role")).toContain("white-space: nowrap");
    // Cuatro columnas: avatar, nombre, rol y botón. Con el nombre en la única que se encoge.
    expect(regla("switch-row")).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\) auto auto/);
  });

  it("y el componente usa esas clases en vez de estilos sueltos", () => {
    // Con el modificador de página desde D-306: el mismo panel cuelga de un botón o ocupa su sitio.
    expect(panel).toContain('className={"switch-panel" + (enPagina ? " en-pagina" : "")}');
    expect(panel).toContain('className="switch-row"');
    expect(panel).toContain('className="switch-row-name"');
    // La caja que heredaba: `.box` no existe en `globals.css`, y por eso no pintaba nada.
    expect(panel).not.toContain('className="box"');
    expect(css).not.toContain(".box {");
  });
});
