import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  LIMITE_DE_PARTE, LIMITE_DE_PARTES, LIMITE_DE_UBICACION, contextoDeAyuda, dispositivoDeAyuda, limpiaDispositivo, limpiaUbicacion,
  nombreDeRuta, partesDeRuta, publicaContextoDeAyuda, retiraContextoDeAyuda, textoDelDispositivo, ubicacionDeAyuda, ubicacionDeSolicitud,
  vaciaContextoDeAyuda,
} from "./ayuda-ubicacion";
import {
  contextoDeClientes, contextoDeEntregas, contextoDeExpedientes, contextoDeLeads, contextoDeOrden, contextoDelAsistente, contextoDelEstimador,
  contextoDelGestor,
} from "./ayuda-contextos";
import { ayudaEnLaRuta } from "./ayuda-flotante";
import { COLUMNAS_DE_SOLICITUD, COLUMNAS_SIN_UBICACION, faltaLaColumna, leeConUbicacion } from "./help-requests";
import { htmlDelCorreoDeAyuda, textoParaClaude } from "./ayuda-para-claude";

/**
 * D-NEXT (2026-11-06). El dueño: «be more specific in the help request, for example whether it's in the Delivery app
 * main page, or Delivery app route manager, to know what they are looking at when they don't send a screenshot».
 */

const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("el mapa ruta → nombre", () => {
  it("nombra las rutas que el dueño puso de ejemplo, con la app delante", () => {
    expect(nombreDeRuta("/").en).toBe("Deliveries app · Main page (orders)");
    expect(nombreDeRuta("/routes").en).toBe("Deliveries app · Routes Manager");
    expect(nombreDeRuta("/home").en).toBe("Hub · Hub home");
    expect(nombreDeRuta("/customers?solicitudes=1").en).toBe("Customers · Customer list · Requests panel");
    expect(nombreDeRuta("/operaciones/nuevo/scrap").en).toBe("Warehouse Ops · New report · Scrap / damage");
  });

  it("lo dice también en español", () => {
    expect(nombreDeRuta("/").es).toBe("App de Entregas · Página principal (órdenes)");
    expect(nombreDeRuta("/routes").es).toBe("App de Entregas · Gestor de Rutas");
    expect(nombreDeRuta("/home").es).toBe("Hub · Inicio del hub");
    expect(nombreDeRuta("/operaciones/nuevo/scrap").es).toMatch(/ · Reporte nuevo · Merma \/ daños$/);
    expect(nombreDeRuta("/customers?solicitudes=1").es).toBe("Clientes · Lista de clientes · Panel de solicitudes");
  });

  it("los nombres de las apps salen de constants.ts, no de una copia: el de cada módulo es el de su tarjeta", async () => {
    const { MODULES, DELIVERIES_CARD } = await import("./constants");
    for (const m of MODULES) {
      const p = partesDeRuta(m.href);
      expect(p.partes[0], m.key).toEqual({ en: m.label_en, es: m.label_es });
    }
    expect(partesDeRuta("/").partes[0].en).toContain(DELIVERIES_CARD.label_en);
  });

  it("una pantalla con id lleva el id corto, no el uuid entero", () => {
    expect(nombreDeRuta("/erp/purchasing/orders/3f2a9c1e-1111-2222-3333-444455556666").en).toBe("Inventory · Purchase order 3f2a9c1e");
    expect(nombreDeRuta("/customers/1349").en).toBe("Customers · Customer file 1349");
    expect(nombreDeRuta("/erp/purchasing/orders/new").en).toBe("Inventory · Purchase orders · New order");
  });

  it("la barra del final, el # y los parámetros que no significan nada no cambian el nombre", () => {
    expect(nombreDeRuta("/routes/").en).toBe("Deliveries app · Routes Manager");
    expect(nombreDeRuta("/routes?x=1#abajo").en).toBe("Deliveries app · Routes Manager");
    expect(nombreDeRuta("/customers?solicitud=42").en).toBe("Customers · Customer list · Requests panel · request 42");
  });

  it("TODA pantalla con burbuja de Ayuda tiene nombre: una app nueva que nadie apunte en el mapa hace fallar esto", () => {
    const raiz = join(process.cwd(), "src/app");
    const rutas: string[] = [];
    const anda = (dir: string, ruta: string) => {
      for (const nombre of readdirSync(dir)) {
        const completo = join(dir, nombre);
        if (statSync(completo).isDirectory()) {
          if (nombre === "api") continue;
          const trozo = /^\(.*\)$/.test(nombre) ? "" : /^\[\[\.\.\..*\]\]$/.test(nombre) ? "" : /^\[.*\]$/.test(nombre) ? "/123" : `/${nombre}`;
          anda(completo, ruta + trozo);
        } else if (nombre === "page.tsx") rutas.push(ruta || "/");
      }
    };
    anda(raiz, "");
    expect(rutas.length).toBeGreaterThan(80);
    const sinNombre = rutas.filter((r) => ayudaEnLaRuta(r) && !partesDeRuta(r).conocida);
    expect(sinNombre).toEqual([]);
  });
});

describe("una ruta que el mapa no conoce", () => {
  it("si la app se conoce, dice la app y el resto en palabras", () => {
    const r = partesDeRuta("/timetracker/vacation-planner");
    expect(r.conocida).toBe(false);
    expect(nombreDeRuta("/timetracker/vacation-planner").en).toBe("Time Tracker · Vacation planner");
    expect(nombreDeRuta("/erp/algo-nuevo/77").en).toBe("Inventory · Algo nuevo · #77");
  });

  it("si ni la app se conoce, deja la ruta a la vista en vez de inventar", () => {
    const r = partesDeRuta("/cosa-rara/x");
    expect(r.conocida).toBe(false);
    expect(nombreDeRuta("/cosa-rara/x")).toEqual({ en: "Other screen (/cosa-rara/x)", es: "Otra pantalla (/cosa-rara/x)" });
  });

  it("Entregas no se queda con lo que no es suyo: una ruta de raíz desconocida NO es «Deliveries app»", () => {
    expect(nombreDeRuta("/cosa-rara").en).not.toContain("Deliveries");
  });

  it("sin ruta dice que no se sabe", () => {
    expect(nombreDeRuta(null).en).toBe("Unknown screen");
    expect(nombreDeRuta("  ").es).toBe("Pantalla desconocida");
  });
});

describe("el registro de contexto", () => {
  beforeEach(() => vaciaContextoDeAyuda());

  it("vacío de entrada; lo publicado sale, y lo retirado deja de salir", () => {
    expect(contextoDeAyuda()).toEqual([]);
    publicaContextoDeAyuda("gestor", [{ en: "Unassigned tab", es: "Pestaña Sin asignar" }]);
    expect(contextoDeAyuda()).toEqual([{ en: "Unassigned tab", es: "Pestaña Sin asignar" }]);
    retiraContextoDeAyuda("gestor");
    expect(contextoDeAyuda()).toEqual([]);
  });

  it("lo falso se salta y un texto suelto vale en los dos idiomas", () => {
    publicaContextoDeAyuda("x", [false, null, undefined, "", "171838", { en: "Open", es: "Abierta" }]);
    expect(contextoDeAyuda()).toEqual([{ en: "171838", es: "171838" }, { en: "Open", es: "Abierta" }]);
  });

  it("volver a publicar CAMBIA lo dicho sin perder el sitio: la pantalla sigue delante de su ficha", () => {
    publicaContextoDeAyuda("pantalla", ["tab A"]);
    publicaContextoDeAyuda("otra", ["x"]);
    publicaContextoDeAyuda("pantalla", ["tab B"]);
    expect(contextoDeAyuda().map((p) => p.en)).toEqual(["tab B", "x"]);
  });

  it("lo que se abre ENCIMA va detrás de la pantalla, aunque se haya publicado antes (React monta primero al hijo)", () => {
    publicaContextoDeAyuda("ficha", ["Order form open: invoice 171838"], { encima: true });
    publicaContextoDeAyuda("entregas", ["Table view"]);
    expect(contextoDeAyuda().map((p) => p.en)).toEqual(["Table view", "Order form open: invoice 171838"]);
  });

  it("publicar nada es retirar", () => {
    publicaContextoDeAyuda("x", ["algo"]);
    publicaContextoDeAyuda("x", [false]);
    expect(contextoDeAyuda()).toEqual([]);
  });

  it("acota: una parte larguísima se corta, y no caben más partes que el tope", () => {
    publicaContextoDeAyuda("x", ["a".repeat(500)]);
    expect(contextoDeAyuda()[0].en.length).toBe(LIMITE_DE_PARTE);
    publicaContextoDeAyuda("y", Array.from({ length: 30 }, (_, i) => `p${i}`));
    expect(contextoDeAyuda().length).toBe(LIMITE_DE_PARTES);
  });

  it("los saltos de línea se aplanan: la ubicación es UNA línea", () => {
    publicaContextoDeAyuda("x", ["uno\n  dos"]);
    expect(contextoDeAyuda()[0].en).toBe("uno dos");
  });
});

describe("la ubicación entera", () => {
  it("ruta + contexto, en los dos idiomas", () => {
    const u = ubicacionDeAyuda({ pagina: "/routes", contexto: contextoPartes(contextoDelGestor({ pestana: "orders", chip: "dia", fecha: "2026-11-06" })) });
    expect(u.en).toBe("Deliveries app · Routes Manager · Unassigned tab · Date: 2026-11-06");
    expect(u.es).toBe("App de Entregas · Gestor de Rutas · Pestaña Sin asignar · Fecha: 2026-11-06");
  });

  it("dentro de «Cambiar usuario» lo dice, con el nombre de la persona en la que se entró", () => {
    const u = ubicacionDeAyuda({ pagina: "/", suplantando: "Ernesto" });
    expect(u.en).toBe("Deliveries app · Main page (orders) · Change user: viewing as Ernesto");
    expect(u.es).toBe("App de Entregas · Página principal (órdenes) · Cambiar usuario: viendo como Ernesto");
    expect(ubicacionDeAyuda({ pagina: "/", suplantando: null }).en).not.toContain("Change user");
  });

  it("si la pantalla publicó su contexto, manda ella: un `?solicitudes=1` viejo en la URL no inventa un panel cerrado", () => {
    const cerrado = contextoPartes(contextoDeClientes({ ficha: null, solicitudes: false, borradores: false, buscando: true, elegidos: 0 }));
    expect(ubicacionDeAyuda({ pagina: "/customers?solicitudes=1", contexto: cerrado }).en).toBe("Customers · Customer list · with a search typed");
    expect(ubicacionDeAyuda({ pagina: "/customers?solicitudes=1", contexto: [] }).en).toBe("Customers · Customer list · Requests panel");
  });

  it("nunca pasa del tope que también exige la base", () => {
    const largo = Array.from({ length: 8 }, () => ({ en: "x".repeat(90), es: "x".repeat(90) }));
    expect(ubicacionDeAyuda({ pagina: "/", contexto: largo }).en.length).toBeLessThanOrEqual(LIMITE_DE_UBICACION);
    expect(lee("supabase/migrations/258_ayuda_ubicacion_clara.sql")).toContain(`<= ${LIMITE_DE_UBICACION}`);
  });
});

/** Las partes de un constructor de contexto, ya limpias (lo que haría el registro). */
function contextoPartes(partes: readonly unknown[]) {
  vaciaContextoDeAyuda();
  publicaContextoDeAyuda("t", partes as Parameters<typeof publicaContextoDeAyuda>[1]);
  const r = contextoDeAyuda();
  vaciaContextoDeAyuda();
  return r;
}
const enIngles = (partes: readonly unknown[]) => contextoPartes(partes).map((p) => p.en);

describe("lo que publica cada pantalla grande", () => {
  it("la ficha de la orden se nombra por su factura; sin factura, por su número; sin orden, es la nueva", () => {
    expect(contextoDeOrden({ invoice_num: "171838", order_no: 1001, order_code: "1001" }).en).toBe("Order form open: invoice 171838");
    expect(contextoDeOrden({ invoice_num: null, order_no: 1001, order_code: "1001" }).en).toBe("Order form open: order #1001");
    expect(contextoDeOrden({ invoice_num: "171838", order_no: 1, order_code: "1" }, true).es).toBe("Ficha de orden abierta (editando): factura 171838");
    expect(contextoDeOrden(null).en).toBe("New order form open");
  });

  it("Entregas: vista, fechas, etapa y lo abierto; de la búsqueda solo se dice que la hay", () => {
    expect(enIngles(contextoDeEntregas({ etapa: "all", preset: "today", vista: "table", buscando: false, seleccionadas: 0, importando: false })))
      .toEqual(["Table view", "Dates: Today", "Stage filter: all stages"]);
    expect(enIngles(contextoDeEntregas({ etapa: "ready", preset: "all", vista: "board", buscando: true, seleccionadas: 3, importando: true })))
      .toEqual(["Board view", "Dates: All dates", "Stage filter: Ready", "with a search typed", "3 order(s) selected", "Import orders window open"]);
  });

  it("el Gestor: pestaña, chip (solo en Sin asignar y si no es el del día), fecha y ventanas", () => {
    expect(enIngles(contextoDelGestor({ pestana: "routes", chip: "overdue", fecha: "2026-11-06" }))).toEqual(["Routes tab", "Date: 2026-11-06"]);
    expect(enIngles(contextoDelGestor({ pestana: "orders", chip: "overdue", fecha: "2026-11-07", planAbierto: true, vistaEficiente: true })))
      .toEqual(["Unassigned tab", "filter: overdue", "Date: 2026-11-07", "Efficient view", "Route plan window open"]);
    expect(enIngles(contextoDelGestor({ pestana: "todas", chip: "dia", fecha: "2026-11-06", todasLasFechas: true }))).toEqual(["All orders tab", "Date: all dates"]);
  });

  it("Clientes: el panel de solicitudes y la ficha, con el NOMBRE DE LA CUENTA y nada más del cliente", () => {
    expect(enIngles(contextoDeClientes({ ficha: null, solicitudes: true, borradores: false, buscando: false, elegidos: 0 }))).toEqual(["Requests panel"]);
    expect(enIngles(contextoDeClientes({ ficha: { tipo: "ver", cuenta: "ACME TILE LLC", editar: true }, solicitudes: false, borradores: false, buscando: false, elegidos: 0 })))
      .toEqual(["Customer file open (editing): ACME TILE LLC"]);
    expect(enIngles(contextoDeClientes({ ficha: { tipo: "nuevo" }, solicitudes: false, borradores: false, buscando: false, elegidos: 0 }))).toEqual(["New customer form open"]);
  });

  it("Leads: pestaña, pool y qué ventana; el nombre del prospecto NO viaja (la función ni lo recibe)", () => {
    expect(enIngles(contextoDeLeads({ pestana: "banco", pool: "McAllen", vista: "libres", buscando: false, dialogo: "cerrar", historialAbierto: false })))
      .toEqual(["Lead bank tab", "pool: McAllen", "showing free leads", "Close lead window open"]);
    expect(enIngles(contextoDeLeads({ pestana: "mio", pool: "McAllen", vista: "libres", buscando: false, dialogo: null, historialAbierto: false }))).toEqual(["My pool tab"]);
  });

  it("el asistente de Operaciones: el paso y su PREGUNTA, el resumen o la confirmación", () => {
    const paso = { en: "How many pieces?", es: "¿Cuántas piezas?" };
    expect(enIngles(contextoDelAsistente({ paso, indice: 2, total: 7, enResumen: false, enviado: false }))).toEqual(["step 3 of 7 'How many pieces?'"]);
    expect(contextoPartes(contextoDelAsistente({ paso, indice: 2, total: 7, enResumen: false, enviado: false }))[0].es).toBe("paso 3 de 7 «¿Cuántas piezas?»");
    expect(enIngles(contextoDelAsistente({ paso: null, indice: 7, total: 7, enResumen: true, enviado: false }))).toEqual(["summary before sending"]);
    expect(enIngles(contextoDelAsistente({ paso: null, indice: 7, total: 7, enResumen: true, enviado: true }))).toEqual(["report sent (confirmation screen)"]);
    // Con la ruta delante es el ejemplo del dueño.
    const u = ubicacionDeAyuda({ pagina: "/operaciones/nuevo/scrap", contexto: contextoPartes(contextoDelAsistente({ paso, indice: 2, total: 7, enResumen: false, enviado: false })) });
    expect(u.en).toBe("Warehouse Ops · New report · Scrap / damage · step 3 of 7 'How many pieces?'");
  });

  it("Quote Builder: pestaña, número de cotización y qué hay abierto", () => {
    expect(enIngles(contextoDelEstimador({ pestana: "cotizacion", numero: "Q-2041", guardada: true, lineas: 4, vistaPrevia: true, politicaAbierta: false, desdeLead: false })))
      .toEqual(["Quote tab", "quote Q-2041", "4 line(s)", "Print preview open"]);
    expect(enIngles(contextoDelEstimador({ pestana: "cotizacion", numero: null, guardada: false, lineas: 0, vistaPrevia: false, politicaAbierta: false, desdeLead: true })))
      .toEqual(["Quote tab", "new quote, not saved yet", "0 line(s)", "started from a lead"]);
    expect(enIngles(contextoDelEstimador({ pestana: "todas", numero: "Q-1", guardada: true, lineas: 4, vistaPrevia: false, politicaAbierta: false, desdeLead: false }))).toEqual(["All quotes tab (admin)"]);
  });

  it("RR. HH.: qué lista se ve y de quién es el expediente abierto", () => {
    expect(enIngles(contextoDeExpedientes({ estado: "activos", buscando: false, abierto: "Julio Pérez", dialogo: null }))).toEqual(["showing active employees", "Employee file open: Julio Pérez"]);
    expect(enIngles(contextoDeExpedientes({ estado: "bajas", buscando: true, abierto: null, dialogo: "agregar" }))).toEqual(["showing former employees", "with a search typed", "Add employee window open"]);
  });

  it("cada una de esas pantallas PUBLICA su contexto (el gancho está puesto donde se dice)", () => {
    const ganchos: [string, string][] = [
      ["src/app/(app)/page.tsx", 'useContextoDeAyuda("entregas", contextoDeEntregas('],
      ["src/app/(app)/routes/page.tsx", 'useContextoDeAyuda("gestor", contextoDelGestor('],
      ["src/app/customers/Clientes.tsx", 'useContextoDeAyuda("clientes", contextoDeClientes('],
      ["src/app/leads/Leads.tsx", 'useContextoDeAyuda("leads", contextoDeLeads('],
      ["src/app/operaciones/Asistente.tsx", 'useContextoDeAyuda("asistente-de-operaciones", contextoDelAsistente('],
      ["src/app/estimator/Estimador.tsx", 'useContextoDeAyuda("estimador", contextoDelEstimador('],
      ["src/app/recruiting/(recruiting)/employees/page.tsx", 'useContextoDeAyuda("expedientes", contextoDeExpedientes('],
      ["src/components/OrderModal.tsx", 'useContextoDeAyuda("ficha-de-orden", [contextoDeOrden('],
    ];
    for (const [fichero, gancho] of ganchos) expect(lee(fichero), fichero).toContain(gancho);
  });
});

describe("el dispositivo", () => {
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  const EDGE = `${WINDOWS} Edg/141.0.0.0`;
  const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const ELECTRON = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) rtg-hub/1.2.0 Chrome/130.0.0.0 Electron/33.2.0 Safari/537.36";

  it("teléfono, computadora y tableta, con navegador y sistema", () => {
    expect(dispositivoDeAyuda({ ua: ANDROID, ancho: 412, alto: 915 })).toEqual({ tipo: "phone", ancho: 412, alto: 915, navegador: "Chrome 141", sistema: "Android" });
    expect(dispositivoDeAyuda({ ua: IPHONE, ancho: 390, alto: 844 })).toMatchObject({ tipo: "phone", navegador: "Safari 18", sistema: "iOS" });
    expect(dispositivoDeAyuda({ ua: WINDOWS, ancho: 1920, alto: 955 })).toMatchObject({ tipo: "desktop", navegador: "Chrome 141", sistema: "Windows" });
    expect(dispositivoDeAyuda({ ua: EDGE, ancho: 1366, alto: 768 })).toMatchObject({ tipo: "desktop", navegador: "Edge 141" });
  });

  it("un iPad se presenta como un Mac: se le reconoce por ser táctil; un Mac de verdad sigue siendo computadora", () => {
    expect(dispositivoDeAyuda({ ua: IPAD, ancho: 1024, alto: 1366, tactil: true })).toMatchObject({ tipo: "tablet", sistema: "iPadOS" });
    expect(dispositivoDeAyuda({ ua: IPAD, ancho: 1440, alto: 900, tactil: false })).toMatchObject({ tipo: "desktop", sistema: "macOS" });
  });

  it("la app de escritorio se dice que lo es", () => {
    expect(dispositivoDeAyuda({ ua: ELECTRON, ancho: 1280, alto: 800 }).navegador).toBe("Desktop app (Electron 33)");
  });

  it("una ventana estrecha de computadora sigue siendo computadora (el ancho va aparte)", () => {
    expect(dispositivoDeAyuda({ ua: WINDOWS, ancho: 400, alto: 700 }).tipo).toBe("desktop");
  });

  it("se escribe en una línea, en el idioma de quien lee", () => {
    const d = dispositivoDeAyuda({ ua: ANDROID, ancho: 412, alto: 915 });
    expect(textoDelDispositivo(d, "en")).toBe("Phone · 412×915 · Chrome 141 · Android");
    expect(textoDelDispositivo(d, "es")).toBe("Teléfono · 412×915 · Chrome 141 · Android");
  });

  it("lo que llega del navegador se comprueba: lo que no tiene la forma es null, y los textos se acotan", () => {
    expect(limpiaDispositivo(null)).toBeNull();
    expect(limpiaDispositivo("phone")).toBeNull();
    expect(limpiaDispositivo({ tipo: "nave espacial", ancho: 1, alto: 1 })).toBeNull();
    const d = limpiaDispositivo({ tipo: "phone", ancho: "ancho", alto: 9e9, navegador: "x".repeat(500), sistema: 7, otra: "cosa" });
    expect(d).toEqual({ tipo: "phone", ancho: 0, alto: 0, navegador: `${"x".repeat(59)}…`, sistema: "" });
    expect(textoDelDispositivo(null, "en")).toBeNull();
    expect(textoDelDispositivo({}, "en")).toBeNull();
  });

  it("la ubicación que llega también: texto, una línea, con tope; vacía es null", () => {
    expect(limpiaUbicacion(undefined)).toBeNull();
    expect(limpiaUbicacion({ en: "x" })).toBeNull();
    expect(limpiaUbicacion("   ")).toBeNull();
    expect(limpiaUbicacion(" Hub ·\n Hub home ")).toBe("Hub · Hub home");
    expect(limpiaUbicacion("x".repeat(5000))!.length).toBe(LIMITE_DE_UBICACION);
  });
});

describe("una solicitud guardada", () => {
  it("con ubicación guardada, la enseña en el idioma de quien lee", () => {
    const s = { page: "/routes", location_en: "Deliveries app · Routes Manager · Unassigned tab", location_es: "App de Entregas · Gestor de Rutas · Pestaña Sin asignar" };
    expect(ubicacionDeSolicitud(s, "en")).toEqual({ texto: "Deliveries app · Routes Manager · Unassigned tab", guardada: true });
    expect(ubicacionDeSolicitud(s, "es")).toEqual({ texto: "App de Entregas · Gestor de Rutas · Pestaña Sin asignar", guardada: true });
  });

  it("una solicitud VIEJA (solo `page`) no enseña la ruta cruda: se nombra con el mapa, y se sabe que es deducida", () => {
    expect(ubicacionDeSolicitud({ page: "/routes" }, "en")).toEqual({ texto: "Deliveries app · Routes Manager", guardada: false });
    expect(ubicacionDeSolicitud({ page: "/customers?solicitudes=1", location_en: null, location_es: null }, "es"))
      .toEqual({ texto: "Clientes · Lista de clientes · Panel de solicitudes", guardada: false });
    expect(ubicacionDeSolicitud({ page: "/operaciones/nuevo/scrap", location_en: "  " }, "en")?.texto).toBe("Warehouse Ops · New report · Scrap / damage");
  });

  it("si solo se guardó un idioma, vale para los dos antes que la ruta", () => {
    expect(ubicacionDeSolicitud({ page: "/", location_en: "Deliveries app · Main page (orders) · Board view" }, "es")?.texto).toBe("Deliveries app · Main page (orders) · Board view");
  });

  it("sin ubicación ni ruta, null: la pantalla pinta «—»", () => {
    expect(ubicacionDeSolicitud({ page: null }, "en")).toBeNull();
    expect(ubicacionDeSolicitud({}, "es")).toBeNull();
  });
});

describe("la base aún sin la 258: nada se rompe", () => {
  it("reconoce «esa columna no existe» de PostgREST, al escribir y al leer, y nada más", () => {
    expect(faltaLaColumna({ code: "PGRST204", message: "Could not find the 'device' column of 'help_requests' in the schema cache" })).toBe(true);
    expect(faltaLaColumna({ code: "42703", message: "column help_requests.location_en does not exist" })).toBe(true);
    expect(faltaLaColumna({ message: "column help_requests.location_es does not exist" })).toBe(true);
    expect(faltaLaColumna({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(faltaLaColumna(null)).toBe(false);
  });

  it("la lectura prueba con las columnas nuevas y, si la base no las tiene, repite sin ellas", async () => {
    const pedidas: string[] = [];
    const r = await leeConUbicacion(async (columnas) => {
      pedidas.push(columnas);
      return columnas === COLUMNAS_DE_SOLICITUD
        ? { data: null, error: { code: "42703", message: "column help_requests.location_en does not exist" } }
        : { data: [{ id: "1" }], error: null };
    });
    expect(pedidas).toEqual([COLUMNAS_DE_SOLICITUD, COLUMNAS_SIN_UBICACION]);
    expect(r.data).toEqual([{ id: "1" }]);
  });

  it("con la 258 aplicada pregunta una sola vez; y un error que no es de columnas NO se tapa repitiendo", async () => {
    let veces = 0;
    await leeConUbicacion(async () => { veces++; return { data: [], error: null }; });
    expect(veces).toBe(1);
    veces = 0;
    const r = await leeConUbicacion(async () => { veces++; return { data: null, error: { code: "42501", message: "permission denied" } }; });
    expect(veces).toBe(1);
    expect(r.error?.code).toBe("42501");
  });

  it("la ruta guarda con las columnas nuevas y, si faltan, como antes: la solicitud no se pierde", () => {
    const ruta = lee("src/app/api/help/route.ts");
    expect(ruta).toContain("guarda({ ...filaBase, location_en: ubicacionEn, location_es: ubicacionEs, device: dispositivo })");
    expect(ruta).toContain("if (faltaLaColumna(errorAlGuardar)) ({ data: fila, error: errorAlGuardar } = await guarda(filaBase));");
  });
});

describe("dónde se ve", () => {
  const solicitud = {
    id: "3f2a9c1e-1111-2222-3333-444455556666", created_at: "2026-11-06T15:00:00.000Z", sender_name: "Ana", sender_email: null, role_label: "Sales",
    page: "/routes", app_version: "1.0.0", lang: "es", message: "no carga",
  };

  it("el correo: en el asunto, arriba en el cuerpo y entre las líneas de contexto, junto al aparato", () => {
    const ruta = lee("src/app/api/help/route.ts");
    expect(ruta).toContain("const subject = `Help request from ${who}${roleLabel}${ubicacionEn ? ` — ${ubicacionEn}` : \"\"}`;");
    expect(ruta).toContain("ubicacionEn ? `Where: ${ubicacionEn}` : null,");
    expect(ruta).toContain("aparato ? `Device: ${aparato}` : null,");
    // Y `page` no se quita: sigue en el correo y en la fila.
    expect(ruta).toContain("body.page ? `Page: ${body.page}` : null,");
    expect(ruta).toContain("page: pagina,");
    const html = htmlDelCorreoDeAyuda({ mensaje: "no carga", ubicacion: "Deliveries app · Routes Manager <b>", contexto: [], adjuntos: [], enlaceParaCopiar: null });
    expect(html).toContain("<b>Where: Deliveries app · Routes Manager &lt;b&gt;</b>");
    expect(html.indexOf("Where:")).toBeLessThan(html.indexOf("no carga"));
    expect(htmlDelCorreoDeAyuda({ mensaje: "x", contexto: [], adjuntos: [], enlaceParaCopiar: null })).not.toContain("Where:");
  });

  it("un navegador viejo que no manda ubicación: el servidor la deduce de la ruta, no deja la ruta cruda", () => {
    const ruta = lee("src/app/api/help/route.ts");
    expect(ruta).toContain("const ubicacionEn = limpiaUbicacion(body.ubicacion?.en) ?? deLaRuta?.en ?? null;");
  });

  it("la bandeja del admin: en la fila (sin abrirla) y dentro, con el aparato en pequeño", () => {
    const pagina = lee("src/app/home/solicitudes-de-ayuda/page.tsx");
    const fila = pagina.indexOf("data-ubicacion-solicitud");
    expect(fila).toBeGreaterThan(-1);
    // Va fuera del `abiertaEsta &&`: se ve en la lista y con la solicitud abierta.
    expect(fila).toBeLessThan(pagina.indexOf("{!abiertaEsta && ("));
    expect(pagina).toContain('{t("Where", "Dónde")}');
    expect(pagina).toContain("data-dispositivo-solicitud");
    expect(pagina).toContain("leeConUbicacion(");
  });

  it("«Copiar para Claude» también lo dice, y una solicitud vieja sale con el nombre deducido", () => {
    const nueva = textoParaClaude({
      solicitud: { ...solicitud, location_en: "Deliveries app · Routes Manager", location_es: "App de Entregas · Gestor de Rutas · Pestaña Sin asignar", device: { tipo: "phone", ancho: 412, alto: 915, navegador: "Chrome 141", sistema: "Android" } },
      mensajes: [], imagenes: 0,
    });
    expect(nueva).toContain("Dónde estaba: App de Entregas · Gestor de Rutas · Pestaña Sin asignar");
    expect(nueva).toContain("Dispositivo: Teléfono · 412×915 · Chrome 141 · Android");
    expect(nueva).toContain("Página: /routes");
    const vieja = textoParaClaude({ solicitud, mensajes: [], imagenes: 0 });
    expect(vieja).toContain("Dónde estaba: App de Entregas · Gestor de Rutas");
    expect(vieja).not.toContain("Dispositivo:");
  });

  it("al mandar se recoge TODO en un sitio: registro, parámetros de la URL, «Cambiar usuario» y aparato", () => {
    const envio = lee("src/lib/help-send.ts");
    expect(envio).toContain("contexto: contextoDeAyuda(), suplantando: await enQuienEstoy()");
    expect(envio).toContain("dispositivo: dispositivoDeEsteNavegador()");
    expect(envio).toContain("ubicacion, dispositivo,");
  });
});

describe("la migración 258", () => {
  const sql = lee("supabase/migrations/258_ayuda_ubicacion_clara.sql");
  const cuerpo = sql.split("-- @ledger-below")[0];

  it("añade las tres columnas sin tocar `page`, y las protege como historial", () => {
    expect(cuerpo).toMatch(/add column if not exists location_en text/);
    expect(cuerpo).toMatch(/add column if not exists location_es text/);
    expect(cuerpo).toMatch(/add column if not exists device\s+jsonb/);
    expect(cuerpo).not.toMatch(/drop column(?! if exists (location_en|location_es|device))/);
    for (const c of ["location_en", "location_es", "device", "page", "message"]) {
      expect(cuerpo, c).toMatch(new RegExp(`NEW\\.${c}\\s+is distinct from OLD\\.${c}`));
    }
  });

  it("el aviso de la campana al admin dice desde dónde, y sin ubicación sale como salía", () => {
    expect(cuerpo).toContain("donde := btrim(coalesce(s.location_en, ''));");
    expect(cuerpo).toContain("if donde <> '' then donde := ' (' || donde || ')'; end if;");
    expect((cuerpo.match(/' wrote' \|\| donde \|\| ' — “' \|\| asomo \|\| '”'/g) ?? []).length).toBe(2);
  });

  it("no cambia a quién se avisa ni cuándo se reabre: es la función de la 126 con `donde` de más", () => {
    const de = (texto: string) => {
      const i = texto.indexOf("create or replace function public.help_message_after_insert()");
      return texto.slice(i, texto.indexOf("end $$;", i)).replace(/\r/g, "");
    };
    const nueva = de(cuerpo)
      .replace(/\n {2}donde {3}text;/, "")
      .replace(/\n\n {2}-- Desde donde[\s\S]*?end if;\n {2}if donde <> ''[^\n]*\n/, "\n")
      .replace(/' wrote' \|\| donde \|\| ' — “'/g, "' wrote — “'");
    expect(nueva).toBe(de(lee("supabase/migrations/126_ayuda_chat.sql")));
  });

  it("lleva su línea de registro y ningún D-NEXT (numerar cambiaría el checksum)", () => {
    expect(sql).toMatch(/-- @ledger-below\r?\ninsert into public\.schema_migrations \(name, checksum\) values \('258_ayuda_ubicacion_clara\.sql', '[0-9a-f]{64}'\) on conflict \(name\) do nothing;/);
    expect(sql).not.toContain("D-NEXT");
  });
});
