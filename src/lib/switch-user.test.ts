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

  it("solo el botón pide el dato caro, y el banner no", () => {
    const barra = readFileSync("src/components/TopBar.tsx", "utf8");
    expect(barra).toContain("/api/impersonate/state?ask=switch");
    const banner = readFileSync("src/components/ImpersonationBanner.tsx", "utf8");
    expect(banner).toContain('fetch("/api/impersonate/state")');
    expect(banner).not.toContain("ask=switch");
  });
});
