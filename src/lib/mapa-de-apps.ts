/**
 * El mapa de apps del hub (D-554), al estilo de la «Home Page» de QuickBooks.
 *
 * El dueño, 2026-10-14: «quiero que hagamos esto asi como quickbooks, esto es lo que mi jefe me mnado un workflow con
 * todo todas las apps y como se van conectacnto obvio mientras no se conected no creas algo falso  y las apps que estan
 * ahi quedan en gris porqeu aun no se crean pero ahi estaran y estaremos formando eso».
 *
 * La fuente es la diapositiva 2 de «RTG DASH.pptx» (el diagrama del jefe). Las posiciones (`fila`, `columna`) salen de
 * las coordenadas de sus formas: en Proveedores y Clientes las casillas de la misma columna están una encima de otra en
 * la diapositiva (Purchase Orders ≈ Sales Order ≈ Quote Builder, x ≈ 4,8 pulgadas), y eso es lo que deja dibujar la
 * flecha que cruza de un panel al otro.
 *
 * Aquí vive TODO lo que decide; el componente (`HomeSelector`) solo pinta:
 *   - qué casillas hay y cuáles existen (`existe`: el jefe las dibujó oscuras = ya hay app);
 *   - qué flechas hay y cuáles están conectadas de verdad (`conectada`), con su prueba (`evidencia`);
 *   - si una casilla se abre, se ve con candado o es «Próximamente», con las MISMAS listas que pintaba el hub
 *     antes (`accessibleModules` + `HUB_TOOLS` visibles): el mapa no amplía el acceso de nadie;
 *   - qué apps de las de antes no salen en el mapa y van a «Otras apps».
 */
import { accessibleModules, HUB_TOOLS, roleHome, type HubTool, type ModuleInfo } from "@/lib/constants";
import { canSeeCost, erpTier } from "@/lib/erp/domain/roles";
import type { UserRole } from "@/lib/types";

/** Dónde vive el mapa (D-556): su propia página del hub, con una tarjeta en el inicio que lleva a ella. */
export const RUTA_MAPA_DE_LA_EMPRESA = "/home/mapa";

/**
 * ¿Ve el mapa de la empresa? Solo el admin (D-561). El dueño, 2026-10-15: «map app of the schema is just for admin
 * remove it for everybody else». Se mira el rol de la sesión que se pinta: el admin que «ve como» otro ve lo que ve ese.
 */
export function veElMapa(me: { role: UserRole } | null | undefined): boolean {
  return me?.role === "admin";
}

export type PanelKey = "vendors" | "customers" | "employees";

export interface Panel {
  key: PanelKey;
  label_en: string;
  label_es: string;
  /** La fila que manda en el teléfono: la del flujo principal, que se lee de arriba abajo con chevrones. */
  filaPrincipal: number;
  /** Lo que abre el TÍTULO del panel (D-645), con la misma regla que una casilla. Sin él, el título solo rotula. */
  destino?: Destino;
}

export const PANELES: Panel[] = [
  { key: "vendors", label_en: "Vendors", label_es: "Proveedores", filaPrincipal: 1 },
  // El título «Clientes» abre la app de Clientes (D-645): el dueño, 2026-10-22, «make it redirect to the customer app just
  // like the customer app on the bottom of the map». La de abajo («Otras apps») se queda.
  { key: "customers", label_en: "Customers", label_es: "Clientes", filaPrincipal: 2, destino: { tipo: "modulo", clave: "customers" } },
  { key: "employees", label_en: "Employees", label_es: "Empleados", filaPrincipal: 1 },
];

/** Columnas de casilla de Proveedores y Clientes. Entre cada dos hay una columna estrecha para la flecha. */
export const COLUMNAS = 6;

/** A dónde lleva una casilla que existe: un módulo (se concede en `module_access`) o una herramienta del hub (va con el
 *  rol). En la herramienta, la primera visible gana: «Help Requests» es la bandeja de todos para el admin y «Mis
 *  solicitudes» para los demás. */
export type Destino =
  | {
      tipo: "modulo"; clave: string; ruta?: string;
      /** D-558: además del módulo, el nivel de COMPRAS del ERP (manager/admin en `erp_role`), que es lo que exigen
       *  `/erp/purchasing/orders` y `/erp/purchasing/receiving` (`canSeeCost`, o mandan al catálogo). */
      requiere?: "compras-erp";
    }
  | { tipo: "herramienta"; claves: string[] };

export interface Casilla {
  key: string;
  panel: PanelKey;
  fila: number;
  columna: number;
  emoji: string;
  label_en: string;
  label_es: string;
  /** La app ya existe (el jefe la dibujó oscura; D-558 añadió Purchase Orders y Receive Inventory, que el ERP ya tenía).
   *  Gris = aún no se crea, y entonces NO lleva destino. */
  existe: boolean;
  destino?: Destino;
}

export const CASILLAS: Casilla[] = [
  // ---- Proveedores: fila 1, de izquierda a derecha, con flechas entre cada dos; Inventario ERP debajo de Entregas.
  // Purchase Orders y Receive Inventory: grises en el diagrama del jefe, de color desde D-558 («si a todo», 2026-10-15)
  // porque el ERP ya las tiene. Abren SUS pantallas del ERP, con la misma regla que ellas: módulo erp y nivel de compras.
  { key: "purchase-orders", panel: "vendors", fila: 1, columna: 2, emoji: "📝", label_en: "Purchase Orders", label_es: "Órdenes de compra", existe: true, destino: { tipo: "modulo", clave: "erp", ruta: "/erp/purchasing/orders", requiere: "compras-erp" } },
  { key: "deliveries", panel: "vendors", fila: 1, columna: 3, emoji: "📦", label_en: "Deliveries", label_es: "Entregas", existe: true, destino: { tipo: "modulo", clave: "deliveries" } },
  { key: "receive-inventory", panel: "vendors", fila: 1, columna: 4, emoji: "📥", label_en: "Receive Inventory", label_es: "Recibir inventario", existe: true, destino: { tipo: "modulo", clave: "erp", ruta: "/erp/purchasing/receiving", requiere: "compras-erp" } },
  { key: "enter-bills", panel: "vendors", fila: 1, columna: 5, emoji: "📑", label_en: "Enter Bills", label_es: "Registrar facturas", existe: false },
  { key: "pay-bills", panel: "vendors", fila: 1, columna: 6, emoji: "💸", label_en: "Pay Bills", label_es: "Pagar facturas", existe: false },
  // Abre el CATÁLOGO, como la tarjeta del hub y /erp (D-644): el dueño, «en inventory catalog is default view». Con
  // /erp/inventory, el admin y el gerente caían en la pestaña de conteos. Y se llama «Inventario», como la app (D-622).
  { key: "erp-inventory", panel: "vendors", fila: 2, columna: 3, emoji: "🧱", label_en: "Inventory", label_es: "Inventario", existe: true, destino: { tipo: "modulo", clave: "erp", ruta: "/erp/catalog" } },
  // ---- Clientes: Sales Order encima de Quote Builder; Refunds & Credits arriba a la derecha; fila 2, el flujo de venta.
  { key: "sales-order", panel: "customers", fila: 1, columna: 2, emoji: "🗒️", label_en: "Sales Order", label_es: "Orden de venta", existe: false },
  { key: "refunds-credits", panel: "customers", fila: 1, columna: 6, emoji: "↩️", label_en: "Refunds & Credits", label_es: "Reembolsos y créditos", existe: false },
  { key: "leads", panel: "customers", fila: 2, columna: 1, emoji: "🎯", label_en: "Leads", label_es: "Leads", existe: true, destino: { tipo: "modulo", clave: "leads" } },
  // «Quote Builder» en los dos idiomas (D-448).
  { key: "quote-builder", panel: "customers", fila: 2, columna: 2, emoji: "🧮", label_en: "Quote Builder", label_es: "Quote Builder", existe: true, destino: { tipo: "modulo", clave: "estimator" } },
  { key: "create-invoice", panel: "customers", fila: 2, columna: 3, emoji: "🧾", label_en: "Create Invoice", label_es: "Crear factura", existe: false },
  { key: "receive-payments", panel: "customers", fila: 2, columna: 4, emoji: "💵", label_en: "Receive Payments", label_es: "Recibir pagos", existe: false },
  { key: "record-deposits", panel: "customers", fila: 2, columna: 5, emoji: "🏦", label_en: "Record Deposits", label_es: "Registrar depósitos", existe: false },
  // ---- Empleados: todas existen, sin flechas.
  { key: "users", panel: "employees", fila: 1, columna: 1, emoji: "🛡", label_en: "Users", label_es: "Usuarios", existe: true, destino: { tipo: "herramienta", claves: ["users"] } },
  { key: "hr", panel: "employees", fila: 1, columna: 2, emoji: "🧑‍💼", label_en: "HR Mgmt", label_es: "Gestión de RR. HH.", existe: true, destino: { tipo: "modulo", clave: "recruiting" } },
  { key: "time-tracker", panel: "employees", fila: 1, columna: 3, emoji: "⏱️", label_en: "Time Tracker", label_es: "Control de Horas", existe: true, destino: { tipo: "modulo", clave: "timetracker" } },
  { key: "surveys", panel: "employees", fila: 1, columna: 4, emoji: "📋", label_en: "Surveys", label_es: "Encuestas", existe: true, destino: { tipo: "modulo", clave: "surveys" } },
  { key: "help-requests", panel: "employees", fila: 1, columna: 5, emoji: "🆘", label_en: "Help Requests", label_es: "Solicitudes de ayuda", existe: true, destino: { tipo: "herramienta", claves: ["help-requests", "my-help"] } },
  { key: "tutorials", panel: "employees", fila: 1, columna: 6, emoji: "🎬", label_en: "Tutorials", label_es: "Tutoriales", existe: true, destino: { tipo: "herramienta", claves: ["tutorials"] } },
  { key: "phone-book", panel: "employees", fila: 1, columna: 7, emoji: "📇", label_en: "Company Phone Book", label_es: "Directorio de la compañía", existe: true, destino: { tipo: "herramienta", claves: ["directory"] } },
];

export interface Flecha {
  de: string;
  a: string;
  /** Sale en el código HOY: un registro de `de` llega a `a` sin volver a teclearlo. Si no, se dibuja «por conectar». */
  conectada: boolean;
  /** Dónde se comprobó (`fichero:línea`) o «no existe», con la fecha. */
  evidencia: string;
  /** D-558: lo que a una conexión ya hecha aún le falta fuera del código (una migración sin aplicar). Se dice en la
   *  etiqueta de la flecha; se borra cuando deja de faltar. */
  pendiente?: string;
  /** Solo para la que cruza de un panel a otro: dónde se dibuja. Las demás se colocan solas entre sus dos casillas. */
  cruce?: { panel: PanelKey; gridRow: string; gridColumn: string; direccion: Direccion };
}

const NO_CONSTRUIDA = "no existe (2026-10-14): una de sus dos casillas aún no está construida";

export const FLECHAS: Flecha[] = [
  // ---- Proveedores, fila 1 (formas 46-49 de la diapositiva).
  {
    // D-558: Purchase Orders ya es una casilla de color (abre las órdenes de compra del ERP), pero la flecha sigue sin
    // existir: una orden de compra no crea una entrega. Re-medido el 2026-10-15 con el mismo grep.
    de: "purchase-orders", a: "deliveries", conectada: false,
    evidencia: "no existe (2026-10-15), aunque las dos casillas ya abren algo: Purchase Orders son las órdenes de compra " +
      "del ERP (erp.purchase_orders, supabase/migrations/063_erp_module.sql:370; src/app/erp/purchasing/orders), y nada las " +
      "une a una orden de Entregas: ningún fichero de src/app/erp, src/lib/erp ni src/components/erp lee public.deliveries, " +
      "y ninguna pantalla de Entregas lee el esquema erp (grep `from(\"deliveries\")` y `schema(\"erp\")`).",
  },
  {
    de: "deliveries", a: "receive-inventory", conectada: false,
    evidencia: "no existe (2026-10-15), aunque las dos casillas ya abren algo: Receive Inventory es la recepción del ERP " +
      "(src/app/erp/purchasing/receiving, motivo 'receive' en 063_erp_module.sql:45), que recibe contra una orden de compra " +
      "(`?po=`) y no la alimenta ninguna entrega.",
  },
  { de: "receive-inventory", a: "enter-bills", conectada: false, evidencia: `${NO_CONSTRUIDA} (Enter Bills).` },
  { de: "enter-bills", a: "pay-bills", conectada: false, evidencia: `${NO_CONSTRUIDA} (las dos).` },
  // ---- La que cruza (forma 50, girada 270°: apunta hacia ARRIBA, de Sales Order a Purchase Orders, como en QuickBooks).
  {
    de: "sales-order", a: "purchase-orders", conectada: false,
    evidencia: `${NO_CONSTRUIDA} (Sales Order).`,
    cruce: { panel: "vendors", gridRow: "2 / 4", gridColumn: "3", direccion: "arriba" },
  },
  // ---- Clientes.
  {
    // Forma 51, girada 270°: de Quote Builder hacia arriba, a Sales Order.
    de: "quote-builder", a: "sales-order", conectada: false,
    evidencia: `${NO_CONSTRUIDA} (Sales Order). Una cotización (public.estimator_quotes, 148_estimator.sql:68) no se ` +
      "convierte en nada: el estimador no inserta en public.deliveries ni en otra tabla de órdenes (solo reutiliza la " +
      "calculadora de tarifa de Entregas, src/app/estimator/EntregaCotizacion.tsx:20).",
  },
  {
    // D-558, la primera conexión («si a todo», 2026-10-15). Antes: «no existe (2026-10-14)… estimator_quotes no tiene
    // columna de lead (148_estimator.sql:68-93); Leads.tsx no enlaza a /estimator». Cada `fichero:línea (texto)` de
    // abajo lo comprueba una prueba: si el código se mueve, la prueba cae y la evidencia se reescribe.
    de: "leads", a: "quote-builder", conectada: true,
    evidencia: "conectada (2026-10-15): el botón de la tarjeta del lead, src/app/leads/Leads.tsx:543 «data-crear-cotizacion», " +
      "solo para quien puede, src/lib/leads/cotizar.ts:34 «export function puedeCotizarLead»; el Quote Builder lee el lead " +
      "y rellena el borrador, src/app/estimator/Estimador.tsx:402 «borradorDesdeLead(que.lead»; la cotización nueva guarda " +
      "su lead, src/lib/estimator/almacen.ts:226 «export function filaNueva», en la columna " +
      "supabase/migrations/175_cotizacion_de_lead.sql:32 «add column if not exists lead_id»; la cotización dice de qué lead " +
      "sale, src/app/estimator/Estimador.tsx:576 «data-de-lead=», y el lead cuenta sus cotizaciones, " +
      "src/app/leads/Leads.tsx:522 «data-cotizaciones=».",
    pendiente: "el enlace guardado (cotización ↔ lead) espera la migración 175; hasta entonces se rellena y se guarda sin enlace",
  },
  { de: "quote-builder", a: "create-invoice", conectada: false, evidencia: `${NO_CONSTRUIDA} (Create Invoice).` },
  { de: "create-invoice", a: "receive-payments", conectada: false, evidencia: `${NO_CONSTRUIDA} (las dos).` },
  { de: "receive-payments", a: "record-deposits", conectada: false, evidencia: `${NO_CONSTRUIDA} (las dos).` },
];

export const casilla = (key: string): Casilla => {
  const c = CASILLAS.find((x) => x.key === key);
  if (!c) throw new Error(`mapa-de-apps: no hay casilla «${key}»`);
  return c;
};

/** Cómo se dibuja una flecha: continua solo si está conectada Y sus dos casillas existen. Una conexión con una app que
 *  no existe no puede ser verdad, aunque alguien marque `conectada` por error. */
export function trazoDe(f: Flecha): "conectada" | "por-conectar" {
  return f.conectada && casilla(f.de).existe && casilla(f.a).existe ? "conectada" : "por-conectar";
}

export type Direccion = "derecha" | "izquierda" | "arriba" | "abajo";
export interface Colocacion { panel: PanelKey; gridRow: string; gridColumn: string; direccion: Direccion }

/**
 * Dónde va la flecha en la rejilla del escritorio. Casilla en (fila f, columna c) → celda (2f−1, 2c−1); las celdas pares
 * son el hueco de las flechas. Entre dos casillas contiguas de la misma fila, la flecha va en la columna par de en medio;
 * entre dos de la misma columna, en la fila par de en medio. La que cruza paneles trae su sitio escrito (`cruce`).
 */
export function colocacion(f: Flecha): Colocacion {
  if (f.cruce) return f.cruce;
  const de = casilla(f.de);
  const a = casilla(f.a);
  if (de.panel !== a.panel) throw new Error(`mapa-de-apps: ${f.de}→${f.a} cruza paneles sin «cruce»`);
  if (de.fila === a.fila && Math.abs(de.columna - a.columna) === 1) {
    return {
      panel: de.panel,
      gridRow: String(2 * de.fila - 1),
      gridColumn: String(2 * Math.min(de.columna, a.columna)),
      direccion: de.columna < a.columna ? "derecha" : "izquierda",
    };
  }
  if (de.columna === a.columna && Math.abs(de.fila - a.fila) === 1) {
    return {
      panel: de.panel,
      gridRow: String(2 * Math.min(de.fila, a.fila)),
      gridColumn: String(2 * de.columna - 1),
      direccion: de.fila < a.fila ? "abajo" : "arriba",
    };
  }
  throw new Error(`mapa-de-apps: ${f.de}→${f.a} no son casillas contiguas`);
}

/** La celda de una casilla en la rejilla del escritorio. */
export const celdaDe = (c: Casilla): { gridRow: string; gridColumn: string } => ({
  gridRow: String(2 * c.fila - 1),
  gridColumn: String(2 * c.columna - 1),
});

// ---- Acceso -----------------------------------------------------------------------------------------------------

/** Lo que el hub ya pintaba para esta persona: sus módulos (`accessibleModules`) y sus herramientas visibles. El mapa
 *  decide con ESTAS listas, así que no abre nada que el hub de antes no abriera. */
export interface Alcance {
  role: UserRole; modulos: ModuleInfo[]; herramientas: HubTool[];
  /** D-558: si pasa la puerta de compras del ERP (`veComprasDe`). Sin el dato, NO: falla cerrado. */
  veCompras?: boolean;
}

/**
 * ¿Pasa la puerta de `/erp/purchasing/orders` y `/erp/purchasing/receiving`? Esas páginas hacen
 * `canSeeCost(session.role)` con `session.role = erpTier(perfil)` (`src/lib/erp/auth.ts`) y, si no, mandan al catálogo.
 * Es la misma cuenta, con las mismas dos funciones: el nivel del ERP (`erp_role`), NO el rol del hub. Un admin del hub
 * con `erp_role` vacío es `staff` para el ERP, y la página lo rebota: aquí sale con candado.
 */
export function veComprasDe(me: { erp_role?: string | null }): boolean {
  return canSeeCost(erpTier(me));
}

export function alcanceDe(me: { role: UserRole; module_access?: string[] | null; suplantando?: boolean; erp_role?: string | null }): Alcance {
  return {
    role: me.role,
    modulos: accessibleModules(me.module_access),
    herramientas: HUB_TOOLS.filter((t) => t.visible(me)),
    veCompras: veComprasDe(me),
  };
}

/** Qué entrada del hub de antes consume una casilla: `modulo:erp`, `herramienta:users`… */
export type Llave = string;

export type EstadoCasilla =
  | { estado: "proximamente" }
  /** `motivo: "nivel-erp"` (D-558): tiene el módulo erp, pero no el nivel de compras que exige la página. */
  | { estado: "sin-acceso"; motivo?: "nivel-erp" }
  | { estado: "abierta"; href: string; llave: Llave; herramienta?: string };

export function estadoDeCasilla(c: Casilla, al: Alcance): EstadoCasilla {
  if (!c.existe || !c.destino) return { estado: "proximamente" };
  const d = c.destino;
  if (d.tipo === "modulo") {
    const m = al.modulos.find((x) => x.key === d.clave);
    if (!m) return { estado: "sin-acceso" };
    if (d.requiere === "compras-erp" && al.veCompras !== true) return { estado: "sin-acceso", motivo: "nivel-erp" };
    // Entregas aterriza donde trabaja cada rol (almacén → su cola, logística → rutas), como la tarjeta de antes.
    const href = m.key === "deliveries" ? roleHome(al.role) : d.ruta ?? m.href;
    return { estado: "abierta", href, llave: `modulo:${m.key}` };
  }
  const t = d.claves.map((k) => al.herramientas.find((x) => x.key === k)).find((x) => x !== undefined);
  if (!t) return { estado: "sin-acceso" };
  return { estado: "abierta", href: t.href, llave: `herramienta:${t.key}`, herramienta: t.key };
}

/** Lo que abre el título de un panel: la regla de `estadoDeCasilla`, con su `destino`. Sin destino, nada. */
export function estadoDelPanel(p: Panel, al: Alcance): EstadoCasilla | null {
  if (!p.destino) return null;
  return estadoDeCasilla({ key: p.key, panel: p.key, fila: 0, columna: 0, emoji: "", label_en: p.label_en, label_es: p.label_es, existe: true, destino: p.destino }, al);
}

export interface OtraApp { llave: Llave; key: string; href: string; emoji: string; label_en: string; label_es: string }

/** Lo que el hub de antes ofrecía y ninguna casilla abre (RTG PROMOS, la vista móvil, «Mis solicitudes» del admin…):
 *  va en la fila «Otras apps» debajo del mapa, para que nada que se alcanzaba deje de alcanzarse. */
export function otrasApps(al: Alcance): OtraApp[] {
  const usadas = new Set(
    CASILLAS.map((c) => estadoDeCasilla(c, al)).flatMap((e) => (e.estado === "abierta" ? [e.llave] : [])),
  );
  const modulos: OtraApp[] = al.modulos
    .filter((m) => !usadas.has(`modulo:${m.key}`))
    .map((m) => ({ llave: `modulo:${m.key}`, key: m.key, href: m.key === "deliveries" ? roleHome(al.role) : m.href, emoji: m.emoji, label_en: m.label_en, label_es: m.label_es }));
  const herramientas: OtraApp[] = al.herramientas
    .filter((t) => !usadas.has(`herramienta:${t.key}`))
    .map((t) => ({ llave: `herramienta:${t.key}`, key: t.key, href: t.href, emoji: t.emoji, label_en: t.label_en, label_es: t.label_es }));
  return [...modulos, ...herramientas];
}

// ---- Teléfono ---------------------------------------------------------------------------------------------------

export interface PasoMovil {
  casilla: Casilla;
  /** La flecha a la casilla siguiente de la lista, si la hay: se pinta como chevrón hacia abajo. */
  siguiente: Flecha | null;
  /** Las demás flechas que salen de aquí (a otra fila u otro panel): se dicen en una línea, «→ Sales Order». */
  otras: Flecha[];
}

/** El panel como lista para el teléfono: primero la fila principal, de izquierda a derecha, luego las demás. Cada
 *  flecha sale una sola vez: como chevrón si une dos pasos seguidos, o en la línea de su casilla de origen. */
export function secuenciaMovil(panel: PanelKey): PasoMovil[] {
  const principal = PANELES.find((p) => p.key === panel)!.filaPrincipal;
  const lista = CASILLAS.filter((c) => c.panel === panel).sort(
    (x, y) => (x.fila === principal ? 0 : 1) - (y.fila === principal ? 0 : 1) || x.fila - y.fila || x.columna - y.columna,
  );
  return lista.map((c, i) => {
    const sig = lista[i + 1];
    const siguiente = sig ? FLECHAS.find((f) => f.de === c.key && f.a === sig.key) ?? null : null;
    const otras = FLECHAS.filter((f) => f.de === c.key && f !== siguiente);
    return { casilla: c, siguiente, otras };
  });
}
