import {
  demoAudio,
  demoExtensiones,
  demoGuardarChoferes,
  demoLlamadas,
  demoSincronizar,
} from "./demo";

// ============================================================
// Lo que habla la pantalla de RingCentral de los choferes con el servidor. En el modo demo (`NEXT_PUBLIC_LOCAL_MODE`)
// no sale nada: todo lo responde `demo.ts`, con datos inventados. Los tipos son los de las rutas /api/ringcentral/*.
// ============================================================

export const MODO_LOCAL = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export interface FilaDeLlamada {
  id: string;
  extensionId: string;
  driverNumero: string;
  driverNombre: string;
  direction: "in" | "out";
  started_at: string;
  duration_s: number | null;
  from_number: string | null;
  from_name: string | null;
  to_number: string | null;
  to_name: string | null;
  result: string | null;
  hasRecording: boolean;
  recording_pending: boolean;
}

export interface ChoferDeLaLista {
  id: string;
  numero: string;
  nombre: string;
}

export interface EstadoDeLaSincronizacion {
  ultimaSincronizacion: string | null;
  sinPermiso: boolean;
  esperaSeg: number;
}

export interface RespuestaDeLlamadas {
  rows: FilaDeLlamada[];
  pagina: number;
  tamano: number;
  total: number;
  hayMas: boolean;
  choferes: ChoferDeLaLista[];
  estado: EstadoDeLaSincronizacion;
}

export interface FiltrosDeLaLista {
  extension: string;
  /** Instantes ISO (el inicio del primer día, en la hora del navegador). */
  desde: string;
  /** Instantes ISO (el fin del último día, en la hora del navegador). */
  hasta: string;
  direccion: "" | "in" | "out";
  conGrabacion: boolean;
}

export interface ExtensionDeLaLista extends ChoferDeLaLista {
  esChofer: boolean;
}

export interface ResultadoDeSincronizar {
  ok: boolean;
  motivo?: string;
  llamadas?: number;
  grabaciones?: number;
  pendientes?: number;
  esperaSeg?: number;
}

/** El inicio del día `AAAA-MM-DD` en la hora del navegador, como instante ISO. */
export function inicioDelDia(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** El fin del día `AAAA-MM-DD` en la hora del navegador, como instante ISO. */
export function finDelDia(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/** `AAAA-MM-DD` de hoy, o de hace `dias` días, en la hora del navegador. */
export function fechaLocal(dias = 0): string {
  const f = new Date();
  f.setDate(f.getDate() - dias);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`;
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(ruta, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function cargarLlamadas(f: FiltrosDeLaLista, pagina: number): Promise<RespuestaDeLlamadas> {
  if (MODO_LOCAL) return demoLlamadas(f, pagina);
  const q = new URLSearchParams({ pagina: String(pagina), tamano: "100", desde: f.desde, hasta: f.hasta });
  if (f.extension) q.set("extension", f.extension);
  if (f.direccion) q.set("direccion", f.direccion);
  if (f.conGrabacion) q.set("grabacion", "1");
  return pedir<RespuestaDeLlamadas>(`/api/ringcentral/llamadas?${q}`);
}

export async function cargarExtensiones(): Promise<ExtensionDeLaLista[]> {
  if (MODO_LOCAL) return demoExtensiones();
  return (await pedir<{ extensiones: ExtensionDeLaLista[] }>("/api/ringcentral/extensiones")).extensiones;
}

export async function guardarChoferes(lista: ChoferDeLaLista[]): Promise<void> {
  if (MODO_LOCAL) {
    demoGuardarChoferes(lista);
    return;
  }
  const r = await fetch("/api/ringcentral/choferes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choferes: lista }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export async function urlDeGrabacion(id: string): Promise<string> {
  if (MODO_LOCAL) {
    const audio = demoAudio(id);
    if (!audio) throw new Error("sin grabacion");
    return audio;
  }
  return (await pedir<{ url: string }>(`/api/ringcentral/grabacion?id=${encodeURIComponent(id)}`)).url;
}

export async function sincronizarAhora(): Promise<ResultadoDeSincronizar> {
  if (MODO_LOCAL) return { ...demoSincronizar() };
  const r = await fetch("/api/ringcentral/sincronizar", { method: "POST" });
  const j = (await r.json().catch(() => ({}))) as ResultadoDeSincronizar & { esperaSeg?: number };
  if (r.status === 429) return { ok: false, motivo: "espera", esperaSeg: Number(j.esperaSeg) || 0 };
  if (!r.ok && !j.motivo) return { ok: false, motivo: "base" };
  return j;
}
