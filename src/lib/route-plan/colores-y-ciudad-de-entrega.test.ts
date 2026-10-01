import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V6, MARCA_V7, ORDEN_DE_PARTIDA_DEL_GESTOR, VISTAS_EN_EL_PLAN,
  alternaColumna, columnasDeLaTabla, columnasDePlantillaDelGestor, conCiudadDeEntregaEnSuSitio, conColumnasNuevas, mueveEnElGestor,
  ordenDeLaTabla, preferenciasDelGestorAlLeer, seVeEnLaRecogida,
} from "@/lib/routes-columns";
import { ciudadDeEntrega } from "@/lib/ciudad-de-entrega";
import { celdaPropiaDelPlan, claseDeLaFilaDelPlan, type ContextoDelPlan } from "./celdas-del-plan";

/**
 * D-435: la tabla del plan de D-434, con dos retoques que pidió el dueño el 2026-09-28 sobre esa misma tabla: «ok quiero que
 * en esa misma table las pickup toda la row este highlited pero bien suave de verde y las deliveries de amarillo para poder
 * identificarlas mejor y lo unico que hizo falta es ciudad de entregfa».
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const claves = (elegidas: readonly string[], orden: readonly string[] | null = null) => columnasDeLaTabla("plan", elegidas, orden).map((c) => c.key);

// ——— Los colores ———————————————————————————————————————————————————————————————————————————————————————————————————————

/** Los tokens de un bloque de `globals.css`: el primero cuyo selector es exactamente `selector` y que declara `--ink`. */
function tokens(css: string, selector: string): Record<string, string> {
  const partes = css.split(selector + " {").slice(1);
  // El bloque acaba en la llave que abre línea: los comentarios de dentro llevan `}` sueltas (`style={{}}`).
  const fin = String.fromCharCode(10) + "}";
  const bloque = partes.map((p) => p.slice(0, p.indexOf(fin))).find((b) => b.includes("--ink:"));
  if (!bloque) throw new Error(`sin bloque de tokens para ${selector}`);
  const r: Record<string, string> = {};
  for (const m of bloque.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) r[m[1]] = m[2].toLowerCase();
  return r;
}
/** Contraste WCAG entre dos colores #rrggbb. */
function contraste(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("la fila entera: recogida en verde muy suave, entrega en amarillo muy suave", () => {
  const css = leer("src/app/globals.css");
  const claro = tokens(css, ":root");
  const oscuro = { ...claro, ...tokens(css, ':root[data-theme="dark"]') };

  it("cada parada lleva la clase de su tipo: P verde, D amarilla", () => {
    expect(claseDeLaFilaDelPlan("P")).toBe("fila-plan-recoger");
    expect(claseDeLaFilaDelPlan("D")).toBe("fila-plan-entregar");
  });

  it("la tabla la usa en la FILA (`<tr>`), no en una celda: se tiñen también la etiqueta, el ID y Ajustar", () => {
    const vista = plano(leer("src/components/RutaDelPlan.tsx"));
    // D-443: sin la raya de viaje que llevaba la fila (`otroViaje`).
    expect(vista).toContain("<tr className={claseDeLaFilaDelPlan(p.kind)}>");
    expect(vista).not.toContain("otroViaje");
    // Todas las celdas: la regla va sobre cada `td` de la fila.
    expect(plano(css)).toContain("table.orders tr.fila-plan-recoger td { background: var(--plan-recoger-bg); }");
    expect(plano(css)).toContain("table.orders tr.fila-plan-entregar td { background: var(--plan-entregar-bg); }");
  });

  it("los dos tintes tienen su par en oscuro, distinto del claro", () => {
    for (const k of ["--plan-recoger-bg", "--plan-entregar-bg", "--blue"]) {
      expect(claro[k], k).toMatch(/^#/);
      expect(tokens(css, ':root[data-theme="dark"]')[k], k).toMatch(/^#/);
      expect(oscuro[k], k).not.toBe(claro[k]);
    }
  });

  it("muy suaves: casi el color de la tarjeta, pero verde y amarillo distintos entre sí; y no son el verde de «entregada»", () => {
    for (const t of [claro, oscuro]) {
      for (const k of ["--plan-recoger-bg", "--plan-entregar-bg"]) {
        expect(contraste(t[k], t["--card"]), k).toBeGreaterThan(1.02);   // se nota
        expect(contraste(t[k], t["--card"]), k).toBeLessThan(1.15);      // pero bien suave
      }
      expect(t["--plan-recoger-bg"]).not.toBe(t["--plan-entregar-bg"]);
      expect(t["--plan-recoger-bg"]).not.toBe(t["--green-soft"]);
      // El verde tira a verde y el amarillo a amarillo (el canal que manda).
      const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const [vr, vg, vb] = rgb(t["--plan-recoger-bg"]);
      expect(vg).toBeGreaterThan(vr);
      expect(vg).toBeGreaterThan(vb);
      const [ar, ag, ab] = rgb(t["--plan-entregar-bg"]);
      expect(Math.min(ar, ag)).toBeGreaterThan(ab);
    }
  });

  it("se lee: el texto, el enlace azul del ID y la letra pequeña pasan 4,5:1 sobre los dos tintes, en claro y en oscuro", () => {
    expect(plano(css)).toContain("table.orders tr.fila-plan-recoger .hint, table.orders tr.fila-plan-entregar .hint { color: var(--ink-soft); }");
    for (const [nombre, t] of [["claro", claro], ["oscuro", oscuro]] as const) {
      for (const fondo of ["--plan-recoger-bg", "--plan-entregar-bg"]) {
        for (const letra of ["--text", "--blue", "--ink-soft"]) expect(contraste(t[letra], t[fondo]), `${nombre} ${letra} sobre ${fondo}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // El enlace del ID lee ese token (el que ya tenía, con su valor de siempre en claro).
    expect(leer("src/components/RutaDelPlan.tsx")).toContain('color: "var(--blue, #2563eb)"');
    expect(claro["--blue"]).toBe("#2563eb");
  });

  it("el borde ámbar entre viajes se sigue viendo encima del amarillo (no es el mismo color)", () => {
    for (const t of [claro, oscuro]) expect(contraste("#e9a13b", t["--plan-entregar-bg"])).toBeGreaterThan(1.8);
  });
});

// ——— La ciudad de entrega ——————————————————————————————————————————————————————————————————————————————————————————————

const col = (k: string) => COLUMNAS_DEL_GESTOR.find((c) => c.key === k)!;

describe("«Ciudad de entrega» en la tabla del plan", () => {
  it("existe, se ve de partida y va justo tras la ciudad de recogida: # · ID · Tipo de cliente · Ciudad de recogida · Ciudad de entrega · Factura # · Dirección · Ventanas", () => {
    expect(col("pl_ciudad_entrega")).toMatchObject({ es: "Plan: Ciudad de entrega", en: "Plan: Delivery city", tablas: ["plan"] });
    expect(col("pl_ciudad_entrega").oculta).toBeUndefined();
    expect(col("pl_ciudad_entrega").deOrdenes).toBeUndefined();
    expect(claves(COLUMNAS_DEL_GESTOR_POR_DEFECTO)).toEqual(["pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega", "pl_invoice", "pl_address", "pl_windows"]);
    const partida = ORDEN_DE_PARTIDA_DEL_GESTOR.plan;
    expect(partida.indexOf("pl_ciudad_recogida")).toBeGreaterThanOrEqual(0);
    expect(partida.indexOf("pl_ciudad_entrega")).toBe(partida.indexOf("pl_ciudad_recogida") + 1);
  });

  it("en una recogida (P) va vacía, como la dirección: es de la entrega", () => {
    expect(seVeEnLaRecogida(col("pl_ciudad_entrega"))).toBe(false);
    expect(seVeEnLaRecogida(col("pl_ciudad_recogida"))).toBe(true);
    expect(seVeEnLaRecogida(col("pl_clase"))).toBe(true);
  });

  describe("la celda: la MISMA ciudad que «Ciudad de entrega» de «Sin asignar» (`ciudadDeEntrega`, D-408/D-423)", () => {
    const ctx = (conocidas: string[] = []): ContextoDelPlan => ({ reglas: {}, tiendas: [], conocidas, es: true });
    const d = (delivery_address: string | null) => ({ order_type: "Customer", account: "", customer_type: null, pickup_name: null, store: null, delivery_address });

    it("la ciudad de la dirección con comas", () => {
      expect(celdaPropiaDelPlan("pl_ciudad_entrega", d("5800 N 10th St, Ciudad Norte, TX 78504, USA"), ctx())).toBe("Ciudad Norte");
    });
    it("una dirección escrita sin comas: la cierran las ciudades conocidas que pasa la página (D-423)", () => {
      const dir = "123 Calle Larga Ciudad Sur TX 78577";
      expect(celdaPropiaDelPlan("pl_ciudad_entrega", d(dir), ctx(["Ciudad Sur"]))).toBe("Ciudad Sur");
      expect(celdaPropiaDelPlan("pl_ciudad_entrega", d(dir), ctx(["Ciudad Sur"]))).toBe(ciudadDeEntrega(dir, ["Ciudad Sur"]));
    });
    it("sin dirección, «—»", () => {
      expect(celdaPropiaDelPlan("pl_ciudad_entrega", d(null), ctx())).toBe("—");
      expect(celdaPropiaDelPlan("pl_ciudad_entrega", d("   "), ctx())).toBe("—");
    });
    it("la página la pinta con las mismas ciudades conocidas que «Sin asignar»", () => {
      const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
      expect(pagina).toContain('c.key === "address" ? <span title={d.delivery_address || undefined}>{ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen) || "—"}<AvisoSoloCiudad orden={d} corto /></span>');
      expect(pagina).toContain("celdaPropiaDelPlan(clave, d, { reglas: settings.order_type_rules, tiendas: settings.stores ?? [], conocidas: ciudadesQueSeConocen, es: lang === \"es\" })");
    });
  });
});

// ——— Lo ya guardado: la tanda `_v7` ————————————————————————————————————————————————————————————————————————————————————

describe("lo ya guardado (`_v7`): la ciudad de entrega se AÑADE, una vez, y entra en su sitio", () => {
  // Como la fila del dueño tras D-434: sus columnas de Sin asignar y paradas, las del plan de D-434, y las marcas hasta `_v6`.
  const DEL_PLAN_434 = ["pl_clase", "pl_ciudad_recogida", "pl_invoice", "pl_address", "pl_windows"];
  const suyas = ["invoice", "account", "pickup", "address", "p_type", "p_address", ...DEL_PLAN_434, "_v2", "_v3", "_v4", "_v5", MARCA_V6];
  const ordenSin = mueveEnElGestor("sinAsignar", null, "account", -1, suyas);
  /** Un orden del plan como lo guardaba el código de D-434, que no conocía la ciudad de entrega: se mueve con el de hoy y se le
   *  quita la clave nueva (lo demás queda en el mismo orden relativo). Sin esto la prueba mediría un orden que ya la trae. */
  const comoEnD434 = (o: string[] | null) => { const r = o && o.filter((k) => k !== "pl_ciudad_entrega"); expect(r).toContain("pl_ciudad_recogida"); return r; };

  it("con `_v6` y el plan en su orden de partida: le sale la ciudad de entrega tras la de recogida, sin tocar nada más; y se guarda", () => {
    const al = preferenciasDelGestorAlLeer(suyas, ordenSin);
    expect(claves(al.columnas!, al.orden)).toEqual(["pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega", "pl_invoice", "pl_address", "pl_windows"]);
    expect(al.columnas).toContain(MARCA_V7);
    expect(al.orden).toEqual(ordenSin);   // el de «Sin asignar», tal cual
    expect(columnasDeLaTabla("sinAsignar", al.columnas!, al.orden).map((c) => c.key)).toEqual(columnasDeLaTabla("sinAsignar", suyas, ordenSin).map((c) => c.key));
    // Paradas, como las tenía; D-445 (`_v8`) le suma la ciudad de recogida delante de la de entrega.
    expect(columnasDeLaTabla("paradas", suyas).map((c) => c.key)).toEqual(["p_type", "p_address"]);
    expect(columnasDeLaTabla("paradas", al.columnas!).map((c) => c.key)).toEqual(["p_type", "p_ciudad_recogida", "p_address"]);
    expect(al.escribe).toBe(true);
  });

  it("con `_v6` y el plan MOVIDO (ventanas arriba del todo): su orden se queda, y la nueva entra justo tras la ciudad de recogida", () => {
    let orden: string[] | null = ordenSin;
    for (let i = 0; i < 4; i++) orden = mueveEnElGestor("plan", orden, "pl_windows", -1, suyas);
    orden = comoEnD434(orden);
    expect(claves(suyas, orden)).toEqual(["pl_windows", "pl_clase", "pl_ciudad_recogida", "pl_invoice", "pl_address"]);   // de verdad lo movió
    const al = preferenciasDelGestorAlLeer(suyas, orden);
    expect(claves(al.columnas!, al.orden)).toEqual(["pl_windows", "pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega", "pl_invoice", "pl_address"]);
    // Nada más cambió de sitio: sin la nueva, el orden del plan es el que tenía (escondidas incluidas).
    expect(ordenDeLaTabla("plan", al.orden).filter((k) => k !== "pl_ciudad_entrega")).toEqual(ordenDeLaTabla("plan", orden).filter((k) => k !== "pl_ciudad_entrega"));
    expect(ordenDeLaTabla("sinAsignar", al.orden)).toEqual(ordenDeLaTabla("sinAsignar", orden));
    expect(al.escribe).toBe(true);
  });

  it("con la ciudad de recogida movida al final: la de entrega la sigue, al final", () => {
    let orden: string[] | null = null;
    for (let i = 0; i < 3; i++) orden = mueveEnElGestor("plan", orden, "pl_ciudad_recogida", 1, suyas);
    orden = comoEnD434(orden);
    expect(claves(suyas, orden)).toEqual(["pl_clase", "pl_invoice", "pl_address", "pl_windows", "pl_ciudad_recogida"]);
    const al = preferenciasDelGestorAlLeer(suyas, orden);
    expect(claves(al.columnas!, al.orden)).toEqual(["pl_clase", "pl_invoice", "pl_address", "pl_windows", "pl_ciudad_recogida", "pl_ciudad_entrega"]);
  });

  it("sin la inserción, la nueva caería al FINAL del orden guardado (por eso existe `conCiudadDeEntregaEnSuSitio`)", () => {
    let orden: string[] | null = null;
    for (let i = 0; i < 4; i++) orden = mueveEnElGestor("plan", orden, "pl_windows", -1, suyas);
    orden = comoEnD434(orden);
    const conLaNueva = conColumnasNuevas(suyas);
    expect(claves(conLaNueva, orden).slice(-1)).toEqual(["pl_ciudad_entrega"]);
    expect(claves(conLaNueva, conCiudadDeEntregaEnSuSitio(orden))).toEqual(["pl_windows", "pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega", "pl_invoice", "pl_address"]);
    expect(conCiudadDeEntregaEnSuSitio(null)).toBeNull();
    // Ya la tiene: no la duplica.
    const yaEsta = conCiudadDeEntregaEnSuSitio(orden)!;
    expect(conCiudadDeEntregaEnSuSitio(yaEsta)).toEqual(yaEsta);
  });

  it("una vez pasada, no se repite: si después la quita o la mueve, se respeta", () => {
    const al = preferenciasDelGestorAlLeer(suyas, ordenSin);
    expect(preferenciasDelGestorAlLeer(al.columnas!, al.orden)).toEqual({ columnas: al.columnas, orden: al.orden, escribe: false });
    const sinEntrega = alternaColumna(al.columnas!, "pl_ciudad_entrega");
    const recarga = preferenciasDelGestorAlLeer(sinEntrega, al.orden);
    expect(claves(recarga.columnas!, recarga.orden)).not.toContain("pl_ciudad_entrega");
    expect(recarga.escribe).toBe(false);
  });

  it("sin `_v6` (una lista de D-429): pasa por la tanda del plan, que ya trae la ciudad de entrega; y se guarda", () => {
    const de429 = ["invoice", "account", "pl_po", "pl_type", "pl_driver", "pl_address", "pl_windows", "_v2", "_v3", "_v4", "_v5"];
    const al = preferenciasDelGestorAlLeer(de429, null);
    expect(claves(al.columnas!, al.orden)).toEqual([...VISTAS_EN_EL_PLAN]);
    expect(al.columnas).toEqual(expect.arrayContaining([MARCA_V6, MARCA_V7]));
    expect(al.escribe).toBe(true);
  });

  it("las plantillas guardadas no se tocan: una de D-434 sigue sin la ciudad de entrega, y recargar no se la añade", () => {
    const puesta = columnasDePlantillaDelGestor(["invoice", ...DEL_PLAN_434]);
    expect(claves(puesta)).toEqual(DEL_PLAN_434);
    expect(claves(conColumnasNuevas(puesta))).toEqual(DEL_PLAN_434);
    expect(preferenciasDelGestorAlLeer(puesta, null).escribe).toBe(false);
  });
});
