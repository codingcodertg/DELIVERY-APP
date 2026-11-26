// El demo (`NEXT_PUBLIC_LOCAL_MODE`): sin base, las fallas viven en memoria del servidor del demo. Trae unas cuantas de
// muestra para que la pantalla «Fallas de la app» se vea con datos, y las que caigan con el botón de prueba.
// Es memoria de proceso: se pierde al reiniciar, y no sale de esta máquina.

import type { FallaNormalizada } from "./reglas";
import type { FilaDeFalla } from "./agrupa";

const AHORA = Date.now();
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();

const USUARIO_DEMO_A = "00000000-0000-4000-8000-00000000000a";
const USUARIO_DEMO_B = "00000000-0000-4000-8000-00000000000b";

function muestra(p: Partial<FilaDeFalla> & Pick<FilaDeFalla, "huella" | "origen" | "app" | "ruta" | "mensaje">): FilaDeFalla {
  return {
    id: `demo-${Math.random().toString(36).slice(2, 10)}`,
    created_at: hace(30),
    pila: null,
    componente: null,
    user_id: USUARIO_DEMO_A,
    rol: "admin",
    version: null,
    navegador: "Chrome 131 · Windows",
    escritorio: false,
    veces: 1,
    ultima_vez: hace(30),
    usuarios: [],
    ...p,
  };
}

const SEMILLA: FilaDeFalla[] = [
  muestra({
    huella: "demo-cliente-1",
    origen: "cliente",
    app: "timetracker",
    ruta: "/timetracker/clock-in",
    mensaje: "Cannot read properties of undefined (reading 'latitude')",
    pila: "TypeError: Cannot read properties of undefined (reading 'latitude')\n    at ubicacionDelFichaje (timetracker/clock-in/ficha.tsx:88:31)\n    at onClick (timetracker/clock-in/ficha.tsx:120:9)",
    componente: "ficha-de-entrada",
    veces: 14,
    ultima_vez: hace(6),
    created_at: hace(190),
    usuarios: [USUARIO_DEMO_B],
    escritorio: true,
    navegador: "Electron 33 · Windows",
    version: "1.45.2",
  }),
  muestra({
    huella: "demo-api-1",
    origen: "api",
    app: "deliveries",
    ruta: "/api/route-plan",
    mensaje: "Timeout al consultar el motor de rutas",
    pila: "Error: Timeout al consultar el motor de rutas\n    at planear (api/route-plan/route.ts:212:11)",
    veces: 3,
    ultima_vez: hace(55),
    created_at: hace(300),
    version: "1.667.1",
    usuarios: [USUARIO_DEMO_A],
  }),
  muestra({
    huella: "demo-cron-1",
    origen: "cron",
    app: "hub",
    ruta: "/api/cron/rc-comms",
    mensaje: "RingCentral respondió 503",
    pila: "Error: RingCentral respondió 503\n    at leerMensajes (api/cron/rc-comms/route.ts:44:9)",
    veces: 2,
    ultima_vez: hace(12),
    created_at: hace(720),
    user_id: null,
    rol: null,
    version: "0.115.1",
  }),
  muestra({
    huella: "demo-accion-1",
    origen: "accion",
    app: "deliveries",
    ruta: "/",
    mensaje: "No se pudo guardar: duplicate key value violates unique constraint",
    componente: "order_events",
    veces: 1,
    ultima_vez: hace(200),
    created_at: hace(200),
    version: "1.667.1",
  }),
  muestra({
    huella: "demo-cliente-2",
    origen: "cliente",
    app: "leads",
    ruta: "/leads/pool",
    mensaje: "ChunkLoadError: Loading chunk 412 failed",
    pila: "ChunkLoadError: Loading chunk 412 failed\n    at l (_next/static/chunks/leads.js:1:2041)",
    veces: 5,
    ultima_vez: hace(90),
    created_at: hace(1500),
    usuarios: [USUARIO_DEMO_B],
    version: "0.39.0",
  }),
];

let almacen: FilaDeFalla[] = [...SEMILLA];

/** Lo que hay en el demo, más reciente primero. Una copia: quien la lee no la toca. */
export function leerFallasDemo(): FilaDeFalla[] {
  return almacen.map((f) => ({ ...f, usuarios: f.usuarios ? [...f.usuarios] : [] }));
}

/** Añade una falla al demo, o cuenta una más si la misma huella ya tiene fila de hoy (igual que la base). */
export function anadirFallaDemo(falla: FallaNormalizada, usuario: { id: string } | null): void {
  const hoy = new Date().toISOString().slice(0, 10);
  const igual = almacen.find((f) => f.huella === falla.huella && f.created_at.slice(0, 10) === hoy);
  if (igual) {
    igual.veces += 1;
    igual.ultima_vez = new Date().toISOString();
    if (usuario && !igual.usuarios?.includes(usuario.id)) igual.usuarios = [...(igual.usuarios ?? []), usuario.id];
    return;
  }
  const ahora = new Date().toISOString();
  almacen = [
    {
      id: `demo-${Math.random().toString(36).slice(2, 10)}`,
      created_at: ahora,
      origen: falla.origen,
      app: falla.app,
      ruta: falla.ruta,
      mensaje: falla.mensaje,
      pila: falla.pila || null,
      componente: falla.componente,
      user_id: usuario?.id ?? null,
      rol: usuario ? "admin" : null,
      version: falla.version,
      navegador: falla.navegador,
      escritorio: falla.escritorio,
      huella: falla.huella,
      veces: 1,
      ultima_vez: ahora,
      usuarios: usuario ? [usuario.id] : [],
    },
    ...almacen,
  ];
}
