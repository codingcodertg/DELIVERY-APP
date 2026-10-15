"use client";
// ============================================================
// Las fotos de UNA orden, leídas aparte (D-562, migración 177).
//
// La lista de órdenes ya no baja `photos` ni `photo_meta` (columnas-de-la-lista.ts): pesan MB y tumbaban la carga.
// Quien necesita las fotos de verdad —la ficha, para enseñarlas y para añadir las de la entrega; el guardado, para
// conservar quién tomó cada una— las pide aquí, de una fila.
//
// La regla que importa: MIENTRAS NO HAN LLEGADO, NO SE ESCRIBEN FOTOS. Guardar «las de la orden + la nueva» con las de
// la orden sin cargar dejaría solo la nueva: se borrarían las que ya había.
// ============================================================
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { autoresDeFotos, type AutoresDeFotos } from "@/lib/fotos-de-entrega";
import type { Delivery } from "@/lib/types";

export type FotosDeUnaOrden = { photos: string[] | null; photo_meta: AutoresDeFotos | null };

/** Lo mínimo del cliente de Supabase que hace falta: leer UNA fila. */
export type LectorDeFotos = {
  from: (tabla: "deliveries") => {
    select: (columnas: string) => {
      eq: (columna: "id", valor: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

/** Lee `photos` y `photo_meta` de la orden `id`. `null` si falla o no está (no se sabe: quien llama no escribe). */
export async function leerFotosDeLaOrden(db: LectorDeFotos, id: string): Promise<FotosDeUnaOrden | null> {
  const r = await db.from("deliveries").select("photos, photo_meta").eq("id", id).maybeSingle();
  if (r.error || !r.data) return null;
  const f = r.data as { photos?: string[] | null; photo_meta?: AutoresDeFotos | null };
  return { photos: f.photos ?? null, photo_meta: f.photo_meta ?? null };
}

/**
 * El `photo_meta` que se guarda junto a `photos`, a partir del `photo_meta` QUE HAY EN LA BASE, no del de la lista
 * (que ya no lo trae). Sin esa lectura, cada foto vieja quedaría firmada por quien guarda ahora. `null` si no se pudo
 * leer: entonces no se guarda (perder los autores no se deshace).
 */
export async function metaDeFotosAlGuardar(
  db: LectorDeFotos, id: string, fotos: readonly string[], quien: string, ahora: string,
): Promise<AutoresDeFotos | null> {
  const enLaBase = await leerFotosDeLaOrden(db, id);
  if (!enLaBase) return null;
  return autoresDeFotos(fotos, enLaBase.photo_meta, quien, ahora);
}

/** ¿La fila trae sus fotos? (demo, modo enseñanza, o la lista justo después de guardarlas). La de la base, no. */
export function filaTraeSusFotos(fila: Partial<Delivery>): boolean {
  return Object.prototype.hasOwnProperty.call(fila, "photos");
}

export type EstadoFotos = FotosDeUnaOrden & { listas: boolean };

/**
 * Lo que cuentan las reglas del comprobante (`pruebaPendiente`, `podSinCumplir`), que solo miran cuántas hay: las
 * fotos leídas si están al día; si no, tantas casillas vacías como dice `photo_count` (o la fila, si trae las suyas).
 * NUNCA se escribe esto en la base: es solo para contar.
 */
export function fotosParaContar(estado: EstadoFotos, fila: Pick<Delivery, "photos" | "photo_count"> | null): string[] {
  if (estado.listas) return estado.photos ?? [];
  if (!fila) return [];
  const n = Array.isArray(fila.photos) ? fila.photos.length : fila.photo_count ?? 0;
  return Array.from({ length: n }, () => "");
}

/**
 * Las fotos de la orden abierta en la ficha. `listas: false` mientras se piden (o si la lectura falló): en ese estado
 * la ficha no deja escribir fotos. Se vuelven a pedir cuando la orden cambia (`updated_at`, `photo_count`), que es lo
 * que trae el realtime.
 */
export function useFotosDeLaOrden(fila: Delivery | null): EstadoFotos {
  const id = fila?.id ?? null;
  const propias = fila != null && filaTraeSusFotos(fila);
  const [leidas, setLeidas] = useState<{ id: string; clave: string; fotos: FotosDeUnaOrden } | null>(null);
  const clave = `${id}|${fila?.updated_at ?? ""}|${fila?.photo_count ?? ""}`;

  useEffect(() => {
    if (!id || propias) return;
    let vivo = true;
    void leerFotosDeLaOrden(createClient() as unknown as LectorDeFotos, id).then((f) => {
      if (vivo && f) setLeidas({ id, clave, fotos: f });
    });
    return () => { vivo = false; };
  }, [id, propias, clave]);

  if (!fila) return { photos: null, photo_meta: null, listas: false };
  if (propias) return { photos: fila.photos ?? null, photo_meta: fila.photo_meta ?? null, listas: true };
  // Mientras se vuelven a pedir (la orden cambió) se siguen ENSEÑANDO las de antes, pero no se escribe con ellas.
  if (leidas && leidas.id === id) return { ...leidas.fotos, listas: leidas.clave === clave };
  return { photos: null, photo_meta: null, listas: false };
}
