import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KIND_LLEGO_A_RECOGER, KIND_SALTADA } from "@/lib/acciones-parada";
import { shiftDateISO, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";
import type { PausaDelChofer } from "@/lib/pausas-del-chofer";

// ============================================================
// D-520 · «Mi ruta» del chofer, PINTADA de verdad, con lo que el dueño pidió el 2026-10-11 con las capturas de Ernesto:
// sin «Saltar»; «📍 Llegué» por parada y «Recogido» siempre a la vista (apagado con su motivo si el almacén no la tiene
// lista); «Pendientes» abierta y «Entregadas» plegada; sin «Ver la ruta completa», sin el aviso de vencidas, sin leyenda;
// y «⏸ Registrar parada».
// ============================================================

const estado = vi.hoisted(() => ({
  me: null as null | { id: string; role: string; full_name: string },
  deliveries: [] as unknown[],
  events: [] as unknown[],
  pausas: [] as unknown[],
  // D-584: las tiendas de Ajustes, para que la recogida sepa si sale de una tienda.
  stores: [] as { name: string; address: string }[],
  pausasPedidas: [] as unknown[][],
  // D-547: la tarjeta «Siguiente parada» va apagada (`MOSTRAR_SIGUIENTE_PARADA = false`). Sus pruebas la encienden aquí
  // para seguir midiéndola: el código sigue entero y volver a encenderla es una línea.
  tarjeta: false,
}));

vi.mock("@/lib/data-provider", () => ({
  useData: () => ({
    me: estado.me, realRole: estado.me?.role ?? null, users: [], deliveries: estado.deliveries, events: estado.events,
    settings: { stores: estado.stores, driver_capacity: {}, default_truck_capacity: 12, driver_colors: {} },
    driverLocations: [], ready: true, setStage: async () => true, updateDelivery: async () => true, notify: () => {},
    marcarParada: async () => true, pushNotifs: async () => {}, teaching: false,
  }),
}));
vi.mock("@/lib/siguiente-de-mi-ruta", async (original) => {
  const real = await original<typeof import("@/lib/siguiente-de-mi-ruta")>();
  return { ...real, get MOSTRAR_SIGUIENTE_PARADA() { return estado.tarjeta; } };
});
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
vi.mock("@/lib/route-plan/usePlanPublicado", () => ({ usePlanPublicadoDelChofer: () => null }));
vi.mock("@/components/LeaveAtStore", () => ({ LeaveAtStore: () => createElement("span", { "data-dejar": "1" }) }));
vi.mock("@/components/MapView", () => ({ MapView: () => createElement("div", { "data-mapa": "1" }) }));
vi.mock("@/app/(app)/routes/page", () => ({ default: () => createElement("div", { "data-mapa-del-gestor": "1" }) }));
vi.mock("@/components/OrderModalLazy", () => ({ OrderModal: () => null }));
vi.mock("@/lib/useStoreMarkers", () => ({ useStoreMarkers: () => [] }));
// D-527: «↩ Deshacer» de la llegada y de la recogida preguntan con `useConfirm`, que en la app pone el layout.
vi.mock("@/lib/confirm", () => ({ useConfirm: () => async () => true }));
vi.mock("@/lib/usePausasDelChofer", () => ({
  usePausasDelChofer: (...args: unknown[]) => {
    estado.pausasPedidas.push(args);
    return { pausas: estado.pausas, estado: "lista", empezar: async () => ({ ok: true }), seguir: async () => ({ ok: true }), ubicarTarde: async () => {} };
  },
}));

const HOY = todayISO();
const CARLOS = { id: "u-carlos", role: "driver", full_name: "Carlos R." };
const orden = (id: string, stage: string, seq: number, extra: Partial<Delivery> = {}): Delivery => ({
  id, order_no: seq, invoice_num: `INV-${id}`, assigned_driver: "Carlos R.", stage, delivery_date: HOY, route_seq: seq,
  delivery_address: `${id} Main St`, delivery_windows: null, store: "McAllen", photos: [], ...extra,
}) as unknown as Delivery;

beforeEach(() => {
  estado.me = CARLOS;
  estado.deliveries = [
    orden("A1", "approved", 1),                         // el almacén aún no la tiene lista
    orden("A2", "ready", 2),
    orden("A3", "picked_up", 3),                         // en el camión
    orden("A4", "delivered", 4),                         // ya entregada
    orden("V1", "ready", 5, { delivery_date: shiftDateISO(HOY, -2) }), // vencida de otro día
  ];
  estado.events = [];
  estado.pausas = [];
  estado.pausasPedidas = [];
  estado.tarjeta = false;
  estado.stores = [];
});

const pinta = async () => {
  const { default: MyRoutePage } = await import("@/app/(app)/my-route/page");
  return renderToStaticMarkup(createElement(MyRoutePage));
};
const secciones = (html: string) => {
  const [antes, hechas] = html.split('data-seccion="hechas"');
  return { pendientes: antes.slice(antes.indexOf('data-seccion="pendientes"')), hechas: hechas ?? "" };
};

describe("«Mi ruta» pintada (D-520)", () => {
  it("D-522: las dos juntas arriba (Pendientes elegida), y solo se ve la lista elegida; cada una con su cuenta", async () => {
    const html = await pinta();
    expect(html).toMatch(/data-selector-de-lista/);
    expect(html.indexOf('data-titulo-de-seccion="pendientes"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-titulo-de-seccion="hechas"')).toBeGreaterThan(-1);
    // los dos botones van juntos, antes de las dos listas
    expect(html.indexOf('data-titulo-de-seccion="hechas"')).toBeLessThan(html.indexOf('data-seccion="pendientes"'));
    expect(html).toMatch(/aria-selected="true" data-titulo-de-seccion="pendientes"/);
    expect(html).toMatch(/<div data-seccion="pendientes" style/);
    expect(html).toMatch(/<div data-seccion="hechas" hidden=""/);
    expect(html).toContain("🕒 Pending (");
    expect(html).toContain("✓ Delivered (");
    const s = secciones(html);
    expect(s.hechas).toContain("INV-A4");
    expect(s.pendientes).not.toContain("INV-A4");
    expect(s.pendientes).toContain("INV-A3");
  });
  // Nota D-527: decía «a la vista, apagado y con el motivo». Desde D-527 abre la ficha, donde se recoge de todos modos con
  // nota (168): encendido, sin «⏳».
  it("D-527: la recogida que el almacén no tiene lista: «Picked up» ENCENDIDO, como la lista", async () => {
    // D-533: «Picked up» solo sale una vez que se llegó a la tienda (un botón que cambia).
    estado.events = [{ id: "e1", delivery_id: "A1", kind: KIND_LLEGO_A_RECOGER, note: null, created_by: "u-carlos", created_at: new Date().toISOString() }];
    const html = await pinta();
    const deA1 = html.slice(html.indexOf('data-recogida="A1"'), html.indexOf('data-recogida="A2"'));
    expect(deA1).toMatch(/data-accion="recoger"/);
    expect(deA1).not.toMatch(/data-accion="recoger"[^>]*disabled=""/);
    expect(deA1).not.toContain("The warehouse doesn&#x27;t have it ready yet");
    const deA2 = html.slice(html.indexOf('data-recogida="A2"'));
    expect(deA2.slice(0, deA2.indexOf("</button>"))).not.toContain("disabled");
  });
  // Nota D-533: decía «Arrived y Picked up en la MISMA fila, la de la primera orden». Ahora cada orden de la parada lleva UN
  // botón que cambia: «Arrived» en las dos mientras no se llega (un toque vale para las dos), «Picked up» en las dos al llegar.
  // Nota D-547: «Arrived» (y «✓ Arrived · ↩ Undo») vuelve a ir SOLO en la primera orden de la parada (A1): «since is the
  // 6th stop with that thats enough». A2 no lleva nada mientras no se llega, y «Picked up» al llegar, como A1.
  it("D-547: «📍 Arrived» solo en la primera orden de la parada; al llegar, «🚚 Picked up» en las dos", async () => {
    const html = await pinta();
    const botonesDe = (h: string, id: string) => {
      const de = h.slice(h.indexOf(`data-recogida="${id}"`), h.indexOf("data-cuenta", h.indexOf(`data-recogida="${id}"`)));
      return [...de.matchAll(/data-accion="([a-z_]+)"/g)].map((m) => m[1]);
    };
    expect(botonesDe(html, "A1")).toEqual(["llegue"]);
    expect(botonesDe(html, "A2")).toEqual([]);
    estado.events = [{ id: "e1", delivery_id: "A1", kind: KIND_LLEGO_A_RECOGER, note: null, created_by: "u-carlos", created_at: new Date().toISOString() }];
    const llegado = await pinta();
    expect(botonesDe(llegado, "A1")).toEqual(["recoger", "deshacer_llegada"]);
    expect(botonesDe(llegado, "A2")).toEqual(["recoger"]);
  });
  // Nota D-547: la tarjeta va apagada; esta prueba la enciende (`estado.tarjeta`) para seguir midiendo su texto. Y la fila
  // de la recogida ya no es verde claro sino azul claro («pickups change to color blue»).
  it("D-533: la burbuja del número y la factura abren la orden; con dos recogidas en la tienda, la siguiente es la que falta", async () => {
    estado.tarjeta = true;
    const html = await pinta();
    expect(html).toMatch(/<button type="button" data-abre-la-parada="1"[^>]*><span class="numero-de-parada" data-numero-de-parada="1"/);
    expect(html).toMatch(/<button type="button" data-abre-la-orden="A1" class="hint"/);
    expect(html).toMatch(/<button type="button" data-abre-la-orden="A2" class="hint"/);
    const tarjeta = (h: string) => h.slice(h.indexOf("data-siguiente-parada"), h.indexOf("data-mapa-del-gestor"));
    // Parada 1 de 5 (las cuatro órdenes de McAllen se recogen en UNA parada; luego cuatro entregas), recogida 1 de 4.
    expect(tarjeta(html)).toContain("Next stop · 1/5");
    expect(tarjeta(html)).toContain("Pickup 1 of 4");
    expect(tarjeta(html)).toContain("INV-A1");
    // Recogida A1: la siguiente es A2 (recogida 2 de 2), no la entrega de A1.
    estado.deliveries = (estado.deliveries as Delivery[]).map((d) => (d.id === "A1" ? { ...d, stage: "picked_up" } : d));
    const luego = await pinta();
    expect(tarjeta(luego)).toContain("Next stop · 1/5");
    expect(tarjeta(luego)).toContain("Pickup 2 of 4");
    expect(tarjeta(luego)).toContain("INV-A2");
    expect(tarjeta(luego)).not.toContain("INV-A1");
    // Y la fila de la parada 1 va pintada como siguiente.
    expect(luego).toMatch(/data-fila-de-ruta="1" data-tipo-de-fila="P" style="align-items:flex-start;background:var\(--accent-soft\);box-shadow:inset 0 0 0 2px var\(--accent\)"/);
  });
  it("D-527: la recogida ya en el camión lleva «↩ Undo pickup» (en «Delivered», donde queda la recogida hecha)", async () => {
    estado.events = [{ id: "e1", delivery_id: "A3", kind: "picked_up", note: "Loaded: 4 pallets", created_by: "u-carlos", created_at: new Date().toISOString() }];
    const html = await pinta();
    const s = secciones(html);
    expect(s.hechas).toMatch(/data-accion="deshacer_recogida"/);
    expect(s.hechas).not.toMatch(/data-accion="deshacer_recogida"[^>]*disabled=""/);
    // La recogió otro (la oficina): se ve, apagado, con a quién pedírselo.
    estado.events = [{ id: "e1", delivery_id: "A3", kind: "picked_up", note: "Loaded: 4 pallets", created_by: "u-oficina", created_at: new Date().toISOString() }];
    const otro = secciones(await pinta()).hechas;
    expect(otro).toMatch(/data-accion="deshacer_recogida" data-apagado=""[^>]*disabled=""/);
    expect(otro).toContain("ask the office");
  });
  // Nota D-533: «Recogido» con la carga lista ya no abre la ficha: recoge de un toque («if you press pickup it opens up the
  // order instead of doing the action»). Sin lista sigue abriendo la ficha (la nota es obligatoria). «Entregado», igual que D-527.
  // Nota D-547: con la carga lista, «Recogido» primero pregunta los pallets (`setPalletsDe(d)`, el cuadro `PalletsAlRecoger`)
  // y recoge al confirmar, con ese número (`recogerDeUnToque(d, n)` → `escrituraRecogida({ …, pallets })`).
  // Nota D-NEXT: «Entregado» ya NO abre la cámara (el dueño, 2026-10-22: «no que se lo imponga»): abre la ficha en la
  // prueba de entrega, donde están «📸 Varias fotos», «📷 Una foto» y «🖼 Galería».
  it("D-533: «Recogido» recoge de un toque si está lista (o abre la ficha si no); «Entregado» abre la prueba de entrega, SIN cámara", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/my-route/page.tsx", "utf8").split("\r\n").join("\n");
    const cuerpo = src.slice(src.indexOf("const cerrarParada = (d: Delivery, accion: \"recoger\" | \"entregar\") => {"), src.indexOf("const [recogiendo, setRecogiendo]"));
    expect(cuerpo).toContain("if (soloLectura) return;");
    expect(cuerpo).not.toMatch(/async|await/);
    expect(cuerpo).toContain('if (accion === "recoger" && seRecogeDeUnToque(d.stage)) { setPalletsDe(d); return; }');
    // D-NEXT: tras las dos puertas de «Recogido», lo único que hace es abrir la ficha en ese paso; nada de cámara.
    expect(cuerpo).toMatch(/abreElCuadroSinListo\(d\.stage\)\) \{ setSinListoDe\(d\); return; \}\s*abrirOrden\(d, accion\);\s*\};/);
    expect(cuerpo).not.toMatch(/camara|\.click\(\)/);
    // La recogida de un toque: la MISMA escritura que la ficha, GPS sin bloquear y parche tardío en silencio.
    const toque = src.slice(src.indexOf("const recogerDeUnToque = async (d: Delivery, pallets: number) => {"), src.indexOf("const done = stops.filter"));
    expect(toque.length).toBeGreaterThan(100);
    expect(toque).toContain("if (soloLectura || recogiendo) return;");
    expect(toque).toContain("const { immediate, eventual } = captureLocationSplit();");
    expect(toque).toContain("const escritura = escrituraRecogida({ pedido: d, me, gps, t, pallets });");
    expect(toque).toContain('const ok = await setStage(d.id, "picked_up", escritura.note, escritura.extra);');
    expect(toque).toContain("if (!gps) void adjuntarTardio(d.id, eventual);");
    expect(toque).toContain("await updateDelivery(id, { pickup_lat: gps.lat, pickup_lng: gps.lng, pickup_gps_at: gps.at }, { quiet: true });");
    expect(src).toContain("guardando={recogiendo === d.id}");
    // «Entregado» sigue sin escribir aquí: ni `delivered` ni `extraEntrega`.
    expect(src).not.toContain('"delivered",');
    expect(src).not.toContain("extraEntrega");
    expect(src).toContain("cerrar={cerrarParada}");
    expect(src).toContain("<OrderModal me={me} existing={open} startEditing={false} onClose={cerrarFicha} abrirEn={abrirEn} />");
    // D-NEXT: y ya no hay una cámara escondida en la página esperando el toque.
    const html = await pinta();
    expect(html).not.toContain('capture="environment"');
  });
  // Nota D-547: eran 3 (las dos órdenes de la tienda y la entrega). Ahora la tienda lo lleva una vez, en su primera orden.
  it("«📍 Arrived» en la parada de la tienda (una vez, en su primera orden, D-547) y en la entrega que va en el camión; ninguno en las hechas", async () => {
    const html = await pinta();
    const s = secciones(html);
    expect((s.pendientes.match(/data-accion="llegue"/g) ?? []).length).toBe(2);
    expect(s.hechas).not.toContain('data-accion="llegue"');
    const deA3 = html.slice(html.indexOf('data-entrega="A3"'), html.indexOf('data-entrega="A4"'));
    // D-533: «Arrived» que cambia a «Delivered», y «Rejected» siempre.
    expect([...deA3.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1])).toEqual(["llegue", "rechazar"]);
  });
  // Nota D-547: la tarjeta va apagada; aquí se enciende (`estado.tarjeta`) para medir lo que pinta cuando se vuelva a encender.
  it("la tarjeta de «Siguiente parada» lleva el «📍 Arrived» de SU parada (la tienda, mientras no la recoge), sin «Skip»", async () => {
    estado.tarjeta = true;
    const html = await pinta();
    const tarjeta = html.slice(html.indexOf("data-siguiente-parada"), html.indexOf('data-mapa-del-gestor'));
    expect(tarjeta).toContain("INV-A1");
    // Nota D-527: con su «Picked up» al lado, en la misma fila. D-533: un solo botón, «Arrived», que al llegar es «Picked up».
    expect([...tarjeta.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1])).toEqual(["llegue"]);
    const fila = tarjeta.slice(tarjeta.indexOf("data-acciones-de-parada"));
    expect([...fila.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1])).toEqual(["llegue"]);
    expect(tarjeta).toContain("🧭 Navigate");
    // Y la orden se abre tocándola (`data-abre-la-orden`), ya sin «📋 Open order».
    expect(tarjeta).toContain("data-abre-la-orden");
    expect(tarjeta).not.toContain("Open order");
  });
  it("ya llegó a la tienda: «✓ Arrived HH:MM» en vez del botón, que no se repite", async () => {
    estado.events = [{ id: "e1", delivery_id: "A1", kind: KIND_LLEGO_A_RECOGER, note: null, created_by: "u-carlos", created_at: new Date().toISOString() }];
    const html = await pinta();
    const s = secciones(html);
    expect((s.pendientes.match(/data-accion="llegue"/g) ?? []).length).toBe(1);
    // Nota D-527: ahora es el botón «↩ Undo» de la llegada (`data-accion="deshacer_llegada"`), con «✓ Arrived HH:MM» dentro.
    // D-533: en un renglón debajo de la fila, en las DOS órdenes de la parada (la llegada es de la parada).
    expect(s.pendientes).toMatch(/data-llegada="hecha"[^>]*><span[^>]*>✓ Arrived/);
    // Nota D-547: solo en la primera orden (A1), como el botón; eran 2.
    expect((s.pendientes.match(/data-llegada="hecha"/g) ?? []).length).toBe(1);
  });
  it("ni «Skip» ni «Resume» en ningún sitio, tampoco con un salto viejo en el historial", async () => {
    estado.events = [{ id: "e1", delivery_id: "A3", kind: KIND_SALTADA, note: null, created_by: "u-carlos", created_at: new Date().toISOString() }];
    const html = await pinta();
    expect(html).not.toContain("Skip");
    expect(html).not.toContain("Resume");
    expect(html).not.toContain('data-marca-de-parada="saltada"');
  });
  it("la cabecera: sin «Full route view», sin el aviso de vencidas, sin leyenda; con «⏸ Log a stop»", async () => {
    const html = await pinta();
    expect(html).not.toContain("Full route view");
    expect(html).not.toContain("overdue");
    expect(html).not.toContain("View them");
    expect(html).not.toContain("INV-V1");
    expect(html).not.toContain("Map legend");
    expect(html).toContain("⏸ Log a stop");
    // Las paradas que pide son las de SU chofer y de hoy.
    expect(estado.pausasPedidas.at(-1)?.slice(0, 2)).toEqual(["u-carlos", HOY]);
  });
  it("parado: «⏸ Stopped: ⛽ Gas · hora» con «▶ Continue», en vez del botón", async () => {
    const abierta: PausaDelChofer = {
      id: "p1", driver_id: "u-carlos", motivo: "gas", nota: null, empezo_at: new Date().toISOString(), termino_at: null,
      lat: null, lng: null, precision_m: null, recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false, created_at: "",
    };
    estado.pausas = [abierta];
    const html = await pinta();
    expect(html).toContain('data-pausa-abierta="gas"');
    expect(html).toContain("⏸ Stopped: ⛽ Gas · ");
    expect(html).toContain("▶ Continue");
    expect(html).not.toContain("⏸ Log a stop");
  });
  it("quien no es chofer va a su inicio, no a «Not available»", async () => {
    estado.me = { id: "u-w", role: "warehouse", full_name: "Almacén" };
    vi.doMock("next/navigation", () => ({ usePathname: () => "/my-route", useRouter: () => ({ replace: () => {} }) }));
    vi.resetModules();
    const { default: MyRoutePage } = await import("@/app/(app)/my-route/page");
    const html = renderToStaticMarkup(createElement(MyRoutePage));
    expect(html).toContain('data-sin-permiso="/warehouse"');
    expect(html).not.toContain("Not available");
    vi.doUnmock("next/navigation");
  });
});

// ============================================================
// D-547 · Seis pedidos del dueño del 2026-10-14 sobre «Mi ruta», con capturas de la tarjeta «NEXT STOP · 1/13 · PICKUP 1
// OF 2» y de la parada 6 en RDZ Brownsville. Aquí, los que se ven en la página pintada.
// ============================================================
describe("«Mi ruta» del 2026-10-14 (D-547)", () => {
  it("«disable that box for now»: la tarjeta «Siguiente parada» no se pinta, y la constante que la enciende está en false", async () => {
    const real = await vi.importActual<typeof import("@/lib/siguiente-de-mi-ruta")>("@/lib/siguiente-de-mi-ruta");
    expect(real.MOSTRAR_SIGUIENTE_PARADA).toBe(false);
    const html = await pinta();
    expect(html).not.toContain("data-siguiente-parada");
    expect(html).not.toContain("Next stop");
    expect(html).not.toContain("🧭 Navigate");
    // La lista sigue: las recogidas y la entrega de hoy.
    expect(html).toContain('data-recogida="A1"');
    expect(html).toContain('data-entrega="A3"');
    // Encendida, vuelve igual (la misma página, sin tocar más que la constante).
    estado.tarjeta = true;
    expect(await pinta()).toContain("data-siguiente-parada");
  });
  it("«Need driver to see the stage here»: cada orden de la lista lleva la pastilla de su etapa, la de Órdenes", async () => {
    const html = await pinta();
    const pastillaDe = (desde: string, hasta: string) => {
      const trozo = html.slice(html.indexOf(desde), hasta ? html.indexOf(hasta, html.indexOf(desde) + 1) : undefined);
      return /data-etapa-en-la-fila="([a-z_]+)"[^>]*>([^<]+)</.exec(trozo)?.slice(1);
    };
    expect(pastillaDe('data-recogida="A1"', 'data-recogida="A2"')).toEqual(["approved", "Programmed"]);
    expect(pastillaDe('data-recogida="A2"', "data-cuenta")).toEqual(["ready", "Ready"]);
    expect(pastillaDe('data-entrega="A3"', "data-acciones-de-parada")).toEqual(["picked_up", "Picked Up"]);
    expect(pastillaDe('data-entrega="A4"', "")).toEqual(["delivered", "Delivered"]);
    // El color es el de la etapa (`stageInfo`), el mismo de la tabla de Órdenes.
    expect(html).toMatch(/class="sema" data-etapa-en-la-fila="ready" style="background:#0f8a8a;color:#fff/);
  });
  it("«pickups change to color blue and deliveries to the orgiinal clear color»: recogida azul claro, entrega sin fondo", async () => {
    const html = await pinta();
    expect(html).toMatch(/data-fila-de-ruta="\d+" data-tipo-de-fila="P" style="align-items:flex-start;background:var\(--accent-soft\)/);
    // A3 va en el camión y no es la siguiente (lo es la recogida de A1): sin fondo ni borde, la fila de siempre.
    expect(html).toMatch(/data-entrega="A3" data-fila-de-ruta="\d+" data-tipo-de-fila="D" style="align-items:flex-start"/);
    expect(html).not.toContain("--green-soft");
  });
  it("una entrega con dos órdenes en la misma dirección: «Arrived» solo en la primera; la segunda, solo «Rejected»", async () => {
    // Aquí la fila de la segunda SÍ se pinta (lleva «Rejected» siempre, D-533), así que lo único que le quita «Arrived» es
    // que no es la primera de la parada.
    estado.deliveries = [
      orden("B1", "picked_up", 1, { delivery_address: "500 Elm St" }),
      orden("B2", "picked_up", 2, { delivery_address: "500 Elm St" }),
    ];
    // Solo Pendientes: la recogida ya hecha de las dos va en «Entregadas», con su «↩ Undo pickup».
    const html = secciones(await pinta()).pendientes;
    const botonesDe = (id: string) => {
      const de = html.slice(html.indexOf(`data-entrega="${id}"`));
      const fin = de.indexOf("data-entrega=", 10);
      return [...(fin > 0 ? de.slice(0, fin) : de).matchAll(/data-accion="([a-z_]+)"/g)].map((m) => m[1]);
    };
    // Las dos son UNA parada (el mismo número): si no, esta prueba no mediría nada.
    expect(html).toContain('data-sigue-la-parada="');
    expect(botonesDe("B1")).toEqual(["llegue", "rechazar"]);
    expect(botonesDe("B2")).toEqual(["rechazar"]);
  });
  it("«Picked up» con la carga lista no recoge directo: abre «¿Cuántos pallets cargas?» y recoge con ESE número", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/my-route/page.tsx", "utf8").split("\r\n").join("\n");
    expect(src).toContain("{palletsDe && <PalletsAlRecoger pedido={palletsDe} onCancelar={() => setPalletsDe(null)}");
    expect(src).toContain("onConfirmar={(n) => { const d = palletsDe; setPalletsDe(null); void recogerDeUnToque(d, n); }} />}");
    // Recién pintada, sin pulsar nada, el cuadro no está.
    expect(await pinta()).not.toContain("data-pallets-al-recoger");
  });
});

describe("«Mi ruta» del 2026-10-18 (D-584): de dónde se recoge", () => {
  // El dueño: «When pickup is at a store, no need to put address. Only if pickup is not at a store».
  it("la recogida en una tienda de Ajustes: la tienda resaltada, y NINGUNA dirección de recogida", async () => {
    estado.stores = [{ name: "McAllen", address: "500 N 10th St" }];
    estado.deliveries = [orden("A2", "ready", 2, { pickup_name: "McAllen", pickup_address: "500 N 10th St" } as Partial<Delivery>)];
    const html = await pinta();
    expect(html).toContain('data-recogida-en-tienda="McAllen"');
    expect(html).toContain("🏬 Store · McAllen");
    expect(html).not.toContain("data-direccion-de-recogida");
    expect(html).not.toContain("500 N 10th St");
  });
  it("la recogida que NO es tienda: su nombre y su dirección, sin resaltar como tienda", async () => {
    estado.stores = [{ name: "McAllen", address: "500 N 10th St" }];
    estado.deliveries = [orden("A2", "ready", 2, { pickup_name: "Bodega Reynosa", pickup_address: "Av. Hidalgo 45" } as Partial<Delivery>)];
    const html = await pinta();
    expect(html).not.toContain("data-recogida-en-tienda");
    expect(html).toContain("Pick up at Bodega Reynosa");
    expect(html).toContain('<span class="hint" data-direccion-de-recogida="true" style="display:block">Av. Hidalgo 45</span>');
  });
});
