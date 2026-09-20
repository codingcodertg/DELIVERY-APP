import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { facturaPendiente, documentoPendiente, gruposPorTienda, tiendasDeQuienMira } from "./documento-pendiente";
import type { OrderTypeRules } from "./required";
import type { UserRole } from "./types";
import {
  ANCHO_MAXIMO, ANCHO_MINIMO, CLAVE_DE_ANCHOS, CLAVE_DEL_ORDEN, COLUMNAS_QUE_VENTAS_NO_VE, TODOS_LOS_ROLES, anchosDeUnRol, anchosValidos,
  columnasDeVentas, guardaColumnas, hayQueSembrar, leeColumnas, prefsDeValor, valorDeColumnas, type ClienteDePrefs,
} from "./user-prefs";

/** D-NEXT: el ancho de las columnas es de la persona; «Factura pendiente» es solo de facturas y empieza por la tienda propia;
 *  ventas no ve la factura dos veces; y la cuenta de una Intertienda no se pinta. Tiendas y tipos inventados. */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

describe("b · el ancho de las columnas, por persona", () => {
  it("se sanea: números finitos, recortados a [mínimo, máximo] y enteros; lo demás se descarta", () => {
    expect([ANCHO_MINIMO, ANCHO_MAXIMO]).toEqual([40, 800]);
    expect(anchosDeUnRol({ store: 151.6, so: 3, account: 99999, date: NaN, fee: Infinity, type: "120", "": 90, windows: null }))
      .toEqual({ store: 152, so: ANCHO_MINIMO, account: ANCHO_MAXIMO });
    for (const basura of [null, undefined, "texto", 7, ["store"], []]) expect(anchosDeUnRol(basura)).toEqual({});
  });
  it("si se dice qué columnas existen, las desconocidas no se guardan", () => {
    expect(anchosDeUnRol({ store: 100, inventada: 100, __id: 200 }, ["__id", "store"])).toEqual({ store: 100, __id: 200 });
    expect(anchosDeUnRol({ store: 100, inventada: 100 })).toEqual({ store: 100, inventada: 100 });
  });
  it("vale para TODOS los roles —también ventas, que no elige columnas— y para ninguno inventado; un rol sin nada no se escribe", () => {
    expect(TODOS_LOS_ROLES).toContain("sales");
    const todos = Object.fromEntries(TODOS_LOS_ROLES.map((r) => [r, { store: 100 }]));
    expect(Object.keys(anchosValidos({ ...todos, jefe: { store: 100 }, [CLAVE_DEL_ORDEN]: { store: 100 } })).sort()).toEqual([...TODOS_LOS_ROLES].sort());
    expect(anchosValidos({ sales: { store: "x" }, admin: {} })).toEqual({});
  });

  describe("las TRES mitades viven en el mismo valor y ninguna pisa a las otras", () => {
    const visibles = { logistics: ["stage", "date"] }, orden = { logistics: ["date", "stage", "so"] }, anchos = { logistics: { date: 90 }, sales: { address: 300 } };
    it("ida y vuelta; y sin anchos no se escribe `_anchos`", () => {
      const valor = valorDeColumnas({ visibles, orden, anchos });
      expect(valor).toEqual({ logistics: ["stage", "date"], [CLAVE_DEL_ORDEN]: orden, [CLAVE_DE_ANCHOS]: anchos });
      expect(prefsDeValor(valor)).toEqual({ visibles, orden, anchos });
      expect(CLAVE_DE_ANCHOS in valorDeColumnas({ visibles, orden })).toBe(false);
      expect(CLAVE_DE_ANCHOS in valorDeColumnas({ visibles, orden, anchos: { sales: {} } })).toBe(false);
    });
    it("`_anchos` NO es un rol ni un orden: no se cuela en las otras dos mitades", () => {
      const p = prefsDeValor({ [CLAVE_DE_ANCHOS]: { logistics: { date: 90 } } });
      expect([p.visibles, p.orden]).toEqual([{}, {}]);
      expect(prefsDeValor({ [CLAVE_DE_ANCHOS]: ["date"] }).anchos).toEqual({});
    });

    /** Una base fingida con UNA fila, que se lee y se sobrescribe entera, como `user_prefs`. */
    function baseCon(valorInicial: Record<string, unknown>) {
      const fila = { value: valorInicial as Record<string, unknown> };
      const cliente = {
        from: () => ({
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: fila.value }, error: null }) }) }) }),
          upsert: (f: { value: Record<string, unknown> }) => ({ select: async () => { fila.value = f.value; return { data: [{ user_id: "yo" }], error: null }; } }),
        }),
      } as unknown as ClienteDePrefs;
      return { cliente, fila };
    }
    const LLENA = valorDeColumnas({ visibles, orden, anchos });
    // Las seis combinaciones: cambiar UNA mitad pasando las otras dos tal como se leyeron no toca esas dos.
    const cambios: [string, (l: Awaited<ReturnType<typeof leeColumnas>>) => [Parameters<typeof guardaColumnas>[2], Parameters<typeof guardaColumnas>[4], Parameters<typeof guardaColumnas>[5]], string[]][] = [
      ["guardar ANCHOS no borra visibles ni orden", (l) => [l.columnas, l.orden, { ...l.anchos, logistics: { date: 200 } }], ["visibles", "orden"]],
      ["guardar VISIBLES no borra orden ni anchos", (l) => [{ ...l.columnas, logistics: ["so"] }, l.orden, l.anchos], ["orden", "anchos"]],
      ["guardar ORDEN no borra visibles ni anchos", (l) => [l.columnas, { ...l.orden, logistics: ["so", "date"] }, l.anchos], ["visibles", "anchos"]],
    ];
    for (const [nombre, cambia, intactas] of cambios) {
      it(nombre, async () => {
        const { cliente, fila } = baseCon(LLENA);
        const [v, o, a] = cambia(await leeColumnas(cliente, "yo"));
        expect(await guardaColumnas(cliente, "yo", v, "order_columns", o, a)).toBe(true);
        const despues = prefsDeValor(fila.value), antes = prefsDeValor(LLENA);
        for (const k of intactas as ("visibles" | "orden" | "anchos")[]) expect(despues[k], k).toEqual(antes[k]);
        expect(despues).not.toEqual(antes);                                  // …y lo que se cambió, cambió
      });
    }
    it("y quien NO pasa una mitad la borra: por eso la página escribe por un solo sitio", async () => {
      const { cliente, fila } = baseCon(LLENA);
      await guardaColumnas(cliente, "yo", visibles as never, "order_columns", orden as never);
      expect(prefsDeValor(fila.value).anchos).toEqual({});
    });
  });

  it("el tope de la base (8192 bytes): las tres mitades LLENAS para un rol caben con margen; para todos los roles, también", () => {
    const columnas = ["__id", ...JSON.parse(JSON.stringify((/ORDER_COLUMNS: OrderColumn\[\] = \[([\s\S]*?)\n\];/.exec(leer("src/components/OrdersTable.tsx"))![1].match(/key: "([a-z_]+)"/g) ?? []).map((k) => k.slice(6, -1))))] as string[];
    expect(columnas.length).toBeGreaterThan(10);
    const lleno = (roles: readonly UserRole[]) => valorDeColumnas({
      visibles: Object.fromEntries(roles.map((r) => [r, columnas])), orden: Object.fromEntries(roles.map((r) => [r, columnas])),
      anchos: Object.fromEntries(roles.map((r) => [r, Object.fromEntries(columnas.map((c) => [c, ANCHO_MAXIMO]))])),
    });
    const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
    expect(Object.keys((lleno(["logistics"])[CLAVE_DE_ANCHOS] as Record<string, object>).logistics).length).toBe(columnas.length);
    expect(bytes(lleno(["logistics"]))).toBeLessThan(8192 / 8);
    expect(bytes(lleno(TODOS_LOS_ROLES))).toBeLessThan(8192 / 2);
  });

  it("la semilla: los anchos de este navegador cuentan para sembrar, con la MISMA regla anti-suplantación", () => {
    const estado = { baseLeida: true, hayFila: false, suplantando: false as boolean | null };
    expect(hayQueSembrar(estado, {}, { sales: { store: 100 } })).toBe(true);
    expect(hayQueSembrar(estado, {}, {})).toBe(false);
    expect(hayQueSembrar({ ...estado, suplantando: true }, {}, { sales: { store: 100 } })).toBe(false);
    expect(hayQueSembrar({ ...estado, suplantando: null }, {}, { sales: { store: 100 } })).toBe(false);
    expect(hayQueSembrar({ ...estado, hayFila: true }, {}, { sales: { store: 100 } })).toBe(false);
  });

  it("la tabla: guarda AL SOLTAR y no en cada píxel; doble clic restablece; mínimo de 40; el asa se ve y dice qué hace", () => {
    const hook = leer("src/lib/use-col-widths.ts");
    const mapa = hook.slice(hook.indexOf("export function useColWidthMap("));
    const mover = mapa.slice(mapa.indexOf("const onMove ="), mapa.indexOf("const onUp ="));
    expect(mover).toContain("Math.max(minimo, base + (ev.clientX - startX))");
    expect(mover).not.toMatch(/guarda\(|localStorage|alCambiar/);
    expect(mapa.slice(mapa.indexOf("const onUp ="), mapa.indexOf("document.body.style.cursor = \"col-resize\";"))).toContain("guarda(ultimos.current)");
    expect(plano(mapa)).toContain("const n = { ...ultimos.current }; delete n[key]; setWidths(n); guarda(n);");
    expect(mapa).toContain("alCambiar.current?.(w);");
    expect(mapa).toContain("useEffect(() => { if (deLaPersona) setWidths(JSON.parse(deLaPersona)); }, [deLaPersona]);");
    const tabla = leer("src/components/OrdersTable.tsx");
    expect(tabla).toContain("useColWidthMap(`rtg_colw_${resizeKey}`, 150, { deLaPersona: anchos, alCambiar: onAnchos, minimo: ANCHO_MINIMO });");
    expect(tabla).toContain('title={t("Drag to change the width; double-click to reset", "Arrastra para cambiar el ancho; doble clic para restablecer")}');
    const css = leer("src/app/globals.css");
    expect(css).toMatch(/\.col-resizer \{[^}]*cursor: col-resize;/);
    expect(css).toContain(".col-resizer:hover::after { background: var(--accent);");
    // Las tablas del Gestor siguen con su mínimo de siempre: no pasan opciones.
    expect(leer("src/app/(app)/routes/page.tsx")).toContain('useColWidthMap("rtg_routes_sched4", 100);');
  });

  it("la página: el ancho vale para ventas; se valida contra las columnas que existen; sin base leída no se escribe", () => {
    const p = plano(leer("src/app/(app)/page.tsx"));
    const g = p.slice(p.indexOf("const guardaAnchos = "), p.indexOf("const ordenDelSelector"));
    expect(g).toContain("if (!me || SIN_BASE || prefsDeLaBase.current === null) return;");
    expect(g).not.toContain('"sales"');
    expect(g).toContain('anchosDeUnRol(next, ["__id", ...ORDER_COLUMNS.map((c) => c.key)]);');
    expect(g).toContain("if (Object.keys(suyos).length) todos[me.role] = suyos; else delete todos[me.role];");
    expect(p).toContain("anchos={anchos} onAnchos={guardaAnchos}");
    expect(p).toContain("anchosValidos({ [rol]: JSON.parse(localStorage.getItem(`rtg_colw_orders_${rol}`) ?? \"null\") })");
    expect(p).toContain("resizeKey={`orders_${me.role}`}");                     // la clave del navegador de la que sale la semilla
  });
});

describe("a · ventas no ve la factura dos veces", () => {
  it("la lista de Ajustes —o el defecto— sin «invoice», en su orden; la lista guardada no se toca", () => {
    const guardada = ["type", "invoice", "store"];
    expect(columnasDeVentas(guardada, ["date"])).toEqual(["type", "store"]);
    expect(guardada).toEqual(["type", "invoice", "store"]);
    expect(columnasDeVentas(null, ["date", "invoice", "address"])).toEqual(["date", "address"]);
    expect(columnasDeVentas(undefined, [])).toEqual([]);
    expect(COLUMNAS_QUE_VENTAS_NO_VE).toEqual(["invoice"]);
  });
  it("la celda `#` sigue enseñando la factura y la captura de la que falta; y Ajustes no ofrece la columna", () => {
    const tabla = leer("src/components/OrdersTable.tsx");
    expect(tabla).toContain('<span className="inv-all">INV {invoice}</span>');
    expect(tabla).toContain('<DocumentoPendiente d={d} vacio={invoice ? null : "—"} />');
    expect(leer("src/app/(app)/settings/page.tsx")).toContain("{ORDER_COLUMNS.filter((c) => !COLUMNAS_QUE_VENTAS_NO_VE.includes(c.key)).map((c) => {");
  });
});

describe("g y h · la pestaña «Factura pendiente»", () => {
  const reglas = { ACliente: { storeToStore: false }, EntreTiendas: { storeToStore: true, docRef: "po" } } as unknown as OrderTypeRules;
  const base = { stage: "delivered" as const, po2: null, so_num: null, invoice_num: null, estimate_num: null };

  it("solo facturas: una orden a la que le falta otro documento sigue marcada en su fila, pero no entra en la pestaña", () => {
    const todas = [
      { ...base, order_type: "ACliente" }, { ...base, order_type: "ACliente", invoice_num: "F-1" },
      { ...base, order_type: "EntreTiendas" }, { ...base, order_type: "ACliente", stage: "draft" as const },
    ];
    const pendientes = todas.map((d) => documentoPendiente(d, reglas)?.campo ?? null);
    // La prueba no supone qué documento pide cada tipo: lo lee de la regla, y exige que haya al menos uno que NO sea la factura.
    expect(pendientes.filter((c) => c && c !== "invoice_num").length).toBeGreaterThan(0);
    expect(todas.map((d) => facturaPendiente(d, reglas))).toEqual(pendientes.map((c) => c === "invoice_num"));
    expect(todas.map((d) => facturaPendiente(d, reglas))).toEqual([true, false, false, false]);
  });
  it("la exención de ventana de D-313 usa la misma regla: lo que no está en la pestaña no pasa por ella", () => {
    expect(leer("src/lib/ordenes-visibles.ts")).toContain("if (pendientesEntran && facturaPendiente(d, reglas)) return true;");
  });

  // La tienda propia NO es la primera por nombre: si lo fuera, el orden de siempre ya la pondría delante.
  const filas = [
    { store: "Tienda Alfa", delivery_date: "2026-01-02" }, { store: "Tienda Beta", delivery_date: "2026-01-01" },
    { store: "Tienda Gama", delivery_date: "2026-01-03" }, { store: "tienda gama", delivery_date: "2026-01-01" }, { store: "Tienda Delta", delivery_date: "2026-01-01" }, { store: null, delivery_date: "2026-01-01" },
  ];
  const nombres = (g: { tienda: string }[]) => g.map((x) => x.tienda.toLowerCase());

  it("sin tienda propia, el orden de siempre", () => {
    expect(nombres(gruposPorTienda(filas))).toEqual(["tienda alfa", "tienda beta", "tienda delta", "tienda gama", ""]);
    expect(gruposPorTienda(filas, [])).toEqual(gruposPorTienda(filas));
  });
  it("la tienda de quien mira sale PRIMERO; luego las que además ve, en SU orden; luego el resto como siempre", () => {
    expect(nombres(gruposPorTienda(filas, ["Tienda Gama"]))).toEqual(["tienda gama", "tienda alfa", "tienda beta", "tienda delta", ""]);
    expect(nombres(gruposPorTienda(filas, [" tienda GAMA ", "Tienda Delta", "Tienda Beta"]))).toEqual(["tienda gama", "tienda delta", "tienda beta", "tienda alfa", ""]);
    expect(nombres(gruposPorTienda(filas, ["Una Que No Tiene Pendientes"]))).toEqual(nombres(gruposPorTienda(filas)));
  });
  it("dentro de cada grupo nada cambia: las mismas filas, por fecha", () => {
    const g = gruposPorTienda(filas, ["Tienda Gama"])[0];
    expect(g.filas.map((f) => f.delivery_date)).toEqual(["2026-01-01", "2026-01-03"]);
    expect(gruposPorTienda(filas, ["Tienda Gama"]).flatMap((x) => x.filas).length).toBe(filas.length);
  });
  it("las tiendas de quien mira: la suya y luego las visibles; sin ninguna, lista vacía", () => {
    expect(tiendasDeQuienMira({ store: " Tienda Gama ", visible_stores: ["Tienda Delta", "", "Tienda Beta"] })).toEqual(["Tienda Gama", "Tienda Delta", "Tienda Beta"]);
    expect(tiendasDeQuienMira({ store: null, visible_stores: ["Tienda Delta"] })).toEqual(["Tienda Delta"]);
    expect([tiendasDeQuienMira({ store: null, visible_stores: null }), tiendasDeQuienMira(null), tiendasDeQuienMira({})]).toEqual([[], [], []]);
  });
  it("la página se lo pasa a la tabla, y la tabla a la regla", () => {
    expect(plano(leer("src/app/(app)/page.tsx"))).toContain("porTienda={filter === PESTANA_DOCUMENTO_PENDIENTE} tiendasPrimero={tiendasDeQuienMira(me)}");
    expect(leer("src/components/OrdersTable.tsx")).toContain("agrupada ? gruposPorTienda(sortedRows, tiendasPrimero)");
  });
});
