import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLAVE_DE_ORDEN_DEL_HUB, claveDelNavegadorDelHub, guardaOrdenDelHub, leeOrdenDelHub, mueveModulo, ordenaModulos, ordenValido,
  puedeOrdenarElHub, valorDeOrden,
} from "./orden-del-hub";
import { CLAVES_DE_PREFERENCIA, type ClienteDePrefs } from "./user-prefs";

/** El admin ordena las apps del hub a su gusto (D-739, 2026-10-29). */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const M = [{ key: "deliveries" }, { key: "recruiting" }, { key: "customers" }, { key: "timetracker" }];
const claves = (l: { key: string }[]) => l.map((m) => m.key);

describe("quién ordena", () => {
  it("solo el admin", () => {
    expect(puedeOrdenarElHub({ role: "admin" })).toBe(true);
    for (const role of ["manager", "sales", "logistics", "accounting", "warehouse", "driver"]) expect(puedeOrdenarElHub({ role })).toBe(false);
  });
  it("y la clave está en la lista cerrada de la base (migración 214)", () => {
    expect([...CLAVES_DE_PREFERENCIA]).toContain(CLAVE_DE_ORDEN_DEL_HUB);
    expect(leer("supabase/migrations/214_user_prefs_hub_order.sql")).toContain(`'${CLAVE_DE_ORDEN_DEL_HUB}'`);
  });
});

describe("el orden guardado se aplica", () => {
  it("las apps en el orden de la lista; las que no están, después y como venían", () => {
    expect(claves(ordenaModulos(M, ["customers", "deliveries"]))).toEqual(["customers", "deliveries", "recruiting", "timetracker"]);
  });
  it("sin lista, el orden de siempre; las claves que la persona ya no tiene se ignoran", () => {
    expect(claves(ordenaModulos(M, []))).toEqual(claves(M));
    expect(claves(ordenaModulos(M, ["promos", "timetracker"]))).toEqual(["timetracker", "deliveries", "recruiting", "customers"]);
  });
  it("mover a la izquierda o a la derecha intercambia con el vecino; en el borde no pasa nada", () => {
    expect(mueveModulo(claves(M), "customers", -1)).toEqual(["deliveries", "customers", "recruiting", "timetracker"]);
    expect(mueveModulo(claves(M), "customers", 1)).toEqual(["deliveries", "recruiting", "timetracker", "customers"]);
    expect(mueveModulo(claves(M), "deliveries", -1)).toEqual(claves(M));
    expect(mueveModulo(claves(M), "timetracker", 1)).toEqual(claves(M));
    expect(mueveModulo(claves(M), "nadie", 1)).toEqual(claves(M));
  });
});

describe("lo que se guarda y lo que se lee", () => {
  it("la forma de la base es { modules: [...] }; lo roto o repetido se limpia", () => {
    expect(valorDeOrden(["a", "b", "a"])).toEqual({ modules: ["a", "b"] });
    expect(ordenValido({ modules: ["x", 3, "", "y"] })).toEqual(["x", "y"]);
    expect(ordenValido(["x"])).toEqual(["x"]);
    expect(ordenValido("x")).toEqual([]);
    expect(ordenValido(null)).toEqual([]);
    expect(ordenValido({ modules: new Array(41).fill("k") })).toEqual([]);
  });

  const cliente = (resp: { data: unknown; error: unknown }, escrito?: { data: unknown; error: unknown }, apunta?: (f: unknown) => void): ClienteDePrefs => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => resp as never }) }) }),
      upsert: (fila: unknown) => { apunta?.(fila); return { select: async () => (escrito ?? { data: [{ user_id: "u" }], error: null }) as never }; },
    }),
  }) as unknown as ClienteDePrefs;

  it("lee la base; sin fila o sin poder leer, el navegador", async () => {
    expect(await leeOrdenDelHub(cliente({ data: { value: { modules: ["b", "a"] } }, error: null }), "u", () => null)).toEqual(["b", "a"]);
    const nav = (k: string) => (k === claveDelNavegadorDelHub("u") ? JSON.stringify({ modules: ["c"] }) : null);
    expect(await leeOrdenDelHub(cliente({ data: null, error: null }), "u", nav)).toEqual(["c"]);
    expect(await leeOrdenDelHub(cliente({ data: null, error: { message: "sin 214" } }), "u", nav)).toEqual(["c"]);
    expect(await leeOrdenDelHub(cliente({ data: null, error: null }), "u", () => "{rota")).toEqual([]);
  });
  it("guarda en el navegador Y en la base, con la clave hub_order; si la base no lo admite, dice que no", async () => {
    const nav: Record<string, string> = {};
    let fila: unknown;
    expect(await guardaOrdenDelHub(cliente({ data: null, error: null }, undefined, (f) => { fila = f; }), "u", ["b", "a"], (k, v) => { nav[k] = v; })).toBe(true);
    expect(fila).toEqual({ user_id: "u", key: "hub_order", value: { modules: ["b", "a"] } });
    expect(JSON.parse(nav[claveDelNavegadorDelHub("u")])).toEqual({ modules: ["b", "a"] });
    expect(await guardaOrdenDelHub(cliente({ data: null, error: null }, { data: null, error: { message: "check" } }), "u", ["b"], (k, v) => { nav[k] = v; })).toBe(false);
    expect(JSON.parse(nav[claveDelNavegadorDelHub("u")])).toEqual({ modules: ["b"] });
  });
});

describe("la pantalla", () => {
  const hub = leer("src/components/HomeSelector.tsx");
  const sinComentarios = hub.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("el botón de ordenar solo para quien puede, y las flechas solo ordenando", () => {
    expect(sinComentarios).toContain("puedeOrdenarElHub(me) && (");
    expect(sinComentarios).toContain("data-hub-ordenar");
    expect(sinComentarios).toContain('data-mueve="izq"');
    expect(sinComentarios).toContain('data-mueve="der"');
    expect(sinComentarios).toContain("ordenaModulos(available, orden)");
  });
  it("Usuarios del hub manda a los empleados de RRHH, donde viven los permisos (D-720)", () => {
    const c = leer("src/lib/constants.ts");
    const i = c.indexOf('key: "users",');
    expect(c.slice(i, i + 700)).toContain('href: "/recruiting/employees"');
    expect(c).not.toContain('href: "/home/users"');
  });
  it("en la ficha del usuario, «Eliminar» va a la izquierda de «Listo», los dos al final de la fila", () => {
    const d = leer("src/components/UserDialog.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    const pie = d.slice(d.indexOf('<span style={{ flex: 1 }} />'));
    const eliminar = pie.indexOf('{t("Remove", "Eliminar")}</button>');
    const listo = pie.indexOf('{t("Done", "Listo")}</button>');
    expect(eliminar).toBeGreaterThan(0);
    expect(listo).toBeGreaterThan(eliminar);
    expect(d.indexOf('{t("Done", "Listo")}')).toBe(d.lastIndexOf('{t("Done", "Listo")}'));
  });
});
