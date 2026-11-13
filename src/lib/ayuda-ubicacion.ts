import { DELIVERIES_CARD, HUB_TOOLS, MODULES, TABS } from "@/lib/constants";
import { INFO_DE_TIPO, esTipo } from "@/lib/almacen-ops/tipos";

/**
 * DÓNDE estaba la persona cuando pidió ayuda, dicho con palabras (D-901).
 *
 * El dueño, 2026-11-06: «be more specific in the help request, for example whether it's in the Delivery app main page,
 * or Delivery app route manager, to know what they are looking at when they don't send a screenshot». Hasta ahora la
 * solicitud guardaba `page` como ruta cruda («/», «/routes», «/operaciones/nuevo/scrap»), que no le dice a quien la lee
 * qué tenía delante la persona.
 *
 * Tres piezas, las tres aquí y sin tocar la base:
 *   1. **El mapa ruta → nombre** (`nombreDeRuta`): app + pantalla, en inglés y en español. Los nombres de las apps y de
 *      las pestañas de Entregas salen de `constants.ts` (`MODULES`, `DELIVERIES_CARD`, `TABS`, `HUB_TOOLS`), que es de
 *      donde los pinta el hub: si una app cambia de nombre allí, cambia aquí. Una ruta que el mapa no conoce no se
 *      pierde: se dice la app y el resto de la ruta en palabras, o la ruta tal cual si ni la app se conoce.
 *   2. **El contexto que publica cada pantalla** (`useContextoDeAyuda`): la pestaña, el filtro, la ficha abierta y de
 *      qué registro, el paso del asistente. Es opcional: quien no publica nada se queda con el nombre de la ruta.
 *   3. **El dispositivo** (`dispositivoDeAyuda`): teléfono o computadora, tamaño de pantalla y navegador.
 *
 * Lo que NO se recoge: nada de lo que la persona escribió en un formulario, ni teléfonos, direcciones o correos. Solo
 * el identificador que ya está en pantalla (número de orden o de factura, nombre de la cuenta), y cada pantalla decide
 * cuál publica.
 */

export type Bilingue = { en: string; es: string };
/** Una parte del contexto. Un texto suelto vale igual en los dos idiomas (un número de factura, un nombre). */
export type ParteDeContexto = Bilingue | string | null | undefined | false;

export const SEPARADOR = " · ";
/** Lo que cabe: una parte, cuántas partes y la ubicación entera. La base repite el último (migración 258). */
export const LIMITE_DE_PARTE = 90;
export const LIMITE_DE_PARTES = 8;
export const LIMITE_DE_UBICACION = 300;

const b = (en: string, es: string): Bilingue => ({ en, es });

/** Sin el emoji de delante («🧭 Routes Manager» → «Routes Manager»). */
function sinEmoji(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

function modulo(clave: string): Bilingue {
  const m = MODULES.find((x) => x.key === clave);
  return m ? b(m.label_en, m.label_es) : b(clave, clave);
}

interface AppDelMapa {
  /** Con qué empieza su ruta. «» es Entregas, que vive en la raíz. */
  prefijo: string;
  nombre: Bilingue;
  /** Su pantalla de entrada (la ruta del prefijo, sin nada detrás). */
  inicio?: Bilingue;
  /** Sus pantallas, por lo que va detrás del prefijo. `:id` vale por un segmento cualquiera y se añade al nombre. */
  pantallas: Record<string, Bilingue>;
  /** Lo que un parámetro de la URL abre encima de la pantalla (`?solicitudes=1` → el panel de solicitudes). */
  consulta?: { parametro: string; nombre: Bilingue; conValor?: boolean }[];
}

/** Las pestañas de Entregas, con el nombre que les da la barra. */
const PESTANAS_DE_ENTREGAS: Record<string, Bilingue> = Object.fromEntries(
  TABS.filter((t) => t.href !== "/").map((t) => [t.href.slice(1), b(sinEmoji(t.label), sinEmoji(t.label_es))]),
);

/** Las herramientas del hub, con el nombre de su tarjeta. */
const HERRAMIENTAS_DEL_HUB: Record<string, Bilingue> = Object.fromEntries(
  HUB_TOOLS.filter((h) => h.href.startsWith("/home/")).map((h) => [h.href.slice("/home/".length), b(h.label_en, h.label_es)]),
);

const TIPOS_DE_REPORTE: Record<string, Bilingue> = Object.fromEntries(
  Object.entries(INFO_DE_TIPO).map(([k, v]) => [`nuevo/${k}`, b(`New report${SEPARADOR}${v.en}`, `Reporte nuevo${SEPARADOR}${v.es}`)]),
);

export const APPS_DEL_MAPA: AppDelMapa[] = [
  {
    prefijo: "/home",
    nombre: b("Hub", "Hub"),
    inicio: b("Hub home", "Inicio del hub"),
    pantallas: {
      ...HERRAMIENTAS_DEL_HUB,
      ayuda: b("My help requests", "Mis solicitudes de ayuda"),
      "solicitudes-de-ayuda": b("Help requests (admin)", "Solicitudes de ayuda (admin)"),
      "solicitudes-de-ayuda/:id/copiar": b("Help requests · Copy for Claude", "Solicitudes de ayuda · Copiar para Claude"),
      mapa: b("Company map", "Mapa de la empresa"),
      personalizar: b("Customize home", "Personalizar el inicio"),
      profile: b("My profile", "Mi perfil"),
      users: b("Users", "Usuarios"),
    },
  },
  {
    prefijo: "/recruiting",
    nombre: modulo("recruiting"),
    inicio: b("Home", "Inicio"),
    pantallas: {
      employees: b("Employee files", "Expedientes de empleados"),
      board: b("Recruiting board", "Tablero de reclutamiento"),
      today: b("Today", "Hoy"),
      calendar: b("Calendar", "Calendario"),
      calls: b("Calls", "Llamadas"),
      assets: b("Assets", "Equipo asignado"),
      metrics: b("Metrics", "Métricas"),
      outcomes: b("Outcomes", "Resultados"),
      questions: b("Interview questions", "Preguntas de entrevista"),
      settings: b("Settings", "Ajustes"),
      "user-creation": b("User creation", "Creación de usuarios"),
      users: b("Users", "Usuarios"),
      permisos: b("Permissions", "Permisos"),
    },
  },
  {
    prefijo: "/timetracker",
    nombre: modulo("timetracker"),
    inicio: b("Clock in / my day", "Fichar / mi día"),
    pantallas: {
      week: b("My week", "Mi semana"),
      diary: b("Diary", "Diario"),
      schedule: b("Schedule", "Horario"),
      requests: b("My requests", "Mis solicitudes"),
      "team-requests": b("Team requests", "Solicitudes del equipo"),
      live: b("Live (who is clocked in)", "En vivo (quién está fichado)"),
      people: b("People", "Personas"),
      projects: b("Projects", "Proyectos"),
      assignments: b("Assignments", "Asignaciones"),
      reports: b("Reports", "Reportes"),
      payroll: b("Payroll", "Nómina"),
      insights: b("Insights", "Análisis"),
      audit: b("Audit", "Auditoría"),
      settings: b("Settings", "Ajustes"),
      account: b("My account", "Mi cuenta"),
    },
  },
  {
    prefijo: "/erp",
    nombre: modulo("erp"),
    inicio: b("Home", "Inicio"),
    pantallas: {
      catalog: b("Catalog", "Catálogo"),
      "product/:id": b("Product", "Producto"),
      dashboard: b("Dashboard", "Panel"),
      decisions: b("Decisions", "Decisiones"),
      inventory: b("Inventory counts", "Conteos de inventario"),
      master: b("Master list", "Lista maestra"),
      "po-upload": b("PO upload", "Subir orden de compra"),
      purchasing: b("Purchasing", "Compras"),
      "purchasing/categories": b("Purchasing · Categories", "Compras · Categorías"),
      "purchasing/orders": b("Purchase orders", "Órdenes de compra"),
      "purchasing/orders/new": b("Purchase orders · New order", "Órdenes de compra · Orden nueva"),
      "purchasing/orders/:id": b("Purchase order", "Orden de compra"),
      "purchasing/receiving": b("Receive inventory", "Recibir inventario"),
      request: b("New product request", "Solicitud de producto nuevo"),
      requests: b("Product requests", "Solicitudes de producto"),
      review: b("Review", "Revisión"),
      "review/daltile": b("Review · Daltile", "Revisión · Daltile"),
      "review/merge": b("Review · Merge products", "Revisión · Juntar productos"),
      analytics: b("Analytics", "Analítica"),
      "analytics/categories": b("Analytics · Categories", "Analítica · Categorías"),
      "analytics/salespeople": b("Analytics · Salespeople", "Analítica · Vendedores"),
      "analytics/stores": b("Analytics · Stores", "Analítica · Tiendas"),
      "analytics/vendors": b("Analytics · Vendors", "Analítica · Proveedores"),
    },
  },
  {
    prefijo: "/estimator",
    nombre: modulo("estimator"),
    pantallas: {},
    consulta: [
      { parametro: "quote", nombre: b("Quote open", "Cotización abierta") },
      { parametro: "lead", nombre: b("Started from a lead", "Abierto desde un lead") },
    ],
  },
  {
    prefijo: "/leads",
    nombre: modulo("leads"),
    pantallas: {},
    consulta: [{ parametro: "lead", nombre: b("Lead open", "Lead abierto") }],
  },
  {
    prefijo: "/customers",
    nombre: modulo("customers"),
    inicio: b("Customer list", "Lista de clientes"),
    pantallas: {
      ":id": b("Customer file", "Ficha de cliente"),
      juntar: b("Merge customers", "Juntar clientes"),
    },
    consulta: [
      { parametro: "solicitudes", nombre: b("Requests panel", "Panel de solicitudes") },
      { parametro: "solicitud", nombre: b("Requests panel · request", "Panel de solicitudes · solicitud"), conValor: true },
    ],
  },
  {
    prefijo: "/operaciones",
    nombre: modulo("warehouse_ops"),
    inicio: b("Home", "Inicio"),
    pantallas: {
      ...TIPOS_DE_REPORTE,
      "mis-reportes": b("My reports", "Mis reportes"),
      reportes: b("All reports (managers)", "Todos los reportes (gerentes)"),
      // 273: equipo, lista diaria, refacciones y uso.
      mantenimiento: b("Maintenance", "Mantenimiento"),
      // 274 (D-929): la hoja de un conteo de inventario (sistema vs contado, firma). D-930: faltaba en el mapa y la
      // prueba de «toda pantalla con Ayuda tiene nombre» llevaba rojo main desde entonces.
      "conteos/hoja": b("Inventory count sheet", "Hoja de conteo de inventario"),
      // La hoja de aprobación de un reporte (gerentes).
      "reportes/hoja-de-aprobacion": b("Report approval sheet", "Hoja de aprobación del reporte"),
    },
  },
  { prefijo: "/promos", nombre: modulo("promos"), inicio: b("Promotions list", "Lista de promociones"), pantallas: { ":id": b("Promotion", "Promoción") } },
  { prefijo: "/surveys", nombre: modulo("surveys"), pantallas: {} },
  { prefijo: "/security", nombre: b("Central Hub Monitoring", "Central Hub Monitoring"), pantallas: {} },
  { prefijo: "/change-password", nombre: b("Change password", "Cambiar contraseña"), pantallas: {} },
  { prefijo: "/no-access", nombre: b("No access screen", "Pantalla «sin acceso»"), pantallas: {} },
  { prefijo: "/device-blocked", nombre: b("Device blocked screen", "Pantalla «dispositivo bloqueado»"), pantallas: {} },
  { prefijo: "/web-blocked", nombre: b("Web blocked screen", "Pantalla «web bloqueada»"), pantallas: {} },
  {
    // Entregas vive en la raíz: va la ÚLTIMA, y solo se queda con las rutas que son suyas (ver `appDeLaRuta`).
    prefijo: "",
    nombre: b(`${DELIVERIES_CARD.label_en} app`, `App de ${DELIVERIES_CARD.label_es}`),
    inicio: b("Main page (orders)", "Página principal (órdenes)"),
    pantallas: {
      ...PESTANAS_DE_ENTREGAS,
      "settings/usuarios-permisos": b("Settings · Users and permissions", "Ajustes · Usuarios y permisos"),
      "my-route/mapa": b("My route · Map", "Mi ruta · Mapa"),
      account: b("My account", "Mi cuenta"),
      settings: b("Settings", "Ajustes"),
      users: b("Users", "Usuarios"),
      summary: b("Summary", "Resumen"),
    },
  },
];

/** Una ruta suelta en palabras: «team-requests» → «Team requests». Un id no se traduce: se dice que es un registro. */
function enPalabras(segmento: string): string {
  if (esId(segmento)) return `#${idCorto(segmento)}`;
  const s = decodeURIComponent(segmento).replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : segmento;
}
function esId(segmento: string): boolean {
  return /^\d+$/.test(segmento) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segmento);
}
/** Un uuid entero no le dice nada a nadie: sus 8 primeros caracteres bastan para buscarlo. */
function idCorto(segmento: string): string {
  return /^\d+$/.test(segmento) ? segmento : segmento.slice(0, 8);
}

function parte(p: string): { ruta: string; consulta: URLSearchParams } {
  const limpia = (p || "/").trim().split("#")[0];
  const [ruta, ...resto] = limpia.split("?");
  const sinBarra = ruta.length > 1 ? ruta.replace(/\/+$/, "") : ruta;
  return { ruta: sinBarra || "/", consulta: new URLSearchParams(resto.join("?")) };
}

/** La app de una ruta y lo que queda detrás de su prefijo. Entregas solo se queda con SUS pantallas. */
function appDeLaRuta(ruta: string): { app: AppDelMapa; resto: string[] } | null {
  for (const app of APPS_DEL_MAPA) {
    if (app.prefijo === "") {
      const resto = ruta.split("/").filter(Boolean);
      if (resto.length === 0) return { app, resto };
      const suyas = new Set(Object.keys(app.pantallas).map((k) => k.split("/")[0]));
      return suyas.has(resto[0]) ? { app, resto } : null;
    }
    if (ruta === app.prefijo || ruta.startsWith(`${app.prefijo}/`)) {
      return { app, resto: ruta.slice(app.prefijo.length).split("/").filter(Boolean) };
    }
  }
  return null;
}

/** La pantalla de la app que casa con lo que queda de la ruta: la exacta antes que la que lleva `:id`. */
function pantallaDe(app: AppDelMapa, resto: string[]): Bilingue | null {
  if (resto.length === 0) return app.inicio ?? null;
  const exacta = app.pantallas[resto.join("/")];
  if (exacta) return exacta;
  for (const [patron, nombre] of Object.entries(app.pantallas)) {
    const trozos = patron.split("/");
    if (trozos.length !== resto.length || !trozos.includes(":id")) continue;
    if (!trozos.every((t, i) => t === ":id" || t === resto[i])) continue;
    const id = idCorto(resto[trozos.indexOf(":id")]);
    return b(`${nombre.en} ${id}`, `${nombre.es} ${id}`);
  }
  return null;
}

export type RutaConNombre = {
  /** Las partes, de la app hacia dentro: «Deliveries app», «Routes Manager». */
  partes: Bilingue[];
  /** `false` si el mapa no conocía la ruta y lo que se dice es lo que se pudo deducir de ella. */
  conocida: boolean;
};

/**
 * El nombre legible de una ruta, por partes. Vale con la ruta sola («/routes») y con parámetros
 * («/customers?solicitudes=1»): es también lo que nombra una solicitud vieja, que solo guardó `page`.
 */
export function partesDeRuta(pagina: string | null | undefined, opciones: { sinConsulta?: boolean } = {}): RutaConNombre {
  const cruda = (pagina ?? "").trim();
  if (!cruda) return { partes: [b("Unknown screen", "Pantalla desconocida")], conocida: false };
  const { ruta, consulta } = parte(cruda);
  const hallada = appDeLaRuta(ruta);
  if (!hallada) {
    // Ni la app se conoce: la ruta tal cual, que al menos se puede buscar en el código.
    return { partes: [b(`Other screen (${ruta})`, `Otra pantalla (${ruta})`)], conocida: false };
  }
  const { app, resto } = hallada;
  const partes: Bilingue[] = [app.nombre];
  const pantalla = pantallaDe(app, resto);
  let conocida = true;
  if (pantalla) partes.push(pantalla);
  else if (resto.length) {
    // La app sí, la pantalla no (una pantalla nueva que nadie apuntó aquí): sus segmentos, en palabras.
    conocida = false;
    const texto = resto.map(enPalabras).join(SEPARADOR);
    partes.push(b(texto, texto));
  }
  for (const c of opciones.sinConsulta ? [] : app.consulta ?? []) {
    const valor = consulta.get(c.parametro);
    if (valor === null || valor === "") continue;
    const cola = c.conValor ? ` ${idCorto(valor)}` : "";
    partes.push(b(`${c.nombre.en}${cola}`, `${c.nombre.es}${cola}`));
  }
  return { partes, conocida };
}

/** El nombre legible de una ruta, en una línea y en los dos idiomas. */
export function nombreDeRuta(pagina: string | null | undefined): Bilingue {
  return une(partesDeRuta(pagina).partes);
}

function une(partes: readonly Bilingue[]): Bilingue {
  return {
    en: recorta(partes.map((p) => p.en).join(SEPARADOR), LIMITE_DE_UBICACION),
    es: recorta(partes.map((p) => p.es).join(SEPARADOR), LIMITE_DE_UBICACION),
  };
}

function recorta(s: string, limite: number): string {
  const limpio = s.replace(/\s+/g, " ").trim();
  return limpio.length <= limite ? limpio : `${limpio.slice(0, limite - 1).trimEnd()}…`;
}

// ---- El contexto que publica cada pantalla ---------------------------------------------------------------------

/**
 * El registro: qué dice cada pantalla montada de sí misma, AHORA. Vive en el módulo, no en un contexto de React, porque
 * quien lo lee (la burbuja de Ayuda) cuelga del layout raíz y quien lo escribe está en cualquier app: un proveedor
 * obligaría a envolver todas. Se lee una sola vez, al mandar la solicitud; nada se repinta por él.
 *
 * El orden es el de publicación: la pantalla primero y, encima, la ficha o el diálogo que abrió.
 */
const registro = new Map<string, { partes: Bilingue[]; encima: boolean }>();

export function normaliza(partes: readonly ParteDeContexto[]): Bilingue[] {
  const limpias: Bilingue[] = [];
  for (const p of partes) {
    if (!p) continue;
    const en = recorta(typeof p === "string" ? p : p.en, LIMITE_DE_PARTE);
    const es = recorta(typeof p === "string" ? p : p.es, LIMITE_DE_PARTE);
    if (en && es) limpias.push({ en, es });
  }
  return limpias.slice(0, LIMITE_DE_PARTES);
}

/**
 * Publica (o cambia) lo que una pantalla dice de sí misma. Cambiarlo NO le quita el sitio: la pantalla que cambia de
 * pestaña con una ficha abierta encima sigue yendo delante de la ficha. `encima` es para lo que se abre SOBRE una
 * pantalla (una ficha, un diálogo): va siempre detrás de ella, aunque React lo haya montado antes.
 */
export function publicaContextoDeAyuda(id: string, partes: readonly ParteDeContexto[], opciones: { encima?: boolean } = {}): void {
  const limpias = normaliza(partes);
  if (limpias.length) registro.set(id, { partes: limpias, encima: opciones.encima === true });
  else registro.delete(id);
}

/** Retira lo que publicó una pantalla: al desmontarse, para no dejar su contexto pegado a la siguiente. */
export function retiraContextoDeAyuda(id: string): void {
  registro.delete(id);
}

/** Todo lo publicado ahora mismo: las pantallas en su orden y, detrás, lo que tienen abierto encima. */
export function contextoDeAyuda(): Bilingue[] {
  const todo = [...registro.values()];
  return [...todo.filter((c) => !c.encima), ...todo.filter((c) => c.encima)].flatMap((c) => c.partes).slice(0, LIMITE_DE_PARTES);
}

/** Solo para las pruebas: el registro es del módulo y sobrevive de una a otra. */
export function vaciaContextoDeAyuda(): void {
  registro.clear();
}


/**
 * La ubicación entera de una solicitud: ruta + contexto publicado + si está dentro de «Cambiar usuario».
 *
 * `suplantando` es el nombre de la persona en la que entró el admin (o `null`): quien lee la solicitud tiene que saber
 * que lo que se veía era la cuenta de otra persona, con sus permisos, y no la del admin.
 */
export function ubicacionDeAyuda(args: {
  pagina: string | null | undefined;
  contexto?: readonly Bilingue[];
  suplantando?: string | null;
}): Bilingue {
  // Si la pantalla publicó su contexto, manda ella: un `?solicitudes=1` que sigue en la URL con el panel ya cerrado
  // diría un panel que no está. Los parámetros solo hablan por las pantallas que no publican nada.
  const contexto = args.contexto ?? [];
  const partes = [...partesDeRuta(args.pagina, { sinConsulta: contexto.length > 0 }).partes, ...contexto];
  const como = (args.suplantando ?? "").trim();
  if (como) partes.push(b(`Change user: viewing as ${recorta(como, 60)}`, `Cambiar usuario: viendo como ${recorta(como, 60)}`));
  return une(partes);
}

// ---- El dispositivo --------------------------------------------------------------------------------------------

export type TipoDeDispositivo = "phone" | "tablet" | "desktop";
export type DispositivoDeAyuda = {
  tipo: TipoDeDispositivo;
  /** El tamaño de la ventana, en píxeles CSS: lo que la app tenía para pintarse. */
  ancho: number;
  alto: number;
  /** «Chrome 141», «Safari 18», «Desktop app (Electron 33)». */
  navegador: string;
  /** «Android», «iOS», «Windows», «macOS»… o «» si no se reconoce. */
  sistema: string;
};

function versionMayor(ua: string, re: RegExp): string {
  const m = ua.match(re);
  return m ? ` ${m[1]}` : "";
}

function navegadorDe(ua: string): string {
  // El orden importa: Edge y Opera también dicen «Chrome», y Chrome también dice «Safari».
  if (/Electron\//.test(ua)) return `Desktop app (Electron${versionMayor(ua, /Electron\/(\d+)/)})`;
  if (/Edg(e|A|iOS)?\//.test(ua)) return `Edge${versionMayor(ua, /Edg(?:e|A|iOS)?\/(\d+)/)}`;
  if (/OPR\//.test(ua)) return `Opera${versionMayor(ua, /OPR\/(\d+)/)}`;
  if (/SamsungBrowser\//.test(ua)) return `Samsung Internet${versionMayor(ua, /SamsungBrowser\/(\d+)/)}`;
  if (/Firefox\/|FxiOS\//.test(ua)) return `Firefox${versionMayor(ua, /(?:Firefox|FxiOS)\/(\d+)/)}`;
  if (/Chrome\/|CriOS\//.test(ua)) return `Chrome${versionMayor(ua, /(?:Chrome|CriOS)\/(\d+)/)}`;
  if (/Safari\//.test(ua)) return `Safari${versionMayor(ua, /Version\/(\d+)/)}`;
  return "Unknown browser";
}

function sistemaDe(ua: string): string {
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

/**
 * Qué aparato es, por lo que dice el navegador. Sin huella: tres datos que caben en una línea.
 *
 * Un iPad moderno se presenta como un Mac; se le reconoce porque es un «Mac» táctil. Una ventana estrecha de
 * computadora sigue siendo una computadora: el ancho va aparte, que es lo que explica un diseño apretado.
 */
export function dispositivoDeAyuda(e: { ua: string; ancho: number; alto: number; tactil?: boolean }): DispositivoDeAyuda {
  const ua = e.ua || "";
  const tableta = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) || (/Macintosh/.test(ua) && e.tactil === true);
  const telefono = !tableta && /Mobi|iPhone|iPod|Android/.test(ua);
  return {
    tipo: tableta ? "tablet" : telefono ? "phone" : "desktop",
    ancho: Math.round(e.ancho) || 0,
    alto: Math.round(e.alto) || 0,
    navegador: navegadorDe(ua),
    sistema: tableta && /Macintosh/.test(ua) ? "iPadOS" : sistemaDe(ua),
  };
}

/** El dispositivo de ESTE navegador, o `null` fuera de uno. */
export function dispositivoDeEsteNavegador(): DispositivoDeAyuda | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  return dispositivoDeAyuda({
    ua: navigator.userAgent, ancho: window.innerWidth, alto: window.innerHeight, tactil: (navigator.maxTouchPoints ?? 0) > 1,
  });
}

/**
 * Lo que llega del navegador (o lo que hay guardado), comprobado: la ruta guarda lo que valida, no lo que le mandan.
 * Cualquier cosa que no tenga esta forma es `null`, y la solicitud se guarda igual sin dispositivo.
 */
export function limpiaDispositivo(crudo: unknown): DispositivoDeAyuda | null {
  if (!crudo || typeof crudo !== "object") return null;
  const d = crudo as Record<string, unknown>;
  if (d.tipo !== "phone" && d.tipo !== "tablet" && d.tipo !== "desktop") return null;
  const medida = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 20000 ? Math.round(v) : 0);
  const texto = (v: unknown) => (typeof v === "string" ? recorta(v, 60) : "");
  return { tipo: d.tipo, ancho: medida(d.ancho), alto: medida(d.alto), navegador: texto(d.navegador), sistema: texto(d.sistema) };
}

/** La ubicación que llega del navegador, comprobada: texto, en una línea y con tope. Vacía es `null`. */
export function limpiaUbicacion(cruda: unknown): string | null {
  if (typeof cruda !== "string") return null;
  return recorta(cruda, LIMITE_DE_UBICACION) || null;
}

const TIPOS: Record<TipoDeDispositivo, Bilingue> = {
  phone: b("Phone", "Teléfono"),
  tablet: b("Tablet", "Tableta"),
  desktop: b("Desktop", "Computadora"),
};

/** «Phone · 390×844 · Chrome 141 · Android». `null` si no hay dispositivo guardado (las solicitudes viejas). */
export function textoDelDispositivo(crudo: unknown, lang: "en" | "es"): string | null {
  const d = limpiaDispositivo(crudo);
  if (!d) return null;
  return [TIPOS[d.tipo][lang], d.ancho && d.alto ? `${d.ancho}×${d.alto}` : "", d.navegador, d.sistema].filter(Boolean).join(SEPARADOR);
}

// ---- Leerla de una solicitud guardada --------------------------------------------------------------------------

export type UbicacionDeSolicitud = {
  texto: string;
  /** `true` si la guardó la app al mandarla; `false` si se dedujo ahora de `page` (una solicitud de antes de la 258). */
  guardada: boolean;
};

/**
 * Dónde estaba quien escribió una solicitud, en el idioma de quien la lee. Una solicitud de antes de esta función solo
 * tiene `page`: se nombra con el mapa, que es menos (sin pestaña ni ficha abierta) pero ya no es una ruta cruda. Sin
 * `page` siquiera, `null`.
 */
export function ubicacionDeSolicitud(
  s: { page?: string | null; location_en?: string | null; location_es?: string | null },
  lang: "en" | "es",
): UbicacionDeSolicitud | null {
  const guardada = (lang === "es" ? s.location_es : s.location_en)?.trim() || s.location_en?.trim() || s.location_es?.trim();
  if (guardada) return { texto: guardada, guardada: true };
  if (!s.page?.trim()) return null;
  return { texto: nombreDeRuta(s.page)[lang], guardada: false };
}
