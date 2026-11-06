/**
 * Operaciones de almacén: borradores de reporte (pedido 4a1123bb). «Guardar borrador» los deja en el navegador de quien
 * llena, por usuario (clave con su id), y se reabren desde el inicio. Van en localStorage y no en la base: son de una
 * persona, a medio llenar, con fotos en `data:` que aún no se suben; la base solo recibe reportes completos.
 */
import type { TipoDeReporte } from "./tipos";
import { esTipo } from "./tipos";
import type { Respuestas } from "./pasos";

export interface Borrador {
  id: string;
  tipo: TipoDeReporte;
  r: Respuestas;
  paso: number;
  tienda: string;
  guardado: string; // ISO
}

/** Lo mínimo de Storage que se usa (para probar sin navegador). */
export interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const MAX_BORRADORES = 20;
export const clave = (uid: string) => `ops-borradores:${uid}`;

function almacenDelNavegador(): Almacen | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

export function listarBorradores(uid: string, a: Almacen | null = almacenDelNavegador()): Borrador[] {
  if (!a) return [];
  try {
    const x = JSON.parse(a.getItem(clave(uid)) ?? "[]");
    if (!Array.isArray(x)) return [];
    return x.filter((b): b is Borrador => !!b && typeof b.id === "string" && esTipo(b.tipo) && !!b.r && typeof b.r === "object")
      .sort((p, q) => q.guardado.localeCompare(p.guardado));
  } catch { return []; }
}

export function leerBorrador(uid: string, id: string, a: Almacen | null = almacenDelNavegador()): Borrador | null {
  return listarBorradores(uid, a).find((b) => b.id === id) ?? null;
}

function escribe(uid: string, lista: Borrador[], a: Almacen): void {
  if (lista.length === 0) a.removeItem(clave(uid));
  else a.setItem(clave(uid), JSON.stringify(lista));
}

/**
 * Guarda (o reemplaza) un borrador. Si no cabe (las fotos pesan), lo guarda sin fotos y lo dice.
 * Devuelve "ok", "sin-fotos" o "error".
 */
export function guardarBorrador(uid: string, b: Borrador, a: Almacen | null = almacenDelNavegador()): "ok" | "sin-fotos" | "error" {
  if (!a) return "error";
  const otros = listarBorradores(uid, a).filter((x) => x.id !== b.id);
  const lista = [b, ...otros].slice(0, MAX_BORRADORES);
  try { escribe(uid, lista, a); return "ok"; } catch { /* lleno */ }
  try {
    const { photo: _fuera, ...sinFotos } = b.r;
    void _fuera;
    escribe(uid, [{ ...b, r: sinFotos }, ...otros].slice(0, MAX_BORRADORES), a);
    return "sin-fotos";
  } catch { return "error"; }
}

export function borrarBorrador(uid: string, id: string, a: Almacen | null = almacenDelNavegador()): void {
  if (!a) return;
  try { escribe(uid, listarBorradores(uid, a).filter((x) => x.id !== id), a); } catch { /* nada */ }
}

/** ¿Hay algo escrito que se perdería al cerrar? (para pedir confirmación). */
export function hayCambios(r: Respuestas, inicial: Respuestas = {}): boolean {
  return JSON.stringify(r) !== JSON.stringify(inicial);
}
