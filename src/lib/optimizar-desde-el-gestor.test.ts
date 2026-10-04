import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import type { ParadaDeLaLista } from "./lista-unica";
import { optimizaLaLista, type ResultadoDeOptimizar } from "./optimiza-la-ruta";
import {
  avisoDeOptimizar, basesPorNombre, entradaDeOptimizar, formaDeLosPuntos, MAX_PUNTOS_DE_UNA_RUTA, puntosDeLaEntrada, puntosDeLaPeticion, tiemposDeLaRuta,
  tiendaBaseDelChofer, type TiemposPedidos,
} from "./optimizar-desde-el-gestor";
import { claveDePunto, claveSinTrafico, textoDeClave, type LatLng } from "./route-times/claves";
import { FACTOR_DE_RODEO, millasEnLineaRecta, type ProveedorDeTiempos } from "./route-times/proveedores";
import { cacheEnMemoria, matrizBase, matrizDeUnaVez, PRESUPUESTO_POR_DEFECTO, type FilaDeCache } from "./route-times/tiempos";
import type { NamedLocation } from "./types";

/**
 * Lo que el Gestor pone alrededor del optimizador (D-461). El dueño, 2026-10-02: «sigamos trabajando en el alrgoritmo de
 * optimizar ruta porque sigue muy mal ineficente».
 *
 * **Ninguna prueba llama a un servicio de verdad**: los proveedores son dobles que apuntan lo que se les pide, y `fetch`, en
 * la prueba de la ruta `/api/route-matrix`, también. Tiendas, choferes y coordenadas inventados.
 */

// Los dobles de `/api/route-matrix`: la sesión de quien llama y la llave de servicio (que solo toca la caché de tiempos).
const falso = vi.hoisted(() => ({
  sesion: true, rol: "logistics", adminCreado: 0, guardadas: [] as Record<string, unknown>[], escritas: [] as Record<string, unknown>[], gastoHoy: 0,
  peticiones: [] as { url: string; cuerpo: { origins?: unknown[]; destinations?: unknown[] } | null }[], googleFalla: false, osrmFalla: false,
}));
vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => (falso.sesion ? {
    ok: true, user: { id: "u1" },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: falso.rol }, error: null }) }) }) }) },
  } : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    falso.adminCreado++;
    return {
      from: (tabla: string) => {
        if (tabla !== "travel_time_cache") throw new Error("la llave de servicio solo toca la caché de tiempos");
        return {
          select: (_columnas: string, opciones?: { count?: string; head?: boolean }) => (opciones?.head
            ? { eq: () => ({ eq: () => ({ gte: async () => ({ count: falso.gastoHoy }) }) }) }
            : { in: () => ({ in: async () => ({ data: falso.guardadas, error: null }) }) }),
          upsert: async (filas: Record<string, unknown>[]) => { falso.escritas.push(...filas); return { error: null }; },
        };
      },
    };
  },
}));

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
const trozo = (desde: string, hasta: string, de = pagina) => {
  const i = de.indexOf(desde);
  expect(i, desde).toBeGreaterThan(-1);
  const j = de.indexOf(hasta, i + desde.length);
  expect(j, hasta).toBeGreaterThan(i);
  return de.slice(i, j);
};
const P = (id: string, tienda: string | null = "Tienda A"): ParadaDeLaLista => ({ tipo: "P", ordenes: [id], tienda });
const D = (id: string): ParadaDeLaLista => ({ tipo: "D", orden: id });

const TIENDAS: NamedLocation[] = [
  { name: "Tienda A", address: "1 Calle Uno", lat: 30.1, lng: -101.1 },
  { name: "Tienda B", address: "2 Calle Dos", lat: 30.5, lng: -101.5 },
  { name: "Tienda sin punto", address: "3 Calle Tres" },
];

// =====================================================================================================================
describe("1 · la base de la ruta es la tienda DEL CHOFER, no la recogida más repetida", () => {
  const usuarios = [
    { id: "u1", full_name: "Chofer Uno", store: null },
    { id: "u2", full_name: "Chofer Dos", store: "Tienda B" },
    { id: "u3", full_name: "Chofer Tres", store: null },
    { id: "u4", full_name: "Chofer Cuatro", store: "Tienda B" },
  ];
  const bases = basesPorNombre([
    { profile_id: "u1", base_store: "Tienda A" }, { profile_id: "u3", base_store: null }, { profile_id: "u4", base_store: " tienda a " },
    { profile_id: "no-existe", base_store: "Tienda B" },
  ], usuarios);

  it("`basesPorNombre`: de las filas de `driver_settings`, por el nombre del chofer; sin base o sin chofer, nada", () => {
    expect([...bases]).toEqual([["Chofer Uno", "Tienda A"], ["Chofer Cuatro", "tienda a"]]);
  });
  it("manda la de Ajustes → Rutas (`driver_settings.base_store`), la misma de la que lo saca «Armar rutas»", () => {
    expect(tiendaBaseDelChofer("Chofer Uno", bases, usuarios, TIENDAS)?.name).toBe("Tienda A");
    // Aunque su perfil diga otra: Ajustes → Rutas va primero. Y el nombre se compara sin mayúsculas ni espacios de más.
    expect(tiendaBaseDelChofer("Chofer Cuatro", bases, usuarios, TIENDAS)?.name).toBe("Tienda A");
  });
  it("si no la tiene, la tienda de su perfil (Usuarios)", () => {
    expect(tiendaBaseDelChofer("Chofer Dos", bases, usuarios, TIENDAS)?.name).toBe("Tienda B");
  });
  it("sin ninguna —o una ruta temporal, que no es de nadie—, `null`: la ruta se mide abierta", () => {
    expect(tiendaBaseDelChofer("Chofer Tres", bases, usuarios, TIENDAS)).toBeNull();
    expect(tiendaBaseDelChofer("Ruta temporal 1", bases, usuarios, TIENDAS)).toBeNull();
    expect(tiendaBaseDelChofer("", bases, usuarios, TIENDAS)).toBeNull();
    // Una base que ya no es una tienda de Ajustes no vale: cae a la del perfil, o a ninguna.
    expect(tiendaBaseDelChofer("Chofer Uno", new Map([["Chofer Uno", "Tienda Cerrada"]]), usuarios, TIENDAS)).toBeNull();
    expect(tiendaBaseDelChofer("Chofer Dos", new Map([["Chofer Dos", "Tienda Cerrada"]]), usuarios, TIENDAS)?.name).toBe("Tienda B");
  });

  describe("la pantalla", () => {
    it("lee las bases de `driver_settings` (`useBasesDeChofer`) y decide la tienda con `tiendaBaseDelChofer`", () => {
      expect(pagina).toContain("const basesDeChofer = useBasesDeChofer();");
      expect(pagina).toContain("const tiendaBaseDe = (laneKey: string) => tiendaBaseDelChofer(driverOf(laneKey), basesDeChofer, users, settings.stores ?? []);");
      const hook = plano(leer("src/lib/usa-bases.ts"));
      expect(hook).toContain('createClient().from("driver_settings").select("profile_id, base_store")');
      expect(hook).toContain("return useMemo(() => basesPorNombre(filas, users), [filas, users]);");
      // En el demo no hay base: no se pregunta, y queda la tienda del perfil.
      expect(hook).toContain("if (LOCAL_MODE) return;");
    });
    it("la base ya NO es la dirección de recogida más repetida de las órdenes de la ruta", () => {
      const direccion = trozo("const pickupAddressFor = (laneKey: string): string | null =>", "// Lo del día sin chofer.");
      expect(direccion).toContain("(tiendaBaseDe(laneKey)?.address ?? \"\").trim() || null;");
      expect(pagina).not.toContain("counts.set(a, (counts.get(a) ?? 0) + 1)");
      expect(pagina).not.toContain("d.pickup_address || \"\").trim(); if (a) counts");
    });
    it("`baseDeLaRuta`: las coordenadas de ESA tienda; sin tienda, sin base", () => {
      // **Puesto al día por D-NEXT**: `baseDeLaRuta` y la medida viven en `useMedidaDeRutas` (lib/usa-medida-de-rutas), que
      // comparten el Gestor y «Ruta de hoy»; la tienda base se la sigue diciendo la pantalla (`tiendaBaseDe`).
      const medida = plano(leer("src/lib/usa-medida-de-rutas.ts"));
      const base = trozo("const baseDeLaRuta = (laneKey: string): { lat: number; lng: number } | null => {", "// A driver's stops changed", medida);
      expect(pagina).toContain("tiendaBaseDe, coordsDeTienda,");
      expect(base).toContain("const tienda = tiendaBaseDe(laneKey); if (!tienda) return null;");
      expect(base).toContain("if (tienda.lat != null && tienda.lng != null) return { lat: tienda.lat, lng: tienda.lng };");
    });
    it("de esa base salen el Optimizar y la medida de la tarjeta (millas y llegadas): las dos, de la misma", () => {
      const optimizar = trozo("const optimizaLaRuta = async (laneKey: string) => {", "// Friendly display name for a lane key.");
      expect(optimizar).toContain("const base = baseDeLaRuta(laneKey);");
      const mide = trozo("const mideLaRuta = async", "const pintaLaMedida =", plano(leer("src/lib/usa-medida-de-rutas.ts")));
      expect(pagina).toContain("getDepotCoords, baseDeLaRuta, clearRouteFor, reintentaLaMedida, estadoDeLaMedida } = useMedidaDeRutas<Delivery>({");
      expect(mide).toContain("const base = baseDeLaRuta(laneKey);");
      expect(mide).toContain("const depot: [number, number] | null = base ? [base.lat, base.lng] : await getDepotCoords(pickupAddressFor(laneKey));");
    });
    it("la pastilla «⚠ sin base» sale cuando la ruta no tiene base DE VERDAD, no cuando falta la tienda del perfil", () => {
      expect(pagina).toContain('{!tiendaBaseDe(u.key) && stops.length > 0 && ( <span className="sema" data-sin-base tabIndex={0}');
      expect(pagina).not.toContain("{!u.store && stops.length > 0 && (");
    });
  });
});

// =====================================================================================================================
describe("2 · lo que se le pasa al optimizador: puntos, pallets, VENTANAS y minutos de carga y descarga", () => {
  const ordenes = [
    { id: "o1", delivery_lat: 30.2, delivery_lng: -101.2, delivery_windows: "0830-1000", delivery_duration: "30 min", pickup_duration: "12", est_pallets: 4, actual_pallets: null },
    { id: "o2", delivery_lat: null, delivery_lng: null, delivery_windows: "0830-1730", delivery_duration: null, pickup_duration: null, est_pallets: 2, actual_pallets: 3 },
    { id: "o3", delivery_lat: 30.3, delivery_lng: -101.3, delivery_windows: null, delivery_duration: "5", pickup_duration: "1", est_pallets: null, actual_pallets: null },
  ];
  const lista = [P("o1"), P("o2", "Tienda sin punto"), D("o1"), D("o2"), P("o3", null), D("o3")];
  const coordsDeTienda = (n: string | null) => { const t = TIENDAS.find((s) => s.name === n); return t?.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : null; };
  const e = entradaDeOptimizar({ lista, ordenes, base: { lat: 30.1, lng: -101.1 }, capacidad: 10, coordsDeTienda, esEstrecha: (w) => w === "0830-1000", salidaMin: 480 });

  it("el punto de cada parada: la tienda de la recogida (de Ajustes) y el pin de la entrega; lo que no tiene punto, `null`", () => {
    expect(e.puntos).toEqual([{ lat: 30.1, lng: -101.1 }, null, { lat: 30.2, lng: -101.2 }, null, null, { lat: 30.3, lng: -101.3 }]);
    expect(e.paradas).toBe(lista);
    expect(e.base).toEqual({ lat: 30.1, lng: -101.1 });
    expect(e.capacidad).toBe(10);
    expect(e.salidaMin).toBe(480);
  });
  it("los pallets, los contados antes que los estimados; sin conteo, `null`", () => {
    expect(e.cambios).toEqual([4, 3, -4, -3, null, null]);
  });
  it("la ventana de cada ENTREGA en minutos, y si es de las estrechas de Ajustes; las recogidas no tienen", () => {
    expect(e.ventanas).toEqual([null, null, { abre: 510, cierra: 600, estrecha: true }, { abre: 510, cierra: 1050, estrecha: false }, null, null]);
  });
  it("los minutos: cargar (`pickup_duration`) en la recogida, descargar (`delivery_duration`) en la entrega; ilegible, 15", () => {
    expect(e.servicios).toEqual([12, 15, 30, 15, 1, 5]);
  });
  it("los puntos DISTINTOS de la ruta (la base y cada parada con punto), y su forma, que no depende del orden", () => {
    expect(puntosDeLaEntrada(e)).toEqual([{ lat: 30.1, lng: -101.1 }, { lat: 30.2, lng: -101.2 }, { lat: 30.3, lng: -101.3 }]);
    const a = formaDeLosPuntos(puntosDeLaEntrada(e));
    expect(a).toBe("30.10000,-101.10000|30.20000,-101.20000|30.30000,-101.30000");
    expect(formaDeLosPuntos([...puntosDeLaEntrada(e)].reverse())).toBe(a);
    expect(formaDeLosPuntos([{ lat: 30.1, lng: -101.1 }, { lat: 30.2, lng: -101.2 }])).not.toBe(a);
  });
  it("la pantalla arma así la entrada: su lista, sus órdenes, su base, su capacidad, las ventanas duras de Ajustes y las 08:00", () => {
    const optimizar = trozo("const optimizaLaRuta = async (laneKey: string) => {", "// Friendly display name for a lane key.");
    expect(optimizar).toContain("const entrada = entradaDeOptimizar({ lista, ordenes: stops, base, capacidad: capacityFor(driverOf(laneKey)), coordsDeTienda, esEstrecha: (ventana) => esVentanaDura(ventana, settings), salidaMin: DAY_START_MIN, });");
    expect(optimizar).toContain("const r = optimizaLaLista({ ...entrada, tiempos: tiempos?.tiempos ?? null });");
  });
});

// =====================================================================================================================
describe("3 · los tiempos por calles: una petición por pulsación, y ninguna si esa forma de la ruta ya se pidió", () => {
  const A = { lat: 30.1, lng: -101.1 }, B = { lat: 30.2, lng: -101.2 }, C = { lat: 30.3, lng: -101.3 };
  const respuesta = (proveedor: string, llamadas = 1) => ({ ok: true, json: async () => ({ ok: true, tiempos: { [claveDePunto(A)]: { [claveDePunto(B)]: { minutos: 9, millas: 5 } } }, proveedor, llamadas }) });

  it("pide UNA vez, con los puntos distintos; la segunda pulsación sobre la misma ruta —en el orden que sea— no pide nada", async () => {
    const guardados = new Map<string, TiemposPedidos>();
    const pedidos: unknown[] = [];
    const pide = async (puntos: LatLng[]) => { pedidos.push(puntos); return respuesta("google"); };
    const primera = await tiemposDeLaRuta([A, B, A, C, B], guardados, pide);
    expect(pedidos).toEqual([[A, B, C]]);
    expect(primera).toMatchObject({ proveedor: "google", llamadas: 1 });
    const segunda = await tiemposDeLaRuta([C, B, A], guardados, pide);
    expect(pedidos).toHaveLength(1);
    expect(segunda).toMatchObject({ proveedor: "google", llamadas: 0, tiempos: primera!.tiempos });
    // Otra ruta (otro punto) sí pide.
    await tiemposDeLaRuta([A, B, { lat: 30.4, lng: -101.4 }], guardados, pide);
    expect(pedidos).toHaveLength(2);
  });
  it("si falla (sin sesión, sin red, el servidor caído) devuelve `null` y NO lo recuerda: la siguiente pulsación lo reintenta", async () => {
    const guardados = new Map<string, TiemposPedidos>();
    let n = 0;
    expect(await tiemposDeLaRuta([A, B], guardados, async () => { n++; return { ok: false, json: async () => ({ error: "Not signed in." }) }; })).toBeNull();
    expect(await tiemposDeLaRuta([A, B], guardados, async () => { n++; throw new Error("sin red"); })).toBeNull();
    expect(await tiemposDeLaRuta([A, B], guardados, async () => { n++; return { ok: true, json: async () => ({ tiempos: null }) }; })).toBeNull();
    expect(guardados.size).toBe(0);
    expect(await tiemposDeLaRuta([A, B], guardados, async () => { n++; return respuesta("cache", 0); })).toMatchObject({ proveedor: "cache" });
    expect(n).toBe(4);
  });
  it("lo ESTIMADO (línea recta) tampoco se recuerda: a la siguiente pulsación se vuelve a intentar por calles", async () => {
    const guardados = new Map<string, TiemposPedidos>();
    expect(await tiemposDeLaRuta([A, B], guardados, async () => respuesta("estimado", 2))).toMatchObject({ proveedor: "estimado" });
    expect(guardados.size).toBe(0);
    expect(await tiemposDeLaRuta([A, B], guardados, async () => respuesta("osrm"))).toMatchObject({ proveedor: "osrm" });
    expect(guardados.size).toBe(1);
  });
  it("con menos de dos puntos no hay nada que pedir", async () => {
    let n = 0;
    expect(await tiemposDeLaRuta([A, A], new Map(), async () => { n++; return respuesta("google"); })).toEqual({ tiempos: {}, proveedor: "cache", llamadas: 0 });
    expect(n).toBe(0);
  });
  it("la pantalla pide los tiempos con `tiemposDeLaRuta`, a `/api/route-matrix`, con su memoria por forma", () => {
    const optimizar = trozo("const optimizaLaRuta = async (laneKey: string) => {", "// Friendly display name for a lane key.");
    expect(pagina).toContain("const tiemposPedidos = useRef(new Map<string, TiemposPedidos>());");
    expect(optimizar).toContain("const tiempos = await tiemposDeLaRuta(puntosDeLaEntrada(entrada), tiemposPedidos.current, (puntos) => fetch(\"/api/route-matrix\", { method: \"POST\", headers: { \"Content-Type\": \"application/json\" }, body: JSON.stringify({ puntos }) }));");
    // Una sola petición en todo el manejador; la medida de después (la de cualquier cambio) no se llama desde aquí.
    expect(optimizar.split("fetch(").length - 1).toBe(1);
    expect(optimizar).not.toContain("mideLaRuta(");
  });

  describe("el servidor: `matrizDeUnaVez`", () => {
    const AHORA = "2026-03-02T12:00:00.000Z";
    const PUNTOS: Record<string, LatLng> = Object.fromEntries([A, B, C].map((p) => [claveDePunto(p), p]));
    /** Un proveedor de mentira que apunta cada petición de matriz y con qué. */
    function doble(nombre: ProveedorDeTiempos["nombre"], o: { falla?: boolean; minutos?: number } = {}) {
      const pedidos: { origenes: number; destinos: number }[] = [];
      const p: ProveedorDeTiempos = {
        nombre, conTrafico: false,
        async matriz(os, ds) { pedidos.push({ origenes: os.length, destinos: ds.length }); if (o.falla) throw new Error("caído"); return os.map(() => ds.map(() => ({ minutos: o.minutos ?? 10, millas: 6 }))); },
        async tramo() { throw new Error("aquí no se piden tramos"); },
      };
      return { p, pedidos };
    }
    const fila = (a: LatLng, b: LatLng, minutos = 7): FilaDeCache => ({ ...claveSinTrafico(claveDePunto(a), claveDePunto(b)), minutos, millas: 4, proveedor: "google", pedidoEl: AHORA });

    it("con la caché vacía: UNA petición al proveedor, con todo; y lo que contesta se guarda", async () => {
      const cache = cacheEnMemoria(), g = doble("google");
      const { matriz, informe } = await matrizDeUnaVez(PUNTOS, { cache, proveedores: [g.p, doble("estimado").p], ahoraISO: AHORA });
      expect(g.pedidos).toEqual([{ origenes: 3, destinos: 3 }]);
      expect(informe).toEqual({ deCache: 0, pedidos: 6, proveedor: "google", presupuestoAgotado: false, llamadas: 1 });
      expect(matriz[claveDePunto(A)][claveDePunto(B)]).toEqual({ minutos: 10, millas: 6 });
      expect(Object.values(matriz).every((f) => Object.keys(f).length === 2)).toBe(true);
      expect(cache.filas.size).toBe(6);
      // `matrizBase` (la de «Armar rutas») pediría lo mismo origen a origen: tres peticiones.
      const g2 = doble("google");
      await matrizBase(PUNTOS, { cache: cacheEnMemoria(), proveedores: [g2.p], ahoraISO: AHORA });
      expect(g2.pedidos).toHaveLength(3);
    });
    it("con todo en la caché: NINGUNA petición", async () => {
      const pares = [[A, B], [A, C], [B, A], [B, C], [C, A], [C, B]] as const;
      const g = doble("google");
      const { matriz, informe } = await matrizDeUnaVez(PUNTOS, { cache: cacheEnMemoria(pares.map(([a, b]) => fila(a, b))), proveedores: [g.p], ahoraISO: AHORA });
      expect(g.pedidos).toEqual([]);
      expect(informe).toEqual({ deCache: 6, pedidos: 0, proveedor: "cache", presupuestoAgotado: false, llamadas: 0 });
      expect(matriz[claveDePunto(C)][claveDePunto(A)]).toEqual({ minutos: 7, millas: 4 });
    });
    it("con parte en la caché: UNA petición, solo con los orígenes y destinos a los que les falta algo; lo guardado no se pisa en la respuesta", async () => {
      // Falta solo B → C: un origen, un destino.
      const cache = cacheEnMemoria([fila(A, B), fila(A, C), fila(B, A), fila(C, A), fila(C, B)]);
      const g = doble("google");
      const { matriz, informe } = await matrizDeUnaVez(PUNTOS, { cache, proveedores: [g.p], ahoraISO: AHORA });
      expect(g.pedidos).toEqual([{ origenes: 1, destinos: 1 }]);
      expect(informe).toMatchObject({ deCache: 5, pedidos: 1, llamadas: 1, proveedor: "google" });
      expect(matriz[claveDePunto(B)][claveDePunto(C)]).toEqual({ minutos: 10, millas: 6 });
      expect(matriz[claveDePunto(A)][claveDePunto(B)]).toEqual({ minutos: 7, millas: 4 });
      expect(cache.filas.get(textoDeClave(claveSinTrafico(claveDePunto(B), claveDePunto(C))))).toMatchObject({ minutos: 10, proveedor: "google" });
    });
    it("si el de pago falla, contesta el siguiente (y NO se guarda: no era el preferido); si fallan todos los de fuera, el estimado", async () => {
      const cache = cacheEnMemoria(), g = doble("google", { falla: true }), o = doble("osrm", { minutos: 12 }), est = doble("estimado", { minutos: 30 });
      const r = await matrizDeUnaVez(PUNTOS, { cache, proveedores: [g.p, o.p, est.p], ahoraISO: AHORA });
      expect([g.pedidos.length, o.pedidos.length, est.pedidos.length]).toEqual([1, 1, 0]);
      expect(r.informe).toMatchObject({ proveedor: "osrm", llamadas: 2, pedidos: 6 });
      expect(r.matriz[claveDePunto(A)][claveDePunto(B)].minutos).toBe(12);
      expect(cache.filas.size).toBe(0);
      const o2 = doble("osrm", { falla: true });
      const r2 = await matrizDeUnaVez(PUNTOS, { cache, proveedores: [doble("google", { falla: true }).p, o2.p, est.p], ahoraISO: AHORA });
      // El estimado no llama a nadie: no cuenta como llamada.
      expect(r2.informe).toMatchObject({ proveedor: "estimado", llamadas: 2 });
      expect(r2.matriz[claveDePunto(A)][claveDePunto(B)].minutos).toBe(30);
    });
    it("el freno es el de «Armar rutas»: por encima del tope del día no se llama al de pago, y lo dice", async () => {
      const cache = { ...cacheEnMemoria(), gastoDesde: async () => ({ elementos: PRESUPUESTO_POR_DEFECTO.elementosPorDia - 5, tramos: 0 }) };
      const g = doble("google"), o = doble("osrm");
      const r = await matrizDeUnaVez(PUNTOS, { cache, proveedores: [g.p, o.p], ahoraISO: AHORA });
      expect(g.pedidos).toEqual([]);
      expect(o.pedidos).toHaveLength(1);
      expect(r.informe).toMatchObject({ presupuestoAgotado: true, proveedor: "osrm", llamadas: 1 });
      // Y lo que cuenta contra el tope es lo que se PAGA: el rectángulo entero (3 × 3 = 9), no los 6 tramos que faltan.
      const justo = { ...cacheEnMemoria(), gastoDesde: async () => ({ elementos: PRESUPUESTO_POR_DEFECTO.elementosPorDia - 8, tramos: 0 }) };
      const g2 = doble("google");
      expect((await matrizDeUnaVez(PUNTOS, { cache: justo, proveedores: [g2.p, doble("osrm").p], ahoraISO: AHORA })).informe.presupuestoAgotado).toBe(true);
      expect(g2.pedidos).toEqual([]);
    });
  });
});

// =====================================================================================================================
describe("4 · `/api/route-matrix`: quién puede, qué valida y cuánto llama", () => {
  const A = { lat: 30.1, lng: -101.1 }, B = { lat: 30.2, lng: -101.2 }, C = { lat: 30.3, lng: -101.3 };

  it("`puntosDeLaPeticion`: una lista de puntos de verdad, sin repetidos; lo demás, `null`", () => {
    expect(puntosDeLaPeticion({ puntos: [A, B, A] })).toEqual({ [claveDePunto(A)]: A, [claveDePunto(B)]: B });
    expect(puntosDeLaPeticion({ puntos: [] })).toEqual({});
    for (const malo of [null, {}, { puntos: "A" }, { puntos: [{ lat: "30", lng: -101 }] }, { puntos: [{ lat: 30 }] }, { puntos: [{ lat: 91, lng: 0 }] }, { puntos: [{ lat: 0, lng: 181 }] }, { puntos: [{ lat: NaN, lng: 0 }] }, { puntos: [null] }]) {
      expect(puntosDeLaPeticion(malo), JSON.stringify(malo)).toBeNull();
    }
    const muchos = Array.from({ length: MAX_PUNTOS_DE_UNA_RUTA + 1 }, (_, k) => ({ lat: 30 + k / 1000, lng: -101 }));
    expect(puntosDeLaPeticion({ puntos: muchos })).toBeNull();
    expect(Object.keys(puntosDeLaPeticion({ puntos: muchos.slice(1) })!)).toHaveLength(MAX_PUNTOS_DE_UNA_RUTA);
  });

  describe("la ruta", () => {
    const pide = async (cuerpo: unknown) => {
      const { POST } = await import("@/app/api/route-matrix/route");
      return POST(new Request("http://localhost/api/route-matrix", { method: "POST", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }));
    };
    /** `fetch`, de mentira: apunta cada petición y contesta como Google (matriz) o como OSRM (tabla). NADA sale de la máquina. */
    const fetchFalso = async (url: string, init?: { body?: string }) => {
      const cuerpo = init?.body ? JSON.parse(init.body) as { origins: unknown[]; destinations: unknown[] } : null;
      falso.peticiones.push({ url, cuerpo });
      if (url.includes("routes.googleapis.com")) {
        if (falso.googleFalla) return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
        const elementos = cuerpo!.origins.flatMap((_, i) => cuerpo!.destinations.map((__, j) => ({ originIndex: i, destinationIndex: j, duration: "600s", distanceMeters: 16093.44, condition: "ROUTE_EXISTS" })));
        return { ok: true, status: 200, json: async () => elementos, text: async () => "" };
      }
      if (falso.osrmFalla) return { ok: false, status: 502, json: async () => ({}), text: async () => "" };
      const n = url.split("/driving/")[1].split("?")[0].split(";").length / 2;
      return { ok: true, status: 200, json: async () => ({ durations: Array.from({ length: n }, () => Array(n).fill(900)), distances: Array.from({ length: n }, () => Array(n).fill(8046.72)) }), text: async () => "" };
    };
    beforeEach(() => {
      Object.assign(falso, { sesion: true, rol: "logistics", adminCreado: 0, guardadas: [], escritas: [], gastoHoy: 0, peticiones: [], googleFalla: false, osrmFalla: false });
      vi.stubGlobal("fetch", fetchFalso);
      vi.stubEnv("GOOGLE_MAPS_API_KEY", "llave-de-mentira");
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    it("sin sesión 401, sin una lista de puntos 400, sin ser admin o logística 403 — y en ninguno se crea la llave de servicio ni se llama a nadie", async () => {
      falso.sesion = false;
      expect((await pide({ puntos: [A, B] })).status).toBe(401);
      falso.sesion = true;
      expect((await pide({})).status).toBe(400);
      expect((await pide("{no es json")).status).toBe(400);
      expect((await pide({ puntos: [{ lat: "x", lng: 1 }] })).status).toBe(400);
      for (const rol of ["manager", "driver", "warehouse", "sales"]) { falso.rol = rol; expect((await pide({ puntos: [A, B] })).status, rol).toBe(403); }
      expect(falso.adminCreado).toBe(0);
      expect(falso.peticiones).toEqual([]);
    });
    it("una pulsación con la caché vacía: UNA petición a Google (la matriz, sin tráfico), y lo contestado se guarda en la caché compartida", async () => {
      const res = await pide({ puntos: [A, B, C, A] });
      expect(res.status).toBe(200);
      const cuerpo = await res.json() as { tiempos: Record<string, Record<string, { minutos: number; millas: number }>>; proveedor: string; llamadas: number; pedidos: number; deCache: number };
      expect(falso.peticiones).toHaveLength(1);
      expect(falso.peticiones[0].url).toBe("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix");
      expect(falso.peticiones[0].cuerpo).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" });
      expect([falso.peticiones[0].cuerpo!.origins!.length, falso.peticiones[0].cuerpo!.destinations!.length]).toEqual([3, 3]);
      expect(cuerpo).toMatchObject({ proveedor: "google", llamadas: 1, pedidos: 6, deCache: 0 });
      expect(cuerpo.tiempos[claveDePunto(A)][claveDePunto(C)]).toEqual({ minutos: 10, millas: 10 });
      expect(falso.escritas).toHaveLength(6);
      expect(falso.escritas[0]).toMatchObject({ traffic: false, provider: "google", weekday: -1, block: -1 });
    });
    it("con los tramos ya guardados (un día que pasó por «Armar rutas»): NINGUNA petición a nadie", async () => {
      const k = [A, B, C].map(claveDePunto);
      falso.guardadas = k.flatMap((a) => k.filter((b) => b !== a).map((b) => ({ origin_key: a, dest_key: b, weekday: -1, block: -1, traffic: false, minutes: 14, miles: 9, provider: "google", fetched_at: new Date().toISOString() })));
      const cuerpo = await (await pide({ puntos: [A, B, C] })).json() as { proveedor: string; llamadas: number; deCache: number; tiempos: Record<string, Record<string, { minutos: number }>> };
      expect(falso.peticiones).toEqual([]);
      expect(cuerpo).toMatchObject({ proveedor: "cache", llamadas: 0, deCache: 6 });
      expect(cuerpo.tiempos[claveDePunto(B)][claveDePunto(A)].minutos).toBe(14);
      expect(falso.escritas).toEqual([]);
    });
    it("si Google falla contesta OSRM; si fallan los dos, el estimado en línea recta — y `proveedor` lo dice, para que la pantalla lo diga", async () => {
      falso.googleFalla = true;
      const conOsrm = await (await pide({ puntos: [A, B] })).json() as { proveedor: string; llamadas: number; tiempos: Record<string, Record<string, { minutos: number; millas: number }>> };
      expect(falso.peticiones.map((p) => p.url.split("/")[2])).toEqual(["routes.googleapis.com", "router.project-osrm.org"]);
      expect(conOsrm).toMatchObject({ proveedor: "osrm", llamadas: 2 });
      expect(conOsrm.tiempos[claveDePunto(A)][claveDePunto(B)]).toEqual({ minutos: 15, millas: 5 });
      falso.osrmFalla = true;
      const estimado = await (await pide({ puntos: [A, B] })).json() as { proveedor: string; tiempos: Record<string, Record<string, { minutos: number; millas: number }>> };
      expect(estimado.proveedor).toBe("estimado");
      expect(estimado.tiempos[claveDePunto(A)][claveDePunto(B)].millas).toBe(Math.round(millasEnLineaRecta(A, B) * FACTOR_DE_RODEO * 100) / 100);
      // Nada de lo que no contestó el preferido se guarda.
      expect(falso.escritas).toEqual([]);
    });
    it("por encima del tope del día no se llama a Google", async () => {
      falso.gastoHoy = PRESUPUESTO_POR_DEFECTO.elementosPorDia;
      const cuerpo = await (await pide({ puntos: [A, B, C] })).json() as { proveedor: string; presupuestoAgotado: boolean };
      expect(falso.peticiones.map((p) => p.url.split("/")[2])).toEqual(["router.project-osrm.org"]);
      expect(cuerpo).toMatchObject({ proveedor: "osrm", presupuestoAgotado: true });
    });
    it("con un solo punto no hay tramos: ni caché ni proveedor", async () => {
      const cuerpo = await (await pide({ puntos: [A, A] })).json() as { tiempos: unknown; llamadas: number };
      expect(cuerpo).toMatchObject({ tiempos: { [claveDePunto(A)]: {} }, llamadas: 0 });
      expect(falso.peticiones).toEqual([]);
    });
    it("la ruta comprueba sesión y rol ANTES de crear la llave de servicio, y usa `matrizDeUnaVez` con el freno de siempre", () => {
      const ruta = plano(leer("src/app/api/route-matrix/route.ts"));
      const orden = ["await requireUser()", "puntosDeLaPeticion(cuerpo)", '["admin", "logistics"].includes(String(yo.role))', "createAdminClient()", "await matrizDeUnaVez(puntos, { cache, proveedores, ahoraISO: new Date().toISOString() })"].map((x) => ruta.indexOf(x));
      expect(orden.every((p) => p > -1)).toBe(true);
      expect(orden).toEqual([...orden].sort((a, b) => a - b));
      // Google si hay llave, y siempre los dos respaldos detrás: lo mismo que `/api/route-plan`.
      expect(ruta).toContain("...(llave ? [proveedorGoogle(llave, fetch as unknown as FetchFn)] : []), proveedorOSRM(fetch as unknown as FetchFn), proveedorEstimado()");
    });
  });
});

// =====================================================================================================================
describe("5 · el aviso al terminar dice lo ganado, y lo que queda mal", () => {
  const medida = (millas: number, minutos: number, tarde: ResultadoDeOptimizar["antes"]["tarde"] = [], exceso = 0) => ({ millas, minutos, manejoMin: 0, exceso, tarde, cargaPalletMi: 0 });
  const aviso = (r: Partial<ResultadoDeOptimizar> & Pick<ResultadoDeOptimizar, "antes" | "despues">, extra: Partial<Parameters<typeof avisoDeOptimizar>[0]> = {}) => avisoDeOptimizar({
    ruta: "Chofer Uno", r: { cambio: true, sinPunto: 0, exacta: true, medida: "real", ...r }, tiempos: { proveedor: "google" }, hayBase: true,
    nombreDe: (id) => `F-${id}`, pallets: (n) => String(n), ...extra,
  });

  it("«−12.4 mi · −18 min»: lo ganado, con su signo, y si es el mejor orden que existe o el mejor que se encontró", () => {
    const a = aviso({ antes: medida(169.1, 446), despues: medida(156.7, 428) });
    expect(a.es).toBe("🧭 Chofer Uno optimizada: −12.4 mi · −18 min (el mejor orden posible). Ctrl+Z lo deshace.");
    expect(a.en).toBe("🧭 Chofer Uno optimized: −12.4 mi · −18 min (the best possible order). Ctrl+Z undoes it.");
    expect(aviso({ antes: medida(169.1, 446), despues: medida(156.7, 428), exacta: false }).es).toContain("−12.4 mi · −18 min (el mejor orden que se encontró).");
  });
  it("si para llegar a tiempo la jornada se alarga, lo dice con su «+», y dice lo que se ganó a cambio", () => {
    const a = aviso({ antes: medida(161.4, 424, [{ orden: "7", minutos: 91, estrecha: true }]), despues: medida(156.7, 428, [{ orden: "3", minutos: 41, estrecha: true }]) });
    expect(a.es).toBe("🧭 Chofer Uno optimizada: −4.7 mi · +4 min (el mejor orden posible). ⚠ Aún llega tarde a 1 entrega(s): F-3 41 min — ningún orden lo evita (antes: 1, 91 min). Ctrl+Z lo deshace.");
    expect(a.en).toContain("−4.7 mi · +4 min (the best possible order). ⚠ Still late for 1 delivery(ies): F-3 41 min — no order avoids it (before: 1, 91 min).");
  });
  it("si queda alguna entrega tarde, dice CUÁL y por cuánto; y si no es exacta, no promete que no se pueda evitar", () => {
    const tarde = [{ orden: "3", minutos: 41, estrecha: true }, { orden: "9", minutos: 5, estrecha: false }];
    expect(aviso({ antes: medida(100, 300, tarde), despues: medida(90, 280, tarde) }).es).toContain("⚠ Aún llega tarde a 2 entrega(s): F-3 41 min, F-9 5 min — ningún orden lo evita (antes: 2, 46 min).");
    expect(aviso({ antes: medida(100, 300, tarde), despues: medida(90, 280, tarde), exacta: false }).es).toContain("— no se encontró un orden que lo evite (antes: 2, 46 min).");
  });
  it("si deja de llegar tarde, lo dice como lo ganado que es", () => {
    const a = aviso({ antes: medida(166.8, 498, [{ orden: "1", minutos: 300, estrecha: true }, { orden: "2", minutos: 42, estrecha: true }]), despues: medida(122.2, 428) });
    expect(a.es).toBe("🧭 Chofer Uno optimizada: −44.6 mi · −70 min (el mejor orden posible). Ya ninguna entrega llega tarde (antes 2, 342 min). Ctrl+Z lo deshace.");
  });
  it("la capacidad: si sigue pasándose, cuánto; si deja de pasarse, también", () => {
    expect(aviso({ antes: medida(100, 300, [], 3), despues: medida(120, 340, [], 1.5) }).es).toContain("+20.0 mi · +40 min (el mejor orden posible). ⚠ sigue pasándose de la capacidad en 1.5 (antes 3).");
    expect(aviso({ antes: medida(100, 300, [], 3), despues: medida(120, 340) }).es).toContain("El camión ya no se pasa de su capacidad (se pasaba en 3).");
  });
  it("si no hay nada mejor: «ya está en el mejor orden», con lo que mide, y que no se cambió nada", () => {
    const igual = medida(156.7, 428);
    expect(aviso({ antes: igual, despues: igual, cambio: false }).es).toBe("🧭 Chofer Uno: ya está en el mejor orden posible (156.7 mi · 428 min). No se cambió nada.");
    expect(aviso({ antes: igual, despues: igual, cambio: false, exacta: false }).es).toContain("ya está en el mejor orden que se encontró (156.7 mi · 428 min). No se cambió nada.");
    expect(aviso({ antes: igual, despues: igual, cambio: false }).en).toBe("🧭 Chofer Uno: already in the best possible order (156.7 mi · 428 min). Nothing changed.");
    // Y si aun así llega tarde a algo, lo dice igual (sin el «antes»: no cambió nada).
    const tarde = medida(156.7, 428, [{ orden: "3", minutos: 41, estrecha: true }]);
    expect(aviso({ antes: tarde, despues: tarde, cambio: false }).es).toBe("🧭 Chofer Uno: ya está en el mejor orden posible (156.7 mi · 428 min). No se cambió nada. ⚠ Aún llega tarde a 1 entrega(s): F-3 41 min — ningún orden lo evita.");
  });
  it("si NO hubo tiempos por calles —no contestó, contestó el estimado, o faltó algún tramo—, dice que es línea recta", () => {
    const r = { antes: medida(100, 300), despues: medida(90, 280) };
    const dice = " ⚠ Medido en línea recta (estimado): no se pudieron pedir los tiempos por calles.";
    expect(aviso(r, { tiempos: null }).es).toContain(dice);
    expect(aviso(r, { tiempos: { proveedor: "estimado" } }).es).toContain(dice);
    expect(aviso({ ...r, medida: "mixta" }).es).toContain(dice);
    expect(aviso({ ...r, medida: "estimada" }).es).toContain(dice);
    for (const proveedor of ["google", "osrm", "cache"] as const) expect(aviso(r, { tiempos: { proveedor } }).es).not.toContain("línea recta");
    expect(aviso(r, { tiempos: null }).en).toContain("⚠ Measured in a straight line (estimate): street times couldn't be fetched.");
  });
  it("lo demás que ya decía: paradas sin punto, sin base, y sin la 154", () => {
    const r = { antes: medida(100, 300), despues: medida(90, 280) };
    expect(aviso({ ...r, sinPunto: 2 }).es).toContain(" 2 parada(s) sin punto en el mapa no cuentan.");
    expect(aviso(r, { hayBase: false }).es).toContain(" Sin base: medida como ruta abierta.");
    expect(aviso(r, { sinRecogidas: true }).es).toContain(" Solo se guardó el orden de las entregas: las recogidas necesitan la actualización de la base (154).");
    expect(aviso(r).es).not.toContain("154");
  });
  it("de punta a punta: una ruta que el optimizador mejora, y el aviso que sale de su resultado", () => {
    // Tres entregas en una recta guardadas en zigzag (lejos, cerca, medio): ordenadas, 20 millas y 20 minutos menos.
    const en = (x: number) => ({ lat: 30 + x / 1000, lng: -101 });
    const xs = [0, 10, 20, 30];
    const tiempos: Record<string, Record<string, { minutos: number; millas: number }>> = {};
    for (const a of xs) for (const b of xs) if (a !== b) (tiempos[claveDePunto(en(a))] ??= {})[claveDePunto(en(b))] = { minutos: Math.abs(a - b), millas: Math.abs(a - b) };
    const r = optimizaLaLista({ paradas: [P("1"), P("2"), P("3"), D("1"), D("2"), D("3")], puntos: [en(0), en(0), en(0), en(30), en(10), en(20)], cambios: [1, 1, 1, -1, -1, -1], base: en(0), capacidad: 10, tiempos });
    expect(aviso(r).es).toBe("🧭 Chofer Uno optimizada: −20.0 mi · −20 min (el mejor orden posible). Ctrl+Z lo deshace.");
  });
  it("la pantalla dice ESE aviso, con la factura como nombre de cada orden; y solo guarda si cambió", () => {
    const optimizar = trozo("const optimizaLaRuta = async (laneKey: string) => {", "// Friendly display name for a lane key.");
    expect(optimizar).toContain("const aviso = avisoDeOptimizar({ ruta: laneLabel(laneKey), r, tiempos, hayBase: !!base, pallets: numeroDePallets, sinRecogidas: !hayRecogidaGuardada, nombreDe: (id) => { const d = porId.get(id); return d ? facturaYId(d).principal : id.slice(0, 6); }, });");
    expect(optimizar).toContain("if (r.cambio && !(await guardaLaLista(laneKey, stops, r.paradas, {");
    expect(optimizar).toContain("notify(t(aviso.en, aviso.es));");
    expect(optimizar.indexOf("guardaLaLista(")).toBeLessThan(optimizar.indexOf("notify(t(aviso.en, aviso.es));"));
    // Con candado 🔒 ni se calcula ni se pide nada.
    expect(optimizar.indexOf("if (bloqueada(laneKey)) {")).toBeLessThan(optimizar.indexOf("entradaDeOptimizar("));
    expect(optimizar.indexOf("return; }", optimizar.indexOf("if (bloqueada(laneKey)) {"))).toBeLessThan(optimizar.indexOf("tiemposDeLaRuta("));
  });
});

// =====================================================================================================================
describe("6 · la medida de la tarjeta cuenta las horas como el optimizador", () => {
  it("las recogidas seguidas en la misma tienda son UNA visita también en la medida: ya no suma la recarga entera por fila", () => {
    // **Puesto al día por D-NEXT**: la medida de una lista es `mideLaLista` (lib/usa-medida-de-rutas).
    const mide = trozo("export async function mideLaLista", "/** La forma de la ruta que se mide", plano(leer("src/lib/usa-medida-de-rutas.ts")));
    expect(mide).toContain("const parado = minutosEnCadaParada(lista, lista.map((p) => (p.tipo === \"D\" ? serviceMin(byId.get(p.orden)?.delivery_duration) : p.ordenes.reduce((n, id) => n + serviceMin(byId.get(id)?.pickup_duration), 0))), RELOAD_MIN);");
    expect(mide).toContain("puntos.push({ id: d.id, lat: d.delivery_lat, lng: d.delivery_lng, servicio: parado[i] });");
    expect(mide).toContain("if (c) puntos.push({ id: `P:${i}`, lat: c.lat, lng: c.lng, servicio: parado[i] });");
    expect(mide).not.toContain("servicio: RELOAD_MIN");
  });
});
